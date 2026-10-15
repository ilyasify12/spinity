/* Spinity player service worker.
 *
 * Scope is /player/ only, so /api/* (streams, artwork, library) is never
 * intercepted. The shell is cached so the app opens instantly and still
 * shows its UI when the PC server is briefly unreachable.
 *
 * Note: browsers only allow service workers on secure origins. Over LAN
 * http:// this file is served but registration is skipped by the page —
 * everything still works, it just isn't installable as a WebAPK until the
 * page is opened through https:// (tunnel) or localhost.
 */
const CACHE = 'spinity-player-v1'
const SHELL = [
  '/player/',
  '/player/manifest.webmanifest',
  '/player/icons/icon-192.png',
  '/player/icons/icon-512.png',
  '/player/icons/apple-touch-icon.png'
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {})
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return // never cache music/artwork/API

  // Navigations: network-first (fresh player when the PC is up), cache fallback.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/player/', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/player/'))
    )
    return
  }

  // Static assets: cache-first, refresh in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {})
          return res
        })
        .catch(() => hit)
      return hit || refresh
    })
  )
})
