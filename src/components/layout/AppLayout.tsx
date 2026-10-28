import { Suspense } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { NAV_ITEMS } from './navigation';
import { LogoMark } from './LogoMark';
import { MobileNav } from './MobileNav';

function PageLoading() {
  return (
    <div role="status" className="flex items-center gap-3 py-16 text-lg text-muted">
      <Loader2 aria-hidden="true" className="h-6 w-6 motion-safe:animate-spin" />
      Loading
    </div>
  );
}

export function AppLayout() {
  return (
    <div className="min-h-[100dvh] lg:flex">
      <a
        href="#main"
        className="sr-only-focusable fixed left-4 top-4 z-50 rounded-xl bg-accent px-4 py-3 font-bold text-on-accent"
      >
        Skip to main content
      </a>

      <aside className="hidden w-72 shrink-0 border-r border-line bg-surface lg:block">
        <div className="sticky top-0 flex h-[100dvh] flex-col p-4">
          <Link to="/" className="mb-6 flex items-center gap-3 rounded-xl px-3 py-2" aria-label="OpenEyes AI, go to Home">
            <LogoMark />
            <span className="text-xl font-bold tracking-tight">OpenEyes AI</span>
          </Link>
          <nav aria-label="All sections">
            <ul className="space-y-1">
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      `flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-lg transition-colors ${
                        isActive
                          ? 'bg-primary/15 font-bold text-ink shadow-[inset_4px_0_0_rgb(var(--primary))]'
                          : 'text-muted hover:bg-surface-2 hover:text-ink'
                      }`
                    }
                  >
                    <Icon aria-hidden="true" className="h-6 w-6" />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <p className="mt-auto px-3 text-sm text-muted">Version 0.4.1, Phase 4.1 Meta Voice conversation</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur lg:hidden">
          <div className="mx-auto flex h-16 max-w-2xl items-center px-4">
            <Link to="/" className="flex items-center gap-3 rounded-xl py-1" aria-label="OpenEyes AI, go to Home">
              <LogoMark className="h-8 w-8" />
              <span className="text-lg font-bold tracking-tight">OpenEyes AI</span>
            </Link>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 pb-32 pt-6 focus:outline-none lg:pb-12 lg:pt-10">
          <Suspense fallback={<PageLoading />}>
            <Outlet />
          </Suspense>
        </main>

        <MobileNav />
      </div>
    </div>
  );
}
