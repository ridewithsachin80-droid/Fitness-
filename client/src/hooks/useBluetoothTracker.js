/**
 * useBluetoothTracker.js
 *
 * React hook for connecting to Bluetooth LE wearables (HART ring, Ultraviolet, etc.)
 * via the Web Bluetooth API (Chrome on Android / Desktop).
 *
 * GATT services used:
 *  - Heart Rate Service         0x180D  → heart_rate_measurement 0x2A37
 *  - SpO₂ / Pulse Oximeter     0x1822  → plx_continuous_measurement 0x2A5F
 *  - Health Thermometer         0x1809  → temperature_measurement 0x2A1C
 *  - User Data (steps / HRV)   0x181C  → database_change_increment 0x2A99
 *  - Battery                   0x180F  → battery_level 0x2A19
 *
 * If the ring exposes a custom service UUID, swap the HART_SERVICE_UUID below.
 * The parser functions handle the standard Bluetooth SIG byte encoding.
 */

import { useState, useRef, useCallback } from 'react';
import api from '../api/client';

/* ── Standard GATT UUIDs ─────────────────────────────────────── */
const GATT = {
  HEART_RATE_SERVICE:         0x180D,
  HR_MEASUREMENT:             0x2A37,
  BATTERY_SERVICE:            0x180F,
  BATTERY_LEVEL:              0x2A19,
  PULSE_OX_SERVICE:           0x1822,
  PLX_CONTINUOUS:             0x2A5F,
  HEALTH_THERM_SERVICE:       0x1809,
  TEMP_MEASUREMENT:           0x2A1C,
};

/* ── HART-specific custom service UUID (placeholder) ─────────── */
const HART_CUSTOM_SERVICE = 'heart_rate'; // use standard HR service if custom UUID unknown

/* ── Parsers ─────────────────────────────────────────────────── */
function parseHeartRate(value) {
  // Bit 0 of flags: 0 = UINT8, 1 = UINT16
  const flags  = value.getUint8(0);
  const is16   = flags & 0x01;
  const bpm    = is16 ? value.getUint16(1, true) : value.getUint8(1);

  // RR intervals start at byte 3 (16-bit) or 2 (8-bit)
  let hrv = null;
  const rrOffset = is16 ? 3 : 2;
  if (value.byteLength > rrOffset + 1) {
    const rr = value.getUint16(rrOffset, true) / 1024 * 1000; // convert to ms
    hrv = Math.round(rr);
  }

  return { bpm, hrv };
}

function parsePulseOx(value) {
  // PLX Continuous Measurement: SpO₂ at bytes 1-2, pulse at bytes 3-4
  const spo2  = value.getUint16(1, true) / 100; // 0.01% resolution
  const pulse = value.getUint16(3, true) / 100;
  return { spo2: Math.round(spo2 * 10) / 10, pulse: Math.round(pulse) };
}

function parseTemp(value) {
  // IEEE 11073 32-bit float at bytes 1-4
  const mantissa = value.getInt32(1, true) & 0x00FFFFFF;
  const exponent = value.getInt8(4);
  const temp = mantissa * Math.pow(10, exponent);
  return { temp_c: Math.round(temp * 10) / 10 };
}

/* ═══════════════════════════════════════════════════════════════
   Hook
═══════════════════════════════════════════════════════════════ */
export default function useBluetoothTracker() {
  const [status,      setStatus]      = useState('idle');   // idle|connecting|reading|syncing|done|error|unavailable
  const [error,       setError]       = useState(null);
  const [device,      setDevice]      = useState(null);
  const [liveMetrics, setLiveMetrics] = useState({});
  const deviceRef     = useRef(null);
  const metricsRef    = useRef({});

  const isAvailable = () =>
    typeof navigator !== 'undefined' && !!navigator.bluetooth;

  /* ── Update live metrics and keep ref in sync ───────────── */
  const updateMetric = useCallback((key, value) => {
    metricsRef.current = { ...metricsRef.current, [key]: value };
    setLiveMetrics({ ...metricsRef.current });
  }, []);

  /* ── Post accumulated metrics to backend ────────────────── */
  const postToBackend = useCallback(async (extraMeta = {}) => {
    const payload = {
      ...metricsRef.current,
      ...extraMeta,
    };
    setStatus('syncing');
    try {
      await api.post('/trackers/ble/sync', payload);
      setStatus('done');
    } catch (err) {
      console.error('BLE backend sync error:', err);
      setStatus('error');
      setError('Connected to ring but failed to save to server');
    }
  }, []);

  /* ── Main connect function ───────────────────────────────── */
  const connect = useCallback(async () => {
    if (!isAvailable()) {
      setStatus('unavailable');
      setError('Web Bluetooth is not supported. Use Chrome on Android or Desktop.');
      return;
    }

    setStatus('connecting');
    setError(null);
    metricsRef.current = {};

    try {
      /* Request device — show browser picker */
      const btDevice = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [HART_CUSTOM_SERVICE] },
          { namePrefix: 'HART' },
          { namePrefix: 'Ultraviolet' },
          { namePrefix: 'Ring' },
        ],
        optionalServices: [
          GATT.HEART_RATE_SERVICE,
          GATT.BATTERY_SERVICE,
          GATT.PULSE_OX_SERVICE,
          GATT.HEALTH_THERM_SERVICE,
        ],
      });

      deviceRef.current = btDevice;
      setDevice({ id: btDevice.id, name: btDevice.name });
      updateMetric('device_name', btDevice.name);
      updateMetric('device_id',   btDevice.id);

      btDevice.addEventListener('gattserverdisconnected', () => {
        setStatus('idle');
        // Auto-save on disconnect
        postToBackend();
      });

      const server = await btDevice.gatt.connect();
      setStatus('reading');

      /* ── Heart Rate ─────────────────────────────────────── */
      try {
        const hrService = await server.getPrimaryService(GATT.HEART_RATE_SERVICE);
        const hrChar    = await hrService.getCharacteristic(GATT.HR_MEASUREMENT);
        await hrChar.startNotifications();
        hrChar.addEventListener('characteristicvaluechanged', (e) => {
          const { bpm, hrv } = parseHeartRate(e.target.value);
          updateMetric('heart_rate', bpm);
          if (hrv) updateMetric('hrv', hrv);
        });
      } catch { /* service not present */ }

      /* ── Battery ────────────────────────────────────────── */
      try {
        const batService = await server.getPrimaryService(GATT.BATTERY_SERVICE);
        const batChar    = await batService.getCharacteristic(GATT.BATTERY_LEVEL);
        const val        = await batChar.readValue();
        updateMetric('battery', val.getUint8(0));
        batChar.addEventListener('characteristicvaluechanged', (e) => {
          updateMetric('battery', e.target.value.getUint8(0));
        });
        await batChar.startNotifications().catch(() => {});
      } catch { /* service not present */ }

      /* ── SpO₂ / Pulse Oximeter ──────────────────────────── */
      try {
        const oxService = await server.getPrimaryService(GATT.PULSE_OX_SERVICE);
        const oxChar    = await oxService.getCharacteristic(GATT.PLX_CONTINUOUS);
        await oxChar.startNotifications();
        oxChar.addEventListener('characteristicvaluechanged', (e) => {
          const { spo2 } = parsePulseOx(e.target.value);
          updateMetric('spo2', spo2);
        });
      } catch { /* service not present */ }

      /* ── Skin Temperature ───────────────────────────────── */
      try {
        const tempService = await server.getPrimaryService(GATT.HEALTH_THERM_SERVICE);
        const tempChar    = await tempService.getCharacteristic(GATT.TEMP_MEASUREMENT);
        await tempChar.startNotifications();
        tempChar.addEventListener('characteristicvaluechanged', (e) => {
          const { temp_c } = parseTemp(e.target.value);
          updateMetric('skin_temp', temp_c);
        });
      } catch { /* service not present */ }

      // After 10 seconds of reading, push whatever we have to the server
      setTimeout(() => {
        if (metricsRef.current.heart_rate) {
          postToBackend();
        }
      }, 10_000);

    } catch (err) {
      if (err.name === 'NotFoundError') {
        // User cancelled the picker
        setStatus('idle');
      } else {
        console.error('BLE connect error:', err);
        setError(err.message || 'Failed to connect to device');
        setStatus('error');
      }
    }
  }, [updateMetric, postToBackend]);

  /* ── Disconnect ──────────────────────────────────────────── */
  const disconnect = useCallback(() => {
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect(); // triggers gattserverdisconnected → postToBackend
    }
    setStatus('idle');
    setDevice(null);
  }, []);

  /* ── Manual sync ─────────────────────────────────────────── */
  const syncNow = useCallback(() => {
    return postToBackend();
  }, [postToBackend]);

  return {
    connect,
    disconnect,
    syncNow,
    status,
    error,
    device,
    liveMetrics,
    isAvailable,
  };
}
