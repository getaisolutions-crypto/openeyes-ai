package ai.openeyes.glasses.ui

import ai.openeyes.glasses.MainViewModel
import ai.openeyes.glasses.R
import ai.openeyes.glasses.Screen
import ai.openeyes.glasses.core.ChatMessage
import ai.openeyes.glasses.core.ChatRole
import android.util.TypedValue
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

class AskScreen(root: View, private val vm: MainViewModel, private val host: ScreenHost) {
    private val status: TextView = root.findViewById(R.id.ask_status)
    private val error: TextView = root.findViewById(R.id.ask_error)
    private val scroll: ScrollView = root.findViewById(R.id.ask_scroll)
    private val list: LinearLayout = root.findViewById(R.id.ask_messages)
    private val placeholder: View = root.findViewById(R.id.ask_placeholder)
    private val input: EditText = root.findViewById(R.id.ask_input)
    private val mic: Button = root.findViewById(R.id.ask_mic)
    private val send: Button = root.findViewById(R.id.ask_send)
    private var shown: List<ChatMessage> = emptyList()

    init {
        val chat = vm.conversation
        root.findViewById<View>(R.id.ask_back).setOnClickListener { vm.open(Screen.HOME) }
        send.setOnClickListener { sendTyped() }
        input.onSubmit(::sendTyped)
        mic.setOnClickListener { host.withMicrophone { vm.listen { chat.send(it) } } }
        root.findViewById<View>(R.id.ask_stop_speaking).setOnClickListener { chat.stopSpeaking() }
        root.findViewById<View>(R.id.ask_repeat).setOnClickListener { chat.repeat() }
        root.findViewById<View>(R.id.ask_new).setOnClickListener {
            input.text.clear()
            chat.newConversation()
        }
    }

    private fun sendTyped() {
        if (vm.conversation.send(input.text.toString())) input.text.clear()
    }

    fun observe(scope: CoroutineScope) {
        scope.launch {
            combine(vm.conversation.state, vm.listening, vm.speaker.speaking) { s, listening, speaking -> Triple(s, listening, speaking) }
                .collect { (s, listening, speaking) ->
                    val ctx = status.context
                    val phase = when {
                        listening -> R.string.state_listening
                        s.thinking -> R.string.state_analyzing
                        speaking -> R.string.state_speaking
                        else -> R.string.state_idle
                    }
                    status.setIfChanged(ctx.getString(R.string.status_label, ctx.getString(phase)))
                    error.showMessage(s.error)
                    if (s.messages != shown) showMessages(s.messages)
                    send.isEnabled = !s.thinking
                    mic.setText(if (listening) R.string.mic_listening else R.string.mic)
                    mic.isEnabled = !listening && !s.thinking
                }
        }
    }

    private fun showMessages(messages: List<ChatMessage>) {
        shown = messages
        list.removeAllViews()
        placeholder.visibility = if (messages.isEmpty()) View.VISIBLE else View.GONE
        list.addView(placeholder)
        val ctx = list.context
        val gap = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 8f, ctx.resources.displayMetrics).toInt()
        messages.forEach { m ->
            val who = ctx.getString(if (m.role == ChatRole.USER) R.string.ask_you else R.string.ask_ai)
            // Who said it is written out, so the conversation never relies on colour or position alone.
            val label = if (m.failed) "$who (${ctx.getString(R.string.ask_failed)})" else who
            list.addView(
                TextView(ctx).apply {
                    text = "$label: ${m.text}"
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
                    setLineSpacing(0f, 1.4f)
                    setTextIsSelectable(true)
                    setPadding(gap * 2, gap * 2, gap * 2, gap * 2)
                    setTextColor(ContextCompat.getColor(ctx, R.color.on_surface))
                    setBackgroundColor(ContextCompat.getColor(ctx, if (m.role == ChatRole.USER) R.color.secondary else R.color.surface))
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                    ).apply { topMargin = gap }
                },
            )
        }
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }
}
