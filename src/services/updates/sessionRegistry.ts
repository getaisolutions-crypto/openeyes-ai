export interface ReloadParticipant {
  label: string;
  /** True while the user is in a session an update must never interrupt. */
  busy: boolean;
  stop: () => void;
}

/** Tracks running camera, microphone, voice and AI work so it can be stopped before a reload. */
export function createSessionRegistry(onChange: () => void) {
  const participants = new Map<number, ReloadParticipant>();
  let nextId = 0;

  return {
    register(participant: ReloadParticipant): () => void {
      const id = nextId++;
      participants.set(id, participant);
      onChange();
      return () => {
        participants.delete(id);
        onChange();
      };
    },
    busyLabels(): string[] {
      return [...participants.values()].filter((p) => p.busy).map((p) => p.label);
    },
    stopAll(): number {
      let failures = 0;
      for (const participant of [...participants.values()]) {
        try {
          participant.stop();
        } catch {
          failures += 1;
        }
      }
      return failures;
    },
  };
}

export type SessionRegistry = ReturnType<typeof createSessionRegistry>;
