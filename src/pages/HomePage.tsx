import { Link } from 'react-router-dom';
import { BookOpenText, Brain, ChevronRight, Glasses, Mic, ScanEye, Search, Smartphone, Users } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { useDeviceStatus } from '../hooks/useDeviceStatus';
import { useServices } from '../services/ServicesContext';

const SECONDARY_ACTIONS = [
  { to: '/explore', label: 'Describe My Surroundings', icon: ScanEye },
  { to: '/find', label: 'Find Something', icon: Search },
  { to: '/read', label: 'Read Text', icon: BookOpenText },
  { to: '/memory', label: 'My Memories', icon: Brain },
];

export default function HomePage() {
  const { status } = useDeviceStatus();
  const { voice } = useServices();
  const { lastMessage } = useAnnouncer();
  const voiceInput = voice.isRecognitionSupported();

  return (
    <>
      <PageHeader title="OpenEyes AI" description="Your World, Understood." />

      <Link
        to="/assistant"
        state={{ autoListen: voiceInput }}
        className="group relative flex min-h-[132px] items-center gap-5 overflow-hidden rounded-[1.75rem] bg-primary p-6 text-on-primary shadow-lg shadow-primary/20 transition-transform duration-200 active:scale-[0.99] animate-fade-up"
      >
        <span aria-hidden="true" className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-on-primary/15">
          <Mic className="h-10 w-10" />
        </span>
        <span>
          <span className="block text-2xl font-bold">Talk to OpenEyes</span>
          <span className="mt-1 block text-on-primary/85">
            {voiceInput ? 'Speak or type a question' : 'Type a question. Voice input is not supported in this browser.'}
          </span>
        </span>
      </Link>

      <nav aria-label="Quick actions" className="mt-4">
        <ul className="grid grid-cols-2 gap-3">
          {SECONDARY_ACTIONS.map(({ to, label, icon: Icon }, i) => (
            <li key={to} className="animate-fade-up" style={{ animationDelay: `${60 * (i + 1)}ms` }}>
              <Link
                to={to}
                className="card flex h-full min-h-[120px] flex-col justify-between gap-3 p-4 transition-colors hover:border-primary"
              >
                <Icon aria-hidden="true" className="h-8 w-8 text-primary" />
                <span className="text-lg font-bold leading-tight">{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="status-heading" className="card mt-6 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="status-heading" className="text-xl font-bold">
            Device status
          </h2>
          <Link to="/devices" className="flex min-h-[48px] items-center gap-1 rounded-lg px-2 font-bold text-primary">
            Devices <ChevronRight aria-hidden="true" className="h-5 w-5" />
          </Link>
        </div>
        <ul className="mt-2 divide-y divide-line">
          <StatusRow icon={Smartphone} label="Phone Camera" state={status.phoneCamera?.state} />
          <StatusRow icon={Mic} label="Microphone" state={status.phoneMicrophone?.state} />
          <StatusRow icon={Mic} label="Voice input" state={voiceInput ? 'available' : 'unavailable'} />
          <StatusRow icon={Glasses} label="Meta Glasses" state={status.metaGlasses?.state} />
        </ul>
      </section>

      <section aria-labelledby="announce-heading" className="card mt-4 p-5">
        <h2 id="announce-heading" className="text-xl font-bold">
          Latest status
        </h2>
        <p className="mt-2 text-muted">{lastMessage || 'No announcements yet.'}</p>
      </section>

      <Link
        to="/trusted-circle"
        className="card mt-4 flex min-h-[64px] items-center gap-4 p-5 transition-colors hover:border-primary"
      >
        <Users aria-hidden="true" className="h-7 w-7 text-primary" />
        <span className="flex-1 text-lg font-bold">Trusted Circle</span>
        <ChevronRight aria-hidden="true" className="h-6 w-6 text-muted" />
      </Link>
    </>
  );
}

function StatusRow({ icon: Icon, label, state }: { icon: typeof Mic; label: string; state: Parameters<typeof StatusBadge>[0]['state'] }) {
  return (
    <li className="flex min-h-[56px] items-center justify-between gap-3 py-2">
      <span className="flex items-center gap-3 text-lg">
        <Icon aria-hidden="true" className="h-6 w-6 text-muted" />
        {label}
      </span>
      <StatusBadge state={state} />
    </li>
  );
}
