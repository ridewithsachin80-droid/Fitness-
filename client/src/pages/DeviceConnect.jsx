import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BackButton } from '../components/UI';
import { useAuthStore } from '../store/authStore';
import { haptic } from '../store/settingsStore';
import useHealthConnect, { healthConnectSupported } from '../hooks/useHealthConnect';
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

/*
 * Connection methods this app cannot use, and what to say about each.
 *
 * Health Connect is an Android SDK with no web API, and the Android wrapper is
 * a Trusted Web Activity that cannot pass a native object to the page (see
 * hooks/useHealthConnect.js). HealthKit is native-iOS only. A device that
 * needs either one is shown as not supported, with the reason — never with a
 * Connect button that can only fail.
 */
const UNSUPPORTED_NOTE = {
  healthconnect: 'Needs Android Health Connect, which FitLife cannot read yet.',
  healthkit:     'Needs Apple HealthKit, which only a native iPhone app can read. FitLife cannot.',
};
/** null when the device can be connected; otherwise the sentence to show. */
function unsupportedNote(tracker, hcSupported) {
  if (tracker.protocol === 'healthconnect') return hcSupported ? null : UNSUPPORTED_NOTE.healthconnect;
  if (tracker.protocol === 'healthkit')     return UNSUPPORTED_NOTE.healthkit;
  return null;
}

/** "HART PRO, Garmin, Samsung and Ultrahuman" — built from the catalogue, so it cannot drift from it. */
const HC_DEVICE_NAMES = (() => {
  const names = TRACKERS.filter(t => t.protocol === 'healthconnect').map(t => t.name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
})();

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

/* ─── Main page ────────────────────────────────────────────────────────────── */
export default function DeviceConnect() {
  const navigate   = useNavigate();
  const [searchParams] = useSearchParams();
  const { user }   = useAuthStore();
  const hc         = useHealthConnect();
  // False on every phone today: nothing provides the bridge. Read once per render.
  const hcSupported = healthConnectSupported();
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
    if ((hc.status === 'error' || hc.status === 'unavailable') && hc.error) {
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

    // A device this app cannot reach never starts a connection. The card has
    // no Connect button for it; this is the same answer for any other caller.
    const blocked = unsupportedNote(tracker, hcSupported);
    if (blocked) { showToast(blocked, 'error'); return; }

    if (tracker.protocol === 'healthconnect') {
      hc.sync();
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
    <div style={{ minHeight: '100vh', background: '#121316' }}>

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
                width: 32, height: 32, border: '3px solid rgba(212,175,55,0.2)',
                borderTopColor: '#D4AF37', borderRadius: '50%',
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

        {/* ── Health Connect ──
            With a bridge: the sync banner. Without one (every phone today):
            a plain statement of what cannot sync and what still works. It
            used to read "Tap to sync Samsung, Garmin, Fitbit data" and answer
            the tap with an error. */}
        {!hcSupported && (
          <div data-testid="hc-unsupported" style={{
            marginBottom: 16, padding: '14px 16px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: 16,
          }}>
            <p style={{ color: '#ededf0', fontWeight: 700, fontSize: 14, margin: 0 }}>
              Android Health Connect is not supported yet
            </p>
            <p style={{ color: '#8e8e9a', fontSize: 13, margin: '6px 0 0', lineHeight: 1.5 }}>
              FitLife cannot read Health Connect, so {HC_DEVICE_NAMES} cannot sync here for now.
              You can still log your sleep and workouts yourself on Today.
            </p>
          </div>
        )}
        {hcSupported && (
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
                : 'Tap to sync Samsung, Garmin and ring data'}
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
        )}

        {/* ── Connected devices ── */}
        {connectedTrackers.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <p style={{
              fontSize: 10, fontWeight: 700, color: '#6a6a78', marginBottom: 10,
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
                  unsupported={unsupportedNote(tracker, hcSupported)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Available ── */}
        {availableTrackers.length > 0 && (
          <div style={{ marginTop: connectedTrackers.length > 0 ? 20 : 0 }}>
            <p style={{
              fontSize: 10, fontWeight: 700, color: '#6a6a78', marginBottom: 10,
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
                  unsupported={unsupportedNote(tracker, hcSupported)}
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

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.5 } }
      `}</style>
    </div>
  );
}


/* ─── Tracker card ─────────────────────────────────────────────────────────── */
function TrackerCard({ tracker, isConnected, isSyncing, liveMetrics = {}, onConnect, onDisconnect, onSyncNow, oauthAvailable = {}, unsupported = null }) {
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
              // "Not supported yet" outranks everything: a "Popular" or "New"
              // badge on a device that cannot connect is an advert for a dead end.
              const blocked = !!unsupported && !isConnected;
              const badge = blocked ? 'Not supported yet' : notSetUp ? 'Setup pending' : tracker.badge;
              const badgeColor = (blocked || notSetUp) ? '#8e8e9a' : tracker.badgeColor;
              return badge && (
                <span style={{
                  fontSize: 9, fontWeight: 800, color: badgeColor,
                  background: `${badgeColor}18`, border: `1px solid ${badgeColor}44`,
                  borderRadius: 20, padding: '2px 7px',
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
              {liveMetrics.hrv && <span style={{ color: '#e0c98a', fontSize: 13, fontWeight: 700 }}>📊 HRV {liveMetrics.hrv}ms</span>}
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
          ) : unsupported ? (
            <p data-testid={`tracker-unsupported-${tracker.id}`} style={{
              margin: 0, padding: '11px 12px', borderRadius: 12,
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
              color: '#8e8e9a', fontSize: 13, lineHeight: 1.5,
            }}>{unsupported}</p>
          ) : (
            <button data-testid={`tracker-connect-${tracker.id}`} onClick={e => { e.stopPropagation(); onConnect(); }} style={{
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
