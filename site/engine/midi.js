// Tastiere MIDI collegate al computer (profili per AKAI MPK mini Play mk3 e Arturia MiniLab 3, piu' uno per le altre):
// i tasti suonano il synth, i pad le righe della batteria o i comandi del trasporto, le manopole volumi,
// tempo e parametri del synth. Usa Web MIDI (Chrome, Edge, Opera, Firefox; Safari no).
//
// Le assegnazioni stanno nel browser (localStorage "pm.midi.maps"), non nel progetto: dipendono dalla tastiera, non dal brano.
// Una mappa per profilo, scelto dal nome della porta MIDI: le due tastiere mandano i pad sulle stesse note del canale 10.
//   maps = {mpk: map, minilab3: map, other: map}
//   map = {keys:{ch, to:"synth"|"off"}, pads:[{ch, n, to}], knobs:[{ch, cc, to}]}   ch 0 = qualsiasi canale, n/cc null = libero
//   pad:      "none" | "row:<i>" (riga i della griglia) | "play" "drums" "synth" "rec" "tap" "metro" "prev" "next"
//   manopola: "none" | "vol:drums" "vol:synth" "vol:master" | "bpm" "swing" "human" | "syn:<parametro del synth>"
// La vista "MIDI" (#panelMidi, la riempie questo script) serve a collegare, assegnare con Learn e leggere i messaggi.
//
// Usa dal sito (variabili globali dello script principale): el, project, hitPad, sampleLabel, curPattern, selectPattern,
// setView, setStatus, ask. Da engine/synth.js, se caricato: PMSynth.midiNote(), PMSynth.knob(), PMSynth.knobTargets().
(function () {
  "use strict";
  const MAPS_KEY = "pm.midi.maps", OLD_MAP_KEY = "pm.midi.map", ON_KEY = "pm.midi.on";
  const PADS = 16;
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const noteName = n => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2);   // come in Logic: 60 = C3
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const clamp = (x, a, b) => x < a ? a : (x > b ? b : x);

  const PAD_ACTIONS = [["play", "Play / Stop"], ["drums", "Play Solo Drums"], ["synth", "Play solo Synth"], ["rec", "Rec"],
    ["tap", "Tap tempo"], ["metro", "Metronome"], ["prev", "Previous pattern"], ["next", "Next pattern"]];
  const PAD_BUTTONS = { play: "playBtn", drums: "drumsPlayBtn", synth: "synthPlayBtn", rec: "recBtn", tap: "tapBtn", metro: "metronomeBtn" };
  const KNOB_GENERAL = [["vol:drums", "Vol. drums"], ["vol:synth", "Vol. synth"], ["vol:master", "Vol. general"],
    ["bpm", "BPM"], ["swing", "Swing"], ["human", "Humanize"]];
  const KNOB_RANGES = { "vol:drums": "drumsVol", "vol:synth": "synthVol", "vol:master": "masterVol", bpm: "bpmRange", swing: "swingRange", human: "humanRange" };

  // Profili delle tastiere, con le assegnazioni di fabbrica. Pad: banco A note 36-43, banco B 44-51, canale 10.
  //   MPK mini Play mk3: manopole CC 70-77.
  //   MiniLab 3 (modo Arturia): manopole CC 74 71 76 77 93 18 19 16, fader CC 82 83 85 17.
  const PROFILES = {
    mpk: { name: "AKAI MPK mini Play mk3", match: /mpk\s*mini\s*play/i,
      controls: Array.from({ length: 8 }, (_, i) => "Knob " + (i + 1)),
      cc: [70, 71, 72, 73, 74, 75, 76, 77],
      to: ["syn:cutoff", "syn:reso", "syn:fEnv", "vol:synth", "syn:delay", "syn:reverb", "bpm", "vol:master"] },
    minilab3: { name: "Arturia MiniLab 3", match: /mini\s*lab\s*3/i,
      controls: [...Array.from({ length: 8 }, (_, i) => "Knob " + (i + 1)), ...Array.from({ length: 4 }, (_, i) => "Fader " + (i + 1))],
      cc: [74, 71, 76, 77, 93, 18, 19, 16, 82, 83, 85, 17],
      to: ["syn:cutoff", "syn:reso", "syn:fEnv", "syn:eD", "syn:delay", "syn:reverb", "syn:chorus", "bpm",
        "vol:drums", "vol:synth", "vol:master", "swing"] },
    other: { name: "Other MIDI devices", match: null,
      controls: Array.from({ length: 8 }, (_, i) => "Knob " + (i + 1)),
      cc: [70, 71, 72, 73, 74, 75, 76, 77],
      to: ["syn:cutoff", "syn:reso", "syn:fEnv", "vol:synth", "syn:delay", "syn:reverb", "bpm", "vol:master"] },
  };
  const profileOf = name => Object.keys(PROFILES).find(id => PROFILES[id].match && PROFILES[id].match.test(name || "")) || "other";
  function defaults(pid) {
    const pr = PROFILES[pid], padTo = i => i < 8 ? "row:" + i : PAD_ACTIONS[i - 8][0];
    return {
      keys: { ch: 0, to: "synth" },
      pads: Array.from({ length: PADS }, (_, i) => ({ ch: 10, n: 36 + i, to: padTo(i) })),
      knobs: pr.cc.map((cc, i) => ({ ch: 0, cc, to: pr.to[i] })),
    };
  }
  function merge(d, m) {
    if (!m) return d;
    if (m.keys) Object.assign(d.keys, m.keys);
    (m.pads || []).slice(0, d.pads.length).forEach((p, i) => Object.assign(d.pads[i], p));
    (m.knobs || []).slice(0, d.knobs.length).forEach((k, i) => Object.assign(d.knobs[i], k));
    return d;
  }
  function load() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(MAPS_KEY) || "null");
      // prima c'era una sola mappa, fatta per la MPK mini Play
      if (!saved) saved = { mpk: JSON.parse(localStorage.getItem(OLD_MAP_KEY) || "null") };
    } catch (e) { saved = {}; }
    return Object.fromEntries(Object.keys(PROFILES).map(id => [id, merge(defaults(id), saved && saved[id])]));
  }
  let maps = load();
  // Le assegnazioni restano nel browser da una sessione all'altra; persist() chiede al browser di non cancellarle
  // da solo quando libera spazio (resta possibile cancellarle a mano con i dati del sito).
  let persistAsked = false;
  function save() {
    try { localStorage.setItem(MAPS_KEY, JSON.stringify(maps)); }
    catch (e) { setStatus("MIDI: assignments can't be saved in this browser", "err"); return; }
    if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); }
  }
  let shown = null;   // profilo mostrato nella vista MIDI

  // ---------- collegamento ----------
  let access = null;
  const inputs = () => access ? [...access.inputs.values()] : [];
  function hook() { for (const i of inputs()) i.onmidimessage = onMessage; }
  async function connect(quiet) {
    if (access) return true;
    if (!navigator.requestMIDIAccess) {
      if (!quiet) setStatus("MIDI: this browser can't read MIDI devices (use Chrome, Edge or Firefox)", "err");
      return false;
    }
    try { access = await navigator.requestMIDIAccess(); }
    catch (e) { access = null; if (!quiet) setStatus("MIDI: access refused", "err"); paint(); return false; }
    hook();
    access.onstatechange = () => { hook(); paint(); renderMaps(); };
    try { localStorage.setItem(ON_KEY, "1"); } catch (e) {}
    const names = inputs().map(i => i.name);
    if (names.length) setStatus("MIDI: " + names.join(", "));
    paint();
    return true;
  }
  function disconnect() {
    for (const i of inputs()) i.onmidimessage = null;
    if (access) access.onstatechange = null;
    access = null; learn = null;
    try { localStorage.removeItem(ON_KEY); } catch (e) {}
    paint(); renderMaps();
  }
  const toggle = () => access ? disconnect() : connect();

  // ---------- messaggi ----------
  const chOk = (want, ch) => !want || want === ch;
  let learn = null;   // {pid, kind:"pad"|"knob", i}
  let lastPid = null;
  function onMessage(e) {
    const [st, d1 = 0, d2 = 0] = e.data;
    if (st >= 0xf0) return;                       // clock, sysex e simili: non servono qui
    const type = st & 0xf0, ch = (st & 15) + 1;
    const on = type === 0x90 && d2 > 0, off = type === 0x80 || (type === 0x90 && d2 === 0), cc = type === 0xb0;
    if (!on && !off && !cc) return;
    const pid = profileOf(e.target && e.target.name), map = maps[pid], dev = e.target && e.target.name || "";
    lastPid = pid;
    if (learn && learn.pid === pid && (learn.kind === "pad" ? on : cc)) { learned(ch, d1); return; }
    if (on || off) {
      const i = map.pads.findIndex(p => p.n === d1 && chOk(p.ch, ch));
      if (i >= 0) { if (on) padAction(pid, i, d2 / 127); monitor(dev, pid, ch, d1, d2, on ? "Note on" : "Note off", on ? "Pad " + (i + 1) : ""); return; }
      const toSynth = map.keys.to === "synth" && chOk(map.keys.ch, ch);
      if (toSynth && window.PMSynth && PMSynth.midiNote) PMSynth.midiNote(d1, on ? d2 / 127 : 0);
      monitor(dev, pid, ch, d1, d2, on ? "Note on" : "Note off", toSynth ? "Synth" : "");
      return;
    }
    const i = map.knobs.findIndex(k => k.cc === d1 && chOk(k.ch, ch));
    if (i >= 0) knobAction(pid, i, d2);
    monitor(dev, pid, ch, d1, d2, "CC", i >= 0 ? PROFILES[pid].controls[i] : "");
  }

  function padAction(pid, i, vel) {
    flash(pid, i);
    const to = maps[pid].pads[i].to;
    if (to.startsWith("row:")) {
      const r = +to.slice(4);
      if (project.tracks[r]) hitPad(r, Math.max(0.15, vel));
      return;
    }
    if (to === "prev" || to === "next") {
      const ps = project.patterns, k = ps.indexOf(curPattern());
      const p = ps[(k + (to === "next" ? 1 : -1) + ps.length) % ps.length];
      if (p) { selectPattern(p.id); setStatus("pattern: " + p.name); }
      return;
    }
    const btn = el(PAD_BUTTONS[to]);
    if (!btn) return;
    // Rec scrive nella griglia o nelle note del synth: dalle altre viste resterebbe acceso senza vederlo
    if (to === "rec" && btn.hidden) { setStatus("Rec works in the Drum Grid and in the Synthesizer"); return; }
    btn.click();
  }

  function knobAction(pid, i, raw) {
    const to = maps[pid].knobs[i].to, f = raw / 127;
    paintMeter(pid, i, raw);
    let msg = null;
    if (to.startsWith("syn:")) msg = window.PMSynth && PMSynth.knob ? PMSynth.knob(to.slice(4), f) : null;
    else if (KNOB_RANGES[to]) {
      const r = el(KNOB_RANGES[to]), lo = +r.min, hi = +r.max, v = Math.round(lo + f * (hi - lo));
      if (+r.value !== v) { r.value = v; r.dispatchEvent(new Event("input", { bubbles: true })); }
      msg = labelOf(to) + " " + (to === "swing" ? el("swingPct").textContent : v);
    }
    if (msg) setStatus(msg);
  }

  // ---------- vista ----------
  let built = false;
  const CSS = `
#panelMidi .midi-top{display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center;}
#panelMidi .midi-dev{font-size:12px; color:var(--text-dim);}
#panelMidi .midi-dev b{color:var(--text);}
#panelMidi .midi-top .push{margin-left:auto;}
#panelMidi .midi-help{font-size:12px; color:var(--text-dim); margin:9px 0 4px; max-width:760px; line-height:1.5;}
#panelMidi .midi-mon{font:11.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--text-dim); background:var(--panel-2);
  border:1px solid var(--edge-soft); border-radius:6px; padding:6px 9px; margin:8px 0 4px; min-height:30px; box-sizing:border-box; overflow-wrap:anywhere;}
#panelMidi h3{font-size:9.5px; letter-spacing:0.16em; text-transform:uppercase; color:var(--text-dim); margin:16px 0 8px; font-weight:700;}
#panelMidi h3 span{letter-spacing:0.04em; text-transform:none; font-weight:400; margin-left:6px;}
#panelMidi .midi-keys{display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center;}
#panelMidi .midi-grid{display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px;}
#panelMidi .midi-bank{font-size:9px; letter-spacing:0.14em; text-transform:uppercase; color:var(--text-faint); grid-column:1/-1; margin-top:4px;}
#panelMidi .mcard{border:1px solid var(--edge); border-radius:8px; background:var(--panel-2); padding:8px; display:flex; flex-direction:column; gap:6px; min-width:0;
  transition:background .12s, border-color .12s;}
#panelMidi .mcard.hit{background:var(--accent); border-color:var(--accent-dim); color:var(--on-accent);}
#panelMidi .mcard.learning{border-color:var(--accent); box-shadow:0 0 0 2px var(--accent) inset;}
#panelMidi .mcard .mhead{display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 6px;}
#panelMidi .mcard .mname{font-weight:700; font-size:12px; white-space:nowrap;}
#panelMidi .mcard .msrc{font:10.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--text-faint); margin-left:auto; white-space:nowrap;}
#panelMidi .mcard.hit .msrc{color:inherit;}
#panelMidi .mcard select{width:100%; min-width:0;}
#panelMidi .mcard .macts{display:flex; gap:5px;}
#panelMidi .mcard .macts .learn{flex:1;}
#panelMidi .mcard .learn.on{background:var(--accent); color:var(--on-accent); border-color:var(--accent-dim);}
#panelMidi .mmeter{height:4px; border-radius:2px; background:var(--led-off); overflow:hidden;}
#panelMidi .mmeter i{display:block; height:100%; width:0; background:var(--led-on);}
#viewMidi.linked::after{content:""; display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--ok); margin-left:7px; vertical-align:1px;}
@media (max-width:720px){ #panelMidi .midi-grid{grid-template-columns:repeat(2,minmax(0,1fr));} }
`;
  function build() {
    if (built) return;
    built = true;
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    const chOpts = `<option value="0">any</option>` + Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
    el("panelMidi").innerHTML = `
      <h2>MIDI controller</h2>
      <div class="midi-top">
        <button id="midiConnect" class="primary" type="button">Connect</button>
        <label class="fld" title="Each keyboard has its own assignments; playing a keyboard shows its own">Keyboard <select id="midiProfile"></select></label>
        <span class="midi-dev" id="midiDev"></span>
        <button id="midiReset" class="mini push" type="button" title="Back to the assignments of this keyboard as it leaves the factory">Factory assignments</button>
      </div>
      <p class="midi-help">Connect a MIDI keyboard by USB and press <b>Connect</b> (Chrome, Edge or Firefox; Safari can't read MIDI devices).
        The keys play the synth, pads and knobs do what you choose below. To assign one, press <b>Learn</b> and hit the pad or turn the knob.
        Each keyboard (AKAI MPK mini Play mk3, Arturia MiniLab 3, any other) keeps its own assignments in this browser.</p>
      <div class="midi-mon" id="midiMon" aria-live="polite">No MIDI message yet</div>
      <h3>Keys</h3>
      <div class="midi-keys">
        <label class="fld">Play <select id="midiKeysTo"><option value="synth">Synthesizer</option><option value="off">Nothing</option></select></label>
        <label class="fld" title="Only notes on this MIDI channel play the synth (the pads of the MPK mini Play and of the MiniLab 3 send on channel 10)">Channel <select id="midiKeysCh">${chOpts}</select></label>
        <span class="tiny" id="midiKeysNote"></span>
      </div>
      <h3>Pads <span>velocity-sensitive on the drum rows</span></h3>
      <div class="midi-grid" id="midiPads"></div>
      <h3 id="midiKnobsTitle">Knobs</h3>
      <div class="midi-grid" id="midiKnobs"></div>`;
    el("midiConnect").onclick = toggle;
    el("midiProfile").onchange = e => { shown = e.target.value; learn = null; renderMaps(); };
    el("midiReset").onclick = async () => {
      const name = PROFILES[shown].name;
      const yes = await ask({ title: "Reset the MIDI assignments?", message: `Keys, pads and knobs of the ${name} go back to the factory settings.`, ok: "Reset", danger: true });
      if (!yes) return;
      maps[shown] = defaults(shown); learn = null; save(); renderMaps(); setStatus("MIDI: assignments of the " + name + " reset");
    };
    el("midiKeysTo").onchange = e => { cur().keys.to = e.target.value; save(); paintKeysNote(); };
    el("midiKeysCh").onchange = e => { cur().keys.ch = +e.target.value; save(); };
    for (const kind of ["pad", "knob"]) {
      const box = el(kind === "pad" ? "midiPads" : "midiKnobs");
      box.addEventListener("change", e => {
        const c = e.target.closest(".mcard"); if (!c) return;
        list(kind)[+c.dataset.i].to = e.target.value; save();
      });
      box.addEventListener("click", e => {
        const b = e.target.closest("button"), c = b && b.closest(".mcard"); if (!c) return;
        const i = +c.dataset.i;
        if (b.classList.contains("learn")) startLearn(kind, i);
        else if (b.classList.contains("clear")) {
          const item = list(kind)[i];
          if (kind === "pad") item.n = null; else item.cc = null;
          if (learn && learn.kind === kind && learn.i === i) learn = null;
          save(); renderMaps();
        }
      });
    }
    document.addEventListener("keydown", e => { if (e.key === "Escape" && learn) { learn = null; renderMaps(); } });
  }
  const cur = () => maps[shown];
  const list = (kind, pid = shown) => kind === "pad" ? maps[pid].pads : maps[pid].knobs;
  const labelOf = to => (KNOB_GENERAL.find(([v]) => v === to) || [, to])[1];

  function padOptions() {
    const rows = Math.max(16, project.tracks.length);
    const rowOpts = Array.from({ length: rows }, (_, r) => {
      const t = project.tracks[r], name = t && typeof sampleLabel === "function" ? " · " + sampleLabel(t.sampleIndex) : " · (empty)";
      return `<option value="row:${r}">Row ${r + 1}${esc(name)}</option>`;
    }).join("");
    return `<option value="none">Nothing</option><optgroup label="Drums">${rowOpts}</optgroup>` +
      `<optgroup label="Transport">${PAD_ACTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</optgroup>`;
  }
  function knobOptions() {
    let html = `<option value="none">Nothing</option><optgroup label="General">${KNOB_GENERAL.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</optgroup>`;
    const syn = window.PMSynth && PMSynth.knobTargets ? PMSynth.knobTargets() : [];
    const bySec = new Map();
    for (const t of syn) { if (!bySec.has(t.section)) bySec.set(t.section, []); bySec.get(t.section).push(t); }
    for (const [sec, ts] of bySec) html += `<optgroup label="Synth · ${esc(sec)}">${ts.map(t => `<option value="syn:${t.k}">${esc(sec)} · ${esc(t.label)}</option>`).join("")}</optgroup>`;
    return html;
  }
  function card(kind, i, item, opts) {
    const learning = learn && learn.kind === kind && learn.i === i, name = kind === "pad" ? "Pad " + (i + 1) : PROFILES[shown].controls[i];
    const src = kind === "pad"
      ? (item.n == null ? "not set" : `ch ${item.ch || "any"} · ${noteName(item.n)} (${item.n})`)
      : (item.cc == null ? "not set" : `ch ${item.ch || "any"} · CC ${item.cc}`);
    return `<div class="mcard${learning ? " learning" : ""}" data-i="${i}">
      <div class="mhead"><span class="mname">${name}</span><span class="msrc">${learning ? (kind === "pad" ? "hit a pad…" : "move it…") : src}</span></div>
      <select aria-label="${name}">${opts}</select>
      ${kind === "knob" ? `<div class="mmeter"><i></i></div>` : ""}
      <div class="macts"><button type="button" class="mini learn${learning ? " on" : ""}" title="Then hit the pad or move the knob or fader on the keyboard (Esc cancels)">${learning ? "Cancel" : "Learn"}</button>
        <button type="button" class="mini clear" title="Free ${name}" aria-label="Free ${name}">×</button></div></div>`;
  }
  function renderMaps() {
    if (!built) return;
    const po = padOptions(), ko = knobOptions(), map = cur();
    const opts = Object.keys(PROFILES).map(id => {
      const on = inputs().some(i => profileOf(i.name) === id && id !== "other");
      return `<option value="${id}">${esc(PROFILES[id].name)}${on ? " · connected" : ""}</option>`;
    }).join("");
    el("midiProfile").innerHTML = opts; el("midiProfile").value = shown;
    const faders = PROFILES[shown].controls.some(c => c.startsWith("Fader"));
    el("midiKnobsTitle").innerHTML = (faders ? "Knobs and faders" : "Knobs") + " <span>the value follows the knob position</span>";
    el("midiPads").innerHTML = map.pads.map((p, i) =>
      (i === 0 ? `<div class="midi-bank">Bank A</div>` : i === 8 ? `<div class="midi-bank">Bank B</div>` : "") + card("pad", i, p, po)).join("");
    el("midiKnobs").innerHTML = map.knobs.map((k, i) => card("knob", i, k, ko)).join("");
    for (const kind of ["pad", "knob"]) {
      el(kind === "pad" ? "midiPads" : "midiKnobs").querySelectorAll(".mcard").forEach(c => {
        const s = c.querySelector("select"), to = list(kind)[+c.dataset.i].to;
        // assegnata a un parametro del synth quando il synth non e' caricato: la si tiene, con il suo nome
        if (![...s.options].some(o => o.value === to)) s.add(new Option(to.startsWith("syn:") ? "Synth · " + to.slice(4) : to, to));
        s.value = to;
      });
    }
    el("midiKeysTo").value = map.keys.to; el("midiKeysCh").value = String(map.keys.ch || 0);
    paintKeysNote();
  }
  function paintKeysNote() {
    if (!built) return;
    el("midiKeysNote").textContent = cur().keys.to === "synth" && !window.PMSynth ? "the synth is available when you are signed in" : "";
  }
  async function startLearn(kind, i) {
    if (learn && learn.kind === kind && learn.i === i) { learn = null; renderMaps(); return; }
    if (!access && !(await connect())) return;
    learn = { pid: shown, kind, i };
    renderMaps();
  }
  function learned(ch, num) {
    const { pid, kind, i } = learn, items = list(kind, pid), f = kind === "pad" ? "n" : "cc";
    // lo stesso pad o la stessa manopola non comandano due cose: chi li aveva prima resta libero
    items.forEach((x, j) => { if (j !== i && x[f] === num && chOk(x.ch, ch)) x[f] = null; });
    items[i].ch = ch; items[i][f] = num;
    learn = null; save(); renderMaps();
    setStatus(`MIDI: ${kind === "pad" ? "pad " + (i + 1) : PROFILES[pid].controls[i].toLowerCase()} = ch ${ch} · ${kind === "pad" ? noteName(num) + " (" + num + ")" : "CC " + num}`);
  }

  const viewOpen = () => built && !el("panelMidi").hidden;
  function monitor(dev, pid, ch, d1, d2, what, dest) {
    if (!viewOpen()) return;
    // si suona un'altra tastiera: la vista passa alle sue assegnazioni (non durante Learn)
    if (pid !== shown && !learn) { shown = pid; renderMaps(); }
    const body = what === "CC" ? `CC ${d1} · value ${d2}` : `${noteName(d1)} (${d1})` + (what === "Note on" ? ` · velocity ${d2}` : "");
    el("midiMon").textContent = `${dev ? dev + " · " : ""}${what} · ch ${ch} · ${body}` + (dest ? "  →  " + dest : "");
  }
  function flash(pid, i) {
    if (!viewOpen() || pid !== shown) return;
    const c = el("midiPads").querySelector(`.mcard[data-i="${i}"]`);
    if (!c) return;
    c.classList.add("hit"); clearTimeout(c._t); c._t = setTimeout(() => c.classList.remove("hit"), 110);
  }
  function paintMeter(pid, i, raw) {
    if (!viewOpen() || pid !== shown) return;
    const m = el("midiKnobs").querySelector(`.mcard[data-i="${i}"] .mmeter i`);
    if (m) m.style.width = clamp(raw / 127 * 100, 0, 100) + "%";
  }

  function paint() {
    const tab = el("viewMidi");
    if (tab) tab.classList.toggle("linked", !!access);
    const syn = el("synMidiIn");
    if (syn) { syn.classList.toggle("on", !!access); syn.setAttribute("aria-pressed", String(!!access)); }
    if (!built) return;
    el("midiConnect").textContent = access ? "Disconnect" : "Connect";
    el("midiConnect").className = access ? "" : "primary";
    const names = inputs().map(i => esc(i.name));
    el("midiDev").innerHTML = names.length ? "Connected: <b>" + names.join("</b>, <b>") + "</b>" : "";
  }
  function show() {
    build();
    if (!shown) {
      const named = inputs().map(i => profileOf(i.name)).find(id => id !== "other");
      shown = lastPid || named || "mpk";
    }
    renderMaps(); paint();
  }

  // Un'altra scheda del sito ha cambiato le assegnazioni: valgono anche qui.
  addEventListener("storage", e => { if (e.key === MAPS_KEY) { maps = load(); renderMaps(); } });

  el("viewMidi").hidden = !navigator.requestMIDIAccess;
  el("viewMidi").onclick = () => setView("midi");
  // Se l'ultima volta era collegata e il permesso c'e' gia', si ricollega senza chiedere niente.
  try {
    if (localStorage.getItem(ON_KEY) && navigator.requestMIDIAccess && navigator.permissions)
      navigator.permissions.query({ name: "midi" }).then(s => { if (s.state === "granted") connect(true); }).catch(() => {});
  } catch (e) {}

  window.PMMidi = { toggle, connect, show, paint, get connected() { return !!access; } };
})();
