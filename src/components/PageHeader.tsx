import { useEffect, useRef, type ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
}

/** Sets the document title and moves focus to the heading so screen readers announce the new page. */
export function PageHeader({ title, description, icon }: PageHeaderProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = `${title} - OpenEyes AI`;
    headingRef.current?.focus({ preventScroll: false });
  }, [title]);

  return (
    <header className="mb-6 animate-fade-up">
      <div className="flex items-center gap-3">
        {icon && (
          <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
            {icon}
          </span>
        )}
        <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-bold tracking-tight focus:outline-none">
          {title}
        </h1>
      </div>
      {description && <p className="mt-3 text-lg text-muted">{description}</p>}
    </header>
  );
}
