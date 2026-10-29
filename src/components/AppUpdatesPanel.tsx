import { Download, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Notice } from './Notice';
import { describeVersion, useAppUpdate } from '../hooks/useAppUpdate';
import { formatDateTime } from '../utils/format';

function statusText(update: ReturnType<typeof useAppUpdate>): string {
  if (update.checking) return 'Checking';
  if (!update.result) return 'Not checked yet';
  if (update.result.status === 'up-to-date') return 'Up to date';
  if (update.result.status === 'update-available') return 'Update available';
  return 'Could not check';
}

export function AppUpdatesPanel() {
  const update = useAppUpdate();
  const { current, result, lastCheckedAt, checking, applying, busyLabels, error } = update;
  const latest = result && result.status !== 'failed' ? result.latest : null;

  return (
    <div className="space-y-4 py-3">
      <dl className="grid gap-3 text-lg sm:grid-cols-[auto_1fr] sm:gap-x-6">
        <dt className="text-muted">Current version</dt>
        <dd className="font-bold">{describeVersion(current)}</dd>
        <dt className="text-muted">Latest available version</dt>
        <dd className="font-bold">{latest ? describeVersion(latest) : result?.status === 'failed' ? 'Unknown' : 'Not checked yet'}</dd>
        <dt className="text-muted">Update status</dt>
        <dd className="font-bold">{statusText(update)}</dd>
      </dl>
      <p className="text-sm text-muted">
        Build {current.buildId}
        {lastCheckedAt ? `. Last checked ${formatDateTime(new Date(lastCheckedAt).toISOString())}.` : '.'}
      </p>

      {result?.status === 'failed' && (
        <Notice variant="warning" title="Update check failed">
          {result.message} This does not mean you have the latest version.
        </Notice>
      )}
      {error && (
        <Notice variant="error" title="Update problem">
          {error}
        </Notice>
      )}
      {result?.status === 'update-available' && busyLabels.length > 0 && (
        <p className="text-muted">
          The update waits until you finish. Updating now stops: {busyLabels.join(', ')}.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" className="btn-secondary w-full" onClick={() => void update.checkNow()} disabled={checking || applying}>
          {checking ? (
            <Loader2 aria-hidden="true" className="h-5 w-5 motion-safe:animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" className="h-5 w-5" />
          )}
          Check for updates
        </button>
        {result?.status === 'update-available' && (
          <button type="button" className="btn-primary w-full" onClick={() => update.requestConfirm('update')} disabled={applying}>
            <Download aria-hidden="true" className="h-5 w-5" />
            Update now
          </button>
        )}
        <button type="button" className="btn-secondary w-full" onClick={() => update.requestConfirm('clear-cache')} disabled={applying}>
          <Trash2 aria-hidden="true" className="h-5 w-5" />
          Clear cache &amp; reload
        </button>
      </div>

      <details className="rounded-2xl border border-line p-4">
        <summary className="min-h-[48px] cursor-pointer py-2 text-lg font-bold">If the old version still appears</summary>
        <div className="mt-2 space-y-3 text-ink/90">
          <p>Some browsers keep copies that apps cannot remove. You can refresh by hand:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>Android Chrome: open the Chrome menu (three dots) and tap Reload. If that is not enough, fully close Chrome from the recent apps screen and open OpenEyes again.</li>
            <li>Installed OpenEyes app: close it from the recent apps screen, then open it again.</li>
            <li>Desktop Chrome: press Control, Shift and R together (Command, Shift and R on a Mac).</li>
            <li>
              Last resort in Chrome: Settings, Privacy and security, Delete browsing data, and choose only Cached images and files.
              Do not choose cookies and site data, because that deletes your memories, contacts and settings.
            </li>
          </ul>
        </div>
      </details>
    </div>
  );
}
