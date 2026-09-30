// Motore ritmico SP-1200.
// Ogni stile e' una scheda (vedi styles-*.js): metadati, varianti pesate, fill ammessi,
// colpi obbligatori per i test e un generatore che scrive su un contesto `c`.
// Tutto il caso passa da un generatore con seed: lo stesso codice rigenera sempre lo
// stesso pattern, quindi un pattern si puo' condividere come stringa o link.
//
// Codice: <stile>-<step><S|R>[F]-<seed esadecimale a 6 cifre>[~<passo>]...
// Ogni passo dopo la base e' una trasformazione riproducibile:
//   ~HHHH           "altri cosi'" (mutazione con seed a 4 cifre)
//   ~RMMMMMMHHHH    rigenera tenendo le voci bloccate (maschera a 6 cifre su ROLE_ORDER, seed a 4)
//   ~V<T>HHHH       variazione di tipo T (lettera, vedi variations.js) con seed a 4 cifre
//   dbeat-16R-7F3A9B                 D-beat, 16 step, ritornello, senza fill
//   motorik-32SF-00A1C2~4C21         motorik, 32 step, strofa con fill, poi una mutazione
//   dbeat-16S-111111~R000005BEEF     cassa e rullante tenuti, il resto rigenerato
(function (root) {
  "use strict";

  // ---------- voci ----------
  // Tom 1 e Tom 2 hanno la stessa intonazione: il tune separa tom alto e floor tom.
  const ROLE_SAMPLE = {
    kick: "Kick 1", kick2: "Kick 2", snare: "Snare 1", snare2: "Snare 2", snare3: "Snare 3", rim: "Rimshot",
    clap: "Finger Snap", chh: "Closed Hat 1", chh2: "Closed Hat 2", ohh: "Open Hat 1",
    ride: "Ride 1", crash: "Crash 1", china: "China", tom: "Tom 1", tom2: "Tom 2",
    cow: "Cowbell 1", conga: "Conga 1", conga2: "Conga 3", tamb: "Tambourine", shaker: "Cabasa 1",
    clave: "Clave 1", perc: "Perc 1",
  };
  const ROLE_DEFAULTS = {
    kick: { vol: 0.95 }, kick2: { vol: 0.9 }, snare: { vol: 0.9 }, snare2: { vol: 0.85 }, snare3: { vol: 0.85 },
    rim: { vol: 0.7 }, clap: { vol: 0.75 }, chh: { vol: 0.55, choke: 1 }, chh2: { vol: 0.5, choke: 1 },
    ohh: { vol: 0.55, choke: 1 }, ride: { vol: 0.6 }, crash: { vol: 0.7 }, china: { vol: 0.6 },
    tom: { vol: 0.8, tune: 4 }, tom2: { vol: 0.85, tune: -5 }, cow: { vol: 0.6 }, conga: { vol: 0.7 },
    conga2: { vol: 0.7 }, tamb: { vol: 0.55 }, shaker: { vol: 0.5 }, clave: { vol: 0.6 }, perc: { vol: 0.65 },
  };
  // L'ordine e' parte del formato dei codici (maschera delle voci bloccate):
  // voci nuove vanno aggiunte in fondo, mai in mezzo.
  const ROLE_ORDER = ["kick", "kick2", "snare", "snare2", "snare3", "clap", "rim", "chh", "chh2", "ohh", "ride",
    "crash", "china", "tom", "tom2", "cow", "conga", "conga2", "clave", "tamb", "shaker", "perc"];

  // ---------- caso con seed (mulberry32) ----------
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const r = {
      next,
      rnd: p => next() < p,
      int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
      pick: arr => arr[Math.floor(next() * arr.length)],
      between: v => Array.isArray(v) ? r.int(v[0], v[1]) : (v || 0),
      weighted(items) {
        const tot = items.reduce((s, it) => s + (it.w ?? 1), 0);
        let x = next() * tot;
        for (const it of items) { x -= (it.w ?? 1); if (x < 0) return it; }
        return items[items.length - 1];
      },
      some(arr, min, max) {
        const a2 = arr.slice(), out = [];
        const n = r.int(min, max);
        while (out.length < n && a2.length) out.push(a2.splice(Math.floor(next() * a2.length), 1)[0]);
        return out;
      },
    };
    return r;
  }
  const randomSeed = (bits = 24) => Math.floor(Math.random() * 2 ** bits);
  const hex = (n, digits) => n.toString(16).toUpperCase().padStart(digits, "0");

  // ---------- helper per le schede ----------
  const zeros = n => new Array(n).fill(0);
  function euclid(k, n, rot = 0) {
    const out = zeros(n);
    for (let i = 0; i < n; i++) if (Math.floor((i + 1) * k / n) > Math.floor(i * k / n)) out[(i + rot + n) % n] = 1;
    return out;
  }

  function makeCtx(len, section, r, variant) {
    const R = {}, bars = len / 16;
    const put = (role, i, v = 1) => {
      if (i < 0 || i >= len) return;
      if (!ROLE_SAMPLE[role]) throw new Error("voce sconosciuta: " + role);
      (R[role] = R[role] || zeros(len))[i] = v;
    };
    const get = (role, i) => (R[role] || [])[i] || 0;
    const each = (base, step, fn) => { for (let i = base; i < len; i += step) fn(i); };
    const perBar = fn => { for (let b = 0; b < bars; b++) fn(b * 16, b); };
    const backbeats = []; perBar(o => backbeats.push(o + 4, o + 12));
    return {
      R, len, bars, put, get, each, perBar, backbeats,
      verse: section !== "chorus", chorus: section === "chorus",
      variant: variant ? variant.id : "", note: "",
      rnd: r.rnd, pick: r.pick, int: r.int, some: r.some,
    };
  }

  // Una cella per battuta; nelle battute pari a volte risponde con un'altra cella
  // dello stesso pool (domanda/risposta), invece di ripetere identico.
  function cells(c, role, pool, acc = [0], answer = 0.5) {
    const first = c.pick(pool);
    c.perBar((o, b) => {
      const cell = (b % 2 === 1 && c.rnd(answer)) ? c.pick(pool) : first;
      cell.forEach(s => c.put(role, o + s, acc.includes(s) ? 2 : 1));
    });
  }
  const hits = (c, role, steps, acc = []) => c.perBar(o => steps.forEach(s => c.put(role, o + s, acc.includes(s) ? 2 : 1)));
  const backbeat = (c, role = "snare", beats = [4, 12]) => c.perBar(o => beats.forEach(s => c.put(role, o + s, 2)));
  const cymbal = (c, role, step = 2, from = 0) => c.each(from, step, i => c.put(role, i, i % 4 === 0 ? 2 : 1));
  function ghosts(c, role, cands, min, max) {
    c.perBar(o => c.some(cands, min, max).forEach(s => { if (!c.get(role, o + s)) c.put(role, o + s, 1); }));
  }
  function euclidBars(c, role, k, rot = 0, accent = true) {
    const e = euclid(k, 16, rot);
    c.perBar(o => e.forEach((v, s) => { if (v) c.put(role, o + s, accent && s === 0 ? 2 : 1); }));
  }
  // Apre l'hi-hat su uno step e toglie il chiuso nello stesso punto.
  const openHat = (c, i, v = 1) => { c.put("ohh", i, v); if (c.get("chh", i)) c.put("chh", i, 0); };

  // ---------- fill ----------
  // Sugli ultimi 4 (o 8) step. I fill "kit" svuotano la batteria in quella finestra e
  // atterrano con un crash sull'1 del giro successivo; gli altri riscrivono solo le loro voci.
  const KIT_ROLES = ["kick", "kick2", "snare", "snare2", "snare3", "clap", "rim", "chh", "chh2", "ohh",
    "ride", "crash", "china", "tom", "tom2", "tamb", "cow"];
  const FILLS = {
    roll: { kit: true, hit: (k, n) => [["snare", k >= n - 2 ? 2 : 1]] },
    down: { kit: true, hit: (k, n) => [[k < n / 2 ? "snare" : (k < n * 3 / 4 ? "tom" : "tom2"), k % 2 ? 1 : 2]] },
    unison: { kit: true, hit: (k) => k % 2 ? [["snare", 1]] : [["snare", 2], ["kick", 1]] },
    toms: { kit: true, hit: (k) => k % 2 ? [["tom2", 1]] : [["tom", 2], ["kick", 1]] },
    machine: { kit: true, hit: (k, n) => k === n - 1 ? [["tom2", 2], ["kick", 2]] : [[k < n / 2 ? "snare3" : "tom", 2]] },
    hats: { kit: false, roles: ["chh", "ohh"], hit: (k) => [["chh", k === 0 ? 2 : 1]] },
    claps: { kit: false, roles: ["clap"], hit: (k, n) => [["clap", k >= n - 2 ? 2 : 1]] },
    congas: { kit: false, roles: ["conga", "conga2"], hit: (k) => [[k % 2 ? "conga2" : "conga", k === 0 ? 2 : 1]] },
  };
  function addFill(c, types) {
    const n = (c.len >= 32 && c.rnd(0.5)) ? 8 : 4, s = c.len - n, f = FILLS[c.pick(types)];
    (f.kit ? KIT_ROLES : f.roles).forEach(role => { if (c.R[role]) for (let i = s; i < c.len; i++) c.R[role][i] = 0; });
    for (let k = 0; k < n; k++) f.hit(k, n).forEach(([role, v]) => c.put(role, s + k, v));
    if (f.kit) c.put("crash", 0, 2);
  }

  // ---------- registro ----------
  const GROUPS = [];
  const STYLES = {};
  function defineGroup(g) { if (!GROUPS.some(x => x.id === g.id)) GROUPS.push(g); }
  function defineStyles(groupId, list) {
    list.forEach(st => {
      if (STYLES[st.id]) throw new Error("stile duplicato: " + st.id);
      STYLES[st.id] = Object.assign({ group: groupId, swing: 0, fills: ["roll"], variants: null }, st);
    });
  }
  // Micro-timing suggerito, in ms per voce (negativo = in anticipo, positivo = in ritardo).
  // Dal gruppo, con eccezioni per stile; le macchine e il resto rigido restano a zero.
  const GROUP_FEEL = {
    punk: { kick: -3, snare: -2, chh: -2 },
    post: { snare: 3 },
    alt: { snare: 3 },
    groove: { snare: 6, clap: 6, kick: -2 },
  };
  const STYLE_FEEL = {
    boombap: { snare: 14, clap: 14, kick: -4, chh: 3 },
    funk: { snare: 4, kick: -3 },
    trap: {}, house: {}, euclid: {}, latin: { conga: 3, conga2: 3 },
  };
  const feelFor = st => st.feel || STYLE_FEEL[st.id] || GROUP_FEEL[st.group] || {};
  const stylesIn = groupId => Object.values(STYLES).filter(s => s.group === groupId);

  // "any" e "group:<id>" si risolvono prima di generare: il codice contiene lo stile vero.
  function resolveStyle(choice, random = Math.random) {
    const pickFrom = arr => arr[Math.floor(random() * arr.length)];
    if (!choice || choice === "any") return pickFrom(Object.keys(STYLES));
    if (choice.startsWith("group:")) return pickFrom(stylesIn(choice.slice(6)).map(s => s.id));
    if (!STYLES[choice]) throw new Error("stile sconosciuto: " + choice);
    return choice;
  }

  function encode({ style, len, section, fill, seed }, mutations = []) {
    const base = `${style}-${len}${section === "chorus" ? "R" : "S"}${fill ? "F" : ""}-${hex(seed, 6)}`;
    return [base, ...mutations.map(m => hex(m, 4))].join("~");
  }
  const VALID_LENGTHS = new Set([8, 12, 16, 18, 24, 32, 36]);
  // Gli stili storici ragionano in battute da 16 sedicesimi. Per le nuove
  // risoluzioni si genera quella battuta e si ridisegna la griglia sul nuovo
  // numero di suddivisioni: i codici 16/32 restano byte-per-byte invariati.
  function resampleRoles(roles, fromLen, toLen) {
    if(fromLen===toLen) return roles;
    const out={};
    Object.entries(roles).forEach(([role,src])=>{
      const dst=zeros(toLen);
      src.forEach((v,i)=>{
        if(!v) return;
        const j=Math.max(0,Math.min(toLen-1,Math.round(i*toLen/fromLen)));
        dst[j]=Math.max(dst[j],v);
      });
      out[role]=dst;
    });
    return out;
  }
  // Operazioni registrate da altri file (variations.js): ~V<lettera><seed a 4 cifre>.
  const OPS = {};
  function defineOp(letter, fn) { OPS[letter] = fn; }
  function decodeStep(tok) {
    const v = /^V([A-Z])([0-9A-F]{4})$/i.exec(tok);
    if (v && OPS[v[1].toUpperCase()]) return { op: "vary", type: v[1].toUpperCase(), seed: parseInt(v[2], 16) };
    if (/^[0-9A-F]{4}$/i.test(tok)) return { op: "mutate", seed: parseInt(tok, 16) };
    const m = /^R([0-9A-F]{6})([0-9A-F]{4})$/i.exec(tok);
    if (m && parseInt(m[1], 16) < 2 ** ROLE_ORDER.length) return { op: "relock", mask: parseInt(m[1], 16), seed: parseInt(m[2], 16) };
    return null;
  }
  function decode(code) {
    const [base, ...toks] = String(code).trim().split("~");
    const m = /^([a-z0-9]+)-([0-9]+)([SR])(F?)-([0-9A-F]{6})$/i.exec(base || "");
    const steps = toks.map(decodeStep);
    if (!m || !VALID_LENGTHS.has(+m[2]) || !STYLES[m[1].toLowerCase()] || steps.some(s => !s)) return null;
    return {
      opts: { style: m[1].toLowerCase(), len: +m[2], section: m[3].toUpperCase() === "R" ? "chorus" : "verse",
        fill: !!m[4], seed: parseInt(m[5], 16) },
      steps,
    };
  }

  function clean(R) {
    Object.keys(R).forEach(k => { if (R[k].every(v => !v)) delete R[k]; });
    return R;
  }
  function describe(section, fill, variant, note) {
    return [(section === "chorus" ? "chorus" : "verse") + (fill ? " + fill" : ""),
      variant && variant.label, note].filter(Boolean).join(" · ");
  }

  // opts: {style, len, section, fill, seed, variant?}. `variant` forza una variante (usata da mutate).
  function generate(opts) {
    const st = STYLES[opts.style];
    if (!st) throw new Error("stile sconosciuto: " + opts.style);
    const requestedLen = VALID_LENGTHS.has(+opts.len) ? +opts.len : 16;
    const len = requestedLen;
    const nativeLen = len<=16 ? 16 : 32;
    const section = opts.section === "chorus" ? "chorus" : "verse";
    const seed = (opts.seed ?? randomSeed()) & 0xFFFFFF;
    const fill = !!opts.fill;
    const r = rng(seed);
    const allowed = (st.variants || []).filter(v => !v.sections || v.sections.includes(section));
    let variant = null;
    if (allowed.length) variant = allowed.find(v => v.id === opts.variant) || r.weighted(allowed);
    const bpm = r.between(st.bpm);
    const swing = r.between(st.swing);
    const c = makeCtx(nativeLen, section, r, variant);
    st.gen(c);
    if (c.chorus && st.group === "groove") c.put("crash", 0, 2);
    if (fill) addFill(c, st.fills);
    return {
      code: encode({ style: st.id, len, section, fill, seed }),
      style: st.id, group: st.group, variant: variant ? variant.id : "", section, fill,
      name: `${st.label} ${hex(seed, 6)}`, label: st.label, ref: st.ref,
      tag: `${bpm} bpm · ` + describe(section, fill, variant, c.note),
      bpm, swing, len, roles: clean(resampleRoles(c.R,nativeLen,len)), feel: feelFor(st),
    };
  }

  // "Altri cosi'": incrocia il pattern con un fratello (stesso stile, variante e sezione,
  // seed diverso) voce per voce, tenendo quasi sempre cassa e rullante del genitore,
  // poi applica 1-3 piccole mutazioni fuori dalla finestra del fill.
  const SKELETON = ["kick", "snare"];
  // Piccole modifiche puntuali: sposta o toglie un colpo non accentato, oppure ne aggiunge uno
  // su un ottavo. Mai prima dello step 1 ne' dentro la finestra del fill.
  function pointMutations(roles, voices, r, safeEnd, count) {
    if (safeEnd <= 2 || !voices.length) return;
    for (let n = count; n > 0 && voices.length; n--) {
      const arr = roles[r.pick(voices)];
      const i = r.int(1, safeEnd - 1);
      if (arr[i] === 2) continue;                       // gli accenti sono scheletro
      if (arr[i]) {
        const to = i + r.pick([-1, 1]);
        arr[i] = 0;
        if (r.rnd(0.6) && to > 0 && to < safeEnd && !arr[to]) arr[to] = 1;
      } else {
        const j = i - (i % 2);                          // aggiunte sugli ottavi
        if (j > 0 && !arr[j]) arr[j] = 1;
      }
    }
  }
  function mutate(parent, mseed) {
    const m16 = mseed & 0xFFFF;
    const r = rng(Math.imul(m16 + 1, 2654435761));
    const sib = generate({ style: parent.style, len: parent.len, section: parent.section, fill: parent.fill,
      variant: parent.variant, seed: r.int(0, 0xFFFFFF) });
    const roles = {};
    new Set([...Object.keys(parent.roles), ...Object.keys(sib.roles)]).forEach(role => {
      const fromParent = r.rnd(SKELETON.includes(role) ? 0.85 : 0.5);
      const src = fromParent ? parent.roles[role] : sib.roles[role];
      if (src) roles[role] = src.slice();
    });
    const voices = Object.keys(roles).filter(v => v !== "kick" && v !== "crash");
    pointMutations(roles, voices, r, parent.len - (parent.fill ? 8 : 0), r.int(1, 3));
    const st = STYLES[parent.style];
    const [lo, hi] = Array.isArray(st.bpm) ? st.bpm : [st.bpm, st.bpm];
    const bpm = Math.max(lo, Math.min(hi, parent.bpm + r.int(-3, 3)));
    const suffix = hex(m16, 4);
    const variant = (st.variants || []).find(v => v.id === parent.variant);
    return Object.assign({}, parent, {
      code: parent.code + "~" + suffix, name: `${st.label} ~${suffix}`, bpm, roles: clean(roles),
      tag: `${bpm} bpm · ` + describe(parent.section, parent.fill, variant, "similar"),
    });
  }

  // "Blocca voce": le voci nella maschera restano identiche, tutte le altre arrivano da un
  // fratello generato con seed nuovo (stesso stile, variante, sezione e fill). Il tempo resta.
  const lockMask = roles => roles.reduce((m, role) => {
    const i = ROLE_ORDER.indexOf(role);
    return i < 0 ? m : m | (1 << i);
  }, 0);
  const lockedRoles = mask => ROLE_ORDER.filter((_, i) => mask & (1 << i));
  function relock(parent, mask, rseed) {
    const s16 = rseed & 0xFFFF;
    const r = rng(Math.imul(s16 + 7, 2246822519));
    const same = (a, b) => ROLE_ORDER.every(k => String(a[k] || "") === String(b[k] || ""));
    let roles;
    // Negli stili rigidi un fratello puo' coincidere col genitore sulle voci libere: si prova
    // qualche seed in piu' (sempre dallo stesso generatore, quindi resta riproducibile).
    for (let attempt = 0; attempt < 8; attempt++) {
      const sib = generate({ style: parent.style, len: parent.len, section: parent.section, fill: parent.fill,
        variant: parent.variant, seed: r.int(0, 0xFFFFFF) });
      roles = {};
      ROLE_ORDER.forEach((role, i) => {
        const src = (mask & (1 << i)) ? parent.roles[role] : sib.roles[role];
        if (src) roles[role] = src.slice();
      });
      if (!same(clean(roles), parent.roles)) break;
    }
    if (same(clean(roles), parent.roles)) {
      // Stile senza varianti sulle voci libere: si varia quelle, mai le bloccate.
      const free = Object.keys(roles).filter(v => !(mask & (1 << ROLE_ORDER.indexOf(v))) && v !== "crash");
      for (let tries = 0; tries < 6 && same(clean(roles), parent.roles); tries++)
        pointMutations(roles, free, r, parent.len - (parent.fill ? 8 : 0), r.int(1, 3));
    }
    const st = STYLES[parent.style];
    const suffix = "R" + hex(mask, 6) + hex(s16, 4);
    const variant = (st.variants || []).find(v => v.id === parent.variant);
    return Object.assign({}, parent, {
      code: parent.code + "~" + suffix, name: `${st.label} ↻${hex(s16, 4)}`, roles: clean(roles),
      tag: `${parent.bpm} bpm · ` + describe(parent.section, parent.fill, variant, "regenerated"),
    });
  }

  function fromCode(code) {
    const d = decode(code);
    if (!d) return null;
    return d.steps.reduce((p, s) => s.op === "mutate" ? mutate(p, s.seed)
      : s.op === "vary" ? OPS[s.type](p, s.seed) : relock(p, s.mask, s.seed), generate(d.opts));
  }

  const E = {
    version: "2",
    roles: { sample: ROLE_SAMPLE, defaults: ROLE_DEFAULTS, order: ROLE_ORDER },
    groups: GROUPS, styles: STYLES, fills: FILLS,
    defineOp, defineGroup, defineStyles, stylesIn, resolveStyle,
    generate, mutate, relock, lockMask, lockedRoles, fromCode, encode, decode, randomSeed, rng,
    h: { zeros, euclid, cells, hits, backbeat, cymbal, ghosts, euclidBars, openHat, pointMutations, hex },
  };
  root.SPEngine = E;
  if (typeof module !== "undefined" && module.exports) module.exports = E;
})(typeof self !== "undefined" ? self : globalThis);
