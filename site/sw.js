// Service worker della PWA PATTERN-MACHINE.
// - pagine: rete prima (cosi' online arriva sempre l'ultima versione), cache se offline
// - script e fogli di stile (engine/*.js, learn/*.js, learn/*.css): rete prima, cache se offline, cosi' pagina e
//   motore restano allineati
// - campioni, icone, immagini: cache prima (non cambiano)
// - /api/: sempre rete
// Ad ogni rilascio aumentare VERSION e il ?v= della registrazione in index.html:
// Cloudflare tiene in cache i .js, l'URL nuovo lo scavalca.
// Il worker nuovo si attiva subito (skipWaiting): la pagina aperta e' gia' quella
// presa dalla rete, quindi non serve ricaricarla e non si perde lavoro non salvato.
const VERSION = "2026-10-04.10";
const SHELL_CACHE = `sp1200-shell-${VERSION}`;
const SAMPLE_CACHE = "sp1200-samples-v1"; // non versionata: i campioni non si riscaricano ad ogni rilascio

const SHELL = [
  "/",
  "/embed.html",
  "/manifest.json",
  "/privacy.html",
  "/funzioni.html",
  "/synth.html",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
  "/engine/machine-art.js",
  "/engine/core.js",
  "/engine/styles-punk.js",
  "/engine/styles-post.js",
  "/engine/styles-machines.js",
  "/engine/styles-alt.js",
  "/engine/styles-groove.js",
  "/engine/styles-dub.js",
  "/engine/styles-break.js",
  "/engine/styles-soul.js",
  "/engine/styles-metal.js",
  "/engine/styles-electro.js",
  "/engine/variations.js",
  "/engine/import.js",
  "/engine/rhythm.js",
  "/engine/share.js",
  "/engine/sample-editor.js",
  "/engine/sampler.js",
  "/engine/vocal.js",
  "/engine/midi.js",
  "/engine/lame.min.js",
  // corso: indice, lezioni pronte, mini drum machine e scheda della missione
  "/learn/index.html",
  "/learn/backbeat.html",
  "/learn/basics.html",
  "/learn/level23.html",
  "/learn/advanced.html",
  "/learn/four-on-the-floor.html",
  "/learn/styles.html",
  "/learn/sampler.html",
  "/learn/resample-chop.html",
  "/learn/synth-drums.html",
  "/learn/mix.html",
  "/learn/record-vocal.html",
  "/learn/export.html",
  "/learn/learn.css",
  "/learn/lang.js",
  "/learn/it.js",
  "/learn/lessons.js",
  "/learn/basics.js",
  "/learn/level23.js",
  "/learn/advanced.js",
  "/learn/styles.js",
  "/learn/mini.js",
  "/learn/coach.js",
];

const SAMPLE_NAMES = [
  "Agogo 1", "Cabasa 1", "Cabasa 2", "China", "Clave 1", "Clave 2", "Closed Hat 1", "Closed Hat 2",
  "Conga 1", "Conga 2", "Conga 3", "Conga 4", "Cowbell 1", "Cowbell 2", "Cowbell 3", "Cowbell 4",
  "Crash 1", "Cymbal", "Finger Snap", "Guiro 1", "Guiro 2", "Kick 1", "Kick 2", "Open Hat 1",
  "Perc 1", "Perc 2", "Perc 3", "Perc 4", "Perc 5", "Perc 6", "Ride 1", "Rimshot",
  "Snare 1", "Snare 2", "Snare 3", "Tambourine", "Timbale 1", "Timbale 2", "Tom 1", "Tom 2",
  "Triangle", "Vibraslap",
];
// Yamaha RX-5: file nominati come i suoni originali (vedi RX5_SLOTS ed RX5_EXTRA in index.html).
const RX5_FILES = [
  "AgoHI-RX5", "AgoLO-RX5", "BDrum1-RX5", "BDrum2-RX5", "BDrum3-RX5", "BgoHI-RX5", "BgoLO-RX5", "CGaHMT-RX5", "CGaHOP-RX5", "CGaLO-RX5", "CHat-RX5", "China-RX5", "Clap-RX5", "Cowbell-RX5", "Crash-RX5", "Cstnt-RX5", "Cuica-RX5", "DXmrmb-RX5", "DXorch-RX5", "EBassL-RX5", "ETom1-RX5", "ETom2-RX5", "ETom3-RX5", "ETom4-RX5", "EbassH-RX5", "FMPrc2-RX5", "FMprc1-RX5", "FMprc3-RX5", "GlsCsh-RX5", "Gun-RX5", "Hey-RX5", "OHat-RX5", "Ooo-RX5", "RideBell-RX5", "RideEdge-RX5", "Rim1-RX5", "Rim2-RX5", "SDrum1-RX5", "SDrum2-RX5", "SDrum3-RX5", "Shaker-RX5", "Tamb-RX5", "TimblH-RX5", "TimblL-RX5", "Timpn-RX5", "Tom1-RX5", "Tom2-RX5", "Tom3-RX5", "Tom4-RX5", "Wao-RX5", "Whstl-RX5",
];
const SAMPLE_URLS = [
  ...["samples", "samples12"].flatMap(dir => SAMPLE_NAMES.map(n => encodeURI(`/${dir}/${n} SP-1200.wav`))),
  ...RX5_FILES.map(f => encodeURI(`/machines/rx5/${f}.wav`)),
];

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
  // L'app per macOS (~100 MB) e la sua scheda vanno scaricate dalla rete, mai copiate nella cache.
  if (url.pathname.startsWith("/download/")) return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }
  if (/\.(js|css)$/.test(url.pathname)) {
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
