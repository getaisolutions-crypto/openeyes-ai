import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

type Variant = 'info' | 'warning' | 'error' | 'success';

const STYLES: Record<Variant, { box: string; icon: typeof Info; label: string }> = {
  info: { box: 'border-primary/50 bg-primary/10', icon: Info, label: 'Note' },
  warning: { box: 'border-warning/60 bg-warning/10', icon: AlertTriangle, label: 'Not available yet' },
  error: { box: 'border-danger/60 bg-danger/10', icon: XCircle, label: 'Error' },
  success: { box: 'border-success/60 bg-success/10', icon: CheckCircle2, label: 'Done' },
};

interface NoticeProps {
  variant?: Variant;
  /** Visible heading; defaults to a text label so meaning never depends on color alone. */
  title?: string;
  children: ReactNode;
  /** Use "alert" for errors raised by a user action so they are announced immediately. */
  role?: 'alert' | 'status';
  action?: ReactNode;
}

export function Notice({ variant = 'info', title, children, role, action }: NoticeProps) {
  const { box, icon: Icon, label } = STYLES[variant];
  return (
    <div role={role} className={`rounded-2xl border p-4 animate-fade-up ${box}`}>
      <div className="flex gap-3">
        <Icon aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">{title ?? label}</p>
          <div className="mt-1 text-ink/90">{children}</div>
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  );
}
