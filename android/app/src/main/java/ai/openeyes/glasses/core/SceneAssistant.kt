package ai.openeyes.glasses.core

import ai.openeyes.glasses.backend.BackendErrorKind
import ai.openeyes.glasses.backend.BackendException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class AssistantPhase { IDLE, CAPTURING, ANALYZING }

object AssistantMessages {
    const val NOT_CONNECTED = "The glasses are not connected. Connect the glasses first, then ask again."
    const val PERMISSION_DENIED =
        "OpenEyes is not allowed to use the glasses camera. Choose Allow glasses camera, then accept in the Meta AI app."
    const val CAMERA_UNAVAILABLE = "The glasses camera is not available right now. Make sure the glasses are on and worn, then try again."
    const val BUSY = "Still working on the last photo."
    const val TIMEOUT = "The glasses camera did not start in time. Please try again."
    const val CAPTURE_FAILED = "The glasses could not take a photo. Please try again."
    const val LOOKING = "Looking."
    const val EMPTY = "Meta AI did not return a description. Please try again."
    const val SAFETY =
        "I cannot tell you whether it is safe to cross or move. Use your cane, guide dog or usual mobility skills. Here is what the photo shows: "

    fun forCapture(reason: CaptureFailure): String = when (reason) {
        CaptureFailure.NOT_CONNECTED -> NOT_CONNECTED
        CaptureFailure.PERMISSION_DENIED -> PERMISSION_DENIED
        CaptureFailure.CAMERA_UNAVAILABLE -> CAMERA_UNAVAILABLE
        CaptureFailure.BUSY -> BUSY
        CaptureFailure.TIMEOUT -> TIMEOUT
        CaptureFailure.FAILED -> CAPTURE_FAILED
    }

    fun forBackend(kind: BackendErrorKind): String = when (kind) {
        BackendErrorKind.APP_NOT_CONFIGURED ->
            "This copy of OpenEyes Glasses was built without the OpenEyes server address, so nothing was sent. Rebuild the app as described in the setup guide."
        BackendErrorKind.NOT_CONFIGURED -> "Meta AI is not set up on the OpenEyes server yet, so OpenEyes cannot answer."
        BackendErrorKind.AUTH -> "The OpenEyes server could not sign in to Meta AI."
        BackendErrorKind.RATE_LIMITED -> "Too many requests right now. Please wait a minute and try again."
        BackendErrorKind.TIMEOUT -> "Meta AI took too long to answer. Please try again."
        BackendErrorKind.NETWORK -> "OpenEyes could not reach its server. Check the phone's internet connection and try again."
        BackendErrorKind.IMAGE_REJECTED -> "This photo could not be processed. Please try again."
        BackendErrorKind.REJECTED -> "Meta AI could not process this request. Please try again."
        BackendErrorKind.BAD_RESPONSE -> "Meta AI sent an answer OpenEyes could not understand. Please try again."
        BackendErrorKind.SERVER -> "Something went wrong on the OpenEyes server. Please try again."
    }
}

object QuestionRouting {
    private val describeQuestions = listOf(
        Regex("""\bwhat (am i|i'?m) looking at\b"""),
        Regex("""\bwhat('?s| is) (in front of me|around me|here|this|that)\b"""),
        Regex("""^(describe|look)( (this|it|the scene|around))?\.?$"""),
        Regex("""\bdescribe (what you see|the scene|this|my surroundings)\b"""),
    )
    private val safetyQuestions = Regex("""\b(safe|cross|crossing|traffic|road|street|stairs|step|walk|go now)\b""")

    fun normalize(question: String?): String = question.orEmpty().trim().lowercase().replace(Regex("\\s+"), " ")

    /** Null or empty input and plain "what am I looking at" requests use the scene description task. */
    fun isDescribe(question: String?): Boolean {
        val q = normalize(question)
        return q.isEmpty() || describeQuestions.any { it.containsMatchIn(q) }
    }

    fun needsSafetyNotice(question: String?): Boolean = safetyQuestions.containsMatchIn(normalize(question))
}

/**
 * One glasses-to-AI interaction at a time: take one glasses photo, ask Muse Spark through the OpenEyes server,
 * speak the answer. Cancelling stops speech and discards a reply that arrives afterwards.
 */
class SceneAssistant(
    private val glasses: GlassesPort,
    private val backend: VisionBackend,
    private val speaker: Speaker,
    private val scope: CoroutineScope,
    private val log: DiagnosticLog = DiagnosticLog.NONE,
) {
    private val _phase = MutableStateFlow(AssistantPhase.IDLE)
    val phase: StateFlow<AssistantPhase> = _phase.asStateFlow()

    private val _lastAnswer = MutableStateFlow<String?>(null)
    val lastAnswer: StateFlow<String?> = _lastAnswer.asStateFlow()

    private var job: Job? = null

    /** Returns false when a request is already running. */
    fun ask(question: String?): Boolean {
        if (job?.isActive == true) {
            speaker.speak(AssistantMessages.BUSY, SpeechKind.STATUS)
            return false
        }
        job = scope.launch { run(question) }
        return true
    }

    fun cancel() {
        job?.cancel()
        job = null
        speaker.stop()
        _phase.value = AssistantPhase.IDLE
    }

    private suspend fun run(question: String?) {
        try {
            if (!glasses.status.value.connected) {
                say(AssistantMessages.NOT_CONNECTED, SpeechKind.ERROR)
                return
            }
            _phase.value = AssistantPhase.CAPTURING
            speaker.speak(AssistantMessages.LOOKING, SpeechKind.STATUS)
            val photo = when (val outcome = glasses.captureJpeg()) {
                is CaptureOutcome.Failed -> {
                    log.log("capture: failed reason=${outcome.reason} detail=${outcome.detail ?: "none"}")
                    say(AssistantMessages.forCapture(outcome.reason), SpeechKind.ERROR)
                    return
                }
                is CaptureOutcome.Photo -> outcome
            }
            log.log("capture: ok jpegBytes=${photo.jpeg.size}")
            currentCoroutineContext().ensureActive()
            _phase.value = AssistantPhase.ANALYZING
            val text = if (QuestionRouting.isDescribe(question)) {
                backend.describe(photo.jpeg, photo.capturedAtMs)
            } else {
                backend.ask(question!!.trim(), photo.jpeg, photo.capturedAtMs)
            }.trim()
            currentCoroutineContext().ensureActive()
            if (text.isEmpty()) {
                say(AssistantMessages.EMPTY, SpeechKind.ERROR)
                return
            }
            val answer = if (QuestionRouting.needsSafetyNotice(question)) AssistantMessages.SAFETY + text else text
            _lastAnswer.value = answer
            speaker.speak(answer, SpeechKind.ANSWER)
        } catch (e: CancellationException) {
            throw e
        } catch (e: BackendException) {
            log.log("assistant: backend error kind=${e.kind}")
            say(AssistantMessages.forBackend(e.kind), SpeechKind.ERROR)
        } catch (e: Exception) {
            log.log("assistant: unexpected ${e.javaClass.simpleName}")
            say(AssistantMessages.forBackend(BackendErrorKind.SERVER), SpeechKind.ERROR)
        } finally {
            _phase.value = AssistantPhase.IDLE
        }
    }

    private fun say(text: String, kind: SpeechKind) {
        _lastAnswer.value = text
        speaker.speak(text, kind)
    }
}
