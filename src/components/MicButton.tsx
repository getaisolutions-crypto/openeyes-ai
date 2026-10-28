import { Mic, Square } from 'lucide-react';

interface MicButtonProps {
  listening: boolean;
  onStart: () => void;
  onStop: () => void;
  size?: 'lg' | 'md';
  idleLabel?: string;
}

export function MicButton({ listening, onStart, onStop, size = 'lg', idleLabel = 'Start voice input' }: MicButtonProps) {
  const dims = size === 'lg' ? 'h-28 w-28' : 'h-14 w-14';
  const iconDims = size === 'lg' ? 'h-12 w-12' : 'h-6 w-6';
  return (
    <button
      type="button"
      onClick={listening ? onStop : onStart}
      aria-pressed={listening}
      aria-label={listening ? 'Stop listening' : idleLabel}
      className={`relative grid shrink-0 place-items-center rounded-full font-bold transition-[transform,background-color] duration-200 active:scale-95 ${dims} ${
        listening ? 'bg-accent text-on-accent' : 'bg-primary text-on-primary hover:bg-primary-strong'
      }`}
    >
      {listening && (
        <span aria-hidden="true" className="absolute inset-0 rounded-full bg-accent motion-safe:animate-pulse-ring" />
      )}
      {listening ? (
        <Square aria-hidden="true" className={`relative ${iconDims}`} fill="currentColor" />
      ) : (
        <Mic aria-hidden="true" className={`relative ${iconDims}`} />
      )}
    </button>
  );
}
