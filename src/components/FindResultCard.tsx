import { useId } from 'react';
import { CheckCircle2, HelpCircle, XCircle } from 'lucide-react';
import type { ObjectDetectionResult } from '../types/ai';
import { SafetyNote, SpeechControls } from './AIResult';

const CONFIDENCE_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;

export function describeFindResult(result: ObjectDetectionResult): string {
  const item = result.query;
  const headline =
    result.visibility === 'visible'
      ? `${item} appears to be in the photo.`
      : result.visibility === 'not-visible'
        ? `OpenEyes did not see ${item.toLowerCase()} in this photo.`
        : `OpenEyes is not sure whether ${item.toLowerCase()} is in the photo.`;
  return [headline, result.positionDescription, result.suggestion].filter(Boolean).join(' ');
}

export function FindResultCard({ result }: { result: ObjectDetectionResult }) {
  const headingId = useId();
  const Icon = result.visibility === 'visible' ? CheckCircle2 : result.visibility === 'not-visible' ? XCircle : HelpCircle;
  const tone =
    result.visibility === 'visible' ? 'text-success' : result.visibility === 'not-visible' ? 'text-danger' : 'text-warning';
  const headline =
    result.visibility === 'visible' ? 'Probably in the photo' : result.visibility === 'not-visible' ? 'Not seen' : 'Not sure';

  return (
    <section aria-labelledby={headingId} className="card mt-4 p-5 animate-fade-up">
      <h2 id={headingId} className="flex items-center gap-2 text-xl font-bold">
        <Icon aria-hidden="true" className={`h-6 w-6 ${tone}`} /> {headline}: {result.query}
      </h2>
      <dl className="mt-3 space-y-3 text-lg">
        {result.positionDescription && (
          <div>
            <dt className="text-sm font-bold text-muted">Where</dt>
            <dd>{result.positionDescription}</dd>
          </div>
        )}
        <div>
          <dt className="text-sm font-bold text-muted">Confidence</dt>
          <dd>{CONFIDENCE_LABEL[result.confidence]}</dd>
        </div>
        {result.suggestion && (
          <div>
            <dt className="text-sm font-bold text-muted">Try next</dt>
            <dd>{result.suggestion}</dd>
          </div>
        )}
      </dl>
      <SpeechControls text={describeFindResult(result)} />
      <SafetyNote />
    </section>
  );
}
