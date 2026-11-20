// Stand-ins for the Worker's Cloudflare bindings, enough for share/worker.js:
// an R2 bucket in memory, a rate limiter that counts, and static files from a
// folder with the single-page-application fallback. Used by worker.test.mjs
// and by tests/web/share.cjs (which serves the real Worker to Chromium).
import fs from 'node:fs';
import path from 'node:path';

export class FakeR2 {
  constructor() { this.objects = new Map(); }
  meta(key, o) {
    return { key, size: o.bytes.length, customMetadata: { ...o.customMetadata }, httpMetadata: { ...o.httpMetadata } };
  }
  async head(key) {
    const o = this.objects.get(key);
    return o ? this.meta(key, o) : null;
  }
  async get(key) {
    const o = this.objects.get(key);
    return o ? { ...this.meta(key, o), body: new Blob([o.bytes]).stream() } : null;
  }
  async put(key, value, opts = {}) {
    const bytes = value instanceof Uint8Array ? value.slice() : new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, { bytes, customMetadata: opts.customMetadata || {}, httpMetadata: opts.httpMetadata || {} });
  }
  async delete(keys) {
    for (const k of [].concat(keys)) this.objects.delete(k);
  }
  async list({ cursor, limit = 1000, include = [] } = {}) {
    // like R2's, the cursor continues after the last key listed, so deleting
    // what's been listed doesn't skip anything
    const keys = [...this.objects.keys()].sort().filter((k) => !cursor || k > cursor);
    const page = keys.slice(0, limit);
    const objects = page.map((k) => {
      const m = this.meta(k, this.objects.get(k));
      if (!include.includes('customMetadata')) delete m.customMetadata;
      return m;
    });
    const truncated = keys.length > limit;
    return { objects, truncated, cursor: truncated ? page[page.length - 1] : undefined };
  }
}

export class FakeLimiter {
  constructor(limit) {
    this.max = limit;
    this.counts = new Map();
  }
  async limit({ key }) {
    const n = (this.counts.get(key) || 0) + 1;
    this.counts.set(key, n);
    return { success: n <= this.max };
  }
  reset() { this.counts.clear(); }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml' };

// env.ASSETS for a folder: files as they are, index.html for / and for any
// path that isn't a file (not_found_handling: single-page-application).
export function fakeAssets(dir) {
  return {
    async fetch(request) {
      let rel = decodeURIComponent(new URL(request.url).pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      let file = path.join(dir, path.normalize(rel));
      if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        file = path.join(dir, 'index.html');
      }
      return new Response(fs.readFileSync(file), {
        headers: { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' },
      });
    },
  };
}

export function fakeEnv(siteDir, { create = 10, read = 120 } = {}) {
  return {
    APP_ORIGIN: 'https://md.wtvr.sh',
    REDIRECT_HOSTS: 'wtvr.sh',
    SHARES: new FakeR2(),
    CREATE_LIMIT: new FakeLimiter(create),
    READ_LIMIT: new FakeLimiter(read),
    ASSETS: siteDir ? fakeAssets(siteDir) : { fetch: async () => new Response('<!doctype html>page', { headers: { 'Content-Type': 'text/html' } }) },
  };
}
