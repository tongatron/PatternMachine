// Synth di PatternMachine: il suono, dentro un AudioWorklet (thread audio del browser).
// Lo carica engine/synth.js, che manda qui parametri e note gia' messe a tempo dal sequencer.
//
// Voce: VCO 1 + VCO 2 + MULTI (rumore, sub, un campione suonato all'altezza della nota, oppure un'unita'
// oscillatore della logue-sdk di KORG compilata in WebAssembly), filtro a variabili di stato (LP 24/12, HP, BP) con drive, due inviluppi ADSR,
// un LFO globale. Modi: poli (8 voci), mono (legato, slide stile 303), unison (4 voci stonate).
// L'architettura ricalca il minilogue xd: nel MULTI ENGINE lo slot USER e' quello delle unita' logue.
//
// Messaggi (port): {t:"params", p}, {t:"ev", list:[{t:"on",time,n,v,id,sl}|{t:"off",time,id}]},
// {t:"alloff"}, {t:"panic"}, {t:"bpm", bpm}, {t:"unit", name, bytes}, {t:"uparam", unit, id, value},
// {t:"sample", key, data, sr} (campione mono per il MULTI "sample", key = riferimento di params.mSample).
// Offline (export WAV): tutto arriva in processorOptions {params, bpm, events, units:{nome: byte del .wasm},
// samples:{key: {data, sr}}}.

const TAU = Math.PI * 2;
const CR = 32;                 // campioni per blocco di controllo (tono, filtro, LFO)
const LU_RATE = 48000;         // le unita' logue lavorano sempre a 48 kHz, come sull'hardware
const NUM_VOICES = 8;
const UNISON = 4;
const WAVES = { saw: 0, square: 1, tri: 2, sine: 3 };
const LFO_WAVES = { tri: 0, sine: 1, saw: 2, square: 3, sh: 4 };
const FTYPES = { lp24: 0, lp12: 1, hp12: 2, bp12: 3 };
// Durata in battiti (semiminime) delle divisioni a tempo.
const DIVS = { "1/1": 4, "1/2": 2, "1/4": 1, "1/8": 0.5, "1/16": 0.25, "3/16": 0.75, "1/4T": 2 / 3, "1/8T": 1 / 3, "3/8": 1.5 };

const mtof = n => 440 * Math.pow(2, (n - 69) / 12);
const clamp = (x, a, b) => x < a ? a : (x > b ? b : x);
// Tempo di un inviluppo: manopola 0..100 -> 0,5 ms .. 10 s, esponenziale.
const envTime = k => 0.0005 * Math.pow(20000, clamp(k, 0, 100) / 100);

function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function fold(y) {
  while (y > 1 || y < -1) y = y > 1 ? 2 - y : -2 - y;
  return y;
}
// Un campione di oscillatore alla fase p (0..1), incremento dt, SHAPE 0..1.
function osc(wave, p, dt, shape) {
  switch (wave) {
    case 0: {   // dente di sega; SHAPE aggiunge una seconda rampa sfasata di mezzo periodo (verso l'ottava)
      let y = 2 * p - 1 - polyblep(p, dt);
      if (shape > 0) {
        let q = p + 0.5; if (q >= 1) q -= 1;
        y = (y + shape * (2 * q - 1 - polyblep(q, dt))) / (1 + shape);
      }
      return y;
    }
    case 1: {   // quadra; SHAPE stringe l'impulso (50% -> 5%)
      const pw = 0.5 - shape * 0.45;
      let y = p < pw ? 1 : -1;
      y += polyblep(p, dt);
      let q = p - pw; if (q < 0) q += 1;
      y -= polyblep(q, dt);
      return y - (2 * pw - 1);
    }
    case 2: {   // triangolo; SHAPE lo ripiega (wavefolder)
      const y = p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
      return shape > 0 ? fold(y * (1 + shape * 3)) : y;
    }
    default: {  // sinusoide; SHAPE la ripiega
      const y = Math.sin(TAU * p);
      return shape > 0 ? fold(y * (1 + shape * 3)) : y;
    }
  }
}
function hermite(xm1, x0, x1, x2, t) {
  const c = (x1 - xm1) * 0.5, v = x0 - x1, w = c + v, a = w + v + (x2 - x0) * 0.5, b = w + a;
  return ((a * t - b) * t + c) * t + x0;
}

// Un'istanza di unita' logue per voce: ogni voce ha la sua memoria (fase, linea di ritardo...).
class LogueVoice {
  constructor(module) {
    const imports = {};
    for (const i of WebAssembly.Module.imports(module)) (imports[i.module] ||= {})[i.name] = () => 0;
    this.e = new WebAssembly.Instance(module, imports).exports;
    if (this.e._initialize) this.e._initialize();
    this.e.lu_init();
    this.out = new Float32Array(this.e.memory.buffer, this.e.lu_out(), 512);
    this.buf = new Float32Array(256);
    this.len = 0; this.pos = 1;
    this.note = -1;
  }
  noteOn(note, velo) { this.note = note; this.e.lu_note_on(note, velo); }
  noteOff() { if (this.note >= 0) this.e.lu_note_off(this.note); this.note = -1; }
  // Riempie dst[o..o+n) con l'uscita dell'unita', ricampionata da 48 kHz alla frequenza del contesto.
  render(dst, o, n, hz, lfo, ratio) {
    const w0 = Math.min(0.49, hz / LU_RATE);
    if (ratio === 1) {
      this.e.lu_render(w0, lfo, n);
      for (let i = 0; i < n; i++) dst[o + i] = this.out[i];
      return;
    }
    const buf = this.buf;
    for (let i = 0; i < n; i++) {
      while (this.pos + 2 >= this.len) {
        const keep = Math.floor(this.pos) - 1;
        if (keep > 0) { buf.copyWithin(0, keep, this.len); this.len -= keep; this.pos -= keep; }
        this.e.lu_render(w0, lfo, 64);
        buf.set(this.out.subarray(0, 64), this.len); this.len += 64;
      }
      const i0 = Math.floor(this.pos), fr = this.pos - i0;
      dst[o + i] = hermite(i0 > 0 ? buf[i0 - 1] : buf[i0], buf[i0], buf[i0 + 1], buf[i0 + 2], fr);
      this.pos += ratio;
    }
  }
}

class Voice {
  constructor(index) { this.index = index; this.age = 0; this.reset(); }
  reset() {
    this.id = null; this.note = 60; this.gate = false; this.active = false;
    this.vel = 0.8; this.acc = 0; this.detune = 0;
    this.pitch = 60; this.target = 60; this.glideTime = 0;
    this.p1 = Math.random(); this.p2 = Math.random(); this.p3 = 0; this.nz = 0;
    this.aSt = 0; this.aV = 0; this.fSt = 0; this.fV = 0;
    this.s1 = 0; this.s2 = 0; this.s3 = 0; this.s4 = 0;
    this.lu = null;
    this.sp = 0;                // posizione di lettura del campione (MULTI "sample"), in campioni del file
  }
}

class PMSynthProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.voices = Array.from({ length: NUM_VOICES }, (_, i) => new Voice(i));
    this.stack = [];            // note tenute in mono/unison: [{n, id, v}]
    this.ageCounter = 0;
    this.ev = [];
    this.units = {};            // nome -> [LogueVoice x NUM_VOICES]
    this.uParams = {};
    this.samples = {};          // riferimento -> {data: Float32Array mono, sr}
    this.bpm = o.bpm || 120;
    this.lfoPhase = 0; this.lfoSH = 0; this.lfoVal = 0;
    this.dc1 = 0; this.dc2 = 0;
    this.mix = new Float32Array(128);
    this.tmp = new Float32Array(CR);
    this.setParams(o.params || {});
    if (o.units) for (const [name, module] of Object.entries(o.units)) this.loadUnit(name, module);
    if (o.samples) for (const [key, x] of Object.entries(o.samples)) this.loadSample(key, x.data, x.sr);
    if (o.events) this.addEvents(o.events);
    this.port.onmessage = e => this.onMessage(e.data);
    this.port.onmessageerror = () => this.port.postMessage({ t: "unit-error", name: "?", error: "message could not be read" });
  }

  onMessage(m) {
    switch (m.t) {
      case "params": this.setParams(m.p); break;
      case "ev": this.addEvents(m.list); break;
      case "alloff": this.ev = []; this.stack = []; for (const v of this.voices) this.release(v); break;
      case "panic": this.ev = []; this.stack = []; for (const v of this.voices) { if (v.lu) v.lu.noteOff(); v.reset(); } break;
      case "bpm": this.bpm = m.bpm || this.bpm; break;
      case "unit": this.loadUnit(m.name, m.bytes); break;
      case "sample": this.loadSample(m.key, m.data, m.sr); break;
      case "uparam": {
        (this.uParams[m.unit] ||= {})[m.id] = m.value;
        for (const lv of this.units[m.unit] || []) lv.e.lu_set_param(m.id, m.value);
        break;
      }
    }
  }

  // I byte del .wasm si compilano qui: Chrome non sa passare un WebAssembly.Module gia' compilato al
  // thread audio (scarta il messaggio senza errori). La compilazione e' sincrona cosi' nell'export
  // offline l'unita' c'e' gia' al primo campione; ci mette pochi millisecondi (~80 KB).
  loadUnit(name, src) {
    try {
      const module = src instanceof WebAssembly.Module ? src : new WebAssembly.Module(src);
      this.units[name] = Array.from({ length: NUM_VOICES }, () => new LogueVoice(module));
      const saved = this.uParams[name] || {};
      for (const lv of this.units[name]) for (const [id, v] of Object.entries(saved)) lv.e.lu_set_param(+id, v);
      this.port.postMessage({ t: "unit-ready", name });
    } catch (err) {
      this.port.postMessage({ t: "unit-error", name, error: String(err) });
    }
  }

  loadSample(key, data, sr) {
    if (!key || !(data instanceof Float32Array) || data.length < 4) return;
    this.samples[key] = { data, sr: sr > 0 ? sr : sampleRate };
    this.port.postMessage({ t: "sample-ready", key });
  }

  setParams(p) {
    const prevMode = this.P && this.P.mode;
    const n = (k, d) => (typeof p[k] === "number" && isFinite(p[k]) ? p[k] : d);
    this.P = {
      mode: p.mode || "poly",
      o1Wave: WAVES[p.o1Wave] ?? 0, o1Shape: n("o1Shape", 0) / 100, o1Oct: n("o1Oct", 0),
      o2Wave: WAVES[p.o2Wave] ?? 0, o2Shape: n("o2Shape", 0) / 100, o2Oct: n("o2Oct", 0),
      o2Semi: n("o2Semi", 0), o2Fine: n("o2Fine", 0), o2Ring: !!p.o2Ring,
      mType: p.mType || "sub", mShape: n("mShape", 0) / 100, mUnit: p.mUnit || "",
      mSample: typeof p.mSample === "string" ? p.mSample : "", sRoot: n("sRoot", 60), sStart: clamp(n("sStart", 0), 0, 99) / 100, sLoop: !!p.sLoop,
      o1Lvl: n("o1Lvl", 80) / 100, o2Lvl: n("o2Lvl", 0) / 100, mLvl: n("mLvl", 0) / 100,
      fType: FTYPES[p.fType] ?? 0, cutoff: n("cutoff", 60), reso: n("reso", 20) / 100, fEnv: n("fEnv", 40) / 100,
      fKey: n("fKey", 50) / 100, drive: n("drive", 0) / 100, fVelo: n("fVelo", 30) / 100,
      aA: envTime(n("aA", 0)), aD: envTime(n("aD", 50)), aS: n("aS", 100) / 100, aR: envTime(n("aR", 20)),
      eA: envTime(n("eA", 0)), eD: envTime(n("eD", 40)), eS: n("eS", 0) / 100, eR: envTime(n("eR", 20)),
      lWave: LFO_WAVES[p.lWave] ?? 0, lRate: 0.05 * Math.pow(600, n("lRate", 40) / 100), lSync: DIVS[p.lSync] || 0,
      lAmt: n("lAmt", 0) / 100, lTgt: p.lTgt || "pitch",
      glide: Math.pow(n("glide", 0) / 100, 2) * 1.5, accent: n("accent", 50) / 100, uDet: n("uDet", 30) / 100,
      vol: n("vol", 70) / 100,
    };
    if (p.uParams && typeof p.uParams === "object") {
      for (const [unit, vals] of Object.entries(p.uParams)) {
        this.uParams[unit] = { ...vals };
        for (const lv of this.units[unit] || []) for (const [id, v] of Object.entries(vals)) lv.e.lu_set_param(+id, v);
      }
    }
    // Coefficienti per campione degli inviluppi (vedi renderVoice()).
    const P = this.P, sr = sampleRate;
    P.aAc = 1 - Math.exp(-1.466 / (P.aA * sr)); P.aDc = Math.exp(-4.6 / (P.aD * sr)); P.aRc = Math.exp(-4.6 / (P.aR * sr));
    P.eAc = 1 - Math.exp(-1.466 / (P.eA * sr)); P.eDc = Math.exp(-4.6 / (P.eD * sr)); P.eRc = Math.exp(-4.6 / (P.eR * sr));
    P.driveGain = 1 + P.drive * P.drive * 12;
    P.driveComp = 0.5 / Math.tanh(P.driveGain * 0.5);
    if (prevMode && prevMode !== P.mode) { this.stack = []; for (const v of this.voices) this.release(v); }
  }

  addEvents(list) {
    for (const e of list) this.ev.push(e);
    // a parita' di tempo prima i note off: una nota che finisce dove ne inizia un'altra non la spegne
    this.ev.sort((a, b) => {
      const time = a.time - b.time;
      if (time) return time;
      if (a.t === b.t) return 0;
      return a.t === "off" ? -1 : 1;
    });
  }

  // ---------- gestione delle voci ----------
  sampleOf() {
    const P = this.P;
    return P.mType === "sample" ? this.samples[P.mSample] || null : null;
  }
  unitFor(v) {
    const P = this.P;
    if (P.mType !== "logue" || !P.mUnit) return null;
    const arr = this.units[P.mUnit];
    return arr ? arr[v.index] : null;
  }
  // legato: la voce suonava gia' (mono/unison con note sovrapposte): cambia nota senza ripartire.
  // slide: nota di arrivo di uno slide del sequencer, scivola anche con GLIDE a zero (come la TB-303).
  trigger(v, n, vel, id, legato, slide, detune = 0) {
    const P = this.P;
    const glide = slide ? Math.max(P.glide, 0.06) : P.glide;
    if (!(v.active && glide > 0)) v.pitch = n;
    v.id = id; v.note = n; v.vel = vel; v.acc = vel >= 0.99 ? 1 : 0; v.detune = detune;
    v.target = n; v.glideTime = glide;
    if (!legato || !v.active) {
      v.aSt = 1; v.fSt = 1;       // riparte dal livello attuale: niente click
      const lu = this.unitFor(v);
      if (v.lu && v.lu !== lu) v.lu.noteOff();
      if (lu) { lu.noteOff(); lu.noteOn(clamp(Math.round(n), 0, 127), clamp(Math.round(vel * 127), 1, 127)); }
      v.lu = lu;
      const smp = this.sampleOf();
      v.sp = smp ? Math.floor(this.P.sStart * smp.data.length) : 0;
    }
    v.gate = true; v.active = true; v.age = ++this.ageCounter;
  }
  release(v) {
    if (!v.active) return;
    v.gate = false;
    if (v.aSt) v.aSt = 4;
    if (v.fSt) v.fSt = 4;
  }
  allocVoice() {
    let best = null;
    for (const v of this.voices) if (!v.active && (!best || v.age < best.age)) best = v;
    if (best) return best;
    for (const v of this.voices) if (!v.gate && (!best || v.aV < best.aV)) best = v;
    if (best) return best;
    for (const v of this.voices) if (!best || v.age < best.age) best = v;
    return best;
  }
  group() {
    return this.P.mode === "unison" ? this.voices.slice(0, UNISON) : this.voices.slice(0, 1);
  }
  groupTrigger(n, vel, id, legato, slide) {
    const g = this.group(), d = this.P.uDet * 0.5;
    const spread = g.length === 1 ? [0] : [-1, -1 / 3, 1 / 3, 1];
    g.forEach((v, i) => this.trigger(v, n, vel, id, legato, slide, spread[i] * d));
  }
  noteOn(e) {
    if (this.P.mode === "poly") {
      // la stessa nota ribattuta riusa la sua voce (niente due voci uguali sovrapposte)
      const same = this.voices.find(v => v.active && v.gate && v.note === e.n);
      this.trigger(same || this.allocVoice(), e.n, e.v, e.id, false, !!e.sl);
      return;
    }
    const held = this.stack.length > 0 && this.group()[0].gate;
    this.stack = this.stack.filter(s => s.id !== e.id);
    this.stack.push({ n: e.n, id: e.id, v: e.v });
    this.groupTrigger(e.n, e.v, e.id, held, !!e.sl);
  }
  noteOff(e) {
    if (this.P.mode === "poly") {
      for (const v of this.voices) if (v.id === e.id && v.gate) this.release(v);
      return;
    }
    const top = this.stack[this.stack.length - 1];
    this.stack = this.stack.filter(s => s.id !== e.id);
    if (!this.stack.length) { for (const v of this.group()) if (v.id === e.id) this.release(v); return; }
    if (top && top.id === e.id) {
      // torna in legato all'ultima nota ancora tenuta, come un mono vero
      const back = this.stack[this.stack.length - 1];
      this.groupTrigger(back.n, back.v, back.id, true, false);
    }
  }
  apply(e) {
    if (e.t === "on") this.noteOn(e);
    else if (e.t === "off") this.noteOff(e);
  }

  // ---------- LFO globale ----------
  lfoAdvance(n) {
    const P = this.P;
    const hz = P.lSync ? this.bpm / 60 / P.lSync : P.lRate;
    this.lfoPhase += hz * n / sampleRate;
    if (this.lfoPhase >= 1) { this.lfoPhase -= Math.floor(this.lfoPhase); this.lfoSH = Math.random() * 2 - 1; }
    const p = this.lfoPhase;
    switch (P.lWave) {
      case 0: this.lfoVal = p < 0.5 ? 4 * p - 1 : 3 - 4 * p; break;
      case 1: this.lfoVal = Math.sin(TAU * p); break;
      case 2: this.lfoVal = 1 - 2 * p; break;
      case 3: this.lfoVal = p < 0.5 ? 1 : -1; break;
      default: this.lfoVal = this.lfoSH;
    }
  }

  // ---------- suono ----------
  // MULTI "sample": n campioni in dst, letti alla velocita' che porta la nota di riferimento (sRoot) alla nota "note".
  // Senza loop, finito il file resta silenzio; con il loop riparte da Start.
  renderSample(v, smp, dst, n, note) {
    const d = smp.data, len = d.length, P = this.P;
    const start = Math.min(len - 2, Math.floor(P.sStart * len)), loop = P.sLoop && len - start > 4;
    const rate = Math.pow(2, (note - P.sRoot) / 12) * smp.sr / sampleRate;
    let pos = v.sp;
    for (let i = 0; i < n; i++) {
      if (pos >= len - 1) {
        if (!loop) { for (; i < n; i++) dst[i] = 0; break; }
        pos = start + (pos - start) % (len - 1 - start);
      }
      const i0 = Math.floor(pos), fr = pos - i0;
      const x1 = i0 + 1 < len ? d[i0 + 1] : d[start];
      const x2 = i0 + 2 < len ? d[i0 + 2] : (loop ? d[start + i0 + 2 - len] : 0);
      dst[i] = hermite(i0 > 0 ? d[i0 - 1] : d[i0], d[i0], x1, x2, fr);
      pos += rate;
    }
    v.sp = pos;
  }
  renderVoice(v, out, o, n) {
    const P = this.P, sr = sampleRate;
    const lfo = this.lfoVal * P.lAmt;
    // glide del tono (esponenziale, a blocchi di controllo)
    if (v.pitch !== v.target) {
      if (v.glideTime > 0) {
        v.pitch += (v.target - v.pitch) * (1 - Math.exp(-n / (v.glideTime / 3 * sr)));
        if (Math.abs(v.target - v.pitch) < 0.001) v.pitch = v.target;
      } else v.pitch = v.target;
    }
    const pm = P.lTgt === "pitch" ? this.lfoVal * P.lAmt * P.lAmt * 12 : 0;
    const base = v.pitch + v.detune + pm;
    const f1 = mtof(base + P.o1Oct * 12), f2 = mtof(base + P.o2Oct * 12 + P.o2Semi + P.o2Fine / 100);
    const dt1 = Math.min(0.45, f1 / sr), dt2 = Math.min(0.45, f2 / sr), dt3 = dt1 * 0.5;
    const shapeMod = P.lTgt === "shape" ? lfo : 0;
    const sh1 = clamp(P.o1Shape + shapeMod, 0, 1), sh2 = clamp(P.o2Shape + shapeMod, 0, 1);
    const trem = P.lTgt === "amp" ? 1 - P.lAmt * (1 - this.lfoVal) * 0.5 : 1;

    // MULTI: l'unita' logue e il campione scrivono il loro blocco in tmp; rumore e sub si fanno campione per campione
    const lu = P.mType === "logue" ? v.lu : null;
    const tmp = this.tmp;
    if (lu && P.mLvl > 0) lu.render(tmp, 0, n, mtof(base), shapeMod, LU_RATE / sr);
    const smp = this.sampleOf();
    if (smp && P.mLvl > 0) this.renderSample(v, smp, tmp, n, base);
    // 0 sub, 1 rumore, 2 blocco gia' pronto in tmp (unita' o campione), 3 silenzio (unita' o campione non ancora arrivati)
    const mType = lu || smp ? 2 : (P.mType === "noise" ? 1 : (P.mType === "logue" || P.mType === "sample" ? 3 : 0));

    // filtro: taglio in ottave, modulato da inviluppo, accento, tastiera, velocity e LFO
    let oct = 4.3219 + P.cutoff / 100 * 9.9658;         // 20 Hz .. 20 kHz
    oct += P.fEnv * 7 * v.fV + v.acc * P.accent * 2.5 * v.fV;
    oct += P.fKey * (v.note - 60) / 12 + P.fVelo * 2 * (v.vel - 0.7);
    if (P.lTgt === "cutoff") oct += lfo * 3;
    const fc = clamp(Math.pow(2, oct), 20, sr * 0.45);
    const g = Math.tan(Math.PI * fc / sr);
    const k = 2 - 1.94 * P.reso;
    const ka = P.fType === 0 ? 1.4142 : k;                // nel 24 dB la risonanza sta nel secondo stadio
    const a1 = 1 / (1 + g * (g + ka)), a2 = g * a1, a3 = g * a2;
    const b1 = 1 / (1 + g * (g + k)), b2 = g * b1, b3 = g * b2;
    const resGain = P.fType === 0 ? 1 + P.reso * 0.7 : 1 + P.reso * 0.3;

    const velGain = (1 - 0.5 * (1 - v.vel)) * (1 + v.acc * P.accent * 0.35) * trem * resGain;
    const o1L = P.o1Lvl, o2L = P.o2Lvl, mL = P.mLvl, ring = P.o2Ring, drive = P.drive > 0;
    const nzC = 1 - P.mShape * 0.95, subBlend = P.mShape;
    const aS = P.aS, eS = P.eS;
    let { p1, p2, p3, nz, s1, s2, s3, s4, aSt, aV, fSt, fV } = v;

    for (let i = 0; i < n; i++) {
      // oscillatori
      const x1 = osc(P.o1Wave, p1, dt1, sh1);
      let x2 = osc(P.o2Wave, p2, dt2, sh2);
      if (ring) x2 *= x1;
      let m = 0;
      if (mL > 0) {
        if (mType === 2) m = tmp[i];
        else if (mType === 1) { nz += (Math.random() * 2 - 1 - nz) * nzC; m = nz * (1 + P.mShape * 2); }
        else if (mType === 0) {
          const sq = (p3 < 0.5 ? 1 : -1) + polyblep(p3, dt3) - polyblep(p3 < 0.5 ? p3 + 0.5 : p3 - 0.5, dt3);
          m = sq * (1 - subBlend) + Math.sin(TAU * p3) * subBlend;
        }
      }
      p1 += dt1; if (p1 >= 1) p1 -= 1;
      p2 += dt2; if (p2 >= 1) p2 -= 1;
      p3 += dt3; if (p3 >= 1) p3 -= 1;
      let x = (x1 * o1L + x2 * o2L + m * mL) * 0.5;
      if (drive) x = Math.tanh(x * P.driveGain) * P.driveComp * 2;

      // filtro SVF (Zavalishin/Simper), 1 o 2 stadi
      let y;
      if (P.fType === 0) {
        let v3 = x - s2;
        const v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
        s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
        v3 = v2 - s4;
        const w1 = b1 * s3 + b2 * v3, w2 = s4 + b2 * s3 + b3 * v3;
        s3 = 2 * w1 - s3; s4 = 2 * w2 - s4;
        y = w2;
      } else {
        const v3 = x - s2, v1 = b1 * s1 + b2 * v3, v2 = s2 + b2 * s1 + b3 * v3;
        s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
        y = P.fType === 1 ? v2 : (P.fType === 2 ? x - k * v1 - v2 : v1 * k);
      }

      // inviluppi: attacco verso 1.3 (curva da analogico), decadimento e rilascio esponenziali
      if (aSt === 1) { aV += (1.3 - aV) * P.aAc; if (aV >= 1) { aV = 1; aSt = 2; } }
      else if (aSt === 2) { aV = aS + (aV - aS) * P.aDc; if (aV - aS < 1e-4) aSt = 3; }
      else if (aSt === 3) aV = aS;
      else if (aSt === 4) { aV *= P.aRc; if (aV < 1e-5) { aV = 0; aSt = 0; } }
      if (fSt === 1) { fV += (1.3 - fV) * P.eAc; if (fV >= 1) { fV = 1; fSt = 2; } }
      else if (fSt === 2) { fV = eS + (fV - eS) * P.eDc; if (fV - eS < 1e-4) fSt = 3; }
      else if (fSt === 3) fV = eS;
      else if (fSt === 4) { fV *= P.eRc; if (fV < 1e-5) { fV = 0; fSt = 0; } }

      out[o + i] += y * aV * velGain;
    }
    // stati instabili (NaN da parametri estremi): il filtro si azzera invece di ammutolire tutto
    if (!isFinite(s1 + s2 + s3 + s4)) { s1 = s2 = s3 = s4 = 0; }
    Object.assign(v, { p1, p2, p3, nz, s1, s2, s3, s4, aSt, aV, fSt, fV });
    if (aSt === 0) {
      v.active = false; v.gate = false;
      if (v.lu) { v.lu.noteOff(); v.lu = null; }
    }
  }

  process(inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const N = out.length;
    if (this.mix.length !== N) this.mix = new Float32Array(N);
    const mix = this.mix; mix.fill(0);
    const t0 = currentTime;
    let pos = 0;
    while (pos < N) {
      let evAt = N;
      if (this.ev.length) evAt = clamp(Math.round((this.ev[0].time - t0) * sampleRate), pos, N);
      if (evAt <= pos && this.ev.length) { this.apply(this.ev.shift()); continue; }
      const n = Math.min(evAt, pos + CR) - pos;
      this.lfoAdvance(n);
      for (const v of this.voices) if (v.active) this.renderVoice(v, mix, pos, n);
      pos += n;
    }
    // uscita: volume, blocco della continua, saturazione morbida (cubica, trasparente a basso livello)
    const vol = this.P.vol * this.P.vol;
    for (let i = 0; i < N; i++) {
      const x = mix[i] * vol;
      const y = x - this.dc1 + 0.995 * this.dc2;
      this.dc1 = x; this.dc2 = y;
      out[i] = y > 1.5 ? 1 : (y < -1.5 ? -1 : y - 0.148148 * y * y * y);
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

registerProcessor("pm-synth", PMSynthProcessor);
