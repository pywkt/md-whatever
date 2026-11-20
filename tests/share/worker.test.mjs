// Tests for share/worker.js, the Worker behind md.wtvr.sh, against fake
// bindings (fakes.mjs).  node --test tests/share/worker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { sweep } from '../../share/worker.js';
import { fakeEnv } from './fakes.mjs';

const call = (env, path, init = {}, host = 'md.wtvr.sh') => {
  const headers = { 'cf-connecting-ip': '203.0.113.7', ...(init.headers || {}) };
  return worker.fetch(new Request(`https://${host}${path}`, { ...init, headers }), env);
};
const bytes = (n, fill = 7) => new Uint8Array(n).fill(fill);
const post = (env, body, days = 7, headers = {}) => call(env, `/api/shares?days=${days}`, { method: 'POST', body, headers });

async function share(env, body = bytes(100), days = 7) {
  const res = await post(env, body, days);
  assert.equal(res.status, 201);
  return res.json();
}

test('wtvr.sh redirects to md.wtvr.sh, temporarily, keeping the path and query', async () => {
  const env = fakeEnv();
  const res = await call(env, '/are/k3J9x2Hq7v?x=1', {}, 'wtvr.sh');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://md.wtvr.sh/are/k3J9x2Hq7v?x=1');
  const root = await call(env, '/', {}, 'wtvr.sh');
  assert.equal(root.headers.get('location'), 'https://md.wtvr.sh/');
  // md.wtvr.sh itself, and local runs, are served
  assert.equal((await call(env, '/')).status, 200);
  assert.equal((await call(env, '/', {}, '127.0.0.1:8787')).status, 200);
});

test('the page gets security headers; other files are left alone', async () => {
  const env = fakeEnv();
  const res = await call(env, '/are/k3J9x2Hq7v');
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /connect-src 'self' https:\/\/cdnjs\.cloudflare\.com https:\/\/cdn\.jsdelivr\.net(;|$)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /'wasm-unsafe-eval'/);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  env.ASSETS.fetch = async () => new Response('x', { headers: { 'Content-Type': 'text/javascript' } });
  const js = await call(env, '/sw.js');
  assert.equal(js.headers.get('content-security-policy'), null);
});

test('share, read back, remove', async () => {
  const env = fakeEnv();
  const before = Date.now();
  const made = await share(env, bytes(500, 42));
  assert.match(made.id, /^[0-9A-Za-z]{10}$/);
  assert.match(made.token, /^[A-Za-z0-9_-]{22}$/);
  const exp = Date.parse(made.expires);
  assert.ok(exp >= before + 7 * 864e5 && exp <= Date.now() + 7 * 864e5);

  // stored: the bytes, the expiry, and only a hash of the token
  const stored = env.SHARES.objects.get(made.id);
  assert.deepEqual(stored.bytes, bytes(500, 42));
  assert.equal(stored.customMetadata.expires, made.expires);
  assert.match(stored.customMetadata.token, /^[0-9a-f]{64}$/);
  assert.notEqual(stored.customMetadata.token, made.token);

  const got = await call(env, `/api/shares/${made.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('cache-control'), 'no-store');
  assert.equal(got.headers.get('mdw-expires'), made.expires);
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), bytes(500, 42));
  const head = await call(env, `/api/shares/${made.id}`, { method: 'HEAD' });
  assert.equal(head.status, 200);

  // removing: needs the token
  assert.equal((await call(env, `/api/shares/${made.id}`, { method: 'DELETE' })).status, 401);
  const wrong = await call(env, `/api/shares/${made.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + 'A'.repeat(22) } });
  assert.equal(wrong.status, 403);
  assert.ok(env.SHARES.objects.has(made.id));
  const ok = await call(env, `/api/shares/${made.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + made.token } });
  assert.equal(ok.status, 204);
  assert.equal(env.SHARES.objects.size, 0);
  assert.equal((await call(env, `/api/shares/${made.id}`)).status, 404);
  // again: already gone is fine
  const again = await call(env, `/api/shares/${made.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + made.token } });
  assert.equal(again.status, 204);
});

test('expiry choices', async () => {
  const env = fakeEnv();
  for (const days of [1, 7, 30]) {
    const made = await share(env, bytes(64), days);
    const left = Date.parse(made.expires) - Date.now();
    assert.ok(Math.abs(left - days * 864e5) < 60000, `${days} days`);
  }
  for (const days of [0, 2, 31, 'x', '']) assert.equal((await post(env, bytes(64), days)).status, 400, `days=${days}`);
  assert.equal((await call(env, '/api/shares', { method: 'POST', body: bytes(64) })).status, 400, 'no days');
});

test('expired shares are refused, then swept', async () => {
  const env = fakeEnv();
  const old = await share(env);
  const fresh = await share(env);
  const noMeta = await share(env);
  env.SHARES.objects.get(old.id).customMetadata.expires = new Date(Date.now() - 1000).toISOString();
  env.SHARES.objects.get(noMeta.id).customMetadata = {};
  assert.equal((await call(env, `/api/shares/${old.id}`)).status, 410);
  assert.equal((await call(env, `/api/shares/${noMeta.id}`)).status, 410);
  assert.equal((await call(env, `/api/shares/${fresh.id}`)).status, 200);
  assert.equal(await sweep(env, Date.now()), 2);
  assert.deepEqual([...env.SHARES.objects.keys()], [fresh.id]);
  // a week later, the 7-day one goes too
  assert.equal(await sweep(env, Date.now() + 8 * 864e5), 1);
  assert.equal(env.SHARES.objects.size, 0);
});

test('the sweep pages through a big bucket', async () => {
  const env = fakeEnv(null, { create: 5000 });
  const past = new Date(Date.now() - 1000).toISOString();
  for (let i = 0; i < 2500; i++) {
    await env.SHARES.put(`id${String(i).padStart(8, '0')}`, bytes(28), { customMetadata: { expires: i % 2 ? past : new Date(Date.now() + 864e5).toISOString() } });
  }
  assert.equal(await sweep(env, Date.now()), 1250);
  assert.equal(env.SHARES.objects.size, 1250);
});

test('the scheduled handler runs the sweep', async () => {
  const env = fakeEnv();
  const made = await share(env);
  env.SHARES.objects.get(made.id).customMetadata.expires = '2000-01-01T00:00:00.000Z';
  const pending = [];
  await worker.scheduled({ cron: '17 4 * * *' }, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  assert.equal(env.SHARES.objects.size, 0);
});

test('size limits', async () => {
  const env = fakeEnv(null, { create: 100 });
  assert.equal((await post(env, bytes(1024 * 1024))).status, 201, 'exactly 1 MiB');
  const big = await post(env, bytes(1024 * 1024 + 1));
  assert.equal(big.status, 413);
  assert.match((await big.json()).error, /1 MB/);
  // without a Content-Length (streamed): still stopped at the limit
  const stream = new ReadableStream({
    pull(c) { c.enqueue(bytes(256 * 1024)); },
  });
  const streamed = await call(env, '/api/shares?days=7', { method: 'POST', body: stream, duplex: 'half' });
  assert.equal(streamed.status, 413);
  assert.equal((await post(env, bytes(27))).status, 400, 'smaller than an IV and tag');
  assert.equal((await post(env, new Uint8Array(0))).status, 400);
});

test('rate limits, per address', async () => {
  const env = fakeEnv(null, { create: 3, read: 4 });
  for (let i = 0; i < 3; i++) await share(env);
  const limited = await post(env, bytes(64));
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /minute/);
  assert.equal((await post(env, bytes(64), 7, { 'cf-connecting-ip': '198.51.100.1' })).status, 201, 'another address');
  const id = [...env.SHARES.objects.keys()][0];
  for (let i = 0; i < 4; i++) assert.equal((await call(env, `/api/shares/${id}`)).status, 200);
  assert.equal((await call(env, `/api/shares/${id}`)).status, 429);
});

test('bad requests', async () => {
  const env = fakeEnv();
  assert.equal((await call(env, '/api/shares')).status, 405);
  assert.equal((await call(env, '/api/shares/abc')).status, 404);
  assert.equal((await call(env, '/api/shares/k3J9x2Hq7v/x')).status, 404);
  assert.equal((await call(env, '/api/shares/k3J9x2Hq7v', { method: 'PUT', body: 'x' })).status, 405);
  assert.equal((await call(env, '/api/other')).status, 404);
  const missing = await call(env, '/api/shares/k3J9x2Hq7v');
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /expired or was removed/);
});

test('ids are random and avoid ones in use', async () => {
  const env = fakeEnv(null, { create: 1000 });
  const ids = new Set();
  for (let i = 0; i < 300; i++) ids.add((await share(env, bytes(28))).id);
  assert.equal(ids.size, 300);
  const chars = new Set([...ids].join(''));
  assert.ok(chars.size > 55, `${chars.size} different characters`);
  // a bucket whose first answers all say "taken" makes it try again
  let taken = 2;
  const head = env.SHARES.head.bind(env.SHARES);
  env.SHARES.head = async (k) => (taken-- > 0 ? { key: k } : head(k));
  assert.equal((await post(env, bytes(28))).status, 201);
  taken = 10;
  assert.equal((await post(env, bytes(28))).status, 500);
});
