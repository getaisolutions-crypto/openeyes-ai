package ai.openeyes.glasses.backend

import ai.openeyes.glasses.core.VisionBackend
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.SocketTimeoutException
import java.time.Instant
import java.util.Base64

enum class BackendErrorKind { NOT_CONFIGURED, AUTH, RATE_LIMITED, TIMEOUT, NETWORK, IMAGE_REJECTED, REJECTED, BAD_RESPONSE, SERVER }

class BackendException(val kind: BackendErrorKind, val retryAfterSeconds: Int? = null) : Exception(kind.name)

data class HttpResponse(val status: Int, val body: String)

/** Blocking HTTP POST; throws [SocketTimeoutException] on timeout and [IOException] on network failure. */
fun interface HttpTransport {
    fun post(url: String, headers: Map<String, String>, body: String, timeoutMs: Int): HttpResponse
}

/**
 * @param functionUrl the existing openeyes-ai server function.
 * @param publicKey the public (anon) key the website also uses. The Meta API key stays on the server.
 */
data class BackendConfig(val functionUrl: String, val publicKey: String, val timeoutMs: Int = 60_000) {
    val isComplete: Boolean get() = functionUrl.startsWith("https://") && publicKey.isNotBlank()
}

/** Talks to the same OpenEyes server function and request format as the website. */
class OpenEyesClient(
    private val config: BackendConfig,
    private val transport: HttpTransport,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : VisionBackend {

    override suspend fun describe(jpeg: ByteArray, capturedAtMs: Long): String =
        send(
            JSONObject()
                .put("task", "describe")
                .put("responseLength", "brief")
                .put("image", image(jpeg, capturedAtMs)),
        )

    override suspend fun ask(question: String, jpeg: ByteArray, capturedAtMs: Long): String =
        send(
            JSONObject()
                .put("task", "chat")
                .put("responseLength", "brief")
                .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", question.take(1000))))
                .put("image", image(jpeg, capturedAtMs)),
        )

    private fun image(jpeg: ByteArray, capturedAtMs: Long): JSONObject =
        JSONObject()
            .put("dataUrl", "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(jpeg))
            .put("capturedAt", Instant.ofEpochMilli(capturedAtMs).toString())

    private suspend fun send(payload: JSONObject): String {
        if (!config.isComplete) throw BackendException(BackendErrorKind.NOT_CONFIGURED)
        val response = withContext(io) {
            try {
                transport.post(
                    config.functionUrl,
                    mapOf(
                        "Authorization" to "Bearer ${config.publicKey}",
                        "apikey" to config.publicKey,
                        "Content-Type" to "application/json",
                    ),
                    payload.toString(),
                    config.timeoutMs,
                )
            } catch (e: SocketTimeoutException) {
                throw BackendException(BackendErrorKind.TIMEOUT)
            } catch (e: IOException) {
                throw BackendException(BackendErrorKind.NETWORK)
            }
        }
        return parse(response)
    }

    companion object {
        private val CODE_TO_KIND = mapOf(
            "not_configured" to BackendErrorKind.NOT_CONFIGURED,
            "invalid_request" to BackendErrorKind.REJECTED,
            "unsupported_image" to BackendErrorKind.IMAGE_REJECTED,
            "image_too_large" to BackendErrorKind.IMAGE_REJECTED,
            "quota_exceeded" to BackendErrorKind.RATE_LIMITED,
            "quota_unavailable" to BackendErrorKind.SERVER,
            "meta_auth_failed" to BackendErrorKind.AUTH,
            "meta_rate_limited" to BackendErrorKind.RATE_LIMITED,
            "meta_rejected" to BackendErrorKind.REJECTED,
            "meta_timeout" to BackendErrorKind.TIMEOUT,
            "meta_unreachable" to BackendErrorKind.NETWORK,
            "meta_error" to BackendErrorKind.SERVER,
            "meta_bad_response" to BackendErrorKind.BAD_RESPONSE,
            "internal_error" to BackendErrorKind.SERVER,
        )

        fun kindForStatus(status: Int): BackendErrorKind = when {
            status == 401 || status == 403 -> BackendErrorKind.AUTH
            status == 413 || status == 415 -> BackendErrorKind.IMAGE_REJECTED
            status == 429 -> BackendErrorKind.RATE_LIMITED
            status == 503 -> BackendErrorKind.NOT_CONFIGURED
            status == 504 -> BackendErrorKind.TIMEOUT
            status in 400..499 -> BackendErrorKind.REJECTED
            else -> BackendErrorKind.SERVER
        }

        fun parse(response: HttpResponse): String {
            val body = try {
                JSONObject(response.body)
            } catch (e: JSONException) {
                throw BackendException(if (response.status in 200..299) BackendErrorKind.BAD_RESPONSE else kindForStatus(response.status))
            }
            if (response.status !in 200..299) {
                val error = body.optJSONObject("error")
                val kind = error?.optString("code")?.let { CODE_TO_KIND[it] } ?: kindForStatus(response.status)
                val retry = error?.takeIf { it.has("retryAfterSeconds") }?.optInt("retryAfterSeconds")
                throw BackendException(kind, retry)
            }
            val text = body.optString("text", "").trim()
            if (text.isEmpty()) throw BackendException(BackendErrorKind.BAD_RESPONSE)
            return text
        }
    }
}
