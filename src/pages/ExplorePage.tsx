import { useState } from 'react';
import { ScanEye, Sparkles } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { CameraCapture } from '../components/CameraCapture';
import { Notice } from '../components/Notice';
import { useServices } from '../services/ServicesContext';
import type { CapturedImage } from '../types/camera';

export default function ExplorePage() {
  const { vision } = useServices();
  const [image, setImage] = useState<CapturedImage | null>(null);
  const status = vision.getStatus();

  return (
    <>
      <PageHeader
        title="Explore"
        icon={<ScanEye className="h-7 w-7" />}
        description="Take a photo of what is around you. Descriptions will be added when Meta AI is connected."
      />

      <CameraCapture subject="your surroundings" onImageChange={setImage} />

      <div className="mt-4 space-y-4">
        <button type="button" className="btn-primary w-full text-lg" disabled={!image || !status.available}>
          <Sparkles aria-hidden="true" className="h-6 w-6" /> Describe my surroundings
        </button>
        {!status.available && (
          <Notice variant="warning" title="Scene description not available yet">
            {image
              ? 'Your photo is ready, but OpenEyes cannot describe it yet because image understanding is not connected. The photo stayed on your device.'
              : 'Taking photos works today. Describing them requires the Meta AI connection, which is planned for the next phase.'}
          </Notice>
        )}
      </div>
    </>
  );
}
