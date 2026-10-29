package ai.openeyes.glasses

import ai.openeyes.glasses.core.CameraPermission
import ai.openeyes.glasses.core.CameraPhase
import ai.openeyes.glasses.core.GlassesStatus
import ai.openeyes.glasses.core.ImageSizing
import ai.openeyes.glasses.core.QuestionRouting
import ai.openeyes.glasses.core.Registration
import ai.openeyes.glasses.core.SessionPhase
import ai.openeyes.glasses.core.StatusText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GlassesStatusTest {

    @Test
    fun `connected only when the toolkit reports an active session`() {
        SessionPhase.entries.forEach { phase ->
            val status = CONNECTED.copy(session = phase)
            assertEquals(phase == SessionPhase.ACTIVE, status.connected)
            if (phase != SessionPhase.ACTIVE) assertFalse(StatusText.connection(status) == "Glasses connected")
        }
        assertEquals("Glasses connected", StatusText.connection(CONNECTED))
    }

    @Test
    fun `a nearby device alone does not count as connected`() {
        val status = GlassesStatus(sdkReady = true, registration = Registration.REGISTERED, deviceAvailable = true)
        assertFalse(status.connected)
        assertEquals("Glasses disconnected", StatusText.connection(status))
        assertEquals("Session stopped", StatusText.session(status))
    }

    @Test
    fun `camera is available only when connected and permitted`() {
        assertTrue(CONNECTED.cameraAvailable)
        assertEquals("Camera available", StatusText.camera(CONNECTED))
        assertFalse(CONNECTED.copy(session = SessionPhase.PAUSED).cameraAvailable)
        val denied = CONNECTED.copy(cameraPermission = CameraPermission.DENIED)
        assertFalse(denied.cameraAvailable)
        assertTrue(StatusText.camera(denied).startsWith("Camera unavailable"))
        assertEquals("Glasses camera on", StatusText.camera(CONNECTED.copy(camera = CameraPhase.STREAMING)))
    }

    @Test
    fun `sessions start only when ready, registered and not already running`() {
        assertFalse(GlassesStatus().canStartSession)
        assertFalse(GlassesStatus(sdkReady = true).canStartSession)
        assertTrue(GlassesStatus(sdkReady = true, registration = Registration.REGISTERED).canStartSession)
        assertFalse(CONNECTED.canStartSession)
        assertTrue(CONNECTED.copy(session = SessionPhase.STOPPED).canStartSession)
    }

    @Test
    fun `announcements cover connect, pause, disconnect and failed connect`() {
        val starting = CONNECTED.copy(session = SessionPhase.STARTING)
        assertEquals("Glasses connected.", StatusText.announcement(starting, CONNECTED))
        assertTrue(StatusText.announcement(CONNECTED, CONNECTED.copy(session = SessionPhase.PAUSED))!!.startsWith("Glasses paused"))
        assertEquals("Glasses disconnected.", StatusText.announcement(CONNECTED, CONNECTED.copy(session = SessionPhase.STOPPED)))
        assertTrue(StatusText.announcement(starting, starting.copy(session = SessionPhase.STOPPED))!!.startsWith("Could not connect"))
    }

    @Test
    fun `camera on and off is not announced`() {
        assertNull(StatusText.announcement(CONNECTED, CONNECTED.copy(camera = CameraPhase.STREAMING)))
        assertNull(StatusText.announcement(CONNECTED.copy(camera = CameraPhase.STREAMING), CONNECTED))
    }

    @Test
    fun `question routing`() {
        listOf(null, "", "what am i looking at", "What's in front of me?", "describe", "Describe the scene").forEach {
            assertTrue("$it should describe", QuestionRouting.isDescribe(it))
        }
        listOf("Read this label", "What colour is the car?").forEach {
            assertFalse("$it should be a question", QuestionRouting.isDescribe(it))
        }
        assertTrue(QuestionRouting.needsSafetyNotice("Can I cross now?"))
        assertFalse(QuestionRouting.needsSafetyNotice("What colour is this?"))
    }

    @Test
    fun `photos are downsized to at most 1280 on the long side`() {
        assertEquals(720 to 1280, ImageSizing.target(720, 1280))
        assertEquals(504 to 896, ImageSizing.target(504, 896))
        assertEquals(1280 to 960, ImageSizing.target(4032, 3024))
        assertEquals(960 to 1280, ImageSizing.target(3024, 4032))
    }
}
