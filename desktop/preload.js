// Il ponte fra la pagina e il processo principale: solo queste funzioni, niente Node nella pagina.
const { contextBridge, ipcRenderer } = require("electron");

const bytes = b => (b instanceof Uint8Array ? b : new Uint8Array(b));

contextBridge.exposeInMainWorld("pmDesktop", {
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    get: id => ipcRenderer.invoke("projects:get", id),
    set: (id, data) => ipcRenderer.invoke("projects:set", id, data),
    delete: id => ipcRenderer.invoke("projects:delete", id),
  },
  exportFile: (filename, data) => ipcRenderer.invoke("export:file", filename, bytes(data)),
  exportFolder: files => ipcRenderer.invoke("export:folder", files.map(f => ({ name: f.name, data: bytes(f.data) }))),
  reveal: p => ipcRenderer.send("export:reveal", p),
  startDrag: (filename, data) => ipcRenderer.send("drag:start", filename, bytes(data)),
  midi: {
    status: () => ipcRenderer.invoke("midi:status"),
    notes: list => ipcRenderer.send("midi:notes", list),
    panic: () => ipcRenderer.send("midi:panic"),
    onInput: cb => { ipcRenderer.on("midi:in", (_e, msg) => cb(msg)); },
  },
});
