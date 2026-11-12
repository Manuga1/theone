import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { BRAND } from '@shared/brand';
import App from './App';
import { captureAdminFromUrl } from './admin';
import './styles/tokens.css';
import './styles/base.css';

// Before the first render: ?admin switches admin mode on for this tab (see admin.ts).
captureAdminFromUrl();
// index.html carries the same text for crawlers and link previews; shared/brand.ts stays the source of truth.
document.querySelector('meta[name="description"]')?.setAttribute('content', BRAND.tagline);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
