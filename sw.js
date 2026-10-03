// Album Tracker service worker.
// Network-first: always tries to load the newest files, and only falls back
// to the cached copy when you're offline. So updating the app files takes
// effect on the next reload, with no stale cached versions.
// Your library lives in the browser's localStorage, not in this cache, so
// clearing this cache never touches your albums.
const CACHE = "album-tracker-v4";
const APP_FILES = [
  "./",
  "index.html",
  "styles.css",
  "app.js?v=4",
  "influence-data.js",
  "explore.html",
  "manifest.json",
  "icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_FILES))
      .catch(() => {}) // a missing optional file shouldn't block installing
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle this app's own files. Album searches (iTunes, MusicBrainz,
  // cover art, Last.fm) always go straight to the network.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("index.html")))
  );
});
