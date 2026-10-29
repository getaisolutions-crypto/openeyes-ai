package ai.openeyes.glasses.core

import ai.openeyes.glasses.backend.BackendException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withTimeoutOrNull

enum class ExplorePhase { IDLE, LOOKING, ANALYZING, ANSWERING, WAITING }

data class ExploreState(
    val phase: ExplorePhase = ExplorePhase.IDLE,
    val latest: String? = null,
    val error: String? = null,
) {
    val running: Boolean get() = phase != ExplorePhase.IDLE
}

/**
 * Pacing between photos. The interval grows while nothing changes and resets on a change. It stays below the
 * glasses controller's camera idle timeout so the stream is reused, and, with the AI round trip, keeps a continuous
 * session well inside the server's request quota (90 requests per 10 minutes).
 */
data class ExploreTiming(
    val baseIntervalMs: Long = 8_000,
    val stepMs: Long = 4_000,
    val maxIntervalMs: Long = 16_000,
    val busyRetryMs: Long = 1_000,
)

object ExploreMessages {
    const val STARTED =
        "Explore started. I will describe what is around you and mention changes. I cannot tell you whether it is safe to move."
    const val STOPPED = "Explore stopped."
    const val UNSURE = "I'm not certain, but "
    const val GAVE_UP = "Explore stopped because the glasses camera kept failing. Check the glasses and start again."
    const val AI_GAVE_UP = "Explore stopped because Meta AI kept failing. Please try again in a moment."
}

/**
 * Live Explore: repeated single photos from the glasses, analysed one at a time with the server's "scene_check"
 * task. The toolkit has no video analysis, so this is a paced series of photos, never a continuous feed.
 */
class ExploreController(
    private val glasses: GlassesPort,
    private val backend: VisionBackend,
    private val speaker: Speaker,
    private val coordinator: CameraModeCoordinator,
    private val timing: ExploreTiming = ExploreTiming(),
    private val log: DiagnosticLog = DiagnosticLog.NONE,
) {
    private val _state = MutableStateFlow(ExploreState())
    val state: StateFlow<ExploreState> = _state.asStateFlow()

    private var questions = Channel<String>(Channel.CONFLATED)

    fun start() {
        if (coordinator.active.value == CameraMode.EXPLORE) return
        questions = Channel(Channel.CONFLATED)
        _state.value = ExploreState(phase = ExplorePhase.LOOKING)
        coordinator.start(CameraMode.EXPLORE) {
            try {
                loop(questions)
            } finally {
                _state.update { it.copy(phase = ExplorePhase.IDLE) }
            }
        }
    }

    fun stop() {
        if (coordinator.active.value != CameraMode.EXPLORE) return
        coordinator.stop(CameraMode.EXPLORE)
        _state.update { it.copy(phase = ExplorePhase.IDLE) }
        speaker.speak(ExploreMessages.STOPPED, SpeechKind.STATUS)
    }

    /** A question asked while exploring interrupts current speech and is answered from a fresh photo. */
    fun ask(question: String): Boolean {
        val q = question.trim()
        if (q.isEmpty() || coordinator.active.value != CameraMode.EXPLORE) return false
        speaker.stop()
        questions.trySend(q)
        return true
    }

    private suspend fun loop(questions: Channel<String>) {
        speaker.speak(ExploreMessages.STARTED, SpeechKind.STATUS)
        var previousSummary: String? = null
        var lastSpoken: String? = null
        var interval = timing.baseIntervalMs
        val cameraFailures = FailureTracker()
        val aiFailures = FailureTracker()

        while (true) {
            currentCoroutineContext().ensureActive()
            setPhase(ExplorePhase.LOOKING)
            val photo = when (val outcome = glasses.captureJpeg()) {
                is CaptureOutcome.Photo -> outcome.also { cameraFailures.success() }
                is CaptureOutcome.Failed -> {
                    log.log("explore: capture failed reason=${outcome.reason}")
                    if (outcome.reason == CaptureFailure.BUSY) {
                        delay(timing.busyRetryMs)
                        continue
                    }
                    if (ModeErrors.isFatal(outcome.reason) || cameraFailures.failed()) {
                        val message = if (ModeErrors.isFatal(outcome.reason)) AssistantMessages.forCapture(outcome.reason) else ExploreMessages.GAVE_UP
                        fail(message)
                        return
                    }
                    report(AssistantMessages.forCapture(outcome.reason))
                    delay(timing.baseIntervalMs)
                    continue
                }
            }

            val pending = questions.tryReceive().getOrNull()
            if (pending != null) {
                answer(pending, photo)
                continue
            }

            setPhase(ExplorePhase.ANALYZING)
            val scene = try {
                backend.sceneCheck(photo.jpeg, photo.capturedAtMs, previousSummary).also { aiFailures.success() }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.log("explore: scene_check failed ${e.javaClass.simpleName}")
                val fatal = e is BackendException && ModeErrors.isFatal(e.kind)
                if (fatal || aiFailures.failed()) {
                    fail(if (fatal) ModeErrors.message(e) else ExploreMessages.AI_GAVE_UP)
                    return
                }
                report(ModeErrors.message(e))
                delay(ModeErrors.backoffMs(e, aiFailures.consecutive))
                continue
            }
            currentCoroutineContext().ensureActive()

            // A question that arrived during analysis makes this description stale; answer the question instead.
            val late = questions.tryReceive().getOrNull()
            if (late != null) {
                answer(late, photo)
                continue
            }

            val update = ExploreNarration.next(scene, lastSpoken)
            previousSummary = scene.summary.ifBlank { previousSummary }
            if (update != null) {
                lastSpoken = update
                interval = timing.baseIntervalMs
                _state.update { it.copy(latest = update, error = null) }
                speaker.speak(update, SpeechKind.ANSWER)
                speaker.awaitSilence()
            } else {
                interval = (interval + timing.stepMs).coerceAtMost(timing.maxIntervalMs)
                log.log("explore: no meaningful change, next in ${interval}ms")
            }

            setPhase(ExplorePhase.WAITING)
            val question = withTimeoutOrNull(interval) { questions.receive() }
            if (question != null) answerWithFreshPhoto(question)
        }
    }

    private suspend fun answerWithFreshPhoto(question: String) {
        setPhase(ExplorePhase.LOOKING)
        when (val outcome = glasses.captureJpeg()) {
            is CaptureOutcome.Photo -> answer(question, outcome)
            is CaptureOutcome.Failed -> report(AssistantMessages.forCapture(outcome.reason))
        }
    }

    private suspend fun answer(question: String, photo: CaptureOutcome.Photo) {
        setPhase(ExplorePhase.ANSWERING)
        try {
            val text = backend.ask(question, photo.jpeg, photo.capturedAtMs).trim()
            currentCoroutineContext().ensureActive()
            if (text.isEmpty()) {
                report(AssistantMessages.EMPTY)
                return
            }
            val safe = SafetyFilter.apply(text)
            val reply = if (QuestionRouting.needsSafetyNotice(question)) AssistantMessages.SAFETY + safe else safe
            _state.update { it.copy(latest = reply, error = null) }
            speaker.speak(reply, SpeechKind.ANSWER)
            speaker.awaitSilence()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.log("explore: question failed ${e.javaClass.simpleName}")
            report(ModeErrors.message(e))
        }
    }

    private fun setPhase(phase: ExplorePhase) = _state.update { it.copy(phase = phase) }

    private fun report(message: String) {
        _state.update { it.copy(error = message) }
        speaker.speak(message, SpeechKind.ERROR)
    }

    private fun fail(message: String) {
        report(message)
        _state.update { it.copy(phase = ExplorePhase.IDLE) }
    }
}

/** Decides what, if anything, Explore says about a new scene so it does not repeat itself. */
object ExploreNarration {
    /** A candidate this similar to the last thing said is a repeat. */
    const val REPEAT_THRESHOLD = 0.6

    /** With no reported changes, a summary this dissimilar still means the view moved somewhere new. */
    const val NEW_VIEW_THRESHOLD = 0.3

    fun next(scene: SceneCheck, lastSpoken: String?): String? {
        val changes = scene.changes.map { it.text.trim() }.filter { it.isNotEmpty() }
        val candidate = when {
            lastSpoken == null -> scene.summary.trim()
            changes.isNotEmpty() -> changes.joinToString(" ") { if (it.endsWith('.')) it else "$it." }
            TextSimilarity.of(scene.summary, lastSpoken) < NEW_VIEW_THRESHOLD -> scene.summary.trim()
            else -> return null
        }
        if (candidate.isEmpty()) return null
        if (lastSpoken != null && TextSimilarity.of(candidate, lastSpoken) >= REPEAT_THRESHOLD) return null
        val worded = if (scene.confidence == Confidence.LOW) ExploreMessages.UNSURE + candidate.replaceFirstChar { it.lowercase() } else candidate
        return SafetyFilter.apply(worded)
    }
}
