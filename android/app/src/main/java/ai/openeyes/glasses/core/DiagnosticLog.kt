package ai.openeyes.glasses.core

/** Development diagnostics. Implementations must never receive keys, headers, image data or spoken words. */
fun interface DiagnosticLog {
    fun log(event: String)

    companion object {
        val NONE = DiagnosticLog { }
    }
}
