package ai.openeyes.glasses

import ai.openeyes.glasses.core.CaptureOutcome
import ai.openeyes.glasses.core.GlassesPort
import ai.openeyes.glasses.core.GlassesStatus
import ai.openeyes.glasses.core.CameraPermission
import ai.openeyes.glasses.core.Registration
import ai.openeyes.glasses.core.SessionPhase
import ai.openeyes.glasses.core.SpeechKind
import ai.openeyes.glasses.core.Speaker
import ai.openeyes.glasses.core.VisionBackend
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow

val CONNECTED = GlassesStatus(
    sdkReady = true,
    registration = Registration.REGISTERED,
    deviceAvailable = true,
    session = SessionPhase.ACTIVE,
    cameraPermission = CameraPermission.GRANTED,
)

class FakeGlasses(initial: GlassesStatus = CONNECTED) : GlassesPort {
    override val status = MutableStateFlow(initial)
    var outcome: CaptureOutcome = CaptureOutcome.Photo(byteArrayOf(1, 2, 3), 1_700_000_000_000)
    var gate: CompletableDeferred<Unit>? = null
    var captures = 0

    override suspend fun captureJpeg(): CaptureOutcome {
        captures++
        gate?.await()
        return outcome
    }
}

class FakeBackend : VisionBackend {
    var reply = "A desk with a laptop and a mug."
    val failures = ArrayDeque<Exception>()
    var gate: CompletableDeferred<Unit>? = null
    val calls = mutableListOf<String>()

    override suspend fun describe(jpeg: ByteArray, capturedAtMs: Long): String = respond("describe")

    override suspend fun ask(question: String, jpeg: ByteArray, capturedAtMs: Long): String = respond("ask:$question")

    private suspend fun respond(call: String): String {
        calls += call
        gate?.await()
        failures.removeFirstOrNull()?.let { throw it }
        return reply
    }
}

class FakeSpeaker : Speaker {
    val spoken = mutableListOf<Pair<String, SpeechKind>>()
    var stops = 0

    val answers: List<String> get() = spoken.filter { it.second == SpeechKind.ANSWER }.map { it.first }
    val errors: List<String> get() = spoken.filter { it.second == SpeechKind.ERROR }.map { it.first }

    override fun speak(text: String, kind: SpeechKind) {
        spoken += text to kind
    }

    override fun stop() {
        stops++
    }
}
