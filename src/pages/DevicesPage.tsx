import { useState, type ReactNode } from 'react';
import { Camera, Glasses, Mic, RefreshCw, Smartphone } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge, PlannedBadge } from '../components/StatusBadge';
import { Dialog } from '../components/Dialog';
import { OptionGroup } from '../components/FormControls';
import { useDeviceStatus } from '../hooks/useDeviceStatus';
import { useServices } from '../services/ServicesContext';
import { useSettings } from '../hooks/useSettings';
import { useAnnouncer } from '../hooks/useAnnouncer';
import type { DeviceInfo } from '../types/devices';
import type { CameraSourceId } from '../types/camera';

export default function DevicesPage() {
  const { devices } = useServices();
  const { status, refresh } = useDeviceStatus();
  const { settings, updateSettings } = useSettings();
  const { announce } = useAnnouncer();
  const [connecting, setConnecting] = useState(false);
  const [connectMessage, setConnectMessage] = useState<string | null>(null);

  const connectGlasses = async () => {
    setConnecting(true);
    const result = await devices.metaGlasses.connect?.();
    setConnecting(false);
    if (!result) return;
    if (result.ok) {
      announce(`${result.info.label} connected.`);
      await refresh();
    } else {
      setConnectMessage(result.message);
    }
  };

  const onRefresh = async () => {
    await refresh();
    announce('Device status updated.');
  };

  return (
    <>
      <PageHeader
        title="Devices"
        icon={<Smartphone className="h-7 w-7" />}
        description="See which cameras and microphones OpenEyes can use."
      />

      <ul className="space-y-3">
        <DeviceCard icon={Camera} info={status.phoneCamera} fallbackLabel="Phone Camera" />
        <DeviceCard icon={Mic} info={status.phoneMicrophone} fallbackLabel="Phone Microphone" />
        <DeviceCard icon={Glasses} info={status.metaGlasses} fallbackLabel="Meta Glasses">
          <button type="button" className="btn-primary mt-4 w-full" onClick={connectGlasses} disabled={connecting}>
            <Glasses aria-hidden="true" className="h-5 w-5" /> Connect Meta Glasses
          </button>
        </DeviceCard>
      </ul>

      <button type="button" className="btn-secondary mt-4 w-full" onClick={onRefresh}>
        <RefreshCw aria-hidden="true" className="h-5 w-5" /> Check devices again
      </button>

      <section className="card mt-6 p-5" aria-label="Camera source">
        <OptionGroup<CameraSourceId>
          legend="Camera source"
          name="camera-source"
          value={settings.cameraSource}
          onChange={(cameraSource) => updateSettings({ cameraSource })}
          options={[
            { value: 'phone', label: 'Phone camera', description: 'Uses the rear camera of this phone.' },
            {
              value: 'meta-glasses',
              label: 'Meta glasses camera',
              description: 'Requires the native Android app. Not available yet.',
              disabled: true,
              badge: <PlannedBadge />,
            },
          ]}
        />
      </section>

      <section aria-labelledby="permissions-heading" className="card mt-4 p-5">
        <h2 id="permissions-heading" className="text-xl font-bold">
          About permissions
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-ink/90">
          <li>OpenEyes asks for the camera only when you press Turn on camera, and turns it off when you leave the screen.</li>
          <li>The microphone is used only while you are using voice input.</li>
          <li>Photos are never uploaded in this version. They stay on this device.</li>
          <li>You can change or revoke permissions at any time in your browser or phone settings.</li>
        </ul>
      </section>

      <Dialog
        open={Boolean(connectMessage)}
        title="Meta glasses not available yet"
        onClose={() => setConnectMessage(null)}
        footer={
          <button type="button" className="btn-primary" onClick={() => setConnectMessage(null)} data-autofocus>
            OK
          </button>
        }
      >
        <p className="text-lg">{connectMessage}</p>
        <p className="mt-3 text-muted">Status: Not Connected.</p>
      </Dialog>
    </>
  );
}

interface DeviceCardProps {
  icon: typeof Camera;
  info: DeviceInfo | null;
  fallbackLabel: string;
  children?: ReactNode;
}

function DeviceCard({ icon: Icon, info, fallbackLabel, children }: DeviceCardProps) {
  const label = info?.label ?? fallbackLabel;
  return (
    <li className="card p-5">
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface-2">
          <Icon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">{label}</h2>
            <StatusBadge state={info?.state} />
          </div>
          <p className="mt-1 text-muted">{info?.detail ?? 'Checking device status.'}</p>
        </div>
      </div>
      {children}
    </li>
  );
}
