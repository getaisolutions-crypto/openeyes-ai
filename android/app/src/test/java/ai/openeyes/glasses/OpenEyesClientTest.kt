package ai.openeyes.glasses

import ai.openeyes.glasses.backend.BackendConfig
import ai.openeyes.glasses.backend.BackendErrorKind
import ai.openeyes.glasses.backend.BackendException
import ai.openeyes.glasses.backend.HttpResponse
import ai.openeyes.glasses.backend.HttpTransport
import ai.openeyes.glasses.backend.OpenEyesClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException
import java.net.SocketTimeoutException

class OpenEyesClientTest {
    private val config = BackendConfig("https://example.supabase.co/functions/v1/openeyes-ai", "public-anon-key")
    private val jpeg = byteArrayOf(-1, -40, -1, -32)

    private class RecordingTransport(var respond: () -> HttpResponse) : HttpTransport {
        var url: String? = null
        var headers: Map<String, String> = emptyMap()
        var body: JSONObject? = null
        var calls = 0

        override fun post(url: String, headers: Map<String, String>, body: String, timeoutMs: Int): HttpResponse {
            calls++
            this.url = url
            this.headers = headers
            this.body = JSONObject(body)
            return respond()
        }
    }

    private fun ok(text: String) = HttpResponse(200, JSONObject().put("task", "describe").put("model", "m").put("text", text).toString())

    private fun client(transport: HttpTransport, cfg: BackendConfig = config) = OpenEyesClient(cfg, transport, Dispatchers.Unconfined)

    private suspend fun expectKind(kind: BackendErrorKind, block: suspend () -> Unit) {
        try {
            block()
            fail("Expected $kind")
        } catch (e: BackendException) {
            assertEquals(kind, e.kind)
        }
    }

    @Test
    fun `describe sends the website request format with a JPEG data URL`() = runTest {
        val transport = RecordingTransport { ok(" A kitchen counter. ") }
        val text = client(transport).describe(jpeg, 1_700_000_000_000)
        assertEquals("A kitchen counter.", text)
        assertEquals(config.functionUrl, transport.url)
        assertEquals("Bearer public-anon-key", transport.headers["Authorization"])
        assertEquals("public-anon-key", transport.headers["apikey"])
        assertEquals("application/json", transport.headers["Content-Type"])
        val body = transport.body!!
        assertEquals("describe", body.getString("task"))
        assertEquals("brief", body.getString("responseLength"))
        val image = body.getJSONObject("image")
        assertTrue(image.getString("dataUrl").startsWith("data:image/jpeg;base64,"))
        assertEquals("2023-11-14T22:13:20Z", image.getString("capturedAt"))
    }

    @Test
    fun `questions are sent as a single user chat message with the photo`() = runTest {
        val transport = RecordingTransport { ok("It is blue.") }
        assertEquals("It is blue.", client(transport).ask("What colour is it?", jpeg, 0))
        val body = transport.body!!
        assertEquals("chat", body.getString("task"))
        val messages = body.getJSONArray("messages")
        assertEquals(1, messages.length())
        assertEquals("user", messages.getJSONObject(0).getString("role"))
        assertEquals("What colour is it?", messages.getJSONObject(0).getString("content"))
        assertTrue(body.has("image"))
    }

    @Test
    fun `server error codes map to clear error kinds`() = runTest {
        val cases = mapOf(
            "not_configured" to BackendErrorKind.NOT_CONFIGURED,
            "quota_exceeded" to BackendErrorKind.RATE_LIMITED,
            "meta_timeout" to BackendErrorKind.TIMEOUT,
            "meta_auth_failed" to BackendErrorKind.AUTH,
            "image_too_large" to BackendErrorKind.IMAGE_REJECTED,
            "meta_bad_response" to BackendErrorKind.BAD_RESPONSE,
            "internal_error" to BackendErrorKind.SERVER,
        )
        cases.forEach { (code, kind) ->
            val transport = RecordingTransport {
                HttpResponse(400, JSONObject().put("error", JSONObject().put("code", code)).toString())
            }
            expectKind(kind) { client(transport).describe(jpeg, 0) }
        }
    }

    @Test
    fun `rate limit keeps the retry delay`() = runTest {
        val transport = RecordingTransport {
            HttpResponse(429, """{"error":{"code":"meta_rate_limited","retryAfterSeconds":30}}""")
        }
        try {
            client(transport).describe(jpeg, 0)
            fail()
        } catch (e: BackendException) {
            assertEquals(BackendErrorKind.RATE_LIMITED, e.kind)
            assertEquals(30, e.retryAfterSeconds)
        }
    }

    @Test
    fun `non JSON and empty replies are handled`() = runTest {
        expectKind(BackendErrorKind.SERVER) { client(RecordingTransport { HttpResponse(502, "<html>Bad gateway</html>") }).describe(jpeg, 0) }
        expectKind(BackendErrorKind.TIMEOUT) { client(RecordingTransport { HttpResponse(504, "") }).describe(jpeg, 0) }
        expectKind(BackendErrorKind.BAD_RESPONSE) { client(RecordingTransport { HttpResponse(200, "not json") }).describe(jpeg, 0) }
        expectKind(BackendErrorKind.BAD_RESPONSE) { client(RecordingTransport { HttpResponse(200, "{}") }).describe(jpeg, 0) }
    }

    @Test
    fun `only the server's own not_configured code means the Meta key is missing`() = runTest {
        expectKind(BackendErrorKind.NOT_CONFIGURED) {
            client(RecordingTransport { HttpResponse(503, """{"error":{"code":"not_configured"}}""") }).describe(jpeg, 0)
        }
        expectKind(BackendErrorKind.SERVER) { client(RecordingTransport { HttpResponse(503, "Service Unavailable") }).describe(jpeg, 0) }
    }

    @Test
    fun `diagnostics report url, status and parsing without the key or image`() = runTest {
        val events = mutableListOf<String>()
        val logging = OpenEyesClient(config, RecordingTransport { ok("A chair.") }, Dispatchers.Unconfined) { events += it }
        logging.describe(jpeg, 0)
        val failing = OpenEyesClient(
            config,
            RecordingTransport { HttpResponse(429, """{"error":{"code":"quota_exceeded"}}""") },
            Dispatchers.Unconfined,
        ) { events += it }
        expectKind(BackendErrorKind.RATE_LIMITED) { failing.describe(jpeg, 0) }

        val all = events.joinToString("\n")
        assertTrue(all.contains(config.functionUrl))
        assertTrue(all.contains("HTTP 200"))
        assertTrue(all.contains("answer parsed"))
        assertTrue(all.contains("HTTP 429"))
        assertTrue(all.contains("serverCode=quota_exceeded"))
        assertFalse(all.contains(config.publicKey))
        assertFalse(all.contains("base64"))
    }

    @Test
    fun `network failures and timeouts are distinguished`() = runTest {
        expectKind(BackendErrorKind.TIMEOUT) { client(RecordingTransport { throw SocketTimeoutException() }).describe(jpeg, 0) }
        expectKind(BackendErrorKind.NETWORK) { client(RecordingTransport { throw IOException("offline") }).describe(jpeg, 0) }
    }

    @Test
    fun `missing server details stop the request before anything is sent`() = runTest {
        val transport = RecordingTransport { ok("x") }
        expectKind(BackendErrorKind.APP_NOT_CONFIGURED) { client(transport, BackendConfig("", "")).describe(jpeg, 0) }
        expectKind(BackendErrorKind.APP_NOT_CONFIGURED) { client(transport, BackendConfig("http://insecure.example", "k")).describe(jpeg, 0) }
        assertEquals(0, transport.calls)
        assertFalse(BackendConfig("http://insecure.example", "k").isComplete)
    }
}
