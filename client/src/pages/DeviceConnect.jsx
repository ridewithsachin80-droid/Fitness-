import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, SectionTitle, BackButton } from '../components/UI';
import { useAuthStore } from '../store/authStore';
import { haptic } from '../store/settingsStore';
import useHealthConnect from '../hooks/useHealthConnect';
import useBluetoothTracker from '../hooks/useBluetoothTracker';
import { getTrackerStatus, syncOAuthProvider, disconnectTracker, getOAuthUrl } from '../api/trackers';

/* ─── Tracker catalogue ────────────────────────────────────────────────────── */
const TRACKERS = [
  {
    id: 'hart',
    name: 'HART PRO',
    subtitle: 'Smart Ring (via FITTR app + Health Connect)',
    icon: null,            // rendered as SVG ring
    color: '#22c55e',
    glow: 'rgba(34,197,94,0.25)',
    border: 'rgba(34,197,94,0.3)',
    bg: 'rgba(34,197,94,0.06)',
    metrics: ['Heart Rate', 'SpO₂', 'Sleep', 'Steps', 'HRV'],
    // FITTR's HART ring doesn't expose a public Bluetooth GATT API — it
    // talks to the official FITTR HART app over a proprietary protocol.
    // FITTR's app itself syncs into Health Connect though, so that's the
    // real working path: ring → FITTR HART app (must be opened periodically
    // to push fresh data) → Health Connect → here.
    protocol: 'healthconnect',
    badge: 'Popular',
    badgeColor: '#22c55e',
  },
  {
    id: 'garmin',
    name: 'Garmin',
    subtitle: 'Watch / Band',
    emoji: '⌚',
    color: '#3b82f6',
    glow: 'rgba(59,130,246,0.25)',
    border: 'rgba(59,130,246,0.3)',
    bg: 'rgba(59,130,246,0.06)',
    metrics: ['Heart Rate', 'GPS', 'VO₂ Max', 'Steps', 'Calories'],
    protocol: 'healthconnect',
  },
  {
    id: 'samsung',
    name: 'Samsung',
    subtitle: 'Galaxy Ring / Watch',
    emoji: '💍',
    color: '#6366f1',
    glow: 'rgba(99,102,241,0.25)',
    border: 'rgba(99,102,241,0.3)',
    bg: 'rgba(99,102,241,0.06)',
    metrics: ['Heart Rate', 'Body Composition', 'Sleep', 'Steps'],
    protocol: 'healthconnect',
    badge: 'New',
    badgeColor: '#a855f7',
  },
  {
    id: 'apple',
    name: 'Apple Watch',
    subtitle: 'HealthKit',
    emoji: '🍎',
    color: '#f97316',
    glow: 'rgba(249,115,22,0.25)',
    border: 'rgba(249,115,22,0.3)',
    bg: 'rgba(249,115,22,0.06)',
    metrics: ['Heart Rate', 'ECG', 'Blood Oxygen', 'Steps', 'Workouts'],
    protocol: 'healthkit',
  },
  {
    id: 'ultrahuman',
    name: 'Ultrahuman',
    subtitle: 'Ring AIR (via Health Connect, Android only)',
    emoji: '💍',
    color: '#d946ef',
    glow: 'rgba(217,70,239,0.25)',
    border: 'rgba(217,70,239,0.3)',
    bg: 'rgba(217,70,239,0.06)',
    metrics: ['HRV', 'Heart Rate', 'Sleep', 'Stress', 'Temperature'],
    // Ultrahuman doesn't expose a public Bluetooth GATT API either — same
    // pattern as the HART ring. Their app syncs into Health Connect on
    // Android (and Apple Health on iOS, which we can't reach from a web app).
    protocol: 'healthconnect',
    badge: 'Beta',
    badgeColor: '#d946ef',
  },
  {
    id: 'fitbit',
    name: 'Fitbit',
    subtitle: 'Band / Sense',
    emoji: '📡',
    color: '#14b8a6',
    glow: 'rgba(20,184,166,0.25)',
    border: 'rgba(20,184,166,0.3)',
    bg: 'rgba(20,184,166,0.06)',
    metrics: ['Heart Rate', 'Sleep Stages', 'Steps', 'SpO₂'],
    protocol: 'oauth',
  },
  {
    id: 'whoop',
    name: 'WHOOP',
    subtitle: 'Recovery Band',
    emoji: '💪',
    color: '#ef4444',
    glow: 'rgba(239,68,68,0.25)',
    border: 'rgba(239,68,68,0.3)',
    bg: 'rgba(239,68,68,0.06)',
    metrics: ['Recovery', 'Strain', 'HRV', 'Sleep', 'Calories'],
    protocol: 'oauth',
  },
  {
    id: 'polar',
    name: 'Polar',
    subtitle: 'Sports Watch',
    emoji: '🎯',
    color: '#f59e0b',
    glow: 'rgba(245,158,11,0.25)',
    border: 'rgba(245,158,11,0.3)',
    bg: 'rgba(245,158,11,0.06)',
    metrics: ['Heart Rate', 'Training Load', 'VO₂ Max', 'Sleep'],
    protocol: 'oauth',
  },
];

const PROTOCOL_LABELS = {
  bluetooth:     { label: 'Bluetooth', icon: '📶' },
  healthconnect: { label: 'Health Connect', icon: '🔗' },
  healthkit:     { label: 'Apple HealthKit', icon: '🍎' },
  oauth:         { label: 'Account Login', icon: '🔐' },
};

/* ─── Animated ring SVG for HART ──────────────────────────────────────────── */
function HartRingIcon({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <ellipse cx="18" cy="18" rx="15" ry="9" stroke="#22c55e" strokeWidth="3.5"
        strokeLinecap="round" opacity="0.9" />
      <ellipse cx="18" cy="18" rx="15" ry="9" stroke="#22c55e" strokeWidth="1"
        strokeLinecap="round" strokeDasharray="4 4" opacity="0.4" />
      <ellipse cx="18" cy="18" rx="10" ry="5.5" stroke="#22c55e" strokeWidth="1.5"
        opacity="0.5" />
      <circle cx="18" cy="18" r="2.5" fill="#22c55e" opacity="0.8" />
    </svg>
  );
}

/* ─── Connection modal ─────────────────────────────────────────────────────── */
function ConnectModal({ tracker, onClose, onConnected }) {
  const [step, setStep] = useState('idle'); // idle | scanning | pairing | success | error
  const [progress, setProgress] = useState(0);

  const startConnect = () => {
    setStep('scanning');
    setProgress(0);
    haptic(25);

    // Simulate scanning → pairing → success
    let p = 0;
    const interval = setInterval(() => {
      p += Math.random() * 18 + 4;
      if (p >= 60 && step !== 'pairing') setStep('pairing');
      if (p >= 100) {
        clearInterval(interval);
        setProgress(100);
        setTimeout(() => {
          setStep('success');
          haptic(40);
        }, 300);
        return;
      }
      setProgress(Math.min(p, 99));
    }, 180);
  };

  const handleDone = () => {
    onConnected(tracker.id);
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.8)',
      backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: '#131317',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '24px 24px 0 0',
        padding: '24px 20px 36px',
      }}>
        {/* Handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', margin: '0 auto 20px' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: tracker.bg,
            border: `1.5px solid ${tracker.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26,
            boxShadow: `0 0 20px ${tracker.glow}`,
          }}>
            {tracker.id === 'hart' ? <HartRingIcon size={30} /> : tracker.emoji}
          </div>
          <div>
            <p style={{ color: '#ededf0', fontWeight: 700, fontSize: 18, margin: 0 }}>{tracker.name}</p>
            <p style={{ color: '#6a6a78', fontSize: 13, margin: 0 }}>{tracker.subtitle}</p>
          </div>
        </div>

        {/* Metrics chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}>
          {tracker.metrics.map(m => (
            <span key={m} style={{
              fontSize: 11, fontWeight: 600, color: tracker.color,
              background: tracker.bg, border: `1px solid ${tracker.border}`,
              borderRadius: 20, padding: '3px 10px',
            }}>{m}</span>
          ))}
        </div>

        {/* Protocol */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24,
          padding: '10px 14px', borderRadius: 12,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
        }}>
          <span style={{ fontSize: 16 }}>{PROTOCOL_LABELS[tracker.protocol].icon}</span>
          <div>
            <p style={{ color: '#8e8e9a', fontSize: 11, margin: 0 }}>Connection method</p>
            <p style={{ color: '#d8d8de', fontSize: 13, fontWeight: 600, margin: 0 }}>{PROTOCOL_LABELS[tracker.protocol].label}</p>
          </div>
        </div>

        {/* States */}
        {step === 'idle' && (
          <button onClick={startConnect} style={{
            width: '100%', padding: '15px', borderRadius: 16,
            background: tracker.color, border: 'none', cursor: 'pointer',
            color: '#fff', fontWeight: 700, fontSize: 16,
            boxShadow: `0 4px 20px ${tracker.glow}`,
          }}>
            Connect {tracker.name}
          </button>
        )}

        {(step === 'scanning' || step === 'pairing') && (
          <div>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
              <p style={{ color: '#d8d8de', fontSize: 14, margin: 0, fontWeight: 600 }}>
                {step === 'scanning' ? '🔍 Scanning for device…' : '🤝 Pairing…'}
              </p>
              <p style={{ color: tracker.color, fontSize: 13, fontWeight: 700, margin: 0 }}>{Math.round(progress)}%</p>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 3,
                background: `linear-gradient(90deg, ${tracker.color}, ${tracker.color}bb)`,
                width: `${progress}%`, transition: 'width 0.2s ease',
                boxShadow: `0 0 12px ${tracker.glow}`,
              }} />
            </div>
            <p style={{ color: '#4e4e5c', fontSize: 12, marginTop: 10, textAlign: 'center' }}>
              {step === 'scanning' ? 'Make sure your device is nearby and in pairing mode' : 'Establishing secure connection…'}
            </p>
          </div>
        )}

        {step === 'success' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 16px',
              background: tracker.bg, border: `2px solid ${tracker.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 30,
              boxShadow: `0 0 30px ${tracker.glow}`,
              animation: 'pulse 1.5s ease-in-out',
            }}>✅</div>
            <p style={{ color: '#ededf0', fontWeight: 700, fontSize: 17, margin: '0 0 6px' }}>Connected!</p>
            <p style={{ color: '#6a6a78', fontSize: 13, margin: '0 0 24px' }}>
              {tracker.name} is now syncing with your fitness data
            </p>
            <button onClick={handleDone} style={{
              width: '100%', padding: '14px', borderRadius: 16,
              background: tracker.color, border: 'none', cursor: 'pointer',
              color: '#fff', fontWeight: 700, fontSize: 15,
            }}>Done</button>
          </div>
        )}

        {step !== 'success' && (
          <button onClick={onClose} style={{
            width: '100%', marginTop: 12, padding: '12px', borderRadius: 14,
            background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
            color: '#6a6a78', fontWeight: 600, fontSize: 14, cursor: 'pointer',
          }}>Cancel</button>
        )}
      </div>
    </div>
  );
}

/* ─── Main page ────────────────────────────────────────────────────────────── */
export default function DeviceConnect() {
  const navigate   = useNavigate();
  const [searchParams] = useSearchParams();
  const { user }   = useAuthStore();
  const hc         = useHealthConnect();
  const ble        = useBluetoothTracker();

  // Which providers are confirmed connected server-side
  const [serverConnected, setServerConnected] = useState(new Set());
  const [loadingStatus,   setLoadingStatus]   = useState(true);
  // OAuth providers (fitbit/whoop/polar) that actually have real client
  // credentials configured server-side — without checking this, tapping
  // Connect on an unconfigured one silently redirects to a broken OAuth
  // error page with zero explanation.
  const [oauthAvailable,  setOauthAvailable]  = useState({});
  // Local optimistic state (union of server + just-connected)
  const [localConnected,  setLocalConnected]  = useState(new Set());
  const [activeModal,     setActiveModal]     = useState(null);
  const [search,          setSearch]          = useState('');
  const [syncingId,       setSyncingId]       = useState(null);
  const [toast,           setToast]           = useState(null);

  /* ── Show toast ───────────────────────────────────────────── */
  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  /* ── Load server-side connection status on mount ──────────── */
  useEffect(() => {
    getTrackerStatus()
      .then(({ connections, available }) => {
        const ids = new Set();
        connections.forEach(c => {
          // map DB provider names to tracker IDs
          if (c.provider === 'ble_ring')      { ids.add('hart'); return; }
          if (c.provider === 'healthconnect') {
            // One Health Connect grant covers all source apps that write
            // into it — see the live-sync handler for the same reasoning.
            ids.add('garmin'); ids.add('samsung'); ids.add('hart'); ids.add('ultrahuman');
            return;
          }
          ids.add(c.provider);
        });
        setServerConnected(ids);
        setLocalConnected(ids);
        setOauthAvailable(available || {});
      })
      .catch(() => {})
      .finally(() => setLoadingStatus(false));
  }, []);

  /* ── Handle OAuth callback redirect (?connected=fitbit) ───── */
  useEffect(() => {
    const connected = searchParams.get('connected');
    const error     = searchParams.get('error');
    if (connected) {
      setLocalConnected(prev => new Set([...prev, connected]));
      showToast(`${connected.charAt(0).toUpperCase() + connected.slice(1)} connected!`);
    }
    if (error) {
      showToast(searchParams.get('provider') + ' connection failed', 'error');
    }
  }, [searchParams]);

  /* ── Handle BLE live metrics updates ─────────────────────── */
  useEffect(() => {
    if (ble.status === 'done') {
      setLocalConnected(prev => new Set([...prev, 'hart']));
      showToast('HART ring synced!');
    }
    if (ble.status === 'error' && ble.error) {
      showToast(ble.error, 'error');
    }
  }, [ble.status, ble.error]);

  /* ── Health Connect sync result ───────────────────────────── */
  useEffect(() => {
    if (hc.status === 'done') {
      // One Health Connect permission grant covers all underlying source
      // apps that write into it — Garmin Connect, Samsung Health, FITTR
      // HART, and Ultrahuman all funnel through the same store, so a
      // successful sync marks all four as connected, not just two.
      setLocalConnected(prev => new Set([...prev, 'garmin', 'samsung', 'hart', 'ultrahuman']));
      showToast('Health Connect synced!');
    }
    if (hc.status === 'error' && hc.error) {
      showToast(hc.error, 'error');
    }
  }, [hc.status, hc.error]);

  /* ── Connect handler: dispatches by protocol ──────────────── */
  const handleConnect = async (id) => {
    const tracker = TRACKERS.find(t => t.id === id);
    if (!tracker) return;
    haptic(15);

    if (tracker.protocol === 'bluetooth') {
      // Web Bluetooth — opens browser picker directly
      ble.connect();
      return;
    }

    if (tracker.protocol === 'healthconnect') {
      // Web Health Connect — reads from Android Health Connect
      hc.sync();
      return;
    }

    if (tracker.protocol === 'healthkit') {
      // Apple HealthKit requires native app — show info modal
      setActiveModal({ ...tracker, infoOnly: true });
      return;
    }

    if (tracker.protocol === 'oauth') {
      // Don't redirect to a provider that has no real client credentials
      // configured — that just hits a broken "invalid client" error on
      // their side with no explanation. Tell the user plainly instead.
      if (oauthAvailable[id] === false) {
        showToast(`${tracker.name} integration isn't set up yet — ask your admin to enable it.`, 'error');
        return;
      }
      // Redirect to OAuth flow (fitbit / whoop / polar)
      window.location.href = getOAuthUrl(id);
      return;
    }
  };

  /* ── Disconnect handler ────────────────────────────────────── */
  const handleDisconnect = async (id) => {
    haptic(25);
    setLocalConnected(prev => { const n = new Set(prev); n.delete(id); return n; });
    const provider = id === 'hart' ? 'ble_ring' : id;
    try {
      await disconnectTracker(provider);
      showToast('Disconnected');
    } catch { /* silently fail — UI already updated */ }
  };

  /* ── Manual sync handler ───────────────────────────────────── */
  const handleSyncNow = async (id) => {
    const tracker = TRACKERS.find(t => t.id === id);
    if (!tracker) return;
    setSyncingId(id);
    haptic(15);

    try {
      if (tracker.protocol === 'bluetooth') {
        await ble.syncNow();
      } else if (tracker.protocol === 'healthconnect') {
        await hc.sync();
      } else if (tracker.protocol === 'oauth') {
        await syncOAuthProvider(id);
        showToast(`${tracker.name} synced!`);
      }
    } catch (err) {
      showToast(err.message || 'Sync failed', 'error');
    } finally {
      setSyncingId(null);
    }
  };

  /* ── Filter ────────────────────────────────────────────────── */
  const filtered = TRACKERS.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.subtitle.toLowerCase().includes(search.toLowerCase())
  );
  const connectedTrackers = filtered.filter(t => localConnected.has(t.id));
  const availableTrackers = filtered.filter(t => !localConnected.has(t.id));

  /* ── BLE live metric display (for HART) ────────────────────── */
  const bleActive  = ['connecting','reading'].includes(ble.status);
  const hcActive   = ['checking','requesting','reading','syncing'].includes(hc.status);
  const anyLoading = bleActive || hcActive;

  return (
    <div style={{ minHeight: '100vh', background: '#0b0b0e' }}>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)',
          zIndex: 200, padding: '10px 20px', borderRadius: 40,
          background: toast.type === 'error' ? 'rgba(239,68,68,0.9)' : 'rgba(34,197,94,0.9)',
          color: '#fff', fontWeight: 700, fontSize: 13,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(8px)',
          transition: 'all 0.3s',
        }}>{toast.type === 'error' ? '⚠️ ' : '✅ '}{toast.msg}</div>
      )}

      {/* ── BLE live reading strip ── */}
      {bleActive && Object.keys(ble.liveMetrics).length > 0 && (
        <div style={{
          position: 'fixed', bottom: 80, left: 0, right: 0, zIndex: 150,
          padding: '10px 16px',
          background: 'rgba(34,197,94,0.12)',
          borderTop: '1px solid rgba(34,197,94,0.25)',
          display: 'flex', gap: 20, justifyContent: 'center', alignItems: 'center',
        }}>
          {ble.liveMetrics.heart_rate && (
            <span style={{ color: '#22c55e', fontWeight: 700, fontSize: 14 }}>
              ❤️ {ble.liveMetrics.heart_rate} bpm
            </span>
          )}
          {ble.liveMetrics.spo2 && (
            <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: 14 }}>
              🩸 SpO₂ {ble.liveMetrics.spo2}%
            </span>
          )}
          {ble.liveMetrics.battery != null && (
            <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 14 }}>
              🔋 {ble.liveMetrics.battery}%
            </span>
          )}
        </div>
      )}

      {/* ── Header ── */}
      <div style={{
        background: '#131317',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '40px 16px 16px',
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <BackButton onClick={() => navigate(-1)} />
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{ color: '#ededf0', fontWeight: 600, fontFamily: 'Fraunces, serif', fontSize: 22, margin: 0 }}>Connected Devices</h1>
              <p style={{ color: '#6a6a78', fontSize: 13, margin: '4px 0 0' }}>
                Sync your fitness tracker to enrich your health data
              </p>
            </div>
            {anyLoading && (
              <div style={{
                width: 32, height: 32, border: '3px solid rgba(124,92,252,0.2)',
                borderTopColor: '#7c5cfc', borderRadius: '50%',
                animation: 'spin 0.8s linear infinite', flexShrink: 0, marginTop: 4,
              }} />
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px 16px 120px' }}>

        {/* ── Search ── */}
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <span style={{
            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
            fontSize: 16, pointerEvents: 'none',
          }}>🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search trackers…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '12px 14px 12px 42px',
              background: '#131317', border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 14, color: '#d8d8de', fontSize: 14, outline: 'none',
            }}
          />
        </div>

        {/* ── Health Connect status banner ── */}
        <div
          onClick={() => !hcActive && hc.sync()}
          style={{
            marginBottom: 16, padding: '14px 16px', cursor: 'pointer',
            background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(99,102,241,0.08))',
            border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: 16, display: 'flex', alignItems: 'center', gap: 12,
          }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'rgba(99,102,241,0.15)',
            border: '1px solid rgba(99,102,241,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0,
          }}>🔗</div>
          <div style={{ flex: 1 }}>
            <p style={{ color: '#ededf0', fontWeight: 700, fontSize: 14, margin: 0 }}>Android Health Connect</p>
            <p style={{ color: '#8e8e9a', fontSize: 12, margin: '2px 0 0' }}>
              {hcActive
                ? `${hc.status.charAt(0).toUpperCase() + hc.status.slice(1)}…`
                : 'Tap to sync Samsung, Garmin, Fitbit data'}
            </p>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700,
            color: hcActive ? '#f59e0b' : '#22c55e',
            background: hcActive ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)',
            border: `1px solid ${hcActive ? 'rgba(245,158,11,0.25)' : 'rgba(34,197,94,0.25)'}`,
            borderRadius: 20, padding: '3px 10px', flexShrink: 0,
          }}>{hcActive ? 'Syncing' : 'Sync Now'}</span>
        </div>

        {/* ── Connected devices ── */}
        {connectedTrackers.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <p style={{
              fontSize: 10, fontWeight: 700, color: '#6a6a78',
              letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10,
            }}>Connected ({connectedTrackers.length})</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {connectedTrackers.map(tracker => (
                <TrackerCard
                  key={tracker.id}
                  tracker={tracker}
                  isConnected
                  isSyncing={syncingId === tracker.id || (tracker.protocol === 'bluetooth' && bleActive)}
                  liveMetrics={tracker.protocol === 'bluetooth' ? ble.liveMetrics : {}}
                  onSyncNow={() => handleSyncNow(tracker.id)}
                  onDisconnect={() => handleDisconnect(tracker.id)}
                  oauthAvailable={oauthAvailable}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Available ── */}
        {availableTrackers.length > 0 && (
          <div style={{ marginTop: connectedTrackers.length > 0 ? 20 : 0 }}>
            <p style={{
              fontSize: 10, fontWeight: 700, color: '#6a6a78',
              letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10,
            }}>Available ({availableTrackers.length})</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {availableTrackers.map(tracker => (
                <TrackerCard
                  key={tracker.id}
                  tracker={tracker}
                  isConnected={false}
                  isSyncing={false}
                  liveMetrics={{}}
                  onSyncNow={() => {}}
                  onDisconnect={() => {}}
                  onConnect={() => handleConnect(tracker.id)}
                  oauthAvailable={oauthAvailable}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: '#4e4e5c' }}>
            <p style={{ fontSize: 32, margin: '0 0 12px' }}>🔍</p>
            <p style={{ fontSize: 16, fontWeight: 600, margin: '0 0 6px', color: '#6a6a78' }}>No results</p>
            <p style={{ fontSize: 13, margin: 0 }}>Try searching by brand name or type</p>
          </div>
        )}

        {/* ── Sync settings ── */}
        {localConnected.size > 0 && (
          <div style={{ marginTop: 20 }}>
            <Card>
              <SectionTitle icon="⚙️">Sync Settings</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[
                  { label: 'Auto-sync when app opens', sub: 'Pull latest data on launch', on: true },
                  { label: 'Background sync', sub: 'Sync every 30 minutes', on: true },
                  { label: 'Sync on Wi-Fi only', sub: 'Reduces mobile data usage', on: false },
                  { label: 'Heart rate alerts', sub: 'Notify on abnormal readings', on: true },
                ].map(({ label, sub, on }) => (
                  <SyncToggleRow key={label} label={label} sub={sub} defaultOn={on} />
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* ── Privacy note ── */}
        <div style={{
          marginTop: 16, padding: '12px 14px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 14,
        }}>
          <p style={{ color: '#4e4e5c', fontSize: 12, margin: 0, lineHeight: 1.5 }}>
            🔒 Your device data is encrypted and stored securely. We only read health metrics — we never write to your wearable.
          </p>
        </div>
      </div>

      {/* ── Apple HealthKit info modal ── */}
      {activeModal?.infoOnly && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }} onClick={() => setActiveModal(null)}>
          <div style={{
            width: '100%', maxWidth: 480,
            background: '#131317', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '24px 24px 0 0', padding: '24px 20px 40px',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', margin: '0 auto 20px' }} />
            <p style={{ fontSize: 28, textAlign: 'center', margin: '0 0 12px' }}>🍎</p>
            <h3 style={{ color: '#ededf0', fontWeight: 700, fontSize: 18, textAlign: 'center', margin: '0 0 10px' }}>Apple Watch / HealthKit</h3>
            <p style={{ color: '#8e8e9a', fontSize: 14, textAlign: 'center', lineHeight: 1.6, margin: '0 0 20px' }}>
              Apple HealthKit requires a native iOS app and cannot be accessed from a web browser due to Apple's security restrictions.
            </p>
            <div style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 14, padding: '14px 16px', marginBottom: 16 }}>
              <p style={{ color: '#fb923c', fontSize: 13, fontWeight: 600, margin: '0 0 6px' }}>Workaround options:</p>
              <p style={{ color: '#8e8e9a', fontSize: 12, margin: 0, lineHeight: 1.6 }}>
                1. Export your Apple Health data as CSV and upload it manually.<br/>
                2. Use the Apple Health ↔ Google Fit bridge app, then sync via Health Connect.
              </p>
            </div>
            <button onClick={() => setActiveModal(null)} style={{
              width: '100%', padding: '13px', borderRadius: 14,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#d8d8de', fontWeight: 600, fontSize: 14, cursor: 'pointer',
            }}>Got it</button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.5 } }
      `}</style>
    </div>
  );
}


/* ─── Tracker card ─────────────────────────────────────────────────────────── */
function TrackerCard({ tracker, isConnected, isSyncing, liveMetrics = {}, onConnect, onDisconnect, onSyncNow, oauthAvailable = {} }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      borderRadius: 18,
      background: isConnected ? tracker.bg : '#131317',
      border: `1px solid ${isConnected ? tracker.border : 'rgba(255,255,255,0.07)'}`,
      overflow: 'hidden',
      transition: 'all 0.2s',
      boxShadow: isConnected ? `0 0 20px ${tracker.glow}` : 'none',
    }}>
      {/* Main row */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 14px 14px 14px', cursor: 'pointer' }}
        onClick={() => setExpanded(v => !v)}
      >
        {/* Icon */}
        <div style={{
          width: 50, height: 50, borderRadius: 14, flexShrink: 0,
          background: isConnected ? `${tracker.color}22` : 'rgba(255,255,255,0.06)',
          border: `1.5px solid ${isConnected ? tracker.border : 'rgba(255,255,255,0.1)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
          boxShadow: isConnected ? `0 0 16px ${tracker.glow}` : 'none',
        }}>
          {tracker.id === 'hart' ? <HartRingIcon size={28} /> : tracker.emoji}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <p style={{ color: '#ededf0', fontWeight: 700, fontSize: 15, margin: 0 }}>{tracker.name}</p>
            {(() => {
              // Unconfigured OAuth provider takes priority over any static badge —
              // the user should know this before tapping, not after a failed redirect.
              const notSetUp = tracker.protocol === 'oauth' && oauthAvailable[tracker.id] === false;
              const badge = notSetUp ? 'Setup pending' : tracker.badge;
              const badgeColor = notSetUp ? '#6a6a78' : tracker.badgeColor;
              return badge && (
                <span style={{
                  fontSize: 9, fontWeight: 800, color: badgeColor,
                  background: `${badgeColor}18`, border: `1px solid ${badgeColor}44`,
                  borderRadius: 20, padding: '2px 7px', letterSpacing: '0.05em', textTransform: 'uppercase',
                }}>{badge}</span>
              );
            })()}
          </div>
          <p style={{ color: '#6a6a78', fontSize: 12, margin: '1px 0 0' }}>{tracker.subtitle}</p>
        </div>

        {/* Status / button */}
        {isConnected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: tracker.color,
              boxShadow: `0 0 6px ${tracker.color}`,
              display: 'inline-block',
              animation: 'pulse 2s infinite',
            }} />
            <span style={{ color: tracker.color, fontSize: 12, fontWeight: 700 }}>Syncing</span>
          </div>
        ) : (
          <div style={{ color: '#4e4e5c', fontSize: 18 }}>{expanded ? '▲' : '▽'}</div>
        )}
      </div>

      {/* Expanded: metrics + actions */}
      {(expanded || isConnected) && (
        <div style={{ padding: '0 14px 14px' }}>
          {/* Live BLE metrics (HART ring only) */}
          {isConnected && Object.keys(liveMetrics).length > 0 && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, padding: '10px 12px', background: 'rgba(34,197,94,0.05)', borderRadius: 10, border: '1px solid rgba(34,197,94,0.15)' }}>
              {liveMetrics.heart_rate && <span style={{ color: '#22c55e', fontSize: 13, fontWeight: 700 }}>❤️ {liveMetrics.heart_rate} bpm</span>}
              {liveMetrics.spo2 && <span style={{ color: '#60a5fa', fontSize: 13, fontWeight: 700 }}>🩸 {liveMetrics.spo2}%</span>}
              {liveMetrics.hrv && <span style={{ color: '#a78bfa', fontSize: 13, fontWeight: 700 }}>📊 HRV {liveMetrics.hrv}ms</span>}
              {liveMetrics.battery != null && <span style={{ color: '#f59e0b', fontSize: 13, fontWeight: 700 }}>🔋 {liveMetrics.battery}%</span>}
            </div>
          )}

          {/* Metrics */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
            {tracker.metrics.map(m => (
              <span key={m} style={{
                fontSize: 11, fontWeight: 600,
                color: isConnected ? tracker.color : '#6a6a78',
                background: isConnected ? tracker.bg : 'rgba(255,255,255,0.04)',
                border: `1px solid ${isConnected ? tracker.border : 'rgba(255,255,255,0.06)'}`,
                borderRadius: 20, padding: '3px 9px',
              }}>{m}</span>
            ))}
          </div>

          {/* Protocol */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            marginBottom: 12, padding: '8px 12px',
            background: 'rgba(255,255,255,0.03)', borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <span style={{ fontSize: 13 }}>{PROTOCOL_LABELS[tracker.protocol].icon}</span>
            <span style={{ color: '#8e8e9a', fontSize: 12 }}>via {PROTOCOL_LABELS[tracker.protocol].label}</span>
          </div>

          {/* Action buttons */}
          {isConnected ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={e => { e.stopPropagation(); haptic(20); onSyncNow && onSyncNow(); }} disabled={isSyncing} style={{
                flex: 1, padding: '10px', borderRadius: 12,
                background: tracker.bg, border: `1px solid ${tracker.border}`,
                color: tracker.color, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                opacity: isSyncing ? 0.6 : 1,
              }}>{isSyncing ? '⟳ Syncing…' : '↻ Sync Now'}</button>
              <button onClick={e => { e.stopPropagation(); onDisconnect(); }} style={{
                flex: 1, padding: '10px', borderRadius: 12,
                background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)',
                color: '#ef4444', fontWeight: 700, fontSize: 13, cursor: 'pointer',
              }}>Disconnect</button>
            </div>
          ) : (
            <button onClick={e => { e.stopPropagation(); onConnect(); }} style={{
              width: '100%', padding: '11px', borderRadius: 12,
              background: `linear-gradient(135deg, ${tracker.color}dd, ${tracker.color}99)`,
              border: 'none', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              boxShadow: `0 4px 16px ${tracker.glow}`,
            }}>
              Connect {tracker.name}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Inline sync toggle ───────────────────────────────────────────────────── */
function SyncToggleRow({ label, sub, defaultOn }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div>
        <p style={{ color: '#d8d8de', fontSize: 13, fontWeight: 600, margin: 0 }}>{label}</p>
        <p style={{ color: '#4e4e5c', fontSize: 11, margin: '2px 0 0' }}>{sub}</p>
      </div>
      <button onClick={() => { setOn(v => !v); haptic(15); }} style={{
        width: 44, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
        background: on ? '#7c5cfc' : 'rgba(255,255,255,0.1)',
        position: 'relative', flexShrink: 0, transition: 'background 0.2s',
      }}>
        <div style={{
          width: 20, height: 20, borderRadius: 10, background: '#fff',
          position: 'absolute', top: 3, left: on ? 21 : 3, transition: 'left 0.2s',
        }} />
      </button>
    </div>
  );
}
