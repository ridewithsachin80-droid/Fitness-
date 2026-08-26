/**
 * ErrorBoundary — the last line between a runtime crash and a blank screen.
 *
 * Any uncaught render/lifecycle error anywhere in the tree lands here and
 * shows a dark, branded recovery screen instead of white. "Reload app" uses
 * the same nuclear option as the index.html boot watchdog: unregister service
 * workers, clear caches, reload — because in a PWA the crash is as often a
 * stale-cache mismatch as it is a code bug.
 *
 * The error message is shown small and copyable so a member can screenshot it
 * to their coach — that screenshot is a stack trace we'd otherwise never see.
 */
import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('FitLife crashed:', error, info?.componentStack);
  }

  recover = async () => {
    try {
      if (window.__fitlifeRecover) return window.__fitlifeRecover();
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if (window.caches?.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch { /* best effort */ }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', background: '#121316', color: '#EDEDF0',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: 24, textAlign: 'center',
        fontFamily: 'Outfit, system-ui, sans-serif',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>😵</div>
        <p style={{ fontSize: 16, fontWeight: 600, margin: '0 0 6px' }}>
          Something went wrong
        </p>
        <p style={{ fontSize: 13, color: '#9EA3B0', margin: '0 0 20px', maxWidth: 300 }}>
          Your logged data is safe on the server. Reloading usually fixes this.
        </p>
        <button onClick={this.recover} style={{
          background: '#D4AF37', color: '#121316', border: 0, borderRadius: 999,
          padding: '12px 28px', fontSize: 15, fontWeight: 600,
        }}>
          Reload app
        </button>
        <p style={{
          fontSize: 10, color: '#5a5f6b', marginTop: 24, maxWidth: 320,
          wordBreak: 'break-word', userSelect: 'all',
        }}>
          {String(this.state.error?.message || this.state.error).slice(0, 200)}
        </p>
      </div>
    );
  }
}
