// PatternMachine per macOS: il sito di ../site dentro una finestra, piu' quello che il browser non puo' fare.
// - app://pm/ serve i file del sito dal disco (niente server, niente password) e aggiunge a index.html
//   bridge/bridge.js e bridge/bridge.css, che agganciano le funzioni native senza toccare il sito.
// - porta MIDI virtuale "PatternMachine": uscita (note verso Logic) e ingresso (MIDI Clock da Logic).
// - progetti ed esportazioni come file veri in ~/Music/PatternMachine; i progetti si sincronizzano con
//   l'account del sito (stessi progetti nel browser e negli altri Mac).
// - trascinamento di MIDI/WAV dall'app alla timeline di Logic.
const { app, BrowserWindow, protocol, net, ipcMain, shell, Menu, nativeImage, dialog, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { execFileSync } = require("child_process");
const { randomUUID, createHash } = require("crypto");
const { pathToFileURL } = require("url");

if (process.env.PM_USERDATA) app.setPath("userData", process.env.PM_USERDATA);   // PM_USERDATA: per le prove
const SITE_DIR = app.isPackaged ? path.join(process.resourcesPath, "site") : path.join(__dirname, "..", "site");
const BRIDGE_DIR = path.join(__dirname, "bridge");
const HOME_DIR = process.env.PM_HOME || path.join(app.getPath("music"), "PatternMachine");   // PM_HOME: per le prove
const PROJECTS_DIR = path.join(HOME_DIR, "Projects");
// Fino alla 0.2 la cartella si chiamava "Progetti": al primo avvio si rinomina (con i file e il legame all'account).
function migrateProjectsDir() {
  const old = path.join(HOME_DIR, "Progetti");
  try { if (fs.existsSync(old) && !fs.existsSync(PROJECTS_DIR)) fs.renameSync(old, PROJECTS_DIR); } catch (e) {}
}
const EXPORT_DIR = path.join(HOME_DIR, "Export");
const DRAG_DIR = path.join(app.getPath("temp"), "PatternMachine-drag");
const KITS_DIR = path.join(app.getPath("userData"), "drum-machines");
const SAMPLES_DIR = path.join(app.getPath("userData"), "samples");
const SAMPLES_META = path.join(SAMPLES_DIR, "samples.json");
const SAMPLE_MAX_BYTES = 20 * 1024 * 1024;
const PORT_NAME = "PatternMachine";
const APP_MESSAGE_URL = "https://patternmachine.tongatron.org/api/app-message";
const APP_MESSAGE_STATE = path.join(app.getPath("userData"), "app-message-state.json");
const SERVER = process.env.PM_SERVER || "https://patternmachine.tongatron.org";   // PM_SERVER: per le prove
const ACCOUNT_FILE = path.join(app.getPath("userData"), "account.json");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win = null;

// ---------- file del sito ----------
// Dentro la cartella del sito e basta; /__desktop/ porta ai file del ponte.
function resolveAppPath(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "") || "index.html";
  const [root, sub] = rel.startsWith("__desktop/") ? [BRIDGE_DIR, rel.slice("__desktop/".length)]
    : rel.startsWith("__kits/") ? [KITS_DIR, rel.slice("__kits/".length)] : [SITE_DIR, rel];
  const full = path.normalize(path.join(root, sub));
  return full.startsWith(root + path.sep) ? full : null;
}

function registerAppProtocol() {
  protocol.handle("app", async (req) => {
    const { pathname } = new URL(req.url);
    const file = resolveAppPath(pathname);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response("not found", { status: 404 });
    if (file === path.join(SITE_DIR, "index.html")) {
      // niente statistiche Umami nell'app (lo script conta solo sul dominio del sito, ma non serve caricarlo)
      const html = fs.readFileSync(file, "utf8").replace(/<script[^>]*analytics\.tongatron\.org[^>]*><\/script>\n?/g, "").replace("</body>",
        '<link rel="stylesheet" href="/__desktop/bridge.css">\n<script src="/__desktop/bridge.js"></script>\n</body>');
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ---------- MIDI ----------
let midiOut = null, midiIn = null, midiError = null;
const pendingNotes = new Set();

function openMidi() {
  try {
    const midi = require("@julusian/midi");
    midiOut = new midi.Output();
    midiOut.openVirtualPort(PORT_NAME);
    midiIn = new midi.Input();
    midiIn.ignoreTypes(true, false, true); // sysex e active sensing no, il clock si'
    midiIn.on("message", (_delta, msg) => {
      // solo tempo reale e Song Position: le note in ingresso non servono
      const s = msg[0];
      if (s === 0xF8 || s === 0xFA || s === 0xFB || s === 0xFC || s === 0xF2) win?.webContents.send("midi:in", msg);
    });
    midiIn.openVirtualPort(PORT_NAME);
  } catch (e) {
    midiError = String((e && e.message) || e);
    midiOut = midiIn = null;
  }
}

function sendMidi(bytes) { try { midiOut && midiOut.sendMessage(bytes); } catch (e) {} }

// Il renderer programma le note in anticipo (come l'audio, ~120 ms): qui si aspettano col timer.
ipcMain.on("midi:notes", (_e, notes) => {
  for (const n of notes) {
    const on = setTimeout(() => { pendingNotes.delete(on); sendMidi([0x90 | n.ch, n.note, n.vel]); }, Math.max(0, n.delay));
    const off = setTimeout(() => { pendingNotes.delete(off); sendMidi([0x80 | n.ch, n.note, 0]); }, Math.max(0, n.delay + n.dur));
    pendingNotes.add(on); pendingNotes.add(off);
  }
});
ipcMain.on("midi:panic", () => {
  pendingNotes.forEach(clearTimeout); pendingNotes.clear();
  for (let ch = 0; ch < 16; ch++) sendMidi([0xB0 | ch, 123, 0]);
});
ipcMain.handle("midi:status", () => ({ ok: !!midiOut, name: PORT_NAME, error: midiError }));

// ---------- progetti su file ----------
const projectFile = id => {
  if (!/^[A-Za-z0-9_-]+$/.test(String(id))) throw new Error("invalid id");
  return path.join(PROJECTS_DIR, id + ".json");
};
ipcMain.handle("projects:list", () => {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  return fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith(".json") && !f.startsWith(".")).map(f => {
    try { return { id: f.slice(0, -5), data: JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), "utf8")) }; }
    catch (e) { return null; }
  }).filter(Boolean);
});
ipcMain.handle("projects:get", (_e, id) => {
  const f = projectFile(id);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
});
function writeProject(id, data) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const f = projectFile(id), tmp = f + ".tmp", text = JSON.stringify(data, null, 1);
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, f);
  return text;
}
ipcMain.handle("projects:set", (_e, id, data) => {
  writeProject(id, data);
  syncSoon();
  return true;
});
// nel Cestino, non cancellato: un progetto rimosso per sbaglio si recupera
ipcMain.handle("projects:delete", async (_e, id) => {
  const f = projectFile(id);
  if (fs.existsSync(f)) await shell.trashItem(f);
  syncSoon();
  return true;
});

// ---------- campioni locali ----------
// Il renderer usa la stessa scheda del sito; qui il blob finisce in un file vero, cosi' puo'
// essere trasferito al server senza passare da IndexedDB o dal JSON dei progetti.
const safeSampleId = id => /^s-[A-Za-z0-9_-]{1,64}$/.test(String(id));
const sampleFile = id => { if (!safeSampleId(id)) throw new Error("invalid sample id"); return path.join(SAMPLES_DIR, id + ".blob"); };
function readLocalSamples() { return readJson(SAMPLES_META, {}); }
function saveLocalSamples(data) { writeJson(SAMPLES_META, data); }
function sampleMetaList() {
  return Object.values(readLocalSamples()).filter(x => x && !x.deleted).map(({ id, ...meta }) => ({ id, ...meta }));
}
function writeLocalSample(id, meta, data) {
  if (!safeSampleId(id)) throw new Error("invalid sample id");
  const bytes = Buffer.from(data);
  if (!bytes.length || bytes.length > SAMPLE_MAX_BYTES) throw new Error("sample exceeds 20 MB");
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  const f = sampleFile(id), tmp = f + ".tmp";
  fs.writeFileSync(tmp, bytes, { mode: 0o600 });
  fs.renameSync(tmp, f);
  const all = readLocalSamples();
  all[id] = { id, ...meta, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), deleted: false };
  saveLocalSamples(all);
  return all[id];
}
ipcMain.handle("samples:list", () => sampleMetaList());
ipcMain.handle("samples:get", (_e, id) => {
  const meta = readLocalSamples()[id];
  if (!meta || meta.deleted || !fs.existsSync(sampleFile(id))) throw new Error("sample not found");
  return { meta: { ...meta }, data: fs.readFileSync(sampleFile(id)) };
});
ipcMain.handle("samples:set", (_e, id, meta, data) => {
  const out = writeLocalSample(id, { ...meta, updatedAt: Date.now() }, data);
  syncSoon();
  return out;
});
ipcMain.handle("samples:delete", (_e, id) => {
  if (!safeSampleId(id)) throw new Error("invalid sample id");
  const all = readLocalSamples(), current = all[id];
  if (!current) return true;
  try { fs.rmSync(sampleFile(id), { force: true }); } catch (e) {}
  all[id] = { id, name: current.name || "Sample", updatedAt: Date.now(), deleted: true };
  saveLocalSamples(all); syncSoon(); return true;
});

// ---------- account e sincronizzazione dei progetti ----------
// Si entra con nome e password del sito: la password va solo al server, si tiene il cookie di sessione
// cifrato col portachiavi di macOS (safeStorage). La cartella Projects resta la copia di lavoro: si
// confronta coi progetti dell'account (/api/projects) guardando i file, quindi valgono anche i file
// aggiunti, cambiati o tolti dal Finder. Per ogni progetto sync-<utente>.json ricorda la rev del server
// e l'impronta del file all'ultima sincronizzazione:
// - file cambiato qui -> si manda, con la rev da cui era partito; se nel frattempo e' cambiato altrove il
//   server lo tiene come copia ("Nome (copy)") e qui arriva anche l'altra versione: non si perde niente;
// - file tolto qui -> si cancella anche nell'account (se non e' cambiato altrove nel frattempo);
// - cambiato o cancellato altrove -> si aggiorna il file (quelli tolti vanno nel Cestino).
// La cartella si lega al primo account che la sincronizza: un altro account non la mescola.
let account = null;              // {name, uid, cookie}
let syncState = { state: "signed-out" };
const LINK_FILE = () => path.join(PROJECTS_DIR, ".account.json");
const syncFile = uid => path.join(app.getPath("userData"), `sync-${uid}.json`);
const sha = text => createHash("sha256").update(text).digest("hex");
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return fallback; } };
function writeJson(f, data) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + ".tmp", JSON.stringify(data));
  fs.renameSync(f + ".tmp", f);
}

function saveAccount() {
  if (!account) { fs.rmSync(ACCOUNT_FILE, { force: true }); return; }
  // senza portachiavi la sessione resta solo in memoria: al prossimo avvio si rientra
  if (!safeStorage.isEncryptionAvailable()) return;
  writeJson(ACCOUNT_FILE, { name: account.name, uid: account.uid, cookie: safeStorage.encryptString(account.cookie).toString("base64") });
}
function loadAccount() {
  const a = readJson(ACCOUNT_FILE, null);
  if (!a || !a.cookie || !safeStorage.isEncryptionAvailable()) return null;
  try { return { name: a.name, uid: a.uid, cookie: safeStorage.decryptString(Buffer.from(a.cookie, "base64")) }; }
  catch (e) { return null; }
}
function setSyncState(next) {
  syncState = { ...next, name: account?.name || "", server: SERVER };
  win?.webContents.send("sync:state", syncState);
}

class SessionExpired extends Error {}
async function api(pathname, { method = "GET", body, raw, headers = {} } = {}) {
  const res = await fetch(SERVER + pathname, {
    method, redirect: "manual",
    headers: { Cookie: account.cookie, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401 || res.status === 303) throw new SessionExpired();
  return res;
}
async function apiJson(pathname, opts) {
  const res = await api(pathname, opts);
  if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status}`);
  return res.json();
}

async function login(name, password) {
  const res = await fetch(SERVER + "/login", {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ name, password, next: "/" }).toString(),
    signal: AbortSignal.timeout(20000),
  });
  const cookie = (res.headers.getSetCookie?.() || [res.headers.get("set-cookie") || ""])
    .map(c => c.split(";")[0]).find(c => c.startsWith("sp1200_session=") && c.length > 16);
  if (res.status === 429) return { error: "Too many attempts: try again in a few minutes." };
  if (res.status !== 303 || !cookie) return { error: "Wrong name, email or password." };
  account = { name, uid: "", cookie };
  const me = await apiJson("/api/me");
  if (me.role === "guest" || !me.id) { account = null; return { error: "Guests have no saved projects: sign in with a registered account." }; }
  account = { name: me.name, uid: me.id, cookie };
  saveAccount();
  syncNow();
  return { ok: true, name: me.name };
}
function logout() {
  account = null; saveAccount();
  setSyncState({ state: "signed-out" });
}

function readLocalProjects() {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const out = {};
  for (const f of fs.readdirSync(PROJECTS_DIR)) {
    const m = /^([A-Za-z0-9_-]{1,64})\.json$/.exec(f);
    if (!m) continue;
    try { const text = fs.readFileSync(path.join(PROJECTS_DIR, f), "utf8"); out[m[1]] = { text, hash: sha(text) }; } catch (e) {}
  }
  return out;
}
// Riscrive un file solo se nel frattempo non e' cambiato (la pagina potrebbe averlo appena salvato).
function replaceIfUnchanged(id, expectedHash, data) {
  const f = projectFile(id);
  let now = null;
  try { now = sha(fs.readFileSync(f, "utf8")); } catch (e) {}
  if (now !== expectedHash) return null;
  return sha(writeProject(id, data));
}

function sampleTime(meta) {
  const local = Number(meta?.updatedAt);
  if (Number.isFinite(local) && local > 0) return local;
  const remote = Date.parse(meta?.updated_at || "");
  return Number.isFinite(remote) ? remote : 0;
}
async function uploadLocalSample(id, local) {
  const data = fs.readFileSync(sampleFile(id));
  const params = new URLSearchParams({
    name: local.name || "Sample",
    duration: String(local.duration || 0),
    mime: local.mime || "application/octet-stream",
    settings: JSON.stringify(local.settings || {}),
  });
  const res = await api(`/api/samples/${encodeURIComponent(id)}?${params}`, {
    method: "PUT", raw: data, headers: { "Content-Type": local.mime || "application/octet-stream" },
  });
  if (!res.ok) throw new Error(`samples upload: HTTP ${res.status}`);
  const remote = await res.json();
  const all = readLocalSamples();
  if (all[id] && !all[id].deleted) {
    all[id] = { ...all[id], sha256: remote.sha256, serverRev: remote.rev, serverUpdatedAt: remote.updated_at };
    saveLocalSamples(all);
  }
}
async function downloadRemoteSample(remote) {
  const res = await api(`/api/samples/${encodeURIComponent(remote.id)}`);
  if (!res.ok) throw new Error(`samples download: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  writeLocalSample(remote.id, {
    name: remote.name || "Sample", duration: Number(remote.duration) || 0, mime: remote.mime || "application/octet-stream",
    settings: remote.settings || {}, updatedAt: Date.parse(remote.updated_at || "") || Date.now(),
    serverRev: remote.rev, serverUpdatedAt: remote.updated_at,
  }, data);
}
async function syncSamples() {
  const listed = await apiJson("/api/samples");
  const remote = Object.fromEntries((listed.samples || []).map(x => [x.id, x]));
  const all = readLocalSamples();
  const ids = new Set([...Object.keys(all), ...Object.keys(remote)]);
  for (const id of ids) {
    if (!safeSampleId(id)) continue;
    const local = all[id], server = remote[id];
    if (local?.deleted) {
      if (server && !server.deleted && sampleTime(local) >= sampleTime(server)) {
        const res = await api(`/api/samples/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) throw new Error(`samples delete: HTTP ${res.status}`);
      } else if (server && server.deleted) {
        delete all[id]; saveLocalSamples(all);
      } else if (!server) {
        delete all[id]; saveLocalSamples(all);
      } else {
        await downloadRemoteSample(server);
      }
    } else if (!local && server && !server.deleted) {
      await downloadRemoteSample(server);
    } else if (!server || server.deleted) {
      await uploadLocalSample(id, local);
    } else if (local.sha256 === server.sha256) {
      if (sampleTime(local) < sampleTime(server)) await downloadRemoteSample(server);
    } else if (sampleTime(local) >= sampleTime(server)) {
      await uploadLocalSample(id, local);
    } else {
      await downloadRemoteSample(server);
    }
  }
}

async function syncOnce() {
  const uid = account.uid, metaFile = syncFile(uid);
  const link = readJson(LINK_FILE(), null);
  if (link && link.uid && link.uid !== uid) {
    setSyncState({ state: "error", message: `This Projects folder is synced with another account (${link.name}). Sign in with that account to sync it.` });
    return;
  }
  const meta = readJson(metaFile, { rev: {}, hash: {} });
  const save = () => writeJson(metaFile, meta);
  const local = readLocalProjects();
  const remote = {};
  for (const p of (await apiJson("/api/projects")).projects || []) remote[p.id] = p;
  if (!link) writeJson(LINK_FILE(), { uid, name: account.name });
  const changes = { updated: [], deleted: [], renamed: [] };
  const download = async (id, expectedHash) => {
    const got = await apiJson("/api/projects/" + id);
    const hash = expectedHash === undefined ? sha(writeProject(id, got.data)) : replaceIfUnchanged(id, expectedHash, got.data);
    if (hash) { meta.rev[id] = got.rev; meta.hash[id] = hash; changes.updated.push(id); }
  };
  const ids = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(meta.rev)]);
  for (const id of ids) {
    const L = local[id], R = remote[id], rev = meta.rev[id];
    const changedHere = L && (!rev || L.hash !== meta.hash[id] || !R);
    const changedThere = R && R.rev !== rev;
    if (!L && rev) {                                   // tolto qui
      if (R && !R.deleted && changedThere) await download(id);            // ma cambiato altrove: vince la modifica
      else {
        if (R && !R.deleted) { const r = await api("/api/projects/" + id, { method: "DELETE" }); if (!r.ok && r.status !== 404) throw new Error("delete " + r.status); }
        delete meta.rev[id]; delete meta.hash[id];
      }
    } else if (changedHere && !(R && R.deleted && rev && L.hash === meta.hash[id])) {
      let data;
      try { data = JSON.parse(L.text); } catch (e) { continue; }          // file rovinato a mano: si lascia stare
      const res = await apiJson("/api/projects/" + id, { method: "PUT", body: { data, base: (R && !R.deleted) ? rev || null : null } });
      if (res.conflict) {
        // questa versione e' diventata una copia nell'account; nel file originale arriva l'altra
        const copyHash = sha(writeProject(res.id, { ...data, name: res.name }));
        meta.rev[res.id] = res.rev; meta.hash[res.id] = copyHash;
        changes.renamed.push({ from: id, to: res.id, name: res.name });
        await download(id, L.hash);
      } else { meta.rev[id] = res.rev; meta.hash[id] = L.hash; }
    } else if (R && R.deleted) {                       // cancellato altrove
      if (L) { await shell.trashItem(projectFile(id)).catch(() => {}); changes.deleted.push(id); }
      delete meta.rev[id]; delete meta.hash[id];
    } else if (R && changedThere) {                    // cambiato (o nuovo) altrove
      await download(id, L ? L.hash : undefined);
    }
    save();
  }
  save();
  if (changes.updated.length || changes.deleted.length || changes.renamed.length) win?.webContents.send("projects:changed", changes);
  await syncSamples();
  setSyncState({ state: "ok", at: Date.now() });
}

let syncing = null, syncAgain = false, syncTimer = null;
function syncNow() {
  clearTimeout(syncTimer);
  if (!account) return Promise.resolve();
  if (syncing) { syncAgain = true; return syncing; }
  setSyncState({ ...syncState, state: "syncing" });
  syncing = (async () => {
    try {
      do { syncAgain = false; await syncOnce(); } while (syncAgain && account);
    } catch (e) {
      if (e instanceof SessionExpired) { account = null; saveAccount(); setSyncState({ state: "expired" }); }
      else {
        const detail = e?.message ? ` (${e.message})` : "";
        setSyncState({ state: "error", message: `Can't reach the server: projects and samples stay local and sync when it's back.${detail}` });
        syncTimer = setTimeout(syncNow, 30000);
      }
    } finally { syncing = null; }
  })();
  return syncing;
}
function syncSoon() { clearTimeout(syncTimer); if (account) syncTimer = setTimeout(syncNow, 1500); }

ipcMain.handle("account:status", () => syncState);
ipcMain.handle("account:login", async (_e, name, password) => {
  try { return await login(String(name || "").trim(), String(password || "")); }
  catch (e) { account = null; return { error: "Can't reach the server: check the connection and try again." }; }
});
ipcMain.handle("account:logout", () => { logout(); return true; });
ipcMain.handle("sync:now", () => syncNow().then(() => syncState));
// Preset del synth: il documento dell'account passa da qui con la sessione dell'app; a unirlo con quelli
// salvati qui pensa la pagina (engine/synth.js). null/false = non collegati o server non raggiungibile.
ipcMain.handle("presets:get", async () => {
  if (!account) return null;
  try { return (await apiJson("/api/synth-presets")).presets || {}; } catch (e) { return null; }
});
ipcMain.handle("presets:put", async (_e, doc) => {
  if (!account || !doc || typeof doc !== "object") return false;
  try { await apiJson("/api/synth-presets", { method: "PUT", body: { presets: doc } }); return true; } catch (e) { return false; }
});
ipcMain.on("account:open", (_e, page) => {
  if (["register", "forgot"].includes(page)) shell.openExternal(`${SERVER}/${page}`);
});

// ---------- drum machine personali ----------
const AUDIO_EXT = /\.(wav|aif|aiff|mp3|ogg|flac|m4a)$/i;
const safeKitId = id => /^custom-[A-Za-z0-9-]+$/.test(String(id));
function listKitAudio(root) {
  const out = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name), st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && AUDIO_EXT.test(name)) out.push({ file: path.relative(root, full).split(path.sep).join("/"), name });
    }
  }
  walk(root);
  return out.sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true, sensitivity: "base" }));
}
function kitPath(id) { if (!safeKitId(id)) throw new Error("invalid kit"); return path.join(KITS_DIR, id); }
function kitMeta(id) { return JSON.parse(fs.readFileSync(path.join(kitPath(id), "kit.json"), "utf8")); }

ipcMain.handle("kits:list", () => {
  fs.mkdirSync(KITS_DIR, { recursive: true });
  return fs.readdirSync(KITS_DIR).filter(safeKitId).map(id => {
    try { return kitMeta(id); } catch (e) { return null; }
  }).filter(Boolean);
});
ipcMain.handle("kits:pick", async () => {
  fs.mkdirSync(KITS_DIR, { recursive: true });
  const result = await dialog.showOpenDialog(win, {
    title: "Import Drum Machine",
    buttonLabel: "Choose samples",
    properties: ["openFile", "openDirectory"],
    filters: [{ name: "Folder or ZIP archive", extensions: ["zip"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const source = result.filePaths[0], stagingId = `.staging-${randomUUID()}`, staging = path.join(KITS_DIR, stagingId);
  fs.mkdirSync(staging, { recursive: true });
  try {
    if (fs.statSync(source).isDirectory()) {
      for (const item of listKitAudio(source)) {
        const dest = path.join(staging, ...item.file.split("/"));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(source, ...item.file.split("/")), dest);
      }
    } else if (/\.zip$/i.test(source)) {
      execFileSync("/usr/bin/ditto", ["-x", "-k", source, staging], { stdio: "pipe" });
    } else throw new Error("choose a folder or a ZIP file");
    const files = listKitAudio(staging);
    if (!files.length) throw new Error("no audio samples found (WAV, AIFF, MP3, OGG, FLAC or M4A)");
    return { stagingId, files };
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(e.message || "import failed");
  }
});
function normalizeKitSlots(id, slots) {
  if (!Array.isArray(slots) || !slots.length || slots.length > 42) throw new Error("a kit must have 1 to 42 samples");
  const root = kitPath(id), seen = new Set();
  return slots.map(s => {
    const file = String(s.file || "").replaceAll("\\", "/");
    if (!file || file.startsWith("/") || file.includes("../") || !AUDIO_EXT.test(file) || seen.has(file)) throw new Error("invalid sample");
    const full = path.normalize(path.join(root, file));
    if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) throw new Error("sample not found");
    seen.add(file);
    return { slot: String(s.slot || "").slice(0, 80), file, label: String(s.label || s.slot || file).trim().slice(0, 80) || file };
  });
}
ipcMain.handle("kits:create", (_e, stagingId, data) => {
  if (!/^\.staging-[A-Za-z0-9-]+$/.test(String(stagingId))) throw new Error("invalid import");
  const staging = path.join(KITS_DIR, stagingId);
  if (!fs.existsSync(staging)) throw new Error("import expired");
  const id = `custom-${Date.now()}-${randomUUID().slice(0, 8)}`, target = kitPath(id);
  fs.renameSync(staging, target);
  try {
    const meta = { id, label: String(data?.label || "Drum Machine").trim().slice(0, 80) || "Drum Machine", source: "your own samples", slots: normalizeKitSlots(id, data?.slots) };
    fs.writeFileSync(path.join(target, "kit.json"), JSON.stringify(meta, null, 2));
    return meta;
  } catch (e) { fs.rmSync(target, { recursive: true, force: true }); throw e; }
});
ipcMain.handle("kits:discard", (_e, stagingId) => {
  if (/^\.staging-[A-Za-z0-9-]+$/.test(String(stagingId))) fs.rmSync(path.join(KITS_DIR, stagingId), { recursive: true, force: true });
  return true;
});
ipcMain.handle("kits:update", (_e, id, data) => {
  const old = kitMeta(id), meta = { ...old, label: String(data?.label || old.label).trim().slice(0, 80) || old.label };
  meta.slots = normalizeKitSlots(id, data?.slots || old.slots);
  fs.writeFileSync(path.join(kitPath(id), "kit.json"), JSON.stringify(meta, null, 2));
  return meta;
});
ipcMain.handle("kits:delete", (_e, id) => {
  fs.rmSync(kitPath(id), { recursive: true, force: true });
  return true;
});

// ---------- esportazioni ----------
const cleanName = s => String(s).replace(/[\/:\0]/g, "-").replace(/^\.+/, "").trim() || "export";
function freeName(dir, name) {
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  let out = name, n = 2;
  while (fs.existsSync(path.join(dir, out))) out = `${base} ${n++}${ext}`;
  return out;
}
// Un file scelto dall'utente con il dialogo nativo "Salva con nome".
ipcMain.handle("export:file", async (_e, filename, bytes) => {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const safe = cleanName(filename);
  const ext = path.extname(safe).slice(1).toLowerCase();
  const result = await dialog.showSaveDialog(win, {
    title: "Export from PatternMachine",
    defaultPath: path.join(EXPORT_DIR, safe),
    filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: "All files", extensions: ["*"] }] : undefined,
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, Buffer.from(bytes));
  return { path: result.filePath };
});
// Un gruppo di file in sottocartelle: il pacchetto per Logic, gia' scompattato.
ipcMain.handle("export:folder", async (_e, files) => {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const result = await dialog.showOpenDialog(win, {
    title: "Choose where to export the package",
    defaultPath: EXPORT_DIR,
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const parent = result.filePaths[0];
  const root = path.join(parent, freeName(parent, cleanName(files[0].name.split("/")[0])));
  for (const { name, data } of files) {
    const f = path.join(root, ...name.split("/").slice(1).map(cleanName));
    if (!f.startsWith(root + path.sep)) continue;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(data));
  }
  return { path: root };
});
ipcMain.on("export:reveal", (_e, p) => {
  if (typeof p === "string" && p.startsWith(HOME_DIR + path.sep)) shell.showItemInFolder(p);
});

ipcMain.on("app-message:remember", (_e, id) => {
  if (typeof id === "string" && id) rememberAppMessage(id);
});
ipcMain.on("app-message:open", (_e, url) => {
  if (typeof url === "string" && /^https:\/\/patternmachine\.tongatron\.org\//.test(url)) shell.openExternal(url);
});

// ---------- trascinamento verso Logic ----------
// Electron vuole un file vero e un'icona: si scrive in una cartella temporanea col nome giusto.
let dragIconImg = null;
const dragIcon = () => dragIconImg ||= nativeImage.createFromPath(path.join(SITE_DIR, "icons", "favicon-32.png"));
ipcMain.on("drag:start", (e, filename, bytes) => {
  fs.mkdirSync(DRAG_DIR, { recursive: true });
  const f = path.join(DRAG_DIR, cleanName(filename));
  fs.writeFileSync(f, Buffer.from(bytes));
  e.sender.startDrag({ file: f, icon: dragIcon() });
});

// ---------- finestra e menu ----------
function fetchAppMessage() {
  return new Promise((resolve, reject) => {
    const req = https.get(APP_MESSAGE_URL, { headers: { Accept: "application/json" } }, res => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        raw += chunk;
        if (raw.length > 64 * 1024) req.destroy(new Error("message too large"));
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error("invalid response"));
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function readAppMessageState() {
  try { return JSON.parse(fs.readFileSync(APP_MESSAGE_STATE, "utf8")); } catch (e) { return {}; }
}

function rememberAppMessage(id) {
  try {
    fs.mkdirSync(path.dirname(APP_MESSAGE_STATE), { recursive: true });
    fs.writeFileSync(APP_MESSAGE_STATE, JSON.stringify({ id }));
  } catch (e) {}
}

async function checkAppMessage() {
  if (!app.isPackaged || !win || win.isDestroyed()) return;
  try {
    const msg = await fetchAppMessage();
    if (!msg || msg.show !== true || !msg.id || !msg.title || !msg.message) return;
    if (msg.url && !/^https:\/\/patternmachine\.tongatron\.org\//.test(msg.url)) return;
    if (readAppMessageState().id === msg.id) return;
    win.webContents.send("app-message:show", { id: msg.id, title: msg.title, message: msg.message, url: msg.url || "" });
  } catch (e) {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 1380, height: 900, minWidth: 900, minHeight: 600,
    title: "PatternMachine",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // i link esterni si aprono nel browser; nella finestra restano solo le pagine del sito
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("app://pm/")) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  win.on("closed", () => { win = null; });
  win.on("focus", () => { if (account && !syncing) syncNow(); });
  win.loadURL("app://pm/index.html");
}

function buildMenu() {
  const open = dir => () => { fs.mkdirSync(dir, { recursive: true }); shell.openPath(dir); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { label: "File", submenu: [
      { label: "Open Projects Folder", click: open(PROJECTS_DIR) },
      { label: "Open Export Folder", click: open(EXPORT_DIR) },
      { type: "separator" },
      { role: "close" },
    ] },
    { role: "editMenu" },
    { label: "View", submenu: [
      { role: "reload" }, { role: "toggleDevTools" }, { type: "separator" },
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" },
    ] },
    { role: "windowMenu" },
    { role: "help", submenu: [
      { label: "PatternMachine Website", click: () => shell.openExternal("https://patternmachine.tongatron.org") },
    ] },
  ]));
}

app.setName("PatternMachine");
app.whenReady().then(() => {
  migrateProjectsDir();
  registerAppProtocol();
  openMidi();
  buildMenu();
  createWindow();
  setTimeout(checkAppMessage, 3000);
  account = loadAccount();
  setSyncState({ state: account ? "syncing" : "signed-out" });
  if (account) syncNow();
  setInterval(() => { if (account && win && win.isFocused()) syncNow(); }, 60000);
  app.on("activate", () => { if (!win) createWindow(); });
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  pendingNotes.forEach(clearTimeout);
  try { midiOut && midiOut.closePort(); midiIn && midiIn.closePort(); } catch (e) {}
});
