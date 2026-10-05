import { useState } from 'react';
import api from '../../api/client';
import { haptic } from '../../store/settingsStore';

/**
 * StorageCheck — admin only. One tap proves the R2 photo storage works on
 * this environment: the server uploads a tiny file, reads it back and deletes
 * it (GET /api/plate/storage-check). Says which step failed if one does, so a
 * wrong key, a wrong bucket name or a missing variable is found before any
 * member's photo depends on it.
 */
const STEP = {
  config: 'The R2 variables are not all set in Railway.',
  upload: 'Upload refused: usually a wrong key, or a token without access to this bucket.',
  read:   'Uploaded, but it could not be read back.',
  delete: 'Uploaded and read, but the test file could not be deleted.',
};

export default function StorageCheck() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const run = async () => {
    haptic(10); setBusy(true); setRes(null);
    try { const { data } = await api.get('/plate/storage-check'); setRes(data); }
    catch (err) { setRes({ ok: false, step: 'request', error: err.response?.data?.error || 'The server did not answer.' }); }
    finally { setBusy(false); }
  };
  return (
    <div className="rounded-2xl border border-hair bg-surface px-4 py-3 mt-3" data-testid="storage-check">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-white">Photo storage</span>
        <button type="button" onClick={run} disabled={busy} style={{ minHeight: 40 }} data-testid="storage-check-run"
          className="text-caption font-bold text-gold border border-gold/50 rounded-xl px-3 disabled:opacity-50">
          {busy ? 'Checking…' : 'Check now'}
        </button>
      </div>
      {res && (
        <p className={`text-caption mt-2 leading-snug ${res.ok ? 'text-ok' : 'text-red-300'}`} data-testid="storage-check-result">
          {res.ok ? `Working. Uploaded, read back and deleted a test file in "${res.bucket}".`
            : `${STEP[res.step] || 'Not working.'} ${res.error ? `(${res.error})` : ''}`}
        </p>
      )}
    </div>
  );
}
