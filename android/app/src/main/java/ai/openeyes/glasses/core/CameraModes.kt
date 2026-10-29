package ai.openeyes.glasses.core

import ai.openeyes.glasses.backend.BackendErrorKind
import ai.openeyes.glasses.backend.BackendException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class CameraMode { LOOK, EXPLORE, FIND, READ }

/**
 * The one place that decides which camera feature runs. Starting a mode cancels the previous one first (its
 * outstanding AI request is discarded), so two features never capture or speak at the same time. The camera stream
 * is handed over between modes and turned off when a mode is stopped or ends.
 */
class CameraModeCoordinator(
    private val glasses: GlassesPort,
    private val speaker: Speaker,
    private val scope: CoroutineScope,
) {
    private val _active = MutableStateFlow<CameraMode?>(null)
    val active: StateFlow<CameraMode?> = _active.asStateFlow()

    private var job: Job? = null
    private var generation = 0

    fun start(mode: CameraMode, block: suspend () -> Unit): Job {
        val gen = ++generation
        val previous = job
        previous?.cancel()
        speaker.stop()
        _active.value = mode
        val started = scope.launch {
            previous?.join()
            try {
                block()
            } finally {
                if (gen == generation) {
                    _active.value = null
                    glasses.releaseCamera()
                }
            }
        }
        job = started
        return started
    }

    /** Stops [mode], or whatever is running when [mode] is null. Turns the camera off immediately. */
    fun stop(mode: CameraMode? = null) {
        if (mode != null && _active.value != mode) return
        generation++
        job?.cancel()
        job = null
        _active.value = null
        speaker.stop()
        glasses.releaseCamera()
    }
}

/** Counts consecutive failures so a loop can give up instead of retrying forever. */
class FailureTracker(private val limit: Int = 3) {
    var consecutive = 0
        private set

    fun success() {
        consecutive = 0
    }

    /** Returns true when the limit is reached and the mode should stop. */
    fun failed(): Boolean = ++consecutive >= limit
}

object ModeErrors {
    /** Problems retrying cannot fix; the mode stops and says what to do. */
    fun isFatal(reason: CaptureFailure): Boolean =
        reason == CaptureFailure.NOT_CONNECTED || reason == CaptureFailure.PERMISSION_DENIED

    fun isFatal(kind: BackendErrorKind): Boolean =
        kind == BackendErrorKind.APP_NOT_CONFIGURED || kind == BackendErrorKind.NOT_CONFIGURED || kind == BackendErrorKind.AUTH

    fun message(e: Exception): String =
        if (e is BackendException) AssistantMessages.forBackend(e.kind) else AssistantMessages.forBackend(BackendErrorKind.SERVER)

    /** Wait before the next attempt; honours the server's retry hint when rate limited. */
    fun backoffMs(e: Exception, attempt: Int): Long {
        val retry = (e as? BackendException)?.retryAfterSeconds
        if (retry != null && retry > 0) return retry.coerceAtMost(60) * 1000L
        return (2_000L * attempt).coerceAtMost(10_000L)
    }
}

object TextSimilarity {
    private val stopWords = setOf("a", "an", "the", "is", "are", "of", "on", "in", "to", "and", "with", "there", "i", "can", "see", "it", "this", "image", "photo", "shows", "current")

    private fun words(text: String): Set<String> =
        text.lowercase().split(Regex("[^a-z0-9']+")).filter { it.length > 1 && it !in stopWords }.toSet()

    /** Jaccard similarity of content words, 0 (unrelated) to 1 (same words). */
    fun of(a: String?, b: String?): Double {
        if (a.isNullOrBlank() || b.isNullOrBlank()) return 0.0
        val x = words(a)
        val y = words(b)
        if (x.isEmpty() && y.isEmpty()) return 1.0
        return x.intersect(y).size.toDouble() / x.union(y).size
    }
}

/** Last line of defence against wording the server is already told never to use. */
object SafetyFilter {
    private val unsafe = Regex(
        """\b(path|way|road|street|route|area|crossing|stairs) (is|looks|seems|appears) (clear|safe|free)\b|\bno obstacles\b|\bsafe to (walk|cross|go|move)\b|\bit'?s safe\b""",
        RegexOption.IGNORE_CASE,
    )
    const val CAUTION = "I cannot judge whether it is safe to move. Keep using your cane, guide dog or usual mobility skills."

    /** Removes sentences that claim something is safe or clear, and leads with the caution instead. */
    fun apply(text: String): String {
        if (!unsafe.containsMatchIn(text)) return text
        val kept = text.split(Regex("(?<=[.!?])\\s+")).filterNot { unsafe.containsMatchIn(it) }.joinToString(" ").trim()
        return if (kept.isEmpty()) CAUTION else "$CAUTION $kept"
    }
}
