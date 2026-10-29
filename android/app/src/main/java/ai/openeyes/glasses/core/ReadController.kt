package ai.openeyes.glasses.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class ReadPhase { IDLE, LOOKING, READING, THINKING }

enum class AsideKind(val label: String) {
    SUMMARY("AI summary"),
    TRANSLATION("AI translation"),
    EXPLANATION("AI explanation"),
    KEY_POINTS("AI: important information"),
    ANSWER("AI answer"),
}

/** Anything the AI produced from the text. Always shown and spoken apart from the original transcription. */
data class ReadAside(val kind: AsideKind, val text: String)

data class ReadState(
    val phase: ReadPhase = ReadPhase.IDLE,
    val transcription: String? = null,
    val hasUnreadableParts: Boolean = false,
    val aside: ReadAside? = null,
    val error: String? = null,
) {
    val busy: Boolean get() = phase != ReadPhase.IDLE
}

sealed interface ReadRequest {
    data object Repeat : ReadRequest
    data object Slower : ReadRequest
    data object Summarize : ReadRequest
    data class Translate(val language: String) : ReadRequest
    data object Explain : ReadRequest
    data object Important : ReadRequest
    data class Question(val text: String) : ReadRequest
}

object ReadFollowUp {
    const val DEFAULT_LANGUAGE = "Spanish"
    private val translate = Regex("""\btranslate\b(?:.*?\b(?:to|into|in)\s+([a-z]+))?""")

    /** Maps a spoken or typed follow-up to an action; anything else is a question about the text. */
    fun parse(input: String): ReadRequest? {
        val q = QuestionRouting.normalize(input).trimEnd('.', '?', '!')
        if (q.isEmpty()) return null
        translate.find(q)?.let { m ->
            val lang = m.groupValues[1].takeIf { it.isNotEmpty() && it != "it" && it != "this" }
            return ReadRequest.Translate(lang?.replaceFirstChar { it.uppercase() } ?: DEFAULT_LANGUAGE)
        }
        return when {
            Regex("""\b(slower|slowly)\b""").containsMatchIn(q) -> ReadRequest.Slower
            Regex("""^(repeat|again|read (it )?again|say (it|that) again)( please)?$""").containsMatchIn(q) -> ReadRequest.Repeat
            Regex("""\bsummar(y|ise|ize)\b""").containsMatchIn(q) -> ReadRequest.Summarize
            Regex("""\bwhat does (this|it|that) mean\b|^explain\b""").containsMatchIn(q) -> ReadRequest.Explain
            Regex("""\bimportant\b|\bkey (points|information)\b""").containsMatchIn(q) -> ReadRequest.Important
            else -> ReadRequest.Question(input.trim())
        }
    }
}

object ReadMessages {
    const val LOOKING = "Hold still. Reading."
    const val UNREADABLE =
        "I could not read any text, and I won't guess at the words. Try more light, hold the text about a forearm's length away, keep it flat and still, then read again."
    const val PARTLY_UNREADABLE = "Parts marked unreadable could not be made out."
    const val NOTHING_YET = "Read some text first."
    const val CLEARED = "Reading cleared."
    const val SHORTENED = "The text was long, so only its first part was used."
    const val NOT_FOUND = "I couldn't find that in the text."
    const val MAX_QUESTION = 300

    /** Leaves room in the server's 2000 character message limit for the instruction around the text. */
    const val MAX_QUOTED_TEXT = 1_600

    fun phrase(answer: TextAnswer): String = when (answer.basis) {
        AnswerBasis.EXACT -> answer.answer.trim() + if (answer.quote.isNotBlank()) " The text says: \"${answer.quote.trim()}\"" else ""
        AnswerBasis.SUMMARY -> "In summary: ${answer.answer.trim()}"
        AnswerBasis.INFERENCE -> "This is my inference, not stated in the text: ${answer.answer.trim()}"
        AnswerBasis.NOT_FOUND -> NOT_FOUND
    }

    fun instruction(request: ReadRequest): String = when (request) {
        ReadRequest.Summarize -> "Summarise this text in two or three short sentences."
        is ReadRequest.Translate -> "Translate this text into ${request.language}. Translate only; do not add anything."
        ReadRequest.Explain -> "Explain in plain words what this text means for the reader."
        ReadRequest.Important -> "List only the important information in this text, such as dates, amounts, names, warnings and instructions."
        else -> error("not a text-only request")
    }

    fun prompt(request: ReadRequest, text: String): Pair<String, Boolean> {
        val shortened = text.length > MAX_QUOTED_TEXT
        val quoted = if (shortened) text.take(MAX_QUOTED_TEXT) else text
        return (
            "${instruction(request)} Use only the text between the markers; do not invent anything. " +
                "Parts marked [unreadable] could not be read, so say so instead of guessing them.\n" +
                "<<<TEXT\n$quoted\nTEXT>>>"
            ) to shortened
    }

    fun asideKind(request: ReadRequest): AsideKind = when (request) {
        ReadRequest.Summarize -> AsideKind.SUMMARY
        is ReadRequest.Translate -> AsideKind.TRANSLATION
        ReadRequest.Explain -> AsideKind.EXPLANATION
        ReadRequest.Important -> AsideKind.KEY_POINTS
        else -> AsideKind.ANSWER
    }
}

/**
 * Read Text: one glasses photo read with the server's "read" task. The transcription and the photo stay in memory
 * only, until the person reads something else, presses Clear or leaves; nothing is saved.
 */
class ReadController(
    private val glasses: GlassesPort,
    private val backend: VisionBackend,
    private val speaker: Speaker,
    private val coordinator: CameraModeCoordinator,
    private val scope: CoroutineScope,
    private val log: DiagnosticLog = DiagnosticLog.NONE,
) {
    private val _state = MutableStateFlow(ReadState())
    val state: StateFlow<ReadState> = _state.asStateFlow()

    private var photo: CaptureOutcome.Photo? = null
    private var followUp: Job? = null

    fun read() {
        followUp?.cancel()
        _state.update { it.copy(phase = ReadPhase.LOOKING, error = null) }
        coordinator.start(CameraMode.READ) {
            try {
                capture()
            } finally {
                _state.update { if (it.phase == ReadPhase.LOOKING || it.phase == ReadPhase.READING) it.copy(phase = ReadPhase.IDLE) else it }
            }
        }
    }

    private suspend fun capture() {
        speaker.speak(ReadMessages.LOOKING, SpeechKind.STATUS)
        val shot = when (val outcome = glasses.captureJpeg()) {
            is CaptureOutcome.Photo -> outcome
            is CaptureOutcome.Failed -> {
                log.log("read: capture failed reason=${outcome.reason}")
                report(AssistantMessages.forCapture(outcome.reason))
                return
            }
        }
        _state.update { it.copy(phase = ReadPhase.READING) }
        val result = try {
            backend.read(shot.jpeg, shot.capturedAtMs)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.log("read: request failed ${e.javaClass.simpleName}")
            report(ModeErrors.message(e))
            return
        }
        currentCoroutineContext().ensureActive()
        val text = result.text.trim()
        if (!result.readable || text.isEmpty()) {
            report(ReadMessages.UNREADABLE)
            return
        }
        photo = shot
        val partial = text.contains("[unreadable]", ignoreCase = true)
        _state.value = ReadState(transcription = text, hasUnreadableParts = partial)
        speaker.speak(if (partial) "$text ${ReadMessages.PARTLY_UNREADABLE}" else text, SpeechKind.ANSWER)
    }

    fun request(input: String) {
        val parsed = ReadFollowUp.parse(input) ?: return
        request(parsed)
    }

    fun request(request: ReadRequest) {
        val text = _state.value.transcription
        if (text == null) {
            report(ReadMessages.NOTHING_YET)
            return
        }
        when (request) {
            ReadRequest.Repeat -> speaker.speak(text, SpeechKind.ANSWER)
            ReadRequest.Slower -> speaker.speak(text, SpeechKind.ANSWER, slow = true)
            else -> {
                followUp?.cancel()
                speaker.stop()
                followUp = scope.launch { ai(request, text) }
            }
        }
    }

    private suspend fun ai(request: ReadRequest, text: String) {
        _state.update { it.copy(phase = ReadPhase.THINKING, error = null) }
        try {
            val reply = if (request is ReadRequest.Question) {
                val shot = photo ?: return report(ReadMessages.NOTHING_YET)
                ReadMessages.phrase(backend.askText(request.text.take(ReadMessages.MAX_QUESTION), shot.jpeg, shot.capturedAtMs))
            } else {
                val (prompt, shortened) = ReadMessages.prompt(request, text)
                val answer = backend.chat(listOf(ChatTurn(ChatRole.USER, prompt)), ResponseLength.STANDARD).trim()
                if (shortened && answer.isNotEmpty()) "$answer ${ReadMessages.SHORTENED}" else answer
            }
            currentCoroutineContext().ensureActive()
            if (reply.isBlank()) {
                report(AssistantMessages.EMPTY)
                return
            }
            val aside = ReadAside(ReadMessages.asideKind(request), reply)
            _state.update { it.copy(aside = aside) }
            speaker.speak("${aside.kind.label}. $reply", SpeechKind.ANSWER)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.log("read: follow-up failed ${e.javaClass.simpleName}")
            report(ModeErrors.message(e))
        } finally {
            _state.update { if (it.phase == ReadPhase.THINKING) it.copy(phase = ReadPhase.IDLE) else it }
        }
    }

    fun stop() {
        followUp?.cancel()
        coordinator.stop(CameraMode.READ)
        speaker.stop()
        _state.update { it.copy(phase = ReadPhase.IDLE) }
    }

    /** Forgets the text and the photo. Also called when the person leaves the Read screen. */
    fun clear(announce: Boolean = true) {
        stop()
        photo = null
        _state.value = ReadState()
        if (announce) speaker.speak(ReadMessages.CLEARED, SpeechKind.STATUS)
    }

    private fun report(message: String) {
        _state.update { it.copy(error = message, phase = ReadPhase.IDLE) }
        speaker.speak(message, SpeechKind.ERROR)
    }
}
