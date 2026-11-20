// The last service worker at pywkt.github.io/md-whatever/, replacing the
// reader's. Copies installed from the old address fetch it the next time they
// open (browsers check sw.js on every start). It takes over at once, deletes
// the old offline copy, sends open windows to md.wtvr.sh and unregisters
// itself, so nothing keeps serving the old version.
'use strict';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim(); // a window must be controlled to be navigated
    for (const name of await caches.keys()) await caches.delete(name);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(windows.map((w) => w.navigate('https://md.wtvr.sh/?moved=1').catch(() => {})));
    await self.registration.unregister();
  })());
});
