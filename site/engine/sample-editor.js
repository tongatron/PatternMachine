// Editor del Sampler a tutto schermo: forma d'onda grande con zoom, selezione, trim, dissolvenze, normalizzazione,
// guadagno, inversione, pulizia dei silenzi e "12 bit" alla SP-1200. Lavora su una copia: il campione cambia solo con
// Save (stesso suono, anche nei progetti e nel synth che lo usano) o Save as new (un nuovo campione nel Sampler).
//
// Lo apre engine/sampler.js: PMSampleEditor.open({name, buffer, save(blob, audio), saveAsNew(blob, audio, name)}).
// save/saveAsNew ricevono il WAV (Blob, 16 bit) e l'AudioBuffer gia' pronto; saveAsNew restituisce {name, save} del
// nuovo campione, che da li' in poi e' quello che si sta modificando.
// Le funzioni sul suono (dsp) sono pure: le prova tests/sample-editor.test.js.
// Usa dal sito (globali): actx, ask, saveBlob.
(function () {
  "use strict";
  const clamp = (x, a, b) => x < a ? a : (x > b ? b : x);

  // ---------- suono: canali come Float32Array, intervalli [a, b) in campioni ----------
  const dsp = {
    peak(chs, a = 0, b = chs[0].length) {
      let p = 0;
      for (const c of chs) for (let i = a; i < b; i++) { const v = Math.abs(c[i]); if (v > p) p = v; }
      return p;
    },
    crop: (chs, a, b) => chs.map(c => c.slice(a, b)),
    remove(chs, a, b) {
      return chs.map(c => { const o = new Float32Array(c.length - (b - a)); o.set(c.subarray(0, a)); o.set(c.subarray(b), a); return o; });
    },
    map(chs, a, b, fn) {
      return chs.map(c => { const o = c.slice(); for (let i = a; i < b; i++) o[i] = fn(o[i], i); return o; });
    },
    silence: (chs, a, b) => dsp.map(chs, a, b, () => 0),
    gain: (chs, a, b, g) => dsp.map(chs, a, b, v => clamp(v * g, -1, 1)),
    // curva a coseno: parte e arriva senza scalini
    fade(chs, a, b, dir) {
      const n = Math.max(1, b - a - 1);
      return dsp.map(chs, a, b, (v, i) => { const t = (i - a) / n; return v * (1 - Math.cos(Math.PI * (dir === "in" ? t : 1 - t))) / 2; });
    },
    normalize(chs, a, b, target = 0.989) {     // -0,1 dB
      const p = dsp.peak(chs, a, b);
      return p > 0 ? dsp.map(chs, a, b, v => v * target / p) : chs;
    },
    reverse(chs, a, b) {
      return chs.map(c => { const o = c.slice(); for (let i = a, j = b - 1; i < j; i++, j--) { const t = o[i]; o[i] = o[j]; o[j] = t; } return o; });
    },
    // La parte udibile: dal primo all'ultimo campione sopra la soglia (dBFS), con un piccolo margine. null se e' silenzio.
    audible(chs, sr, db = -48, preMs = 2, postMs = 12) {
      const th = Math.pow(10, db / 20), len = chs[0].length, loud = i => chs.some(c => Math.abs(c[i]) > th);
      let a = 0, b = len - 1;
      while (a < len && !loud(a)) a++;
      if (a >= len) return null;
      while (b > a && !loud(b)) b--;
      return [Math.max(0, a - Math.round(sr * preMs / 1000)), Math.min(len, b + 1 + Math.round(sr * postMs / 1000))];
    },
    // Il passaggio per lo zero piu' vicino a i (entro radius campioni), sulla somma dei canali: tagli senza click.
    zeroCross(chs, i, radius) {
      const len = chs[0].length, v = k => { let s = 0; for (const c of chs) s += c[k]; return s; };
      if (i <= 0 || i >= len) return clamp(i, 0, len);
      for (let d = 0; d <= radius; d++) {
        for (const k of [i - d, i + d]) if (k > 0 && k < len && (v(k - 1) <= 0) !== (v(k) <= 0)) return k;
      }
      return i;
    },
    // Il colore della SP-1200: campionamento a 26,04 kHz (ogni valore tenuto fino al successivo) e 12 bit.
    crunch(chs, sr, a, b, rate = 26040, bits = 12) {
      const q = Math.pow(2, bits - 1) - 1, step = sr / rate;
      return chs.map(c => {
        const o = c.slice();
        let hold = 0, next = a;
        for (let i = a; i < b; i++) { if (i >= next) { hold = Math.round(clamp(c[i], -1, 1) * q) / q; next += step; } o[i] = hold; }
        return o;
      });
    },
    // WAV PCM 16 bit, canali interlacciati.
    encodeWav(chs, sr) {
      const n = chs[0].length, ch = chs.length, bytes = n * ch * 2, buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
      const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      str(0, "RIFF"); v.setUint32(4, 36 + bytes, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true);
      v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true);
      v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, bytes, true);
      let o = 44;
      for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
        const x = clamp(chs[c][i], -1, 1);
        v.setInt16(o, x < 0 ? Math.round(x * 32768) : Math.round(x * 32767), true); o += 2;
      }
      return buf;
    },
  };

  // ---------- interfaccia ----------
  const CSS = `
dialog.sed{position:fixed; inset:0; width:auto; height:auto; max-width:none; max-height:none; margin:0; padding:0; border:0; overflow:hidden; background:var(--plate,var(--panel)); color:var(--text);}
dialog.sed::backdrop{background:rgba(0,0,0,.55);}
.sed-shell{display:flex; flex-direction:column; gap:10px; height:100%; box-sizing:border-box; overflow-y:auto; padding:14px 16px calc(12px + env(safe-area-inset-bottom));}
.sed-head{display:flex; align-items:flex-start; justify-content:space-between; gap:10px 16px; flex-wrap:wrap;}
.sed-title{min-width:0;}
.sed-kicker{font-size:9px; letter-spacing:.2em; text-transform:uppercase; color:var(--accent); font-weight:800;}
.sed-title h2{font-size:20px; letter-spacing:.06em; margin:2px 0 3px; text-transform:uppercase; overflow-wrap:anywhere;}
.sed-info{font-size:10px; color:var(--text-dim); font-variant-numeric:tabular-nums;}
.sed-info b{color:var(--accent);}
.sed-head-actions{display:flex; flex-wrap:wrap; gap:6px; align-items:center;}
.sed-close{width:32px; height:32px; padding:0; font-size:18px; line-height:1;}
.sed-stage{position:relative; flex:1; min-height:150px; border:1px solid var(--edge); border-radius:8px; background:var(--panel-3); overflow:hidden;}
.sed-stage canvas{position:absolute; inset:0; width:100%; height:100%; cursor:crosshair; touch-action:none; outline:none;}
.sed-stage canvas:focus-visible{box-shadow:inset 0 0 0 2px var(--accent);}
.sed-scroll{width:100%; margin:0; accent-color:var(--accent);}
.sed-bar{display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 14px;}
.sed-group{display:flex; flex-wrap:wrap; align-items:center; gap:6px;}
.sed-sel label{display:inline-flex; align-items:center; gap:5px; font-size:9px; letter-spacing:.1em; text-transform:uppercase; color:var(--text-faint);}
.sed-sel input{width:84px; padding:4px 6px; font:10.5px var(--mono,monospace);}
.sed-len{min-width:96px; font-size:10px; color:var(--text-dim); font-variant-numeric:tabular-nums;}
.sed-tools{display:flex; flex-wrap:wrap; gap:8px 18px; padding-top:9px; border-top:1px solid var(--edge-soft);}
.sed-tool-group{display:flex; flex-wrap:wrap; align-items:center; gap:6px;}
.sed-tool-head{font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--text-faint); margin-right:2px;}
.sed-check{display:inline-flex; align-items:center; gap:5px; font-size:10px; color:var(--text-dim);}
.sed button[aria-pressed="true"]{background:var(--key-primary,var(--accent)); color:var(--on-accent); border-color:var(--accent-dim);}
.sed-foot{display:flex; flex-wrap:wrap; justify-content:space-between; gap:4px 16px; align-items:baseline;}
.sed-help{margin:0; font-size:9.5px; color:var(--text-faint); line-height:1.45;}
.sed-status{font-size:10px; color:var(--text-dim);}
.sed-status.err{color:var(--danger);}
@media (max-width:640px){
  .sed-shell{padding:10px 10px calc(10px + env(safe-area-inset-bottom)); gap:8px;}
  .sed-title h2{font-size:16px;}
  .sed-help{display:none;}
  .sed-sel input{width:70px;}
}`;

  const HTML = `
<div class="sed-shell">
  <header class="sed-head">
    <div class="sed-title"><div class="sed-kicker">Sample editor</div><h2 id="sedTitle"></h2><div class="sed-info" id="sedInfo"></div></div>
    <div class="sed-head-actions">
      <button type="button" class="mini" id="sedUndo" title="Undo (⌘Z)">↶ Undo</button>
      <button type="button" class="mini" id="sedRedo" title="Redo (⇧⌘Z)">↷ Redo</button>
      <button type="button" class="mini" id="sedExport" title="Download the edited sound as a WAV file">⤓ WAV</button>
      <button type="button" class="mini" id="sedSaveNew" title="Keep the original and add the edit to the Sampler as a new sound">Save as new</button>
      <button type="button" class="mini primary" id="sedSave" title="Replace the sample: the grid rows and the synth that use it play the edit">Save</button>
      <button type="button" class="icon-btn sed-close" id="sedClose" title="Close (Esc)" aria-label="Close the editor">×</button>
    </div>
  </header>
  <div class="sed-stage"><canvas id="sedWave" tabindex="0" aria-label="Waveform: drag to select a part of the sound"></canvas></div>
  <input type="range" id="sedScroll" class="sed-scroll" min="0" max="1000" value="0" aria-label="Scroll the waveform">
  <div class="sed-bar">
    <div class="sed-group">
      <button type="button" class="mini primary" id="sedPlay" title="Play the selection, or from the cursor (Space)">▶ Play</button>
      <button type="button" class="mini" id="sedLoop" aria-pressed="false" title="Repeat the selection while playing">⟲ Loop</button>
    </div>
    <div class="sed-group sed-sel">
      <label>Start <input type="number" id="sedStart" step="0.001" min="0" inputmode="decimal"></label>
      <label>End <input type="number" id="sedEnd" step="0.001" min="0" inputmode="decimal"></label>
      <span class="sed-len" id="sedLen"></span>
      <button type="button" class="mini" id="sedAll" title="Select the whole sound (⌘A)">All</button>
      <button type="button" class="mini" id="sedNone" title="Clear the selection">None</button>
    </div>
    <div class="sed-group">
      <button type="button" class="mini" id="sedZoomOut" title="Zoom out (−)" aria-label="Zoom out">−</button>
      <button type="button" class="mini" id="sedZoomSel" title="Zoom to the selection">Zoom sel.</button>
      <button type="button" class="mini" id="sedFit" title="Show the whole sound">Fit</button>
      <button type="button" class="mini" id="sedZoomIn" title="Zoom in (+)" aria-label="Zoom in">+</button>
    </div>
  </div>
  <div class="sed-tools">
    <div class="sed-tool-group"><span class="sed-tool-head">Cut</span>
      <button type="button" class="mini" data-tool="crop" data-need-sel title="Keep only the selection">Trim to selection</button>
      <button type="button" class="mini" data-tool="delete" data-need-sel title="Remove the selection (Backspace)">Delete</button>
      <button type="button" class="mini" data-tool="silence" data-need-sel title="Replace the selection with silence">Silence</button>
      <button type="button" class="mini" data-tool="autotrim" title="Cut the silence at the start and at the end">Trim silence</button>
    </div>
    <div class="sed-tool-group"><span class="sed-tool-head">Shape</span>
      <button type="button" class="mini" data-tool="fadein">Fade in</button>
      <button type="button" class="mini" data-tool="fadeout">Fade out</button>
      <button type="button" class="mini" data-tool="normalize" title="Raise the loudest peak to −0.1 dB">Normalize</button>
      <button type="button" class="mini" data-tool="gaindown">−3 dB</button>
      <button type="button" class="mini" data-tool="gainup">+3 dB</button>
      <button type="button" class="mini" data-tool="reverse">Reverse</button>
    </div>
    <div class="sed-tool-group"><span class="sed-tool-head">Color</span>
      <button type="button" class="mini" data-tool="crunch" title="Resample at 26 kHz and 12 bit, like the E-mu SP-1200">SP-1200 12-bit</button>
      <label class="sed-check" title="Selection edges move to the nearest point where the wave crosses zero: cuts without clicks"><input type="checkbox" id="sedSnap" checked> Snap to zero crossings</label>
    </div>
  </div>
  <div class="sed-foot">
    <p class="sed-help">Drag on the waveform to select, drag the edges to adjust, double-click to select all; click to place the cursor.
      The tools work on the selection, or on the whole sound when nothing is selected. Wheel scrolls, ⌘/Ctrl + wheel or pinch zooms.
      Space plays · ⌘Z undoes · Esc closes.</p>
    <span class="sed-status" id="sedStatus" role="status" aria-live="polite"></span>
  </div>
</div>`;

  let ui = null, st = null, drag = null, raf = 0;
  const $ = id => document.getElementById(id);
  const len = () => st.chs[0].length;
  const hasSel = () => st.sel.b > st.sel.a;
  const fmt = s => {
    if (!isFinite(s)) return "—";
    const m = Math.floor(s / 60), r = s - m * 60;
    return m ? m + ":" + (r < 10 ? "0" : "") + r.toFixed(3) : r.toFixed(3) + " s";
  };
  const dbfs = p => p > 0 ? (20 * Math.log10(p)).toFixed(1) + " dB" : "−∞ dB";

  function build() {
    if (ui) return;
    const style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);
    const dlg = document.createElement("dialog");
    dlg.className = "sed"; dlg.id = "sampleEditor"; dlg.setAttribute("aria-labelledby", "sedTitle");
    dlg.innerHTML = HTML;
    document.body.appendChild(dlg);
    ui = { dlg, canvas: $("sedWave"), stage: dlg.querySelector(".sed-stage") };
    bind();
  }

  // ---------- disegno: la forma d'onda sta in un livello a parte, sopra si ridisegnano solo selezione e testina ----------
  function colors() {
    const cs = getComputedStyle(document.documentElement), v = (k, d) => cs.getPropertyValue(k).trim() || d;
    return { accent: v("--accent", "#c8471f"), edge: v("--edge-soft", "#555"), faint: v("--text-faint", "#888"),
      text: v("--text", "#eee"), mono: v("--mono", "monospace") };
  }
  function canvasSize() {
    const c = ui.canvas, dpr = window.devicePixelRatio || 1;
    const w = Math.max(100, Math.round(c.clientWidth)), h = Math.max(80, Math.round(c.clientHeight));
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    return { w, h, dpr };
  }
  const RULER = 18;
  function tickStep(pxPerSec) {
    for (const s of [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60]) if (s * pxPerSec >= 72) return s;
    return 120;
  }
  function waveLayer(w, h, dpr) {
    const key = [w, h, dpr, st.view.from, st.view.span, st.id].join();
    if (st.layer && st.layerKey === key) return st.layer;
    const L = st.layer || document.createElement("canvas");
    L.width = Math.round(w * dpr); L.height = Math.round(h * dpr);
    const c = L.getContext("2d"), col = colors(), { from, span } = st.view, n = st.chs.length, lane = (h - RULER) / n;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    // righello in secondi
    const pxs = w / (span / st.sr), step = tickStep(pxs), t0 = from / st.sr, dec = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
    c.font = "9px " + col.mono; c.textBaseline = "top"; c.fillStyle = col.faint; c.strokeStyle = col.edge; c.lineWidth = 1;
    for (let t = Math.ceil(t0 / step) * step; t <= t0 + span / st.sr + 1e-9; t += step) {
      const x = Math.round((t - t0) * pxs) + 0.5;
      c.globalAlpha = 0.9; c.beginPath(); c.moveTo(x, RULER - 6); c.lineTo(x, RULER); c.stroke();
      c.globalAlpha = 0.25; c.beginPath(); c.moveTo(x, RULER); c.lineTo(x, h); c.stroke();
      c.globalAlpha = 0.9; c.fillText(t.toFixed(dec) + "s", x + 3, 3);
    }
    c.globalAlpha = 1;
    c.beginPath(); c.moveTo(0, RULER - 0.5); c.lineTo(w, RULER - 0.5); c.stroke();
    // canali, uno sopra l'altro
    const perPx = span / w;
    for (let k = 0; k < n; k++) {
      const d = st.chs[k], mid = RULER + lane * (k + 0.5), amp = lane * 0.45;
      c.strokeStyle = col.edge; c.globalAlpha = 0.8; c.beginPath(); c.moveTo(0, Math.round(mid) + 0.5); c.lineTo(w, Math.round(mid) + 0.5); c.stroke();
      if (k) { c.globalAlpha = 1; c.beginPath(); c.moveTo(0, Math.round(RULER + lane * k) + 0.5); c.lineTo(w, Math.round(RULER + lane * k) + 0.5); c.stroke(); }
      // l'onda e' nell'inchiostro del tema (come nelle schede del Sampler), non nell'arancione
      c.globalAlpha = 1; c.fillStyle = col.text; c.strokeStyle = col.text;
      if (perPx > 1) {
        // per ogni colonna di pixel: il picco (minimo-massimo, chiaro) e l'RMS (scuro)
        for (let x = 0; x < w; x++) {
          const a = Math.floor(from + x * perPx), b = Math.min(d.length, Math.floor(from + (x + 1) * perPx));
          let lo = 1, hi = -1, sq = 0;
          for (let i = a; i < b; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; sq += v * v; }
          if (hi < lo) continue;
          const rms = Math.sqrt(sq / (b - a));
          c.globalAlpha = 0.35; c.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
          c.globalAlpha = 0.85; c.fillRect(x, mid - rms * amp, 1, Math.max(1, 2 * rms * amp));
        }
        c.globalAlpha = 1;
      } else {
        // da vicino: la linea che unisce i campioni, e i punti quando c'e' spazio
        c.globalAlpha = 0.85; c.lineWidth = 1.5; c.beginPath();
        const a = Math.max(0, Math.floor(from) - 1), b = Math.min(d.length - 1, Math.ceil(from + span) + 1);
        for (let i = a; i <= b; i++) { const x = (i - from) / perPx, y = mid - d[i] * amp; i === a ? c.moveTo(x, y) : c.lineTo(x, y); }
        c.stroke();
        if (1 / perPx >= 7) for (let i = a; i <= b; i++) c.fillRect((i - from) / perPx - 1.5, mid - d[i] * amp - 1.5, 3, 3);
      }
    }
    st.layer = L; st.layerKey = key;
    return L;
  }
  const xOf = (s, w) => (s - st.view.from) / st.view.span * w;
  function draw() {
    if (!st || !ui.dlg.open) return;
    const { w, h, dpr } = canvasSize(), c = ui.canvas.getContext("2d"), col = colors();
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    c.drawImage(waveLayer(w, h, dpr), 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { a, b } = st.sel;
    if (b > a) {
      const x1 = xOf(a, w), x2 = xOf(b, w);
      c.fillStyle = col.accent; c.globalAlpha = 0.16; c.fillRect(x1, RULER, x2 - x1, h - RULER);
      c.globalAlpha = 1; c.fillRect(x1 - 1, RULER, 2, h - RULER); c.fillRect(x2 - 1, RULER, 2, h - RULER);
      c.fillRect(x1 - 5, RULER, 10, 7); c.fillRect(x2 - 5, RULER, 10, 7);     // maniglie
    } else {
      const x = xOf(a, w);
      c.strokeStyle = col.text; c.globalAlpha = 0.7; c.setLineDash([4, 3]);
      c.beginPath(); c.moveTo(x + 0.5, RULER); c.lineTo(x + 0.5, h); c.stroke(); c.setLineDash([]);
    }
    if (st.play) {
      const x = xOf(playPos(), w);
      c.globalAlpha = 1; c.fillStyle = col.accent; c.fillRect(x - 0.75, 0, 1.5, h);   // testina: si stacca dall'onda scura
    }
    c.globalAlpha = 1;
  }

  // ---------- vista (zoom e scorrimento) ----------
  function setView(from, span) {
    const n = len(), minSpan = Math.min(n, Math.max(16, (ui.canvas.clientWidth || 600) / 14));
    span = clamp(span, minSpan, n); from = clamp(from, 0, n - span);
    st.view = { from, span };
    const sc = $("sedScroll");
    sc.hidden = span >= n;
    sc.value = n > span ? Math.round(from / (n - span) * 1000) : 0;
    draw();
  }
  const fit = () => setView(0, len());
  function zoom(factor, at) {
    const v = st.view, s = at ?? (hasSel() ? (st.sel.a + st.sel.b) / 2 : v.from + v.span / 2);
    setView(s - (s - v.from) * factor, v.span * factor);
  }

  // ---------- stato dei controlli ----------
  let noteTimer = 0;
  function note(msg, err) {
    const s = $("sedStatus"); s.textContent = msg || ""; s.classList.toggle("err", !!err);
    clearTimeout(noteTimer); if (msg && !err) noteTimer = setTimeout(() => { s.textContent = ""; }, 3500);
  }
  function refresh() {
    const n = len(), dirty = st.id !== st.saved;
    $("sedTitle").textContent = st.name;
    $("sedInfo").innerHTML = `${fmt(n / st.sr)} · ${(st.sr / 1000).toFixed(1)} kHz · ${st.chs.length === 1 ? "mono" : st.chs.length === 2 ? "stereo" : st.chs.length + " channels"} · peak ${dbfs(dsp.peak(st.chs))}`
      + (dirty ? " · <b>not saved</b>" : "");
    $("sedUndo").disabled = !st.undo.length; $("sedRedo").disabled = !st.redo.length;
    $("sedSave").disabled = !dirty;
    for (const b of ui.dlg.querySelectorAll("[data-need-sel]")) b.disabled = !hasSel();
    $("sedZoomSel").disabled = !hasSel(); $("sedNone").disabled = !hasSel();
    $("sedLoop").setAttribute("aria-pressed", String(st.loop));
    $("sedPlay").textContent = st.play ? "■ Stop" : "▶ Play";
    readout();
  }
  function readout() {
    const { a, b } = st.sel, s = $("sedStart"), e = $("sedEnd");
    if (document.activeElement !== s) s.value = (a / st.sr).toFixed(3);
    if (document.activeElement !== e) e.value = (b / st.sr).toFixed(3);
    s.max = e.max = (len() / st.sr).toFixed(3);
    $("sedLen").textContent = b > a ? "length " + fmt((b - a) / st.sr) : "cursor";
  }

  // ---------- modifiche, annulla/ripeti ----------
  function commit(chs, sel, msg) {
    stop();
    const lengthChanged = chs[0].length !== len();
    st.undo.push({ chs: st.chs, sel: st.sel, id: st.id }); if (st.undo.length > 40) st.undo.shift();
    st.redo = [];
    st.chs = chs; st.sel = sel; st.id = st.nextId++;
    if (lengthChanged) fit(); else draw();
    refresh(); note(msg);
  }
  function restore(from, to) {
    if (!from.length) return;
    stop();
    to.push({ chs: st.chs, sel: st.sel, id: st.id });
    const s = from.pop(), lengthChanged = s.chs[0].length !== len();
    st.chs = s.chs; st.sel = s.sel; st.id = s.id;
    if (lengthChanged) fit(); else draw();
    refresh();
  }
  const undo = () => restore(st.undo, st.redo), redo = () => restore(st.redo, st.undo);
  function apply(tool) {
    const n = len(), sel = hasSel(), [a, b] = sel ? [st.sel.a, st.sel.b] : [0, n], keep = { ...st.sel };
    const none = { a: 0, b: 0 };
    switch (tool) {
      case "crop": return commit(dsp.crop(st.chs, a, b), none, "trimmed to the selection");
      case "delete":
        if (b - a >= n) return note("The whole sound can't be deleted", true);
        return commit(dsp.remove(st.chs, a, b), { a, b: a }, "selection deleted");
      case "silence": return commit(dsp.silence(st.chs, a, b), keep, "selection silenced");
      case "autotrim": {
        const r = dsp.audible(st.chs, st.sr);
        if (!r) return note("The sound is silent", true);
        if (r[0] === 0 && r[1] >= n) return note("No silence to trim at the edges");
        return commit(dsp.crop(st.chs, r[0], r[1]), none, `silence trimmed: ${fmt(r[0] / st.sr)} at the start, ${fmt((n - r[1]) / st.sr)} at the end`);
      }
      case "fadein": return commit(dsp.fade(st.chs, a, b, "in"), keep, "fade in");
      case "fadeout": return commit(dsp.fade(st.chs, a, b, "out"), keep, "fade out");
      case "normalize":
        if (!dsp.peak(st.chs, a, b)) return note("Nothing to normalize: it's silence", true);
        return commit(dsp.normalize(st.chs, a, b), keep, "normalized to −0.1 dB");
      case "gainup": return commit(dsp.gain(st.chs, a, b, Math.pow(10, 3 / 20)), keep, "+3 dB");
      case "gaindown": return commit(dsp.gain(st.chs, a, b, Math.pow(10, -3 / 20)), keep, "−3 dB");
      case "reverse": return commit(dsp.reverse(st.chs, a, b), keep, "reversed");
      case "crunch": return commit(dsp.crunch(st.chs, st.sr, a, b), keep, "SP-1200 color: 26 kHz, 12 bit");
    }
  }
  function selectAll() { st.sel = { a: 0, b: len() }; draw(); refresh(); }
  function setSel(a, b) {
    const n = len();
    a = clamp(Math.round(a), 0, n); b = clamp(Math.round(b), 0, n);
    st.sel = a <= b ? { a, b } : { a: b, b: a };
    draw(); refresh();
  }
  function snapSel() {
    if (!$("sedSnap").checked || !hasSel()) return;
    const r = Math.round(st.sr * 0.004), a = dsp.zeroCross(st.chs, st.sel.a, r), b = dsp.zeroCross(st.chs, st.sel.b, r);
    if (b > a) st.sel = { a, b };
  }

  // ---------- ascolto ----------
  function audioBuffer(ctx = actx()) {
    const buf = ctx.createBuffer(st.chs.length, len(), st.sr);
    st.chs.forEach((c, i) => buf.copyToChannel(c, i));
    return buf;
  }
  function playPos() {
    const p = st.play; if (!p) return 0;
    const el = (p.ctx.currentTime - p.t0) * st.sr;
    return p.loop ? p.from + el % (p.to - p.from) : Math.min(p.to, p.from + el);
  }
  async function play() {
    stop();
    const ctx = actx(); if (ctx.state === "suspended") await ctx.resume();
    const n = len(), sel = hasSel(), from = sel ? st.sel.a : (st.sel.a < n - 1 ? st.sel.a : 0), to = sel ? st.sel.b : n;
    const src = ctx.createBufferSource(); src.buffer = audioBuffer(ctx); src.connect(ctx.destination);
    const loop = st.loop && sel;
    if (loop) { src.loop = true; src.loopStart = from / st.sr; src.loopEnd = to / st.sr; src.start(0, from / st.sr); }
    else src.start(0, from / st.sr, (to - from) / st.sr);
    st.play = { src, ctx, t0: ctx.currentTime, from, to, loop };
    src.onended = () => { if (st && st.play && st.play.src === src) { st.play = null; refresh(); draw(); } };
    refresh(); tick();
  }
  function stop() {
    if (!st || !st.play) return;
    const { src } = st.play; st.play = null;
    try { src.onended = null; src.stop(); } catch (e) {}
    cancelAnimationFrame(raf); raf = 0;
    refresh(); draw();
  }
  function tick() {
    cancelAnimationFrame(raf);
    if (!st || !st.play) return;
    const p = playPos(), v = st.view;
    if (!drag && v.span < len() && (p < v.from || p > v.from + v.span)) setView(p - v.span * 0.05, v.span);   // la vista segue la testina
    draw();
    raf = requestAnimationFrame(tick);
  }

  // ---------- eventi ----------
  function sampleAt(clientX) {
    const r = ui.canvas.getBoundingClientRect();
    return clamp(Math.round(st.view.from + (clientX - r.left) / r.width * st.view.span), 0, len());
  }
  function edgeAt(clientX) {
    if (!hasSel()) return null;
    const r = ui.canvas.getBoundingClientRect(), x = clientX - r.left;
    const da = Math.abs(x - xOf(st.sel.a, r.width)), db = Math.abs(x - xOf(st.sel.b, r.width));
    if (Math.min(da, db) > 8) return null;
    return da <= db ? "a" : "b";
  }
  function bind() {
    const cv = ui.canvas, dlg = ui.dlg;
    cv.addEventListener("pointerdown", e => {
      if (!st || e.button !== 0) return;
      cv.focus({ preventScroll: true });
      const s = sampleAt(e.clientX), edge = edgeAt(e.clientX);
      drag = { mode: edge || "new", anchor: edge === "a" ? st.sel.b : edge === "b" ? st.sel.a : s };
      if (!edge) st.sel = { a: s, b: s };
      cv.setPointerCapture(e.pointerId);
      draw(); refresh();
    });
    cv.addEventListener("pointermove", e => {
      if (!st) return;
      if (!drag) { cv.style.cursor = edgeAt(e.clientX) ? "ew-resize" : "crosshair"; return; }
      const s = sampleAt(e.clientX);
      st.sel = s < drag.anchor ? { a: s, b: drag.anchor } : { a: drag.anchor, b: s };
      draw(); readout();
    });
    const end = () => {
      if (!drag) return;
      drag = null; snapSel(); draw(); refresh();
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("dblclick", () => { if (st) selectAll(); });
    cv.addEventListener("wheel", e => {
      if (!st) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoom(Math.exp(e.deltaY * 0.01), sampleAt(e.clientX));
      else {
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        setView(st.view.from + d / (cv.clientWidth || 600) * st.view.span, st.view.span);
      }
    }, { passive: false });
    $("sedScroll").addEventListener("input", e => {
      const n = len(), span = st.view.span;
      setView(+e.target.value / 1000 * (n - span), span);
    });
    $("sedPlay").onclick = () => st.play ? stop() : play();
    $("sedLoop").onclick = () => { st.loop = !st.loop; if (st.play) play(); refresh(); };
    $("sedAll").onclick = selectAll;
    $("sedNone").onclick = () => { st.sel = { a: st.sel.a, b: st.sel.a }; draw(); refresh(); };
    $("sedZoomIn").onclick = () => zoom(0.5);
    $("sedZoomOut").onclick = () => zoom(2);
    $("sedFit").onclick = fit;
    $("sedZoomSel").onclick = () => { if (hasSel()) { const pad = (st.sel.b - st.sel.a) * 0.05; setView(st.sel.a - pad, st.sel.b - st.sel.a + 2 * pad); } };
    const fromInput = () => setSel(+$("sedStart").value * st.sr, Math.max(+$("sedStart").value, +$("sedEnd").value) * st.sr);
    $("sedStart").addEventListener("change", fromInput);
    $("sedEnd").addEventListener("change", fromInput);
    for (const b of dlg.querySelectorAll("[data-tool]")) b.onclick = () => apply(b.dataset.tool);
    $("sedUndo").onclick = undo; $("sedRedo").onclick = redo;
    $("sedSave").onclick = () => save(false);
    $("sedSaveNew").onclick = () => save(true);
    $("sedExport").onclick = () => {
      const blob = new Blob([dsp.encodeWav(st.chs, st.sr)], { type: "audio/wav" });
      saveBlob(blob, st.name.replace(/[\\/:*?"<>|]+/g, "-") + ".wav", "Sample");
    };
    $("sedClose").onclick = close;
    dlg.addEventListener("cancel", e => { e.preventDefault(); close(); });
    dlg.addEventListener("keydown", e => {
      if (!st) return;
      const t = e.target, typing = t.tagName === "INPUT" && (t.type === "number" || t.type === "text"), mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); e.stopPropagation(); e.shiftKey ? redo() : undo(); return; }
      if (typing || e.altKey) return;
      if (e.key === " ") { e.preventDefault(); if (t.tagName === "BUTTON") t.blur(); st.play ? stop() : play(); }
      else if (mod && k === "a") { e.preventDefault(); selectAll(); }
      else if ((e.key === "Backspace" || e.key === "Delete") && hasSel()) { e.preventDefault(); apply("delete"); }
      else if (!mod && (e.key === "+" || e.key === "=")) zoom(0.5);
      else if (!mod && e.key === "-") zoom(2);
    });
    if (window.ResizeObserver) new ResizeObserver(() => draw()).observe(ui.stage);
    else window.addEventListener("resize", draw);
  }

  // ---------- apertura, salvataggio, chiusura ----------
  async function save(asNew) {
    stop();
    const blob = new Blob([dsp.encodeWav(st.chs, st.sr)], { type: "audio/wav" });
    try {
      if (asNew) {
        const name = await ask({ title: "Save as new sample", message: "The edit is added to the Sampler as a new sound; the original stays as it is.",
          ok: "Save", input: st.name + " edit" });
        if (name === null || !st) return;
        const next = await st.opts.saveAsNew(blob, audioBuffer(), name);
        if (!next) return;
        st.opts = { ...st.opts, ...next }; st.name = next.name; st.saved = st.id;
        note("saved as “" + next.name + "”: you are now editing the new sample");
      } else {
        if (await st.opts.save(blob, audioBuffer()) === false) return;
        st.saved = st.id;
        note("saved: the grid and the synth play the edit");
      }
      refresh();
    } catch (e) { note(e && e.message ? e.message : "The sample could not be saved", true); }
  }
  async function close() {
    if (!st) return;
    if (st.id !== st.saved) {
      const ok = await ask({ title: "Close the editor?", message: "The changes that are not saved will be lost.", ok: "Discard changes", cancel: "Keep editing", danger: true });
      if (!ok) return;
    }
    stop();
    const done = st.opts.onClose;
    st = null; drag = null;
    ui.dlg.close();
    if (done) done();
  }
  function open(opts) {
    build();
    if (st) stop();
    const buf = opts.buffer, chs = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c).slice());
    st = { opts, name: opts.name || "Sample", sr: buf.sampleRate, chs, sel: { a: 0, b: 0 }, view: { from: 0, span: chs[0].length },
      undo: [], redo: [], id: 0, saved: 0, nextId: 1, loop: false, play: null, layer: null, layerKey: "" };
    note("");
    if (!ui.dlg.open) ui.dlg.showModal();
    ui.canvas.focus({ preventScroll: true });
    refresh();
    requestAnimationFrame(fit);
  }

  window.PMSampleEditor = { open, dsp, isOpen: () => !!st };
})();
