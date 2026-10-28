import type { TranscriptEntry } from '../../hooks/useLiveExplore';
import { formatDateTime } from '../../utils/format';

const SPEAKER: Record<TranscriptEntry['speaker'], string> = { you: 'You', openeyes: 'OpenEyes', notice: 'Status' };

/**
 * Text record of the session. Deliberately not a live region: new replies are already spoken or
 * announced once, and a live log would make screen readers repeat them.
 */
export function LiveTranscript({ entries }: { entries: TranscriptEntry[] }) {
  return (
    <section aria-labelledby="live-transcript-heading">
      <h3 id="live-transcript-heading" className="text-lg font-bold">
        Transcript
      </h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-muted">Nothing yet. Questions and answers from this session appear here. They are not saved.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={`rounded-xl border-2 p-3 ${entry.speaker === 'openeyes' ? 'border-primary/40 bg-primary/5' : 'border-line'}`}
            >
              <p className="text-sm font-bold text-muted">
                {SPEAKER[entry.speaker]}, {formatDateTime(entry.at)}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-lg leading-relaxed">{entry.text}</p>
              {entry.basis && <p className="mt-1 text-sm text-muted">Based on: {entry.basis}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
