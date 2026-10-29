package ai.openeyes.glasses

import ai.openeyes.glasses.core.AnswerBasis
import ai.openeyes.glasses.core.CaptureOutcome
import ai.openeyes.glasses.core.ChatTurn
import ai.openeyes.glasses.core.Confidence
import ai.openeyes.glasses.core.FindResult
import ai.openeyes.glasses.core.GlassesPort
import ai.openeyes.glasses.core.GlassesStatus
import ai.openeyes.glasses.core.CameraPermission
import ai.openeyes.glasses.core.ReadResult
import ai.openeyes.glasses.core.Registration
import ai.openeyes.glasses.core.ResponseLength
import ai.openeyes.glasses.core.SceneCheck
import ai.openeyes.glasses.core.SessionPhase
import ai.openeyes.glasses.core.SpeechKind
import ai.openeyes.glasses.core.Speaker
import ai.openeyes.glasses.core.TextAnswer
import ai.openeyes.glasses.core.VisionBackend
import ai.openeyes.glasses.core.Visibility
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
    val outcomes = ArrayDeque<CaptureOutcome>()
    var gate: CompletableDeferred<Unit>? = null
    var captures = 0
    var releases = 0
    var active = 0
    var maxConcurrent = 0

    override suspend fun captureJpeg(): CaptureOutcome {
        captures++
        active++
        maxConcurrent = maxOf(maxConcurrent, active)
        try {
            gate?.await()
            return outcomes.removeFirstOrNull() ?: outcome
        } finally {
            active--
        }
    }

    override fun releaseCamera() {
        releases++
    }
}

class FakeBackend : VisionBackend {
    var reply = "A desk with a laptop and a mug."
    val failures = ArrayDeque<Exception>()
    var gate: CompletableDeferred<Unit>? = null
    val calls = mutableListOf<String>()
    var active = 0
    var maxConcurrent = 0

    var scene = SceneCheck("A hallway with a door on the left.", listOf("door"), emptyList(), Confidence.HIGH)
    val scenes = ArrayDeque<SceneCheck>()
    var findResult = FindResult(Visibility.NOT_VISIBLE, "", Confidence.MEDIUM, "")
    val findResults = ArrayDeque<FindResult>()
    var readResult = ReadResult("Fire exit\nKeep this door closed", true)
    var textAnswer = TextAnswer("Keep the door closed.", AnswerBasis.EXACT, "Keep this door closed")
    var chatReply = "Michigan is a state in the Great Lakes region."
    val chatTurns = mutableListOf<List<ChatTurn>>()
    val previousSummaries = mutableListOf<String?>()

    override suspend fun describe(jpeg: ByteArray, capturedAtMs: Long): String = respond("describe") { reply }

    override suspend fun ask(question: String, jpeg: ByteArray, capturedAtMs: Long): String =
        respond("ask:$question") { reply }

    override suspend fun sceneCheck(jpeg: ByteArray, capturedAtMs: Long, previousSummary: String?): SceneCheck {
        previousSummaries += previousSummary
        return respond("scene") { scenes.removeFirstOrNull() ?: scene }
    }

    override suspend fun find(objectName: String, jpeg: ByteArray, capturedAtMs: Long): FindResult =
        respond("find:$objectName") { findResults.removeFirstOrNull() ?: findResult }

    override suspend fun read(jpeg: ByteArray, capturedAtMs: Long): ReadResult = respond("read") { readResult }

    override suspend fun askText(question: String, jpeg: ByteArray, capturedAtMs: Long): TextAnswer =
        respond("askText:$question") { textAnswer }

    override suspend fun chat(turns: List<ChatTurn>, length: ResponseLength): String {
        chatTurns += turns.toList()
        return respond("chat") { chatReply }
    }

    private suspend fun <T> respond(call: String, value: () -> T): T {
        calls += call
        active++
        maxConcurrent = maxOf(maxConcurrent, active)
        try {
            gate?.await()
            failures.removeFirstOrNull()?.let { throw it }
            return value()
        } finally {
            active--
        }
    }
}

class FakeSpeaker : Speaker {
    val spoken = mutableListOf<Pair<String, SpeechKind>>()
    val slowSpoken = mutableListOf<String>()
    var stops = 0
    var silenceWaits = 0

    val answers: List<String> get() = spoken.filter { it.second == SpeechKind.ANSWER }.map { it.first }
    val errors: List<String> get() = spoken.filter { it.second == SpeechKind.ERROR }.map { it.first }
    val statuses: List<String> get() = spoken.filter { it.second == SpeechKind.STATUS }.map { it.first }

    override fun speak(text: String, kind: SpeechKind, slow: Boolean) {
        spoken += text to kind
        if (slow) slowSpoken += text
    }

    override fun stop() {
        stops++
    }

    override suspend fun awaitSilence() {
        silenceWaits++
    }
}
