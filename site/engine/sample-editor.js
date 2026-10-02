// Editor del Sampler a tutto schermo: forma d'onda grande con zoom, selezione, trim, dissolvenze, normalizzazione,
// guadagno, inversione, pulizia dei silenzi, effetti di colore (Crunch alla SP-1200, Drive, Filter, EQ) con
// ascolto prima di applicarli e Chop: il suono tagliato in fette, sui colpi o in parti uguali, che diventano
// campioni, righe della griglia e un pattern. Lavora su una copia: il campione cambia solo con
// Save (stesso suono, anche nei progetti e nel synth che lo usano) o Save as new (un nuovo campione nel Sampler).
//
// Lo apre engine/sampler.js: PMSampleEditor.open({name, buffer, save(blob, audio), saveAsNew(blob, audio, name), chop}).
// chop = {bpm, lens: [{steps, quarters, label}], make({name, slices: [{name, blob, audio, step}], grid: {steps, bpm}|null})}.
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
    // Il colore dei campionatori anni '80: campionamento a `rate` Hz (ogni valore tenuto fino al successivo, senza
    // filtro anti-aliasing) e `bits` bit. law "mu": livelli compandati (mu-law) come l'Emulator II, fitti vicino allo
    // zero e radi sui picchi: meno fruscio nelle code a parita' di bit. Default: la SP-1200, 26,04 kHz e 12 bit lineari.
    crunch(chs, sr, a, b, rate = 26040, bits = 12, law = "linear") {
      const q = Math.pow(2, bits - 1) - 1, step = sr / rate, MU = 255, lmu = Math.log1p(MU);
      const quant = law === "mu"
        ? v => { const y = Math.round(Math.log1p(MU * Math.abs(v)) / lmu * q) / q; return (v < 0 ? -1 : 1) * Math.expm1(y * lmu) / MU; }
        : v => Math.round(v * q) / q;
      return chs.map(c => {
        const o = c.slice();
        let hold = 0, next = a;
        for (let i = a; i < b; i++) { if (i >= next) { hold = quant(clamp(c[i], -1, 1)); next += step; } o[i] = hold; }
        return o;
      });
    },
    // Saturazione: soft (tanh), tube (tanh asimmetrico: armoniche pari, poi via la continua), hard (clip), fold
    // (ripiega l'onda su se stessa). Un suono a fondo scala resta con il picco a 1 prima di `out` (dB).
    drive(chs, sr, a, b, { type = "soft", db = 12, out = 0 } = {}) {
      const g = Math.pow(10, db / 20), o = Math.pow(10, out / 20), k = 0.2, tk = Math.tanh(k);
      const norm = Math.max(Math.abs(Math.tanh(g + k) - tk), Math.abs(Math.tanh(k - g) - tk));
      const fn = type === "hard" ? v => clamp(v * g, -1, 1)
        : type === "fold" ? v => Math.sin(Math.PI / 2 * v * g)
        : type === "tube" ? v => (Math.tanh(v * g + k) - tk) / norm
        : v => Math.tanh(v * g) / Math.tanh(g);
      // Solo tube: via la continua sotto i 10 Hz, sottraendo la media che segue lentamente il suono. Parte dal
      // primo valore a inizio suono (di solito silenzio) e dalla media dei primi 20 ms a meta' suono, senza picchi.
      const tube = type === "tube", w = 2 * Math.PI * 10 / sr, n0 = Math.min(b - a, Math.round(sr * 0.02));
      return chs.map(c => {
        const r = c.slice();
        let dc = 0;
        if (tube && a < b) { if (a === 0) dc = fn(c[0]); else { for (let i = a; i < a + n0; i++) dc += fn(c[i]); dc /= n0; } }
        for (let i = a; i < b; i++) {
          let y = fn(c[i]);
          if (tube) { dc += (y - dc) * w; y -= dc; }
          r[i] = y * o;
        }
        return r;
      });
    },
    // Coefficienti di un biquad (Robert Bristow-Johnson, "Audio EQ Cookbook"), normalizzati: [b0, b1, b2, a1, a2].
    // bandpass ha 0 dB al centro; db serve a peaking e agli shelf.
    coefs(type, hz, q, sr, db = 0) {
      const w = 2 * Math.PI * clamp(hz, 10, sr * 0.49) / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * q), A = Math.pow(10, db / 40);
      let b0, b1, b2, a0, a1, a2;
      if (type === "lowshelf" || type === "highshelf") {
        const s = 2 * Math.sqrt(A) * al, p = type === "lowshelf" ? 1 : -1;
        b0 = A * ((A + 1) - p * (A - 1) * cw + s); b1 = 2 * p * A * ((A - 1) - p * (A + 1) * cw); b2 = A * ((A + 1) - p * (A - 1) * cw - s);
        a0 = (A + 1) + p * (A - 1) * cw + s; a1 = -2 * p * ((A - 1) + p * (A + 1) * cw); a2 = (A + 1) + p * (A - 1) * cw - s;
      } else {
        a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
        if (type === "highpass") { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
        else if (type === "bandpass") { b0 = al; b1 = 0; b2 = -al; }
        else if (type === "notch") { b0 = 1; b1 = -2 * cw; b2 = 1; }
        else if (type === "peaking") { b0 = 1 + al * A; b2 = 1 - al * A; b1 = a1; a0 = 1 + al / A; a2 = 1 - al / A; }
        else { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }       // lowpass
      }
      return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
    },
    // Biquad in cascata sull'intervallo. I `pre` campioni prima di a scaldano il filtro senza essere scritti:
    // a meta' suono parte gia' a regime, senza il colpo di un filtro che si accende da zero.
    biquad(chs, a, b, stages, pre = 0) {
      const p = Math.max(0, a - pre);
      return chs.map(c => {
        const o = c.slice(), x = Float64Array.from(c.subarray(p, b));
        for (const [b0, b1, b2, a1, a2] of stages) {
          let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
          for (let i = 0; i < x.length; i++) {
            const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y;
          }
        }
        for (let i = a; i < b; i++) o[i] = x[i - p];
        return o;
      });
    },
    // Filtro: lowpass, highpass, bandpass, notch; 24 dB/ottava = due stadi (il secondo senza risonanza, come le righe).
    filter(chs, sr, a, b, { type = "lowpass", hz = 1000, q = Math.SQRT1_2, slope = 24 } = {}) {
      const st = [dsp.coefs(type, hz, q, sr)];
      if (+slope === 24) st.push(dsp.coefs(type, hz, type === "lowpass" || type === "highpass" ? Math.SQRT1_2 : q, sr));
      return dsp.biquad(chs, a, b, st, Math.round(sr * 0.05));
    },
    // EQ a 3 bande: shelf a 100 Hz, campana a midHz, shelf a 8 kHz (guadagni in dB).
    eq(chs, sr, a, b, { low = 0, mid = 0, midHz = 1000, high = 0 } = {}) {
      const st = [];
      if (low) st.push(dsp.coefs("lowshelf", 100, Math.SQRT1_2, sr, low));
      if (mid) st.push(dsp.coefs("peaking", midHz, 0.9, sr, mid));
      if (high) st.push(dsp.coefs("highshelf", 8000, Math.SQRT1_2, sr, high));
      return st.length ? dsp.biquad(chs, a, b, st, Math.round(sr * 0.05)) : chs;
    },
    // Dal suono originale (dry) all'effetto (wet) nell'intervallo, nella misura `amount` (0-1). Ai bordi
    // dell'intervallo che non coincidono con quelli del suono, una dissolvenza di `edge` campioni evita i click.
    mix(dry, wet, a, b, amount = 1, edge = 0) {
      const n = dry[0].length, e = Math.min(edge, Math.floor((b - a) / 4));
      return wet.map((w, k) => {
        const d = dry[k], o = d.slice();
        for (let i = a; i < b; i++) {
          let m = amount;
          if (e > 0) { if (a > 0 && i - a < e) m *= (i - a) / e; if (b < n && b - 1 - i < e) m *= (b - 1 - i) / e; }
          o[i] = d[i] + (w[i] - d[i]) * m;
        }
        return o;
      });
    },
    // Gli attacchi (i colpi) nell'intervallo, per tagliare un break. Si lavora su una versione con gli acuti in
    // evidenza (la coda di una cassa non copre il colpo di hi-hat che arriva dopo), in blocchi da ~6 ms: un attacco
    // e' un blocco che sale di `rise` dB sopra quelli di 2 e 3 blocchi prima (un colpo a cavallo di due blocchi alza
    // gia' il precedente; sensitivity 0-100: da 12 a 2 dB), sopra -50 dB, ad
    // almeno gapMs dal precedente (dei due si tiene il piu' forte). Il punto esatto e' il primo campione che arriva
    // al 25% del picco che segue, meno 1 ms. Al massimo `max` attacchi (i piu' forti); mai nei primi e negli ultimi 20 ms.
    onsets(chs, sr, a, b, sensitivity = 50, gapMs = 45, max = 31) {
      const H = Math.max(32, Math.round(sr * 0.006)), n = Math.floor((b - a) / H), nc = chs.length;
      if (n < 4) return [];
      const e = new Float32Array(b - a);
      let prev = 0;
      for (let i = a; i < b; i++) {
        let m = 0; for (let k = 0; k < nc; k++) m += chs[k][i];
        m /= nc; e[i - a] = m - 0.95 * prev; prev = m;
      }
      e[0] = 0;
      const L = new Float64Array(n);
      for (let k = 0; k < n; k++) { let s = 0; for (let i = k * H; i < (k + 1) * H; i++) s += e[i] * e[i]; L[k] = 10 * Math.log10(s / H + 1e-12); }
      const rise = 12 - clamp(sensitivity, 0, 100) / 10, R = k => L[k] - Math.max(L[k - 2], L[k - 3]);
      const gap = Math.round(sr * gapMs / 1000), edge = Math.round(sr * 0.02);
      let hits = [];
      for (let k = 3; k < n; k++) {
        const r = R(k);
        if (r < rise || L[k] < -50 || (k > 3 && R(k - 1) > r) || (k + 1 < n && R(k + 1) >= r)) continue;
        // il punto esatto: primo campione al 25% del picco dei blocchi che seguono
        let peak = 0;
        for (let i = (k - 1) * H, end = Math.min(e.length, (k + 3) * H); i < end; i++) peak = Math.max(peak, Math.abs(e[i]));
        let at = (k + 1) * H;
        for (let i = (k - 2) * H; i < (k + 1) * H; i++) if (Math.abs(e[i]) >= peak * 0.25) { at = i; break; }
        const pos = a + Math.max(0, at - Math.round(sr * 0.001));
        if (pos - a < edge || b - pos < edge) continue;
        const last = hits[hits.length - 1];
        if (last && pos - last.pos < gap) { if (r > last.r) hits[hits.length - 1] = { pos, r }; }
        else hits.push({ pos, r });
      }
      if (hits.length > max) hits = hits.slice().sort((x, y) => y.r - x.r).slice(0, max);
      return hits.map(h => h.pos).sort((x, y) => x - y);
    },
    // Le fette: da ogni inizio al successivo (l'ultima fino a b), con 2 ms di dissolvenza in uscita contro i click.
    slice(chs, starts, b, sr) {
      const f = Math.round(sr * 0.002);
      return starts.map((s, k) => {
        const e = k + 1 < starts.length ? starts[k + 1] : b, part = dsp.crop(chs, s, e), n = e - s;
        return n > 4 * f ? dsp.fade(part, n - f, n, "out") : part;
      });
    },
    // Lo step di ogni fetta nel pattern: la sua posizione nel pezzo, in proporzione agli step. Si parte dalle fette
    // piu' vicine a uno step; una fetta che trova il suo step occupato prova quello accanto dall'altra parte, senza
    // spostare le altre e senza cambiare l'ordine delle fette. Se non c'e' posto: -1 (ha la riga, il pattern non la suona).
    stepsOf(starts, a, b, steps) {
      const x = starts.map(s => (s - a) / (b - a) * steps), out = starts.map(() => -1), off = k => Math.abs(x[k] - Math.round(x[k]));
      const fits = (k, c) => c >= 0 && c < steps && out.every((v, j) => v < 0 || j === k || (j < k ? v < c : v > c));
      for (const k of x.map((_, k) => k).sort((i, j) => off(i) - off(j) || i - j)) {
        const r = Math.round(x[k]);
        for (const c of [Math.min(r, steps - 1), x[k] >= r ? r + 1 : r - 1]) if (fits(k, c)) { out[k] = c; break; }
      }
      return out;
    },
    // Un loop senza buchi: i primi L campioni, con quello che viene dopo (le code) ripiegato sull'inizio, come
    // quando il pattern suona di seguito. Se le code durano piu' del loop, girano piu' volte.
    wrap(chs, L) {
      return chs.map(d => { const o = d.slice(0, L); for (let i = L; i < d.length; i++) o[(i - L) % L] += d[i]; return o; });
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
.sed-tools[hidden], .sed-fx[hidden]{display:none;}
.sed-fx{display:flex; flex-direction:column; gap:9px; padding-top:9px; border-top:1px solid var(--edge-soft);}
.sed-fx-head{display:flex; flex-wrap:wrap; align-items:baseline; gap:3px 12px;}
.sed-fx-head h3{margin:0; font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--accent);}
.sed-fx-lead, .sed-fx-scope{margin:0; font-size:10px; color:var(--text-dim);}
.sed-fx-scope{color:var(--text-faint);}
.sed-fx-params{display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:8px 20px;}
.sed-fx-p{display:grid; grid-template-columns:76px minmax(0,1fr) 70px; align-items:center; gap:8px;}
.sed-fx-p > span{font-size:9px; letter-spacing:.1em; text-transform:uppercase; color:var(--text-faint);}
.sed-fx-p input[type=range]{width:100%; margin:0; accent-color:var(--accent);}
.sed-fx-p select{grid-column:2 / 4; min-width:0; font-size:11px;}
.sed-fx-p output{font:10px var(--mono,monospace); color:var(--text); text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap;}
.sed-fx-foot{display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 14px;}
.sed-fx-info{font-size:10px; color:var(--text-dim); font-variant-numeric:tabular-nums;}
.sed-fx-info.err{color:var(--danger);}
.sed-fx-params .sed-check{grid-column:1 / -1;}
.sed-fx-p[hidden]{display:none;}
.sed-stage.chop canvas{cursor:pointer;}
.sed-foot{display:flex; flex-wrap:wrap; justify-content:space-between; gap:4px 16px; align-items:baseline;}
.sed-help{margin:0; font-size:9.5px; color:var(--text-faint); line-height:1.45;}
.sed-status{font-size:10px; color:var(--text-dim);}
#sedSave.saved:disabled{opacity:1; color:var(--ok); border-color:var(--ok); font-weight:700;}
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
      <button type="button" class="mini" id="sedLoop" aria-pressed="false" title="Repeat while playing: the selection, or the whole sound when nothing is selected">⟲ Loop</button>
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
      <button type="button" class="mini" id="sedChopOpen" title="Cut the selection, or the whole sound, into slices: one pad each, and a pattern that plays them">Chop…</button>
      <label class="sed-check" title="Selection edges move to the nearest point where the wave crosses zero: cuts without clicks"><input type="checkbox" id="sedSnap" checked> Snap to zero crossings</label>
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
      <button type="button" class="mini" data-fx="crunch" title="Fewer kHz and fewer bits, like the samplers of the 80s: SP-1200, MPC60, Emulator II…">Crunch…</button>
      <button type="button" class="mini" data-fx="drive" title="Saturate, clip or fold the wave">Drive…</button>
      <button type="button" class="mini" data-fx="filter" title="Low-pass, high-pass, band-pass or notch filter">Filter…</button>
      <button type="button" class="mini" data-fx="eq" title="Three-band equalizer: low, mid, high">EQ…</button>
    </div>
  </div>
  <div class="sed-fx" id="sedFx" role="group" aria-labelledby="sedFxTitle" hidden>
    <div class="sed-fx-head"><h3 id="sedFxTitle"></h3><p class="sed-fx-lead" id="sedFxLead"></p><p class="sed-fx-scope" id="sedFxScope"></p></div>
    <div class="sed-fx-params" id="sedFxParams"></div>
    <div class="sed-fx-foot">
      <span class="sed-fx-info" id="sedFxInfo" role="status" aria-live="polite"></span>
      <div class="sed-group">
        <button type="button" class="mini" id="sedFxBypass" aria-pressed="false" title="Hear and see the sound without the effect, to compare (B)">Bypass</button>
        <button type="button" class="mini" id="sedFxCancel" title="Close without changing the sound (Esc)">Cancel</button>
        <button type="button" class="mini primary" id="sedFxApply" title="Write the effect into the sound (it can be undone)">Apply</button>
      </div>
    </div>
  </div>
  <div class="sed-fx" id="sedChop" role="group" aria-labelledby="sedChopTitle" hidden>
    <div class="sed-fx-head"><h3 id="sedChopTitle">Chop</h3>
      <p class="sed-fx-lead">Cut into slices: each one becomes a sound of its own, with a grid row and a pattern that plays them in order.</p>
      <p class="sed-fx-scope" id="sedChopScope"></p></div>
    <div class="sed-fx-params">
      <label class="sed-fx-p"><span>Cut</span><select id="sedChopMode"><option value="hits">On the hits</option><option value="equal">In equal parts</option></select></label>
      <label class="sed-fx-p" id="sedChopSensRow" title="Higher finds softer hits too"><span>Sensitivity</span><input type="range" id="sedChopSens" min="0" max="100" step="1"><output id="sedChopSensOut"></output></label>
      <label class="sed-fx-p" id="sedChopNRow"><span>Slices</span><select id="sedChopN"><option>2</option><option>4</option><option>8</option><option>16</option><option>32</option></select></label>
      <label class="sed-fx-p" title="How long the part is: it sets the length of the pattern and the tempo of the slices"><span>Length</span><select id="sedChopLen"></select></label>
      <label class="sed-check"><input type="checkbox" id="sedChopTempo" checked> <span id="sedChopTempoText"></span></label>
    </div>
    <div class="sed-fx-foot">
      <span class="sed-fx-info" id="sedChopInfo" role="status" aria-live="polite"></span>
      <div class="sed-group">
        <button type="button" class="mini" id="sedChopCancel" title="Close without cutting (Esc)">Cancel</button>
        <button type="button" class="mini" id="sedChopSave" title="Add the slices to the Sampler, without touching the grid">Save slices</button>
        <button type="button" class="mini primary" id="sedChopGrid" title="Add the slices to the Sampler, a grid row for each one and a new pattern that plays them in order">Slices → grid</button>
      </div>
    </div>
  </div>
  <div class="sed-foot">
    <p class="sed-help">Drag on the waveform to select, drag the edges to adjust, double-click to select all; click to place the cursor.
      The tools work on the selection, or on the whole sound when nothing is selected. Wheel scrolls, ⌘/Ctrl + wheel or pinch zooms.
      Color effects play and show the result before Apply; Chop cuts the sound into slices for the grid.
      Space plays · B bypasses an effect · 1–9 play the slices · ⌘Z undoes · Esc closes.</p>
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

  // ---------- effetti di colore: definizioni (cursori e menu del pannello li costruisce openFx) ----------
  const khz = v => +(v / 1000).toFixed(2) + " kHz";            // 26.04 kHz, 27.5 kHz, 40 kHz
  const hz = v => v < 1000 ? Math.round(v) + " Hz" : khz(v);
  const db = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + " dB";
  // Frequenza e bit dei campionatori veri; law "mu" = livelli compandati.
  const MACHINES = [
    { id: "sp1200", name: "E-mu SP-1200", rate: 26040, bits: 12, law: "linear" },
    { id: "sp12", name: "E-mu SP-12", rate: 27500, bits: 12, law: "linear" },
    { id: "mpc60", name: "Akai MPC60", rate: 40000, bits: 12, law: "linear" },
    { id: "emu2", name: "E-mu Emulator II", rate: 27700, bits: 8, law: "mu" },
    { id: "sk1", name: "Casio SK-1", rate: 9380, bits: 8, law: "linear" },
  ];
  const machineOf = p => MACHINES.find(m => m.rate === p.rate && m.bits === p.bits && m.law === p.law);
  const MIX = { k: "mix", label: "Mix", min: 0, max: 100, step: 1, def: 100, fmt: v => v + "%", title: "How much of the effect: 0% is the original sound" };
  const FX = {
    crunch: {
      title: "Crunch", lead: "Resample with fewer kHz and fewer bits, like the samplers of the 80s.",
      params: [
        { k: "machine", label: "Machine", options: [...MACHINES.map(m => [m.id, m.name]), ["custom", "Custom"]], def: "sp1200" },
        { k: "rate", label: "Rate", min: 2000, max: 48000, step: 10, def: 26040, fmt: khz, title: "Sample rate: lower loses the highs and adds aliasing" },
        { k: "bits", label: "Bits", min: 4, max: 16, step: 1, def: 12, fmt: v => v + " bit", title: "Fewer bits: more grit and more noise in the tails" },
        { k: "law", label: "Levels", options: [["linear", "Linear"], ["mu", "Companded · quieter tails"]], def: "linear",
          title: "Companded levels (like the Emulator II) are dense near silence and sparse on the peaks" },
        { k: "trick", label: "Pitch trick", min: 0, max: 12, step: 1, def: 0, fmt: v => v ? "+" + v + " st" : "off",
          title: "The SP-1200 trick: sample the record faster (45 rpm instead of 33 is about +5 st), then tune it back down. The pitch stays the same, the sound gets the grit of a lower rate." },
        MIX,
      ],
      change(p, k) {
        if (k === "machine") { const m = MACHINES.find(x => x.id === p.machine); if (m) Object.assign(p, { rate: m.rate, bits: m.bits, law: m.law }); }
        else if (k === "rate" || k === "bits" || k === "law") p.machine = machineOf(p)?.id || "custom";
      },
      // il trucco del pitch: accelerare di N semitoni e riabbassare equivale a campionare a rate / 2^(N/12)
      rate: p => p.rate / Math.pow(2, p.trick / 12),
      info: p => p.trick ? "like sampling at " + khz(FX.crunch.rate(p)) : "",
      run: (chs, sr, a, b, p) => dsp.crunch(chs, sr, a, b, FX.crunch.rate(p), p.bits, p.law),
      done: p => "crunch: " + (machineOf(p)?.name || khz(p.rate) + ", " + p.bits + " bit") + (p.trick ? ", pitch trick +" + p.trick + " st" : ""),
    },
    drive: {
      title: "Drive", lead: "Push the sound into saturation: denser, louder, dirtier.",
      params: [
        { k: "type", label: "Type", options: [["soft", "Soft · round saturation"], ["tube", "Tube · asymmetric, warmer"], ["hard", "Hard clip · square edges"], ["fold", "Fold · the wave folds back"]], def: "soft" },
        { k: "db", label: "Drive", min: 0, max: 36, step: 0.5, def: 12, fmt: db },
        { k: "out", label: "Output", min: -24, max: 6, step: 0.5, def: 0, fmt: db },
        MIX,
      ],
      run: (chs, sr, a, b, p) => dsp.drive(chs, sr, a, b, p),
      done: p => "drive: " + p.type + ", " + db(p.db),
    },
    filter: {
      title: "Filter", lead: "Take away the lows or the highs, or keep only a band.",
      params: [
        { k: "type", label: "Type", options: [["lowpass", "Low-pass"], ["highpass", "High-pass"], ["bandpass", "Band-pass"], ["notch", "Notch"]], def: "lowpass" },
        { k: "hz", label: "Cutoff", min: 20, max: 20000, log: true, def: 2000, fmt: hz },
        { k: "q", label: "Resonance", min: 0.5, max: 12, log: true, def: 0.71, fmt: v => "Q " + v.toFixed(2),
          title: "Low-pass and high-pass: a peak at the cutoff. Band-pass and notch: how narrow the band is" },
        { k: "slope", label: "Slope", options: [["12", "12 dB/oct · gentle"], ["24", "24 dB/oct · steep"]], def: "24" },
        MIX,
      ],
      run: (chs, sr, a, b, p) => dsp.filter(chs, sr, a, b, p),
      done: p => "filter: " + p.type + " at " + hz(p.hz),
    },
    eq: {
      title: "EQ", lead: "Three bands: raise or lower the lows, the mids and the highs.",
      params: [
        { k: "low", label: "Low 100 Hz", min: -12, max: 12, step: 0.5, def: 0, fmt: db },
        { k: "mid", label: "Mid", min: -12, max: 12, step: 0.5, def: 0, fmt: db },
        { k: "midHz", label: "Mid freq.", min: 200, max: 5000, log: true, def: 1000, fmt: hz },
        { k: "high", label: "High 8 kHz", min: -12, max: 12, step: 0.5, def: 0, fmt: db },
      ],
      run: (chs, sr, a, b, p) => dsp.eq(chs, sr, a, b, p),
      done: p => `EQ: low ${db(p.low)}, mid ${db(p.mid)} at ${hz(p.midHz)}, high ${db(p.high)}`,
    },
  };
  const fxMem = {};      // le ultime regolazioni di ogni effetto, finche' la pagina resta aperta
  // cursori logaritmici (frequenze, risonanza): posizione 0-1000
  const fromLog = (q, v) => { const x = q.min * Math.pow(q.max / q.min, v / 1000); return x < 10 ? Math.round(x * 100) / 100 : Math.round(x); };
  const toLog = (q, x) => Math.round(Math.log(x / q.min) / Math.log(q.max / q.min) * 1000);

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
      text: v("--text", "#eee"), mono: v("--mono", "monospace"), bg: v("--panel-3", "#222"), onAccent: v("--on-accent", "#fff") };
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
    const chs = shownChs(), key = [w, h, dpr, st.view.from, st.view.span, st.id, chs === st.chs ? "" : st.fx.key].join();
    if (st.layer && st.layerKey === key) return st.layer;
    const L = st.layer || document.createElement("canvas");
    L.width = Math.round(w * dpr); L.height = Math.round(h * dpr);
    const c = L.getContext("2d"), col = colors(), { from, span } = st.view, n = chs.length, lane = (h - RULER) / n;
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
      const d = chs[k], mid = RULER + lane * (k + 0.5), amp = lane * 0.45;
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
    if (st.chop) drawChop(c, w, h, col);
    else if (b > a) {
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

  // Chop: fuori dal pezzo velato, i tagli con una linguetta numerata (il numero della fetta che parte li')
  function drawChop(c, w, h, col) {
    const ch = st.chop, [a, b] = ch.region, x1 = xOf(a, w), x2 = xOf(b, w);
    c.fillStyle = col.bg; c.globalAlpha = 0.72;
    if (x1 > 0) c.fillRect(0, RULER, x1, h - RULER);
    if (x2 < w) c.fillRect(x2, RULER, w - x2, h - RULER);
    c.font = "bold 9px " + col.mono; c.textBaseline = "middle"; c.textAlign = "center";
    [a, ...ch.cuts].forEach((s, k) => {
      const x = Math.round(xOf(s, w));
      if (x < -30 || x > w) return;
      c.fillStyle = col.accent; c.globalAlpha = k ? 0.95 : 0.6;
      c.fillRect(x - (k ? 1 : 0.5), RULER, k ? 2 : 1, h - RULER);
      const label = String(k + 1), tw = Math.max(14, c.measureText(label).width + 6);
      c.globalAlpha = 1; c.fillRect(x, RULER, tw, 13);
      c.fillStyle = col.onAccent; c.fillText(label, x + tw / 2, RULER + 7);
    });
    c.fillStyle = col.accent; c.globalAlpha = 0.6; c.fillRect(Math.round(x2) - 0.5, RULER, 1, h - RULER);
    c.textAlign = "start"; c.globalAlpha = 1;
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
      + (dirty ? " · <b>not saved</b>" : st.savedOnce ? " · saved ✓" : "");
    // con un effetto o il Chop aperti si salva dopo averli chiusi; durante il Chop il pezzo (la selezione) resta fermo
    const busy = !!(st.fx || st.chop), chop = !!st.chop;
    $("sedUndo").disabled = !st.undo.length || chop; $("sedRedo").disabled = !st.redo.length || chop;
    // Save dice sempre a che punto e': da salvare (acceso), in corso, salvato (✓ verde) o niente da salvare
    const sv = $("sedSave");
    sv.disabled = !dirty || busy || !!st.saving;
    sv.textContent = st.saving ? "Saving…" : dirty ? "Save" : st.savedOnce ? "✓ Saved" : "No changes";
    sv.classList.toggle("primary", dirty || !!st.saving); sv.classList.toggle("saved", !dirty && !!st.savedOnce && !st.saving);
    sv.title = dirty ? (busy ? "Close the effect or Chop first, then save" : "Replace the sample: the grid rows and the synth that use it play the edit")
      : st.savedOnce ? "Saved: the grid rows and the synth that use this sample play the edit" : "Nothing to save yet: edit the sound first";
    $("sedSaveNew").disabled = $("sedExport").disabled = busy;
    for (const b of ui.dlg.querySelectorAll("[data-need-sel]")) b.disabled = !hasSel();
    $("sedZoomSel").disabled = !hasSel(); $("sedNone").disabled = !hasSel() || chop;
    $("sedAll").disabled = $("sedStart").disabled = $("sedEnd").disabled = chop;
    $("sedLoop").setAttribute("aria-pressed", String(st.loop));
    $("sedPlay").textContent = st.play ? "■ Stop" : "▶ Play";
    readout();
    if (st.fx) fxStatus();
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

  // ---------- effetti: pannello con anteprima ----------
  // Con un effetto aperto si sente e si vede il suono con l'effetto (Bypass: l'originale); Apply lo scrive, con undo.
  const range = () => hasSel() ? [st.sel.a, st.sel.b] : [0, len()];
  // Il suono da far sentire e vedere. L'effetto si ricalcola quando cambiano regolazioni, selezione o suono;
  // mentre si trascina la selezione resta l'ultimo calcolato.
  function shownChs() {
    const f = st.fx;
    if (!f || f.bypass) return st.chs;
    if (drag && f.chs) return f.chs;
    const [a, b] = range(), key = [st.id, a, b, JSON.stringify(f.p)].join("|");
    if (f.key !== key) {
      const wet = FX[f.kind].run(st.chs, st.sr, a, b, f.p), mix = f.p.mix ?? 100;
      f.chs = mix < 100 || a > 0 || b < len() ? dsp.mix(st.chs, wet, a, b, mix / 100, Math.round(st.sr * 0.003)) : wet;
      f.key = key; f.peak = dsp.peak(f.chs);
    }
    return f.chs;
  }
  let fxTimer = 0;
  const fxBox = () => $("sedFxParams");
  function openFx(kind) {
    stop();
    const def = FX[kind], p = {};
    for (const q of def.params) p[q.k] = q.def;
    Object.assign(p, fxMem[kind]);
    st.fx = { kind, p, bypass: false, key: "", chs: null, peak: 0 };
    $("sedFxTitle").textContent = def.title; $("sedFxLead").textContent = def.lead;
    const box = fxBox(); box.textContent = "";
    for (const q of def.params) {
      const row = document.createElement("label"), name = document.createElement("span");
      row.className = "sed-fx-p"; if (q.title) row.title = q.title;
      name.textContent = q.label; row.appendChild(name);
      let input;
      if (q.options) {
        input = document.createElement("select");
        for (const [v, t] of q.options) input.add(new Option(t, v));
        input.onchange = () => fxSet(q.k, input.value);
        row.appendChild(input);
      } else {
        input = document.createElement("input"); input.type = "range";
        Object.assign(input, q.log ? { min: 0, max: 1000, step: 1 } : { min: q.min, max: q.max, step: q.step });
        input.oninput = () => fxSet(q.k, q.log ? fromLog(q, +input.value) : +input.value);
        row.append(input, document.createElement("output"));
      }
      input.dataset.k = q.k;
      box.appendChild(row);
    }
    ui.dlg.querySelector(".sed-tools").hidden = true; $("sedFx").hidden = false;
    syncFx(); previewNow();
    box.querySelector("select, input").focus({ preventScroll: true });
  }
  // cursori, menu e uscite dai valori (un preset cambia piu' cursori insieme)
  function syncFx() {
    const f = st.fx;
    for (const q of FX[f.kind].params) {
      const input = fxBox().querySelector(`[data-k="${q.k}"]`), v = f.p[q.k];
      if (q.options) { input.value = String(v); continue; }
      if (document.activeElement !== input) input.value = q.log ? toLog(q, v) : v;
      input.nextElementSibling.textContent = q.fmt(v);
    }
    $("sedFxBypass").setAttribute("aria-pressed", String(f.bypass));
  }
  function fxSet(k, v) {
    const f = st && st.fx; if (!f) return;
    f.p[k] = v;
    if (FX[f.kind].change) FX[f.kind].change(f.p, k);
    syncFx();
    clearTimeout(fxTimer); fxTimer = setTimeout(previewNow, 60);
  }
  // ricalcola e ridisegna; se sta suonando riparte dallo stesso punto con il suono nuovo
  function previewNow() {
    clearTimeout(fxTimer);
    if (!st || !st.fx) return;
    draw(); refresh();
    if (st.play) play(playPos());
  }
  function fxBypass() {
    if (!st.fx) return;
    st.fx.bypass = !st.fx.bypass;
    syncFx(); previewNow();
  }
  function fxStatus() {
    const f = st.fx, [a, b] = range(), info = $("sedFxInfo");
    $("sedFxScope").textContent = hasSel() ? "On the selection · " + fmt((b - a) / st.sr) : "On the whole sound";
    if (f.bypass) { info.textContent = "Bypass: you hear the original sound"; info.classList.remove("err"); return; }
    shownChs();
    const extra = FX[f.kind].info ? FX[f.kind].info(f.p) : "", over = f.peak > 1;
    info.textContent = [extra, "peak after " + dbfs(f.peak), over ? "over 0 dB: Normalize after Apply, or it clips when saved" : ""].filter(Boolean).join(" · ");
    info.classList.toggle("err", over);
  }
  function closeFx() {
    if (!st || !st.fx) return;
    clearTimeout(fxTimer);
    fxMem[st.fx.kind] = { ...st.fx.p };
    stop();
    st.fx = null;
    $("sedFx").hidden = true; ui.dlg.querySelector(".sed-tools").hidden = false;
    draw(); refresh();
    ui.canvas.focus({ preventScroll: true });
  }
  function applyFx() {
    const f = st && st.fx; if (!f) return;
    f.bypass = false; drag = null;
    const chs = shownChs(), msg = FX[f.kind].done(f.p) + (hasSel() ? " (selection)" : "");
    closeFx();
    if (chs === st.chs) return note("With these settings the effect changes nothing");
    commit(chs, { ...st.sel }, msg);
  }

  // ---------- chop: fette sui colpi o in parti uguali ----------
  // Il pezzo e' la selezione (o tutto il suono) al momento dell'apertura. I tagli si spostano trascinandoli, il
  // doppio clic ne aggiunge o ne toglie uno, un clic su una fetta (o i tasti 1-9) la fa sentire.
  const chopMem = { mode: "hits", sens: 50, n: 16 }, MIN_SLICE = 0.01;
  function openChop() {
    if (!st.opts.chop) return;
    const [a, b] = range(), dur = (b - a) / st.sr;
    if (dur < 0.1) return note("Select at least 0.1 s to chop", true);
    stop();
    const cur = st.opts.chop.bpm || 120, lens = (st.opts.chop.lens || []).map(o => ({ ...o, bpm: o.quarters * 60 / dur }));
    // la lunghezza di partenza: quella che da' il tempo piu' vicino a quello del progetto
    const near = o => Math.abs(Math.log(o.bpm / cur));
    st.chop = { ...chopMem, region: [a, b], cuts: [], lens, len: lens.reduce((best, o, i) => near(o) < near(lens[best]) ? i : best, 0), busy: false };
    const sel = $("sedChopLen"); sel.textContent = "";
    lens.forEach((o, i) => sel.add(new Option(`${o.label} · ${o.steps} steps · ${o.bpm.toFixed(1)} BPM`, i)));
    $("sedChopMode").value = st.chop.mode; $("sedChopSens").value = st.chop.sens; $("sedChopN").value = String(st.chop.n);
    sel.value = String(st.chop.len); sel.disabled = !lens.length;
    ui.dlg.querySelector(".sed-tools").hidden = true; $("sedChop").hidden = false; ui.stage.classList.add("chop");
    ui.canvas.style.cursor = "";
    chopCompute(); refresh();
    $("sedChopMode").focus({ preventScroll: true });
  }
  function chopCompute() {
    const c = st.chop, [a, b] = c.region;
    let cuts = [];
    if (c.mode === "hits") cuts = dsp.onsets(st.chs, st.sr, a, b, c.sens);
    else for (let k = 1; k < c.n; k++) cuts.push(a + Math.round(k * (b - a) / c.n));
    if ($("sedSnap").checked) { const r = Math.round(st.sr * (c.mode === "hits" ? 0.001 : 0.002)); cuts = cuts.map(s => dsp.zeroCross(st.chs, s, r)); }
    c.cuts = cleanCuts(cuts);
    chopUI();
  }
  // tagli in ordine, dentro il pezzo, ad almeno MIN_SLICE l'uno dall'altro
  function cleanCuts(cuts) {
    const [a, b] = st.chop.region, g = Math.round(st.sr * MIN_SLICE), out = [];
    for (const s of cuts.slice().sort((x, y) => x - y)) if (s - (out.length ? out[out.length - 1] : a) >= g && b - s >= g) out.push(s);
    return out;
  }
  function chopUI() {
    const c = st.chop, [a, b] = c.region, starts = [a, ...c.cuts], n = starts.length, o = c.lens[c.len];
    $("sedChopSensRow").hidden = c.mode !== "hits"; $("sedChopNRow").hidden = c.mode !== "equal";
    $("sedChopSensOut").textContent = c.sens;
    $("sedChopScope").textContent = (hasSel() ? "The selection" : "The whole sound") + " · " + fmt((b - a) / st.sr)
      + " · drag a marker to move it, double-click to add or remove one, click a slice or press 1–9 to hear it";
    const box = $("sedChopTempo"), txt = $("sedChopTempoText"), cur = st.opts.chop.bpm, t = o ? Math.round(o.bpm) : 0;
    box.disabled = !o || t < 40 || t > 240 || t === cur;
    txt.textContent = !o ? "The grid has no pattern length for this part"
      : t < 40 || t > 240 ? `${t} BPM is out of the tempo range (40–240): choose another length`
      : t === cur ? `The project is already at ${t} BPM`
      : `Set the project tempo to ${t} BPM (now ${cur})`;
    let info = n + (n === 1 ? " slice" : " slices");
    if (n > 1) info += " · shortest " + fmt(Math.min(...starts.map((s, k) => (k + 1 < n ? starts[k + 1] : b) - s)) / st.sr);
    if (c.mode === "hits" && n === 1) info = "No hits found: raise the sensitivity, or cut in equal parts";
    const lost = o && n > 1 ? dsp.stepsOf(starts, a, b, o.steps).filter(k => k < 0).length : 0;
    if (lost) info += ` · ${lost} without a free step: ${lost === 1 ? "it gets a row, the pattern skips it" : "they get a row, the pattern skips them"}`;
    $("sedChopInfo").textContent = info;
    $("sedChopGrid").disabled = !o || n < 2 || c.busy; $("sedChopSave").disabled = n < 2 || c.busy;
    draw();
  }
  function markerAt(clientX) {
    const r = ui.canvas.getBoundingClientRect(), x = clientX - r.left;
    let best = -1, bd = 7;
    st.chop.cuts.forEach((s, i) => { const d = Math.abs(x - xOf(s, r.width)); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function sliceSpan(k) {
    const c = st.chop, starts = [c.region[0], ...c.cuts];
    return k >= 0 && k < starts.length ? [starts[k], k + 1 < starts.length ? starts[k + 1] : c.region[1]] : null;
  }
  function audition(k) { const span = sliceSpan(k); if (span) play(null, span); }
  function chopDown(e) {
    const m = markerAt(e.clientX);
    if (m >= 0) { drag = { mode: "marker", i: m }; ui.canvas.setPointerCapture(e.pointerId); return; }
    const s = sampleAt(e.clientX), c = st.chop;
    if (s >= c.region[0] && s < c.region[1]) audition(c.cuts.filter(x => x <= s).length);
  }
  function chopMove(clientX) {
    const c = st.chop, i = drag.i, g = Math.round(st.sr * MIN_SLICE);
    const lo = (i ? c.cuts[i - 1] : c.region[0]) + g, hi = (i + 1 < c.cuts.length ? c.cuts[i + 1] : c.region[1]) - g;
    c.cuts[i] = clamp(sampleAt(clientX), lo, hi);
    draw();
  }
  function chopDrop() {
    const c = st.chop, i = drag.i;
    drag = null;
    if ($("sedSnap").checked) c.cuts[i] = dsp.zeroCross(st.chs, c.cuts[i], Math.round(st.sr * 0.002));
    c.cuts = cleanCuts(c.cuts);
    chopUI();
  }
  function chopDouble(e) {
    const c = st.chop, m = markerAt(e.clientX);
    if (m >= 0) c.cuts.splice(m, 1);
    else {
      let s = sampleAt(e.clientX);
      if (s <= c.region[0] || s >= c.region[1]) return;
      if ($("sedSnap").checked) s = dsp.zeroCross(st.chs, s, Math.round(st.sr * 0.002));
      c.cuts = cleanCuts([...c.cuts, s]);
    }
    stop(); chopUI();
  }
  function closeChop() {
    if (!st || !st.chop) return;
    const c = st.chop;
    Object.assign(chopMem, { mode: c.mode, sens: c.sens, n: c.n });
    stop(); drag = null; st.chop = null;
    $("sedChop").hidden = true; ui.dlg.querySelector(".sed-tools").hidden = false; ui.stage.classList.remove("chop");
    draw(); refresh();
    ui.canvas.focus({ preventScroll: true });
  }
  // Le fette diventano campioni (WAV 16 bit) nel Sampler; con toGrid anche righe e un pattern (lo fa opts.chop.make).
  async function chopMake(toGrid) {
    const c = st && st.chop; if (!c || c.busy) return;
    const [a, b] = c.region, starts = [a, ...c.cuts], o = toGrid ? c.lens[c.len] : null;
    if (toGrid && !o) return;
    const parts = dsp.slice(st.chs, starts, b, st.sr), steps = o ? dsp.stepsOf(starts, a, b, o.steps) : null;
    const digits = Math.max(2, String(parts.length).length), ctx = actx(), base = st.name.slice(0, 50);
    const slices = parts.map((chs, k) => ({ name: base + " " + String(k + 1).padStart(digits, "0"),
      blob: new Blob([dsp.encodeWav(chs, st.sr)], { type: "audio/wav" }), audio: audioBuffer(ctx, chs), step: steps ? steps[k] : -1 }));
    const tempo = $("sedChopTempo"), grid = o ? { steps: o.steps, bpm: tempo.checked && !tempo.disabled ? Math.round(o.bpm) : null } : null;
    stop(); c.busy = true; chopUI();
    try { await st.opts.chop.make({ name: st.name, slices, grid }); }
    catch (e) {
      if (st && st.chop === c) { c.busy = false; chopUI(); }
      return note(e && e.message ? e.message : "The slices could not be saved", true);
    }
    if (!st) return;
    closeChop();
    note(`${slices.length} slices added to the Sampler` + (grid ? ", the grid and a new pattern" : ""));
    if (grid) close();       // si torna alla griglia; se il suono ha modifiche non salvate, close() lo chiede
  }

  // ---------- ascolto ----------
  function audioBuffer(ctx = actx(), chs = st.chs) {
    const buf = ctx.createBuffer(chs.length, chs[0].length, st.sr);
    chs.forEach((c, i) => buf.copyToChannel(c, i));
    return buf;
  }
  function playPos() {
    const p = st.play; if (!p) return 0;
    const el = (p.ctx.currentTime - p.t0) * st.sr;
    return p.loop ? p.from + el % (p.to - p.from) : Math.min(p.to, p.from + el);
  }
  // `at`: il punto da cui ripartire (quando cambia l'anteprima di un effetto mentre suona);
  // `span`: [da, a] al posto della selezione (una fetta del Chop), senza loop.
  // Loop: ripete la selezione; senza selezione tutto il suono, partendo dal cursore.
  async function play(at, span) {
    stop();
    const ctx = actx(); if (ctx.state === "suspended") await ctx.resume();
    if (!st) return;
    const n = len(), sel = hasSel(), loop = st.loop && !span, cursor = st.sel.a < n - 1 ? st.sel.a : 0;
    const [from, to] = span || (sel ? [st.sel.a, st.sel.b] : [loop ? 0 : cursor, n]);
    const pos = at == null ? (loop && !sel ? cursor : from) : clamp(Math.round(at), from, Math.max(from, to - 1));
    const src = ctx.createBufferSource(); src.buffer = audioBuffer(ctx, shownChs()); src.connect(ctx.destination);
    if (loop) { src.loop = true; src.loopStart = from / st.sr; src.loopEnd = to / st.sr; src.start(0, pos / st.sr); }
    else src.start(0, pos / st.sr, (to - pos) / st.sr);
    st.play = { src, ctx, t0: ctx.currentTime - (pos - from) / st.sr, from, to, loop };
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
      if (st.chop) return chopDown(e);
      const s = sampleAt(e.clientX), edge = edgeAt(e.clientX);
      drag = { mode: edge || "new", anchor: edge === "a" ? st.sel.b : edge === "b" ? st.sel.a : s };
      if (!edge) st.sel = { a: s, b: s };
      cv.setPointerCapture(e.pointerId);
      draw(); refresh();
    });
    cv.addEventListener("pointermove", e => {
      if (!st) return;
      if (st.chop) { if (drag) chopMove(e.clientX); else cv.style.cursor = markerAt(e.clientX) >= 0 ? "ew-resize" : ""; return; }
      if (!drag) { cv.style.cursor = edgeAt(e.clientX) ? "ew-resize" : "crosshair"; return; }
      const s = sampleAt(e.clientX);
      st.sel = s < drag.anchor ? { a: s, b: drag.anchor } : { a: drag.anchor, b: s };
      draw(); readout();
    });
    const end = () => {
      if (!drag) return;
      if (drag.mode === "marker") return st && st.chop ? chopDrop() : (drag = null);
      drag = null; snapSel(); draw(); refresh();
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("dblclick", e => { if (st) st.chop ? chopDouble(e) : selectAll(); });
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
    $("sedLoop").onclick = () => { st.loop = !st.loop; if (st.play) play(playPos()); refresh(); };   // continua da dov'e'
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
    for (const b of dlg.querySelectorAll("[data-fx]")) b.onclick = () => openFx(b.dataset.fx);
    $("sedFxBypass").onclick = fxBypass; $("sedFxCancel").onclick = closeFx; $("sedFxApply").onclick = applyFx;
    $("sedChopOpen").onclick = openChop;
    $("sedChopMode").onchange = e => { st.chop.mode = e.target.value; chopCompute(); };
    $("sedChopSens").oninput = e => { st.chop.sens = +e.target.value; chopCompute(); };
    $("sedChopN").onchange = e => { st.chop.n = +e.target.value; chopCompute(); };
    $("sedChopLen").onchange = e => { st.chop.len = +e.target.value; chopUI(); };
    $("sedChopCancel").onclick = closeChop;
    $("sedChopSave").onclick = () => chopMake(false);
    $("sedChopGrid").onclick = () => chopMake(true);
    $("sedUndo").onclick = undo; $("sedRedo").onclick = redo;
    $("sedSave").onclick = () => save(false);
    $("sedSaveNew").onclick = () => save(true);
    $("sedExport").onclick = () => {
      const blob = new Blob([dsp.encodeWav(st.chs, st.sr)], { type: "audio/wav" });
      saveBlob(blob, st.name.replace(/[\\/:*?"<>|]+/g, "-") + ".wav", "Sample");
    };
    $("sedClose").onclick = close;
    // Esc chiude prima il Chop o l'effetto, poi l'editor
    dlg.addEventListener("cancel", e => { e.preventDefault(); st && st.chop ? closeChop() : st && st.fx ? closeFx() : close(); });
    dlg.addEventListener("keydown", e => {
      if (!st) return;
      const t = e.target, typing = t.tagName === "INPUT" && (t.type === "number" || t.type === "text"), mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); e.stopPropagation(); if (!st.chop) e.shiftKey ? redo() : undo(); return; }
      if (typing || e.altKey) return;
      if (e.key === " ") { e.preventDefault(); if (t.tagName === "BUTTON") t.blur(); st.play ? stop() : play(); }
      else if (st.fx && !mod && k === "b") { e.preventDefault(); fxBypass(); }
      else if (st.chop && !mod && /^[1-9]$/.test(e.key)) { e.preventDefault(); audition(+e.key - 1); }
      else if (mod && k === "a") { e.preventDefault(); if (!st.chop) selectAll(); }
      else if ((e.key === "Backspace" || e.key === "Delete") && hasSel() && !st.fx && !st.chop) { e.preventDefault(); apply("delete"); }
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
        st.opts = { ...st.opts, ...next }; st.name = next.name; st.saved = st.id; st.savedOnce = true;
        note("saved as “" + next.name + "”: you are now editing the new sample");
      } else {
        st.saving = true; refresh();
        const done = await st.opts.save(blob, audioBuffer());
        if (!st) return;
        st.saving = false;
        if (done === false) { refresh(); return; }
        st.saved = st.id; st.savedOnce = true;
        note("saved: the grid and the synth play the edit");
      }
      refresh();
    } catch (e) { if (st) { st.saving = false; refresh(); } note(e && e.message ? e.message : "The sample could not be saved", true); }
  }
  async function close() {
    if (!st) return;
    if (st.id !== st.saved) {
      const ok = await ask({ title: "Close the editor?", message: "The changes that are not saved will be lost.", ok: "Discard changes", cancel: "Keep editing", danger: true });
      if (!ok) return;
    }
    stop(); clearTimeout(fxTimer);
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
      undo: [], redo: [], id: 0, saved: 0, nextId: 1, loop: false, play: null, layer: null, layerKey: "", fx: null, chop: null };
    $("sedFx").hidden = $("sedChop").hidden = true; ui.dlg.querySelector(".sed-tools").hidden = false; ui.stage.classList.remove("chop");
    $("sedChopOpen").hidden = !opts.chop;
    note("");
    if (!ui.dlg.open) ui.dlg.showModal();
    ui.canvas.focus({ preventScroll: true });
    refresh();
    requestAnimationFrame(fit);
  }

  window.PMSampleEditor = { open, dsp, isOpen: () => !!st };
})();
