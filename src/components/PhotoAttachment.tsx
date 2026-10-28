import { useState } from 'react';
import { Camera, ChevronDown } from 'lucide-react';
import type { CapturedImage } from '../types/camera';
import { formatDateTime } from '../utils/format';
import { CameraCapture } from './CameraCapture';

interface PhotoAttachmentProps {
  photo: CapturedImage | null;
  onPhotoChange: (photo: CapturedImage | null) => void;
}

/** Optional camera photo for the assistant. Hidden until the user asks for it. */
export function PhotoAttachment({ photo, onPhotoChange }: PhotoAttachmentProps) {
  const [open, setOpen] = useState(false);

  return (
    <section aria-label="Photo for your questions" className="card mt-4 p-4">
      <button
        type="button"
        className="flex min-h-[48px] w-full items-center justify-between gap-3 text-left font-bold"
        aria-expanded={open}
        aria-controls="assistant-photo-panel"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <Camera aria-hidden="true" className="h-6 w-6 text-primary" />
          {photo ? 'Photo attached' : 'Ask about a photo'}
        </span>
        <ChevronDown aria-hidden="true" className={`h-5 w-5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {photo && (
        <p className="mt-1 text-sm text-muted">
          Taken {formatDateTime(photo.capturedAt)}. Your questions will be answered using this photo until you remove it.
        </p>
      )}
      {/* Stays mounted while a photo is attached; otherwise unmounting on close also turns the camera off. */}
      <div id="assistant-photo-panel" hidden={!open} className="mt-3">
        {(open || photo) && <CameraCapture subject="your question" allowUpload onImageChange={onPhotoChange} />}
      </div>
    </section>
  );
}
