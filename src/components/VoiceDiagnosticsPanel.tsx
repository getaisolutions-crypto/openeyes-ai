import { useState } from 'react';
import { ClipboardCopy, RefreshCw } from 'lucide-react';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { CURRENT_BUILD } from '../services/updates/buildInfo';
import { clearDiagnostics, formatDiagnosticsReport, readDiagnostics } from '../services/voice/voiceDiagnostics';

/** Shows the last voice session's lifecycle from this tab. Contains no words, audio, images or keys. */
export function VoiceDiagnosticsPanel() {
  const { announce } = useAnnouncer();
  const [report, setReport] = useState(() => formatDiagnosticsReport(readDiagnostics(), CURRENT_BUILD.version));

  const refresh = () => {
    setReport(formatDiagnosticsReport(readDiagnostics(), CURRENT_BUILD.version));
    announce('Voice diagnostics refreshed.');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      announce('Voice diagnostics copied.');
    } catch {
      announce('Copying is not available here. Select the report text and copy it.');
    }
  };

  const clear = () => {
    clearDiagnostics();
    setReport(formatDiagnosticsReport(readDiagnostics(), CURRENT_BUILD.version));
    announce('Voice diagnostics cleared.');
  };

  return (
    <div className="space-y-3 py-3">
      <p className="text-ink/90">
        Details from the most recent voice conversation in this browser tab. They show states, error types and timings only. No
        words you said, no audio, no camera images and no keys are included. They are removed when you close the tab.
      </p>
      <label htmlFor="voice-diagnostics-report" className="font-bold">
        Privacy-safe report
      </label>
      <textarea
        id="voice-diagnostics-report"
        readOnly
        value={report}
        rows={15}
        className="field w-full font-mono text-sm"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <button type="button" className="btn-primary" onClick={() => void copy()}>
          <ClipboardCopy aria-hidden="true" className="h-5 w-5" /> Copy report
        </button>
        <button type="button" className="btn-secondary" onClick={refresh}>
          <RefreshCw aria-hidden="true" className="h-5 w-5" /> Refresh
        </button>
        <button type="button" className="btn-secondary" onClick={clear}>
          Clear details
        </button>
      </div>
    </div>
  );
}
