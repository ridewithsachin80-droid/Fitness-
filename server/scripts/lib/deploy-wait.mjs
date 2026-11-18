// scripts/lib/deploy-wait.mjs — Fixes-3h (2 Nov 2026). Wait until the site reports the wanted commit; FAIL if it never does.
// fetchCommit() returns the live commit string (or throws / returns null when the site cannot be read).
export async function waitForCommit({ fetchCommit, want, tries = 60, delayMs = 15000, sleep = (ms) => new Promise(r => setTimeout(r, ms)) }) {
  if (!want) return { ok: true, required: false, live: null, reason: 'no commit requested (local run)' };
  const same = (a, b) => !!a && !!b && (a.startsWith(b.slice(0, 7)) || b.startsWith(a.slice(0, 7)));
  let live = null, lastError = null;
  for (let i = 0; i < tries; i++) {
    try { live = (await fetchCommit()) || null; lastError = null; } catch (e) { live = null; lastError = e?.message || String(e); }
    if (same(live, want)) return { ok: true, required: true, live, reason: 'match' };
    if (i < tries - 1) await sleep(delayMs);
  }
  return { ok: false, required: true, live, reason: live ? 'mismatch: a different commit is live' : `unavailable: the site did not report a commit${lastError ? ` (${lastError})` : ''}` };
}
