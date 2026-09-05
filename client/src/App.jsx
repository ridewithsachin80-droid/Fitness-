import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useOfflineSync } from './hooks/useOfflineQueue';
import { useAuthStore } from './store/authStore';
import { useSettingsStore, applyTheme, applyFontSize } from './store/settingsStore';
import { getMyOnboarding } from './api/logs';

import Login          from './pages/Login';
import DailyLog       from './pages/DailyLog';
import Progress       from './pages/Progress';
import Profile        from './pages/Profile';
import Coach        from './pages/Monitor';
import MemberList    from './pages/PatientList';
import Settings       from './pages/Settings';
import AdminDashboard from './pages/AdminDashboard';
import AdminFoods     from './pages/AdminFoods';
import DeviceConnect  from './pages/DeviceConnect';
import Onboarding     from './components/Onboarding';
import { onboardingDecision } from './utils/onboardingGate';
import HandsFree from './components/HandsFree';
import { refreshRequestBody, sessionLossReport } from './utils/session';

// Preserves the member id when redirecting an old /monitor/:id link to /coach/:id.
function LegacyMonitorRedirect() {
  const { memberId } = useParams();
  return <Navigate to={`/coach/${memberId}`} replace />;
}

function PrivateRoute({ children, roles }) {
  const { user, isRestoring } = useAuthStore();
  if (isRestoring) {
    return (
      <div className="min-h-screen bg-[#121316] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={user.role === 'patient' ? '/' : '/coach'} replace />;
  }
  return children;
}

export default function App() {
  const { login, setRestored } = useAuthStore();
  const { fontSize, ageMode, onboardingDone } = useSettingsStore();

  // Apply dark theme + font-size on boot
  useEffect(() => {
    applyTheme();
    applyFontSize(ageMode === 'senior' ? 'large' : fontSize);
  }, []);

  // Cold start: restore the session before rendering anything.
  //
  // This call used to post an EMPTY body, relying entirely on the cookie —
  // even though api/client.js carried a localStorage fallback written for
  // exactly this situation. On an installed iOS app, which has its own cookie
  // jar and sheds site data readily, the cookie is precisely the copy most
  // likely to be missing, and this is the FIRST request of the session, before
  // any interceptor can help. Sending the stored token here is what makes the
  // fallback reach the case it was written for.
  useEffect(() => {
    axios
      .post('/api/auth/refresh', refreshRequestBody(), { withCredentials: true })
      .then(({ data }) => {
        // Prefer the user object the server sends; fall back to decoding the
        // JWT so an older server (mid-deploy, or a stale service worker
        // talking to a new one) still restores rather than logging out.
        let u = data.user;
        if (!u || typeof u.id === 'undefined') {
          const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
          u = { id: payload.id, name: payload.name, role: payload.role };
        }
        login(data.accessToken, u, data.refreshToken || null);
      })
      .catch((err) => {
        // A 401 means the session is genuinely gone and the member must sign
        // in. Anything else — offline, server restarting, DNS — is NOT a
        // reason to record a session loss; doing so would drown the real
        // signal in noise from every flaky connection.
        if (err?.response?.status === 401) {
          try {
            const body = JSON.stringify(sessionLossReport('cold-start'));
            fetch('/api/auth/session-loss', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
              keepalive: true,
              credentials: 'include',
            }).catch(() => {});
          } catch (_) { /* diagnostics must never break boot */ }
        }
        setRestored();
      });
  }, []);

  const { user } = useAuthStore();
  useOfflineSync();

  // ── Onboarding gate ─────────────────────────────────────────────────────────
  // The flag used to come from localStorage alone, so a member on a second
  // phone — or one who had cleared their cache — was made to onboard again,
  // and the coach could not see the mode they had chosen. The server is now
  // the source of truth; the local flag is a cache that avoids a flash of the
  // onboarding screen on every cold start.
  const [serverOnboarded, setServerOnboarded] = useState(null); // null = not yet known
  const [justOnboarded,   setJustOnboarded]   = useState(false);
  const [checkFailed,     setCheckFailed]     = useState(false);
  const [checkAttempt,    setCheckAttempt]    = useState(0);

  useEffect(() => {
    if (user?.role !== 'patient') return undefined;

    // A member switching accounts must not be handed the previous answer.
    let cancelled = false;
    setCheckFailed(false);

    getMyOnboarding()
      .then(({ data }) => {
        if (cancelled) return;
        setServerOnboarded(data.onboarding_done === true);
        // Mirror the member's saved mode so font size and terminology follow
        // them onto this device.
        if (data.onboarding_done && data.age_mode) {
          useSettingsStore.getState().finishOnboarding(data.age_mode);
          if (Number.isInteger(data.avatar_idx)) {
            useSettingsStore.getState().setAvatarIdx(data.avatar_idx);
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        // We now know NOTHING about this member's setup state. That is not the
        // same as knowing they have not done it, and the gate no longer treats
        // it as such — see utils/onboardingGate.js.
        setCheckFailed(true);
      });

    return () => { cancelled = true; };
  }, [user?.id, checkAttempt]);

  if (user?.role === 'patient') {
    const decision = onboardingDecision({
      serverOnboarded,
      onboardingDone,
      justFinished: justOnboarded,
      checkFailed,
    });

    // 'wait' is the case that used to render the setup screen over the top of
    // an existing member. It never does that now: either we are still asking
    // the server, or the ask failed and the member gets a retry.
    if (decision === 'wait') {
      return (
        <div className="min-h-screen bg-[#121316] flex flex-col items-center justify-center gap-5 px-8 text-center">
          {!checkFailed ? (
            <div className="w-8 h-8 border-4 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <p className="text-[#E8E6E1] text-base">
                Couldn't reach FitLife just now.
              </p>
              <p className="text-[#9A968E] text-sm">
                Check your connection — your log is safe.
              </p>
              <button
                onClick={() => setCheckAttempt((n) => n + 1)}
                className="mt-1 px-6 py-3 rounded-xl bg-[#D4AF37] text-[#121316] font-semibold"
              >
                Try again
              </button>
            </>
          )}
        </div>
      );
    }

    if (decision === 'onboarding') {
      // onDone marks the completion as newer than the value fetched on mount.
      // Without it the member finishes setup and lands straight back on it.
      return <Onboarding onDone={() => setJustOnboarded(true)} />;
    }
  }

  return (
    <BrowserRouter>
      {/* Inside the router — it navigates on command — and rendered for every
          role, because a coach standing at the gym has the same hands-full
          problem a member does. It renders nothing unless switched on. */}
      <HandsFree />

      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<PrivateRoute roles={['patient']}><DailyLog /></PrivateRoute>} />
        <Route path="/progress" element={<PrivateRoute roles={['patient']}><Progress /></PrivateRoute>} />
        <Route path="/profile" element={<PrivateRoute roles={['patient']}><Profile /></PrivateRoute>} />
        <Route path="/coach" element={<PrivateRoute roles={['monitor','admin']}><MemberList /></PrivateRoute>} />
        <Route path="/coach/:memberId" element={<PrivateRoute roles={['monitor','admin']}><Coach /></PrivateRoute>} />
        {/* Legacy /monitor URLs — bookmarks, PWA shortcuts and links inside old
            coach notes still point here. Redirect rather than 404. Safe to drop
            once the coach team confirms no saved links remain. */}
        <Route path="/monitor" element={<Navigate to="/coach" replace />} />
        <Route path="/monitor/:memberId" element={<LegacyMonitorRedirect />} />
        <Route path="/admin" element={<PrivateRoute roles={['admin']}><AdminDashboard /></PrivateRoute>} />
        <Route path="/admin/foods" element={<PrivateRoute roles={['admin']}><AdminFoods /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
        <Route path="/devices" element={<PrivateRoute><DeviceConnect /></PrivateRoute>} />
        <Route path="*" element={
          <Navigate to={!user ? '/login' : user.role === 'patient' ? '/' : user.role === 'admin' ? '/admin' : '/coach'} replace />
        } />
      </Routes>
    </BrowserRouter>
  );
}
