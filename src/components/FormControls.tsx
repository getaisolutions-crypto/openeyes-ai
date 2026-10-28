import { useId, type ReactNode } from 'react';

interface SwitchProps {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, description, checked, onChange, disabled }: SwitchProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-lg font-bold">
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="mt-1 text-muted">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-1 inline-flex h-9 w-16 shrink-0 items-center rounded-full border-2 transition-colors duration-200 disabled:opacity-50 ${
          checked ? 'border-primary bg-primary' : 'border-line bg-surface-2'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold transition-transform duration-200 ${
            checked ? 'translate-x-8 bg-on-primary text-primary' : 'translate-x-1 bg-muted text-surface'
          }`}
        >
          {checked ? 'ON' : ''}
        </span>
      </button>
    </div>
  );
}

interface Option<T extends string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
  badge?: ReactNode;
}

interface OptionGroupProps<T extends string> {
  legend: string;
  name: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  description?: ReactNode;
  columns?: 1 | 2;
}

/** Native radio group styled as large selectable cards. */
export function OptionGroup<T extends string>({ legend, name, value, options, onChange, description, columns = 1 }: OptionGroupProps<T>) {
  return (
    <fieldset className="py-3">
      <legend className="text-lg font-bold">{legend}</legend>
      {description && <p className="mt-1 text-muted">{description}</p>}
      <div className={`mt-3 grid gap-2 ${columns === 2 ? 'sm:grid-cols-2' : ''}`}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={`flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 transition-colors focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-focus ${
                selected ? 'border-primary bg-primary/10' : 'border-line bg-surface-2 hover:border-muted'
              } ${option.disabled ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
                className="h-5 w-5 shrink-0 accent-[rgb(var(--primary))] focus:outline-none"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-bold">
                  {option.label}
                  {option.badge}
                </span>
                {option.description && <span className="mt-0.5 block text-sm text-muted">{option.description}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
