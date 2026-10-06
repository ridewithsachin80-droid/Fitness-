/**
 * scripts/lib/r2-standin.js — a local stand-in for Cloudflare R2.
 *
 * Keeps objects in memory and REJECTS (403) any request whose AWS Signature V4
 * does not verify with the shared test secret, including signed links whose
 * expiry was changed or has passed. Used by suites that store photos.
 * (test-plate-photo.js has its own copy, written first.)
 */
const http = require('http');

function startR2(storage, keys) {
  const R2 = { objects: new Map(), rejected: 0, down: false, server: null };
  const parseAmz = (amz) => Date.UTC(+amz.slice(0, 4), +amz.slice(4, 6) - 1, +amz.slice(6, 8), +amz.slice(9, 11), +amz.slice(11, 13), +amz.slice(13, 15));
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const u = new URL(req.url, 'http://x');
        if (R2.down) { res.writeHead(500); return res.end(); }
        let ok = false;
        if (u.searchParams.get('X-Amz-Signature')) {
          const t = parseAmz(u.searchParams.get('X-Amz-Date') || '');
          const expires = +u.searchParams.get('X-Amz-Expires');
          const again = new URL(storage.presignGet({ host: req.headers.host, path: u.pathname, protocol: 'http:', accessKeyId: keys.id, secret: keys.secret, expires, now: new Date(t) }));
          ok = again.searchParams.get('X-Amz-Signature') === u.searchParams.get('X-Amz-Signature') && Date.now() <= t + expires * 1000;
        } else {
          const t = parseAmz(req.headers['x-amz-date'] || '');
          const headers = req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {};
          const again = storage.signHeaders({ method: req.method, host: req.headers.host, path: u.pathname, headers,
            payloadHash: storage.sha256hex(body), accessKeyId: keys.id, secret: keys.secret, now: new Date(t) });
          ok = again.authorization === req.headers.authorization && req.headers['x-amz-content-sha256'] === storage.sha256hex(body);
        }
        if (!ok) { R2.rejected++; res.writeHead(403); return res.end('SignatureDoesNotMatch'); }
        if (req.method === 'PUT') { R2.objects.set(u.pathname, body); res.writeHead(200); return res.end(); }
        if (req.method === 'GET') { const b = R2.objects.get(u.pathname); if (!b) { res.writeHead(404); return res.end(); } res.writeHead(200); return res.end(b); }
        if (req.method === 'DELETE') { R2.objects.delete(u.pathname); res.writeHead(204); return res.end(); }
        res.writeHead(405); res.end();
      });
    });
    srv.listen(0, '127.0.0.1', () => { R2.server = srv; R2.endpoint = `http://127.0.0.1:${srv.address().port}`; resolve(R2); });
  });
}

module.exports = { startR2 };
