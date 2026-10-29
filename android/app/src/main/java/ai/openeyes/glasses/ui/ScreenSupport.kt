package ai.openeyes.glasses.ui

import android.view.View
import android.widget.EditText
import android.widget.TextView

/** What a screen needs from the activity that hosts it. */
interface ScreenHost {
    /** Runs [action] once the microphone permission is granted; asks for it first when needed. */
    fun withMicrophone(action: () -> Unit)
}

/** Avoids re-setting identical text, which would make TalkBack re-announce live regions. */
fun TextView.setIfChanged(text: String) {
    if (this.text.toString() != text) this.text = text
}

fun TextView.showMessage(message: String?) {
    visibility = if (message.isNullOrBlank()) View.GONE else View.VISIBLE
    setIfChanged(message.orEmpty())
}

/** Calls [onSubmit] for the keyboard's send, search or done key. */
fun EditText.onSubmit(onSubmit: () -> Unit) {
    setOnEditorActionListener { _, _, _ ->
        onSubmit()
        true
    }
}
