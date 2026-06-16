import { useEffect, useRef } from 'react';
import { io }               from 'socket.io-client';
import { useAuthStore }     from '../store/authStore';

// Singleton socket — shared across hook instances so we don't open
// multiple connections if both PatientList and Monitor mount together.
let socket = null;

/**
 * Connects to the Socket.io server and listens for log_updated events.
 *
 * Monitor usage:
 *   useSync((update) => { ... })  // update = { patientId, date, compliance, weight_kg }
 *
 * Patient usage:
 *   useSync()  // just joins their own room (push ack)
 *
 * Rooms:
 *   monitor_${monitorId}  — monitor sees updates for any of their patients
 *   user_${patientId}     — patient's own room
 */
export function useSync(onLogUpdated) {
  const { user }         = useAuthStore();
  const callbackRef      = useRef(onLogUpdated);

  // Keep callback ref fresh without re-running effect
  useEffect(() => { callbackRef.current = onLogUpdated; }, [onLogUpdated]);

  useEffect(() => {
    if (!user) return;

    // Reuse existing socket if already connected
    if (!socket || !socket.connected) {
      socket = io(import.meta.env.VITE_SOCKET_URL || '/', {
        withCredentials: true,
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });

      socket.on('connect', () => {
        console.log('🔌 Socket connected:', socket.id);
      });
      socket.on('disconnect', (reason) => {
        console.log('🔌 Socket disconnected:', reason);
      });
      socket.on('connect_error', (err) => {
        console.warn('Socket connect error:', err.message);
      });
    }

    // Join the appropriate room
    if (user.role === 'monitor' || user.role === 'admin') {
      socket.emit('join_monitor_room', user.id);
    } else if (user.role === 'patient') {
      socket.emit('join_room', user.id);
    }

    // Listen for log_updated events
    const handler = (data) => {
      console.log('📡 log_updated:', data);
      if (callbackRef.current) callbackRef.current(data);
    };
    socket.on('log_updated', handler);

    return () => {
      socket.off('log_updated', handler);
      // Don't disconnect on unmount — the singleton persists across nav
    };
  }, [user?.id, user?.role]);
}

/** Manually disconnect — call on logout */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
