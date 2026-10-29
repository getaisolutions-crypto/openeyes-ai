import { Loader2, ScanSearch, Square } from 'lucide-react';
import { useObjectSearch } from '../../hooks/useObjectSearch';
import { CAMERA_ERRORS } from '../CameraCapture';
import { Notice } from '../Notice';
import { FindResultCard } from '../FindResultCard';
import { isConfidentMatch } from '../../services/find/objectSearch';

const STATUS_TEXT = {
  idle: '',
  starting: 'Starting the camera',
  analyzing: 'Checking this view',
  waiting: 'Keep moving the camera slowly',
  found: 'Possible match found',
  paused: 'Search paused',
  error: 'Search stopped',
} as const;

interface LiveObjectSearchProps {
  item: string;
  disabled: boolean;
  onRememberLocation: (location: string) => void;
}

export function LiveObjectSearch({ item, disabled, onRememberLocation }: LiveObjectSearchProps) {
  const search = useObjectSearch(item);
  const running = search.status !== 'idle';
  const camLive = search.cameraStatus === 'live' || search.cameraStatus === 'requesting';
  const result = search.lastResult;

  return (
    <section aria-labelledby="live-search-heading" className="card mt-4 overflow-hidden">
      <div className="p-5 pb-3">
        <h2 id="live-search-heading" className="flex items-center gap-2 text-xl font-bold">
          <ScanSearch aria-hidden="true" className="h-6 w-6 text-primary" /> Search with the live camera
        </h2>
        <p className="mt-1 text-muted">
          OpenEyes checks one camera view every few seconds and tells you what it notices. It only describes positions in
          the camera image and cannot measure distance.
        </p>
      </div>

      {camLive && (
        <div className="relative aspect-[4/3] w-full bg-black">
          <video
            ref={search.videoRef}
            className="h-full w-full object-cover"
            playsInline
            muted
            aria-label="Live search camera preview"
          />
        </div>
      )}

      <div className="p-5 pt-3">
        {running && (
          <p role="status" aria-live="polite" className="flex items-center gap-2 font-bold">
            {(search.status === 'analyzing' || search.status === 'starting') && (
              <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
            )}
            {STATUS_TEXT[search.status]}
            {search.scans > 0 && `, ${search.scans} ${search.scans === 1 ? 'view' : 'views'} checked`}
          </p>
        )}
        {search.message && <p className="mt-2 text-lg">{search.message}</p>}

        {search.cameraStatus === 'error' && search.cameraError && (
          <div className="mt-3">
            <Notice variant="error" title={CAMERA_ERRORS[search.cameraError].title}>
              {CAMERA_ERRORS[search.cameraError].body}
            </Notice>
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {!running ? (
            <button
              type="button"
              className="btn-primary text-lg"
              disabled={disabled}
              onClick={() => void search.begin()}
            >
              <ScanSearch aria-hidden="true" className="h-6 w-6" /> Start live search for {item || 'item'}
            </button>
          ) : (
            <>
              {(search.status === 'found' || search.status === 'paused' || search.status === 'error') && (
                <button type="button" className="btn-primary text-lg" onClick={search.keepLooking}>
                  <ScanSearch aria-hidden="true" className="h-6 w-6" /> Keep looking
                </button>
              )}
              <button type="button" className="btn-secondary text-lg" onClick={() => search.end()}>
                <Square aria-hidden="true" className="h-5 w-5" /> Stop search
              </button>
            </>
          )}
        </div>

        {result && <FindResultCard result={result} />}
        {result && isConfidentMatch(result) && (
          <button
            type="button"
            className="btn-secondary mt-3 w-full"
            onClick={() => onRememberLocation(result.positionDescription)}
          >
            Remember this location
          </button>
        )}
      </div>
    </section>
  );
}
