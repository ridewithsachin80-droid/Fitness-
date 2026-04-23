import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import { useOfflineSync } from './hooks/useOfflineQueue';
import { disconnectSocket } from './hooks/useSync';
import { useAuthStore } from './store/authStore';

// Pages (Sprint 3 — Login only; rest added as they're built)
import Login       from './pages/Login';
import DailyLog    from './pages/DailyLog';
import Monitor     from './pages/Monitor';
import PatientList from './pages/PatientList';
import Settings    from './pages/Settings';

// ── Route guard ───────────────────────────────────────────────────────────────
function PrivateRoute({ children, roles }) {
  const { user, isRestoring } = useAuthStore();

  // Show nothing while we're checking the session cookie
  if (isRestoring) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (roles && !roles.includes(user.role)) {
    // Redirect to the right home for this role
    return <Navigate to={user.role === 'patient' ? '/' : '/monitor'} replace />;
  }

  return children;
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const { login, setRestored } = useAuthStore();

  /**
   * On first load: silently try to refresh the access token using the
   * httpOnly refresh cookie. If it works → restore session without login.
   * If not → user goes to /login.
   */
  useEffect(() => {
    axios
      .post('/api/auth/refresh', {}, { withCredentials: true })
      .then(({ data }) => {
        // We have a valid session — also fetch user info from the token payload
        const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
        login(data.accessToken, { id: payload.id, name: payload.name, role: payload.role });
      })
      .catch(() => {
        // No valid session — let PrivateRoute redirect to /login
        setRestored();
      });
  }, []);

  const { user } = useAuthStore();

  // Sync any offline-queued logs whenever connection is restored
  useOfflineSync();

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<Login />} />

        {/* Patient routes */}
        <Route
          path="/"
          element={
            <PrivateRoute roles={['patient']}>
              <DailyLog />
            </PrivateRoute>
          }
        />

        {/* Monitor / admin routes */}
        <Route
          path="/monitor"
          element={
            <PrivateRoute roles={['monitor', 'admin']}>
              <PatientList />
            </PrivateRoute>
          }
        />
        <Route
          path="/monitor/:patientId"
          element={
            <PrivateRoute roles={['monitor', 'admin']}>
              <Monitor />
            </PrivateRoute>
          }
        />

        {/* Settings — any authenticated user */}
        <Route
          path="/settings"
          element={
            <PrivateRoute>
              <Settings />
            </PrivateRoute>
          }
        />

        {/* Catch-all → role-appropriate home */}
        <Route
          path="*"
          element={
            <Navigate
              to={
                !user
                  ? '/login'
                  : user.role === 'patient'
                  ? '/'
                  : '/monitor'
              }
              replace
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
