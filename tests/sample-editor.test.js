#!/usr/bin/env node
// Prove delle funzioni sul suono dell'editor del Sampler (site/engine/sample-editor.js, PMSampleEditor.dsp) fuori dal
// browser: trim, cancellazione, dissolvenze, normalizzazione, inversione, silenzi ai bordi, zero-crossing, 12 bit e WAV.
// Lo lancia scripts/deploy.sh.
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "site", "engine", "sample-editor.js"), "utf8");
const g = { window: {}, Math, Float32Array, ArrayBuffer, DataView, Object, Array, String, isFinite };
vm.createContext(g); vm.runInContext(src, g);
const dsp = g.window.PMSampleEditor.dsp;
let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { failures++; console.log("  - " + msg); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const sr = 48000;
const sine = (n, hz = 440, amp = 0.5, ph = 0) => Float32Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * hz * i / sr + ph) * amp);
const ramp = n => Float32Array.from({ length: n }, (_, i) => i / n);
const st = [sine(1000), sine(1000, 440, 0.25)];

// trim e cancellazione: lunghezze e contenuto
{
  const c = dsp.crop(st, 100, 400);
  check(c.length === 2 && c[0].length === 300 && c[0][0] === st[0][100] && c[1][299] === st[1][399], "crop: lunghezza o contenuto sbagliati");
  const r = dsp.remove(st, 100, 400);
  check(r[0].length === 700 && r[0][99] === st[0][99] && r[0][100] === st[0][400], "remove: le due parti non si ricongiungono");
  check(st[0].length === 1000, "le funzioni non devono toccare l'originale");
}
// silenzio e guadagno solo nell'intervallo, guadagno limitato a +-1
{
  const s = dsp.silence(st, 10, 20);
  check(s[0][9] === st[0][9] && s[0][10] === 0 && s[0][19] === 0 && s[0][20] === st[0][20], "silence: intervallo sbagliato");
  const loud = dsp.gain([Float32Array.of(0.8, -0.8, 0.2)], 0, 3, 2);
  check(loud[0][0] === 1 && loud[0][1] === -1 && near(loud[0][2], 0.4), "gain: manca il limite a +-1");
}
// dissolvenze: 0 all'inizio del fade in, intatto alla fine; il contrario per il fade out
{
  const one = [new Float32Array(101).fill(1)];
  const fi = dsp.fade(one, 0, 101, "in")[0], fo = dsp.fade(one, 0, 101, "out")[0];
  check(near(fi[0], 0) && near(fi[100], 1) && near(fi[50], 0.5, 1e-3), `fade in: ${fi[0]}, ${fi[50]}, ${fi[100]}`);
  check(near(fo[0], 1) && near(fo[100], 0) && fo[30] > fo[70], `fade out: ${fo[0]}, ${fo[100]}`);
}
// normalizzazione: il picco dell'intervallo va a 0,989 (-0,1 dB), il resto non cambia; il silenzio resta com'e'
{
  const n = dsp.normalize(st, 0, 1000);
  check(near(dsp.peak(n), 0.989, 1e-4), `normalize: picco ${dsp.peak(n)}`);
  check(near(n[1][123] / n[0][123], st[1][123] / st[0][123], 1e-5), "normalize: i canali devono salire insieme");
  const quiet = [new Float32Array(10)];
  check(dsp.normalize(quiet, 0, 10) === quiet, "normalize sul silenzio non deve fare niente");
}
// inversione di un pezzo
{
  const r = dsp.reverse([ramp(10)], 2, 6)[0];
  check(near(r[2], 0.5) && near(r[5], 0.2) && near(r[1], 0.1) && near(r[6], 0.6), "reverse: intervallo sbagliato");
}
// silenzi ai bordi: trova la parte udibile, con margine; null se tutto zero
{
  const d = new Float32Array(sr);                         // 1 s: silenzio, poi 0,2 s di suono da 0,3 s
  d.set(sine(sr * 0.2), sr * 0.3);
  const r = dsp.audible([d], sr);
  check(r && Math.abs(r[0] - sr * 0.3) < sr * 0.004 && Math.abs(r[1] - sr * 0.5) < sr * 0.02, `audible: ${r}`);
  check(dsp.audible([new Float32Array(100)], sr) === null, "audible: il silenzio deve dare null");
}
// zero-crossing: da un punto qualsiasi arriva a un passaggio per lo zero vicino
{
  const d = [sine(4800, 100)];                            // 100 Hz: zeri ogni 240 campioni
  const z = dsp.zeroCross(d, 1000, 200);
  check(z % 240 === 0 || Math.abs(d[0][z]) < 0.01, `zeroCross: ${z} (valore ${d[0][z]})`);
  check(dsp.zeroCross(d, 0, 10) === 0 && dsp.zeroCross(d, 4800, 10) === 4800, "zeroCross ai bordi");
}
// SP-1200: al massimo 4096 livelli e valori tenuti per circa sr/26040 campioni
{
  const c = dsp.crunch([ramp(4800).map(v => v * 2 - 1)], sr, 0, 4800)[0];
  const levels = new Set(c).size, q = 2047;
  check([...c].every(v => near(Math.round(v * q) / q, v, 1e-6)), "crunch: valori fuori dalla griglia a 12 bit");
  check(levels <= 4800 * 26040 / sr + 2, `crunch: ${levels} valori distinti, troppi per 26 kHz`);
  const part = dsp.crunch(st, sr, 200, 300);
  check(part[0][199] === st[0][199] && part[0][300] === st[0][300], "crunch fuori dall'intervallo non deve cambiare");
}
// WAV 16 bit: intestazione e campioni
{
  const buf = dsp.encodeWav([Float32Array.of(0, 1, -1, 0.5), Float32Array.of(0, -1, 1, -0.5)], 44100), v = new DataView(buf);
  const tag = o => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  check(buf.byteLength === 44 + 4 * 2 * 2, `wav: ${buf.byteLength} byte`);
  check(tag(0) === "RIFF" && tag(8) === "WAVE" && tag(12) === "fmt " && tag(36) === "data", "wav: intestazione");
  check(v.getUint16(20, true) === 1 && v.getUint16(22, true) === 2 && v.getUint32(24, true) === 44100 && v.getUint16(34, true) === 16, "wav: formato");
  check(v.getInt16(44 + 4, true) === 32767 && v.getInt16(44 + 6, true) === -32768 && v.getInt16(44 + 12, true) === 16384, "wav: campioni interlacciati");
}

console.log(failures ? `${failures} problemi su ${checks} verifiche` : `ok: editor del Sampler, ${checks} verifiche`);
process.exit(failures ? 1 : 0);
