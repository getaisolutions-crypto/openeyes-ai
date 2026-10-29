package ai.openeyes.glasses.voice

import ai.openeyes.glasses.core.SpeechKind
import ai.openeyes.glasses.core.Speaker
import android.content.Context
import android.media.AudioAttributes
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import java.util.UUID

/**
 * Speaks through the phone's normal audio output. When the glasses are the active Bluetooth audio device, Android
 * plays this through the glasses speakers; otherwise it uses the phone speaker. The toolkit itself has no speech
 * output API.
 */
class AndroidSpeaker(context: Context) : Speaker {
    private var ready = false
    private var pending: Triple<String, SpeechKind, Boolean>? = null
    private val inFlight = mutableSetOf<String>()

    private val _speaking = MutableStateFlow(false)
    val speaking: StateFlow<Boolean> = _speaking.asStateFlow()

    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        ready = status == TextToSpeech.SUCCESS
        if (ready) {
            configure()
            pending?.let { (text, kind, slow) -> speak(text, kind, slow) }
        }
        pending = null
        if (!ready) _speaking.value = false
    }

    private fun configure() {
        tts.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
        )
        if (tts.isLanguageAvailable(Locale.getDefault()) >= TextToSpeech.LANG_AVAILABLE) tts.language = Locale.getDefault()
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String) = Unit
            override fun onDone(utteranceId: String) = finished(utteranceId)
            override fun onStop(utteranceId: String, interrupted: Boolean) = finished(utteranceId)

            @Deprecated("Required override on older API levels")
            override fun onError(utteranceId: String) = finished(utteranceId)
            override fun onError(utteranceId: String, errorCode: Int) = finished(utteranceId)
        })
    }

    private fun finished(id: String) {
        synchronized(inFlight) {
            inFlight.remove(id)
            _speaking.value = inFlight.isNotEmpty()
        }
    }

    override fun speak(text: String, kind: SpeechKind, slow: Boolean) {
        if (text.isBlank()) return
        if (!ready) {
            pending = Triple(text, kind, slow)
            _speaking.value = true
            return
        }
        // Status cues queue behind each other; answers and errors replace whatever is playing.
        val mode = if (kind == SpeechKind.STATUS) TextToSpeech.QUEUE_ADD else TextToSpeech.QUEUE_FLUSH
        val id = UUID.randomUUID().toString()
        synchronized(inFlight) {
            if (mode == TextToSpeech.QUEUE_FLUSH) inFlight.clear()
            inFlight += id
            _speaking.value = true
        }
        tts.setSpeechRate(if (slow) SLOW_RATE else 1.0f)
        if (tts.speak(text, mode, null, id) != TextToSpeech.SUCCESS) finished(id)
    }

    override fun stop() {
        pending = null
        synchronized(inFlight) {
            inFlight.clear()
            _speaking.value = false
        }
        if (ready) tts.stop()
    }

    override suspend fun awaitSilence() {
        // Bounded so a lost engine callback can never stall a feature loop.
        withTimeoutOrNull(MAX_WAIT_MS) { speaking.first { !it } }
    }

    fun shutdown() {
        stop()
        tts.shutdown()
    }

    private companion object {
        const val SLOW_RATE = 0.7f
        const val MAX_WAIT_MS = 60_000L
    }
}
