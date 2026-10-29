import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { createDefaultServices } from './services/ServicesContext';
import { withoutRefreshParam } from './services/updates/reloadGuard';
import './index.css';

const cleanAddress = withoutRefreshParam(window.location.href);
if (cleanAddress) window.history.replaceState(window.history.state, '', cleanAddress);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App services={createDefaultServices()} />
    </BrowserRouter>
  </StrictMode>,
);
