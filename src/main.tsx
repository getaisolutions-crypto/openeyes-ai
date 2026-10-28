import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { createDefaultServices } from './services/ServicesContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App services={createDefaultServices()} />
    </BrowserRouter>
  </StrictMode>,
);
