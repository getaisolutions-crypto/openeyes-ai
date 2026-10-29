package ai.openeyes.glasses

import ai.openeyes.glasses.backend.AiReadiness
import ai.openeyes.glasses.backend.BackendConfig
import ai.openeyes.glasses.backend.OpenEyesClient
import ai.openeyes.glasses.backend.UrlConnectionTransport
import ai.openeyes.glasses.core.AssistantMessages
import ai.openeyes.glasses.core.AssistantPhase
import ai.openeyes.glasses.core.CameraMode
import ai.openeyes.glasses.core.CameraModeCoordinator
import ai.openeyes.glasses.core.ConversationController
import ai.openeyes.glasses.core.ExploreController
import ai.openeyes.glasses.core.FindController
import ai.openeyes.glasses.core.ReadController
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

enum class Screen { HOME, EXPLORE, FIND, READ, ASK }

class MainViewModel(app: Application) : AndroidViewModel(app) {

    private val backendConfig = BackendConfig(BuildConfig.OPENEYES_FUNCTION_URL, BuildConfig.OPENEYES_PUBLIC_KEY)
    val backendConfigured: Boolean = backendConfig.isComplete

    val glasses = WearablesController(app, viewModelScope)
    val speaker = AndroidSpeaker(app)
    private val listener = QuestionListener(app)
    private val client = OpenEyesClient(backendConfig, UrlConnectionTransport(), log = AndroidDiagnosticLog)
    val coordinator = CameraModeCoordinator(glasses, speaker, viewModelScope)

    val assistant = SceneAssistant(glasses, client, speaker, viewModelScope, AndroidDiagnosticLog)
    val explore = ExploreController(glasses, client, speaker, coordinator, log = AndroidDiagnosticLog)
    val find = FindController(glasses, client, speaker, coordinator, log = AndroidDiagnosticLog)
    val read = ReadController(glasses, client, speaker, coordinator, viewModelScope, AndroidDiagnosticLog)
    val conversation = ConversationController(client, speaker, viewModelScope, AndroidDiagnosticLog)

    private val _screen = MutableStateFlow(Screen.HOME)
    val screen: StateFlow<Screen> = _screen.asStateFlow()

    private val _aiReadiness = MutableStateFlow(AiReadiness.CHECKING)
    val aiReadiness: StateFlow<AiReadiness> = _aiReadiness.asStateFlow()

    private val _listening = MutableStateFlow(false)
    val listening: StateFlow<Boolean> = _listening.asStateFlow()

    private val _announcements = Channel<String>(Channel.CONFLATED)
    /** Connection changes worth saying out loud; the screen decides whether TalkBack already covers them. */
    val announcements = _announcements.receiveAsFlow()

    init {
        AndroidDiagnosticLog.log(
            "config: server=${backendConfig.functionUrl.ifEmpty { "MISSING" }} publicKey=${if (backendConfig.publicKey.isBlank()) "MISSING" else "present"}",
        )
        checkAi()
        viewModelScope.launch {
            var previous = glasses.status.value
            glasses.status.collect { current ->
                StatusText.announcement(previous, current)?.let { _announcements.trySend(it) }
                if (StatusText.endsCameraModes(previous, current)) stopCameraModes()
                previous = current
            }
        }
    }

    fun checkAi() {
        _aiReadiness.value = AiReadiness.CHECKING
        viewModelScope.launch { _aiReadiness.value = client.checkReady() }
    }

    fun open(screen: Screen) {
        if (screen == _screen.value) return
        leave(_screen.value)
        _screen.value = screen
    }

    /** Returns false on the home screen so the system handles Back. */
    fun back(): Boolean {
        if (_screen.value == Screen.HOME) return false
        open(Screen.HOME)
        return true
    }

    private fun leave(screen: Screen) {
        cancelListening()
        when (screen) {
            Screen.HOME -> stopLook()
            Screen.EXPLORE -> explore.stop()
            Screen.FIND -> find.stop()
            Screen.READ -> read.clear(announce = false)
            Screen.ASK -> conversation.cancel()
        }
    }

    fun speakStatus(text: String) = speaker.speak(text, SpeechKind.STATUS)

    fun refreshPermissions() {
        viewModelScope.launch { glasses.refreshCameraPermission() }
    }

    fun whatAmILookingAt() {
        cancelListening()
        look(null)
    }

    private fun look(question: String?) {
        if (coordinator.active.value == CameraMode.LOOK || assistant.phase.value != AssistantPhase.IDLE) {
            speaker.speak(AssistantMessages.BUSY, SpeechKind.STATUS)
            return
        }
        coordinator.start(CameraMode.LOOK) { assistant.answer(question) }
    }

    /** Main thread only. One spoken question, then the same photo-and-answer flow as the look button. */
    fun askByVoice() {
        if (assistant.phase.value != AssistantPhase.IDLE) {
            speaker.speak(AssistantMessages.BUSY, SpeechKind.STATUS)
            return
        }
        listen(::look)
    }

    /**
     * Main thread only. Shared by every screen: stops speech first so OpenEyes does not hear itself, then hands
     * the recognised words to [onHeard]. Recognition errors are spoken here.
     */
    fun listen(onHeard: (String) -> Unit) {
        if (_listening.value) return
        speaker.stop()
        _listening.value = true
        listener.listen { result ->
            _listening.value = false
            when (result) {
                is ListenResult.Heard -> onHeard(result.text)
                ListenResult.NothingHeard -> speaker.speak(NOTHING_HEARD, SpeechKind.ERROR)
                ListenResult.NotAllowed -> speaker.speak(MIC_NOT_ALLOWED, SpeechKind.ERROR)
                ListenResult.Unavailable -> speaker.speak(NO_RECOGNIZER, SpeechKind.ERROR)
                is ListenResult.Failed -> speaker.speak(LISTEN_FAILED, SpeechKind.ERROR)
            }
        }
    }

    fun cancelListening() {
        listener.cancel()
        _listening.value = false
    }

    fun micPermissionDenied() = speaker.speak(MIC_NOT_ALLOWED, SpeechKind.ERROR)

    private fun stopLook() {
        coordinator.stop(CameraMode.LOOK)
        assistant.cancel()
    }

    /** Ends whichever camera feature runs and turns the glasses camera off. Text features are untouched. */
    fun stopCameraModes() {
        when (coordinator.active.value) {
            CameraMode.EXPLORE -> explore.stop()
            CameraMode.FIND -> find.stop()
            CameraMode.READ -> read.stop()
            CameraMode.LOOK -> stopLook()
            null -> glasses.releaseCamera()
        }
    }

    /** The app went to the background: the camera must not keep running unseen. */
    fun onBackground() {
        cancelListening()
        stopCameraModes()
    }

    fun stopEverything() {
        cancelListening()
        stopCameraModes()
        assistant.cancel()
        conversation.cancel()
        speaker.stop()
    }

    override fun onCleared() {
        stopEverything()
        glasses.disconnect()
        speaker.shutdown()
    }

    private companion object {
        const val NOTHING_HEARD = "I did not hear anything. Press the microphone button and try again."
        const val MIC_NOT_ALLOWED = "OpenEyes needs microphone permission to hear you. You can allow it in Android settings."
        const val NO_RECOGNIZER = "Speech recognition is not available on this phone. Type instead."
        const val LISTEN_FAILED = "I could not listen just now. Please try again."
    }
}
