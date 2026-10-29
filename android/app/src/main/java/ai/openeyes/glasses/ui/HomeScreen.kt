package ai.openeyes.glasses.ui

import ai.openeyes.glasses.MainViewModel
import ai.openeyes.glasses.R
import ai.openeyes.glasses.Screen
import ai.openeyes.glasses.backend.AiReadiness
import ai.openeyes.glasses.core.AssistantPhase
import ai.openeyes.glasses.core.GlassesStatus
import ai.openeyes.glasses.core.Registration
import ai.openeyes.glasses.core.SessionPhase
import ai.openeyes.glasses.core.StatusText
import android.app.Activity
import android.view.View
import android.widget.Button
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/** Home: the three status lines, the four features, the quick look and the glasses setup buttons. */
class HomeScreen(
    private val root: View,
    private val activity: Activity,
    private val vm: MainViewModel,
    private val host: ScreenHost,
    private val onAllowCamera: () -> Unit,
) {
    private val glassesLine: TextView = root.findViewById(R.id.glasses_line)
    private val cameraLine: TextView = root.findViewById(R.id.camera_line)
    private val aiLine: TextView = root.findViewById(R.id.ai_line)
    private val aiRetry: Button = root.findViewById(R.id.ai_retry_button)
    private val connectionText: TextView = root.findViewById(R.id.connection_status)
    private val cameraText: TextView = root.findViewById(R.id.camera_status)
    private val sessionText: TextView = root.findViewById(R.id.session_status)
    private val answerText: TextView = root.findViewById(R.id.answer_text)
    private val errorText: TextView = root.findViewById(R.id.error_text)
    private val registerButton: Button = root.findViewById(R.id.register_button)
    private val permissionButton: Button = root.findViewById(R.id.permission_button)
    private val connectButton: Button = root.findViewById(R.id.connect_button)
    private val lookButton: Button = root.findViewById(R.id.look_button)
    private val askButton: Button = root.findViewById(R.id.ask_button)

    init {
        root.findViewById<View>(R.id.setup_notice).visibility = if (vm.backendConfigured) View.GONE else View.VISIBLE
        root.findViewById<View>(R.id.explore_button).setOnClickListener { vm.open(Screen.EXPLORE) }
        root.findViewById<View>(R.id.find_button).setOnClickListener { vm.open(Screen.FIND) }
        root.findViewById<View>(R.id.read_button).setOnClickListener { vm.open(Screen.READ) }
        root.findViewById<View>(R.id.ask_openeyes_button).setOnClickListener { vm.open(Screen.ASK) }
        aiRetry.setOnClickListener { vm.checkAi() }

        registerButton.setOnClickListener {
            if (vm.glasses.status.value.registration == Registration.REGISTERED) vm.glasses.unregister(activity)
            else vm.glasses.register(activity)
        }
        permissionButton.setOnClickListener { onAllowCamera() }
        connectButton.setOnClickListener {
            val status = vm.glasses.status.value
            if (status.session == SessionPhase.NONE || status.session == SessionPhase.STOPPED) {
                vm.glasses.connect()
            } else {
                vm.stopEverything()
                vm.glasses.disconnect()
            }
        }
        lookButton.setOnClickListener { vm.whatAmILookingAt() }
        askButton.setOnClickListener { host.withMicrophone { vm.askByVoice() } }
        root.findViewById<View>(R.id.stop_button).setOnClickListener { vm.stopEverything() }
    }

    private data class Snapshot(
        val status: GlassesStatus,
        val phase: AssistantPhase,
        val listening: Boolean,
        val answer: String?,
        val ai: AiReadiness,
    )

    fun observe(scope: CoroutineScope) {
        scope.launch {
            combine(vm.glasses.status, vm.assistant.phase, vm.listening, vm.assistant.lastAnswer, vm.aiReadiness) { status, phase, listening, answer, ai ->
                Snapshot(status, phase, listening, answer, ai)
            }.collect(::render)
        }
    }

    private fun render(s: Snapshot) {
        val status = s.status
        val ctx = root.context
        glassesLine.setIfChanged(ctx.getString(R.string.glasses_line, StatusText.connection(status)))
        cameraLine.setIfChanged(ctx.getString(R.string.camera_line, StatusText.camera(status)))
        aiLine.setIfChanged(ctx.getString(R.string.ai_line, ctx.getString(aiText(s.ai))))
        aiRetry.visibility = if (s.ai == AiReadiness.UNREACHABLE) View.VISIBLE else View.GONE

        connectionText.setIfChanged(StatusText.connection(status))
        cameraText.setIfChanged(StatusText.camera(status))
        sessionText.setIfChanged(StatusText.session(status))
        answerText.setIfChanged(s.answer ?: ctx.getString(R.string.answer_placeholder))
        errorText.showMessage(status.error?.let { ctx.getString(R.string.glasses_error, it) })

        registerButton.isEnabled = status.sdkReady
        registerButton.setText(if (status.registration == Registration.REGISTERED) R.string.unregister else R.string.register)
        permissionButton.isEnabled = status.registration == Registration.REGISTERED

        val idle = status.session == SessionPhase.NONE || status.session == SessionPhase.STOPPED
        connectButton.isEnabled = if (idle) status.canStartSession else true
        connectButton.setText(
            when {
                status.connected -> R.string.disconnect
                idle -> R.string.connect
                else -> R.string.cancel_connect
            },
        )

        val busy = s.phase != AssistantPhase.IDLE || s.listening
        lookButton.setText(
            when (s.phase) {
                AssistantPhase.CAPTURING -> R.string.taking_photo
                AssistantPhase.ANALYZING -> R.string.thinking
                AssistantPhase.IDLE -> R.string.look
            },
        )
        askButton.setText(if (s.listening) R.string.listening else R.string.ask)
        lookButton.isEnabled = !busy
        askButton.isEnabled = !busy
    }

    private fun aiText(ai: AiReadiness): Int = when (ai) {
        AiReadiness.CHECKING -> R.string.ai_checking
        AiReadiness.READY -> R.string.ai_ready
        AiReadiness.APP_NOT_CONFIGURED -> R.string.ai_app_not_configured
        AiReadiness.SERVER_NOT_CONFIGURED -> R.string.ai_server_not_configured
        AiReadiness.UNREACHABLE -> R.string.ai_unreachable
    }
}
