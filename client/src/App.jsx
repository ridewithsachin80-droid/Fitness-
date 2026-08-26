import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useOfflineSync } from './hooks/useOfflineQueue';
import { useAuthStore } from './store/authStore';
import { useSettingsStore, applyTheme, applyFontSize } from './store/settingsStore';

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

// Preserves the member id when redirecting an old /monitor/:id link to /coach/:id.
function LegacyMonitorRedirect() {
  const { memberId } = useParams();
  return <Navigate to={`/coach/${memberId}`} replace />;
}

function PrivateRoute({ children, roles }) {
  const { user, isRestoring } = useAuthStore();
  if (isRestoring) {
    return (
      <div className="min-h-screen bg-[#0b0b0e] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#c9a227] border-t-transparent rounded-full animate-spin" />
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

  useEffect(() => {
    axios
      .post('/api/auth/refresh', {}, { withCredentials: true })
      .then(({ data }) => {
        const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
        login(data.accessToken, { id: payload.id, name: payload.name, role: payload.role });
      })
      .catch(() => { setRestored(); });
  }, []);

  const { user } = useAuthStore();
  useOfflineSync();

  // Show onboarding for logged-in members who haven't completed it
  if (user?.role === 'patient' && !onboardingDone) {
    return <Onboarding />;
  }

  return (
    <BrowserRouter>
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
