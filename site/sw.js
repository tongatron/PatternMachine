// Service worker della PWA SP-1200.
// - pagine: rete prima (cosi' online arriva sempre l'ultima versione), cache se offline
// - script del motore (engine/*.js): rete prima, cache se offline, cosi' pagina e motore restano allineati
// - campioni, icone, immagini: cache prima (non cambiano)
// - /api/: sempre rete
// Ad ogni rilascio aumentare VERSION e il ?v= della registrazione in index.html:
// Cloudflare tiene in cache i .js, l'URL nuovo lo scavalca.
// Il worker nuovo si attiva subito (skipWaiting): la pagina aperta e' gia' quella
// presa dalla rete, quindi non serve ricaricarla e non si perde lavoro non salvato.
const VERSION = "2026-09-24.4";
const SHELL_CACHE = `sp1200-shell-${VERSION}`;
const SAMPLE_CACHE = "sp1200-samples-v1"; // non versionata: i campioni non si riscaricano ad ogni rilascio

const SHELL = [
  "/",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
  "/engine/core.js",
  "/engine/styles-punk.js",
  "/engine/styles-post.js",
  "/engine/styles-machines.js",
  "/engine/styles-alt.js",
  "/engine/styles-groove.js",
  "/engine/styles-dub.js",
  "/engine/variations.js",
];

const SAMPLE_NAMES = [
  "Agogo 1", "Cabasa 1", "Cabasa 2", "China", "Clave 1", "Clave 2", "Closed Hat 1", "Closed Hat 2",
  "Conga 1", "Conga 2", "Conga 3", "Conga 4", "Cowbell 1", "Cowbell 2", "Cowbell 3", "Cowbell 4",
  "Crash 1", "Cymbal", "Finger Snap", "Guiro 1", "Guiro 2", "Kick 1", "Kick 2", "Open Hat 1",
  "Perc 1", "Perc 2", "Perc 3", "Perc 4", "Perc 5", "Perc 6", "Ride 1", "Rimshot",
  "Snare 1", "Snare 2", "Snare 3", "Tambourine", "Timbale 1", "Timbale 2", "Tom 1", "Tom 2",
  "Triangle", "Vibraslap",
];
const SAMPLE_URLS = [["samples", "SP-1200"], ["samples12", "SP-1200"], ["samples-rx5", "RX-5"]].flatMap(([dir, suffix]) =>
  SAMPLE_NAMES.map(n => encodeURI(`/${dir}/${n} ${suffix}.wav`)));

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);
    // I campioni sono tolleranti: uno che manca non deve bloccare l'installazione.
    const samples = await caches.open(SAMPLE_CACHE);
    await Promise.allSettled(SAMPLE_URLS.map(async url => {
      if (await samples.match(url)) return;
      const res = await fetch(url);
      if (res.ok) await samples.put(url, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k.startsWith("sp1200-shell-") && k !== SHELL_CACHE)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API e accesso vanno sempre in rete: la pagina di login non deve mai finire in cache.
  if (url.pathname.startsWith("/api/") || url.pathname === "/login" || url.pathname === "/logout") return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }
  if (url.pathname.endsWith(".js")) {
    event.respondWith(networkFirstAsset(req));
    return;
  }
  if (/\.(wav|png|jpe?g|webp|svg|ico)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req, url.pathname.endsWith(".wav") ? SAMPLE_CACHE : SHELL_CACHE));
    return;
  }
  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (cacheable(res)) cache.put(stripSearch(req.url), res.clone());
    return res;
  } catch (err) {
    return (await cache.match(stripSearch(req.url)))
      || (await cache.match("/"))
      || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

async function networkFirstAsset(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (cacheable(res)) cache.put(stripSearch(req.url), res.clone());
    return res;
  } catch (err) {
    return (await cache.match(stripSearch(req.url))) || Response.error();
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req);
  const fresh = fetch(req).then(res => {
    if (cacheable(res)) cache.put(req, res.clone());
    return res;
  }).catch(() => hit || Response.error());
  return hit || fresh;
}

// Solo risposte vere del sito: niente redirect verso il login (sessione scaduta) ne' errori.
function cacheable(res) {
  return res.ok && res.type === "basic" && !res.redirected;
}

function stripSearch(href) {
  const u = new URL(href);
  u.search = "";
  u.hash = "";
  return u.href;
}
