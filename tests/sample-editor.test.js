#!/usr/bin/env node
// Prove delle funzioni sul suono dell'editor del Sampler (site/engine/sample-editor.js, PMSampleEditor.dsp) fuori dal
// browser: trim, cancellazione, dissolvenze, normalizzazione, inversione, silenzi ai bordi, zero-crossing, crunch,
// drive, filtri, EQ, mix con i bordi, attacchi e fette (chop) e WAV.
// Lo lancia scripts/deploy.sh.
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "site", "engine", "sample-editor.js"), "utf8");
const g = { window: {}, Math, Float32Array, Float64Array, ArrayBuffer, DataView, Object, Array, String, isFinite };
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
// crunch compandato: al massimo 2^bit livelli, e sui suoni piano sbaglia meno del lineare a parita' di bit
{
  const quiet = [sine(4800, 440, 0.02)], err = c => { let s = 0; for (let i = 0; i < 4800; i++) s += (c[0][i] - quiet[0][i]) ** 2; return s; };
  const mu = dsp.crunch(quiet, sr, 0, 4800, sr, 8, "mu"), lin = dsp.crunch(quiet, sr, 0, 4800, sr, 8);
  check(err(mu) < err(lin) / 4, `crunch mu: errore ${err(mu)} contro ${err(lin)} del lineare`);
  const full = dsp.crunch([ramp(4800).map(v => v * 2 - 1)], sr, 0, 4800, sr, 8, "mu")[0];
  check(new Set(full).size <= 256 && Math.max(...full) <= 1 && Math.min(...full) >= -1, `crunch mu: ${new Set(full).size} livelli`);
}
// livello di un seno dopo un filtro, in dB, misurato sulla seconda meta' (a regime)
const level = (hz, fn, amp = 0.5) => {
  const n = 9600, x = [sine(n, hz, amp)], y = fn(x, n)[0];
  let sx = 0, sy = 0; for (let i = n / 2; i < n; i++) { sx += x[0][i] ** 2; sy += y[i] ** 2; }
  return 10 * Math.log10(sy / sx);
};
// filtri: passano la banda giusta e tagliano il resto; 24 dB/ottava taglia piu' di 12
{
  const lp = (x, n) => dsp.filter(x, sr, 0, n, { type: "lowpass", hz: 1000 }), lp12 = (x, n) => dsp.filter(x, sr, 0, n, { type: "lowpass", hz: 1000, slope: 12 });
  check(Math.abs(level(100, lp)) < 0.5, `lowpass: 100 Hz a ${level(100, lp).toFixed(1)} dB`);
  check(level(8000, lp) < -60 && level(8000, lp12) < -30 && level(8000, lp12) > -45, `lowpass: 8 kHz a ${level(8000, lp).toFixed(1)} / ${level(8000, lp12).toFixed(1)} dB`);
  const hp = (x, n) => dsp.filter(x, sr, 0, n, { type: "highpass", hz: 1000 });
  check(level(100, hp) < -60 && Math.abs(level(8000, hp)) < 0.5, `highpass: ${level(100, hp).toFixed(1)} / ${level(8000, hp).toFixed(1)} dB`);
  const bp = (x, n) => dsp.filter(x, sr, 0, n, { type: "bandpass", hz: 1000, q: 2, slope: 12 });
  check(Math.abs(level(1000, bp)) < 0.5 && level(100, bp) < -20, `bandpass: ${level(1000, bp).toFixed(1)} / ${level(100, bp).toFixed(1)} dB`);
  const notch = (x, n) => dsp.filter(x, sr, 0, n, { type: "notch", hz: 1000, slope: 12 });
  check(level(1000, notch) < -30 && Math.abs(level(8000, notch)) < 1, `notch: ${level(1000, notch).toFixed(1)} dB al centro`);
  const part = dsp.filter(st, sr, 200, 300, { type: "lowpass", hz: 500 });
  check(part[0][199] === st[0][199] && part[0][300] === st[0][300] && part[0][250] !== st[0][250], "filter: intervallo sbagliato");
}
// EQ: ogni banda alza la sua zona e lascia le altre
{
  const eq = o => (x, n) => dsp.eq(x, sr, 0, n, o);
  check(Math.abs(level(30, eq({ low: 12 })) - 12) < 1 && Math.abs(level(5000, eq({ low: 12 }))) < 0.5, `eq low: ${level(30, eq({ low: 12 })).toFixed(1)} dB a 30 Hz`);
  check(Math.abs(level(1000, eq({ mid: -6, midHz: 1000 })) + 6) < 0.1 && Math.abs(level(100, eq({ mid: -6 }))) < 1, "eq mid: la campana non sta a 1 kHz");
  check(Math.abs(level(20000, eq({ high: 6 })) - 6) < 1 && Math.abs(level(200, eq({ high: 6 }))) < 0.2, `eq high: ${level(20000, eq({ high: 6 })).toFixed(1)} dB a 20 kHz`);
  check(dsp.eq(st, sr, 0, 1000, {}) === st, "eq piatto non deve fare niente");
}
// drive: il fondo scala resta a 1 (prima di out), i suoni piano salgono; tube senza continua; fold resta in +-1
{
  const full = [sine(9600, 100, 1)];
  for (const type of ["soft", "hard", "fold"]) {
    const y = dsp.drive(full, sr, 0, 9600, { type, db: 18 });
    check(dsp.peak(y) <= 1 + 1e-9 && dsp.peak(y) > 0.95, `drive ${type}: picco ${dsp.peak(y)}`);
  }
  check(near(dsp.peak(dsp.drive(full, sr, 0, 9600, { db: 12, out: -6 })), Math.pow(10, -6 / 20), 1e-3), "drive: out non abbassa di 6 dB");
  check(dsp.peak(dsp.drive([sine(9600, 100, 0.1)], sr, 0, 9600, { db: 12 })) > 0.3, "drive: i suoni piano devono salire");
  const t = dsp.drive(full, sr, 0, 9600, { type: "tube", db: 12 })[0];
  let mean = 0; for (let i = 4800; i < 9600; i++) mean += t[i] / 4800;
  check(Math.abs(mean) < 0.01 && dsp.peak([t]) < 1.1, `drive tube: continua ${mean.toFixed(4)}, picco ${dsp.peak([t])}`);
  const mid = dsp.drive(full, sr, 3000, 9600, { type: "tube", db: 30 });     // a meta' suono: niente picco all'inizio
  check(dsp.peak(mid, 3000, 3500) < 1.1, `drive tube a meta' suono: picco ${dsp.peak(mid, 3000, 3500)}`);
}
// mix: 0 = originale, 1 = effetto; ai bordi interni la dissolvenza parte dall'originale
{
  const dry = [new Float32Array(1000)], wet = [new Float32Array(1000).fill(1)];
  check(dsp.mix(dry, wet, 0, 1000, 0)[0].every(v => v === 0), "mix 0: deve restare l'originale");
  check(dsp.mix(dry, wet, 0, 1000, 1)[0].every(v => v === 1), "mix 1 sul suono intero: niente dissolvenze");
  const m = dsp.mix(dry, wet, 100, 900, 1, 50)[0];
  check(m[99] === 0 && m[100] === 0 && near(m[125], 0.5) && m[500] === 1 && m[899] === 0 && m[900] === 0, `mix: bordi ${m[100]}, ${m[125]}, ${m[899]}`);
  check(near(dsp.mix(dry, wet, 0, 1000, 0.25)[0][500], 0.25), "mix 25%");
}
// attacchi: un break finto (cassa, rullante, hi-hat anche sopra la coda della cassa) trovato entro 3 ms
{
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 * 2 - 1;
  const n = sr, d = new Float32Array(n);
  const kick = t0 => { for (let i = 0; i < sr * 0.4; i++) { const t = i / sr; if (t0 + i < n) d[t0 + i] += Math.sin(2 * Math.PI * 55 * t * (1 + 2 * Math.exp(-t * 40))) * Math.exp(-t * 6) * 0.8; } };
  const noise = (t0, amp, decay, len) => { for (let i = 0; i < sr * len; i++) if (t0 + i < n) d[t0 + i] += rnd() * amp * Math.exp(-i / sr * decay); };
  const at = [0.1, 0.225, 0.35, 0.6, 0.725].map(t => Math.round(t * sr));
  kick(at[0]); noise(at[1], 0.15, 60, 0.05); noise(at[2], 0.5, 18, 0.2); kick(at[3]); noise(at[4], 0.12, 60, 0.05);
  const found = dsp.onsets([d], sr, 0, n, 50);
  const ok = found.length === at.length && found.every((f, k) => Math.abs(f - at[k]) <= sr * 0.003);
  check(ok, `onsets: attesi ${at.map(x => (x / sr).toFixed(3))}, trovati ${found.map(x => (x / sr).toFixed(3))}`);
  check(dsp.onsets([d], sr, 0, n, 0).length <= found.length, "onsets: con sensibilita' 0 non devono essere di piu'");
  const tail = [Float32Array.from({ length: sr }, (_, i) => Math.sin(2 * Math.PI * 60 * i / sr) * Math.exp(-i / sr * 3))];
  check(dsp.onsets(tail, sr, 0, sr, 100).length === 0, "onsets: una coda che scende non ha attacchi");
  const part = dsp.onsets([d], sr, at[2] - 2000, n, 50);
  check(part.every(f => f >= at[2] - 2000 + sr * 0.02), "onsets: niente attacchi nei primi 20 ms dell'intervallo");
  check(dsp.onsets([d], sr, 0, n, 100, 45, 2).length === 2, "onsets: il massimo non e' rispettato");
}
// fette: da un inizio al successivo, coda sfumata; step nel pattern con le collisioni
{
  const one = [new Float32Array(3000).fill(0.5)], parts = dsp.slice(one, [0, 1000, 2400], 3000, sr);
  check(parts.length === 3 && parts[0][0].length === 1000 && parts[2][0].length === 600 && parts[1][0][0] === 0.5, "slice: lunghezze sbagliate");
  check(parts[0][0][999] < 0.01 && parts[0][0][500] === 0.5 && parts[2][0][599] < 0.01, "slice: manca la dissolvenza in uscita");
  const st16 = dsp.stepsOf([0, 250, 500, 750], 0, 1000, 16);
  check(st16.join() === "0,4,8,12", `stepsOf: ${st16}`);
  const clash = dsp.stepsOf([0, 10, 20, 990], 0, 1000, 4);
  check(clash.join() === "0,1,-1,3", `stepsOf con collisioni: ${clash}`);
  check(dsp.stepsOf([0, 900, 950, 980], 0, 1000, 4).join() === "0,-1,-1,3", "stepsOf: le fette senza step libero devono dare -1");
  const moved = dsp.stepsOf([0, 6.5, 7, 8].map(x => x * 1000), 0, 16000, 16);     // un taglio spostato a meta' fra due step
  check(moved.join() === "0,6,7,8", `stepsOf: un taglio fuori posto sposta le altre fette (${moved})`);
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
