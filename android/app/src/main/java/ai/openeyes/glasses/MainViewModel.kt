package ai.openeyes.glasses

import ai.openeyes.glasses.backend.BackendConfig
import ai.openeyes.glasses.backend.OpenEyesClient
import ai.openeyes.glasses.backend.UrlConnectionTransport
import ai.openeyes.glasses.core.AssistantMessages
import ai.openeyes.glasses.core.AssistantPhase
import ai.openeyes.glasses.core.SceneAssistant
import ai.openeyes.glasses.core.SpeechKind
import ai.openeyes.glasses.core.StatusText
import ai.openeyes.glasses.glasses.WearablesController
import ai.openeyes.glasses.voice.AndroidSpeaker
import ai.openeyes.glasses.voice.ListenResult
import ai.openeyes.glasses.voice.QuestionListener
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch

class MainViewModel(app: Application) : AndroidViewModel(app) {

    private val backendConfig = BackendConfig(BuildConfig.OPENEYES_FUNCTION_URL, BuildConfig.OPENEYES_PUBLIC_KEY)
    val backendConfigured: Boolean = backendConfig.isComplete

    val glasses = WearablesController(app, viewModelScope)
    private val speaker = AndroidSpeaker(app)
    private val listener = QuestionListener(app)
    val assistant = SceneAssistant(
        glasses,
        OpenEyesClient(backendConfig, UrlConnectionTransport(), log = AndroidDiagnosticLog),
        speaker,
        viewModelScope,
        AndroidDiagnosticLog,
    )

    private val _listening = MutableStateFlow(false)
    val listening: StateFlow<Boolean> = _listening.asStateFlow()

    private val _announcements = Channel<String>(Channel.CONFLATED)
    /** Connection changes worth saying out loud; the screen decides whether TalkBack already covers them. */
    val announcements = _announcements.receiveAsFlow()

    init {
        AndroidDiagnosticLog.log(
            "config: server=${backendConfig.functionUrl.ifEmpty { "MISSING" }} publicKey=${if (backendConfig.publicKey.isBlank()) "MISSING" else "present"}",
        )
        viewModelScope.launch {
            var previous = glasses.status.value
            glasses.status.collect { current ->
                StatusText.announcement(previous, current)?.let { _announcements.trySend(it) }
                previous = current
            }
        }
    }

    fun speakStatus(text: String) = speaker.speak(text, SpeechKind.STATUS)

    fun refreshPermissions() {
        viewModelScope.launch { glasses.refreshCameraPermission() }
    }

    fun whatAmILookingAt() {
        listener.cancel()
        _listening.value = false
        assistant.ask(null)
    }

    /** Main thread only. One spoken question, then the same photo-and-answer flow as the look button. */
    fun askByVoice() {
        if (assistant.phase.value != AssistantPhase.IDLE) {
            speaker.speak(AssistantMessages.BUSY, SpeechKind.STATUS)
            return
        }
        speaker.stop()
        _listening.value = true
        listener.listen { result ->
            _listening.value = false
            when (result) {
                is ListenResult.Heard -> assistant.ask(result.text)
                ListenResult.NothingHeard -> speaker.speak(NOTHING_HEARD, SpeechKind.ERROR)
                ListenResult.NotAllowed -> speaker.speak(MIC_NOT_ALLOWED, SpeechKind.ERROR)
                ListenResult.Unavailable -> speaker.speak(NO_RECOGNIZER, SpeechKind.ERROR)
                is ListenResult.Failed -> speaker.speak(LISTEN_FAILED, SpeechKind.ERROR)
            }
        }
    }

    fun micPermissionDenied() = speaker.speak(MIC_NOT_ALLOWED, SpeechKind.ERROR)

    fun stopEverything() {
        listener.cancel()
        _listening.value = false
        assistant.cancel()
    }

    override fun onCleared() {
        stopEverything()
        glasses.disconnect()
        speaker.shutdown()
    }

    private companion object {
        const val NOTHING_HEARD = "I did not hear a question. Press Ask a question and try again."
        const val MIC_NOT_ALLOWED = "OpenEyes needs microphone permission to hear your question. You can allow it in Android settings."
        const val NO_RECOGNIZER = "Speech recognition is not available on this phone. Use What am I looking at instead."
        const val LISTEN_FAILED = "I could not listen just now. Please try again."
    }
}
