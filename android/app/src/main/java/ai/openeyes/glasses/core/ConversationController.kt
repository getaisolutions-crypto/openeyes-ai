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

data class ChatMessage(val role: ChatRole, val text: String, val failed: Boolean = false)

data class ConversationState(
    val messages: List<ChatMessage> = emptyList(),
    val thinking: Boolean = false,
    val error: String? = null,
) {
    val lastAnswer: String? get() = messages.lastOrNull { it.role == ChatRole.ASSISTANT }?.text
}

object ConversationMessages {
    const val EMPTY = "Say or type a question first."
    const val TOO_LONG = "That message is too long. Please keep it under 2000 characters."
    const val BUSY = "Still thinking about your last question."
    const val NOTHING_TO_REPEAT = "There is no answer to repeat yet."
    const val NEW = "New conversation."
    const val NO_ANSWER = "Meta AI did not return an answer. Please try again."
    const val MAX_MESSAGE = 2_000

    /** The server accepts at most 12 messages and 12,000 characters in total. */
    const val MAX_TURNS = 12
    const val MAX_TOTAL_CHARS = 11_000
}

/**
 * Ask OpenEyes: a text-only conversation with Muse Spark through the server's "chat" task. It never uses the
 * glasses camera and works without glasses; earlier turns are sent so follow-ups like "what is its capital?" work.
 * The history lives in memory only and is gone after New conversation or when the app closes.
 */
class ConversationController(
    private val backend: VisionBackend,
    private val speaker: Speaker,
    private val scope: CoroutineScope,
    private val log: DiagnosticLog = DiagnosticLog.NONE,
) {
    private val _state = MutableStateFlow(ConversationState())
    val state: StateFlow<ConversationState> = _state.asStateFlow()

    private var job: Job? = null

    /** Returns false when the message was not sent (empty, too long or still answering). */
    fun send(input: String): Boolean {
        val text = input.trim()
        val problem = when {
            text.isEmpty() -> ConversationMessages.EMPTY
            text.length > ConversationMessages.MAX_MESSAGE -> ConversationMessages.TOO_LONG
            job?.isActive == true -> ConversationMessages.BUSY
            else -> null
        }
        if (problem != null) {
            _state.update { it.copy(error = problem) }
            speaker.speak(problem, if (problem == ConversationMessages.BUSY) SpeechKind.STATUS else SpeechKind.ERROR)
            return false
        }
        speaker.stop()
        val asked = ChatMessage(ChatRole.USER, text)
        _state.update { it.copy(messages = it.messages + asked, thinking = true, error = null) }
        val turns = boundedTurns(_state.value.messages)
        job = scope.launch { answer(asked, turns) }
        return true
    }

    private suspend fun answer(asked: ChatMessage, turns: List<ChatTurn>) {
        try {
            val reply = backend.chat(turns, ResponseLength.STANDARD).trim()
            currentCoroutineContext().ensureActive()
            if (reply.isEmpty()) {
                fail(asked, ConversationMessages.NO_ANSWER)
                return
            }
            _state.update { it.copy(messages = it.messages + ChatMessage(ChatRole.ASSISTANT, reply)) }
            speaker.speak(reply, SpeechKind.ANSWER)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.log("chat: failed ${e.javaClass.simpleName}")
            fail(asked, ModeErrors.message(e))
        } finally {
            _state.update { it.copy(thinking = false) }
        }
    }

    /** The failed question stays visible but is not sent again as context. */
    private fun fail(asked: ChatMessage, message: String) {
        _state.update { s ->
            val index = s.messages.lastIndexOf(asked)
            val messages = if (index >= 0) s.messages.toMutableList().also { it[index] = asked.copy(failed = true) } else s.messages
            s.copy(messages = messages, error = message)
        }
        speaker.speak(message, SpeechKind.ERROR)
    }

    fun stopSpeaking() = speaker.stop()

    fun repeat() {
        val last = _state.value.lastAnswer
        if (last == null) speaker.speak(ConversationMessages.NOTHING_TO_REPEAT, SpeechKind.STATUS) else speaker.speak(last, SpeechKind.ANSWER)
    }

    fun cancel() {
        job?.cancel()
        job = null
        speaker.stop()
        _state.update { it.copy(thinking = false) }
    }

    fun newConversation() {
        cancel()
        _state.value = ConversationState()
        speaker.speak(ConversationMessages.NEW, SpeechKind.STATUS)
    }

    fun reportError(message: String) {
        _state.update { it.copy(error = message) }
        speaker.speak(message, SpeechKind.ERROR)
    }

    companion object {
        /** Most recent successful turns that fit the server's limits, oldest first, ending with the new question. */
        fun boundedTurns(messages: List<ChatMessage>): List<ChatTurn> {
            val kept = ArrayDeque<ChatTurn>()
            var total = 0
            for (m in messages.asReversed()) {
                if (m.failed) continue
                if (kept.size == ConversationMessages.MAX_TURNS || total + m.text.length > ConversationMessages.MAX_TOTAL_CHARS) break
                kept.addFirst(ChatTurn(m.role, m.text))
                total += m.text.length
            }
            return kept.toList()
        }
    }
}
