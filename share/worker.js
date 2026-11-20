// md.wtvr.sh: the hosted web reader (the files in build/web/site) and shared
// files. wtvr.sh redirects here for now (302, so it can become something else).
//
//   /                     the reader (static files; unknown paths get the page)
//   /are/<id>#<key>       a share link: the reader, which then fetches <id>
//   POST   /api/shares?days=1|7|30   body: the encrypted file -> 201 { id, token, expires }
//   GET    /api/shares/<id>          -> the encrypted file (Mdw-Expires: its expiry)
//   DELETE /api/shares/<id>          Authorization: Bearer <token> -> 204
//
// Files are encrypted in the browser (web/lib.js packShare) and the key stays in
// the link's #fragment, which browsers never send: everything stored here is
// unreadable without the link. R2 (bucket SHARES) holds one object per share;
// customMetadata keeps its expiry and a SHA-256 of its delete token. A daily
// cron deletes expired shares (and a 31-day bucket lifecycle rule catches any
// it misses); until then they're refused.

const DAYS = new Set([1, 7, 30]);
const MAX_BYTES = 1024 * 1024; // encrypted (so compressed) size
const MIN_BYTES = 12 + 16; // IV and tag: anything smaller isn't a file
const ID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ID = /^[0-9A-Za-z]{10}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// The page loads highlight.js and MathJax from these, and nothing else from
// anywhere (shared files go only to this origin). Inline script and style:
// the page is one self-contained file. Web images are opt-in in the page.
const CDNS = 'https://cdnjs.cloudflare.com https://cdn.jsdelivr.net';
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${CDNS}`,
  "style-src 'self' 'unsafe-inline'",
  'img-src * data: blob:',
  `font-src 'self' data: ${CDNS}`,
  `connect-src 'self' ${CDNS}`,
  "worker-src 'self' blob:", // MathJax starts a worker from a blob
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (env.REDIRECT_HOSTS && env.REDIRECT_HOSTS.split(',').includes(url.hostname)) {
      return Response.redirect(env.APP_ORIGIN + url.pathname + url.search, 302);
    }
    if (url.pathname === '/api/shares' || url.pathname.startsWith('/api/shares/')) {
      try {
        return await api(request, env, url);
      } catch (err) {
        console.error('share api', err && err.stack ? err.stack : err);
        return error(500, 'Something went wrong on the server. Try again.');
      }
    }
    if (url.pathname.startsWith('/api/')) return error(404, 'No such API.');
    return withHeaders(await env.ASSETS.fetch(request));
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sweep(env, Date.now()));
  },
};

/* ---------- the API ---------- */

async function api(request, env, url) {
  const rest = url.pathname.slice('/api/shares'.length);
  if (rest === '' || rest === '/') {
    if (request.method !== 'POST') return error(405, 'Use POST.', { Allow: 'POST' });
    return create(request, env, url);
  }
  const id = rest.slice(1);
  if (!ID.test(id)) return error(404, 'No such shared file.');
  if (request.method === 'GET' || request.method === 'HEAD') return read(request, env, id);
  if (request.method === 'DELETE') return remove(request, env, id);
  return error(405, 'Use GET or DELETE.', { Allow: 'GET, HEAD, DELETE' });
}

async function create(request, env, url) {
  if (!(await allowed(env.CREATE_LIMIT, request))) return error(429, 'Too many links just now. Try again in a minute.');
  const days = Number(url.searchParams.get('days'));
  if (!DAYS.has(days)) return error(400, 'days must be 1, 7 or 30.');
  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_BYTES) return tooBig();
  let bytes;
  try {
    bytes = await readCapped(request.body, MAX_BYTES);
  } catch (err) {
    if (err instanceof RangeError) return tooBig();
    throw err;
  }
  if (bytes.length < MIN_BYTES) return error(400, 'That is not a shared file.');

  let id = randomId();
  for (let tries = 0; await env.SHARES.head(id); tries++) {
    if (tries === 3) throw new Error('no free id after 4 tries');
    id = randomId();
  }
  const token = randomToken();
  const expires = new Date(Date.now() + days * DAY_MS).toISOString();
  await env.SHARES.put(id, bytes, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { expires, token: await sha256(token), v: '1' },
  });
  return json(201, { id, token, expires });
}

async function read(request, env, id) {
  if (!(await allowed(env.READ_LIMIT, request))) return error(429, 'Too many requests just now. Try again in a minute.');
  const obj = request.method === 'HEAD' ? await env.SHARES.head(id) : await env.SHARES.get(id);
  if (!obj) return error(404, 'This link has expired or was removed.');
  const expires = obj.customMetadata && obj.customMetadata.expires;
  if (expired(expires, Date.now())) return error(410, 'This link has expired.');
  return new Response(request.method === 'HEAD' ? null : obj.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(obj.size),
      'Cache-Control': 'no-store',
      'Mdw-Expires': expires,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function remove(request, env, id) {
  const auth = /^Bearer ([A-Za-z0-9_-]{22})$/.exec(request.headers.get('authorization') || '');
  if (!auth) return error(401, 'Only the browser that made this link can remove it.');
  const obj = await env.SHARES.head(id);
  if (!obj) return new Response(null, { status: 204 }); // already gone: the outcome asked for
  // Compares hashes, so timing says nothing useful about the token itself.
  if (!obj.customMetadata || (await sha256(auth[1])) !== obj.customMetadata.token) {
    return error(403, 'Only the browser that made this link can remove it.');
  }
  await env.SHARES.delete(id);
  return new Response(null, { status: 204 });
}

// Deletes every expired share. Runs from the daily cron.
export async function sweep(env, now) {
  let cursor;
  let removed = 0;
  do {
    const page = await env.SHARES.list({ cursor, limit: 1000, include: ['customMetadata'] });
    const old = page.objects.filter((o) => expired(o.customMetadata && o.customMetadata.expires, now)).map((o) => o.key);
    if (old.length) await env.SHARES.delete(old);
    removed += old.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return removed;
}

/* ---------- helpers ---------- */

// Missing or unreadable expiry counts as expired: nothing is kept by accident.
function expired(expires, now) {
  const t = Date.parse(expires || '');
  return !(t > now);
}

async function allowed(limiter, request) {
  if (!limiter) return true; // local runs without the binding
  const key = request.headers.get('cf-connecting-ip') || 'unknown';
  const { success } = await limiter.limit({ key });
  return success;
}

async function readCapped(body, limit) {
  if (!body) return new Uint8Array(0);
  const chunks = [];
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      reader.cancel().catch(() => {});
      throw new RangeError('too big');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function randomId() {
  // 62 * 4 = 248: bytes below that map evenly onto the 62 characters
  let id = '';
  while (id.length < 10) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && id.length < 10) id += ID_CHARS[b % 62];
    }
  }
  return id;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

const error = (status, message, headers) => json(status, { error: message }, headers);
const tooBig = () => error(413, 'Shared files can be up to 1 MB compressed.');

// Security headers on the page. Other files pass through as they are.
function withHeaders(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('text/html')) return response;
  const out = new Response(response.body, response);
  out.headers.set('Content-Security-Policy', CSP);
  out.headers.set('Referrer-Policy', 'no-referrer');
  out.headers.set('X-Content-Type-Options', 'nosniff');
  return out;
}
