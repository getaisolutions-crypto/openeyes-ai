package ai.openeyes.glasses.ui

import ai.openeyes.glasses.MainViewModel
import ai.openeyes.glasses.R
import ai.openeyes.glasses.Screen
import ai.openeyes.glasses.core.FindPhase
import ai.openeyes.glasses.core.FindVerdict
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

class FindScreen(root: View, private val vm: MainViewModel, private val host: ScreenHost) {
    private val status: TextView = root.findViewById(R.id.find_status)
    private val error: TextView = root.findViewById(R.id.find_error)
    private val input: EditText = root.findViewById(R.id.find_input)
    private val mic: Button = root.findViewById(R.id.find_mic)
    private val target: TextView = root.findViewById(R.id.find_target)
    private val toggle: Button = root.findViewById(R.id.find_toggle)
    private val verdict: TextView = root.findViewById(R.id.find_verdict)
    private val result: TextView = root.findViewById(R.id.find_result)
    private val placeholder = root.context.getString(R.string.find_placeholder)

    init {
        root.findViewById<View>(R.id.find_back).setOnClickListener { vm.open(Screen.HOME) }
        root.findViewById<View>(R.id.find_stop_speaking).setOnClickListener { vm.speaker.stop() }
        toggle.setOnClickListener { if (vm.find.state.value.searching) vm.find.stop() else start(input.text.toString()) }
        input.onSubmit { start(input.text.toString()) }
        mic.setOnClickListener {
            host.withMicrophone {
                vm.listen { heard ->
                    input.setText(heard)
                    start(heard)
                }
            }
        }
    }

    private fun start(name: String) {
        if (!vm.find.state.value.searching) vm.find.start(name)
    }

    fun observe(scope: CoroutineScope) {
        scope.launch {
            combine(vm.find.state, vm.listening) { s, listening -> s to listening }.collect { (s, listening) ->
                val ctx = status.context
                val phase = when {
                    listening -> R.string.state_listening
                    else -> when (s.phase) {
                        FindPhase.IDLE -> R.string.state_idle
                        FindPhase.LOOKING -> R.string.state_looking
                        FindPhase.ANALYZING -> R.string.state_analyzing
                        FindPhase.WAITING -> R.string.state_searching_wait
                    }
                }
                status.setIfChanged(ctx.getString(R.string.status_label, ctx.getString(phase)))
                error.showMessage(s.error)
                target.showMessage(s.target?.let { ctx.getString(R.string.find_target, it) })
                // The verdict is spelled out in words, never shown by colour alone.
                verdict.showMessage(
                    s.report?.let {
                        ctx.getString(
                            when (it.verdict) {
                                FindVerdict.FOUND -> R.string.find_found
                                FindVerdict.POSSIBLY -> R.string.find_possibly
                                FindVerdict.NOT_DETECTED -> R.string.find_not_detected
                            },
                        )
                    },
                )
                result.setIfChanged(s.report?.message ?: placeholder)
                toggle.setText(if (s.searching) R.string.find_stop else R.string.find_start)
                input.isEnabled = !s.searching
                mic.setText(if (listening) R.string.mic_listening else R.string.mic)
                mic.isEnabled = !s.searching && !listening
            }
        }
    }
}
