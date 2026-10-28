import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { NAV_ITEMS } from './navigation';

/** Bottom bar for small screens: every section, scrollable sideways by swiping. */
export function MobileNav() {
  const listRef = useRef<HTMLUListElement>(null);
  const { pathname } = useLocation();
  const [edges, setEdges] = useState({ left: false, right: false });

  const updateEdges = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    updateEdges();
    window.addEventListener('resize', updateEdges);
    return () => window.removeEventListener('resize', updateEdges);
  }, [updateEdges]);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    active?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
  }, [pathname]);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <div className="relative mx-auto max-w-2xl">
        <ul
          ref={listRef}
          onScroll={updateEdges}
          className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain px-1"
        >
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <li key={to} className="w-1/5 min-w-[76px] shrink-0 snap-start">
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex min-h-[64px] flex-col items-center justify-center gap-1 px-1 text-center text-xs leading-tight transition-colors ${
                    isActive ? 'font-bold text-primary' : 'text-muted hover:text-ink'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className={`grid h-8 w-14 place-items-center rounded-full transition-colors duration-200 ${
                        isActive ? 'bg-primary/20' : ''
                      }`}
                    >
                      <Icon className="h-6 w-6" />
                    </span>
                    <span className="whitespace-nowrap">{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface to-transparent transition-opacity duration-200 ${
            edges.left ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent transition-opacity duration-200 ${
            edges.right ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>
    </nav>
  );
}
