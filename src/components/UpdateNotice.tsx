import { Download, Loader2 } from 'lucide-react';
import { ConfirmDialog } from './Dialog';
import { Notice } from './Notice';
import { UPDATE_AVAILABLE_MESSAGE, useAppUpdate } from '../hooks/useAppUpdate';

export const CLEAR_CACHE_CONFIRMATION =
  'Clear cached app files and reload OpenEyes AI? Your memories, trusted contacts, and personal settings will be kept.';
export const UPDATE_CONFIRMATION =
  'OpenEyes AI will stop the camera, microphone and speech, then reload to install the new version. Your memories, trusted contacts, and personal settings will be kept.';

/** App-wide update banner plus the confirmation dialogs used by the banner and Settings. */
export function UpdateNotice() {
  const { bannerVisible, applying, error, result, confirming, requestConfirm, apply, dismiss } = useAppUpdate();
  const retryReason = result?.status === 'update-available' ? 'update' : 'clear-cache';

  return (
    <>
      {(bannerVisible || applying || error) && (
        <div className="mx-auto w-full max-w-2xl px-4 pt-4">
          {applying ? (
            <div role="status" className="card flex items-center gap-3 p-4 text-lg font-bold">
              <Loader2 aria-hidden="true" className="h-6 w-6 shrink-0 motion-safe:animate-spin" />
              Reloading OpenEyes AI. Your data is kept.
            </div>
          ) : error ? (
            <Notice
              variant="error"
              title="Update problem"
              action={
                <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => requestConfirm(retryReason)}>
                  Try again
                </button>
              }
            >
              {error}
            </Notice>
          ) : (
            <section aria-label="App update" className="card animate-fade-up p-4">
              <p className="flex items-start gap-3 text-lg font-bold">
                <Download aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
                {UPDATE_AVAILABLE_MESSAGE}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <button type="button" className="btn-primary w-full" onClick={() => requestConfirm('update')}>
                  Update now
                </button>
                <button type="button" className="btn-secondary w-full" onClick={dismiss}>
                  Later
                </button>
              </div>
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming === 'update'}
        title="Update OpenEyes AI?"
        message={UPDATE_CONFIRMATION}
        confirmLabel="Update and reload"
        onConfirm={() => void apply('update')}
        onCancel={() => requestConfirm(null)}
      />
      <ConfirmDialog
        open={confirming === 'clear-cache'}
        title="Clear cache and reload?"
        message={CLEAR_CACHE_CONFIRMATION}
        confirmLabel="Clear cache and reload"
        onConfirm={() => void apply('clear-cache')}
        onCancel={() => requestConfirm(null)}
      />
    </>
  );
}
