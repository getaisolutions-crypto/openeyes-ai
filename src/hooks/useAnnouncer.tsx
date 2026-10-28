import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type Politeness = 'polite' | 'assertive';

interface AnnouncerContextValue {
  announce: (message: string, politeness?: Politeness) => void;
  lastMessage: string;
}

const AnnouncerContext = createContext<AnnouncerContextValue | null>(null);

/** Screen-reader live regions shared by the whole app. */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const [lastMessage, setLastMessage] = useState('');
  const timer = useRef<number>();

  const announce = useCallback((message: string, politeness: Politeness = 'polite') => {
    const set = politeness === 'assertive' ? setAssertive : setPolite;
    // Clearing first lets screen readers repeat an identical message.
    set('');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => set(message), 50);
    setLastMessage(message);
  }, []);

  const value = useMemo(() => ({ announce, lastMessage }), [announce, lastMessage]);

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="live-polite">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true" data-testid="live-assertive">
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnouncer(): AnnouncerContextValue {
  const ctx = useContext(AnnouncerContext);
  if (!ctx) throw new Error('useAnnouncer must be used inside AnnouncerProvider');
  return ctx;
}
