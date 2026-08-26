import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Register Vite PWA service worker
// In production this enables offline support and caching.
import { registerSW } from 'virtual:pwa-register';
import ErrorBoundary from './components/ErrorBoundary.jsx';

// ── Chunk-load self-healing ───────────────────────────────────────────────────
// The classic PWA white screen: a cached index.html references hashed chunks a
// newer deploy has purged. Vite fires this event when a dynamic import fails;
// wipe caches and reload once — the reload fetches a coherent build. The
// sessionStorage guard prevents a reload loop if the network itself is down.
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem('fl-chunk-retry')) return;   // already tried once
  sessionStorage.setItem('fl-chunk-retry', '1');
  event.preventDefault();
  (window.__fitlifeRecover ? window.__fitlifeRecover() : Promise.resolve(location.reload()));
});

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
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Tell the index.html watchdog the app is alive, and reset the one-shot
// chunk-retry guard so the NEXT stale-deploy event can heal itself too.
window.__fitlifeBooted = true;
sessionStorage.removeItem('fl-chunk-retry');
