// Variazioni di un pattern: prendono un pattern gia' generato e ne fanno una versione diversa
// dello stesso stile (piu' scarna, piu' spinta, mezzo tempo, ecc.) senza rigenerarlo da zero.
// Sono riproducibili come il resto: codice = <pattern>~V<lettera><seed a 4 cifre>.
//
//   G note fantasma     O hat aperto      S cassa sincopata   H mezzo tempo     D doppio tempo (hat)
//   P scarno (break)    F spinto (drive)  R sul ride          W rullante alternativo   L nuovo fill
//   M dinamica (hat e percussioni con accenti e colpi morbidi)
//
// Livelli degli step: 0 vuoto, 1 normale, 2 accento, 3 nota fantasma (morbida).
//
// Con un fill nel pattern, tutte le variazioni tranne L lasciano intatta la finestra del fill.
(function (E) {
  "use strict";
  const { rng } = E;
  const hex = E.h.hex;

  const TYPES = [
    { id: "G", label: "note fantasma", hint: "aggiunge colpi leggeri di rullante tra i colpi forti" },
    { id: "O", label: "hat aperto", hint: "apre l'hi-hat in qualche punto" },
    { id: "S", label: "cassa sincopata", hint: "aggiunge colpi di cassa fuori tempo" },
    { id: "H", label: "mezzo tempo", hint: "rullante solo sul terzo tempo" },
    { id: "D", label: "doppio tempo hat", hint: "hi-hat a sedicesimi" },
    { id: "P", label: "scarno", hint: "toglie colpi: adatto a intro e break" },
    { id: "F", label: "spinto", hint: "crash sull'1, piu' cassa e hat: adatto al ritornello" },
    { id: "R", label: "sul ride", hint: "sposta l'hi-hat sul ride" },
    { id: "W", label: "rullante alternativo", hint: "cambia il suono del backbeat" },
    { id: "L", label: "nuovo fill", hint: "riscrive la chiusura della battuta" },
    { id: "M", label: "dinamica", hint: "hat e percussioni con accenti e colpi morbidi, piu' umano" },
  ];

  // Fill in piu' rispetto a quelli del core: stessa forma ({kit, roles, hit(k, n)}).
  const FILLS = Object.assign({
    stop: { kit: true, hit: (k, n) => k === n - 1 ? [["kick", 2], ["snare", 2]] : [] },
    synco: { kit: true, hit: (k) => k % 4 === 1 ? [["kick", 2]] : [["snare", k % 4 === 3 ? 2 : 1]] },
    cymbals: { kit: false, roles: ["ride", "china"], hit: (k, n) => k === n - 1 ? [["china", 2]] : [["ride", k % 2 ? 1 : 2]] },
  }, E.fills);
  const FILL_IDS = Object.keys(FILLS);
  const KIT_ROLES = ["kick", "kick2", "snare", "snare2", "snare3", "clap", "rim", "chh", "chh2", "ohh",
    "ride", "crash", "china", "tom", "tom2", "tamb", "cow"];
  const BACKBEAT_ROLES = ["snare", "snare2", "snare3", "clap", "rim"];

  // Contesto di lavoro: griglie copiate dal genitore, `ok(i)` dice se lo step si puo' toccare.
  function makeWork(parent, r) {
    const { len } = parent, bars = len / 16;
    const fillN = parent.fill ? (len >= 32 ? 8 : 4) : 0, safe = len - fillN;
    const roles = {};
    Object.keys(parent.roles).forEach(k => { roles[k] = parent.roles[k].slice(); });
    const has = role => !!(roles[role] && roles[role].some(v => v));
    const arr = role => roles[role] || (roles[role] = new Array(len).fill(0));
    const ok = i => i >= 0 && i < safe;
    const put = (role, i, v = 1) => { if (ok(i) && !(roles[role] && roles[role][i] >= v)) arr(role)[i] = v; };
    const clear = (role, i) => { if (ok(i) && roles[role]) roles[role][i] = 0; };
    const slots = list => { const out = []; for (let b = 0; b < bars; b++) list.forEach(s => { if (ok(b * 16 + s)) out.push(b * 16 + s); }); return out; };
    const perBar = fn => { for (let b = 0; b < bars; b++) fn(b * 16, b); };
    const firstOf = list => list.find(has);
    return { len, bars, safe, roles, has, arr, ok, put, clear, slots, perBar, firstOf, r, fill: parent.fill };
  }

  // Ogni operazione modifica w.roles e ritorna false se non ha nulla da fare su questo pattern.
  const OPS = {
    G(w) {
      const target = w.firstOf(["snare", "snare2", "rim", "clap"]);
      if (!target) return false;
      w.perBar(o => w.r.some([1, 3, 5, 7, 9, 11, 13, 15].map(s => o + s).filter(i => w.ok(i) && !w.arr(target)[i]), 1, 3)
        .forEach(i => { w.arr(target)[i] = 3; }));
    },
    O(w) {
      const hat = w.firstOf(["chh", "chh2"]);
      if (!hat) return false;
      w.r.some(w.slots([2, 6, 10, 14]), 1, 2).forEach(i => { w.put("ohh", i, 1); w.clear("chh", i); w.clear("chh2", i); });
    },
    S(w) {
      if (!w.has("kick")) return false;
      w.perBar(o => w.r.some([3, 6, 7, 10, 11, 14, 15].map(s => o + s).filter(i => w.ok(i) && !w.arr("kick")[i]
        && !BACKBEAT_ROLES.some(x => w.roles[x] && w.roles[x][i] === 2)), 1, 2).forEach(i => w.put("kick", i, 1)));
    },
    H(w) {
      const roles = BACKBEAT_ROLES.filter(role => w.roles[role] && w.roles[role].some((v, i) => v === 2 && (i % 16 === 4 || i % 16 === 12)));
      if (!roles.length) return false;
      w.perBar(o => roles.forEach(role => {
        w.clear(role, o + 4); w.clear(role, o + 12); w.put(role, o + 8, 2);
      }));
    },
    D(w) {
      const hat = w.has("chh") ? "chh" : (w.has("ride") ? "ride" : "chh");
      for (let i = 0; i < w.safe; i++) if (!(w.roles.ohh && w.roles.ohh[i])) w.put(hat, i, i % 4 === 0 ? 2 : 1);
    },
    P(w) {
      Object.keys(w.roles).forEach(role => {
        if (role === "crash") return;
        const drop = role === "kick" ? 0.35 : (BACKBEAT_ROLES.includes(role) ? 0.8 : 0.55);
        for (let i = 0; i < w.safe; i++) if ((w.roles[role][i] === 1 || w.roles[role][i] === 3) && w.r.rnd(drop)) w.roles[role][i] = 0;
      });
      // niente hat a sedicesimi dispari: tiene il respiro degli ottavi
      ["chh", "chh2"].forEach(role => { for (let i = 1; i < w.safe; i += 2) if (w.roles[role]) w.roles[role][i] = 0; });
    },
    F(w) {
      w.put("crash", 0, 2);
      const hat = w.has("chh") ? "chh" : (w.has("ride") ? "ride" : "chh");
      w.perBar(o => { for (let s = 0; s < 16; s += 2) if (!(w.roles.ohh && w.roles.ohh[o + s])) w.put(hat, o + s, s % 4 === 0 ? 2 : 1); });
      if (w.has("kick")) w.perBar(o => w.r.some([6, 10, 14].map(s => o + s).filter(i => w.ok(i) && !w.arr("kick")[i]), 1, 2)
        .forEach(i => w.put("kick", i, 1)));
    },
    R(w) {
      if (!w.has("chh")) return false;
      for (let i = 0; i < w.safe; i += 2) if (w.roles.chh[i]) { w.put("ride", i, w.roles.chh[i]); w.roles.chh[i] = 0; }
    },
    W(w) {
      const src = w.firstOf(BACKBEAT_ROLES);
      if (!src) return false;
      const to = w.r.pick(BACKBEAT_ROLES.filter(x => x !== src));
      for (let i = 0; i < w.safe; i++) if (w.roles[src][i] === 2) { w.roles[src][i] = 0; w.put(to, i, 2); }
    },
    M(w) {
      // Sulle voci ritmiche continue: fuori dai movimenti i colpi diventano morbidi, ogni tanto uno viene spinto.
      const voices = ["chh", "chh2", "ride", "shaker", "tamb", "perc"].filter(w.has);
      if (!voices.length) return false;
      voices.forEach(role => {
        for (let i = 0; i < w.safe; i++) {
          const v = w.roles[role][i];
          if (v === 1 && i % 4 !== 0) { if (w.r.rnd(i % 2 ? 0.75 : 0.35)) w.roles[role][i] = 3; else if (w.r.rnd(0.12)) w.roles[role][i] = 2; }
        }
      });
    },
    L(w) {
      const n = w.len >= 32 ? (w.fill || w.r.rnd(0.5) ? 8 : 4) : 4, s = w.len - n;
      const f = FILLS[w.r.pick(FILL_IDS)];
      (f.kit ? KIT_ROLES : f.roles).forEach(role => { if (w.roles[role]) for (let i = s; i < w.len; i++) w.roles[role][i] = 0; });
      for (let k = 0; k < n; k++) f.hit(k, n).forEach(([role, v]) => { w.arr(role)[s + k] = v; });
      if (f.kit) w.arr("crash")[0] = 2;
      w.fill = true;
    },
  };

  const cleaned = roles => { Object.keys(roles).forEach(k => { if (roles[k].every(v => !v)) delete roles[k]; }); return roles; };
  const snapshot = roles => JSON.stringify(cleaned(Object.fromEntries(Object.entries(roles).map(([k, a]) => [k, a.slice()]))));

  function vary(parent, type, vseed) {
    if (!OPS[type]) throw new Error("variazione sconosciuta: " + type);
    const v16 = vseed & 0xFFFF;
    const r = rng(Math.imul(v16 + 1, 2654435761) ^ (type.charCodeAt(0) * 40503));
    const w = makeWork(parent, r);
    const before = snapshot(parent.roles);
    const did = OPS[type](w);
    // Un pattern gia' pieno o senza le voci giuste puo' non cambiare: si ripiega su piccoli ritocchi.
    if (did === false || snapshot(w.roles) === before) {
      const voices = Object.keys(w.roles).filter(v => v !== "kick" && v !== "crash");
      for (let t = 0; t < 4 && snapshot(w.roles) === before; t++) E.h.pointMutations(w.roles, voices, r, w.safe, r.int(1, 3));
    }
    const meta = TYPES.find(t => t.id === type);
    const st = E.styles[parent.style];
    const suffix = "V" + type + hex(v16, 4);
    return Object.assign({}, parent, {
      code: parent.code + "~" + suffix, name: `${st.label} ${type}${hex(v16, 4)}`, roles: cleaned(w.roles),
      fill: w.fill, tag: `${parent.tag} · ${meta.label}`,
    });
  }

  TYPES.forEach(t => E.defineOp(t.id, (p, seed) => vary(p, t.id, seed)));
  E.variationTypes = TYPES;
  E.vary = vary;
  E.fills = FILLS;
})(typeof SPEngine !== "undefined" ? SPEngine : require("./core.js"));
