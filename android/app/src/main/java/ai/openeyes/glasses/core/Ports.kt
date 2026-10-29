package ai.openeyes.glasses.core

import kotlinx.coroutines.flow.StateFlow

enum class CaptureFailure { NOT_CONNECTED, PERMISSION_DENIED, CAMERA_UNAVAILABLE, BUSY, TIMEOUT, FAILED }

sealed interface CaptureOutcome {
    /** JPEG bytes held in memory only; never written to storage. */
    class Photo(val jpeg: ByteArray, val capturedAtMs: Long) : CaptureOutcome

    data class Failed(val reason: CaptureFailure, val detail: String? = null) : CaptureOutcome
}

/** What the features need from the glasses. Implemented by the toolkit controller and by test fakes. */
interface GlassesPort {
    val status: StateFlow<GlassesStatus>

    /**
     * Takes one photo with the glasses camera. The camera stream is started on first use and kept running for
     * further photos; it turns itself off after a short idle period or when [releaseCamera] is called.
     */
    suspend fun captureJpeg(): CaptureOutcome

    /** Turns the glasses camera off now. Safe to call when it is already off. */
    fun releaseCamera()
}

/** Every AI request goes through the existing openeyes-ai server function; see OpenEyesClient. */
interface VisionBackend {
    suspend fun describe(jpeg: ByteArray, capturedAtMs: Long): String

    suspend fun ask(question: String, jpeg: ByteArray, capturedAtMs: Long): String

    suspend fun sceneCheck(jpeg: ByteArray, capturedAtMs: Long, previousSummary: String?): SceneCheck

    suspend fun find(objectName: String, jpeg: ByteArray, capturedAtMs: Long): FindResult

    suspend fun read(jpeg: ByteArray, capturedAtMs: Long): ReadResult

    suspend fun askText(question: String, jpeg: ByteArray, capturedAtMs: Long): TextAnswer

    /** Text-only conversation; no photo is sent. */
    suspend fun chat(turns: List<ChatTurn>, length: ResponseLength): String
}

enum class SpeechKind { ANSWER, STATUS, ERROR }

interface Speaker {
    /** Answers and errors replace whatever is playing; status cues queue. [slow] lowers the speech rate. */
    fun speak(text: String, kind: SpeechKind, slow: Boolean = false)

    fun stop()

    /** Suspends until nothing is being spoken, so a loop does not talk over its own previous answer. */
    suspend fun awaitSilence() = Unit
}
