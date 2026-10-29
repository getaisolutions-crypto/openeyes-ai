package ai.openeyes.glasses

import ai.openeyes.glasses.backend.BackendErrorKind
import ai.openeyes.glasses.backend.BackendException
import ai.openeyes.glasses.core.AnswerBasis
import ai.openeyes.glasses.core.CameraMode
import ai.openeyes.glasses.core.CameraModeCoordinator
import ai.openeyes.glasses.core.CaptureFailure
import ai.openeyes.glasses.core.CaptureOutcome
import ai.openeyes.glasses.core.ChatMessage
import ai.openeyes.glasses.core.ChatRole
import ai.openeyes.glasses.core.Confidence
import ai.openeyes.glasses.core.ConversationController
import ai.openeyes.glasses.core.ConversationMessages
import ai.openeyes.glasses.core.ExploreController
import ai.openeyes.glasses.core.ExploreNarration
import ai.openeyes.glasses.core.ExploreTiming
import ai.openeyes.glasses.core.FindController
import ai.openeyes.glasses.core.FindMessages
import ai.openeyes.glasses.core.FindResult
import ai.openeyes.glasses.core.FindTiming
import ai.openeyes.glasses.core.FindVerdict
import ai.openeyes.glasses.core.ReadController
import ai.openeyes.glasses.core.ReadFollowUp
import ai.openeyes.glasses.core.ReadMessages
import ai.openeyes.glasses.core.ReadRequest
import ai.openeyes.glasses.core.ReadResult
import ai.openeyes.glasses.core.SafetyFilter
import ai.openeyes.glasses.core.SceneChange
import ai.openeyes.glasses.core.SceneCheck
import ai.openeyes.glasses.core.SessionPhase
import ai.openeyes.glasses.core.StatusText
import ai.openeyes.glasses.core.TextAnswer
import ai.openeyes.glasses.core.Visibility
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FeatureControllersTest {

    private class Rig(scope: TestScope) {
        val glasses = FakeGlasses()
        val backend = FakeBackend()
        val speaker = FakeSpeaker()
        val coordinator = CameraModeCoordinator(glasses, speaker, scope.backgroundScope)
        val explore = ExploreController(glasses, backend, speaker, coordinator, ExploreTiming())
        val find = FindController(glasses, backend, speaker, coordinator, FindTiming(maxAttempts = 3))
        val read = ReadController(glasses, backend, speaker, coordinator, scope.backgroundScope)
        val chat = ConversationController(backend, speaker, scope.backgroundScope)
    }

    // Coordinator

    @Test
    fun startingAModeCancelsThePreviousOne() = runTest {
        val r = Rig(this)
        r.backend.gate = CompletableDeferred()
        r.explore.start()
        runCurrent()
        assertEquals(CameraMode.EXPLORE, r.coordinator.active.value)
        r.find.start("keys")
        runCurrent()
        assertEquals(CameraMode.FIND, r.coordinator.active.value)
        assertFalse(r.explore.state.value.running)
        assertEquals(1, r.glasses.maxConcurrent)
    }

    @Test
    fun stopTurnsTheCameraOffImmediately() = runTest {
        val r = Rig(this)
        r.explore.start()
        runCurrent()
        r.explore.stop()
        assertNull(r.coordinator.active.value)
        assertTrue(r.glasses.releases >= 1)
        assertTrue(r.speaker.statuses.contains("Explore stopped."))
    }

    // Explore

    @Test
    fun exploreSpeaksFirstSummaryThenOnlyChanges() = runTest {
        val r = Rig(this)
        r.backend.scenes += SceneCheck("A kitchen with a table.", listOf("table"), emptyList(), Confidence.HIGH)
        r.backend.scenes += SceneCheck("A kitchen with a table.", listOf("table"), emptyList(), Confidence.HIGH)
        r.backend.scenes += SceneCheck("A kitchen with a table.", listOf("table", "person"), listOf(SceneChange("person", "A person entered from the right")), Confidence.HIGH)
        r.explore.start()
        runCurrent()
        advanceTimeBy(40_000)
        runCurrent()
        r.explore.stop()
        assertEquals("A kitchen with a table.", r.speaker.answers.first())
        assertEquals(1, r.speaker.answers.count { it.startsWith("A kitchen") })
        assertTrue(r.speaker.answers.contains("A person entered from the right."))
        assertEquals("A kitchen with a table.", r.backend.previousSummaries[1])
        assertEquals(1, r.backend.maxConcurrent)
    }

    @Test
    fun exploreStopsOnDisconnect() = runTest {
        val r = Rig(this)
        r.glasses.outcome = CaptureOutcome.Failed(CaptureFailure.NOT_CONNECTED)
        r.explore.start()
        advanceUntilIdle()
        assertFalse(r.explore.state.value.running)
        assertNull(r.coordinator.active.value)
        assertEquals(1, r.glasses.captures)
    }

    @Test
    fun exploreGivesUpAfterRepeatedAiFailures() = runTest {
        val r = Rig(this)
        repeat(3) { r.backend.failures += BackendException(BackendErrorKind.TIMEOUT) }
        r.explore.start()
        advanceUntilIdle()
        assertFalse(r.explore.state.value.running)
        assertEquals(3, r.backend.calls.count { it == "scene" })
    }

    @Test
    fun questionDuringExploreIsAnswered() = runTest {
        val r = Rig(this)
        r.backend.reply = "That is a blue mug."
        r.explore.start()
        runCurrent()
        assertTrue(r.explore.ask("What colour is the mug?"))
        advanceTimeBy(1_000)
        runCurrent()
        r.explore.stop()
        assertTrue(r.backend.calls.contains("ask:What colour is the mug?"))
        assertTrue(r.speaker.answers.contains("That is a blue mug."))
    }

    @Test
    fun narrationMarksLowConfidenceAndNeverClaimsAClearPath() {
        val low = ExploreNarration.next(SceneCheck("A corridor.", emptyList(), emptyList(), Confidence.LOW), null)
        assertEquals("I'm not certain, but a corridor.", low)
        val unsafe = SafetyFilter.apply("A pavement. The path is clear.")
        assertFalse(unsafe.contains("path is clear"))
        assertTrue(unsafe.startsWith(SafetyFilter.CAUTION))
    }

    // Find

    @Test
    fun findStopsWhenTheObjectIsVisible() = runTest {
        val r = Rig(this)
        r.backend.findResults += FindResult(Visibility.NOT_VISIBLE, "", Confidence.MEDIUM, "Look lower.")
        r.backend.findResults += FindResult(Visibility.VISIBLE, "on the table, slightly left", Confidence.HIGH, "")
        assertTrue(r.find.start("  keys "))
        advanceUntilIdle()
        assertEquals(FindVerdict.FOUND, r.find.state.value.report?.verdict)
        assertEquals(listOf("find:keys", "find:keys"), r.backend.calls)
        assertTrue(r.speaker.answers.last().contains("on the table, slightly left"))
        assertFalse(r.find.state.value.searching)
    }

    @Test
    fun findRejectsEmptyTarget() = runTest {
        val r = Rig(this)
        assertFalse(r.find.start("   "))
        assertEquals(FindMessages.EMPTY_TARGET, r.find.state.value.error)
        assertEquals(0, r.glasses.captures)
    }

    @Test
    fun findEndsAfterMaxAttemptsAndDoesNotRepeatMisses() = runTest {
        val r = Rig(this)
        r.find.start("wallet")
        advanceUntilIdle()
        assertEquals(3, r.backend.calls.size)
        assertEquals(1, r.speaker.statuses.count { it.contains("not detected") })
        assertTrue(r.speaker.answers.last().startsWith("I could not find wallet"))
    }

    @Test
    fun findNeverInventsALocation() {
        val report = FindMessages.phrase("mug", FindResult(Visibility.VISIBLE, "", Confidence.HIGH, ""))
        assertTrue(report.message.contains("cannot tell exactly where"))
        assertEquals(FindVerdict.POSSIBLY, FindMessages.phrase("mug", FindResult(Visibility.UNCERTAIN, "", Confidence.LOW, "")).verdict)
    }

    // Read

    @Test
    fun readKeepsTranscriptionAndRepeatsWithoutAi() = runTest {
        val r = Rig(this)
        r.read.read()
        advanceUntilIdle()
        assertEquals("Fire exit\nKeep this door closed", r.read.state.value.transcription)
        r.read.request(ReadRequest.Slower)
        r.read.request(ReadRequest.Repeat)
        assertEquals(listOf("read"), r.backend.calls)
        assertEquals(1, r.speaker.slowSpoken.size)
    }

    @Test
    fun unreadableTextAsksToAdjustAndKeepsNothing() = runTest {
        val r = Rig(this)
        r.backend.readResult = ReadResult("", false)
        r.read.read()
        advanceUntilIdle()
        assertNull(r.read.state.value.transcription)
        assertEquals(ReadMessages.UNREADABLE, r.read.state.value.error)
    }

    @Test
    fun summaryIsKeptApartFromTheOriginal() = runTest {
        val r = Rig(this)
        r.backend.chatReply = "A fire door that must stay closed."
        r.read.read()
        advanceUntilIdle()
        r.read.request(ReadRequest.Summarize)
        advanceUntilIdle()
        assertEquals("Fire exit\nKeep this door closed", r.read.state.value.transcription)
        assertEquals("A fire door that must stay closed.", r.read.state.value.aside?.text)
        assertTrue(r.backend.chatTurns.last().single().content.contains("Keep this door closed"))
    }

    @Test
    fun questionsUseTheSamePhotoAndStateTheirBasis() = runTest {
        val r = Rig(this)
        r.backend.textAnswer = TextAnswer("", AnswerBasis.NOT_FOUND, "")
        r.read.read()
        advanceUntilIdle()
        r.read.request("When does it open?")
        advanceUntilIdle()
        assertEquals(1, r.glasses.captures)
        assertEquals(ReadMessages.NOT_FOUND, r.read.state.value.aside?.text)
    }

    @Test
    fun clearForgetsEverything() = runTest {
        val r = Rig(this)
        r.read.read()
        advanceUntilIdle()
        r.read.clear()
        assertNull(r.read.state.value.transcription)
        r.read.request(ReadRequest.Repeat)
        assertEquals(ReadMessages.NOTHING_YET, r.read.state.value.error)
    }

    @Test
    fun followUpParsing() {
        assertEquals(ReadRequest.Translate("Spanish"), ReadFollowUp.parse("translate this"))
        assertEquals(ReadRequest.Translate("French"), ReadFollowUp.parse("Translate it into French"))
        assertEquals(ReadRequest.Slower, ReadFollowUp.parse("read it slower"))
        assertEquals(ReadRequest.Explain, ReadFollowUp.parse("What does this mean?"))
        assertEquals(ReadRequest.Important, ReadFollowUp.parse("important information only"))
        assertEquals(ReadRequest.Question("Who signed it?"), ReadFollowUp.parse("Who signed it?"))
        assertNull(ReadFollowUp.parse("  "))
    }

    // Conversation

    @Test
    fun conversationSendsHistoryWithoutCamera() = runTest {
        val r = Rig(this)
        r.chat.send("Tell me about Michigan")
        advanceUntilIdle()
        r.backend.chatReply = "Lansing."
        r.chat.send("What is its capital?")
        advanceUntilIdle()
        val turns = r.backend.chatTurns.last()
        assertEquals(3, turns.size)
        assertEquals("Tell me about Michigan", turns.first().content)
        assertEquals(ChatRole.ASSISTANT, turns[1].role)
        assertEquals(0, r.glasses.captures)
        assertEquals("Lansing.", r.chat.state.value.lastAnswer)
    }

    @Test
    fun conversationRejectsEmptyAndDuplicateRequests() = runTest {
        val r = Rig(this)
        assertFalse(r.chat.send("  "))
        r.backend.gate = CompletableDeferred()
        assertTrue(r.chat.send("Hello"))
        runCurrent()
        assertFalse(r.chat.send("Hello again"))
        assertEquals(ConversationMessages.BUSY, r.chat.state.value.error)
        assertEquals(1, r.backend.calls.size)
    }

    @Test
    fun failedTurnIsNotResentAsContext() = runTest {
        val r = Rig(this)
        r.backend.failures += BackendException(BackendErrorKind.NETWORK)
        r.chat.send("First")
        advanceUntilIdle()
        assertTrue(r.chat.state.value.messages.single().failed)
        r.chat.send("Second")
        advanceUntilIdle()
        assertEquals(listOf("Second"), r.backend.chatTurns.last().map { it.content })
    }

    @Test
    fun newConversationClearsHistory() = runTest {
        val r = Rig(this)
        r.chat.send("Hi")
        advanceUntilIdle()
        r.chat.newConversation()
        assertTrue(r.chat.state.value.messages.isEmpty())
    }

    @Test
    fun boundedTurnsRespectServerLimits() {
        val many = (1..20).map { ChatMessage(if (it % 2 == 0) ChatRole.ASSISTANT else ChatRole.USER, "m$it") }
        assertEquals(12, ConversationController.boundedTurns(many).size)
        val long = listOf(ChatMessage(ChatRole.USER, "x".repeat(6_000)), ChatMessage(ChatRole.USER, "y".repeat(6_000)))
        assertEquals(1, ConversationController.boundedTurns(long).size)
    }

    // Disconnection

    @Test
    fun onlyARealDisconnectEndsCameraModes() {
        val paused = CONNECTED.copy(session = SessionPhase.PAUSED)
        assertFalse(StatusText.endsCameraModes(CONNECTED, paused))
        assertTrue(StatusText.endsCameraModes(CONNECTED, CONNECTED.copy(session = SessionPhase.STOPPED)))
        assertFalse(StatusText.endsCameraModes(CONNECTED.copy(recoveringCamera = true), CONNECTED.copy(session = SessionPhase.STOPPED, recoveringCamera = true)))
        assertNotNull(CONNECTED)
    }
}
