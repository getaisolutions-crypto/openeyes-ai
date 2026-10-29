import type { QuickReadResult } from '../../types/ai';
import { Notice } from '../Notice';

export function QuickReadCard({ result }: { result: QuickReadResult }) {
  if (!result.readable) {
    return (
      <div className="mt-4">
        <Notice variant="warning" title="Text cannot be read reliably">
          {result.reason || 'The photo may be blurry, dark or cut off.'} OpenEyes will not guess at the words. Try more
          light, hold the phone steady, or move closer so the text fills more of the photo.
        </Notice>
      </div>
    );
  }
  return (
    <section aria-labelledby="quick-read-heading" className="card mt-4 p-5 animate-fade-up">
      <h2 id="quick-read-heading" className="text-xl font-bold">
        Quick read
      </h2>
      <dl className="mt-3 space-y-4 text-lg">
        <div>
          <dt className="text-sm font-bold text-muted">Exact text found</dt>
          <dd className="whitespace-pre-line">{result.keyText}</dd>
        </div>
        {result.summary && (
          <div>
            <dt className="text-sm font-bold text-muted">What it seems to be (AI summary, not a quote)</dt>
            <dd>{result.summary}</dd>
          </div>
        )}
        {result.documentType !== 'unknown' && (
          <div>
            <dt className="text-sm font-bold text-muted">Document type (AI guess)</dt>
            <dd className="capitalize">{result.documentType}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
