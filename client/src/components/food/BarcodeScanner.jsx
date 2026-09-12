/**
 * components/food/BarcodeScanner.jsx — BarcodeDetector → /foods/lookup (OpenFoodFacts).
 * Moved out of components/FoodLog.jsx verbatim (Sprint 12c). Behaviour unchanged.
 */
import { useState, useRef, useEffect } from 'react';
import api from '../../api/client';
import { haptic } from '../../store/settingsStore';

export const hasBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;

export function BarcodeScanner({ onFound, onClose }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('Starting camera…');

  useEffect(() => {
    let stream, raf, stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus('Point at the barcode');
        const detector = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'],
        });
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length) {
              stopped = true;
              stream.getTracks().forEach(t => t.stop());
              onFound(codes[0].rawValue);
              return;
            }
          } catch { /* frame not ready */ }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        setStatus(err?.name === 'NotAllowedError'
          ? 'Camera blocked — allow camera access in browser settings'
          : 'Could not start the camera');
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [onFound]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-6"
      onClick={onClose}>
      <video ref={videoRef} playsInline muted
        className="w-full max-w-sm rounded-2xl border border-white/[0.15]"
        onClick={e => e.stopPropagation()} />
      <p className="text-sm text-white mt-4">{status}</p>
      <button onClick={onClose} style={{ minHeight: 44 }}
        className="mt-3 px-6 rounded-full border border-white/[0.25] text-sm text-white">
        Cancel
      </button>
    </div>
  );
}


// ── Coach's meal plan — prescribed vs consumed, workout-log style ────────────
// Each prescribed item shows the coach's amount with an editable consumed-grams
// field (prefilled with the prescription). "Log this meal" appends everything
// non-zero into today's food with the plan's nutrition — no AI round-trip.
// Items already logged for that meal (matched by name) show as done.
