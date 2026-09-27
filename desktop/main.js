// PatternMachine per macOS: il sito di ../site dentro una finestra, piu' quello che il browser non puo' fare.
// - app://pm/ serve i file del sito dal disco (niente server, niente password) e aggiunge a index.html
//   bridge/bridge.js e bridge/bridge.css, che agganciano le funzioni native senza toccare il sito.
// - porta MIDI virtuale "PatternMachine": uscita (note verso Logic) e ingresso (MIDI Clock da Logic).
// - progetti ed esportazioni come file veri in ~/Music/PatternMachine.
// - trascinamento di MIDI/WAV dall'app alla timeline di Logic.
const { app, BrowserWindow, protocol, net, ipcMain, shell, Menu, nativeImage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { execFileSync } = require("child_process");
const { randomUUID } = require("crypto");
const { pathToFileURL } = require("url");

const SITE_DIR = app.isPackaged ? path.join(process.resourcesPath, "site") : path.join(__dirname, "..", "site");
const BRIDGE_DIR = path.join(__dirname, "bridge");
const HOME_DIR = process.env.PM_HOME || path.join(app.getPath("music"), "PatternMachine");   // PM_HOME: per le prove
const PROJECTS_DIR = path.join(HOME_DIR, "Progetti");
const EXPORT_DIR = path.join(HOME_DIR, "Export");
const DRAG_DIR = path.join(app.getPath("temp"), "PatternMachine-drag");
const KITS_DIR = path.join(app.getPath("userData"), "drum-machines");
const PORT_NAME = "PatternMachine";
const APP_MESSAGE_URL = "https://patternmachine.tongatron.org/api/app-message";
const APP_MESSAGE_STATE = path.join(app.getPath("userData"), "app-message-state.json");

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
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response("non trovato", { status: 404 });
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
  if (!/^[A-Za-z0-9_-]+$/.test(String(id))) throw new Error("id non valido");
  return path.join(PROJECTS_DIR, id + ".json");
};
ipcMain.handle("projects:list", () => {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  return fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith(".json")).map(f => {
    try { return { id: f.slice(0, -5), data: JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), "utf8")) }; }
    catch (e) { return null; }
  }).filter(Boolean);
});
ipcMain.handle("projects:get", (_e, id) => {
  const f = projectFile(id);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
});
ipcMain.handle("projects:set", (_e, id, data) => {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const f = projectFile(id), tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, f);
  return true;
});
// nel Cestino, non cancellato: un progetto rimosso per sbaglio si recupera
ipcMain.handle("projects:delete", async (_e, id) => {
  const f = projectFile(id);
  if (fs.existsSync(f)) await shell.trashItem(f);
  return true;
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
function kitPath(id) { if (!safeKitId(id)) throw new Error("kit non valido"); return path.join(KITS_DIR, id); }
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
    title: "Importa Drum Machine",
    buttonLabel: "Scegli campioni",
    properties: ["openFile", "openDirectory"],
    filters: [{ name: "Cartella o archivio ZIP", extensions: ["zip"] }],
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
    } else throw new Error("scegli una cartella o un file ZIP");
    const files = listKitAudio(staging);
    if (!files.length) throw new Error("non ho trovato campioni audio (WAV, AIFF, MP3, OGG, FLAC o M4A)");
    return { stagingId, files };
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(e.message || "importazione non riuscita");
  }
});
function normalizeKitSlots(id, slots) {
  if (!Array.isArray(slots) || !slots.length || slots.length > 42) throw new Error("un kit deve contenere da 1 a 42 campioni");
  const root = kitPath(id), seen = new Set();
  return slots.map(s => {
    const file = String(s.file || "").replaceAll("\\", "/");
    if (!file || file.startsWith("/") || file.includes("../") || !AUDIO_EXT.test(file) || seen.has(file)) throw new Error("campione non valido");
    const full = path.normalize(path.join(root, file));
    if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) throw new Error("campione non trovato");
    seen.add(file);
    return { slot: String(s.slot || "").slice(0, 80), file, label: String(s.label || s.slot || file).trim().slice(0, 80) || file };
  });
}
ipcMain.handle("kits:create", (_e, stagingId, data) => {
  if (!/^\.staging-[A-Za-z0-9-]+$/.test(String(stagingId))) throw new Error("importazione non valida");
  const staging = path.join(KITS_DIR, stagingId);
  if (!fs.existsSync(staging)) throw new Error("importazione scaduta");
  const id = `custom-${Date.now()}-${randomUUID().slice(0, 8)}`, target = kitPath(id);
  fs.renameSync(staging, target);
  try {
    const meta = { id, label: String(data?.label || "Drum Machine").trim().slice(0, 80) || "Drum Machine", source: "campioni personali", slots: normalizeKitSlots(id, data?.slots) };
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
    title: "Esporta PatternMachine",
    defaultPath: path.join(EXPORT_DIR, safe),
    filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: "Tutti i file", extensions: ["*"] }] : undefined,
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, Buffer.from(bytes));
  return { path: result.filePath };
});
// Un gruppo di file in sottocartelle: il pacchetto per Logic, gia' scompattato.
ipcMain.handle("export:folder", async (_e, files) => {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const result = await dialog.showOpenDialog(win, {
    title: "Scegli dove esportare il pacchetto",
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
        if (raw.length > 64 * 1024) req.destroy(new Error("messaggio troppo grande"));
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error("risposta non valida"));
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
  win.loadURL("app://pm/index.html");
}

function buildMenu() {
  const open = dir => () => { fs.mkdirSync(dir, { recursive: true }); shell.openPath(dir); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { label: "File", submenu: [
      { label: "Apri cartella Progetti", click: open(PROJECTS_DIR) },
      { label: "Apri cartella Export", click: open(EXPORT_DIR) },
      { type: "separator" },
      { role: "close" },
    ] },
    { role: "editMenu" },
    { label: "Vista", submenu: [
      { role: "reload" }, { role: "toggleDevTools" }, { type: "separator" },
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" },
    ] },
    { role: "windowMenu" },
    { role: "help", submenu: [
      { label: "Sito PatternMachine", click: () => shell.openExternal("https://patternmachine.tongatron.org") },
    ] },
  ]));
}

app.setName("PatternMachine");
app.whenReady().then(() => {
  registerAppProtocol();
  openMidi();
  buildMenu();
  createWindow();
  setTimeout(checkAppMessage, 3000);
  app.on("activate", () => { if (!win) createWindow(); });
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  pendingNotes.forEach(clearTimeout);
  try { midiOut && midiOut.closePort(); midiIn && midiIn.closePort(); } catch (e) {}
});
