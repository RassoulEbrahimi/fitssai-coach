import React from 'react';
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import './index.css'
import { schedulePeriodicUpdate } from './lib/pwa'

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('[FitssAI] #root not found in index.html');
}

createRoot(rootEl).render(React.createElement(App));

/*
  The one and only service-worker registration. vite-plugin-pwa's auto-injected
  registerSW.js is disabled (injectRegister: null) so this stays the single
  path. autoUpdate installs and activates a new worker on its own; the periodic
  check makes sure a long-running installed session notices a new deploy.
*/
registerSW({
  immediate: true,
  onRegisteredSW: (_swUrl, registration) => schedulePeriodicUpdate(registration),
});
