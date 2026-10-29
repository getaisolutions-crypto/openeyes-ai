package ai.openeyes.glasses.backend

import java.net.HttpURLConnection
import java.net.URL

class UrlConnectionTransport : HttpTransport {
    override fun post(url: String, headers: Map<String, String>, body: String, timeoutMs: Int): HttpResponse =
        request(url, "POST", headers, timeoutMs) { connection ->
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }

    override fun get(url: String, headers: Map<String, String>, timeoutMs: Int): HttpResponse =
        request(url, "GET", headers, timeoutMs) {}

    private fun request(
        url: String,
        method: String,
        headers: Map<String, String>,
        timeoutMs: Int,
        writeBody: (HttpURLConnection) -> Unit,
    ): HttpResponse {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = minOf(timeoutMs, 15_000)
            connection.readTimeout = timeoutMs
            headers.forEach { (k, v) -> connection.setRequestProperty(k, v) }
            writeBody(connection)
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return HttpResponse(status, text)
        } finally {
            connection.disconnect()
        }
    }
}
