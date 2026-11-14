// Service worker for the hosted web reader (https://pywkt.github.io/md-whatever/),
// so it opens and works offline. web/build.py fills in VERSION (a hash of the
// files below) and PRECACHE; a new build means a new sw.js, which the browser
// installs in the background. It takes over only once every md-whatever window
// has closed (or the page asks, after the reader clicks "Reload now"), so a
// page never changes under someone reading it.
'use strict';

const VERSION = '@@VERSION@@';
const PRECACHE = @@PRECACHE@@;
const SITE_CACHE = 'mdw-site-' + VERSION;
// highlight.js and MathJax, fetched the first time a document needs them. The
// URLs carry exact versions, so a cached copy never goes stale; kept across
// site versions.
const CDN_CACHE = 'mdw-cdn-1';
const CDN_PREFIXES = [
  'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/',
  'https://cdn.jsdelivr.net/npm/mathjax@4.1.3/',
  'https://cdn.jsdelivr.net/npm/@mathjax/',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SITE_CACHE).then((cache) =>
    // cache: 'reload' skips the HTTP cache, so this version's files are what gets stored
    cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('mdw-site-') && name !== SITE_CACHE) await caches.delete(name);
    }
    // The first install takes the open page at once, so the libraries it loads
    // from now on are cached too. An update never gets here while a page is open.
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function fromCdn(request) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // opaque: MathJax loads its font files with plain <script> tags (no CORS)
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = request.url;
  if (CDN_PREFIXES.some((p) => url.startsWith(p))) {
    event.respondWith(fromCdn(request));
  } else if (new URL(url).origin === self.location.origin) {
    // Every page address (?query, index.html) is the one page.
    const page = request.mode === 'navigate' ? new URL('./', self.registration.scope).href : null;
    event.respondWith(caches.open(SITE_CACHE)
      .then((cache) => cache.match(page || request, { ignoreSearch: true }))
      .then((hit) => hit || fetch(request)));
  }
});
