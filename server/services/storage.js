/**
 * services/storage.js — private photo storage on Cloudflare R2.
 *
 * R2 speaks the Amazon S3 protocol. Rather than add the AWS SDK (a large
 * dependency, and the lock files would have to change with it), this signs
 * the four requests the app needs with AWS Signature Version 4, which is a
 * page of HMAC. scripts/test-storage.js checks the signatures against
 * signatures produced by the official AWS SDK for the same inputs.
 *
 * Nothing in the bucket is public. A photo is shown through a GET link that
 * this file signs and that stops working after a few minutes.
 *
 * Configuration (Railway variables; production and Test each have their own
 * bucket and their own keys):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *   R2_ENDPOINT   optional: overrides https://<account>.r2.cloudflarestorage.com
 *                 (the tests point it at a local stand-in)
 */
const crypto = require('crypto');
const axios = require('axios');

const REGION = 'auto', SERVICE = 's3';
const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
// RFC 3986: everything but A-Z a-z 0-9 - _ . ~ is percent-encoded.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (p) => p.split('/').map(enc).join('/');

function config(env = process.env) {
  const c = {
    accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID,
    secret: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET,
  };
  c.endpoint = (env.R2_ENDPOINT || (c.accountId ? `https://${c.accountId}.r2.cloudflarestorage.com` : '')).replace(/\/+$/, '');
  c.ready = !!(c.endpoint && c.accessKeyId && c.secret && c.bucket);
  return c;
}
const isConfigured = (env) => config(env).ready;

const amzDates = (now) => {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');   // 20261005T063500Z
  return { amz: iso, day: iso.slice(0, 8) };
};
const signingKey = (secret, day, region = REGION, service = SERVICE) =>
  hmac(hmac(hmac(hmac('AWS4' + secret, day), region), service), 'aws4_request');

/**
 * Signature V4 for a request with headers (PUT, GET, DELETE).
 * Exported for the test against the AWS SDK.
 */
function signHeaders({ method, host, path, query = {}, headers = {}, payloadHash, accessKeyId, secret, region = REGION, now = new Date() }) {
  const { amz, day } = amzDates(now);
  const h = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])),
              host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amz };
  const names = Object.keys(h).sort();
  const canonQuery = Object.keys(query).sort().map(k => `${enc(k)}=${enc(String(query[k]))}`).join('&');
  const canon = [method, encPath(path), canonQuery, names.map(n => `${n}:${h[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${SERVICE}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha256hex(canon)].join('\n');
  const sig = crypto.createHmac('sha256', signingKey(secret, day, region)).update(toSign).digest('hex');
  return { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` };
}

/** A GET link that works for `expires` seconds and then stops. */
function presignGet({ host, path, accessKeyId, secret, expires = 300, region = REGION, now = new Date(), protocol = 'https:', extraQuery = {} }) {
  const { amz, day } = amzDates(now);
  const scope = `${day}/${region}/${SERVICE}/aws4_request`;
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amz, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host',
    // extraQuery: only the test uses it, to sign exactly the query the AWS SDK signs.
    ...extraQuery,
  };
  const canonQuery = Object.keys(q).sort().map(k => `${enc(k)}=${enc(q[k])}`).join('&');
  const canon = ['GET', encPath(path), canonQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha256hex(canon)].join('\n');
  const sig = crypto.createHmac('sha256', signingKey(secret, day, region)).update(toSign).digest('hex');
  return `${protocol}//${host}${encPath(path)}?${canonQuery}&X-Amz-Signature=${sig}`;
}

function target(key, env) {
  const c = config(env);
  if (!c.ready) throw Object.assign(new Error('Photo storage is not configured (R2_* variables).'), { code: 'NOT_CONFIGURED' });
  if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]{0,500}$/.test(key) || key.includes('..')) throw new Error('Bad storage key');
  const u = new URL(c.endpoint);
  return { c, host: u.host, protocol: u.protocol, path: `${u.pathname.replace(/\/$/, '')}/${c.bucket}/${key}` };
}

async function send(method, key, { body = null, contentType, env } = {}) {
  const { c, host, protocol, path } = target(key, env);
  const data = body || Buffer.alloc(0);
  const headers = signHeaders({ method, host, path, headers: contentType ? { 'content-type': contentType } : {},
    payloadHash: sha256hex(data), accessKeyId: c.accessKeyId, secret: c.secret });
  delete headers.host;   // the HTTP client sets it from the URL
  return axios({ method, url: `${protocol}//${host}${encPath(path)}`, data: body || undefined, headers,
    responseType: method === 'GET' ? 'arraybuffer' : 'text', timeout: 20000, maxBodyLength: 20e6,
    validateStatus: () => true });
}

async function putObject(key, body, contentType, env) {
  const r = await send('PUT', key, { body, contentType, env });
  if (r.status !== 200) throw new Error(`Storage upload failed (${r.status})`);
}
async function getObject(key, env) {
  const r = await send('GET', key, { env });
  if (r.status === 404) return null;
  if (r.status !== 200) throw new Error(`Storage read failed (${r.status})`);
  return Buffer.from(r.data);
}
async function deleteObject(key, env) {
  const r = await send('DELETE', key, { env });
  // S3 answers 204 for a delete, and also for a key that was never there.
  if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw new Error(`Storage delete failed (${r.status})`);
}
function photoUrl(key, { expires = 300, env } = {}) {
  const { c, host, protocol, path } = target(key, env);
  return presignGet({ host, path, protocol, accessKeyId: c.accessKeyId, secret: c.secret, expires });
}

/** Upload, read back and delete a tiny file: proves the keys and bucket work. */
async function selfCheck(env) {
  const c = config(env);
  if (!c.ready) return { ok: false, step: 'config', error: 'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET must all be set.' };
  const key = `healthcheck/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.txt`;
  const body = Buffer.from(`fitlife storage check ${new Date().toISOString()}`);
  try { await putObject(key, body, 'text/plain', env); } catch (e) { return { ok: false, step: 'upload', bucket: c.bucket, error: e.message }; }
  try {
    const back = await getObject(key, env);
    if (!back || !back.equals(body)) return { ok: false, step: 'read', bucket: c.bucket, error: 'The file read back did not match.' };
  } catch (e) { return { ok: false, step: 'read', bucket: c.bucket, error: e.message }; }
  try { await deleteObject(key, env); } catch (e) { return { ok: false, step: 'delete', bucket: c.bucket, error: e.message }; }
  return { ok: true, bucket: c.bucket };
}

module.exports = { config, isConfigured, signHeaders, presignGet, putObject, getObject, deleteObject, photoUrl, selfCheck, sha256hex };
