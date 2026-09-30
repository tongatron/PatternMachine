#!/usr/bin/env node
// Prove delle funzioni pure della voce sulla canzone (site/engine/vocal.js, PMVocal.util) fuori dal browser:
// secondi fino a uno step della canzone, ripresa rimessa in fila dai pezzi catturati, mix con la canzone e soglia.
// Lo lancia scripts/deploy.sh.
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "site", "engine", "vocal.js"), "utf8");
const g = { window: {}, Math, Float32Array, Object, Array, String, Blob: function(){}, URL: {} };
vm.createContext(g); vm.runInContext(src, g);
const u = g.window.PMVocal.util;
let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { failures++; console.log("  - " + msg); } };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// secondi fino allo step: blocchi con ripetizioni, swing (step pari lunghi, dispari corti)
{
  const blocks = [{ len: 16, repeats: 2 }, { len: 8, repeats: 1 }], dur = s => (s % 2 ? 0.1 : 0.15);
  check(u.secondsAt(blocks, 0, dur) === 0, "secondsAt: lo step 0 e' a 0 s");
  check(near(u.secondsAt(blocks, 16, dur), 2), "secondsAt: una ripetizione di 16 step dura 2 s");
  check(near(u.secondsAt(blocks, 32, dur), 4), "secondsAt: il secondo blocco parte dopo le due ripetizioni");
  check(near(u.secondsAt(blocks, 33, dur), 4.15), "secondsAt: lo step nel blocco successivo riparte dallo step 0 del suo pattern");
  check(near(u.secondsAt(blocks, 40, dur), 5), "secondsAt: la fine della canzone");
  check(near(u.secondsAt(blocks, 999, dur), 5), "secondsAt: oltre la fine resta la durata della canzone");
  check(near(u.secondsAt([{ len: 16, repeats: 0 }], 16, dur), 2), "secondsAt: ripetizioni 0 valgono 1");
}
// pezzi catturati rimessi al loro posto: offset, buchi, bordi
{
  const sr = 1000, c = (t, n, v) => ({ t, data: Float32Array.from({ length: n }, (_, i) => v + i) });
  const chunks = [c(10, 100, 0), c(10.1, 100, 1000), c(10.3, 50, 5000)];   // buco fra 10.2 e 10.3
  const out = u.place(chunks, sr, 10.05, 300);
  check(out.length === 300, "place: lunghezza richiesta");
  check(out[0] === 50 && out[49] === 99, "place: il primo pezzo parte dall'offset giusto");
  check(out[50] === 1000 && out[149] === 1099, "place: il secondo pezzo segue senza scarti");
  check(out[150] === 0 && out[249] === 0, "place: il buco resta silenzio");
  check(out[250] === 5000 && out[299] === 5049, "place: il pezzo dopo il buco va al suo istante");
  const early = u.place(chunks, sr, 9.99, 20);
  check(early[0] === 0 && early[9] === 0 && early[10] === 0 && early[19] === 9, "place: prima della cattura c'e' silenzio");
  check(u.place(chunks, sr, 0, -5).length === 0, "place: lunghezza negativa = vuoto");
}
// mix: voce su entrambi i canali, canzone piu' corta o mono
{
  const v = Float32Array.from([0.5, 0.5, 0.5, 0.5]);
  const m = u.mix([Float32Array.from([0.1, 0.1]), Float32Array.from([0.2, 0.2])], v, 0.5);
  check(m.length === 2 && m[0].length === 4, "mix: stereo lungo quanto la voce");
  check(near(m[0][0], 0.35, 1e-6) && near(m[1][1], 0.45, 1e-6), "mix: canzone + voce per il guadagno");
  check(near(m[0][3], 0.25, 1e-6), "mix: dove la canzone manca resta la voce");
  const mono = u.mix([Float32Array.from([0.1])], v);
  check(near(mono[1][0], 0.6, 1e-6), "mix: canzone mono su entrambi i canali");
  check(u.mix([new Float32Array(0)], v)[0][2] === 0.5, "mix: canzone vuota (silenziosa)");
}
// soglia: sopra 0.989 si abbassa tutto, sotto resta uguale
{
  const quiet = [Float32Array.from([0.2, -0.5])];
  check(u.underCeiling(quiet) === quiet, "underCeiling: sotto la soglia non cambia");
  const loud = u.underCeiling([Float32Array.from([0.5, -2]), Float32Array.from([1])]);
  check(near(loud[0][1], -0.989, 1e-6) && near(loud[0][0], 0.24725, 1e-6) && near(loud[1][0], 0.4945, 1e-6), "underCeiling: stesso guadagno su tutti i canali");
}

console.log(failures ? `vocal: ${failures}/${checks} controlli falliti` : `vocal: ${checks} controlli ok`);
process.exit(failures ? 1 : 0);
