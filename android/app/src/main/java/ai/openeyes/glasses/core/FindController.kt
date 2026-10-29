package ai.openeyes.glasses.core

import ai.openeyes.glasses.backend.BackendException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

enum class FindPhase { IDLE, LOOKING, ANALYZING, WAITING }

enum class FindVerdict { FOUND, POSSIBLY, NOT_DETECTED }

data class FindReport(val verdict: FindVerdict, val message: String)

data class FindState(
    val target: String? = null,
    val phase: FindPhase = FindPhase.IDLE,
    val report: FindReport? = null,
    val error: String? = null,
) {
    val searching: Boolean get() = phase != FindPhase.IDLE
}

data class FindTiming(
    val intervalMs: Long = 5_000,
    val busyRetryMs: Long = 1_000,
    val maxAttempts: Int = 24,
    /** Speak "not detected" on the first miss and then every this many misses; the screen always shows the latest. */
    val missAnnounceEvery: Int = 3,
)

object FindMessages {
    const val MAX_TARGET = 80
    const val EMPTY_TARGET = "Say or type what you want to find first."
    const val TOO_LONG = "That is too long. Name one object in a few words."
    const val STOPPED = "Search stopped."
    const val GAVE_UP = "Search stopped because the glasses camera kept failing. Check the glasses and try again."
    const val AI_GAVE_UP = "Search stopped because Meta AI kept failing. Please try again in a moment."

    fun started(target: String) = "Searching for $target. Turn your head slowly."

    fun exhausted(target: String) = "I could not find $target. The search has stopped. Try another room or better light."

    fun phrase(target: String, result: FindResult): FindReport {
        val position = result.position.trim().trimEnd('.')
        val suggestion = result.suggestion.trim()
        return when (result.visibility) {
            Visibility.VISIBLE -> FindReport(
                FindVerdict.FOUND,
                if (position.isEmpty()) "Found $target, but I cannot tell exactly where it is in the view."
                else "Found $target: $position. This is an approximate location, not a measured distance.",
            )
            Visibility.UNCERTAIN -> FindReport(
                FindVerdict.POSSIBLY,
                buildString {
                    append(if (position.isEmpty()) "Possibly $target, but I am not sure." else "Possibly $target: $position, but I am not sure.")
                    append(" Hold still and I will check again.")
                },
            )
            Visibility.NOT_VISIBLE -> FindReport(
                FindVerdict.NOT_DETECTED,
                "${target.replaceFirstChar { it.uppercase() }} not detected yet. " + suggestion.ifEmpty { "Turn your head slowly." },
            )
        }
    }
}

/** Find Objects: repeated glasses photos checked with the server's "find" task until the object is seen or Stop. */
class FindController(
    private val glasses: GlassesPort,
    private val backend: VisionBackend,
    private val speaker: Speaker,
    private val coordinator: CameraModeCoordinator,
    private val timing: FindTiming = FindTiming(),
    private val log: DiagnosticLog = DiagnosticLog.NONE,
) {
    private val _state = MutableStateFlow(FindState())
    val state: StateFlow<FindState> = _state.asStateFlow()

    /** Returns a message explaining why the target cannot be searched for, or null when it is fine. */
    fun validate(target: String): String? {
        val t = target.trim()
        return when {
            t.isEmpty() -> FindMessages.EMPTY_TARGET
            t.length > FindMessages.MAX_TARGET -> FindMessages.TOO_LONG
            else -> null
        }
    }

    fun start(target: String): Boolean {
        val t = target.trim().replace(Regex("\\s+"), " ")
        validate(t)?.let {
            _state.update { s -> s.copy(error = it) }
            speaker.speak(it, SpeechKind.ERROR)
            return false
        }
        _state.value = FindState(target = t, phase = FindPhase.LOOKING)
        coordinator.start(CameraMode.FIND) {
            try {
                search(t)
            } finally {
                _state.update { it.copy(phase = FindPhase.IDLE) }
            }
        }
        return true
    }

    fun stop() {
        if (coordinator.active.value != CameraMode.FIND) return
        coordinator.stop(CameraMode.FIND)
        _state.update { it.copy(phase = FindPhase.IDLE) }
        speaker.speak(FindMessages.STOPPED, SpeechKind.STATUS)
    }

    private suspend fun search(target: String) {
        speaker.speak(FindMessages.started(target), SpeechKind.STATUS)
        val cameraFailures = FailureTracker()
        val aiFailures = FailureTracker()
        var lastSpoken: String? = null
        var misses = 0
        var attempts = 0

        while (attempts < timing.maxAttempts) {
            currentCoroutineContext().ensureActive()
            setPhase(FindPhase.LOOKING)
            val photo = when (val outcome = glasses.captureJpeg()) {
                is CaptureOutcome.Photo -> outcome.also { cameraFailures.success() }
                is CaptureOutcome.Failed -> {
                    log.log("find: capture failed reason=${outcome.reason}")
                    if (outcome.reason == CaptureFailure.BUSY) {
                        delay(timing.busyRetryMs)
                        continue
                    }
                    val fatal = ModeErrors.isFatal(outcome.reason)
                    if (fatal || cameraFailures.failed()) {
                        report(if (fatal) AssistantMessages.forCapture(outcome.reason) else FindMessages.GAVE_UP)
                        return
                    }
                    report(AssistantMessages.forCapture(outcome.reason))
                    delay(timing.intervalMs)
                    continue
                }
            }

            attempts++
            setPhase(FindPhase.ANALYZING)
            val result = try {
                backend.find(target, photo.jpeg, photo.capturedAtMs).also { aiFailures.success() }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.log("find: request failed ${e.javaClass.simpleName}")
                val fatal = e is BackendException && ModeErrors.isFatal(e.kind)
                if (fatal || aiFailures.failed()) {
                    report(if (fatal) ModeErrors.message(e) else FindMessages.AI_GAVE_UP)
                    return
                }
                report(ModeErrors.message(e))
                delay(ModeErrors.backoffMs(e, aiFailures.consecutive))
                continue
            }
            currentCoroutineContext().ensureActive()

            val found = FindMessages.phrase(target, result)
            _state.update { it.copy(report = found, error = null) }
            when (found.verdict) {
                FindVerdict.FOUND -> {
                    speaker.speak(found.message, SpeechKind.ANSWER)
                    return
                }
                FindVerdict.POSSIBLY -> {
                    misses = 0
                    if (lastSpoken == null || TextSimilarity.of(found.message, lastSpoken) < ExploreNarration.REPEAT_THRESHOLD) {
                        lastSpoken = found.message
                        speaker.speak(found.message, SpeechKind.ANSWER)
                    }
                }
                FindVerdict.NOT_DETECTED -> {
                    if (misses % timing.missAnnounceEvery == 0) {
                        lastSpoken = found.message
                        speaker.speak(found.message, SpeechKind.STATUS)
                    }
                    misses++
                }
            }
            speaker.awaitSilence()
            setPhase(FindPhase.WAITING)
            delay(timing.intervalMs)
        }
        val message = FindMessages.exhausted(target)
        _state.update { it.copy(report = FindReport(FindVerdict.NOT_DETECTED, message)) }
        speaker.speak(message, SpeechKind.ANSWER)
    }

    private fun setPhase(phase: FindPhase) = _state.update { it.copy(phase = phase) }

    private fun report(message: String) {
        _state.update { it.copy(error = message) }
        speaker.speak(message, SpeechKind.ERROR)
    }
}
