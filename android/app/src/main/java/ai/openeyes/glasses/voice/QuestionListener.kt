package ai.openeyes.glasses.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

sealed interface ListenResult {
    data class Heard(val text: String) : ListenResult
    data object NothingHeard : ListenResult
    data object NotAllowed : ListenResult
    data object Unavailable : ListenResult
    data class Failed(val code: Int) : ListenResult
}

/**
 * Listens for one spoken question with Android speech recognition, then stops. It uses whichever microphone
 * Android picks; that may be the phone microphone rather than the glasses.
 */
class QuestionListener(private val context: Context) {
    private var recognizer: SpeechRecognizer? = null

    val isAvailable: Boolean get() = SpeechRecognizer.isRecognitionAvailable(context)

    /** Must be called on the main thread. [onResult] is called exactly once per listen. */
    fun listen(onResult: (ListenResult) -> Unit) {
        cancel()
        if (!isAvailable) {
            onResult(ListenResult.Unavailable)
            return
        }
        val rec = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = rec
        var delivered = false
        fun deliver(result: ListenResult) {
            if (delivered) return
            delivered = true
            if (recognizer === rec) recognizer = null
            rec.destroy()
            onResult(result)
        }
        rec.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim()
                deliver(if (text.isNullOrEmpty()) ListenResult.NothingHeard else ListenResult.Heard(text))
            }

            override fun onError(error: Int) {
                deliver(
                    when (error) {
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> ListenResult.NothingHeard
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> ListenResult.NotAllowed
                        else -> ListenResult.Failed(error)
                    },
                )
            }

            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onPartialResults(partialResults: Bundle?) = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })
        rec.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false),
        )
    }

    fun cancel() {
        recognizer?.let {
            recognizer = null
            it.cancel()
            it.destroy()
        }
    }
}
