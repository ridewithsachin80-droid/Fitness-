import api from '../api/client';

/**
 * Fetch a file from the API (with the login) and hand it to the member:
 * the phone's share sheet where it can take files (WhatsApp, Drive, Files),
 * otherwise a normal download. A plain <a href> would not carry the login.
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function shareOrDownload(path, { filename = 'FitLife.pdf', title = 'FitLife', type = 'application/pdf' } = {}) {
  const res = await api.get(path, { responseType: 'blob', timeout: 60000 });
  const name = filenameFrom(res.headers?.['content-disposition']) || filename;
  const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type });
  const file = typeof File === 'function' ? new File([blob], name, { type }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'shared'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelled'; /* fall through to a download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

export function filenameFrom(disposition) {
  const m = /filename="?([^";]+)"?/i.exec(String(disposition || ''));
  return m ? m[1] : null;
}
