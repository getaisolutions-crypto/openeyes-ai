package ai.openeyes.glasses.ui

import ai.openeyes.glasses.MainViewModel
import ai.openeyes.glasses.R
import ai.openeyes.glasses.Screen
import ai.openeyes.glasses.core.ReadFollowUp
import ai.openeyes.glasses.core.ReadPhase
import ai.openeyes.glasses.core.ReadRequest
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

class ReadScreen(root: View, private val vm: MainViewModel, private val host: ScreenHost) {
    private val status: TextView = root.findViewById(R.id.read_status)
    private val error: TextView = root.findViewById(R.id.read_error)
    private val capture: Button = root.findViewById(R.id.read_capture)
    private val text: TextView = root.findViewById(R.id.read_text)
    private val unreadable: View = root.findViewById(R.id.read_unreadable)
    private val actions: View = root.findViewById(R.id.read_actions)
    private val language: EditText = root.findViewById(R.id.read_language)
    private val question: EditText = root.findViewById(R.id.read_question)
    private val mic: Button = root.findViewById(R.id.read_mic)
    private val aiHeading: View = root.findViewById(R.id.read_ai_heading)
    private val aiText: TextView = root.findViewById(R.id.read_ai_text)
    private val aiButtons: List<View> = listOf(
        R.id.read_summarize, R.id.read_explain, R.id.read_important, R.id.read_translate, R.id.read_ask,
    ).map { root.findViewById<View>(it) }
    private val placeholder = root.context.getString(R.string.read_placeholder)

    init {
        val read = vm.read
        root.findViewById<View>(R.id.read_back).setOnClickListener { vm.open(Screen.HOME) }
        capture.setOnClickListener { read.read() }
        root.findViewById<View>(R.id.read_stop).setOnClickListener { read.stop() }
        root.findViewById<View>(R.id.read_repeat).setOnClickListener { read.request(ReadRequest.Repeat) }
        root.findViewById<View>(R.id.read_slower).setOnClickListener { read.request(ReadRequest.Slower) }
        root.findViewById<View>(R.id.read_summarize).setOnClickListener { read.request(ReadRequest.Summarize) }
        root.findViewById<View>(R.id.read_explain).setOnClickListener { read.request(ReadRequest.Explain) }
        root.findViewById<View>(R.id.read_important).setOnClickListener { read.request(ReadRequest.Important) }
        root.findViewById<View>(R.id.read_translate).setOnClickListener {
            val lang = language.text.toString().trim().ifEmpty { ReadFollowUp.DEFAULT_LANGUAGE }
            read.request(ReadRequest.Translate(lang))
        }
        root.findViewById<View>(R.id.read_ask).setOnClickListener { askTyped() }
        question.onSubmit(::askTyped)
        mic.setOnClickListener { host.withMicrophone { vm.listen { read.request(it) } } }
        root.findViewById<View>(R.id.read_clear).setOnClickListener {
            question.text.clear()
            read.clear()
        }
    }

    private fun askTyped() {
        val q = question.text.toString().trim()
        if (q.isEmpty()) return
        vm.read.request(q)
        question.text.clear()
    }

    fun observe(scope: CoroutineScope) {
        scope.launch {
            combine(vm.read.state, vm.listening) { s, listening -> s to listening }.collect { (s, listening) ->
                val ctx = status.context
                val phase = when {
                    listening -> R.string.state_listening
                    else -> when (s.phase) {
                        ReadPhase.IDLE -> R.string.state_idle
                        ReadPhase.LOOKING -> R.string.state_looking
                        ReadPhase.READING -> R.string.state_reading
                        ReadPhase.THINKING -> R.string.state_thinking
                    }
                }
                status.setIfChanged(ctx.getString(R.string.status_label, ctx.getString(phase)))
                error.showMessage(s.error)
                val hasText = s.transcription != null
                text.setIfChanged(s.transcription ?: placeholder)
                unreadable.visibility = if (s.hasUnreadableParts) View.VISIBLE else View.GONE
                actions.visibility = if (hasText) View.VISIBLE else View.GONE
                capture.setText(if (hasText) R.string.read_again_capture else R.string.read_capture)
                capture.isEnabled = !s.busy
                aiButtons.forEach { it.isEnabled = !s.busy }
                val aside = s.aside
                aiHeading.visibility = if (aside == null) View.GONE else View.VISIBLE
                aiText.visibility = aiHeading.visibility
                aiText.setIfChanged(aside?.let { "${it.kind.label}: ${it.text}" }.orEmpty())
                mic.setText(if (listening) R.string.mic_listening else R.string.mic)
                mic.isEnabled = !listening && !s.busy
            }
        }
    }
}
