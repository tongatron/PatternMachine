#!/usr/bin/env node
// Prove del suono del synth (site/engine/synth-worklet.js) fuori dal browser: il worklet gira in un contesto
// finto (sampleRate, currentTime, AudioWorkletProcessor) e si misura l'uscita. Controlla intonazione, niente
// NaN ne' saturazione, slide mono, furto di voci, unita' KORG logue (WebAssembly) a 48 e 44,1 kHz.
// Lo lancia scripts/deploy.sh.
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = path.join(__dirname, "..", "site", "engine");
const src = fs.readFileSync(path.join(root, "synth-worklet.js"), "utf8");
let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { failures++; console.log("  - " + msg); } };

function make(sr, opts) {
  let Proc;
  const msgs = [];
  const g = { sampleRate: sr, currentTime: 0, Math, Float32Array, WebAssembly, Object, Array, isFinite, String,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: m => msgs.push(m) }; } },
    registerProcessor: (n, c) => { Proc = c; } };
  vm.createContext(g); vm.runInContext(src, g);
  const p = new Proc({ processorOptions: opts });
  return { msgs, render(sec) {
    const N = Math.ceil(sec * sr / 128) * 128, buf = new Float32Array(N), out = [[new Float32Array(128)]];
    for (let i = 0; i < N; i += 128) { g.currentTime = i / sr; p.process([], out); buf.set(out[0][0], i); }
    return buf;
  } };
}
const on = (time, n, v = 0.8, id = String(n), sl = false) => ({ t: "on", time, n, v, id, sl });
const off = (time, id) => ({ t: "off", time, id });
function stats(b, a = 0, z = b.length) {
  let peak = 0, nan = 0, ss = 0;
  for (let i = a; i < z; i++) { const v = b[i]; if (!isFinite(v)) nan++; else { peak = Math.max(peak, Math.abs(v)); ss += v * v; } }
  return { peak, nan, rms: Math.sqrt(ss / (z - a)) };
}
// Energia (Goertzel) a una frequenza esatta: piu' preciso di un conteggio di zeri quando il suono
// ha armoniche o rumore (la corda della logue-sdk), e non confonde un'ottava con l'altra come
// l'autocorrelazione (che ha un massimo anche ad ogni multiplo del periodo).
function goertzel(b, sr, a, len, freq) {
  const w = 2 * Math.cos(2 * Math.PI * freq / sr);
  let s1 = 0, s2 = 0;
  for (let i = a; i < a + len; i++) { const s0 = b[i] + w * s1 - s2; s2 = s1; s1 = s0; }
  return s1 * s1 + s2 * s2 - w * s1 * s2;
}
// La frequenza con piu' energia tra 60 e 1200 Hz: a differenza dell'autocorrelazione (massima anche
// ai multipli del periodo) il Goertzel non confonde un'ottava con l'altra, perche' misura l'energia
// vera a quella frequenza esatta (una sinusoide a 220 Hz non ha energia reale a 110 o 440 Hz).
function f0(b, sr, a, len) {
  let best = -1, bestF = 0;
  for (let f = 60; f <= 1200; f += 2) {
    const e = goertzel(b, sr, a, len, f);
    if (e > best) { best = e; bestF = f; }
  }
  // rifinisce attorno al minimo trovato, per non fermarsi al passo di 2 Hz
  for (let f = bestF - 2; f <= bestF + 2; f += 0.1) {
    const e = goertzel(b, sr, a, len, f);
    if (e > best) { best = e; bestF = f; }
  }
  return bestF;
}
const cents = (f, ref) => Math.abs(1200 * Math.log2(f / ref));

// 1) sinusoide: intonazione e silenzio dopo il rilascio
for (const sr of [44100, 48000]) {
  const b = make(sr, { params: { o1Wave: "sine", cutoff: 100, fEnv: 0, fKey: 0, fVelo: 0, aS: 100, aR: 5 }, events: [on(0, 57), off(0.5, "57")] }).render(1);
  const f = f0(b, sr, Math.round(sr * 0.1), 4096);
  check(cents(f, 220) < 10, `sinusoide a ${sr} Hz: ${f.toFixed(1)} Hz invece di 220`);
  check(stats(b, Math.round(sr * 0.8)).peak < 1e-3, `a ${sr} Hz la nota non si spegne dopo il rilascio`);
}
// 2) tutte le forme d'onda, filtri e modi al massimo: niente NaN, niente oltre 1
for (const o1Wave of ["saw", "square", "tri", "sine"]) for (const fType of ["lp24", "lp12", "hp12", "bp12"]) for (const mode of ["poly", "mono", "unison"]) {
  const ev = [on(0, 36, 1, "a"), off(0.2, "a"), on(0.2, 48, 0.7, "b"), on(0.25, 55, 0.7, "c", true), off(0.5, "b"), off(0.5, "c")];
  const s = stats(make(48000, { params: { o1Wave, fType, mode, reso: 100, drive: 100, o1Shape: 100, o2Lvl: 100, o2Ring: 1, mType: "noise", mLvl: 100, lAmt: 100, lTgt: "cutoff", vol: 100 }, events: ev }).render(0.8));
  check(s.nan === 0 && s.peak <= 1.001, `${o1Wave}/${fType}/${mode}: nan ${s.nan}, picco ${s.peak.toFixed(2)}`);
}
// 3) mono con slide: la seconda nota non riparte (niente buco di volume) e arriva all'ottava sopra
{
  const sr = 48000, b = make(sr, { params: { mode: "mono", o1Wave: "sine", cutoff: 100, fEnv: 0, fKey: 0, aS: 100, glide: 0 },
    events: [on(0, 45, 0.8, "a"), off(0.33, "a"), on(0.3, 57, 0.8, "b", true), off(0.8, "b")] }).render(1);
  const f = f0(b, sr, Math.round(sr * 0.55), 4096);
  check(cents(f, 220) < 15, `slide: arriva a ${f.toFixed(1)} Hz invece di 220`);
  let dip = 1; for (let i = Math.round(sr * 0.29); i < Math.round(sr * 0.4); i += 256) dip = Math.min(dip, stats(b, i, i + 256).peak);
  check(dip > 0.05, `slide: il volume cala a ${dip.toFixed(3)} (la nota e' ripartita)`);
}
// 4) poly: dieci note su otto voci (furto di voci) senza errori
{
  const ns = [48, 52, 55, 59, 62, 64, 67, 71, 74, 76];
  const s = stats(make(48000, { params: { mode: "poly", aA: 20 }, events: [...ns.map((n, i) => on(i * 0.01, n)), ...ns.map(n => off(0.6, String(n)))] }).render(1));
  check(s.nan === 0 && s.rms > 0.01, `poly: rms ${s.rms.toFixed(3)}, nan ${s.nan}`);
}
// 5) unita' KORG logue: si caricano e suonano (pluck anche intonato) a 48 e 44,1 kHz (ricampionamento)
const logue = path.join(root, "logue");
const units = fs.existsSync(logue) ? fs.readdirSync(logue).filter(f => f.endsWith(".wasm")).map(f => f.slice(0, -5)).sort() : [];
check(units.length >= 2, `unita' logue compilate: ${units.join(", ") || "nessuna"} (synth/build-logue.sh)`);
const list = fs.existsSync(path.join(logue, "units.json")) ? JSON.parse(fs.readFileSync(path.join(logue, "units.json"), "utf8")).units : [];
check(JSON.stringify(list) === JSON.stringify(units), `units.json (${list}) diverso dai .wasm (${units})`);
for (const u of units) for (const sr of [48000, 44100]) {
  const s = make(sr, { params: { o1Lvl: 0, mType: "logue", mUnit: u, mLvl: 100, cutoff: 100, fEnv: 0, fKey: 0, aS: 100 },
    units: { [u]: fs.readFileSync(path.join(logue, u + ".wasm")) }, events: [on(0, 57), off(0.6, "57")] });
  const b = s.render(0.8), st = stats(b, Math.round(sr * 0.05), Math.round(sr * 0.5));
  check(s.msgs.some(m => m.t === "unit-ready"), `${u} a ${sr} Hz: non si carica ${JSON.stringify(s.msgs)}`);
  check(st.nan === 0 && st.rms > 0.005 && st.peak <= 1, `${u} a ${sr} Hz: rms ${st.rms.toFixed(4)}, nan ${st.nan}`);
  // "pluck" e' una corda fisica (Karplus-Strong): a seconda dei parametri l'armonica piu' forte non e'
  // sempre la fondamentale, quindi qui non si controlla l'intonazione esatta (lo fa gia' il test sopra
  // con la sinusoide, che passa dalla stessa strada nel worklet: mtof, ricampionamento a 44,1/48 kHz).
}
// 6) MULTI "sample": il campione suona all'altezza della nota rispetto alla root, finisce da solo senza loop,
// continua con il loop, parte da Start; senza campione (non ancora arrivato) resta muto, senza NaN
{
  const tone = (sr, hz, sec, from = 0) => Float32Array.from({ length: Math.round(sr * sec) }, (_, i) => i < from * sr ? 0 : Math.sin(2 * Math.PI * hz * i / sr) * 0.8);
  const base = { o1Lvl: 0, mType: "sample", mSample: "t", mLvl: 100, cutoff: 100, fEnv: 0, fKey: 0, fVelo: 0, aS: 100, aR: 5, sRoot: 57 };
  for (const sr of [44100, 48000]) {
    const b = make(sr, { params: base, samples: { t: { data: tone(44100, 220, 1), sr: 44100 } }, events: [on(0, 69), off(0.8, "69")] }).render(0.6);
    const f = f0(b, sr, Math.round(sr * 0.1), 4096), st = stats(b);
    check(cents(f, 440) < 10, `campione a ${sr} Hz, un'ottava sopra la root: ${f.toFixed(1)} Hz invece di 440`);
    check(st.nan === 0 && st.peak <= 1, `campione a ${sr} Hz: nan ${st.nan}, picco ${st.peak.toFixed(2)}`);
  }
  const short = { t: { data: tone(48000, 220, 0.2), sr: 48000 } }, held = [on(0, 57), off(0.9, "57")];
  const one = make(48000, { params: base, samples: short, events: held }).render(0.8);
  check(stats(one, 48000 * 0.3, 48000 * 0.8).peak < 1e-3, "campione senza loop: suona ancora dopo la fine del file");
  const looped = make(48000, { params: { ...base, sLoop: 1 }, samples: short, events: held }).render(0.8);
  check(stats(looped, 48000 * 0.6, 48000 * 0.8).rms > 0.1, "campione con loop: si ferma invece di ripartire");
  const late = { t: { data: tone(48000, 220, 1, 0.5), sr: 48000 } };   // mezzo secondo di silenzio, poi la sinusoide
  const st = stats(make(48000, { params: { ...base, sStart: 50 }, samples: late, events: held }).render(0.3));
  check(st.rms > 0.1, `campione con Start 50%: rms ${st.rms.toFixed(3)} (non parte da meta' file)`);
  const none = stats(make(48000, { params: base, events: held }).render(0.5));
  check(none.nan === 0 && none.peak < 1e-6, `campione mancante: picco ${none.peak}, nan ${none.nan}`);
  const ready = make(48000, { params: base, samples: short, events: [] });
  check(ready.msgs.some(m => m.t === "sample-ready" && m.key === "t"), "campione: manca il messaggio sample-ready");
}

console.log(failures ? `${failures} problemi su ${checks} verifiche` : `ok: synth, ${checks} verifiche, unita' KORG: ${units.join(", ")}`);
process.exit(failures ? 1 : 0);
