package ai.openeyes.glasses

import ai.openeyes.glasses.core.DiagnosticLog
import android.util.Log

/** Writes diagnostics to Logcat (tag "OpenEyes") in debug builds only; release builds log nothing. */
object AndroidDiagnosticLog : DiagnosticLog {
    private const val TAG = "OpenEyes"

    override fun log(event: String) {
        if (BuildConfig.DEBUG) Log.d(TAG, event)
    }
}
