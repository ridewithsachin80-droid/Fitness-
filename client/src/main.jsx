import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Register Vite PWA service worker
// In production this enables offline support and caching.
import { registerSW } from 'virtual:pwa-register';

// Reload only once the NEW worker has actually taken control. Reloading
// immediately after updateSW() is a race — the old worker is often still
// controlling the page, so the user reloads and sees the old app again.
let reloading = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    if (confirm('New version available. Reload to update?')) {
      // Tells the waiting worker to skipWaiting; the controllerchange
      // listener above performs the reload once it's in charge.
      updateSW(true);
    }
  },
  onOfflineReady() {
    console.log('✅ FitLife is ready to work offline');
  },
  onRegistered(registration) {
    console.log('SW registered:', registration);
    // PWAs can stay open for days; poll hourly so members aren't stranded
    // on an old build until they happen to fully close the app.
    if (registration) {
      setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
    }
  },
  onRegisterError(error) {
    console.error('SW registration failed:', error);
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
