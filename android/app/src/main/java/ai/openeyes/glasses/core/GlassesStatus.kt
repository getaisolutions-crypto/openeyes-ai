package ai.openeyes.glasses.core

enum class Registration { UNKNOWN, UNREGISTERED, REGISTERED }

enum class SessionPhase { NONE, STARTING, ACTIVE, PAUSED, STOPPING, STOPPED }

enum class CameraPhase { OFF, STARTING, STREAMING }

enum class CameraPermission { UNKNOWN, GRANTED, DENIED }

/** Everything the app knows about the glasses. Only the toolkit controller writes it, from observed SDK state. */
data class GlassesStatus(
    val sdkReady: Boolean = false,
    val registration: Registration = Registration.UNKNOWN,
    val deviceAvailable: Boolean = false,
    val session: SessionPhase = SessionPhase.NONE,
    val camera: CameraPhase = CameraPhase.OFF,
    val cameraPermission: CameraPermission = CameraPermission.UNKNOWN,
    val error: String? = null,
) {
    /** True only after the toolkit reported the device session as started. */
    val connected: Boolean get() = session == SessionPhase.ACTIVE

    val cameraAvailable: Boolean get() = connected && cameraPermission == CameraPermission.GRANTED

    val canStartSession: Boolean
        get() = sdkReady && registration == Registration.REGISTERED &&
            (session == SessionPhase.NONE || session == SessionPhase.STOPPED)
}

object StatusText {
    fun connection(s: GlassesStatus): String = when {
        !s.sdkReady -> "Glasses toolkit not ready"
        s.registration != Registration.REGISTERED -> "Not registered with Meta AI"
        s.session == SessionPhase.STARTING -> "Connecting to glasses"
        s.session == SessionPhase.PAUSED -> "Glasses session paused"
        s.connected -> "Glasses connected"
        else -> "Glasses disconnected"
    }

    fun camera(s: GlassesStatus): String = when {
        s.camera == CameraPhase.STREAMING -> "Glasses camera on"
        s.camera == CameraPhase.STARTING -> "Glasses camera starting"
        s.cameraPermission == CameraPermission.DENIED -> "Camera unavailable: permission not given in Meta AI"
        s.cameraAvailable -> "Camera available"
        else -> "Camera unavailable"
    }

    fun session(s: GlassesStatus): String = when (s.session) {
        SessionPhase.ACTIVE -> "Session active"
        SessionPhase.STARTING -> "Session starting"
        SessionPhase.PAUSED -> "Session paused"
        SessionPhase.STOPPING -> "Session stopping"
        SessionPhase.NONE, SessionPhase.STOPPED -> "Session stopped"
    }

    /** Spoken only for changes a blind user needs to know about, not for every internal step. */
    fun announcement(old: GlassesStatus, new: GlassesStatus): String? = when {
        !old.connected && new.connected -> "Glasses connected."
        old.connected && new.session == SessionPhase.PAUSED -> "Glasses paused. They may have been taken off or folded."
        old.connected && !new.connected -> "Glasses disconnected."
        old.session == SessionPhase.STARTING && new.session == SessionPhase.STOPPED ->
            "Could not connect to the glasses. Check they are on, unfolded and near the phone."
        old.cameraPermission != CameraPermission.DENIED && new.cameraPermission == CameraPermission.DENIED ->
            "Glasses camera permission was not given."
        old.registration != Registration.REGISTERED && new.registration == Registration.REGISTERED ->
            "OpenEyes is registered with Meta AI."
        else -> null
    }
}
