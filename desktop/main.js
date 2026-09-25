// PatternMachine per macOS: il sito di ../site dentro una finestra, piu' quello che il browser non puo' fare.
// - app://pm/ serve i file del sito dal disco (niente server, niente password) e aggiunge a index.html
//   bridge/bridge.js e bridge/bridge.css, che agganciano le funzioni native senza toccare il sito.
// - porta MIDI virtuale "PatternMachine": uscita (note verso Logic) e ingresso (MIDI Clock da Logic).
// - progetti ed esportazioni come file veri in ~/Music/PatternMachine.
// - trascinamento di MIDI/WAV dall'app alla timeline di Logic.
const { app, BrowserWindow, protocol, net, ipcMain, shell, Menu, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const SITE_DIR = app.isPackaged ? path.join(process.resourcesPath, "site") : path.join(__dirname, "..", "site");
const BRIDGE_DIR = path.join(__dirname, "bridge");
const HOME_DIR = process.env.PM_HOME || path.join(app.getPath("music"), "PatternMachine");   // PM_HOME: per le prove
const PROJECTS_DIR = path.join(HOME_DIR, "Progetti");
const EXPORT_DIR = path.join(HOME_DIR, "Export");
const DRAG_DIR = path.join(app.getPath("temp"), "PatternMachine-drag");
const PORT_NAME = "PatternMachine";

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win = null;

// ---------- file del sito ----------
// Dentro la cartella del sito e basta; /__desktop/ porta ai file del ponte.
function resolveAppPath(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "") || "index.html";
  const [root, sub] = rel.startsWith("__desktop/") ? [BRIDGE_DIR, rel.slice("__desktop/".length)] : [SITE_DIR, rel];
  const full = path.normalize(path.join(root, sub));
  return full.startsWith(root + path.sep) ? full : null;
}

function registerAppProtocol() {
  protocol.handle("app", async (req) => {
    const { pathname } = new URL(req.url);
    const file = resolveAppPath(pathname);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response("non trovato", { status: 404 });
    if (file === path.join(SITE_DIR, "index.html")) {
      const html = fs.readFileSync(file, "utf8").replace("</body>",
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

// ---------- esportazioni ----------
const cleanName = s => String(s).replace(/[\/:\0]/g, "-").replace(/^\.+/, "").trim() || "export";
function freeName(dir, name) {
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  let out = name, n = 2;
  while (fs.existsSync(path.join(dir, out))) out = `${base} ${n++}${ext}`;
  return out;
}
// Un file nella cartella Export, senza sovrascrivere. Restituisce il percorso.
ipcMain.handle("export:file", (_e, filename, bytes) => {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const f = path.join(EXPORT_DIR, freeName(EXPORT_DIR, cleanName(filename)));
  fs.writeFileSync(f, Buffer.from(bytes));
  return f;
});
// Un gruppo di file in sottocartelle: il pacchetto per Logic, gia' scompattato.
ipcMain.handle("export:folder", (_e, files) => {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const root = path.join(EXPORT_DIR, freeName(EXPORT_DIR, cleanName(files[0].name.split("/")[0])));
  for (const { name, data } of files) {
    const f = path.join(root, ...name.split("/").slice(1).map(cleanName));
    if (!f.startsWith(root + path.sep)) continue;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(data));
  }
  return root;
});
ipcMain.on("export:reveal", (_e, p) => {
  if (typeof p === "string" && p.startsWith(HOME_DIR + path.sep)) shell.showItemInFolder(p);
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
  app.on("activate", () => { if (!win) createWindow(); });
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  pendingNotes.forEach(clearTimeout);
  try { midiOut && midiOut.closePort(); midiIn && midiIn.closePort(); } catch (e) {}
});
