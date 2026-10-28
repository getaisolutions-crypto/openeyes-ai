import { CircleDashed, CircleCheck, CircleSlash, CircleX, Loader2, Link2Off } from 'lucide-react';
import type { DeviceState } from '../types/devices';

const STATE: Record<DeviceState, { text: string; className: string; icon: typeof CircleCheck }> = {
  available: { text: 'Available', className: 'text-success border-success/50', icon: CircleCheck },
  connected: { text: 'Connected', className: 'text-success border-success/50', icon: CircleCheck },
  unavailable: { text: 'Unavailable', className: 'text-danger border-danger/50', icon: CircleX },
  'permission-denied': { text: 'Blocked', className: 'text-danger border-danger/50', icon: CircleSlash },
  'not-connected': { text: 'Not Connected', className: 'text-muted border-line', icon: Link2Off },
  checking: { text: 'Checking', className: 'text-muted border-line', icon: Loader2 },
};

/** Status pill with icon and text, so state is never conveyed by color alone. */
export function StatusBadge({ state }: { state: DeviceState | undefined }) {
  const s = STATE[state ?? 'checking'];
  const Icon = state ? s.icon : CircleDashed;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-bold ${s.className}`}>
      <Icon aria-hidden="true" className={`h-4 w-4 ${state === 'checking' || !state ? 'motion-safe:animate-spin' : ''}`} />
      {s.text}
    </span>
  );
}

export function PlannedBadge({ label = 'Planned' }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-accent/60 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-accent">
      {label}
    </span>
  );
}
