
const CACHE_NAME = "roots-rations-v1";

const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest"
];

// Install: cache the app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_FILES);
    })
  );

  self.skipWaiting();
});

// Activate: remove old app caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );

  self.clients.claim();
});

// Fetch: network first for app pages and API requests
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Do not cache API requests or non-GET requests
  if (
    request.method !== "GET" ||
    url.pathname.includes("/chat") ||
    url.pathname.includes("/auth/")
  ) {
    return;
  }

  // App navigation: network first, then cached app shell
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        return (
          await caches.match("./index.html")
        ) || Response.error();
      })
    );
    return;
  }

  // Other static assets: cache first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const copy = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, copy);
          });
        }

        return response;
      });
    })
  );
});
