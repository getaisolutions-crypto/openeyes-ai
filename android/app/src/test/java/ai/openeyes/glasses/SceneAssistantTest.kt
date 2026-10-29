package ai.openeyes.glasses

import ai.openeyes.glasses.backend.BackendErrorKind
import ai.openeyes.glasses.backend.BackendException
import ai.openeyes.glasses.core.AssistantMessages
import ai.openeyes.glasses.core.AssistantPhase
import ai.openeyes.glasses.core.CaptureFailure
import ai.openeyes.glasses.core.CaptureOutcome
import ai.openeyes.glasses.core.GlassesStatus
import ai.openeyes.glasses.core.SceneAssistant
import ai.openeyes.glasses.core.SessionPhase
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SceneAssistantTest {
    private val glasses = FakeGlasses()
    private val backend = FakeBackend()
    private val speaker = FakeSpeaker()

    private fun TestScope.assistant() = SceneAssistant(glasses, backend, speaker, this)

    @Test
    fun `look takes one glasses photo, describes it and speaks the answer`() = runTest {
        val assistant = assistant()
        assertTrue(assistant.ask(null))
        advanceUntilIdle()
        assertEquals(1, glasses.captures)
        assertEquals(listOf("describe"), backend.calls)
        assertEquals(listOf("A desk with a laptop and a mug."), speaker.answers)
        assertEquals(AssistantPhase.IDLE, assistant.phase.value)
    }

    @Test
    fun `spoken what am I looking at uses the description task`() = runTest {
        assistant().ask("What am I looking at?")
        advanceUntilIdle()
        assertEquals(listOf("describe"), backend.calls)
    }

    @Test
    fun `other questions are sent with the photo as a chat question`() = runTest {
        assistant().ask("  What colour is this shirt? ")
        advanceUntilIdle()
        assertEquals(listOf("ask:What colour is this shirt?"), backend.calls)
    }

    @Test
    fun `nothing is captured when the glasses are not connected`() = runTest {
        glasses.status.value = GlassesStatus(sdkReady = true, session = SessionPhase.STARTING)
        assistant().ask(null)
        advanceUntilIdle()
        assertEquals(0, glasses.captures)
        assertTrue(backend.calls.isEmpty())
        assertEquals(listOf(AssistantMessages.NOT_CONNECTED), speaker.errors)
    }

    @Test
    fun `camera permission denial is explained and nothing is sent`() = runTest {
        glasses.outcome = CaptureOutcome.Failed(CaptureFailure.PERMISSION_DENIED)
        assistant().ask(null)
        advanceUntilIdle()
        assertTrue(backend.calls.isEmpty())
        assertEquals(listOf(AssistantMessages.PERMISSION_DENIED), speaker.errors)
    }

    @Test
    fun `glasses disconnecting during capture is reported`() = runTest {
        val gate = CompletableDeferred<Unit>()
        glasses.gate = gate
        val assistant = assistant()
        assistant.ask(null)
        advanceUntilIdle()
        assertEquals(AssistantPhase.CAPTURING, assistant.phase.value)
        glasses.status.value = CONNECTED.copy(session = SessionPhase.STOPPED)
        glasses.outcome = CaptureOutcome.Failed(CaptureFailure.NOT_CONNECTED)
        gate.complete(Unit)
        advanceUntilIdle()
        assertTrue(backend.calls.isEmpty())
        assertEquals(listOf(AssistantMessages.NOT_CONNECTED), speaker.errors)
        assertEquals(AssistantPhase.IDLE, assistant.phase.value)
    }

    @Test
    fun `camera start timeout is reported`() = runTest {
        glasses.outcome = CaptureOutcome.Failed(CaptureFailure.TIMEOUT)
        assistant().ask(null)
        advanceUntilIdle()
        assertEquals(listOf(AssistantMessages.TIMEOUT), speaker.errors)
    }

    @Test
    fun `stop cancels the request and a late answer is never spoken`() = runTest {
        val gate = CompletableDeferred<Unit>()
        backend.gate = gate
        val assistant = assistant()
        assistant.ask(null)
        advanceUntilIdle()
        assertEquals(AssistantPhase.ANALYZING, assistant.phase.value)
        assistant.cancel()
        gate.complete(Unit)
        advanceUntilIdle()
        assertTrue(speaker.answers.isEmpty())
        assertTrue(speaker.errors.isEmpty())
        assertEquals(1, speaker.stops)
        assertEquals(AssistantPhase.IDLE, assistant.phase.value)
    }

    @Test
    fun `a second request while one is running is refused`() = runTest {
        backend.gate = CompletableDeferred()
        val assistant = assistant()
        assertTrue(assistant.ask(null))
        advanceUntilIdle()
        assertFalse(assistant.ask(null))
        assertEquals(1, glasses.captures)
        assertEquals(AssistantMessages.BUSY, speaker.spoken.last().first)
        assistant.cancel()
    }

    @Test
    fun `after a server error the next request works`() = runTest {
        backend.failures += BackendException(BackendErrorKind.TIMEOUT)
        val assistant = assistant()
        assistant.ask(null)
        advanceUntilIdle()
        assertEquals(listOf(AssistantMessages.forBackend(BackendErrorKind.TIMEOUT)), speaker.errors)
        assistant.ask(null)
        advanceUntilIdle()
        assertEquals(listOf("A desk with a laptop and a mug."), speaker.answers)
        assertEquals(2, glasses.captures)
    }

    @Test
    fun `unexpected failures are spoken as a generic error`() = runTest {
        backend.failures += IllegalStateException("boom")
        assistant().ask(null)
        advanceUntilIdle()
        assertEquals(listOf(AssistantMessages.forBackend(BackendErrorKind.SERVER)), speaker.errors)
    }

    @Test
    fun `empty answers are reported instead of silence`() = runTest {
        backend.reply = "   "
        assistant().ask(null)
        advanceUntilIdle()
        assertEquals(listOf(AssistantMessages.EMPTY), speaker.errors)
    }

    @Test
    fun `crossing questions get a safety notice and never a safety promise`() = runTest {
        backend.reply = "A pedestrian crossing with a red signal."
        assistant().ask("Is it safe to cross the road?")
        advanceUntilIdle()
        val answer = speaker.answers.single()
        assertTrue(answer.startsWith(AssistantMessages.SAFETY))
        assertTrue(answer.endsWith("A pedestrian crossing with a red signal."))
    }
}
