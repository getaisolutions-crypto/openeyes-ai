package ai.openeyes.glasses.glasses

import ai.openeyes.glasses.core.CameraPermission
import ai.openeyes.glasses.core.CameraPhase
import ai.openeyes.glasses.core.CaptureFailure
import ai.openeyes.glasses.core.CaptureOutcome
import ai.openeyes.glasses.core.GlassesPort
import ai.openeyes.glasses.core.GlassesStatus
import ai.openeyes.glasses.core.Registration
import ai.openeyes.glasses.core.SessionPhase
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
        _status.update { it.copy(camera = CameraPhase.OFF) }
        jobs.forEach { it.cancel() }
    }

    override suspend fun captureJpeg(): CaptureOutcome {
        if (!captureLock.tryLock()) return CaptureOutcome.Failed(CaptureFailure.BUSY)
        try {
            val current = session
            if (current == null || !_status.value.connected) return CaptureOutcome.Failed(CaptureFailure.NOT_CONNECTED)
            refreshCameraPermission()
            if (_status.value.cameraPermission != CameraPermission.GRANTED) {
                return CaptureOutcome.Failed(CaptureFailure.PERMISSION_DENIED)
            }

            var camera: Camera? = null
            var addError: String? = null
            current.addCamera(StreamConfiguration(videoQuality = VideoQuality.MEDIUM, frameRate = 15))
                .onSuccess { camera = it }
                .onFailure { error, _ -> addError = error.description }
            val cam = camera ?: return CaptureOutcome.Failed(CaptureFailure.CAMERA_UNAVAILABLE, addError)

            _status.update { it.copy(camera = CameraPhase.STARTING) }
            try {
                return captureFrom(cam)
            } finally {
                withContext(NonCancellable) {
                    // A stopped camera cannot restart; removing it lets the next capture add a fresh one.
                    cam.stop()
                    current.removeCamera()
                    _status.update { it.copy(camera = CameraPhase.OFF) }
                }
            }
        } finally {
            captureLock.unlock()
        }
    }

    // capturePhoto() only works while the stream is running, so the stream runs just long enough for one photo.
    private suspend fun captureFrom(cam: Camera): CaptureOutcome {
        var startError: String? = null
        cam.stream.start().onFailure { error, _ -> startError = error.description }
        startError?.let { return CaptureOutcome.Failed(CaptureFailure.CAMERA_UNAVAILABLE, it) }

        val reached = withTimeoutOrNull(STREAM_START_TIMEOUT_MS) {
            cam.stream.state.first { it == StreamState.STREAMING || it == StreamState.CLOSED }
        }
        when (reached) {
            null -> return CaptureOutcome.Failed(CaptureFailure.TIMEOUT)
            StreamState.STREAMING -> _status.update { it.copy(camera = CameraPhase.STREAMING) }
            else -> return CaptureOutcome.Failed(CaptureFailure.CAMERA_UNAVAILABLE, "Camera stream closed")
        }

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
    }
}
