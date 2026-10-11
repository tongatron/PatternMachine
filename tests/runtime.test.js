// Contratto del runtime condiviso: storage sicuro e capability detection.
// Lo esegue scripts/deploy.sh insieme agli altri test JavaScript.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "site", "engine", "runtime.js"), "utf8");
let local = new Map();
let session = new Map();
const makeStore = values => ({
  getItem: key => values.has(key) ? values.get(key) : null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
});
const root = {
  localStorage: makeStore(local),
  sessionStorage: makeStore(session),
  navigator: { requestMIDIAccess: () => {} },
  AudioWorkletNode: function AudioWorkletNode() {},
  indexedDB: {},
  CompressionStream: function CompressionStream() {},
  DecompressionStream: function DecompressionStream() {},
};
root.window = root;
vm.createContext(root);
vm.runInContext(source, root);

const runtime = root.PMRuntime;
assert(runtime, "PMRuntime non esposto");
assert.strictEqual(runtime.capabilities.audioWorklet, true);
assert.strictEqual(runtime.capabilities.indexedDb, true);
assert.strictEqual(runtime.storage.local.get("missing", "fallback"), "fallback");
assert.strictEqual(runtime.storage.local.set("answer", 42), true);
assert.strictEqual(runtime.storage.local.get("answer"), "42");
assert.strictEqual(runtime.storage.local.setJson("project", { bpm: 95 }), true);
assert.strictEqual(JSON.stringify(runtime.storage.local.getJson("project")), JSON.stringify({ bpm: 95 }));
assert.strictEqual(JSON.stringify(runtime.storage.local.getJson("broken", { safe: true })), JSON.stringify({ safe: true }));
assert.strictEqual(runtime.storage.local.remove("answer"), true);
assert.strictEqual(runtime.storage.local.get("answer"), null);

const failing = { localStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } };
failing.window = failing;
vm.createContext(failing);
vm.runInContext(source, failing);
assert.strictEqual(failing.PMRuntime.storage.local.get("x", "safe"), "safe");
assert.strictEqual(failing.PMRuntime.storage.local.set("x", 1), false);

console.log("ok: runtime, 13 verifiche");
