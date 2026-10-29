package ai.openeyes.glasses.core

import kotlinx.coroutines.flow.StateFlow

enum class CaptureFailure { NOT_CONNECTED, PERMISSION_DENIED, CAMERA_UNAVAILABLE, BUSY, TIMEOUT, FAILED }

sealed interface CaptureOutcome {
    /** JPEG bytes held in memory only; never written to storage. */
    class Photo(val jpeg: ByteArray, val capturedAtMs: Long) : CaptureOutcome

    data class Failed(val reason: CaptureFailure, val detail: String? = null) : CaptureOutcome
}

/** What the assistant needs from the glasses. Implemented by the toolkit controller and by test fakes. */
interface GlassesPort {
    val status: StateFlow<GlassesStatus>

    /** Turns the glasses camera on, takes one photo, then turns the camera off again. */
    suspend fun captureJpeg(): CaptureOutcome
}

interface VisionBackend {
    suspend fun describe(jpeg: ByteArray, capturedAtMs: Long): String

    suspend fun ask(question: String, jpeg: ByteArray, capturedAtMs: Long): String
}

enum class SpeechKind { ANSWER, STATUS, ERROR }

interface Speaker {
    fun speak(text: String, kind: SpeechKind)

    fun stop()
}
