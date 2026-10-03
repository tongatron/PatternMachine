// Synth di PatternMachine (in prova): una linea di note per pattern, suonata a tempo con la batteria.
// Lo carica index.html per tutti gli utenti del sito (o in locale con ?synth); il suono e' in engine/synth-worklet.js.
//
// Dati nel progetto (li salvano serialize()/deserialize() di index.html):
//   project.synth = {preset, key, scale, mute, params:{...manopole, uParams:{unita': {id: valore}}}}
//   project.synthPatterns = [{id, name, len, synth:[{s:step, n:nota MIDI, l:lunghezza in step, a:1 accento, g:1 slide, k:generatore che l'ha scritta o "rec" se registrata dal vivo}]}]
//   project.synthSong = corsia del synth nella canzone (vedi index.html, synthLayout())
// I preset salvati dall'utente stanno nel browser (localStorage) e, per chi ha un account, anche sul server: vedi syncPresets().
// Nomi delle note come in Logic: 60 = C3.
//
// Usa dal sito (variabili globali dello script principale): actx, project, curPattern, curSynth, synthById, makeSynthPattern, uid,
// bpm, swing, stepDur, playing, recording, visible, queue, pushUndo, setStatus, ask, el, saveBlob, exportBase,
// varLen, MIDI_PPQ, SAMPLES, stepIdx, setView, synthTimeline, renderSong, synthSampleList/Info/Buffer (MULTI "Sample"). index.html chiama PMSynth.step() da scheduler(),
// PMSynth.allOff() da stop(), PMSynth.show() da setView() e PMSynth.renderOffline() dall'export WAV/MP3.
(function () {
  "use strict";
  const script = document.currentScript;
  const BASE = script ? new URL(".", script.src) : new URL("engine/", location.href);
  const QS = script ? new URL(script.src).search : "";
  const WORKLET_URL = new URL("synth-worklet.js" + QS, BASE).href;
  const TONE_URL = new URL("tone.js" + QS, BASE).href;
  const LOGUE_DIR = new URL("logue/", BASE);

  const clamp = (x, a, b) => x < a ? a : (x > b ? b : x);
  const SYNTH_LENS = [8, 16, 32, 64, 128, 256];
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const noteName = n => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2);   // convenzione di Logic: 60 = C3
  const isBlack = n => [1, 3, 6, 8, 10].includes(n % 12);
  const envTime = k => 0.0005 * Math.pow(20000, k / 100);
  const fmtTime = s => s < 1 ? Math.round(s * 1000) + " ms" : s.toFixed(s < 10 ? 2 : 1) + " s";
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  // ---------- parametri ----------
  const WAVE_OPTS = [["saw", "Saw"], ["square", "Square"], ["tri", "Triangle"], ["sine", "Sine"]];
  const DIV_OPTS = ["1/16", "1/8T", "1/8", "3/16", "1/4T", "1/4", "3/8", "1/2", "1/1"];
  const DIV_BEATS = { "1/1": 4, "1/2": 2, "1/4": 1, "1/8": 0.5, "1/16": 0.25, "3/16": 0.75, "1/4T": 2 / 3, "1/8T": 1 / 3, "3/8": 1.5 };
  const pct = v => v + "%";
  const signed = u => v => (v > 0 ? "+" : "") + v + u;
  const SECTIONS = [
    { title: "VCO 1", params: [
      { k: "o1Wave", label: "Wave", opts: WAVE_OPTS, def: "saw" },
      { k: "o1Shape", label: "Shape", def: 0 },
      { k: "o1Oct", label: "Octave", min: -2, max: 2, def: 0, fmt: signed("") }] },
    { title: "VCO 2", params: [
      { k: "o2Wave", label: "Wave", opts: WAVE_OPTS, def: "saw" },
      { k: "o2Shape", label: "Shape", def: 0 },
      { k: "o2Oct", label: "Octave", min: -2, max: 2, def: 0, fmt: signed("") },
      { k: "o2Semi", label: "Pitch", min: -12, max: 12, def: 0, fmt: signed(" st") },
      { k: "o2Fine", label: "Fine", min: -50, max: 50, def: 7, fmt: signed(" ct") },
      { k: "o2Ring", label: "Ring mod", opts: [[0, "Off"], [1, "On"]], def: 0 }] },
    { title: "Multi engine", id: "multi", params: [
      { k: "mType", label: "Type", opts: [["sub", "Sub osc"], ["noise", "Noise"], ["sample", "Sample"], ["logue", "KORG logue unit"]], def: "sub" },
      { k: "mShape", label: "Shape", def: 0, hint: "sub: square → sine · noise: white → dark" },
      { k: "mUnit", label: "Unit", opts: [], def: "waves" },
      // Sample: un suono della drum machine o del sampler, suonato all'altezza della nota (Root = velocita' originale)
      { k: "mSample", label: "Sound", opts: [], def: "" },
      { k: "sRoot", label: "Root", min: 24, max: 96, def: 60, fmt: v => noteName(v), hint: "the note that plays the sound at its original pitch" },
      { k: "sStart", label: "Start", max: 99, def: 0, fmt: pct },
      { k: "sLoop", label: "Loop", opts: [[0, "Off"], [1, "On"]], def: 0 }] },
    { title: "Mixer", params: [
      { k: "o1Lvl", label: "VCO 1", def: 80 },
      { k: "o2Lvl", label: "VCO 2", def: 0 },
      { k: "mLvl", label: "Multi", def: 0 }] },
    { title: "Filter", params: [
      { k: "fType", label: "Type", opts: [["lp24", "Low-pass 24 dB"], ["lp12", "Low-pass 12 dB"], ["hp12", "High-pass"], ["bp12", "Band-pass"]], def: "lp24" },
      { k: "cutoff", label: "Cutoff", def: 60, fmt: v => { const hz = 20 * Math.pow(1000, v / 100); return hz < 1000 ? Math.round(hz) + " Hz" : (hz / 1000).toFixed(1) + " kHz"; } },
      { k: "reso", label: "Resonance", def: 20 },
      { k: "fEnv", label: "EG amount", min: -100, max: 100, def: 40, fmt: signed("") },
      { k: "fKey", label: "Key track", def: 50, fmt: pct },
      { k: "fVelo", label: "Velocity", def: 30, fmt: pct },
      { k: "drive", label: "Drive", def: 0 }] },
    { title: "Amp EG", params: [
      { k: "aA", label: "Attack", def: 0, fmt: v => fmtTime(envTime(v)) },
      { k: "aD", label: "Decay", def: 50, fmt: v => fmtTime(envTime(v)) },
      { k: "aS", label: "Sustain", def: 100, fmt: pct },
      { k: "aR", label: "Release", def: 20, fmt: v => fmtTime(envTime(v)) }] },
    { title: "Filter EG", params: [
      { k: "eA", label: "Attack", def: 0, fmt: v => fmtTime(envTime(v)) },
      { k: "eD", label: "Decay", def: 40, fmt: v => fmtTime(envTime(v)) },
      { k: "eS", label: "Sustain", def: 0, fmt: pct },
      { k: "eR", label: "Release", def: 20, fmt: v => fmtTime(envTime(v)) }] },
    { title: "LFO", params: [
      { k: "lWave", label: "Wave", opts: [["tri", "Triangle"], ["sine", "Sine"], ["saw", "Saw"], ["square", "Square"], ["sh", "Sample & hold"]], def: "tri" },
      { k: "lTgt", label: "Target", opts: [["pitch", "Pitch"], ["cutoff", "Cutoff"], ["shape", "Shape"], ["amp", "Volume"]], def: "pitch" },
      { k: "lSync", label: "Sync", opts: [["off", "Free"], ...DIV_OPTS.map(d => [d, d])], def: "off" },
      { k: "lRate", label: "Rate", def: 40, fmt: v => (0.05 * Math.pow(600, v / 100)).toFixed(2) + " Hz" },
      { k: "lAmt", label: "Amount", def: 0 }] },
    { title: "Voice", params: [
      { k: "mode", label: "Mode", opts: [["poly", "Poly (8)"], ["mono", "Mono"], ["unison", "Unison (4)"]], def: "poly" },
      { k: "glide", label: "Glide", def: 0, fmt: v => fmtTime(Math.pow(v / 100, 2) * 1.5) },
      { k: "accent", label: "Accent", def: 50, fmt: pct },
      { k: "uDet", label: "Unison detune", def: 30 },
      { k: "gate", label: "Gate", min: 10, max: 100, def: 75, fmt: pct, hint: "how much of the last step each note holds" },
      { k: "trans", label: "Transpose", min: -24, max: 24, def: 0, fmt: signed(" st") }] },
    { title: "Effects", params: [
      { k: "chorus", label: "Chorus", def: 0 },
      { k: "delay", label: "Delay", def: 0 },
      { k: "dTime", label: "Delay time", opts: DIV_OPTS.map(d => [d, d]), def: "3/16" },
      { k: "dFb", label: "Feedback", max: 90, def: 35, fmt: pct },
      { k: "reverb", label: "Reverb", def: 0 },
      { k: "vol", label: "Volume", def: 70 }] },
  ];
  const SPEC = Object.fromEntries(SECTIONS.flatMap(s => s.params).map(p => [p.k, p]));
  const DEFAULTS = Object.fromEntries(Object.values(SPEC).map(p => [p.k, p.def]));
  const FX_KEYS = new Set(["chorus", "delay", "dTime", "dFb", "reverb"]);
  const SAMPLE_KEYS = new Set(["mSample", "sRoot", "sStart", "sLoop"]);
  const SAMPLE_MAX_SEC = 10;       // oltre, il campione si tronca: 8 voci leggono la stessa copia, ma resta in memoria

  const PRESETS = {
    "Acid 303": { vol: 42, mode: "mono", o1Wave: "saw", o1Lvl: 90, o2Lvl: 0, fType: "lp24", cutoff: 32, reso: 78, fEnv: 55, eD: 38, eS: 0, aD: 70, aS: 100, aR: 6, accent: 85, drive: 35, gate: 70, delay: 18, dTime: "3/16", dFb: 30 },
    "Sub bass": { vol: 100, mode: "mono", o1Wave: "sine", o1Lvl: 90, o2Wave: "square", o2Lvl: 18, o2Fine: 0, fType: "lp24", cutoff: 38, reso: 5, fEnv: 12, eD: 30, aR: 12, glide: 15, gate: 85 },
    "Reese": { vol: 64, mode: "unison", o1Wave: "saw", o2Wave: "saw", o2Lvl: 80, o2Fine: 14, uDet: 45, fType: "lp24", cutoff: 42, reso: 22, fEnv: 10, aR: 18, chorus: 25, gate: 95 },
    "Pluck": { vol: 78, mode: "poly", o1Wave: "saw", o2Wave: "square", o2Lvl: 45, o2Fine: 9, fType: "lp12", cutoff: 22, reso: 25, fEnv: 72, eD: 32, eS: 0, aD: 42, aS: 0, aR: 30, delay: 28, dTime: "3/16", reverb: 22 },
    "House stab": { vol: 75, mode: "poly", o1Wave: "saw", o2Wave: "saw", o2Lvl: 70, o2Semi: 7, o2Fine: 0, fType: "lp12", cutoff: 38, reso: 30, fEnv: 50, eD: 30, aD: 36, aS: 0, aR: 22, reverb: 30, chorus: 20 },
    "Poly pad": { vol: 57, mode: "poly", o1Wave: "saw", o2Wave: "saw", o2Lvl: 75, o2Fine: 11, fType: "lp24", cutoff: 50, reso: 12, fEnv: 15, eA: 55, eD: 70, eS: 40, aA: 62, aD: 60, aS: 85, aR: 68, lWave: "sine", lTgt: "cutoff", lRate: 18, lAmt: 20, chorus: 60, reverb: 45, gate: 100 },
    "Lead": { vol: 73, mode: "mono", o1Wave: "square", o1Shape: 35, o2Wave: "saw", o2Oct: 1, o2Lvl: 45, o2Fine: 5, fType: "lp24", cutoff: 58, reso: 25, fEnv: 30, eD: 45, eS: 30, glide: 28, lWave: "sine", lTgt: "pitch", lRate: 58, lAmt: 14, delay: 30, dTime: "1/8", reverb: 20 },
    "Chip": { vol: 95, mode: "mono", o1Wave: "square", o1Shape: 50, o1Lvl: 80, fType: "lp12", cutoff: 100, reso: 0, fEnv: 0, aD: 40, aS: 60, aR: 8, gate: 60 },
    "KORG waves": { vol: 66, mode: "poly", o1Lvl: 0, o2Lvl: 0, mType: "logue", mUnit: "waves", mLvl: 90, fType: "lp12", cutoff: 72, reso: 15, fEnv: 20, eD: 45, aA: 8, aD: 60, aS: 70, aR: 40, lTgt: "shape", lWave: "tri", lRate: 30, lAmt: 35, chorus: 35, reverb: 30,
      uParams: { waves: { 0: 300, 1: 200, 2: 6, 3: 12 } } },
    "KORG pluck": { vol: 79, mode: "poly", o1Lvl: 0, o2Lvl: 0, mType: "logue", mUnit: "pluck", mLvl: 100, fType: "lp12", cutoff: 90, reso: 0, fEnv: 0, aA: 0, aS: 100, aR: 55, gate: 100, delay: 22, dTime: "1/8", reverb: 28,
      uParams: { pluck: { 0: 380, 1: 820 } } },
  };
  PRESETS["Kick bass"] = { vol: 80, mode: "mono", o1Wave: "sine", o1Lvl: 0, o2Lvl: 0, mType: "sample", mSample: "kit:std/Kick 1", sRoot: 36, mLvl: 100,
    fType: "lp24", cutoff: 62, reso: 10, fEnv: 15, eD: 35, aS: 100, aR: 14, glide: 12, gate: 85 };
  const DEFAULT_PRESET = "Acid 303";
  const DEFAULT_KORG_PRESET = "KORG waves";
  // Logo KORG (marchio di KORG Inc.) dal file di Wikimedia Commons "Korg_logo.svg" (logo di solo testo, pubblico dominio
  // per il diritto d'autore): mostra da dove vengono gli oscillatori delle unita' logue.
  const KORG_LOGO = "m 123.28,0.2057815 -17.9625,0 c -8.71375,0 -9.32625,8.525 -9.32625,8.525 l 0,23.6762505 c 0.0125,7.605 8.675,8.58375 8.675,8.58375 l 18.61375,0 0,-22.1025 c 2.1375,0 1.9875,-3.98625 0,-3.98625 -1.8,0 -11.8375,0 -11.8375,0 l 0,15.1025 c 0,2.8075 -4.075,2.8075 -4.075,0 0,-2.84875 0,-18.7775 0,-18.7775 0,-1.8175005 2.0375,-2.0412505 2.0375,-2.0412505 l 13.875,0 0,-8.98 M 79.20375,14.494532 c 0,2.41625 -4.0875,2.6825 -4.0875,0 l 0,-4.0825 c -0.1125,-2.8025005 4.1,-2.8512505 4.0875,0 l 0,4.0825 z m 9.7875,7.34625 -4.9,-1.22375 c 3.825,-1.005 5.9125,-3.1075 5.975,-6.5575 l 0,-7.9487505 c 0,-1.35 -1.7125,-5.70125 -7.2,-5.90375 l -19.175,0 0,40.8212505 11.425,0 0,-15.51375 c -0.2625,-0.8025 1.8375,-2.605 2.425,-0.24875 l 3.2875,15.7625 12.6625,0 -4.5,-19.1875 m -41.63875,8.16375 c 0,2.55125 -4.075,2.595 -4.075,0 l 0,-18.7775 c 0,-2.5687505 4.075,-2.5500005 4.075,0 0,2.55125 0,16.22875 0,18.7775 z m 11.4,-21.3462505 c 0,0 -0.4,-8.25 -9.35,-8.657499998 l -8.1625,0 C 40.19,-0.0354185 31.95125,1.1582815 31.83875,9.3907815 l 0,23.2012505 c 0,0 0.7125,8.61875 9.40125,8.6375 l 8.1625,0 c 0,0 9.4,-0.31875 9.3875,-9.38625 L 58.7525,8.6582815 M 0,41.027032 0,0.2057815 l 11.4375,0 0,15.1025005 c 0.1875,2.05125 2.275,1.14 2.425,0.195 l 2.475,-15.2975005 12.65125,0 -4.4875,18.7775005 -4.9,1.2225 5.3,1.22625 4.5,19.595 -12.6625,0 -2.87625,-16.53875 c -0.1375,-1.28 -2.3875,-1.29125 -2.425,0.21 -0.0375,1.49875 0,16.32875 0,16.32875 l -11.4375,0";
  const TONE_PRESETS = {
    "Tone Soft Pad": { vol: 70, o1Wave: "saw", o1Lvl: 100, fType: "lp12", cutoff: 48, reso: 10, aA: 62, aD: 60, aS: 82, aR: 68, gate: 100 },
    "Tone Square Bass": { vol: 88, o1Wave: "square", o1Lvl: 100, fType: "lp12", cutoff: 32, reso: 18, aA: 0, aD: 35, aS: 58, aR: 12, gate: 78 },
    "Tone Triangle Pluck": { vol: 82, o1Wave: "tri", o1Lvl: 100, fType: "lp12", cutoff: 55, reso: 8, aA: 0, aD: 28, aS: 0, aR: 22, gate: 55 },
    "Tone Sine Lead": { vol: 76, o1Wave: "sine", o1Lvl: 100, fType: "lp12", cutoff: 100, reso: 0, aA: 4, aD: 25, aS: 82, aR: 18, gate: 86 },
  };
  const DEFAULT_TONE_PRESET = "Tone Soft Pad";
  const USER_KEY = "pm.synth.presets";
  const presetBank = () => engineOf() === "tone" ? TONE_PRESETS : PRESETS;
  const userPresetKey = () => USER_KEY + "." + (engineOf() === "tone" ? "tone" : "custom");
  function userPresets() {
    try {
      const key = userPresetKey(), old = key.endsWith(".custom") ? localStorage.getItem(USER_KEY) : null;
      return JSON.parse(localStorage.getItem(key) || old || "{}");
    } catch (e) { return {}; }
  }
  function writeUserPresets(o) {
    // per la sincronizzazione: l'ora di ogni preset cambiato e una lapide per quelli tolti
    const bank = engineOf() === "tone" ? "tone" : "custom", before = userPresets(), m = presetMeta(), now = Date.now();
    for (const n of Object.keys(o)) if (JSON.stringify(o[n]) !== JSON.stringify(before[n])) { m.t[bank][n] = now; delete m.gone[bank][n]; }
    for (const n of Object.keys(before)) if (!(n in o)) { delete m.t[bank][n]; m.gone[bank][n] = now; }
    try { localStorage.setItem(userPresetKey(), JSON.stringify(o)); localStorage.setItem(META_KEY, JSON.stringify(m)); }
    catch (e) { setStatus("presets can't be saved in this browser", "err"); }
    clearTimeout(presetSyncTimer); presetSyncTimer = setTimeout(syncPresets, 800);
  }
  // ---------- preset sincronizzati con l'account (sito e app) ----------
  // Qui i preset restano nel browser come prima ({nome: parametri} per banco); accanto, META_KEY tiene l'ora di
  // ogni preset e le lapidi di quelli cancellati. Il documento dell'account ha la stessa informazione
  // ({custom:{nome:{p,t}}, tone:{...}, gone:{custom:{nome:t}, tone:{}}}): a ogni giro i due si uniscono per nome,
  // vince il piu' recente (una cancellazione piu' recente vince su un salvataggio piu' vecchio).
  // Sul sito il documento passa da /api/synth-presets, nell'app da window.pmDesktop.presets (sessione dell'app).
  const META_KEY = USER_KEY + ".sync", BANKS = ["custom", "tone"];
  let presetSyncTimer = 0, presetSyncState = "local", presetSyncing = null;
  function presetMeta() {
    let m = {}; try { m = JSON.parse(localStorage.getItem(META_KEY) || "{}") || {}; } catch (e) {}
    m.t = m.t || {}; m.gone = m.gone || {};
    for (const b of BANKS) { m.t[b] = m.t[b] || {}; m.gone[b] = m.gone[b] || {}; }
    return m;
  }
  function readBank(b) {
    try { return JSON.parse(localStorage.getItem(USER_KEY + "." + b) || (b === "custom" ? localStorage.getItem(USER_KEY) : null) || "{}") || {}; }
    catch (e) { return {}; }
  }
  const presetRemote = () => window.pmDesktop
    ? (window.pmDesktop.presets ? { get: () => window.pmDesktop.presets.get(), put: doc => window.pmDesktop.presets.put(doc) } : null)
    : { async get() { const r = await fetch("/api/synth-presets", { cache: "no-store" }); if (r.ok) return (await r.json()).presets || {};
          if ([401, 403, 404].includes(r.status)) return null;       // ospite o non collegato: restano solo qui
          throw new Error("presets " + r.status); },
        async put(doc) { const r = await fetch("/api/synth-presets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ presets: doc }) }); return r.ok; } };
  // Unisce i preset di qui con il documento dell'account: {doc da rimandare, banks e meta da tenere qui}.
  function mergePresets(remote) {
    const m = presetMeta(), doc = { gone: {} }, banks = {};
    for (const b of BANKS) {
      const L = readBank(b), R = (remote && remote[b]) || {}, RG = (remote && remote.gone && remote.gone[b]) || {};
      doc[b] = {}; doc.gone[b] = {}; banks[b] = {};
      const t = {}, gone = {};
      for (const n of new Set([...Object.keys(L), ...Object.keys(R), ...Object.keys(m.gone[b]), ...Object.keys(RG)])) {
        const lt = n in L ? (m.t[b][n] || 1) : -1, rt = R[n] && R[n].p ? (+R[n].t || 1) : -1, gt = Math.max(+m.gone[b][n] || 0, +RG[n] || 0);
        if (gt > Math.max(lt, rt)) { doc.gone[b][n] = gone[n] = gt; continue; }
        const p = lt >= rt ? L[n] : R[n].p, when = Math.max(lt, rt);
        banks[b][n] = p; t[n] = when; doc[b][n] = { p, t: when };
      }
      m.t[b] = t; m.gone[b] = gone;
    }
    return { doc, banks, meta: m };
  }
  // Un giro di sincronizzazione; lo stato (synced / local / error) lo mostra la finestra My presets.
  function syncPresets() {
    clearTimeout(presetSyncTimer);
    if (presetSyncing) return presetSyncing;
    presetSyncing = (async () => {
      const remoteApi = presetRemote();
      try {
        const remote = remoteApi ? await remoteApi.get() : null;
        if (!remote) { presetSyncState = "local"; return; }
        const before = JSON.stringify(BANKS.map(readBank)), { doc, banks, meta } = mergePresets(remote);
        try { for (const b of BANKS) localStorage.setItem(USER_KEY + "." + b, JSON.stringify(banks[b])); localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {}
        const sameDoc = JSON.stringify(doc) === JSON.stringify({ gone: remote.gone || {}, custom: remote.custom || {}, tone: remote.tone || {} });
        presetSyncState = sameDoc || await remoteApi.put(doc) ? "synced" : "error";
        if (JSON.stringify(BANKS.map(readBank)) !== before && built) paintTop();
      } catch (e) { presetSyncState = "error"; }
      finally { presetSyncing = null; if (pm) renderPresets(); }
    })();
    return presetSyncing;
  }
  const presetParams = (name, bank = presetBank()) => {
    const src = bank[name] || userPresets()[name] || bank[bank === TONE_PRESETS ? DEFAULT_TONE_PRESET : DEFAULT_PRESET];
    return JSON.parse(JSON.stringify({ ...DEFAULTS, uParams: {}, ...src }));
  };

  const SCALES = {
    chromatic: ["Chromatic", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
    minor: ["Minor", [0, 2, 3, 5, 7, 8, 10]], major: ["Major", [0, 2, 4, 5, 7, 9, 11]],
    dorian: ["Dorian", [0, 2, 3, 5, 7, 9, 10]], phrygian: ["Phrygian", [0, 1, 3, 5, 7, 8, 10]],
    harmonic: ["Harmonic minor", [0, 2, 3, 5, 7, 8, 11]], pentaMinor: ["Minor pentatonic", [0, 3, 5, 7, 10]],
    pentaMajor: ["Major pentatonic", [0, 2, 4, 7, 9]], blues: ["Blues", [0, 3, 5, 6, 7, 10]],
  };

  // ---------- stato ----------
  let allowed = false;
  const view = { base: 36, tap: "note", kbdOct: 3, fold: false };
  try { Object.assign(view, JSON.parse(localStorage.getItem("pm.synth.view") || "{}")); } catch (e) {}
  const saveView = () => { try { localStorage.setItem("pm.synth.view", JSON.stringify(view)); } catch (e) {} };

  // Finche' non si tocca niente il progetto resta senza "synth" (e i progetti degli altri non cambiano).
  const params = () => project.synth ? { ...presetParams(project.synth.preset), ...project.synth.params } : presetParams(DEFAULT_PRESET, PRESETS);
  const engineOf = () => project.synth?.engine === "tone" ? "tone" : "custom";
  // Motore nel menu Engine: KORG e Custom sono lo stesso motore audio ("custom"); KORG e' quello con un'unita'
  // KORG logue come oscillatore (i preset "KORG ..."), Custom gli altri.
  const engineUi = () => engineOf() === "tone" ? "tone" : (params().mType === "logue" ? "korg" : "custom");
  const ENGINE_LABEL = { korg: "KORG", tone: "Tone.js", custom: "Custom" };
  const TONE_KEYS = new Set(["o1Wave", "o1Lvl", "fType", "cutoff", "reso", "aA", "aD", "aS", "aR", "gate", "trans", "vol"]);
  const keyOf = () => project.synth?.key ?? 9;               // La
  const scaleOf = () => SCALES[project.synth?.scale] ? project.synth.scale : "minor";
  function ensure() {
    if (!project.synth) project.synth = { preset: DEFAULT_PRESET, key: 9, scale: "minor", mute: false, solo: false, params: presetParams(DEFAULT_PRESET) };
    if (!project.synth.params || typeof project.synth.params !== "object") project.synth.params = {};
    // progetto con il solo nome del preset (il New Mix): i parametri si prendono dal preset
    if (!Object.keys(project.synth.params).length) project.synth.params = presetParams(project.synth.preset);
    if (project.synth.solo == null) project.synth.solo = false;
    return project.synth;
  }
  // Al worklet vanno solo le manopole del suono (gli effetti stanno nel grafo qui sotto).
  const workletParams = p => {
    const o = {};
    for (const [k, v] of Object.entries(p)) if (!FX_KEYS.has(k) && k !== "mSmpName") o[k] = v;
    o.o2Ring = +p.o2Ring; o.sLoop = +p.sLoop || 0;
    return o;
  };

  // ---------- audio ----------
  let node = null, loading = null, chain = null, analyser = null;
  let tone = null, toneLoading = null, toneSynth = null, toneFilter = null, toneGain = null, toneAnalyser = null;
  const unitCache = new Map();     // nome -> Promise<{module, bytes, info}>
  const unitsSent = new Set(), unitsReady = new Set(), unitErrors = [];
  let unitOpts = [["waves", "waves"], ["pluck", "pluck"]];
  const samplesSent = new Map(), samplesReady = new Set();   // riferimento -> Promise dell'invio al worklet

  function listUnits() {
    return fetch(new URL("units.json" + QS, LOGUE_DIR)).then(r => r.ok ? r.json() : { units: [] })
      .then(j => j.units || []).catch(() => []);
  }
  // Compila l'unita' e ne legge l'intestazione (nome e parametri) da un'istanza di prova.
  function unitModule(name) {
    if (!unitCache.has(name)) {
      const p = fetch(new URL(name + ".wasm" + QS, LOGUE_DIR)).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(async bytes => {
          const module = await WebAssembly.compile(bytes);
          const imports = {};
          for (const i of WebAssembly.Module.imports(module)) (imports[i.module] ||= {})[i.name] = () => 0;
          const e = (await WebAssembly.instantiate(module, imports)).exports;
          if (e._initialize) e._initialize();
          e.lu_init();
          const str = ptr => { const m = new Uint8Array(e.memory.buffer); let s = ""; while (m[ptr]) s += String.fromCharCode(m[ptr++]); return s; };
          const info = { name: str(e.lu_name()), params: [], str: (id, v) => str(e.lu_param_str(id, v)) };
          for (let i = 0; i < e.lu_num_params(); i++) {
            info.params.push({ id: i, name: str(e.lu_param_name(i)), min: e.lu_param_min(i), max: e.lu_param_max(i),
              init: e.lu_param_init(i), type: e.lu_param_type(i), frac: e.lu_param_frac(i) });
          }
          return { module, bytes, info };
        });
      p.catch(() => unitCache.delete(name));
      unitCache.set(name, p);
    }
    return unitCache.get(name);
  }
  async function sendUnit(name) {
    if (!node || !name || unitsSent.has(name)) return;
    unitsSent.add(name);
    try {
      const { bytes } = await unitModule(name);
      node.port.postMessage({ t: "unit", name, bytes: bytes.slice(0) });   // i byte: vedi loadUnit() nel worklet
    } catch (e) { unitsSent.delete(name); setStatus("synth: KORG unit " + name + " not available", "err"); }
  }

  // MULTI "Sample": il suono (AudioBuffer da index.html) diventa mono e va al worklet, che lo legge per ogni voce.
  function sampleData(ref) {
    if (typeof window.synthSampleBuffer !== "function") return Promise.reject(new Error("no sampler"));
    return window.synthSampleBuffer(ref).then(buf => {
      const len = Math.min(buf.length, Math.round(buf.sampleRate * SAMPLE_MAX_SEC)), data = new Float32Array(len);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const ch = buf.getChannelData(c);
        for (let i = 0; i < len; i++) data[i] += ch[i] / buf.numberOfChannels;
      }
      return { data, sr: buf.sampleRate, cut: len < buf.length };
    });
  }
  const sampleName = (ref, p = params()) => window.synthSampleInfo?.(ref)?.name || (ref === p.mSample && p.mSmpName) || ref.replace(/^\w+:(\w+\/)?/, "");
  function sendSample(ref) {
    if (!node || !ref) return Promise.resolve();
    if (samplesSent.has(ref)) return samplesSent.get(ref);
    const target = node;
    const sent = sampleData(ref).then(({ data, sr, cut }) => {
      if (target !== node) return;
      node.port.postMessage({ t: "sample", key: ref, data, sr }, [data.buffer]);
      if (cut) setStatus("synth: only the first " + SAMPLE_MAX_SEC + " s of " + sampleName(ref) + " are played");
    }).catch(() => { samplesSent.delete(ref); setStatus("synth: sample " + sampleName(ref) + " not available", "err"); });
    samplesSent.set(ref, sent);
    return sent;
  }

  function ensureAudio() {
    if (node) return Promise.resolve(node);
    if (loading) return loading;
    const ctx = actx();
    if (!ctx.audioWorklet) { setStatus("synth: this browser has no AudioWorklet", "err"); return Promise.reject(new Error("no worklet")); }
    loading = (async () => {
      await ctx.audioWorklet.addModule(WORKLET_URL);
      const p = params();
      const n = new AudioWorkletNode(ctx, "pm-synth", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: { params: workletParams(p), bpm: bpm() } });
      n.port.onmessage = e => {
        if (e.data.t === "unit-ready") unitsReady.add(e.data.name);
        if (e.data.t === "sample-ready") samplesReady.add(e.data.key);
        if (e.data.t === "unit-error") { unitsSent.delete(e.data.name); unitErrors.push(e.data); setStatus("synth: KORG unit " + e.data.name + " failed to load", "err"); }
      };
      chain = buildChain(ctx, n, synthOut(ctx));
      analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
      chain.out.connect(analyser);
      node = n;
      chain.apply(p, bpm(), masterVol());
      if (p.mType === "logue") sendUnit(p.mUnit);
      if (p.mType === "sample") sendSample(p.mSample);
      return n;
    })();
    loading.catch(err => { loading = null; console.error(err); setStatus("synth: the audio engine didn't load", "err"); });
    return loading;
  }
  // uscita: il canale "synth" del mixer del sito (pan, meter, limiter), altrimenti dritto all'uscita
  const synthOut = ctx => window.mixOut ? window.mixOut(ctx, "synth") : ctx.destination;
  // volume del synth nel mix (cursore "Vol. synth") per il volume generale
  const masterVol = () => (+el("masterVol").value || 0) / 100 * (+(el("synthVol")?.value ?? 100) || 0) / 100;

  function toneWave(w) { return w === "square" ? "square" : w === "tri" ? "triangle" : w === "saw" ? "sawtooth" : "sine"; }
  function toneFilterType(t) { return t === "hp12" ? "highpass" : t === "bp12" ? "bandpass" : "lowpass"; }
  function applyToneParams(p) {
    if (!toneSynth || !toneFilter || !toneGain) return;
    const now = actx().currentTime;
    toneSynth.set({ oscillator: { type: toneWave(p.o1Wave) }, envelope: {
      attack: envTime(p.aA), decay: envTime(p.aD), sustain: (p.aS || 0) / 100, release: envTime(p.aR),
    } });
    toneFilter.type = toneFilterType(p.fType);
    toneFilter.frequency.setTargetAtTime(20 * Math.pow(1000, p.cutoff / 100), now, 0.02);
    toneFilter.Q.setTargetAtTime(0.1 + p.reso / 12, now, 0.02);
    toneGain.gain.setTargetAtTime(masterVol() * (p.vol || 0) / 100 * (p.o1Lvl || 0) / 100, now, 0.02);
  }
  function loadTone() {
    if (window.Tone) return Promise.resolve(window.Tone);
    if (toneLoading) return toneLoading;
    toneLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script"); s.src = TONE_URL; s.async = true;
      s.onload = () => window.Tone ? resolve(window.Tone) : reject(new Error("Tone.js global missing"));
      s.onerror = () => reject(new Error("Tone.js failed to load"));
      document.head.appendChild(s);
    });
    toneLoading.catch(() => { toneLoading = null; });
    return toneLoading;
  }
  function stopCustom() {
    if (node) node.port.postMessage({ t: "alloff" });
    if (node) { node.disconnect(); node = null; }
    if (chain?.out) chain.out.disconnect();
    chain = null; loading = null; analyser = null;
    // il prossimo nodo parte vuoto: unita' e campioni vanno rimandati
    unitsSent.clear(); unitsReady.clear(); samplesSent.clear(); samplesReady.clear();
  }
  function stopTone() {
    const oldAnalyser = toneAnalyser;
    if (toneSynth) { try { toneSynth.releaseAll(); } catch (e) {} try { toneSynth.dispose(); } catch (e) {} }
    if (toneFilter) { try { toneFilter.dispose(); } catch (e) {} }
    if (toneGain) { try { toneGain.disconnect(); } catch (e) {} }
    if (toneAnalyser) { try { toneAnalyser.disconnect(); } catch (e) {} }
    toneSynth = toneFilter = toneGain = toneAnalyser = null;
    if (analyser === oldAnalyser) analyser = null;
  }
  async function ensureTone() {
    if (toneSynth) return toneSynth;
    const ctx = actx(); if (ctx.state === "suspended") await ctx.resume();
    const T = await loadTone();
    T.setContext(ctx);
    await T.start();
    tone = T;
    toneSynth = new T.PolySynth(T.Synth);
    toneFilter = new T.Filter({ type: "lowpass", frequency: 1200, Q: 1 });
    toneGain = ctx.createGain();
    toneAnalyser = ctx.createAnalyser(); toneAnalyser.fftSize = 1024;
    toneSynth.connect(toneFilter); toneFilter.connect(toneGain);
    toneGain.connect(toneAnalyser); toneAnalyser.connect(synthOut(ctx));
    analyser = toneAnalyser;
    applyToneParams(params());
    return toneSynth;
  }

  // Effetti dopo la voce, come i tre slot della logue: MOD (chorus), DELAY (ping-pong a tempo), REVERB.
  function buildChain(ctx, src, dest) {
    const G = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const pre = G(1), dry = G(1), sum = G(1), out = G(1);
    src.connect(pre); pre.connect(dry).connect(sum);
    // chorus stereo: due linee corte modulate da LFO lenti, una per lato
    const merger = ctx.createChannelMerger(2), chWet = G(0);
    [[0.011, 0.23, 0], [0.017, 0.29, 1]].forEach(([t, rate, ch]) => {
      const d = ctx.createDelay(0.05); d.delayTime.value = t;
      const lfo = ctx.createOscillator(), depth = G(0.0035);
      lfo.frequency.value = rate; lfo.connect(depth).connect(d.delayTime); lfo.start();
      pre.connect(d).connect(merger, 0, ch);
    });
    merger.connect(chWet).connect(sum);
    // delay ping-pong: sinistra -> destra -> sinistra, con un passa-basso nel giro
    const dSend = G(0), dL = ctx.createDelay(4), dR = ctx.createDelay(4), fb = G(0.35), damp = ctx.createBiquadFilter();
    damp.type = "lowpass"; damp.frequency.value = 3500;
    const dMerge = ctx.createChannelMerger(2), dOut = G(0.8);
    sum.connect(dSend).connect(dL);
    dL.connect(dR); dR.connect(damp).connect(fb).connect(dL);
    dL.connect(dMerge, 0, 0); dR.connect(dMerge, 0, 1);
    dMerge.connect(dOut).connect(out);
    // riverbero: risposta all'impulso sintetica (rumore stereo che decade in ~2,4 s scurendosi)
    const rSend = G(0), conv = ctx.createConvolver();
    const len = Math.round(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp += ((Math.random() * 2 - 1) - lp) * (0.85 - 0.8 * t);
        d[i] = lp * Math.pow(1 - t, 3.2) * (i < 64 ? i / 64 : 1);
      }
    }
    conv.buffer = ir;
    sum.connect(rSend).connect(conv).connect(out);
    sum.connect(out);
    out.connect(dest);
    return {
      out,
      apply(p, tempo, master) {
        const now = ctx.currentTime, set = (param, v) => param.setTargetAtTime(v, now, 0.02);
        const c = (p.chorus || 0) / 100;
        set(chWet.gain, c * 0.9); set(dry.gain, 1 - c * 0.35);
        const dt = Math.min(3.9, (DIV_BEATS[p.dTime] || 0.75) * 60 / tempo);
        set(dL.delayTime, dt); set(dR.delayTime, dt);
        set(fb.gain, clamp((p.dFb ?? 35) / 100, 0, 0.9)); set(dSend.gain, (p.delay || 0) / 100 * 0.7);
        set(rSend.gain, (p.reverb || 0) / 100 * 0.9);
        set(out.gain, master);
      },
    };
  }

  // Piu' modifiche nello stesso giro (trascinamento, preset) partono in un solo messaggio.
  // Non requestAnimationFrame: in una scheda in background non girerebbe e il suono resterebbe indietro.
  let pushQueued = false;
  function pushParams() {
    if (engineOf() === "tone") { if (toneSynth) applyToneParams(params()); return; }
    if (!node || pushQueued) return;
    pushQueued = true;
    queueMicrotask(() => {
      pushQueued = false;
      const p = params();
      node.port.postMessage({ t: "params", p: workletParams(p) });
      chain.apply(p, bpm(), masterVol());
      if (p.mType === "logue") sendUnit(p.mUnit);
      if (p.mType === "sample") sendSample(p.mSample);
    });
  }

  // ---------- sequencer ----------
  let noteSeq = 0, slideAt = -1, lastBpm = 0;
  // Note che partono allo step s del pattern, al tempo "time" (secondi del contesto audio).
  function eventsForStep(pat, s, time, p, into) {
    const slideIn = slideAt > 0 && Math.abs(slideAt - time) < 0.002;
    if (slideAt > 0 && slideAt < time + 0.002) slideAt = -1;
    for (const x of pat.synth || []) {
      if (x.s !== s) continue;
      let len = 0;
      for (let k = 0; k < x.l; k++) len += stepDur(s + k);
      const last = stepDur(s + x.l - 1);
      const id = "q" + (++noteSeq), n = clamp(x.n + (p.trans || 0), 0, 127);
      // lo slide tiene la nota fin dentro la successiva (legato); le altre si chiudono secondo il Gate
      const end = x.g ? time + len + Math.min(0.03, last * 0.5) : time + len - last * (1 - (p.gate ?? 75) / 100);
      into.push({ t: "on", time, n, v: x.a ? 1 : 0.72, id, sl: slideIn }, { t: "off", time: Math.max(time + 0.004, end), id });
      if (x.g) slideAt = time + len;
    }
  }
  // Chiamata da scheduler() per ogni step messo in coda.
  function step(pat, s, time) {
    if (!allowed || !pat || !pat.synth || !pat.synth.length || project.synth?.mute || (project.drumsSolo && !project.synth?.solo)) return;
    const p = params();
    if (engineOf() === "tone") {
      if (!toneSynth) { ensureTone().catch(() => {}); return; }
      const list = [];
      eventsForStep(pat, s, time, p, list);
      for (let i = 0; i < list.length; i += 2) {
        const on = list[i], off = list[i + 1];
        if (!on || on.t !== "on" || !off) continue;
        toneSynth.triggerAttackRelease(noteName(on.n), Math.max(0.004, off.time - on.time), on.time, on.v);
      }
      return;
    }
    if (!node) { ensureAudio().catch(() => {}); return; }
    const b = bpm();
    if (b !== lastBpm) { lastBpm = b; node.port.postMessage({ t: "bpm", bpm: b }); chain.apply(p, b, masterVol()); }
    const list = [];
    eventsForStep(pat, s, time, p, list);
    if (list.length) node.port.postMessage({ t: "ev", list });
  }
  function allOff() {
    slideAt = -1;
    held.clear(); paintKeys();
    if (toneSynth) { try { toneSynth.releaseAll(); } catch (e) {} }
    if (node) node.port.postMessage({ t: "alloff" });
  }

  // ---------- suonare dal vivo (tastiera del computer, tasti a schermo, MIDI) ----------
  const held = new Map();   // nota -> {t0, rec:{note, pat} se si sta registrando}
  function liveOn(n, vel = 0.8) {
    if (held.has(n)) return;
    const ctx = actx(); if (ctx.state === "suspended") ctx.resume();
    held.set(n, { t0: ctx.currentTime, rec: recording && playing ? recordNote(n, vel >= 0.99) : null });
    paintKeys();
    const ready = engineOf() === "tone" ? ensureTone() : ensureAudio();
    ready.then(nd => {
      if (!held.has(n)) return;
      const note = clamp(n + (params().trans || 0), 0, 127);
      if (engineOf() === "tone") nd.triggerAttack(noteName(note), actx().currentTime, vel);
      else nd.port.postMessage({ t: "ev", list: [{ t: "on", time: 0, n: note, v: vel, id: "k" + n }] });
    }).catch(() => {});
  }
  function liveOff(n) {
    const h = held.get(n);
    if (!h) return;
    held.delete(n);
    paintKeys();
    if (h.rec) {
      // la nota registrata dura quanto e' stato tenuto il tasto (almeno uno step)
      const steps = Math.round((actx().currentTime - h.t0) / (60 / bpm() / 4));
      h.rec.note.l = clamp(steps, 1, Math.max(1, h.rec.pat.len - h.rec.note.s));
      renderRoll();
    }
    if (toneSynth) { try { toneSynth.triggerRelease(noteName(clamp(n + (params().trans || 0), 0, 127))); } catch (e) {} }
    if (node) node.port.postMessage({ t: "ev", list: [{ t: "off", time: 0, id: "k" + n }] });
  }
  // Registrazione: come recordHit() della batteria, la nota va nello step piu' vicino a quello che suona.
  function recordNote(n, accent) {
    const pat = synthById(visible.synthId) || curSynth();
    if (!pat) return null;
    const now = actx().currentTime;
    let s = Math.max(0, visible.synthStep ?? 0), ref = null;
    for (const q of queue) { if (q.time > now) { ref = q; break; } }
    if (ref && ref.synthId === pat.id && (ref.time - now) < stepDur(visible.step) / 2) s = ref.synthStep;
    s = ((s % pat.len) + pat.len) % pat.len;
    ensure();
    const notes = pat.synth;
    const i = notes.findIndex(x => x.s === s && x.n === n);
    if (i >= 0) notes.splice(i, 1);
    const note = { s, n, l: 1, k: "rec", ...(accent ? { a: 1 } : {}) };   // k:"rec" = registrata: Clear recording le ritrova
    notes.push(note);
    renderRoll();
    return { note, pat };
  }

  // Tastiera del computer come la "Musical Typing" di Logic: A W S E D F T G Y H U J K O L P ;  Z/X ottava.
  const TYPING = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
    KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16 };
  const typingBase = () => (view.kbdOct + 2) * 12;
  const synthVisible = () => allowed && !el("panelSynth").hidden;
  function typingTarget(e) {
    if (!synthVisible() || e.metaKey || e.ctrlKey || e.altKey) return false;
    if (document.querySelector("dialog[open]") || !el("libOverlay").hidden || (el("synLib") && !el("synLib").hidden)) return false;
    const a = document.activeElement, tag = (a && a.tagName) || "";
    return !(tag === "INPUT" && !/^(range|checkbox|radio|button)$/.test(a.type) || tag === "SELECT" || tag === "TEXTAREA");
  }
  window.addEventListener("keydown", e => {
    if (!typingTarget(e)) return;
    if (e.code === "KeyZ" || e.code === "KeyX") {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) { view.kbdOct = clamp(view.kbdOct + (e.code === "KeyX" ? 1 : -1), 0, 7); saveView(); renderKeyboard(); }
      return;
    }
    if (e.code in TYPING) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) { const n = typingBase() + TYPING[e.code]; liveOn(n, e.shiftKey ? 1 : 0.8); follow(n); }
      return;
    }
    // nella vista Synth i tasti rimasti delle batterie non suonano i pad
    if (/^Key[A-Z]$|^Digit[1-4]$/.test(e.code)) e.stopImmediatePropagation();
  }, true);
  window.addEventListener("keyup", e => {
    if (!(e.code in TYPING)) return;
    const n = typingBase() + TYPING[e.code];
    if (held.has(n)) liveOff(n);
  }, true);
  window.addEventListener("blur", () => { for (const n of [...held.keys()]) liveOff(n); });

  // Tastiera MIDI: la gestisce engine/midi.js (tasti, pad e manopole), che chiama liveOn/liveOff e knob() qui sotto.
  function midiNote(n, vel) {
    if (!allowed) return;
    if (vel > 0) { liveOn(n, vel); follow(n); } else liveOff(n);
  }
  // Manopola MIDI -> parametro del synth (frac 0..1 sull'intervallo del parametro). Un solo passo di annulla
  // per giro: si registra quando la manopola riparte dopo una pausa.
  let knobAt = 0;
  function knob(k, frac) {
    const spec = SPEC[k];
    if (!allowed || !spec || spec.opts) return null;
    const lo = spec.min ?? 0, hi = spec.max ?? 100, v = Math.round(lo + clamp(frac, 0, 1) * (hi - lo));
    const now = Date.now();
    if (now - knobAt > 700) pushUndo();
    knobAt = now;
    setParam(k, v, false);
    const r = built && el("synParams").querySelector(`input[data-k="${k}"]`);
    if (r) { r.value = v; if (r.nextElementSibling) r.nextElementSibling.value = (spec.fmt || String)(v); }
    return spec.label + " " + (spec.fmt || String)(v);
  }
  // Parametri a cursore che una manopola puo' comandare (per la vista MIDI).
  const knobTargets = () => SECTIONS.flatMap(sec => sec.params.filter(p => !p.opts).map(p => ({ k: p.k, label: p.label, section: sec.title })));

  // ---------- generatori (nella tonalita' e scala scelte) ----------
  // Ogni generatore riceve il pattern e restituisce le note {s, n, l, a?, g?}. Seguono il giro di accordi scelto
  // (gradi della scala), la densita' (rndD) e l'ottava; runGenerator() pulisce, somma o sostituisce la linea.
  const scaleNotes = () => SCALES[scaleOf()][1];
  const degree = (d, root) => {           // grado della scala (anche negativo o oltre l'ottava) -> nota MIDI
    const sc = scaleNotes(), L = sc.length;
    return root + sc[((d % L) + L) % L] + 12 * Math.floor(d / L);
  };
  let dens = 1;                           // densita' del generatore in corso: 0.55 rada, 1 normale, 1.5 fitta
  const rnd = p => Math.random() < p;
  const rndD = p => Math.random() < Math.min(0.97, p * dens);
  const pickW = pairs => { let t = pairs.reduce((a, [, w]) => a + w, 0) * Math.random(); for (const [v, w] of pairs) { t -= w; if (t <= 0) return v; } return pairs[0][0]; };
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const bassRoot = () => { let r = 36 + keyOf(); if (r > 43) r -= 12; return r; };
  const midRoot = () => { let r = 48 + keyOf(); if (r > 55) r -= 12; return r; };
  const leadRoot = () => { let r = 60 + keyOf(); if (r > 67) r -= 12; return r; };
  // gradi (relativi alla fondamentale dell'accordo) che formano la triade e la settima nella scala scelta
  const is7 = () => scaleNotes().length === 7;
  function triad(d, root) {
    if (is7()) return [degree(d, root), degree(d + 2, root), degree(d + 4, root)];
    const r = degree(d, root);
    return [r, r + (scaleNotes().includes(4) ? 4 : 3), r + 7];
  }
  function seventh(d, root) {
    if (is7()) return [...triad(d, root), degree(d + 6, root)];
    const t = triad(d, root);
    return [...t, t[0] + (scaleNotes().includes(11) && !scaleNotes().includes(10) ? 11 : 10)];
  }
  // Gli step con la cassa nel pattern di batteria scelto in Drum Grid, ripetuto sulla lunghezza del pattern del synth.
  function kickSteps(pat) {
    const drum = curPattern(), kicks = project.tracks.filter(t => /kick|bd/i.test((SAMPLES[t.sampleIndex] || {}).name || ""));
    const on = new Set();
    for (const t of kicks) for (let s = 0; s < pat.len; s++) if ((drum.grid[t.id] || [])[stepIdx(drum, t.id, s % drum.len, 0)]) on.add(s);
    return on;
  }
  // Allunga ogni nota fino alla successiva, entro "max" step.
  function legatoFill(notes, len, max) {
    notes.sort((a, b) => a.s - b.s);
    notes.forEach((x, i) => { let j = i + 1; while (notes[j] && notes[j].s === x.s) j++; const next = notes[j] ? notes[j].s : len; x.l = clamp(next - x.s, 1, max); });
    return notes;
  }
  const chordAt = (s, root, d, len, fn = triad) => fn(d, root).map(n => ({ s, n, l: len }));

  const PROGRESSIONS = {
    "1-6-4-5": ["1–6–4–5", [0, 5, 3, 4]], "1-4-5-1": ["1–4–5–1", [0, 3, 4, 0]], "1-5-6-4": ["1–5–6–4", [0, 4, 5, 3]],
    "1-7-6-7": ["1–7–6–7", [0, 6, 5, 6]], "1-4-1-5": ["1–4–1–5", [0, 3, 0, 4]], "2-5-1-1": ["2–5–1–1", [1, 4, 0, 0]],
    "1": ["1 (one chord)", [0]],
  };
  const DENSITY = { sparse: 0.55, normal: 1, busy: 1.5 };
  const genOpts = () => Object.assign({ prog: "1-6-4-5", dens: "normal", oct: 0, add: false, last: "" }, view.gen || {});
  // Giro di accordi sul pattern: un accordo ogni 8 step (16 step: i primi due, 32 step: tutti e quattro).
  function chordPlan(pat) {
    const prog = (PROGRESSIONS[genOpts().prog] || PROGRESSIONS["1-6-4-5"])[1];
    const count = Math.max(1, Math.min(prog.length, Math.floor(pat.len / 8)));
    const seg = Math.max(1, Math.floor(pat.len / count));
    const at = s => prog[Math.min(count - 1, Math.floor(s / seg)) % prog.length];
    return { seg, at, starts: Array.from({ length: count }, (_, i) => i * seg), next: s => at(Math.min(pat.len - 1, (Math.floor(s / seg) + 1) * seg)) };
  }
  // Arpeggio: "order" sceglie la nota dell'accordo (indice su 2 ottave) a ogni passo.
  function arpeggio(pat, every, order, fn = triad) {
    const root = midRoot(), plan = chordPlan(pat), out = [];
    let k = 0;
    for (let s = 0; s < pat.len; s += every) {
      if (plan.starts.includes(s)) k = 0;
      const tones = fn(plan.at(s), root), all = [...tones, ...tones.map(n => n + 12)];
      if (s % 4 !== 0 && !rndD(0.9)) { k++; continue; }
      out.push({ s, n: all[order(k++, all.length)], l: every, ...(s % 4 === 0 ? { a: 1 } : {}) });
    }
    return out;
  }
  const GEN_GROUPS = ["Bass", "Chords & pads", "Arpeggios", "Melody"];
  const GENERATORS = {
    bass: { group: "Bass", label: "On the kick", hint: "follows the kick drum of the pattern open in Drum Grid", run(pat) {
      const root = bassRoot(), plan = chordPlan(pat), kicks = kickSteps(pat), out = [];
      if (!kicks.size) for (let s = 0; s < pat.len; s += 4) kicks.add(s);
      for (let s = 0; s < pat.len; s++) {
        const c = plan.at(s);
        if (kicks.has(s)) out.push({ s, n: degree(c, root), l: 1, ...(s % 16 === 0 ? { a: 1 } : {}) });
        else if (s % 2 === 0 && rndD(0.3)) out.push({ s, n: degree(c + pickW([[0, 3], [4, 2], [7, 2], [2, 1], [-1, 1]]), root), l: 1 });
        else if (s % 16 === 15 && rndD(0.45)) out.push({ s, n: degree(c + pickW([[-1, 1], [1, 1], [6, 1]]), root), l: 1 });
      }
      return legatoFill(out, pat.len, 2);
    } },
    acid: { group: "Bass", label: "Acid line (303)", hint: "16ths with accents, slides and octave jumps", run(pat) {
      const root = bassRoot(), plan = chordPlan(pat), out = [];
      for (let s = 0; s < pat.len; s++) {
        if (s > 0 && !rndD(0.7)) continue;
        const c = plan.at(s);
        let n = s === 0 || plan.starts.includes(s) ? degree(c, root) : degree(c + pickW([[0, 5], [2, 2], [4, 2], [3, 1], [6, 1], [7, 2], [-2, 1]]), root);
        if (s > 0 && rnd(0.22)) n += 12;
        out.push({ s, n, l: 1, ...(rnd(0.25) ? { a: 1 } : {}), ...(s < pat.len - 1 && rnd(0.2) ? { g: 1 } : {}) });
      }
      return out;
    } },
    offbeat: { group: "Bass", label: "Offbeat (house)", hint: "between the kicks, on the and of every beat", run(pat) {
      const root = bassRoot(), plan = chordPlan(pat), out = [];
      for (let s = 0; s < pat.len; s++) {
        const c = plan.at(s);
        if (s % 4 === 2) out.push({ s, n: degree(c, root) + (rnd(0.2) ? 12 : 0), l: 1, ...(s % 8 === 2 ? { a: 1 } : {}) });
        else if (s % 4 === 3 && rndD(0.18)) out.push({ s, n: degree(c + pick([0, 4, 7]), root), l: 1 });
      }
      return out;
    } },
    rolling: { group: "Bass", label: "Rolling 16ths (techno)", hint: "three 16ths after every kick", run(pat) {
      const root = bassRoot(), plan = chordPlan(pat), out = [];
      for (let s = 0; s < pat.len; s++) {
        if (s % 4 === 0) continue;
        if (!rndD(0.8) && s % 4 !== 1) continue;
        const c = plan.at(s), turn = s % 16 >= 12 && rnd(0.35);
        out.push({ s, n: degree(c + (turn ? pick([4, 2, 7]) : 0), root), l: 1, ...(s % 4 === 1 ? { a: 1 } : {}) });
      }
      return out;
    } },
    octave: { group: "Bass", label: "Octave bounce (disco)", hint: "root and octave on 8ths", run(pat) {
      const root = bassRoot(), plan = chordPlan(pat), out = [];
      for (let s = 0; s < pat.len; s += 2) {
        const r = degree(plan.at(s), root), up = s % 4 === 2;
        out.push({ s, n: up ? r + 12 : r, l: 1, ...(up ? { a: 1 } : {}) });
        if (!up && rndD(0.12)) out.push({ s: s + 1, n: r + 12, l: 1 });
      }
      return out;
    } },
    funk: { group: "Bass", label: "Syncopated (funk)", hint: "16th syncopation, octaves and slides", run(pat) {
      const root = bassRoot(), plan = chordPlan(pat), out = [];
      for (let s = 0; s < pat.len; s++) {
        const c = plan.at(s), r = degree(c, root), p = [0.95, 0.22, 0.4, 0.5][s % 4];
        if (s !== 0 && !plan.starts.includes(s) && !rndD(p)) continue;
        const n = s % 4 === 0 ? r : pickW([[r, 3], [r + 12, 3], [degree(c + 4, root), 2], [degree(c + 6, root) - 12, 1]]);
        out.push({ s, n, l: 1, ...(s % 8 === 0 ? { a: 1 } : {}), ...(n === r + 12 && s < pat.len - 1 && rnd(0.3) ? { g: 1 } : {}) });
      }
      return out;
    } },
    walking: { group: "Bass", label: "Walking (quarters)", hint: "one note per beat, walking to the next chord", run(pat) {
      const root = bassRoot(), plan = chordPlan(pat), out = [];
      let d = 0;
      for (let s = 0; s < pat.len; s += 4) {
        const c = plan.at(s), nextStart = plan.starts.includes(s + 4) || s + 4 >= pat.len;
        if (plan.starts.includes(s)) d = c;
        else if (nextStart) { const t = plan.next(s); d = t + (d > t ? 1 : -1); }
        else d = clamp(d + pickW([[1, 3], [-1, 2], [2, 2], [-2, 1]]), c - 3, c + 7);
        out.push({ s, n: degree(d, root), l: 3, ...(s === 0 ? { a: 1 } : {}) });
        if (rndD(0.15) && s + 3 < pat.len) out.push({ s: s + 3, n: degree(d + pick([1, -1]), root), l: 1 });
      }
      return out;
    } },
    sub: { group: "Bass", label: "Long sub notes", hint: "one held root for every chord", run(pat) {
      const root = bassRoot(), plan = chordPlan(pat), out = [];
      for (const st of plan.starts) out.push({ s: st, n: degree(plan.at(st), root), l: plan.seg });
      return out;
    } },

    chords: { group: "Chords & pads", label: "Chords (held)", hint: "triads held for the whole chord", run(pat) {
      const root = midRoot(), plan = chordPlan(pat);
      return plan.starts.flatMap(st => chordAt(st, root, plan.at(st), plan.seg));
    } },
    pad7: { group: "Chords & pads", label: "Pad with 7ths", hint: "four-note chords, softer voicing", run(pat) {
      const root = midRoot(), plan = chordPlan(pat);
      return plan.starts.flatMap(st => chordAt(st, root, plan.at(st), plan.seg, seventh));
    } },
    stabs: { group: "Chords & pads", label: "Offbeat stabs (house)", hint: "short chords on the and of every beat", run(pat) {
      const root = midRoot(), plan = chordPlan(pat), out = [];
      for (let s = 0; s < pat.len; s++) {
        const hit = s % 4 === 2 ? (s % 8 === 2 || rndD(0.8)) : (s % 4 === 3 && rndD(0.15));
        if (!hit) continue;
        chordAt(s, root, plan.at(s), 1).forEach((x, i) => out.push(i === 0 && s % 8 === 2 ? { ...x, a: 1 } : x));
      }
      return out;
    } },
    dub: { group: "Chords & pads", label: "Dub chord (sparse)", hint: "one minor-7th stab here and there: turn up the delay", run(pat) {
      const root = midRoot(), plan = chordPlan(pat), out = [];
      for (let s = 0; s < pat.len; s++) {
        const b = s % 16, hit = b === 2 || (b === 10 && rndD(0.55)) || (b === 7 && rndD(0.2)) || (b === 13 && rndD(0.15));
        if (hit) out.push(...chordAt(s, root, plan.at(s), 1, seventh));
      }
      return out;
    } },
    gate: { group: "Chords & pads", label: "Trance gate", hint: "the chord chopped in a 16th rhythm", run(pat) {
      const root = midRoot(), plan = chordPlan(pat), out = [];
      const tpl = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1];
      for (let s = 0; s < pat.len; s++) {
        if (!tpl[s % 16] && !rndD(0.12)) continue;
        if (tpl[s % 16] && dens < 1 && !rndD(0.9)) continue;
        chordAt(s, root, plan.at(s), 1).forEach((x, i) => out.push(i === 0 && s % 4 === 0 ? { ...x, a: 1 } : x));
      }
      return out;
    } },

    arpUp: { group: "Arpeggios", label: "Up (16ths)", run: pat => arpeggio(pat, 1, (k, L) => k % (L - 2)) },
    arpDown: { group: "Arpeggios", label: "Down (16ths)", run: pat => arpeggio(pat, 1, (k, L) => (L - 3) - (k % (L - 2))) },
    arpUpDown: { group: "Arpeggios", label: "Up and down", run: pat => arpeggio(pat, 1, k => [0, 1, 2, 3, 2, 1][k % 6]) },
    arp8: { group: "Arpeggios", label: "8ths, two octaves", run: pat => arpeggio(pat, 2, (k, L) => k % L) },
    arp7: { group: "Arpeggios", label: "7th chord, up", run: pat => arpeggio(pat, 1, (k, L) => k % (L - 3), seventh) },
    arpRnd: { group: "Arpeggios", label: "Random order", run: pat => arpeggio(pat, 1, (k, L) => Math.floor(Math.random() * L)) },

    melody: { group: "Melody", label: "Call and response", hint: "a short phrase, answered with a different ending", run(pat) {
      const root = leadRoot(), plan = chordPlan(pat), M = Math.max(4, Math.min(8, pat.len / 2)), out = [];
      const rhythm = [0], degs = [pick([0, 2, 4])];
      for (let s = 1; s < M; s++) if (s % 2 === 0 ? rndD(0.55) : rndD(0.2)) rhythm.push(s);
      for (let i = 1; i < rhythm.length; i++) degs.push(clamp(degs[i - 1] + pickW([[1, 3], [-1, 3], [2, 1], [-2, 1], [0, 1]]), -2, 9));
      for (let start = 0, k = 0; start < pat.len; start += M, k++) {
        const c = plan.at(start), answer = k % 2 === 1;
        rhythm.forEach((r, i) => {
          if (start + r >= pat.len) return;
          let d = degs[i] + c;
          if (answer && i === rhythm.length - 1) d = c + pick([0, 2, 4, 7]);          // la risposta chiude su una nota dell'accordo
          else if (answer && i === rhythm.length - 2 && rnd(0.6)) d += pick([1, -1]);
          out.push({ s: start + r, n: degree(d, root), l: 1, ...(i === 0 ? { a: 1 } : {}) });
        });
      }
      return legatoFill(out, pat.len, 3);
    } },
    riff: { group: "Melody", label: "Repeated riff", hint: "a 4-step figure repeated over the chords", run(pat) {
      const root = leadRoot(), plan = chordPlan(pat), out = [];
      const cell = [0, 1, 2, 3].map(i => (i === 0 || rndD(0.5)) ? pick([0, 2, 4, 7, 4]) : null);
      for (let s = 0; s < pat.len; s++) {
        let d = cell[s % 4];
        if (s % 16 >= 12 && s % 4 === 3 && rnd(0.5)) d = pick([5, 6, -1]);   // variazione a fine battuta
        if (d === null || d === undefined) continue;
        out.push({ s, n: degree(plan.at(s) + d, root), l: 1, ...(s % 4 === 0 ? { a: 1 } : {}) });
      }
      return out;
    } },
    lead: { group: "Melody", label: "Long-note lead", hint: "few held notes on the chord tones", run(pat) {
      const root = leadRoot(), plan = chordPlan(pat), out = [];
      for (let s = 0; s < pat.len; s += 2) {
        if (!(plan.starts.includes(s) || (s % 4 === 0 ? rndD(0.35) : rndD(0.12)))) continue;
        out.push({ s, n: degree(plan.at(s) + pick([0, 2, 4, 4, 7]), root), l: 1, ...(plan.starts.includes(s) ? { a: 1 } : {}), ...(rnd(0.2) ? { g: 1 } : {}) });
      }
      return legatoFill(out, pat.len, 8);
    } },
  };
  // Note pulite di un generatore per un pattern lungo len (opzioni: giro, densita', ottava di genOpts()).
  function generateNotes(k, len) {
    const g = GENERATORS[k], o = genOpts(), shift = 12 * (+o.oct || 0), pat = { len, synth: [] };
    dens = DENSITY[o.dens] || 1;
    let notes = [];
    try {
      for (let tries = 0; tries < 6 && !notes.length; tries++)
        notes = g.run(pat).map(x => ({ ...x, n: x.n + shift })).filter(x => x.n >= 0 && x.n <= 127 && x.s >= 0 && x.s < len);
    } finally { dens = 1; }
    // k: il generatore che ha scritto la nota. Serve al menu Generate per accendere le variazioni attive e toglierle.
    notes.forEach(x => { x.l = clamp(Math.round(x.l || 1), 1, len - x.s); if (x.g && x.s + x.l >= len) delete x.g; x.k = k; });
    return notes.sort((a, b) => a.s - b.s || a.n - b.n);
  }
  // Le variazioni attive nel pattern aperto: i generatori di cui restano note.
  const activeGens = () => new Set(curSynth().synth.map(x => x.k).filter(k => GENERATORS[k]));
  // Spegne una variazione: toglie dal pattern le note che quel generatore ha scritto (il resto non si tocca).
  function stopGenerator(k) {
    const g = GENERATORS[k], pat = curSynth(); if (!g || !pat.synth.some(x => x.k === k)) return;
    pushUndo();
    pat.synth = pat.synth.filter(x => x.k !== k);
    renderRoll();
    setStatus(`synth: ${g.group.toLowerCase()} · ${g.label.toLowerCase()} off`);
  }
  function runGenerator(k) {
    const g = GENERATORS[k]; if (!g) return;
    const o = genOpts(), pat = curSynth();
    let notes = generateNotes(k, pat.len);
    pushUndo(); ensure();
    // in aggiunta: un nuovo giro dello stesso generatore prende il posto del suo giro precedente, non ci si somma
    if (o.add) { const key = x => x.s + ":" + x.n, fresh = new Set(notes.map(key)); notes = pat.synth.filter(x => x.k !== k && !fresh.has(key(x))).concat(notes); }
    pat.synth = notes.sort((a, b) => a.s - b.s || a.n - b.n);
    view.gen = { ...o, last: k }; saveView(); paintGen();
    centerOn(pat); renderRoll();
    setStatus(`synth: ${g.group.toLowerCase()} · ${g.label.toLowerCase()} in ${NOTE_NAMES[keyOf()]} ${SCALES[scaleOf()][0].toLowerCase()}${o.add ? " (added)" : ""}`);
  }
  // ---------- Browse: libreria di suggerimenti dai generatori (come Browse… dei pattern di batteria) ----------
  let libItems = [], libPreview = null;
  const libOpts = () => Object.assign({ type: "*", len: curSynth().len }, view.lib || {});
  function libSuggest() {
    const o = libOpts(), keys = Object.keys(GENERATORS);
    const pickKeys = o.type === "*" ? keys.slice().sort(() => Math.random() - 0.5).slice(0, 8) : Array(8).fill(o.type);
    libItems = pickKeys.filter(k => GENERATORS[k]).map(k => ({ k, len: o.len, notes: generateNotes(k, o.len) }));
    renderLib();
  }
  function libSelect(id, pairs, v) {
    return `<select id="${id}">${pairs.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  }
  function buildLib() {
    if (el("synLib")) return;
    const d = document.createElement("div");
    d.className = "overlay"; d.id = "synLib"; d.hidden = true;
    d.innerHTML = `<div class="modal" role="dialog" aria-label="Synth pattern library">
      <div class="modal-head"><h3>Synth pattern library</h3><span class="tiny" id="synLibInfo"></span><button class="x" id="synLibClose" type="button" aria-label="Close">&times;</button></div>
      <div class="flexline" id="synLibOpts" style="margin-bottom:9px;"></div>
      <p class="syn-note" id="synLibKey" style="margin:0 0 11px;"></p>
      <div class="lib-list" id="synLibList"></div></div>`;
    document.body.appendChild(d);
    d.onclick = e => { if (e.target === d) closeLib(); };
    el("synLibClose").onclick = closeLib;
    el("synLibOpts").onchange = () => {
      view.lib = { type: el("synLibType").value, len: +el("synLibLen").value };
      view.gen = { ...genOpts(), prog: el("synLibProg").value, dens: el("synLibDens").value, oct: +el("synLibOct").value };
      saveView(); if (built) el("synGen").innerHTML = genMenuHtml();
      libSuggest();
    };
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !el("synLib").hidden) closeLib(); });
  }
  function openLib() {
    buildLib();
    const o = libOpts(), g = genOpts();
    const typeOpts = `<option value="*"${o.type === "*" ? " selected" : ""}>All kinds</option>` + GEN_GROUPS.map(gr => `<optgroup label="${esc(gr)}">${Object.entries(GENERATORS).filter(([, x]) => x.group === gr)
      .map(([k, x]) => `<option value="${k}"${k === o.type ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</optgroup>`).join("");
    el("synLibOpts").innerHTML = `<label class="fld">Type <select id="synLibType">${typeOpts}</select></label>
      <label class="fld">Chords ${libSelect("synLibProg", Object.entries(PROGRESSIONS).map(([k, [l]]) => [k, l]), g.prog)}</label>
      <label class="fld">Density ${libSelect("synLibDens", [["sparse", "Sparse"], ["normal", "Normal"], ["busy", "Busy"]], g.dens)}</label>
      <label class="fld">Octave ${libSelect("synLibOct", [[-1, "−1"], [0, "0"], [1, "+1"]], g.oct)}</label>
      <label class="fld">Steps ${libSelect("synLibLen", [[8, "8"], [16, "16"], [32, "32"]], o.len)}</label>
      <button type="button" id="synLibMore" class="mini primary" title="8 new suggestions with the same settings">↻ More suggestions</button>`;
    el("synLibMore").onclick = libSuggest;
    el("synLibKey").textContent = `In ${NOTE_NAMES[keyOf()]} ${SCALES[scaleOf()][0].toLowerCase()}, with the current sound. Key and scale are in Notes. Load replaces the notes of "${curSynth().name}", + Add makes a new synth pattern.`;
    el("synLib").hidden = false;
    libSuggest();
  }
  function closeLib() { stopPreview(); if (el("synLib")) el("synLib").hidden = true; }
  function renderLib() {
    stopPreview();
    const list = el("synLibList"); list.innerHTML = "";
    el("synLibInfo").textContent = `${libItems.length} suggestions`;
    libItems.forEach(item => {
      const g = GENERATORS[item.k], row = document.createElement("div");
      row.className = "lib-item";
      const play = document.createElement("button"); play.type = "button"; play.className = "lib-play"; play.textContent = "▶"; play.title = "listen";
      play.onclick = () => libPreview && libPreview.item === item ? stopPreview() : startPreview(item, row);
      const meta = document.createElement("div"); meta.className = "lib-meta";
      meta.innerHTML = `<div class="lib-name">${esc(g.label)}</div><div class="lib-tag">${esc(g.group)} · ${item.len} step · ${item.notes.length} notes</div>` + (g.hint ? `<div class="lib-ref">${esc(g.hint)}</div>` : "");
      const mini = document.createElement("div"); mini.className = "lib-mini";
      const prev = document.createElement("div"); prev.className = "syn-prev"; prev.style.setProperty("--synth-color", "var(--accent)");
      const ns = item.notes, lo = Math.min(...ns.map(n => n.n)), hi = Math.max(...ns.map(n => n.n)), span = Math.max(12, hi - lo + 1);
      ns.forEach(n => { const i = document.createElement("i"); i.style.left = `${n.s / item.len * 100}%`; i.style.width = `calc(${n.l / item.len * 100}% - 1px)`; i.style.top = `${(1 - (n.n - lo + 0.5) / span) * 100}%`; prev.appendChild(i); });
      mini.appendChild(prev);
      const acts = document.createElement("div"); acts.className = "lib-acts";
      const load = document.createElement("button"); load.type = "button"; load.className = "mini primary"; load.textContent = "Replace pattern";
      load.title = "replace the notes of the synth pattern you are editing";
      load.onclick = () => {
        const sp = curSynth(); pushUndo(); ensure();
        sp.len = item.len; sp.synth = item.notes.map(n => ({ ...n }));
        closeLib(); paintPatternBar(); centerOn(sp); renderRoll(); setStatus(`synth: ${g.label.toLowerCase()} loaded in ${sp.name}`);
      };
      const add = document.createElement("button"); add.type = "button"; add.className = "mini"; add.textContent = "Add as new";
      add.title = "add it as a new synth pattern";
      add.onclick = () => {
        pushUndo(); ensure();
        const sp = makeSynthPattern(g.label, item.len); sp.synth = item.notes.map(n => ({ ...n }));
        project.synthPatterns.push(sp); closeLib(); selectSynth(sp.id); setStatus("new synth pattern: " + sp.name);
      };
      acts.append(load, add);
      row.append(play, meta, mini, acts);
      list.appendChild(row);
    });
  }
  // Ascolto di un suggerimento: gira da solo col suono attuale, finche' non lo fermi o parte il Play.
  function startPreview(item, row) {
    stopPreview();
    if (playing) stop();
    const pat = { len: item.len, synth: item.notes };
    libPreview = { item, row, timer: null };
    row.classList.add("playing"); row.querySelector(".lib-play").textContent = "■";
    const me = libPreview;
    (engineOf() === "tone" ? ensureTone() : ensureAudio()).then(() => {
      if (libPreview !== me) return;
      let s = 0, t = actx().currentTime + 0.08;
      me.timer = setInterval(() => {
        if (playing) { stopPreview(); return; }
        while (t < actx().currentTime + 0.12) { step(pat, s, t); t += stepDur(s); s = (s + 1) % pat.len; }
      }, 25);
    }).catch(() => stopPreview());
  }
  function stopPreview() {
    if (!libPreview) return;
    clearInterval(libPreview.timer);
    libPreview.row.classList.remove("playing");
    const b = libPreview.row.querySelector(".lib-play"); if (b) b.textContent = "▶";
    libPreview = null; allOff();
  }

  // ---------- gestione dei preset salvati (My presets…) ----------
  // I suoni salvati in questo browser per il motore scelto: ascolto, uso, rinomina, cancella.
  // L'ascolto carica il suono nel synth per sentirlo (anche dalla tastiera o col Play acceso); chiudendo senza
  // "Use" torna il suono che c'era. pm: {had, orig:{preset, params}, heard, used} mentre la finestra e' aperta.
  let pm = null;
  const SYNC_NOTE = { synced: "Synced with your account ✓ (the same presets on the website and in the app).",
    local: "Saved in this browser only: sign in with a registered account to sync them with the website and the app.",
    error: "Sync failed: the presets are safe here and will sync at the next try." };
  const cloneJson = o => JSON.parse(JSON.stringify(o));
  function applySound(name, src) {
    const sy = ensure(); sy.preset = name; sy.params = src ? cloneJson(src) : presetParams(name);
    pushParams(); renderParams(); paintTop();
    if (params().mType === "logue") primeUnit();
  }
  function restoreSound() {
    if (!pm.had) { delete project.synth; pushParams(); renderParams(); paintTop(); }
    else applySound(pm.orig.preset, pm.orig.params);
  }
  function buildPresets() {
    if (el("synPresets")) return;
    const d = document.createElement("div");
    d.className = "overlay"; d.id = "synPresets"; d.hidden = true;
    d.innerHTML = `<div class="modal" role="dialog" aria-label="Saved synth presets">
      <div class="modal-head"><h3>My presets</h3><span class="tiny" id="synPresetsInfo"></span><button class="x" id="synPresetsClose" type="button" aria-label="Close">&times;</button></div>
      <p class="syn-note" id="synPresetsNote" style="margin:0 0 11px;"></p>
      <div class="lib-list" id="synPresetsList"></div></div>`;
    document.body.appendChild(d);
    d.onclick = e => { if (e.target === d) closePresets(); };
    el("synPresetsClose").onclick = () => closePresets();
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !el("synPresets").hidden && !document.querySelector("dialog[open]")) closePresets(); });
  }
  function openPresets() {
    buildPresets();
    pm = { had: !!project.synth, orig: project.synth ? cloneJson({ preset: project.synth.preset, params: project.synth.params }) : null, heard: false, used: false };
    el("synPresets").hidden = false;
    renderPresets();
    syncPresets();
  }
  function closePresets() {
    if (!pm) return;
    if (pm.heard && !pm.used) restoreSound();      // solo ascoltato: torna il suono di prima
    pm = null; el("synPresets").hidden = true;
  }
  function renderPresets() {
    const all = userPresets(), names = Object.keys(all).sort((a, b) => a.localeCompare(b)), list = el("synPresetsList");
    const tone = engineOf() === "tone", inUse = pm.orig?.preset;
    el("synPresetsInfo").textContent = `${names.length} saved`;
    el("synPresetsNote").textContent = `Sounds saved in this browser for ${tone ? "the Tone.js engine" : "the KORG and Custom engines"}`
      + ` (switch Engine to see ${tone ? "the KORG and Custom ones" : "the Tone.js ones"}). ▶ loads a sound so you can hear it, also from the keyboard; closing without Use brings back the sound you had. ${SYNC_NOTE[presetSyncState]}`;
    list.innerHTML = names.length ? "" : `<p class="syn-note">No saved presets yet: shape a sound, then press Save preset.</p>`;
    names.forEach(name => {
      const row = document.createElement("div"); row.className = "lib-item" + (name === inUse ? " current" : "");
      const mk = (label, cls, title, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label; b.title = title; b.onclick = fn; return b; };
      const play = mk("▶", "lib-play", "listen to this sound", () => {
        applySound(name); pm.heard = true; auditionChord();
        list.querySelectorAll(".lib-item.playing").forEach(x => x.classList.remove("playing"));
        row.classList.add("playing"); setTimeout(() => row.classList.remove("playing"), 600);
      });
      play.setAttribute("aria-label", "Listen to " + name);
      const meta = document.createElement("div"); meta.className = "lib-meta";
      meta.innerHTML = `<div class="lib-name">${esc(name)}</div><div class="lib-tag">${tone ? "Tone.js" : all[name].mType === "logue" ? "KORG logue" : "Custom"}${name === inUse ? " · sound of this project" : ""}</div>`;
      const acts = document.createElement("div"); acts.className = "syn-preset-acts";
      acts.append(
        mk("Use", "mini primary", "use this sound in the project and close", () => {
          if (pm.heard) restoreSound();           // l'annulla deve riportare al suono di prima, non a un ascolto
          pushUndo(); applySound(name); pm.used = true; closePresets(); auditionChord(); setStatus("preset loaded: " + name);
        }),
        mk("Rename", "mini", "rename this preset", async () => {
          const next = await ask({ title: "Rename synth preset", message: `New name for "${name}".`, ok: "Rename", input: name });
          if (next === null || !next.trim() || !pm) return;
          const clean = next.trim().slice(0, 40), store = userPresets();
          if (clean === name || !store[name]) return;
          if (PRESETS[clean] || TONE_PRESETS[clean]) { setStatus("that name belongs to a factory preset", "err"); return; }
          if (store[clean]) { setStatus("there is already a preset called " + clean, "err"); return; }
          store[clean] = store[name]; delete store[name]; writeUserPresets(store);
          if (pm.orig && pm.orig.preset === name) pm.orig.preset = clean;
          if (project.synth && project.synth.preset === name) project.synth.preset = clean;
          paintTop(); renderPresets(); setStatus("preset renamed: " + clean);
        }),
        mk("Delete", "mini danger", "delete this preset from this browser", async () => {
          if (!await ask({ title: "Delete preset", message: `Delete "${name}" from this browser? A project that uses this sound keeps it.`, ok: "Delete", danger: true }) || !pm) return;
          const store = userPresets(); delete store[name]; writeUserPresets(store);
          paintTop(); renderPresets(); setStatus("preset deleted: " + name);
        }));
      row.append(play, meta, acts);
      list.appendChild(row);
    });
  }

  function genMenuHtml() {
    const o = genOpts(), on = activeGens(), sel = (id, pairs, v) => `<select id="${id}">${pairs.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    return `<div class="syn-gen-opts">
        <label>Chords ${sel("synGenProg", Object.entries(PROGRESSIONS).map(([k, [l]]) => [k, l]), o.prog)}</label>
        <label>Density ${sel("synGenDens", [["sparse", "Sparse"], ["normal", "Normal"], ["busy", "Busy"]], o.dens)}</label>
        <label>Octave ${sel("synGenOct", [[-1, "−1"], [0, "0"], [1, "+1"]], o.oct)}</label>
        <label class="syn-gen-add"><input type="checkbox" id="synGenAdd"${o.add ? " checked" : ""}> Add to the notes already there (layer bass, chords, melody)</label>
      </div>
      <p class="syn-note">In the key and scale chosen above. One chord every 8 steps: a 16-step pattern uses the first two chords, 32 steps all four. Orange = active in this pattern: click it again to turn it off.</p>
      ${GEN_GROUPS.map(gr => `<div class="export-head">${esc(gr)}</div><div class="syn-gen-grid">${Object.entries(GENERATORS).filter(([, g]) => g.group === gr)
        .map(([k, g]) => `<button type="button" data-gen="${k}"${on.has(k) ? ' class="on"' : ""} aria-pressed="${on.has(k)}" title="${esc(on.has(k) ? "active in this pattern · click to turn it off" : g.hint || "")}">${esc(g.label)}</button>`).join("")}</div>`).join("")}`;
  }
  // Accende nel menu aperto le variazioni attive, senza ricostruirlo (le scelte in alto restano dove sono).
  function paintGenButtons() {
    const on = activeGens();
    el("synGen").querySelectorAll("[data-gen]").forEach(b => {
      const k = b.dataset.gen, a = on.has(k);
      b.classList.toggle("on", a); b.setAttribute("aria-pressed", a);
      b.title = a ? "active in this pattern · click to turn it off" : GENERATORS[k].hint || "";
    });
  }
  function paintGen() {
    const b = el("synGenAgain"); if (!b) return;
    const g = GENERATORS[genOpts().last];
    b.hidden = !g;
    if (g) b.title = `generate again: ${g.group} · ${g.label} (a new variation every click)`;
  }

  // ---------- export MIDI della linea del synth ----------
  // Tempi come patternEvents() della batteria (24 tick per sedicesimo, con lo swing); gli slide si
  // sovrappongono alla nota dopo, cosi' un synth mono di Logic (Retro Synth, ES2 in legato) scivola.
  function synthMidi(which) {
    const p = params(), base = MIDI_PPQ / 4, sw = swing(), ev = [];
    let tick = 0;
    const emit = pat => {
      const starts = [];
      for (let s = 0; s < pat.len; s++) { starts.push(tick); tick += Math.round(base * (s % 2 === 0 ? 1 + sw : 1 - sw)); }
      starts.push(tick);
      for (const x of pat.synth || []) {
        const on = starts[x.s], endStep = Math.min(pat.len, x.s + x.l), last = starts[endStep] - starts[endStep - 1];
        const off = x.g ? starts[endStep] + 4 : starts[endStep] - Math.round(last * (1 - (p.gate ?? 75) / 100));
        const n = clamp(x.n + (p.trans || 0), 0, 127);
        ev.push({ t: on, o: 1, n, v: x.a ? 120 : 92 }, { t: Math.max(on + 1, off), o: 0, n, v: 64 });
      }
    };
    synthTimeline(which === "song" ? "song" : "midi").forEach(emit);
    ev.sort((a, b) => (a.t - b.t) || (a.o - b.o));
    const trk = [], mpq = Math.round(60000000 / bpm());
    trk.push(...varLen(0), 0xFF, 0x51, 0x03, (mpq >> 16) & 0xff, (mpq >> 8) & 0xff, mpq & 0xff);
    const name = [..."PatternMachine Synth"].map(c => c.charCodeAt(0));
    trk.push(...varLen(0), 0xFF, 0x03, name.length, ...name);
    let last = 0;
    for (const e of ev) { trk.push(...varLen(e.t - last), e.o ? 0x90 : 0x80, e.n, e.v); last = e.t; }
    trk.push(...varLen(Math.max(0, tick - last)), 0xFF, 0x2F, 0x00);
    const L = trk.length;
    return new Uint8Array([0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, MIDI_PPQ,
      0x4D, 0x54, 0x72, 0x6B, (L >>> 24) & 0xff, (L >>> 16) & 0xff, (L >>> 8) & 0xff, L & 0xff, ...trk]);
  }
  function hasNotesIn(which, src) {
    return synthTimeline(which === "song" ? "song" : "midi", undefined, src).some(p => p.synth.length);
  }
  function exportMidi(which) {
    if (which === "song" && !project.song.length) { setStatus("the song is empty", "err"); return; }
    if (!hasNotesIn(which)) { setStatus("no synth notes to export", "err"); return; }
    saveBlob(new Blob([synthMidi(which)], { type: "audio/midi" }), exportBase(which) + " - synth.mid", "Synth MIDI");
  }

  // ---------- export WAV/MP3: il synth suona nello stesso OfflineAudioContext della batteria ----------
  function offlineEvents(which, loops, src) {
    const p = params(), base = 60 / bpm() / 4, sw = swing(), out = [];
    const saved = slideAt;
    let t = 0;
    slideAt = -1;
    const emit = pat => {
      for (let s = 0; s < pat.len; s++) { eventsForStep(pat, s, t, p, out); t += base * (s % 2 === 0 ? 1 + sw : 1 - sw); }
    };
    // stessa durata di wavEvents(): la batteria ripetuta `loops` volte (WAV_PATTERN_LOOPS se manca), o la canzone
    synthTimeline(which === "song" ? "song" : "pattern", loops, src).forEach(emit);
    slideAt = saved;
    return out;
  }
  // src: {drums, synth} scelti dal Resampling del Sampler al posto dei pattern aperti
  const hasNotes = (which, src) => allowed && !project.synth?.mute && hasNotesIn(which, src);
  async function renderOffline(ctx, which, loops, src) {
    if (!hasNotes(which, src) || !ctx.audioWorklet) return false;
    const events = offlineEvents(which, loops, src);
    if (!events.length) return false;
    await ctx.audioWorklet.addModule(WORKLET_URL);
    const p = params(), units = {};
    if (p.mType === "logue" && p.mUnit) { try { units[p.mUnit] = (await unitModule(p.mUnit)).bytes.slice(0); } catch (e) {} }
    const samples = {};
    if (p.mType === "sample" && p.mSample) {
      try { const { data, sr } = await sampleData(p.mSample); samples[p.mSample] = { data, sr }; }
      catch (e) { setStatus("synth: the sample " + sampleName(p.mSample, p) + " is left out of this export", "err"); }
    }
    const opts = u => ({ numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: { params: workletParams(p), bpm: bpm(), events, units: u, samples } });
    let n;
    try { n = new AudioWorkletNode(ctx, "pm-synth", opts(units)); }
    catch (e) { n = new AudioWorkletNode(ctx, "pm-synth", opts({})); setStatus("synth: the KORG unit is left out of this export", "err"); }
    buildChain(ctx, n, synthOut(ctx)).apply(p, bpm(), masterVol());
    return true;
  }

  // ---------- interfaccia ----------
  const CSS = `
#panelSynth .synth-beta{font-size:9px; letter-spacing:.1em; color:var(--danger); border:1px solid currentColor; border-radius:4px; padding:0 4px; margin-left:8px;}
#panelSynth .flexline + .flexline{margin-top:8px;}
#panelSynth .export-menu summary{min-height:0; padding:6px 10px; font-size:10.5px;}
#synOn.on{background:var(--ok); color:var(--on-ok); border-color:var(--ok);}
.synth-roll-wrap{margin-top:9px; overflow-x:auto; overflow-y:visible; border:1px solid var(--edge); border-radius:6px; background:var(--panel-2);}
.synth-roll{display:grid; min-width:100%; user-select:none; -webkit-user-select:none; touch-action:pan-y;}
.sr-key{position:sticky; left:0; z-index:2; font-size:9px; padding:0 5px; display:flex; align-items:center; height:17px;
  background:var(--panel); color:var(--text-dim); border-right:1px solid var(--edge); border-bottom:1px solid var(--edge-soft); cursor:pointer;}
.sr-key.black{background:var(--panel-3); color:var(--text);}
.sr-key.root{color:var(--accent); font-weight:700;}
.sr-key.out{opacity:.45;}
.sr-cell{height:17px; position:relative; cursor:pointer;
  border-right:1px solid color-mix(in srgb, var(--edge-soft) 55%, transparent); border-bottom:1px solid color-mix(in srgb, var(--edge-soft) 70%, transparent);}
.sr-cell.black{background:color-mix(in srgb, var(--panel-3) 45%, transparent);}
.sr-cell.out{background:repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--edge-soft) 30%, transparent) 4px 5px);}
.sr-cell.beat{border-left:1px solid var(--edge);}
.sr-key.live{background:var(--accent); color:var(--on-accent);}
.sr-cell.live{background:color-mix(in srgb, var(--accent) 16%, transparent);}
.sr-cell.ph{background:color-mix(in srgb, var(--accent) 20%, transparent);}
.sr-cell.note, .sr-cell.tie{background:var(--step-on, var(--led-on));}
.sr-cell.note{border-radius:4px 0 0 4px; box-shadow:inset 2px 0 0 rgba(0,0,0,.25);}
.sr-cell.tie{opacity:.72;}
.sr-cell.end{border-radius:0 4px 4px 0;}
.sr-cell.note.end{border-radius:4px;}
.sr-cell.acc{background:var(--step-acc, var(--led-accent));}
.sr-cell.slide.end::after{content:""; position:absolute; right:-6px; top:50%; width:10px; height:6px; margin-top:-5px; border:2px solid var(--text); border-left:0; border-bottom:0; border-radius:0 8px 0 0; z-index:1; pointer-events:none;}
.synth-kbd{position:relative; display:flex; height:64px; margin-top:10px; user-select:none; -webkit-user-select:none; touch-action:none;}
.synth-kbd .kw{flex:1 1 0; position:relative; background:linear-gradient(#fbfaf6,#e3e0d6); border:1px solid var(--edge); border-radius:0 0 4px 4px; margin-right:-1px; cursor:pointer;
  display:flex; align-items:flex-end; justify-content:center; font-size:9px; color:#555; padding-bottom:3px;}
.synth-kbd .kb{position:absolute; top:0; right:-30%; width:60%; height:60%; z-index:1; background:linear-gradient(#3a3a3d,#141416); border-radius:0 0 3px 3px; cursor:pointer;
  display:flex; align-items:flex-end; justify-content:center; font-size:8px; color:#bbb; padding-bottom:2px;}
.synth-kbd .kw.on, .synth-kbd .kb.on{background:var(--accent); color:var(--on-accent);}
.synth-kbd .kw.c::before{content:attr(data-name); position:absolute; top:3px; font-size:8px; color:#888;}
.synth-under{display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:6px;}
#synScope{width:200px; height:40px; border:1px solid var(--edge); border-radius:4px; background:var(--counter-bg, var(--panel-3)); margin-left:auto;}
.synth-params{display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:8px; margin-top:12px;}
.synth-sec{border:1px solid var(--edge); border-radius:var(--r-panel, 8px); padding:8px 10px 6px; background:var(--panel);}
.synth-sec h3{font-size:9.5px; letter-spacing:.14em; text-transform:uppercase; margin:0 0 7px; color:var(--text-dim); padding-bottom:4px; border-bottom:1px solid var(--edge-soft);}
.syn-p{display:grid; grid-template-columns:84px minmax(0,1fr) 62px; align-items:center; gap:6px; font-size:10.5px; margin-bottom:5px; color:var(--text-dim);}
.syn-p input[type=range]{width:100%; margin:0;}
.syn-p select{width:100%; min-width:0; padding:3px 5px;}
.syn-p output{text-align:right; font-variant-numeric:tabular-nums; font-size:10px;}
.syn-p.sel{grid-template-columns:84px minmax(0,1fr);}
.synth-params{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px;align-items:start;}
.synth-col{display:flex;flex-direction:column;gap:10px;min-width:0;}
.synth-sec{position:relative;overflow:hidden;border:1px solid color-mix(in srgb,var(--edge) 80%,#000);border-radius:9px;padding:0 9px 8px;background:linear-gradient(145deg,var(--panel),color-mix(in srgb,var(--panel-2) 70%,#000));box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 2px 5px rgba(0,0,0,.18);}
.synth-sec::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.08;background:repeating-linear-gradient(0deg,transparent 0 2px,#fff 2px 3px);}
.synth-sec h3{position:relative;z-index:1;display:flex;align-items:center;gap:7px;margin:0 -9px 6px;padding:8px 9px 7px;background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(0,0,0,.12));color:var(--text);border-bottom:1px solid var(--edge);}
.synth-sec h3::before{content:"";width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:var(--accent);box-shadow:0 0 7px color-mix(in srgb,var(--accent) 70%,transparent);}
.sec-vco-1 h3::before,.sec-vco-2 h3::before{background:#d98b35;box-shadow:0 0 7px #d98b35}.sec-filter h3::before{background:#c8471f;box-shadow:0 0 7px #c8471f}.sec-amp-eg h3::before,.sec-filter-eg h3::before{background:#6bb36b;box-shadow:0 0 7px #6bb36b}.sec-lfo h3::before{background:#6ca4d8;box-shadow:0 0 7px #6ca4d8}.sec-voice h3::before{background:#bb78c9;box-shadow:0 0 7px #bb78c9}
.syn-p{position:relative;z-index:1;min-height:29px;padding:3px 0;margin:0;border-bottom:1px solid color-mix(in srgb,var(--edge-soft) 45%,transparent);}
.syn-p:last-child{border-bottom:0}.syn-p>span:first-child{font:700 9px/1.1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim);}
.syn-p input[type=range]{height:20px;appearance:none;background:transparent;cursor:pointer}.syn-p input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:99px;background:linear-gradient(90deg,var(--accent),color-mix(in srgb,var(--accent) 22%,var(--panel-3)))}.syn-p input[type=range]::-webkit-slider-thumb{appearance:none;width:15px;height:15px;margin-top:-5.5px;border:1px solid #272522;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff8e8 0 12%,#d8d0bd 13% 45%,#777268 46% 100%);box-shadow:0 1px 2px #000,0 0 0 2px color-mix(in srgb,var(--accent) 25%,transparent)}.syn-p input[type=range]::-moz-range-track{height:4px;border-radius:99px;background:linear-gradient(90deg,var(--accent),color-mix(in srgb,var(--accent) 22%,var(--panel-3)))}.syn-p input[type=range]::-moz-range-thumb{width:14px;height:14px;border:1px solid #272522;border-radius:50%;background:#d8d0bd;box-shadow:0 1px 2px #000}
.syn-p output{min-width:0;overflow:hidden;padding:3px 4px;border:1px solid color-mix(in srgb,var(--edge) 75%,#000);border-radius:3px;background:var(--counter-bg,var(--panel-3));color:var(--counter-fg,var(--text));font:10px/1.1 var(--mono);white-space:nowrap}
.syn-p select{padding:5px 6px;border:1px solid var(--edge);border-radius:3px;background:linear-gradient(180deg,var(--panel-2),var(--panel-3));color:var(--text);font:700 10px var(--mono);box-shadow:inset 0 1px 0 rgba(255,255,255,.1)}.syn-p.sel select{appearance:none;padding-right:22px}.syn-p.sel::after{content:"▾";position:absolute;right:7px;pointer-events:none;color:var(--accent)}
.sec-vco-1 .syn-p input[type=range]::-webkit-slider-thumb,.sec-vco-2 .syn-p input[type=range]::-webkit-slider-thumb{border-radius:3px;background:linear-gradient(145deg,#f3b15e,#a75c1d);box-shadow:0 1px 2px #000,0 0 0 2px rgba(217,139,53,.22)}.sec-vco-1 .syn-p input[type=range]::-moz-range-thumb,.sec-vco-2 .syn-p input[type=range]::-moz-range-thumb{border-radius:3px;background:#d98b35}.sec-filter .syn-p input[type=range]::-webkit-slider-thumb{width:19px;height:19px;margin-top:-7.5px;background:conic-gradient(from 25deg,#e7d8b8,#736e64,#e7d8b8,#736e64,#e7d8b8);box-shadow:0 1px 3px #000,0 0 0 2px rgba(200,71,31,.25)}.sec-amp-eg .syn-p input[type=range]::-webkit-slider-runnable-track,.sec-filter-eg .syn-p input[type=range]::-webkit-slider-runnable-track{background:linear-gradient(90deg,#6bb36b,color-mix(in srgb,#6bb36b 22%,var(--panel-3)))}.sec-lfo .syn-p input[type=range]::-webkit-slider-runnable-track{background:linear-gradient(90deg,#6ca4d8,color-mix(in srgb,#6ca4d8 22%,var(--panel-3)))}.sec-voice .syn-p input[type=range]::-webkit-slider-runnable-track{background:linear-gradient(90deg,#bb78c9,color-mix(in srgb,#bb78c9 22%,var(--panel-3)))}
.syn-p .cap{text-transform:capitalize;}
.syn-note{font-size:9.5px; color:var(--text-faint); margin:2px 0 6px; line-height:1.4;}
.syn-preset-select{min-width:180px;}
#synPresets .lib-meta{flex:1 1 0; min-width:0;}
.syn-preset-acts{display:flex; flex-wrap:wrap; gap:5px; flex:0 0 auto;}
#synPresets .lib-item.current{border-color:var(--accent-dim);}
.synth-sec.menu-open{overflow:visible; z-index:40;}
.synth-sec.menu-open .syn-sample-pick{z-index:5;}   /* sopra le righe Root, Start, Loop */
.synth-sec .syn-sample-menu{min-width:0;}
.synth-sec .syn-sample-menu summary{position:relative; display:block; min-height:0; padding:5px 22px 5px 6px; border-radius:3px; overflow:hidden; text-overflow:ellipsis;
  background:linear-gradient(180deg,var(--panel-2),var(--panel-3)); box-shadow:inset 0 1px 0 rgba(255,255,255,.1); font:700 10px var(--mono); letter-spacing:0; text-transform:none;}
.synth-sec .syn-sample-menu summary::after{content:"▾"; position:absolute; right:7px; color:var(--accent);}
.synth-sec .syn-p.syn-sample-pick::after{content:none;}
.synth-sec .syn-sample-menu .syn-sample-list{left:auto; right:0; min-width:max(100%, 200px); max-width:min(280px, calc(100vw - 32px));}
.synth-sec .syn-sample-list .syn-note{margin:4px 2px;}
.export-list.syn-gen{min-width:min(470px, calc(100vw - 32px));}
.syn-gen-opts{display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:6px 8px; font-size:9.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--text-dim);}
.syn-gen-opts label{display:flex; flex-direction:column; gap:3px;}
.syn-gen-opts select{width:100%; min-width:0; text-transform:none; letter-spacing:0;}
.syn-gen-opts .syn-gen-add{grid-column:1/-1; flex-direction:row; align-items:center; gap:6px; text-transform:none; letter-spacing:0; font-size:10.5px; color:var(--text);}
.syn-gen .syn-note{margin:4px 0 0;}
.syn-gen-grid{display:grid; grid-template-columns:1fr 1fr; gap:4px;}
.syn-gen-grid button{font-size:10.5px; padding:6px 8px;}
.syn-gen-grid button{min-width:0; white-space:normal;}
.syn-gen-grid button.on{background:var(--key-primary,var(--accent)); color:var(--on-accent); border-color:var(--accent-dim); font-weight:700;}
#synGenAgain{min-height:0; padding:6px 10px; font-size:10.5px;}
#synPatChips{align-items:center; gap:7px;}
.syn-pattern-actions{display:grid; grid-template-columns:repeat(2,minmax(92px,1fr)); grid-template-rows:repeat(2,auto); gap:6px;}
.syn-pattern-actions button{width:100%; min-width:92px;}
.syn-steps-field{display:inline-flex; align-items:center; gap:6px;}
.syn-steps-menu{min-width:74px;}
.syn-steps-menu summary{justify-content:space-between; gap:12px; min-height:32px; padding:7px 9px; font-size:10px; letter-spacing:.04em; text-transform:none;}
.syn-steps-menu summary::after{content:"▾"; color:var(--accent);}
.syn-steps-menu .syn-step-list{right:0; left:auto; min-width:92px;}
.syn-step-list button{display:flex; align-items:center; justify-content:space-between; gap:12px;}
.syn-step-list button::after{content:""; width:6px; height:6px; border-radius:50%; background:transparent;}
.syn-step-list button.on{background:var(--key-primary,var(--accent)); color:var(--on-accent); border-color:var(--accent-dim); font-weight:700;}
.syn-step-list button.on::after{content:"✓"; width:auto; height:auto; background:none;}
@media (max-width:560px){ .export-list.syn-gen{min-width:0; width:calc(100vw - 32px);} .syn-gen-grid{grid-template-columns:1fr;} .syn-gen-opts{grid-template-columns:1fr 1fr;} }
.synth-credits{font-size:10px; color:var(--text-faint); margin:10px 0 0; line-height:1.5;}
.synth-credits a{color:inherit;}
@media (max-width:900px){ .synth-params{grid-template-columns:repeat(2,minmax(0,1fr));} }
@media (max-width:560px){ .synth-params{grid-template-columns:1fr;} #synScope{display:none;} .syn-p{grid-template-columns:78px minmax(0,1fr) 56px;} }
`;

  let built = false;
  function build() {
    if (built) return;
    built = true;
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    el("synthEnginePanel").innerHTML = `
      <div class="machine-bar">
        <label class="machine-label" for="synEngine">Engine</label>
        <select id="synEngine" class="machine-select"><option value="korg">KORG</option><option value="tone">Tone.js</option><option value="custom">Custom</option></select>
        <label class="machine-label" for="synPreset">Preset</label>
        <select id="synPreset" class="machine-select syn-preset-select"></select>
        <button id="synSavePreset" class="mini" type="button" title="Save the current sound as a preset in this browser">Save preset</button>
        <button id="synManagePresets" class="mini" type="button" title="The presets saved in this browser: listen, use, rename, delete">My presets…</button>
        <button id="synRenamePreset" class="mini" type="button" title="Rename the current preset">Rename preset</button>
        <button id="synDelPreset" class="mini danger" type="button" hidden>Delete preset</button>
        <span class="syn-links">
          <svg class="syn-brand" viewBox="-1.2368859 -1.2368859 127.3011518 43.7033018" role="img" aria-label="KORG"><title>KORG logue units: oscillators from the KORG logue-sdk</title><path fill="currentColor" d="${KORG_LOGO}"/></svg>
          <a class="text-link" href="synth.html" target="_blank" rel="noopener" title="How the synth engines work (opens in a new window)">→ Synth engines and methods</a>
        </span>
      </div>`;
    el("synthPatternPanel").innerHTML = `
      <h2>Pattern</h2>
      <div class="chips" id="synPatChips" role="group" aria-label="Synth pattern to edit"></div>
      <div class="flexline">
        <button id="synPatBrowse" class="mini primary" type="button" title="Suggestions from the generators: listen and apply">✦ Generate</button>
        <button id="synPatNew" class="mini" type="button" title="A new empty synth pattern">+ New</button>
        <span class="syn-pattern-actions">
          <button id="synPatDup" class="mini" type="button">Duplicate</button>
          <button id="synClear" class="mini" type="button" title="Remove every note of this synth pattern">Clear</button>
          <button id="synPatRename" class="mini" type="button">Rename</button>
          <button id="synPatDel" class="mini danger" type="button">Delete</button>
        </span>
        <label class="fld syn-steps-field" style="margin-left:auto;">Steps <details class="export-menu syn-steps-menu" id="synPatLenMenu">
          <summary id="synPatLenSummary" aria-label="Synth pattern length">16</summary>
          <div class="export-list syn-step-list" id="synPatLenList" role="listbox" aria-label="Synth pattern steps">
            ${SYNTH_LENS.map(n => `<button type="button" data-len="${n}" role="option">${n}</button>`).join("")}
          </div>
        </details></label>
      </div>`;
    el("synthEnginePanel").hidden = el("synthPatternPanel").hidden = el("panelSynth").hidden;
    el("panelSynth").innerHTML = `
      <h2>Notes <span id="synPatName"></span><span class="synth-beta">test</span></h2>
      <div class="flexline">
        <button id="synOn" class="mini on" type="button" aria-pressed="true" title="Mute or unmute the synth in playback and exports">On</button>
        <button id="synSolo" class="mini" type="button" aria-pressed="false" title="Play the synth without the drums">Solo</button>
        <label class="fld">Key <select id="synKey"></select></label>
        <label class="fld">Scale <select id="synScale"></select></label>
        <details class="export-menu" id="synGenMenu"><summary>Generate ▾</summary><div class="export-list syn-gen" id="synGen"></div></details>
        <button id="synGenAgain" class="mini" type="button" hidden>↻ Again</button>
        <button id="synRecClear" class="mini danger" type="button" hidden title="Remove the notes recorded live in this pattern, ready for a new take (generated and hand-drawn notes stay)">✕ Clear recording</button>
        <details class="export-menu" id="synMidiMenu"><summary>MIDI ▾</summary><div class="export-list">
          <div class="export-head">Synth line only</div>
          <button id="synMidiPat" type="button" title="The synth notes of this pattern as a .mid file for a Logic software instrument">MIDI pattern</button>
          <button id="synMidiSong" type="button" title="The synth notes of the whole song as a .mid file">MIDI song</button></div></details>
      </div>
      <div class="flexline">
        <span class="tiny">Click:</span>
        <div class="modeswitch" id="synTap" role="group" aria-label="What a click on a note changes">
          <button type="button" data-mode="note" title="add a note (drag to make it longer), click a note to remove it">Notes</button>
          <button type="button" data-mode="acc" title="accent: louder and brighter (alt+click)">Accent</button>
          <button type="button" data-mode="slide" title="slide into the next note, like a TB-303 (shift+click)">Slide</button>
        </div>
        <button id="synDown" class="mini" type="button" title="Show lower notes">Oct −</button>
        <button id="synUp" class="mini" type="button" title="Show higher notes">Oct +</button>
        <label class="fld"><input type="checkbox" id="synFold"> Scale notes only</label>
        <span class="tiny" id="synRange"></span>
      </div>
      <div class="synth-roll-wrap"><div class="synth-roll" id="synRoll"></div></div>
      <details class="wave-panel" id="waveSynth" open>
        <summary>Audio waveform <span class="wave-caption" id="waveSynthCaption">selected synth pattern</span></summary>
        <canvas id="waveSynthCanvas" height="124" aria-label="Waveform of the selected synth pattern"></canvas>
      </details>
      <div class="synth-kbd" id="synKbd" aria-label="Keyboard"></div>
      <div class="synth-under">
        <span class="tiny" id="synKbdInfo"></span>
        <button id="synMidiIn" class="mini" type="button" aria-pressed="false" title="Play the synth from a MIDI keyboard (Chrome, Edge, Firefox)">MIDI in</button>
        <button id="synPanic" class="mini" type="button" title="Silence every synth note">Panic</button>
        <canvas id="synScope" width="400" height="80" aria-hidden="true"></canvas>
      </div>
      <div class="synth-params" id="synParams"></div>
      <p class="synth-credits">Multi engine › <b>KORG logue unit</b>: oscillators from the
        <a href="https://github.com/korginc/logue-sdk" target="_blank" rel="noopener">KORG logue-sdk</a> (NTS-1 mkII, BSD-3-Clause),
        compiled to WebAssembly, one instance per voice. To record: turn on Rec, press Play and play the keys.</p>`;

    el("synOn").onclick = () => { pushUndo(); const s = ensure(); s.mute = !s.mute; if (s.mute) allOff(); paintTop(); window.paintGroupMS?.(); };
    el("synSolo").onclick = () => { pushUndo(); const s = ensure(); s.solo = !s.solo; paintTop(); window.paintGroupMS?.(); };
    el("synEngine").onchange = async e => {
      const ui = e.target.value, next = ui === "tone" ? "tone" : "custom", prev = engineOf();
      if (ui === engineUi()) return;
      pushUndo();
      const s = ensure(); s.engine = next;
      if (next === "tone") {
        if (!TONE_PRESETS[s.preset]) { s.preset = DEFAULT_TONE_PRESET; s.params = presetParams(DEFAULT_TONE_PRESET, TONE_PRESETS); }
      } else {
        // KORG parte da "KORG waves", Custom dal suo preset iniziale
        const start = ui === "korg" ? DEFAULT_KORG_PRESET : DEFAULT_PRESET;
        s.preset = start; s.params = presetParams(start, PRESETS);
      }
      allOff();
      if (next === "tone") {
        stopCustom();
        try { await ensureTone(); setStatus("synth engine: Tone.js"); }
        catch (err) { s.engine = "custom"; s.preset = DEFAULT_PRESET; s.params = presetParams(DEFAULT_PRESET, PRESETS); setStatus("Tone.js could not load", "err"); }
      } else {
        if (prev === "tone") stopTone();
        try { await ensureAudio(); pushParams(); setStatus("synth engine: " + ENGINE_LABEL[ui]); } catch (err) {}
        if (ui === "korg") primeUnit();
      }
      renderParams(); paintTop();
    };
    el("synPreset").onchange = e => {
      pushUndo();
      const s = ensure(), name = e.target.value;
      s.preset = name; s.params = presetParams(name);
      pushParams(); renderParams(); paintTop();
      if (params().mType === "logue") primeUnit();
      auditionChord();
    };
    el("synSavePreset").onclick = async () => {
      const name = await ask({ title: "Save synth preset", message: "The sound is saved in this browser.", ok: "Save", input: project.synth?.preset || "My sound" });
      if (name === null || !name.trim()) return;
      const clean = name.trim().slice(0, 40);
      if (presetBank()[clean]) { setStatus("that name belongs to a factory preset", "err"); return; }
      const all = userPresets(); all[clean] = JSON.parse(JSON.stringify(params())); writeUserPresets(all);
      const s = ensure(); s.preset = clean; s.params = presetParams(clean);
      paintTop(); setStatus("preset saved: " + clean);
    };
    el("synRenamePreset").onclick = async () => {
      const old = project.synth?.preset || "My sound";
      const name = await ask({ title: "Rename synth preset", message: "The renamed sound is saved in this browser.", ok: "Rename", input: old });
      if (name === null || !name.trim()) return;
      const clean = name.trim().slice(0, 40), all = userPresets();
      if (PRESETS[clean] || TONE_PRESETS[clean]) { setStatus("that name belongs to a factory preset", "err"); return; }
      all[clean] = JSON.parse(JSON.stringify(params()));
      if (old !== clean && all[old]) delete all[old];
      writeUserPresets(all);
      const s = ensure(); s.preset = clean; s.params = presetParams(clean);
      paintTop(); setStatus("preset renamed: " + clean);
    };
    el("synDelPreset").onclick = async () => {
      const name = project.synth?.preset, all = userPresets();
      if (!name || !all[name]) return;
      if (!await ask({ title: "Delete preset", message: `Delete "${name}" from this browser? The sound in this project stays.`, ok: "Delete", danger: true })) return;
      delete all[name]; writeUserPresets(all); paintTop();
    };
    el("synManagePresets").onclick = openPresets;
    syncPresets();                                   // all'apertura del synth: i preset dell'account arrivano nel menu
    window.addEventListener("online", syncPresets);
    el("synKey").innerHTML = NOTE_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join("");
    el("synScale").innerHTML = Object.entries(SCALES).map(([k, [label]]) => `<option value="${k}">${label}</option>`).join("");
    el("synKey").onchange = e => { pushUndo(); ensure().key = +e.target.value; renderRoll(); };
    el("synScale").onchange = e => { pushUndo(); ensure().scale = e.target.value; renderRoll(); };
    el("synGen").innerHTML = genMenuHtml();
    el("synGen").onclick = e => {
      const b = e.target.closest("[data-gen]"); if (!b) return;
      // il menu resta aperto (lo chiude chi lo usa): si provano e si sommano piu' variazioni di seguito
      if (b.classList.contains("on")) stopGenerator(b.dataset.gen); else runGenerator(b.dataset.gen);
      paintGenButtons();
    };
    el("synGen").onchange = () => {
      view.gen = { ...genOpts(), prog: el("synGenProg").value, dens: el("synGenDens").value, oct: +el("synGenOct").value, add: el("synGenAdd").checked };
      saveView();
    };
    el("synGenAgain").onclick = () => runGenerator(genOpts().last);
    // il menu e' largo: se esce a destra lo sposta a sinistra, restando dentro lo schermo
    el("synGenMenu").ontoggle = () => {
      const L = el("synGen"); L.style.left = "";
      if (!el("synGenMenu").open) return;
      L.innerHTML = genMenuHtml();          // le variazioni attive dipendono dal pattern aperto in questo momento
      const r = L.getBoundingClientRect(), over = r.right - (innerWidth - 16);
      if (over > 0) L.style.left = Math.max(-over, 16 - r.left) + "px";
    };
    paintGen();
    el("synMidiPat").onclick = () => { el("synMidiMenu").open = false; exportMidi("pattern"); };
    el("synMidiSong").onclick = () => { el("synMidiMenu").open = false; exportMidi("song"); };
    document.addEventListener("click", e => {
      for (const id of ["synGenMenu", "synMidiMenu", "synPatLenMenu"]) if (!el(id).contains(e.target)) el(id).open = false;
    });
    // Toglie solo le note registrate dal vivo (k:"rec"): il pattern e' pronto per una nuova registrazione.
    el("synRecClear").onclick = () => {
      const pat = curSynth(), n = pat.synth.filter(x => x.k === "rec").length; if (!n) return;
      pushUndo(); pat.synth = pat.synth.filter(x => x.k !== "rec"); renderRoll();
      setStatus(`synth: ${n} recorded ${n === 1 ? "note" : "notes"} cleared · ready for a new take`);
    };
    el("synClear").onclick = () => {
      const pat = curSynth(); if (!pat.synth.length) return;
      pushUndo(); pat.synth = []; renderRoll(); setStatus("synth notes cleared");
    };
    bindPatternBar();
    el("synTap").onclick = e => { const b = e.target.closest("[data-mode]"); if (!b) return; view.tap = b.dataset.mode; saveView(); paintTap(); };
    el("synDown").onclick = () => { view.base = clamp(view.base - 12, 0, 96); saveView(); renderRoll(); };
    el("synUp").onclick = () => { view.base = clamp(view.base + 12, 0, 96); saveView(); renderRoll(); };
    el("synFold").onchange = e => { view.fold = e.target.checked; saveView(); renderRoll(); };
    el("synMidiIn").hidden = !navigator.requestMIDIAccess || !window.PMMidi;
    el("synMidiIn").onclick = () => window.PMMidi && PMMidi.toggle();
    if (window.PMMidi) PMMidi.paint();
    el("synPanic").onclick = () => { held.clear(); paintKeys(); if (node) node.port.postMessage({ t: "panic" }); };
    wireRoll();
    wireKeyboard();
    paintTap();
  }

  function paintTap() { el("synTap").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.mode === view.tap)); }
  function paintTop() {
    if (!built) return;
    const s = project.synth, on = !(s && s.mute), b = el("synOn"), solo = el("synSolo");
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "On" : "Off";
    solo.classList.toggle("on", !!s?.solo); solo.setAttribute("aria-pressed", String(!!s?.solo));
    const bank = presetBank(), users = userPresets(), cur = s?.preset || (engineOf() === "tone" ? DEFAULT_TONE_PRESET : DEFAULT_PRESET);
    const opt = n => `<option value="${esc(n)}"${n === cur ? " selected" : ""}>${esc(n)}</option>`;
    // KORG mostra i suoni con un'unita' KORG logue, Custom gli altri (anche tra i miei)
    const ui = engineUi(), isKorg = x => x && x.mType === "logue";
    const fits = x => ui === "tone" || (ui === "korg") === isKorg(x);
    const factory = Object.keys(bank).filter(n => fits(bank[n])), mine = Object.keys(users).filter(n => fits(users[n]));
    const group = (label, list) => list.length ? `<optgroup label="${label}">${list.map(opt).join("")}</optgroup>` : "";
    el("synPreset").innerHTML = group(ENGINE_LABEL[ui] + (ui === "korg" ? " logue" : ""), factory) + group("Mine", mine)
      + (!factory.includes(cur) && !mine.includes(cur) ? `<optgroup label="This project">${opt(cur)}</optgroup>` : "");
    el("synDelPreset").hidden = !users[cur];
    el("synEngine").value = ui;
    el("synKey").value = keyOf(); el("synScale").value = scaleOf();
    el("synFold").checked = !!view.fold;
    el("synPatName").textContent = "— " + curSynth().name;
    paintPatternBar();
  }

  // ---------- pattern del synth (come il pannello Pattern di Drum Grid) ----------
  // Un pulsante per pattern, come in Drum Grid: quello scelto resta acceso, il pallino e' il colore nel Sequencer.
  function paintPatternBar() {
    if (!built) return;
    const cur = curSynth(), n = project.synthPatterns.length;
    el("synPatChips").innerHTML = project.synthPatterns.map((sp, i) => {
      const on = sp.id === cur.id;
      return `<span class="pattern-item${on ? " on" : ""}"><button type="button" class="pattern-btn${on ? " on" : ""}" data-id="${esc(sp.id)}" aria-pressed="${on}" title="${esc(sp.name)} · ${sp.len} step">`
        + `<span class="dot" style="background:hsl(${synthHue(sp.id)} 65% 58%)"></span><span class="pattern-btn-name">${i + 1}. ${esc(sp.name)}</span></button>`
        + `<button type="button" class="pattern-more" data-rename="${esc(sp.id)}" title="Rename “${esc(sp.name)}”" aria-label="Rename ${esc(sp.name)}">…</button></span>`;
    }).join("") + `<span class="tiny">${n} synth ${n === 1 ? "pattern" : "patterns"}</span>`;
    lastPlayId = undefined;   // il ciclo di disegno rimette il contorno sul pattern che suona
    const lenMenu = el("synPatLenMenu"), lenSummary = el("synPatLenSummary");
    if (lenSummary) lenSummary.textContent = cur.len;
    lenMenu?.querySelectorAll("[data-len]").forEach(b => {
      const on = +b.dataset.len === cur.len;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    });
    el("synPatDel").disabled = n <= 1;
    el("synPatName").textContent = "— " + cur.name;
  }
  // Dal tasto Rename (pattern aperto) o dal "…" accanto a ogni pattern.
  async function renameSynth(sp) {
    const name = await ask({ title: "Rename synth pattern", ok: "Rename", input: sp.name });
    if (name === null || !name.trim() || name.trim() === sp.name) return;
    pushUndo(); sp.name = name.trim().slice(0, 40); paintPatternBar();
  }
  function selectSynth(id) {
    ui.synthId = id; paintPatternBar(); centerOn(curSynth()); renderRoll();
  }
  function bindPatternBar() {
    el("synPatChips").onclick = e => {
      const more = e.target.closest(".pattern-more");
      if (more) { const sp = synthById(more.dataset.rename); if (sp) renameSynth(sp); return; }
      const b = e.target.closest(".pattern-btn");
      if (b && b.dataset.id !== curSynth().id) selectSynth(b.dataset.id);
    };
    el("synPatBrowse").onclick = openLib;
    const lenMenu = el("synPatLenMenu");
    lenMenu.onclick = e => {
      const b = e.target.closest("[data-len]"); if (!b) return;
      const sp = curSynth(), from = sp.len, to = +b.dataset.len;
      lenMenu.open = false;
      if (to === from) return;
      pushUndo();
      const base = sp.synth.filter(n => n.s < from), out = [];
      for (let k = 0; k < to; k += from) base.forEach(n => {
        if (n.s + k < to) out.push({ ...n, s: n.s + k, l: Math.min(n.l, to - n.s - k) });
      });
      sp.len = to; sp.synth = out;
      paintPatternBar(); renderRoll();
    };
    el("synPatNew").onclick = () => {
      pushUndo();
      const sp = makeSynthPattern("Synth " + (project.synthPatterns.length + 1), curSynth().len);
      project.synthPatterns.push(sp); selectSynth(sp.id); setStatus("new synth pattern: " + sp.name);
    };
    el("synPatDup").onclick = () => {
      pushUndo();
      const src = curSynth(), sp = makeSynthPattern(copyName(src.name, project.synthPatterns.map(x => x.name)), src.len);
      sp.synth = src.synth.map(n => ({ ...n }));
      project.synthPatterns.splice(project.synthPatterns.indexOf(src) + 1, 0, sp); selectSynth(sp.id);
    };
    el("synPatRename").onclick = () => renameSynth(curSynth());
    el("synPatDel").onclick = async () => {
      if (project.synthPatterns.length <= 1) { setStatus("at least one synth pattern is needed", "err"); return; }
      const sp = curSynth(), used = project.synthSong.filter(b => b.synthId === sp.id).length;
      const msg = `Delete "${sp.name}"?` + (used ? (used === 1 ? " Its block in the song becomes a rest" : ` Its ${used} blocks in the song become rests`) + ", so everything after it stays in time." : "") + " You can undo with cmd+Z.";
      if (!await ask({ title: "Delete synth pattern", message: msg, ok: "Delete", danger: true })) return;
      pushUndo();
      project.synthSong.forEach(b => { if (b.synthId === sp.id) { b.len = sp.len; b.synthId = null; } });
      const i = project.synthPatterns.indexOf(sp);
      project.synthPatterns.splice(i, 1);
      selectSynth(project.synthPatterns[Math.max(0, i - 1)].id);
    };
  }

  // ---------- manopole ----------
  function renderParams() {
    if (!built) return;
    const p = params(), box = el("synParams");
    box.innerHTML = "";
    const cols = Array.from({length:4}, () => { const c = document.createElement("div"); c.className = "synth-col"; box.appendChild(c); return c; });
    for (const sec of SECTIONS) {
      const specs = sec.params.filter(spec => engineOf() !== "tone" || TONE_KEYS.has(spec.k));
      if (!specs.length) continue;
      const slug = sec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const d = document.createElement("div"); d.className = "synth-sec sec-" + slug;
      d.innerHTML = `<h3>${sec.title}</h3>`;
      for (const spec of specs) {
        if (spec.k === "mUnit" && p.mType !== "logue") continue;
        if (spec.k === "mShape" && (p.mType === "logue" || p.mType === "sample")) continue;
        if (SAMPLE_KEYS.has(spec.k) && p.mType !== "sample") continue;
        d.appendChild(control(spec, p[spec.k]));
      }
      if (sec.id === "multi") {
        const units = document.createElement("div"); units.id = "synUnitParams"; d.appendChild(units);
        if (p.mType === "logue") renderUnitParams(units, p);
        else if (p.mType === "sample") units.innerHTML = window.synthSampleInfo?.(p.mSample)
          ? `<p class="syn-note">Plays the sound at the pitch of each note, then through the filter, envelopes and effects.${p.mLvl ? "" : " Raise Multi in the mixer to hear it."}</p>`
          : `<p class="syn-note">The sound “${esc(sampleName(p.mSample, p))}” is not available here: choose another one.</p>`;
        else units.innerHTML = `<p class="syn-note">${SPEC.mShape.hint}. Raise Multi in the mixer to hear it.</p>`;
      }
      cols[(SECTIONS.indexOf(sec)) % cols.length].appendChild(d);
    }
  }
  function control(spec, value) {
    if (spec.k === "mSample") return sampleControl(spec);
    const row = document.createElement("label");
    row.className = "syn-p" + (spec.opts ? " sel" : "");
    if (spec.hint) row.title = spec.hint;
    const lab = document.createElement("span"); lab.textContent = spec.label; row.appendChild(lab);
    if (spec.opts) {
      const s = document.createElement("select");
      s.innerHTML = (spec.k === "mUnit" ? unitOpts : spec.opts).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
      s.value = String(value);
      s.onchange = () => {
        const v = typeof spec.def === "number" ? +s.value : s.value;
        setParam(spec.k, v, true);
        if (spec.k === "mType" && v === "sample") startSample();
        if (spec.k === "mType" || spec.k === "mUnit") { renderParams(); primeUnit(); if (spec.k === "mType") paintTop(); }   // KORG/Custom nel menu Engine
      };
      row.appendChild(s);
    } else {
      const r = document.createElement("input"), out = document.createElement("output");
      r.type = "range"; r.dataset.k = spec.k; r.min = spec.min ?? 0; r.max = spec.max ?? 100; r.step = 1; r.value = value;
      const show = () => { out.value = (spec.fmt || String)(+r.value); };
      show();
      let armed = true;   // un solo passo di annulla per trascinamento
      r.addEventListener("input", () => { if (armed) { pushUndo(); armed = false; } setParam(spec.k, +r.value, false); show(); });
      r.addEventListener("change", () => { armed = true; });
      r.addEventListener("dblclick", () => { pushUndo(); r.value = spec.def; setParam(spec.k, spec.def, false); show(); });
      row.append(r, out);
    }
    return row;
  }
  // Menu Sound, come il menu Instrument della batteria: i suoni delle righe attive e i campioni del Sampler. Il suono scelto resta anche se
  // poi la riga cambia suono o si carica un'altra macchina (compare sotto "Current sound").
  function sampleControl(spec) {
    const row = document.createElement("div");            // non un <label>: il clic sull'etichetta premerebbe il primo suono
    row.className = "syn-p sel syn-sample-pick";
    const lab = document.createElement("span"); lab.textContent = spec.label; row.appendChild(lab);
    const menu = document.createElement("details"); menu.className = "export-menu syn-sample-menu"; menu.id = "synSampleMenu";
    const sum = document.createElement("summary"); sum.title = "Choose the drum sound the synth plays";
    const list = document.createElement("div"); list.className = "export-list drum-sound-list syn-sample-list"; list.setAttribute("role", "listbox");
    const cur = params().mSample, info = window.synthSampleInfo?.(cur);
    sum.textContent = cur ? (info ? info.name : sampleName(cur) + " (missing)") : "Choose a sound";
    menu.append(sum, list); row.appendChild(menu);
    const button = (ref, text, on) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = text;
      b.setAttribute("role", "option"); b.setAttribute("aria-selected", String(on)); if (on) b.classList.add("on");
      b.onclick = () => { menu.open = false; if (ref === params().mSample) return; pushUndo(); pickSample(ref); renderParams(); };
      return b;
    };
    const head = text => { const h = document.createElement("div"); h.className = "export-head"; h.textContent = text; return h; };
    const fill = () => {
      const now = params().mSample, { rows = [], sampler = [] } = window.synthSampleList?.() || {};
      list.innerHTML = "";
      list.appendChild(head("Drum rows"));
      rows.forEach(x => list.appendChild(button(x.ref, x.row + ". " + x.name, x.ref === now)));
      if (!rows.length) { const e = document.createElement("div"); e.className = "syn-note"; e.textContent = "No drum rows yet: add one in the grid."; list.appendChild(e); }
      if (sampler.length) {
        list.appendChild(head("Sampler"));
        sampler.forEach(x => list.appendChild(button(x.ref, x.name, x.ref === now)));
      }
      if (now && ![...rows, ...sampler].some(x => x.ref === now)) {
        const i = window.synthSampleInfo?.(now);
        list.appendChild(head("Current sound"));
        list.appendChild(button(now, i ? i.name + (i.kitLabel ? " · " + i.kitLabel : "") : sampleName(now) + " (missing)", true));
      }
    };
    menu.addEventListener("toggle", () => {
      menu.closest(".synth-sec")?.classList.toggle("menu-open", menu.open);   // la sezione taglia cio' che esce: si apre solo col menu aperto
      if (menu.open) { fill(); list.querySelector("button.on")?.scrollIntoView({ block: "nearest" }); }
    });
    if (!window.__pmSynSampleMenuEvents) {
      window.__pmSynSampleMenuEvents = true;
      document.addEventListener("click", e => { const m = el("synSampleMenu"); if (m?.open && !m.contains(e.target)) m.open = false; });
      document.addEventListener("keydown", e => { const m = el("synSampleMenu"); if (e.key === "Escape" && m?.open) { m.open = false; m.querySelector("summary")?.focus(); } });
    }
    return row;
  }
  // Type -> Sample: un suono di partenza (la cassa della macchina caricata) e il Multi alzato, per sentirlo subito.
  function startSample() {
    const s = ensure(), p = s.params;
    if (!p.mSample || !window.synthSampleInfo?.(p.mSample)) {
      const rows = window.synthSampleList?.().rows || [], kick = rows.find(x => /^Kick/.test(x.slot)) || rows[0];
      if (kick) pickSample(kick.ref, true);
    }
    if (!p.mLvl) p.mLvl = 90;
    pushParams();
  }
  function pickSample(ref, quiet) {
    const s = ensure();
    s.params.mSample = ref;
    s.params.mSmpName = window.synthSampleInfo?.(ref)?.name || "";   // per l'avviso se il suono manca su un altro dispositivo
    pushParams();
    if (!quiet && node) queueMicrotask(() => sendSample(ref).then(() => { if (!playing) preview(params().sRoot ?? 60); }));
  }
  // Dal Sampler (pulsante Play on synth): il campione diventa l'oscillatore, da solo nel mixer, e si apre il Synthesizer.
  function useSample(ref) {
    if (!allowed) return false;
    pushUndo();
    const s = ensure();
    if (engineOf() === "tone") { stopTone(); s.engine = "custom"; }
    Object.assign(s.params, { mType: "sample", o1Lvl: 0, o2Lvl: 0, mLvl: s.params.mLvl || 90 });
    pickSample(ref, true);
    setView("synth");
    ensureAudio().then(() => { pushParams(); return sendSample(ref); }).then(() => { if (!playing) preview(params().sRoot ?? 60); }).catch(() => {});
    setStatus("synth: plays " + sampleName(ref));
    return true;
  }
  // Il campione e' stato modificato nell'editor: il worklet deve ricevere la versione nuova.
  function refreshSample(ref) {
    samplesSent.delete(ref); samplesReady.delete(ref);
    const p = params();
    if (node && p.mType === "sample" && p.mSample === ref) sendSample(ref);
    if (built && synthVisible()) renderParams();
  }
  function setParam(k, v, undo) {
    if (undo) pushUndo();
    ensure().params[k] = v;
    pushParams();
  }
  async function primeUnit() {
    const p = params();
    if (engineOf() === "custom" && p.mType === "sample" && p.mSample) { if (node) sendSample(p.mSample); return; }
    if (engineOf() !== "custom" || p.mType !== "logue") return;
    try { await unitModule(p.mUnit); } catch (e) { setStatus("synth: KORG unit " + p.mUnit + " not available", "err"); return; }
    if (node) sendUnit(p.mUnit);
  }
  async function renderUnitParams(box, p) {
    box.innerHTML = `<p class="syn-note">Loading the KORG unit…</p>`;
    let u;
    try { u = await unitModule(p.mUnit); } catch (e) { box.innerHTML = `<p class="syn-note">KORG unit "${esc(p.mUnit)}" not available.</p>`; return; }
    if (params().mUnit !== p.mUnit || !box.isConnected) return;
    box.innerHTML = `<p class="syn-note">${esc(u.info.name)} · the unit's own parameters (knob A and B first). Double-click resets.</p>`;
    const vals = (p.uParams && p.uParams[p.mUnit]) || {};
    for (const q of u.info.params) {
      if (!q.name) continue;
      const row = document.createElement("label"); row.className = "syn-p";
      const lab = document.createElement("span"); lab.className = "cap"; lab.textContent = q.name.toLowerCase();
      const r = document.createElement("input"), out = document.createElement("output");
      r.type = "range"; r.min = q.min; r.max = q.max; r.step = 1; r.value = vals[q.id] ?? q.init;
      const show = () => {
        const v = +r.value, s = u.info.str(q.id, v);
        out.value = s || (q.type === 1 ? (v / Math.pow(10, q.frac)).toFixed(q.frac ? 1 : 0) + "%" : String(v));
      };
      show();
      let armed = true;
      const setU = v => {
        const s = ensure(); s.params.uParams ||= {}; (s.params.uParams[p.mUnit] ||= {})[q.id] = v;
        if (node) node.port.postMessage({ t: "uparam", unit: p.mUnit, id: q.id, value: v });
        show();
      };
      r.addEventListener("input", () => { if (armed) { pushUndo(); armed = false; } setU(+r.value); });
      r.addEventListener("change", () => { armed = true; });
      r.addEventListener("dblclick", () => { pushUndo(); r.value = q.init; setU(q.init); });
      row.append(lab, r, out);
      box.appendChild(row);
    }
  }

  // ---------- piano roll ----------
  let rollCols = [], drag = null, lastPh = -1, lastPlayId;
  function rowsFor() {
    const sc = scaleNotes(), k = keyOf();
    const inScale = n => sc.includes(((n - k) % 12 + 12) % 12);
    const rows = [];
    if (view.fold) { for (let n = view.base; n <= Math.min(127, view.base + 36); n++) if (inScale(n)) rows.push(n); }
    else {
      // due ottave; tre se le note del pattern salgono oltre
      const hi = Math.max(0, ...(curSynth().synth || []).map(x => x.n));
      const span = hi > view.base + 24 && hi <= view.base + 36 ? 36 : 24;
      for (let n = view.base; n <= Math.min(127, view.base + span); n++) rows.push(n);
    }
    return { rows: rows.reverse(), inScale };
  }
  // Porta in vista le note del pattern se stanno fuori dalla finestra.
  function centerOn(pat) {
    const ns = (pat.synth || []).map(x => x.n);
    if (!ns.length) return;
    const lo = Math.min(...ns), hi = Math.max(...ns), top = view.base + 36;
    if (lo >= view.base && hi <= top) return;
    view.base = clamp(Math.floor(lo / 12) * 12, 0, 96); saveView();
  }
  // Nota suonata dal vivo fuori dalla finestra: la griglia si sposta di ottave intere finche' la nota si vede.
  function follow(n) {
    if (!built || !synthVisible() || drag) return;
    const from = view.base;
    for (let i = 0; i < 11; i++) {
      const { rows } = rowsFor(), top = rows[0], bottom = rows[rows.length - 1];
      if (!rows.length || (n >= bottom && n <= top)) break;
      const b = clamp(view.base + (n > top ? 12 : -12), 0, 96);
      if (b === view.base) break;
      view.base = b;
    }
    if (view.base !== from) { saveView(); renderRoll(); }
  }
  function renderRoll() {
    if (!built) return;
    const pat = curSynth(), roll = el("synRoll");
    el("synRecClear").hidden = !(pat.synth || []).some(x => x.k === "rec");
    const { rows, inScale } = rowsFor(), len = pat.len, k = keyOf();
    roll.style.gridTemplateColumns = `56px repeat(${len}, minmax(${len > 16 ? 16 : 22}px, 1fr))`;
    const cover = new Map();   // "nota:step" -> nota che copre la cella
    for (const x of pat.synth || []) for (let i = 0; i < x.l && x.s + i < len; i++)
      cover.set(x.n + ":" + (x.s + i), { x, start: i === 0, end: i === x.l - 1 || x.s + i === len - 1 });
    const parts = [];
    for (const n of rows) {
      const cls = "sr-key" + (isBlack(n) ? " black" : "") + ((n - k) % 12 === 0 ? " root" : "") + (inScale(n) ? "" : " out");
      parts.push(`<div class="${cls}" data-key="${n}" title="play ${noteName(n)}">${noteName(n)}</div>`);
      for (let s = 0; s < len; s++) {
        const c = cover.get(n + ":" + s);
        let cl = "sr-cell";
        if (isBlack(n)) cl += " black";
        if (!inScale(n)) cl += " out";
        if (s % 4 === 0 && s) cl += " beat";
        if (c) { cl += c.start ? " note" : " tie"; if (c.end) cl += " end"; if (c.x.a) cl += " acc"; if (c.x.g) cl += " slide"; }
        parts.push(`<div class="${cl}" data-n="${n}" data-s="${s}"></div>`);
      }
    }
    roll.innerHTML = parts.join("");
    window.paintWaveforms?.();
    rollCols = Array.from({ length: len }, () => []);
    roll.querySelectorAll(".sr-cell").forEach(c => rollCols[+c.dataset.s].push(c));
    lastPh = -1;
    const all = (pat.synth || []).map(x => x.n), top = rows[0], bottom = rows[rows.length - 1];
    const above = all.filter(n => n > top).length, below = all.filter(n => n < bottom).length;
    el("synRange").textContent = `${noteName(bottom)}–${noteName(top)}` + (above ? ` · ${above} above ↑` : "") + (below ? ` · ${below} below ↓` : "")
      + ` · ${all.length} ${all.length === 1 ? "note" : "notes"}`;
    paintTop();
    paintKeys();
  }
  const cellAt = (x, y) => { const t = document.elementFromPoint(x, y); return t && t.closest ? t.closest("#synRoll .sr-cell") : null; };
  function wireRoll() {
    const roll = el("synRoll");
    roll.addEventListener("pointerdown", e => {
      const key = e.target.closest(".sr-key");
      if (key) {
        const n = +key.dataset.key; liveOn(n);
        const up = () => { liveOff(n); removeEventListener("pointerup", up); };
        addEventListener("pointerup", up);
        return;
      }
      const cell = e.target.closest(".sr-cell");
      if (!cell || e.button > 0) return;
      e.preventDefault();
      const pat = curSynth(), n = +cell.dataset.n, s = +cell.dataset.s;
      const hit = (pat.synth || []).find(x => x.n === n && x.s <= s && s < x.s + x.l);
      const mode = e.altKey ? "acc" : (e.shiftKey ? "slide" : view.tap);
      if (mode !== "note") {
        if (!hit) return;
        pushUndo();
        const f = mode === "acc" ? "a" : "g";
        if (hit[f]) delete hit[f]; else hit[f] = 1;
        renderRoll();
        return;
      }
      pushUndo();
      ensure();   // il progetto ricorda il suono con cui sono state scritte le note
      if (hit) drag = { note: hit, from: s, moved: false, created: false };
      else {
        const note = { s, n, l: 1 };
        pat.synth.push(note);
        drag = { note, from: s, moved: false, created: true };
        preview(n);
        renderRoll();
      }
      try { roll.setPointerCapture(e.pointerId); } catch (err) {}
    });
    roll.addEventListener("pointermove", e => {
      if (!drag) return;
      const c = cellAt(e.clientX, e.clientY);
      if (!c) return;
      const s = +c.dataset.s;
      if (s === drag.from && !drag.moved) return;
      drag.moved = true;
      const l = clamp(s - drag.note.s + 1, 1, curSynth().len - drag.note.s);
      if (l !== drag.note.l) { drag.note.l = l; renderRoll(); }
    });
    const end = () => {
      if (!drag) return;
      const d = drag; drag = null;
      if (!d.created && !d.moved) {        // click su una nota senza trascinare: si toglie
        const pat = curSynth();
        pat.synth = (pat.synth || []).filter(x => x !== d.note);
        renderRoll();
      }
    };
    roll.addEventListener("pointerup", end);
    roll.addEventListener("pointercancel", end);
  }
  // Una nota breve per sentire cosa si e' scritto (a trasporto fermo).
  function preview(n) {
    if (playing) return;
    liveOn(n, 0.8);
    setTimeout(() => liveOff(n), Math.max(140, 60 / bpm() / 4 * 1000));
  }
  function auditionChord() {
    if (playing) return;
    const p = params(), notes = p.mode === "poly" ? triad(0, 48 + keyOf()) : [bassRoot()];
    notes.forEach(n => liveOn(n, 0.8));
    setTimeout(() => notes.forEach(liveOff), 450);
  }

  // ---------- tastiera a schermo ----------
  const TYPING_LABEL = Object.fromEntries(Object.entries(TYPING).map(([c, i]) => [i, c === "Semicolon" ? ";" : c.slice(3)]));
  function renderKeyboard() {
    if (!built) return;
    const box = el("synKbd"), base = typingBase();
    box.innerHTML = "";
    let lastWhite = null;
    for (let n = base; n <= base + 24 && n <= 127; n++) {
      const k = document.createElement("div");
      k.dataset.n = n;
      k.textContent = TYPING_LABEL[n - base] || "";
      if (isBlack(n)) { k.className = "kb"; if (lastWhite) lastWhite.appendChild(k); }
      else { k.className = "kw" + (n % 12 === 0 ? " c" : ""); k.dataset.name = noteName(n); box.appendChild(k); lastWhite = k; }
    }
    el("synKbdInfo").textContent = `Keys A W S E D F T G Y H U J K O L P ; · Z/X octave (from ${noteName(base)}) · shift = accent`;
    paintKeys();
  }
  function paintKeys() {
    if (!built) return;
    el("synKbd").querySelectorAll("[data-n]").forEach(k => k.classList.toggle("on", held.has(+k.dataset.n)));
    // la nota che si sta suonando si accende anche nel piano roll: nome a sinistra e tutta la riga
    const roll = el("synRoll");
    roll.querySelectorAll(".live").forEach(c => c.classList.remove("live"));
    for (const n of held.keys()) roll.querySelectorAll(`[data-key="${n}"], .sr-cell[data-n="${n}"]`).forEach(c => c.classList.add("live"));
  }
  function wireKeyboard() {
    const box = el("synKbd");
    let down = null;
    box.addEventListener("pointerdown", e => {
      const k = e.target.closest("[data-n]"); if (!k) return;
      e.preventDefault(); try { box.setPointerCapture(e.pointerId); } catch (err) {}
      down = +k.dataset.n; liveOn(down); follow(down);
    });
    box.addEventListener("pointermove", e => {
      if (down === null) return;
      const t = document.elementFromPoint(e.clientX, e.clientY), k = t && t.closest && t.closest("#synKbd [data-n]");
      if (k && +k.dataset.n !== down) { liveOff(down); down = +k.dataset.n; liveOn(down); follow(down); }
    });
    const up = () => { if (down !== null) { liveOff(down); down = null; } };
    box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up);
  }

  // ---------- ciclo di disegno: playhead, oscilloscopio, cambi di pattern/progetto ----------
  let lastPat = null, lastLen = 0, lastNotes = null, lastSynth, lastProject = null, scopeData = null, scopeColor = "", frames = 0;
  function frame() {
    requestAnimationFrame(frame);
    if (!allowed) return;
    if (!project) return;
    // progetto caricato, annulla/ripeti: il suono torna quello del progetto
    if (project !== lastProject || project.synth !== lastSynth) {
      const refresh = lastProject !== null;
      lastProject = project; lastSynth = project.synth;
      if (refresh) { pushParams(); if (synthVisible()) { renderParams(); paintTop(); } }
    }
    if (!synthVisible() || !built) return;
    const pat = curSynth();
    if (pat !== lastPat || pat.len !== lastLen || pat.synth !== lastNotes) {
      if (pat !== lastPat) { centerOn(pat); paintPatternBar(); }
      lastPat = pat; lastLen = pat.len; lastNotes = pat.synth;
      if (!drag) renderRoll();
    }
    const ph = playing && visible.synthId === pat.id ? visible.synthStep : -1;
    if (ph !== lastPh) {
      if (rollCols[lastPh]) rollCols[lastPh].forEach(c => c.classList.remove("ph"));
      if (rollCols[ph]) rollCols[ph].forEach(c => c.classList.add("ph"));
      lastPh = ph;
    }
    const playId = playing ? visible.synthId : null;
    if (playId !== lastPlayId) {
      lastPlayId = playId;
      el("synPatChips").querySelectorAll(".pattern-btn").forEach(b => b.classList.toggle("playing", b.dataset.id === playId));
    }
    if (analyser) {
      const cv = el("synScope");
      if (!cv.offsetParent) return;
      if (frames++ % 60 === 0) { const cs = getComputedStyle(document.documentElement); scopeColor = cs.getPropertyValue("--counter-fg").trim() || cs.getPropertyValue("--accent").trim(); }
      const g = cv.getContext("2d");
      scopeData ||= new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(scopeData);
      let start = 0;
      for (let i = 1; i < scopeData.length / 2; i++) if (scopeData[i - 1] <= 0 && scopeData[i] > 0) { start = i; break; }
      g.clearRect(0, 0, cv.width, cv.height);
      g.strokeStyle = scopeColor; g.lineWidth = 2; g.beginPath();
      const W = cv.width, H = cv.height, span = 480;
      for (let i = 0; i < span; i++) { const x = i / span * W, y = H / 2 - scopeData[start + i] * H * 0.45; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    }
  }

  // ---------- attivazione ----------
  function show() {
    if (!allowed) return;
    build();
    renderParams(); renderRoll(); renderKeyboard(); paintTop();
    (engineOf() === "tone" ? ensureTone() : ensureAudio()).catch(() => {});
    primeUnit();
  }
  function setAllowed(v) {
    allowed = !!v;
    el("viewSynth").hidden = !allowed;
    if (!allowed && !el("panelSynth").hidden) setView("grid");
  }

  listUnits().then(list => {
    if (list.length) unitOpts = list.map(u => [u, u]);
    if (built && synthVisible()) renderParams();
  });
  el("viewSynth").onclick = () => setView("synth");
  for (const id of ["masterVol", "synthVol"]) el(id).addEventListener("input", () => {
    if (chain) chain.apply(params(), bpm(), masterVol());
    if (toneSynth) applyToneParams(params());
  });
  requestAnimationFrame(frame);

  // Livello RMS dell'uscita del synth in questo momento (per le prove dalla console).
  function level() {
    if (!analyser) return 0;
    const d = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(d);
    return Math.sqrt(d.reduce((a, v) => a + v * v, 0) / d.length);
  }

  // Stato per le prove dalla console.
  const debug = () => ({ audio: !!node, sampleRate: node ? node.context.sampleRate : null,
    unitsSent: [...unitsSent], unitsReady: [...unitsReady], unitErrors: unitErrors.slice(-3),
    samplesSent: [...samplesSent.keys()], samplesReady: [...samplesReady] });

  window.PMSynth = { step, allOff, show, paint: paintTop, setAllowed, renamePattern: renameSynth, renderOffline, hasNotes, exportMidi, level, debug, midiNote, knob, knobTargets, currentPattern: () => curSynth(),
    useSample, refreshSample };
  setAllowed(true);
  window.paintGroupMS?.();   // M/S del synth nel trasporto: compaiono ora che il synth c'e'
})();
