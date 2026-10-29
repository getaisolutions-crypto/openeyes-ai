package ai.openeyes.glasses.voice

import ai.openeyes.glasses.core.SpeechKind
import ai.openeyes.glasses.core.Speaker
import android.content.Context
import android.media.AudioAttributes
import android.speech.tts.TextToSpeech
import java.util.Locale
import java.util.UUID

/**
 * Speaks through the phone's normal audio output. When the glasses are the active Bluetooth audio device, Android
 * plays this through the glasses speakers; the toolkit itself has no speech output API.
 */
class AndroidSpeaker(context: Context) : Speaker {
    private var ready = false
    private var pending: Pair<String, SpeechKind>? = null

    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        ready = status == TextToSpeech.SUCCESS
        if (ready) {
            configure()
            pending?.let { (text, kind) -> speak(text, kind) }
        }
        pending = null
    }

    private fun configure() {
        tts.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
        )
        if (tts.isLanguageAvailable(Locale.getDefault()) >= TextToSpeech.LANG_AVAILABLE) tts.language = Locale.getDefault()
    }

    override fun speak(text: String, kind: SpeechKind) {
        if (text.isBlank()) return
        if (!ready) {
            pending = text to kind
            return
        }
        // Status cues queue behind each other; answers and errors replace whatever is playing.
        val mode = if (kind == SpeechKind.STATUS) TextToSpeech.QUEUE_ADD else TextToSpeech.QUEUE_FLUSH
        tts.speak(text, mode, null, UUID.randomUUID().toString())
    }

    override fun stop() {
        pending = null
        if (ready) tts.stop()
    }

    fun shutdown() {
        stop()
        tts.shutdown()
    }
}
