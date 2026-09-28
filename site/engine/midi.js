// Tastiera MIDI collegata al computer (pensata per la AKAI MPK mini Play mk3, va bene con qualsiasi controller):
// i tasti suonano il synth, i pad le righe della batteria o i comandi del trasporto, le manopole volumi,
// tempo e parametri del synth. Usa Web MIDI (Chrome, Edge, Opera, Firefox; Safari no).
//
// Le assegnazioni stanno nel browser (localStorage "pm.midi.map"), non nel progetto: dipendono dalla tastiera, non dal brano.
//   map = {keys:{ch, to:"synth"|"off"}, pads:[{ch, n, to}], knobs:[{ch, cc, to}]}   ch 0 = qualsiasi canale, n/cc null = libero
//   pad:      "none" | "row:<i>" (riga i della griglia) | "play" "drums" "synth" "rec" "tap" "metro" "prev" "next"
//   manopola: "none" | "vol:drums" "vol:synth" "vol:master" | "bpm" "swing" "human" | "syn:<parametro del synth>"
// La vista "MIDI" (#panelMidi, la riempie questo script) serve a collegare, assegnare con Learn e leggere i messaggi.
//
// Usa dal sito (variabili globali dello script principale): el, project, hitPad, sampleLabel, curPattern, selectPattern,
// setView, setStatus, ask. Da engine/synth.js, se caricato: PMSynth.midiNote(), PMSynth.knob(), PMSynth.knobTargets().
(function () {
  "use strict";
  const MAP_KEY = "pm.midi.map", ON_KEY = "pm.midi.on";
  const PADS = 16, KNOBS = 8;
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

  // Come esce dalla fabbrica la MPK mini Play mk3: pad sul canale 10 (banco A 36-43, banco B 44-51), manopole CC 70-77.
  function defaults() {
    const padTo = i => i < 8 ? "row:" + i : PAD_ACTIONS[i - 8][0];
    const knobTo = ["syn:cutoff", "syn:reso", "syn:fEnv", "vol:synth", "syn:delay", "syn:reverb", "bpm", "vol:master"];
    return {
      keys: { ch: 0, to: "synth" },
      pads: Array.from({ length: PADS }, (_, i) => ({ ch: 10, n: 36 + i, to: padTo(i) })),
      knobs: Array.from({ length: KNOBS }, (_, i) => ({ ch: 0, cc: 70 + i, to: knobTo[i] })),
    };
  }
  function load() {
    const d = defaults();
    try {
      const m = JSON.parse(localStorage.getItem(MAP_KEY) || "null");
      if (!m) return d;
      if (m.keys) Object.assign(d.keys, m.keys);
      (m.pads || []).slice(0, PADS).forEach((p, i) => Object.assign(d.pads[i], p));
      (m.knobs || []).slice(0, KNOBS).forEach((k, i) => Object.assign(d.knobs[i], k));
    } catch (e) {}
    return d;
  }
  let map = load();
  const save = () => { try { localStorage.setItem(MAP_KEY, JSON.stringify(map)); } catch (e) { setStatus("MIDI: assignments can't be saved in this browser", "err"); } };

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
    access.onstatechange = () => { hook(); paint(); };
    try { localStorage.setItem(ON_KEY, "1"); } catch (e) {}
    const names = inputs().map(i => i.name);
    setStatus(names.length ? "MIDI: " + names.join(", ") : "MIDI: on, but no device connected");
    paint();
    return true;
  }
  function disconnect() {
    for (const i of inputs()) i.onmidimessage = null;
    if (access) access.onstatechange = null;
    access = null; learn = null;
    try { localStorage.removeItem(ON_KEY); } catch (e) {}
    setStatus("MIDI: off");
    paint(); renderMaps();
  }
  const toggle = () => access ? disconnect() : connect();

  // ---------- messaggi ----------
  const chOk = (want, ch) => !want || want === ch;
  let learn = null;   // {kind:"pad"|"knob", i}
  function onMessage(e) {
    const [st, d1 = 0, d2 = 0] = e.data;
    if (st >= 0xf0) return;                       // clock, sysex e simili: non servono qui
    const type = st & 0xf0, ch = (st & 15) + 1;
    const on = type === 0x90 && d2 > 0, off = type === 0x80 || (type === 0x90 && d2 === 0), cc = type === 0xb0;
    if (!on && !off && !cc) return;
    if (learn && (learn.kind === "pad" ? on : cc)) { learned(ch, d1); return; }
    if (on || off) {
      const i = map.pads.findIndex(p => p.n === d1 && chOk(p.ch, ch));
      if (i >= 0) { if (on) padAction(i, d2 / 127); monitor(ch, d1, d2, on ? "Note on" : "Note off", on ? "Pad " + (i + 1) : ""); return; }
      const toSynth = map.keys.to === "synth" && chOk(map.keys.ch, ch);
      if (toSynth && window.PMSynth && PMSynth.midiNote) PMSynth.midiNote(d1, on ? d2 / 127 : 0);
      monitor(ch, d1, d2, on ? "Note on" : "Note off", toSynth ? "Synth" : "");
      return;
    }
    const i = map.knobs.findIndex(k => k.cc === d1 && chOk(k.ch, ch));
    if (i >= 0) knobAction(i, d2);
    monitor(ch, d1, d2, "CC", i >= 0 ? "Knob " + (i + 1) : "");
  }

  function padAction(i, vel) {
    flash(i);
    const to = map.pads[i].to;
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

  function knobAction(i, raw) {
    const to = map.knobs[i].to, f = raw / 127;
    paintMeter(i, raw);
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
#panelMidi .midi-top{display:flex; flex-wrap:wrap; gap:8px; align-items:center;}
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
#panelMidi .mcard .mhead{display:flex; align-items:baseline; gap:6px;}
#panelMidi .mcard .mname{font-weight:700; font-size:12px;}
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
        <span class="midi-dev" id="midiDev"></span>
        <button id="midiReset" class="mini push" type="button" title="Back to the assignments for the AKAI MPK mini Play mk3 as it leaves the factory">Reset to MPK mini Play</button>
      </div>
      <p class="midi-help">Connect a MIDI keyboard by USB and press <b>Connect</b> (Chrome, Edge or Firefox; Safari can't read MIDI devices).
        The keys play the synth, pads and knobs do what you choose below. To assign one, press <b>Learn</b> and hit the pad or turn the knob.
        The assignments stay in this browser.</p>
      <div class="midi-mon" id="midiMon" aria-live="polite">No MIDI message yet</div>
      <h3>Keys</h3>
      <div class="midi-keys">
        <label class="fld">Play <select id="midiKeysTo"><option value="synth">Synthesizer</option><option value="off">Nothing</option></select></label>
        <label class="fld" title="Only notes on this MIDI channel play the synth (the pads of the MPK mini Play send on channel 10)">Channel <select id="midiKeysCh">${chOpts}</select></label>
        <span class="tiny" id="midiKeysNote"></span>
      </div>
      <h3>Pads <span>velocity-sensitive on the drum rows</span></h3>
      <div class="midi-grid" id="midiPads"></div>
      <h3>Knobs <span>the value follows the knob position</span></h3>
      <div class="midi-grid" id="midiKnobs"></div>`;
    el("midiConnect").onclick = toggle;
    el("midiReset").onclick = async () => {
      const yes = await ask({ title: "Reset the MIDI assignments?", message: "Pads and knobs go back to the factory settings of the AKAI MPK mini Play mk3.", ok: "Reset", danger: true });
      if (!yes) return;
      map = defaults(); learn = null; save(); renderMaps(); setStatus("MIDI: assignments reset");
    };
    el("midiKeysTo").onchange = e => { map.keys.to = e.target.value; save(); paintKeysNote(); };
    el("midiKeysCh").onchange = e => { map.keys.ch = +e.target.value; save(); };
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
  const list = kind => kind === "pad" ? map.pads : map.knobs;
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
    const learning = learn && learn.kind === kind && learn.i === i, name = (kind === "pad" ? "Pad " : "Knob ") + (i + 1);
    const src = kind === "pad"
      ? (item.n == null ? "not set" : `ch ${item.ch || "any"} · ${noteName(item.n)} (${item.n})`)
      : (item.cc == null ? "not set" : `ch ${item.ch || "any"} · CC ${item.cc}`);
    return `<div class="mcard${learning ? " learning" : ""}" data-i="${i}">
      <div class="mhead"><span class="mname">${name}</span><span class="msrc">${learning ? (kind === "pad" ? "hit a pad…" : "turn a knob…") : src}</span></div>
      <select aria-label="${name}">${opts}</select>
      ${kind === "knob" ? `<div class="mmeter"><i></i></div>` : ""}
      <div class="macts"><button type="button" class="mini learn${learning ? " on" : ""}" title="Then hit the pad or turn the knob on the keyboard (Esc cancels)">${learning ? "Cancel" : "Learn"}</button>
        <button type="button" class="mini clear" title="Free this ${kind}" aria-label="Free ${name}">×</button></div></div>`;
  }
  function renderMaps() {
    if (!built) return;
    const po = padOptions(), ko = knobOptions();
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
    el("midiKeysNote").textContent = map.keys.to === "synth" && !window.PMSynth ? "the synth is available when you are signed in" : "";
  }
  async function startLearn(kind, i) {
    if (learn && learn.kind === kind && learn.i === i) { learn = null; renderMaps(); return; }
    if (!access && !(await connect())) return;
    learn = { kind, i };
    renderMaps();
  }
  function learned(ch, num) {
    const { kind, i } = learn, items = list(kind), f = kind === "pad" ? "n" : "cc";
    // lo stesso pad o la stessa manopola non comandano due cose: chi li aveva prima resta libero
    items.forEach((x, j) => { if (j !== i && x[f] === num && chOk(x.ch, ch)) x[f] = null; });
    items[i].ch = ch; items[i][f] = num;
    learn = null; save(); renderMaps();
    setStatus(`MIDI: ${kind} ${i + 1} = ch ${ch} · ${kind === "pad" ? noteName(num) + " (" + num + ")" : "CC " + num}`);
  }

  const viewOpen = () => built && !el("panelMidi").hidden;
  function monitor(ch, d1, d2, what, dest) {
    if (!viewOpen()) return;
    const body = what === "CC" ? `CC ${d1} · value ${d2}` : `${noteName(d1)} (${d1})` + (what === "Note on" ? ` · velocity ${d2}` : "");
    el("midiMon").textContent = `${what} · ch ${ch} · ${body}` + (dest ? "  →  " + dest : "");
  }
  function flash(i) {
    if (!viewOpen()) return;
    const c = el("midiPads").querySelector(`.mcard[data-i="${i}"]`);
    if (!c) return;
    c.classList.add("hit"); clearTimeout(c._t); c._t = setTimeout(() => c.classList.remove("hit"), 110);
  }
  function paintMeter(i, raw) {
    if (!viewOpen()) return;
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
    el("midiDev").innerHTML = !access ? "not connected" : names.length ? "Connected: <b>" + names.join("</b>, <b>") + "</b>" : "on, but no MIDI device connected";
  }
  function show() { build(); renderMaps(); paint(); }

  // Un'altra scheda del sito ha cambiato le assegnazioni: valgono anche qui.
  addEventListener("storage", e => { if (e.key === MAP_KEY) { map = load(); renderMaps(); } });

  el("viewMidi").hidden = !navigator.requestMIDIAccess;
  el("viewMidi").onclick = () => setView("midi");
  // Se l'ultima volta era collegata e il permesso c'e' gia', si ricollega senza chiedere niente.
  try {
    if (localStorage.getItem(ON_KEY) && navigator.requestMIDIAccess && navigator.permissions)
      navigator.permissions.query({ name: "midi" }).then(s => { if (s.state === "granted") connect(true); }).catch(() => {});
  } catch (e) {}

  window.PMMidi = { toggle, connect, show, paint, get connected() { return !!access; } };
})();
