package ai.openeyes.glasses.ui

import ai.openeyes.glasses.MainViewModel
import ai.openeyes.glasses.R
import ai.openeyes.glasses.Screen
import ai.openeyes.glasses.core.ExplorePhase
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

class ExploreScreen(root: View, private val vm: MainViewModel, private val host: ScreenHost) {
    private val status: TextView = root.findViewById(R.id.explore_status)
    private val error: TextView = root.findViewById(R.id.explore_error)
    private val toggle: Button = root.findViewById(R.id.explore_toggle)
    private val latest: TextView = root.findViewById(R.id.explore_latest)
    private val question: EditText = root.findViewById(R.id.explore_question)
    private val mic: Button = root.findViewById(R.id.explore_mic)
    private val send: Button = root.findViewById(R.id.explore_send)
    private val placeholder = root.context.getString(R.string.explore_placeholder)

    init {
        root.findViewById<View>(R.id.explore_back).setOnClickListener { vm.open(Screen.HOME) }
        toggle.setOnClickListener { if (vm.explore.state.value.running) vm.explore.stop() else vm.explore.start() }
        root.findViewById<View>(R.id.explore_stop_speaking).setOnClickListener { vm.speaker.stop() }
        send.setOnClickListener { sendTyped() }
        question.onSubmit(::sendTyped)
        mic.setOnClickListener { host.withMicrophone { vm.listen { vm.explore.ask(it) } } }
    }

    private fun sendTyped() {
        if (vm.explore.ask(question.text.toString())) question.text.clear()
    }

    fun observe(scope: CoroutineScope) {
        scope.launch {
            combine(vm.explore.state, vm.listening) { s, listening -> s to listening }.collect { (s, listening) ->
                val ctx = status.context
                val phase = when {
                    listening -> R.string.state_listening
                    else -> when (s.phase) {
                        ExplorePhase.IDLE -> R.string.state_idle
                        ExplorePhase.LOOKING -> R.string.state_looking
                        ExplorePhase.ANALYZING -> R.string.state_analyzing
                        ExplorePhase.ANSWERING -> R.string.state_answering
                        ExplorePhase.WAITING -> R.string.state_waiting
                    }
                }
                status.setIfChanged(ctx.getString(R.string.status_label, ctx.getString(phase)))
                error.showMessage(s.error)
                latest.setIfChanged(s.latest ?: placeholder)
                toggle.setText(if (s.running) R.string.explore_stop else R.string.explore_start)
                mic.setText(if (listening) R.string.mic_listening else R.string.mic)
                mic.isEnabled = s.running && !listening
                send.isEnabled = s.running
                question.isEnabled = s.running
            }
        }
    }
}
