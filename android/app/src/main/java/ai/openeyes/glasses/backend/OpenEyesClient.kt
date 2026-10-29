package ai.openeyes.glasses.backend

import ai.openeyes.glasses.core.AnswerBasis
import ai.openeyes.glasses.core.ChatTurn
import ai.openeyes.glasses.core.Confidence
import ai.openeyes.glasses.core.DiagnosticLog
import ai.openeyes.glasses.core.FindResult
import ai.openeyes.glasses.core.ReadResult
import ai.openeyes.glasses.core.ResponseLength
import ai.openeyes.glasses.core.SceneChange
import ai.openeyes.glasses.core.SceneCheck
import ai.openeyes.glasses.core.TextAnswer
import ai.openeyes.glasses.core.Visibility
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

enum class BackendErrorKind {
    /** This APK was built without the server address or public key; nothing was sent. */
    APP_NOT_CONFIGURED,
    /** The server answered that its Meta API key is missing. */
    NOT_CONFIGURED,
    AUTH, RATE_LIMITED, TIMEOUT, NETWORK, IMAGE_REJECTED, REJECTED, BAD_RESPONSE, SERVER,
}

class BackendException(val kind: BackendErrorKind, val retryAfterSeconds: Int? = null) : Exception(kind.name)

data class HttpResponse(val status: Int, val body: String)

/** Blocking HTTP calls; throw [SocketTimeoutException] on timeout and [IOException] on network failure. */
fun interface HttpTransport {
    fun post(url: String, headers: Map<String, String>, body: String, timeoutMs: Int): HttpResponse

    fun get(url: String, headers: Map<String, String>, timeoutMs: Int): HttpResponse =
        throw IOException("GET is not supported by this transport")
}

/**
 * @param functionUrl the existing openeyes-ai server function the website uses.
 * @param publicKey the public (anon) key the website also ships. The Meta API key stays on the server.
 */
data class BackendConfig(val functionUrl: String, val publicKey: String, val timeoutMs: Int = 60_000) {
    val isComplete: Boolean get() = functionUrl.startsWith("https://") && publicKey.isNotBlank()
}

enum class AiReadiness { CHECKING, READY, APP_NOT_CONFIGURED, SERVER_NOT_CONFIGURED, UNREACHABLE }

/** Talks to the same OpenEyes server function and request format as the website. */
class OpenEyesClient(
    private val config: BackendConfig,
    private val transport: HttpTransport,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val log: DiagnosticLog = DiagnosticLog.NONE,
) : VisionBackend {

    override suspend fun describe(jpeg: ByteArray, capturedAtMs: Long): String =
        textOf(
            send(
                "describe",
                JSONObject()
                    .put("task", "describe")
                    .put("responseLength", "brief")
                    .put("image", image(jpeg, capturedAtMs)),
            ),
        )

    override suspend fun ask(question: String, jpeg: ByteArray, capturedAtMs: Long): String =
        textOf(
            send(
                "chat",
                JSONObject()
                    .put("task", "chat")
                    .put("responseLength", "brief")
                    .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", question.take(1000))))
                    .put("image", image(jpeg, capturedAtMs)),
            ),
        )

    override suspend fun sceneCheck(jpeg: ByteArray, capturedAtMs: Long, previousSummary: String?): SceneCheck {
        val payload = JSONObject()
            .put("task", "scene_check")
            .put("image", image(jpeg, capturedAtMs))
        previousSummary?.takeIf { it.isNotBlank() }?.let { payload.put("previousSummary", it.take(1000)) }
        return parseScene(send("scene_check", payload))
    }

    override suspend fun find(objectName: String, jpeg: ByteArray, capturedAtMs: Long): FindResult =
        parseFind(
            send(
                "find",
                JSONObject()
                    .put("task", "find")
                    .put("objectName", objectName.take(80))
                    .put("image", image(jpeg, capturedAtMs)),
            ),
        )

    override suspend fun read(jpeg: ByteArray, capturedAtMs: Long): ReadResult =
        parseRead(send("read", JSONObject().put("task", "read").put("image", image(jpeg, capturedAtMs))))

    override suspend fun askText(question: String, jpeg: ByteArray, capturedAtMs: Long): TextAnswer =
        parseTextAnswer(
            send(
                "ask_text",
                JSONObject()
                    .put("task", "ask_text")
                    .put("question", question.take(300))
                    .put("image", image(jpeg, capturedAtMs)),
            ),
        )

    override suspend fun chat(turns: List<ChatTurn>, length: ResponseLength): String {
        val messages = JSONArray()
        turns.takeLast(MAX_CHAT_TURNS).forEach {
            messages.put(JSONObject().put("role", it.role.wire).put("content", it.content.take(MAX_TURN_CHARS)))
        }
        return textOf(
            send("chat", JSONObject().put("task", "chat").put("responseLength", length.wire).put("messages", messages)),
        )
    }

    /** GET on the same function reports whether the server has its Meta key; it never runs a model request. */
    suspend fun checkReady(): AiReadiness {
        if (!config.isComplete) return AiReadiness.APP_NOT_CONFIGURED
        return withContext(io) {
            try {
                val response = transport.get(config.functionUrl, headers(), 15_000)
                log.log("backend: GET status HTTP ${response.status}")
                val configured = response.status in 200..299 &&
                    runCatching { JSONObject(response.body).optBoolean("configured", false) }.getOrDefault(false)
                when {
                    configured -> AiReadiness.READY
                    response.status in 200..299 -> AiReadiness.SERVER_NOT_CONFIGURED
                    else -> AiReadiness.UNREACHABLE
                }
            } catch (e: IOException) {
                log.log("backend: GET status failed ${e.javaClass.simpleName}")
                AiReadiness.UNREACHABLE
            }
        }
    }

    private fun headers() = mapOf(
        "Authorization" to "Bearer ${config.publicKey}",
        "apikey" to config.publicKey,
        "Content-Type" to "application/json",
    )

    private fun image(jpeg: ByteArray, capturedAtMs: Long): JSONObject =
        JSONObject()
            .put("dataUrl", "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(jpeg))
            .put("capturedAt", Instant.ofEpochMilli(capturedAtMs).toString())

    private suspend fun send(task: String, payload: JSONObject): JSONObject {
        if (!config.isComplete) {
            log.log("backend: app built without server address or public key; request not sent")
            throw BackendException(BackendErrorKind.APP_NOT_CONFIGURED)
        }
        val body = payload.toString()
        log.log("backend: POST ${config.functionUrl} task=$task bodyChars=${body.length}")
        val started = System.currentTimeMillis()
        val response = withContext(io) {
            try {
                transport.post(config.functionUrl, headers(), body, config.timeoutMs)
            } catch (e: SocketTimeoutException) {
                log.log("backend: timed out after ${System.currentTimeMillis() - started} ms")
                throw BackendException(BackendErrorKind.TIMEOUT)
            } catch (e: IOException) {
                log.log("backend: network failure ${e.javaClass.simpleName}")
                throw BackendException(BackendErrorKind.NETWORK)
            }
        }
        log.log("backend: HTTP ${response.status} in ${System.currentTimeMillis() - started} ms")
        return try {
            parseBody(response).also { log.log("backend: answer parsed (${it.length()} fields)") }
        } catch (e: BackendException) {
            log.log("backend: failed kind=${e.kind} serverCode=${serverCode(response) ?: "none"}")
            throw e
        }
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

        // A bare 503 without an error code comes from the hosting gateway, not from a missing Meta key.
        fun kindForStatus(status: Int): BackendErrorKind = when {
            status == 401 || status == 403 -> BackendErrorKind.AUTH
            status == 413 || status == 415 -> BackendErrorKind.IMAGE_REJECTED
            status == 429 -> BackendErrorKind.RATE_LIMITED
            status == 504 -> BackendErrorKind.TIMEOUT
            status in 400..499 -> BackendErrorKind.REJECTED
            else -> BackendErrorKind.SERVER
        }

        private fun serverCode(response: HttpResponse): String? = try {
            JSONObject(response.body).optJSONObject("error")?.optString("code")?.takeIf { it.isNotEmpty() }
        } catch (e: JSONException) {
            null
        }

        /** Checks status and error codes; returns the JSON body of a successful reply. */
        fun parseBody(response: HttpResponse): JSONObject {
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
            return body
        }

        /** Text reply of tasks "describe" and "chat". */
        fun parse(response: HttpResponse): String = textOf(parseBody(response))

        private fun textOf(body: JSONObject): String {
            val text = body.optString("text", "").trim()
            if (text.isEmpty()) throw BackendException(BackendErrorKind.BAD_RESPONSE)
            return text
        }

        private fun confidence(value: String?): Confidence = when (value) {
            "high" -> Confidence.HIGH
            "medium" -> Confidence.MEDIUM
            else -> Confidence.LOW
        }

        fun parseScene(body: JSONObject): SceneCheck {
            val scene = body.optJSONObject("scene") ?: throw BackendException(BackendErrorKind.BAD_RESPONSE)
            val summary = scene.optString("summary", "").trim()
            if (summary.isEmpty()) throw BackendException(BackendErrorKind.BAD_RESPONSE)
            val objects = scene.optJSONArray("objects")?.let { arr ->
                (0 until arr.length()).mapNotNull { arr.optString(it, "").trim().takeIf(String::isNotEmpty) }
            }.orEmpty()
            val changes = scene.optJSONArray("changes")?.let { arr ->
                (0 until arr.length()).mapNotNull { i ->
                    val c = arr.optJSONObject(i) ?: return@mapNotNull null
                    val text = c.optString("text", "").trim()
                    if (text.isEmpty()) null else SceneChange(c.optString("category", "other"), text)
                }
            }.orEmpty()
            return SceneCheck(summary, objects, changes, confidence(scene.optString("confidence")))
        }

        fun parseFind(body: JSONObject): FindResult {
            val find = body.optJSONObject("find") ?: throw BackendException(BackendErrorKind.BAD_RESPONSE)
            val visibility = when (find.optString("visibility")) {
                "visible" -> Visibility.VISIBLE
                "not_visible" -> Visibility.NOT_VISIBLE
                "uncertain" -> Visibility.UNCERTAIN
                else -> throw BackendException(BackendErrorKind.BAD_RESPONSE)
            }
            val position = if (visibility == Visibility.NOT_VISIBLE) "" else find.optString("position", "").trim()
            return FindResult(visibility, position, confidence(find.optString("confidence")), find.optString("suggestion", "").trim())
        }

        fun parseRead(body: JSONObject): ReadResult {
            if (!body.has("readable")) throw BackendException(BackendErrorKind.BAD_RESPONSE)
            val text = body.optString("text", "").trim()
            val readable = body.optBoolean("readable", false) && text.isNotEmpty()
            return ReadResult(if (readable) text else "", readable)
        }

        fun parseTextAnswer(body: JSONObject): TextAnswer {
            val answer = body.optJSONObject("answer") ?: throw BackendException(BackendErrorKind.BAD_RESPONSE)
            val text = answer.optString("answer", "").trim()
            val basis = when (answer.optString("basis")) {
                "exact" -> AnswerBasis.EXACT
                "summary" -> AnswerBasis.SUMMARY
                "inference" -> AnswerBasis.INFERENCE
                "not_found" -> AnswerBasis.NOT_FOUND
                else -> throw BackendException(BackendErrorKind.BAD_RESPONSE)
            }
            if (text.isEmpty()) throw BackendException(BackendErrorKind.BAD_RESPONSE)
            return TextAnswer(text, basis, if (basis == AnswerBasis.NOT_FOUND) "" else answer.optString("quote", "").trim())
        }

        private const val MAX_CHAT_TURNS = 12
        private const val MAX_TURN_CHARS = 2000
    }
}
