package ai.openeyes.glasses.glasses

import ai.openeyes.glasses.core.CameraPermission
import ai.openeyes.glasses.core.CameraPhase
import ai.openeyes.glasses.core.CaptureFailure
import ai.openeyes.glasses.core.CaptureOutcome
import ai.openeyes.glasses.core.GlassesPort
import ai.openeyes.glasses.core.GlassesStatus
import ai.openeyes.glasses.core.Registration
import ai.openeyes.glasses.core.SessionPhase
import ai.openeyes.glasses.AndroidDiagnosticLog as AndroidLog
import android.app.Activity
import android.content.Context
import com.meta.wearable.dat.camera.Camera
import com.meta.wearable.dat.camera.addCamera
import com.meta.wearable.dat.camera.types.PhotoData
import com.meta.wearable.dat.camera.types.StreamConfiguration
import com.meta.wearable.dat.camera.types.StreamState // VERIFY package in Android Studio (not shown verbatim in the toolkit guide).
import com.meta.wearable.dat.camera.types.VideoQuality
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.selectors.AutoDeviceSelector
import com.meta.wearable.dat.core.session.DeviceSession
import com.meta.wearable.dat.core.session.DeviceSessionState
import com.meta.wearable.dat.core.types.Permission // VERIFY package in Android Studio.
import com.meta.wearable.dat.core.types.PermissionStatus // VERIFY package in Android Studio.
import com.meta.wearable.dat.core.types.RegistrationState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The only place that talks to the Meta Wearables Device Access Toolkit. Every status field is set from state the
 * toolkit reports, so "connected" means the toolkit said the device session started.
 */
class WearablesController(private val appContext: Context, private val scope: CoroutineScope) : GlassesPort {

    private val _status = MutableStateFlow(GlassesStatus())
    override val status: StateFlow<GlassesStatus> = _status.asStateFlow()

    private var session: DeviceSession? = null
    private val sessionJobs = mutableListOf<Job>()
    private val captureLock = Mutex()
    private var camera: Camera? = null
    private var cameraUsedOnSession = false
    private var idleJob: Job? = null

    /** Call after the Bluetooth permission has been granted. Safe to call more than once. */
    fun initialize() {
        if (_status.value.sdkReady) return
        var failed = false
        Wearables.initialize(appContext).onFailure { error, _ ->
            failed = true
            _status.update { it.copy(error = "Glasses toolkit could not start: ${error.description}") }
        }
        if (failed) return
        _status.update { it.copy(sdkReady = true, error = null) }
        scope.launch {
            Wearables.registrationState.collect { state ->
                val registration = if (state == RegistrationState.REGISTERED) Registration.REGISTERED else Registration.UNREGISTERED
                _status.update { it.copy(registration = registration) }
                if (registration == Registration.REGISTERED) refreshCameraPermission()
            }
        }
        scope.launch {
            Wearables.devices.collect { devices -> _status.update { it.copy(deviceAvailable = devices.isNotEmpty()) } }
        }
    }

    /** Opens the Meta AI app so the user can approve OpenEyes. The result arrives through registrationState. */
    fun register(activity: Activity) {
        if (!_status.value.sdkReady) return
        Wearables.startRegistration(activity)
    }

    fun unregister(activity: Activity) {
        if (!_status.value.sdkReady) return
        disconnect()
        Wearables.startUnregistration(activity)
    }

    suspend fun refreshCameraPermission() {
        if (!_status.value.sdkReady) return
        Wearables.checkPermissionStatus(Permission.CAMERA)
            .onSuccess { status -> setCameraPermission(status) }
            .onFailure { error, _ -> _status.update { it.copy(error = error.description) } }
    }

    /** Result from the Meta AI permission sheet launched with Wearables.RequestPermissionContract. */
    fun setCameraPermission(status: PermissionStatus) {
        val permission = if (status == PermissionStatus.Granted) CameraPermission.GRANTED else CameraPermission.DENIED
        _status.update { it.copy(cameraPermission = permission) }
    }

    fun connect() {
        if (!_status.value.canStartSession) return
        _status.update { it.copy(session = SessionPhase.STARTING, error = null) }
        Wearables.createSession(AutoDeviceSelector()).fold(
            onSuccess = { created ->
                observe(created)
                // start() is fire-and-forget; the outcome arrives through session.state and session.errors.
                created.start()
            },
            onFailure = { error, _ ->
                _status.update { it.copy(session = SessionPhase.STOPPED, error = error.description) }
            },
        )
    }

    fun disconnect() {
        releaseCamera()
        val current = session ?: return
        _status.update { it.copy(session = SessionPhase.STOPPING) }
        current.stop()
    }

    private fun observe(created: DeviceSession) {
        releaseSession()
        session = created
        sessionJobs += scope.launch {
            created.state.collect { state ->
                val phase = when (state) {
                    DeviceSessionState.STARTED -> SessionPhase.ACTIVE
                    DeviceSessionState.PAUSED -> SessionPhase.PAUSED
                    DeviceSessionState.STOPPING -> SessionPhase.STOPPING
                    DeviceSessionState.STOPPED -> SessionPhase.STOPPED
                    else -> SessionPhase.STARTING
                }
                _status.update { it.copy(session = phase) }
                // STOPPED is terminal; a new session must be created to reconnect.
                if (phase == SessionPhase.STOPPED) releaseSession()
            }
        }
        sessionJobs += scope.launch {
            created.errors.collect { error -> _status.update { it.copy(error = error.description) } }
        }
    }

    private fun releaseSession() {
        val jobs = sessionJobs.toList()
        sessionJobs.clear()
        session = null
        // Capabilities end with their session; a new session starts with no camera attached.
        camera = null
        cameraUsedOnSession = false
        idleJob?.cancel()
        _status.update { it.copy(camera = CameraPhase.OFF) }
        jobs.forEach { it.cancel() }
    }

    override suspend fun captureJpeg(): CaptureOutcome {
        if (!captureLock.tryLock()) return CaptureOutcome.Failed(CaptureFailure.BUSY)
        try {
            idleJob?.cancel()
            if (session == null || !_status.value.connected) return CaptureOutcome.Failed(CaptureFailure.NOT_CONNECTED)
            // The permission is re-checked whenever the stream has to be started, not on every photo.
            if (camera == null) refreshCameraPermission()
            if (_status.value.cameraPermission != CameraPermission.GRANTED) {
                return CaptureOutcome.Failed(CaptureFailure.PERMISSION_DENIED)
            }
            val cam = camera ?: when (val opened = openCamera(allowRecovery = true)) {
                is Opened.Ready -> opened.camera
                is Opened.Failed -> return opened.outcome
            }
            val outcome = takePhoto(cam)
            // A failed in-stream capture usually means the stream ended; start a fresh one next time.
            if (outcome is CaptureOutcome.Failed) closeCamera()
            return outcome
        } finally {
            captureLock.unlock()
            scheduleIdleRelease()
        }
    }

    override fun releaseCamera() {
        idleJob?.cancel()
        scope.launch(NonCancellable) { closeCamera() }
    }

    private fun scheduleIdleRelease() {
        idleJob?.cancel()
        if (camera == null) return
        idleJob = scope.launch {
            delay(CAMERA_IDLE_MS)
            // Never stop the stream underneath a photo that started just as the idle period ran out.
            if (captureLock.tryLock()) {
                try {
                    closeCamera()
                } finally {
                    captureLock.unlock()
                }
            }
        }
    }

    private suspend fun closeCamera() {
        val cam = camera ?: return
        camera = null
        AndroidLog.log("camera: stream stopped")
        cam.stop()
        _status.update { it.copy(camera = CameraPhase.OFF) }
    }

    private sealed interface Opened {
        class Ready(val camera: Camera) : Opened
        class Failed(val outcome: CaptureOutcome.Failed) : Opened
    }

    /**
     * Adds the camera and starts its stream. capturePhoto() only works while the stream runs, so the stream is kept
     * running between photos. A stopped camera cannot restart; if the toolkit refuses to add another one on the same
     * session, the device session is restarted once (only documented toolkit calls are used for that).
     */
    private suspend fun openCamera(allowRecovery: Boolean): Opened {
        val current = session ?: return Opened.Failed(CaptureOutcome.Failed(CaptureFailure.NOT_CONNECTED))
        val reopening = cameraUsedOnSession
        var added: Camera? = null
        var addError: String? = null
        current.addCamera(StreamConfiguration(videoQuality = VideoQuality.MEDIUM, frameRate = 15))
            .onSuccess { added = it }
            .onFailure { error, _ -> addError = error.description }
        val cam = added
        if (cam == null) {
            if (allowRecovery && reopening && restartSession()) return openCamera(allowRecovery = false)
            return Opened.Failed(CaptureOutcome.Failed(CaptureFailure.CAMERA_UNAVAILABLE, addError))
        }
        cameraUsedOnSession = true
        _status.update { it.copy(camera = CameraPhase.STARTING) }

        var startError: String? = null
        cam.stream.start().onFailure { error, _ -> startError = error.description }
        val reached = if (startError != null) {
            null
        } else {
            withTimeoutOrNull(STREAM_START_TIMEOUT_MS) {
                cam.stream.state.first { it == StreamState.STREAMING || it == StreamState.CLOSED }
            }
        }
        if (reached != StreamState.STREAMING) {
            withContext(NonCancellable) {
                cam.stop()
                _status.update { it.copy(camera = CameraPhase.OFF) }
            }
            if (allowRecovery && reopening && restartSession()) return openCamera(allowRecovery = false)
            val failure = when {
                startError != null -> CaptureOutcome.Failed(CaptureFailure.CAMERA_UNAVAILABLE, startError)
                reached == null -> CaptureOutcome.Failed(CaptureFailure.TIMEOUT)
                else -> CaptureOutcome.Failed(CaptureFailure.CAMERA_UNAVAILABLE, "Camera stream closed")
            }
            return Opened.Failed(failure)
        }
        camera = cam
        AndroidLog.log("camera: stream running")
        _status.update { it.copy(camera = CameraPhase.STREAMING) }
        return Opened.Ready(cam)
    }

    /** Stops and recreates the device session. Status announcements are suppressed while this runs. */
    private suspend fun restartSession(): Boolean {
        val old = session ?: return false
        AndroidLog.log("camera: re-adding refused, restarting device session")
        _status.update { it.copy(recoveringCamera = true) }
        try {
            old.stop()
            withTimeoutOrNull(SESSION_STOP_TIMEOUT_MS) {
                _status.first { it.session == SessionPhase.STOPPED || it.session == SessionPhase.NONE }
            } ?: return false
            connect()
            return withTimeoutOrNull(SESSION_START_TIMEOUT_MS) {
                _status.first { it.connected || it.session == SessionPhase.STOPPED }
            }?.connected == true
        } finally {
            _status.update { it.copy(recoveringCamera = false) }
        }
    }

    private suspend fun takePhoto(cam: Camera): CaptureOutcome {
        var photo: PhotoData? = null
        var captureError: String? = null
        cam.stream.capturePhoto()
            .onSuccess { photo = it }
            .onFailure { error, _ -> captureError = error.description }
        val captured = photo ?: return CaptureOutcome.Failed(CaptureFailure.FAILED, captureError)
        val capturedAt = System.currentTimeMillis()

        val jpeg = withContext(Dispatchers.Default) { PhotoEncoder.toJpeg(captured) }
            ?: return CaptureOutcome.Failed(CaptureFailure.FAILED, "Photo could not be converted")
        return CaptureOutcome.Photo(jpeg, capturedAt)
    }

    private companion object {
        const val STREAM_START_TIMEOUT_MS = 12_000L
        const val SESSION_STOP_TIMEOUT_MS = 8_000L
        const val SESSION_START_TIMEOUT_MS = 20_000L
        /** Longer than the slowest Explore interval, so continuous modes keep one stream running. */
        const val CAMERA_IDLE_MS = 20_000L
    }
}
