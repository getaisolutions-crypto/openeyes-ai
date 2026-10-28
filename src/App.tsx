import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { AnnouncerProvider } from './hooks/useAnnouncer';
import { SettingsProvider } from './hooks/useSettings';
import { ServicesProvider, type Services } from './services/ServicesContext';
import HomePage from './pages/HomePage';

const AssistantPage = lazy(() => import('./pages/AssistantPage'));
const ExplorePage = lazy(() => import('./pages/ExplorePage'));
const FindPage = lazy(() => import('./pages/FindPage'));
const ReadPage = lazy(() => import('./pages/ReadPage'));
const MemoryPage = lazy(() => import('./pages/MemoryPage'));
const DevicesPage = lazy(() => import('./pages/DevicesPage'));
const TrustedCirclePage = lazy(() => import('./pages/TrustedCirclePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

export function App({ services }: { services: Services }) {
  return (
    <ServicesProvider services={services}>
      <SettingsProvider>
        <AnnouncerProvider>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<HomePage />} />
              <Route path="assistant" element={<AssistantPage />} />
              <Route path="explore" element={<ExplorePage />} />
              <Route path="find" element={<FindPage />} />
              <Route path="read" element={<ReadPage />} />
              <Route path="memory" element={<MemoryPage />} />
              <Route path="devices" element={<DevicesPage />} />
              <Route path="trusted-circle" element={<TrustedCirclePage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </AnnouncerProvider>
      </SettingsProvider>
    </ServicesProvider>
  );
}
