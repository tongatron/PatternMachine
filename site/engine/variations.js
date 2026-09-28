// Variazioni di un pattern: prendono un pattern gia' generato e ne fanno una versione diversa
// dello stesso stile (piu' scarna, piu' spinta, mezzo tempo, ecc.) senza rigenerarlo da zero.
// Sono riproducibili come il resto: codice = <pattern>~V<lettera><seed a 4 cifre>.
//
//   G note fantasma     O hat aperto      S cassa sincopata   H mezzo tempo     D doppio tempo (hat)
//   P scarno (break)    F spinto (drive)  R sul ride          W rullante alternativo   L nuovo fill
//   M dinamica (hat e percussioni con accenti e colpi morbidi)
//   X ibrido (una famiglia di voci presa da un altro stile)   Y strato percussivo (euclideo)
//   T groove di tom     N sfasato (una voce spostata di uno step)     B stacco (un buco nel groove)
//   C ritmo d'altro stile (cassa e rullante di un altro stile)   J metà e metà   E mix di voci   U doppio ibrido
//
// Livelli degli step: 0 vuoto, 1 normale, 2 accento, 3 nota fantasma (morbida).
//
// Con un fill nel pattern, tutte le variazioni tranne L lasciano intatta la finestra del fill.
(function (E) {
  "use strict";
  const { rng } = E;
  const hex = E.h.hex;

  const TYPES = [
    { id: "G", label: "ghost notes", hint: "adds soft snare hits between the backbeats" },
    { id: "O", label: "open hat", hint: "opens the hi-hat here and there" },
    { id: "S", label: "syncopated kick", hint: "adds off-beat kick hits" },
    { id: "H", label: "half-time", hint: "snare on beat 3 only" },
    { id: "D", label: "double-time hats", hint: "sixteenth-note hi-hats" },
    { id: "P", label: "sparse", hint: "removes hits: good for intros and breaks" },
    { id: "F", label: "driving", hint: "crash on the one, more kick and hats: good for the chorus" },
    { id: "R", label: "on the ride", hint: "moves the hi-hat to the ride" },
    { id: "W", label: "alternate snare", hint: "changes the backbeat sound" },
    { id: "L", label: "new fill", hint: "rewrites the end of the bar" },
    { id: "M", label: "dynamics", hint: "hats and percussion with accents and soft hits, more human" },
    { id: "X", label: "hybrid", hint: "swaps kick, snare, cymbals or percussion with those of another style" },
    { id: "Y", label: "percussion layer", hint: "adds shaker, tambourine, claves, cowbell, congas or percussion on a Euclidean rhythm" },
    { id: "T", label: "tom groove", hint: "moves the hi-hat onto the toms" },
    { id: "N", label: "displaced", hint: "shifts one voice by a step: syncopation" },
    { id: "B", label: "stop", hint: "a hole in the groove: kick, snare and hats drop out for one beat" },
    { id: "C", label: "cross-style rhythm", hint: "kick and snare from another style, with your cymbals and percussion" },
    { id: "J", label: "half and half", hint: "the first half is yours, the second comes from another style" },
    { id: "E", label: "voice mix", hint: "each voice comes at random from your pattern or another style" },
    { id: "U", label: "double hybrid", hint: "two groups of voices taken from two different styles" },
  ];
  const GROUPS = {
    G: "groove", O: "hi-hat e percussioni", S: "groove", H: "struttura", D: "hi-hat e percussioni",
    P: "struttura", F: "groove", R: "hi-hat e percussioni", W: "groove", L: "struttura",
    M: "hi-hat e percussioni", X: "ibridi", Y: "hi-hat e percussioni", T: "hi-hat e percussioni",
    N: "groove", B: "struttura", C: "ibridi", J: "ibridi", E: "ibridi", U: "ibridi",
  };
  TYPES.forEach(t => { t.group = GROUPS[t.id] || "groove"; });

  // Stili che l'ibrido (~VX) puo' pescare. Lista FISSA: l'indice e' scritto nel codice, quindi non si tocca
  // e non si riordina (cambierebbe i codici condivisi). Stili nuovi non sono donatori: servirebbe un'altra lettera.
  const X_DONORS = [
    "punk77", "oi", "dbeat", "skank", "breakdown", "skate",
    "poppunk", "crust", "anarcho", "powerviolence", "postpunk", "morris",
    "dubpunk", "fallbeat", "wire", "funkpunk", "afro", "motorik",
    "newwave", "dancepunk", "suicide", "ebm", "cabaret", "avalanche",
    "coldwave", "industrial", "grunge", "garage", "shoegaze", "noiserock",
    "posthc", "math", "boombap", "funk", "trap", "house",
    "latin", "euclid", "onedrop", "rockers", "steppers", "dub",
    "rocksteady", "ska", "dembow", "dubtechno", "jungle", "dnb",
    "garage2", "bigbeat", "triphop", "disco", "motown", "afrobeat",
    "bossa", "cumbia", "rockclassic", "hardrock", "doom", "thrash",
    "deathmetal", "blackmetal", "groovemetal", "electro", "techno", "gabber",
    "footwork",
  ];
  const X_GROUPS = [
    ["kick", "kick2"],
    ["snare", "snare2", "snare3", "rim", "clap"],
    ["chh", "chh2", "ohh", "ride", "crash", "china"],
    ["tom", "tom2", "cow", "conga", "conga2", "clave", "tamb", "shaker", "perc"],
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
  function makeWork(parent, r, seed) {
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
    return { len, bars, safe, roles, has, arr, ok, put, clear, slots, perBar, firstOf, r, seed, parent, note: "", fill: parent.fill };
  }

  // Ibridi: un "donatore" (uno stile della lista fissa) genera un pattern con lo stesso passo e la stessa
  // sezione, e alcune sue voci passano al pattern di partenza. Il donatore esce dal seed, il resto dal generatore.
  function donorAt(w, index) {
    const id = X_DONORS[index % X_DONORS.length];
    if (!E.styles[id]) return null;
    const pattern = E.generate({ style: id, len: w.len, section: w.parent.section, fill: false, seed: w.r.int(0, 0xFFFFFF) });
    return { id, label: E.styles[id].label, roles: pattern.roles };
  }
  const hasFamily = (d, group) => group.some(role => role in d.roles);
  // Nel tratto [from, to) le voci di `group` del pattern di partenza spariscono e arrivano quelle del donatore.
  function graft(w, d, group, from = 0, to = w.safe) {
    group.forEach(role => { if (w.roles[role]) for (let i = from; i < to; i++) w.roles[role][i] = 0; });
    group.forEach(role => { if (d.roles[role]) for (let i = from; i < to; i++) if (d.roles[role][i]) w.arr(role)[i] = d.roles[role][i]; });
  }
  const unionRoles = (w, d) => [...new Set([...Object.keys(w.roles), ...Object.keys(d.roles)])];

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
    X(w) {
      const d = donorAt(w, w.seed >> 8);
      if (!d) return false;
      const families = X_GROUPS.filter(g => hasFamily(d, g));      // solo famiglie che il donatore ha davvero
      if (!families.length) return false;
      graft(w, d, w.r.pick(families));
      w.note = d.label;
    },
    C(w) {
      const d = donorAt(w, w.seed >> 8);
      if (!d) return false;
      const families = [X_GROUPS[0], X_GROUPS[1]].filter(g => hasFamily(d, g));
      if (!families.length) return false;
      families.forEach(g => graft(w, d, g));
      w.note = d.label;
    },
    J(w) {
      const d = donorAt(w, w.seed >> 8), cut = w.len / 2;
      if (!d || w.safe <= cut) return false;
      graft(w, d, unionRoles(w, d), cut);
      w.note = d.label;
    },
    E(w) {
      const d = donorAt(w, w.seed >> 8);
      if (!d) return false;
      const roles = unionRoles(w, d).filter(role => role !== "crash" && d.roles[role]);
      if (!roles.length) return false;
      let taken = 0;
      roles.forEach(role => { if (w.r.rnd(0.5)) { graft(w, d, [role]); taken++; } });
      if (!taken) graft(w, d, [w.r.pick(roles)]);
      w.note = d.label;
    },
    U(w) {
      const d1 = donorAt(w, w.seed >> 8), d2 = donorAt(w, w.seed & 0xFF);
      if (!d1 || !d2) return false;
      const f1 = X_GROUPS.filter(g => hasFamily(d1, g)), f2 = X_GROUPS.filter(g => hasFamily(d2, g));
      if (!f1.length || !f2.length) return false;
      const g1 = w.r.pick(f1), other = f2.filter(g => g !== g1), g2 = w.r.pick(other.length ? other : f2);
      graft(w, d1, g1);
      graft(w, d2, g2);
      w.note = d1.id === d2.id ? d1.label : `${d1.label} + ${d2.label}`;
    },
    Y(w) {
      const free = ["shaker", "tamb", "clave", "cow", "conga", "conga2", "perc"].filter(role => !w.has(role));
      if (!free.length) return false;
      const role = w.r.pick(free), k = w.r.pick([3, 5, 7, 9]), rot = w.r.int(0, 3);
      E.h.euclid(k, w.len, rot).forEach((v, i) => { if (v) w.put(role, i, i % 4 === 0 ? 2 : 1); });
      w.note = role;
    },
    T(w) {
      const hat = w.has("chh") ? "chh" : (w.has("ride") ? "ride" : null);
      if (!hat) return false;
      const hi = w.r.pick(["tom", "tom2"]), lo = hi === "tom" ? "tom2" : "tom";
      for (let i = 0; i < w.safe; i += 2) if (w.roles[hat][i]) { w.put(i % 8 < 4 ? hi : lo, i, w.roles[hat][i]); w.roles[hat][i] = 0; }
      w.put("crash", 0, 2);
    },
    N(w) {
      const voices = Object.keys(w.roles).filter(role => role !== "kick" && role !== "crash" && w.has(role));
      if (!voices.length) return false;
      const role = w.r.pick(voices), d = w.r.pick([-1, 1]), src = w.roles[role].slice();
      for (let i = 0; i < w.safe; i++) w.roles[role][i] = 0;
      for (let i = 0; i < w.safe; i++) {
        if (!src[i]) continue;
        const j = i + d;
        w.roles[role][w.ok(j) && !w.roles[role][j] ? j : i] = src[i];
      }
      w.note = role;
    },
    B(w) {
      const starts = [];
      for (let b = 0; b < w.bars; b++) [4, 8, 12].forEach(s => { if (b * 16 + s + 4 <= w.safe) starts.push(b * 16 + s); });
      if (!starts.length) return false;
      const a = w.r.pick(starts);
      KIT_ROLES.forEach(role => { if (role !== "crash" && w.roles[role]) for (let i = a; i < a + 4; i++) w.roles[role][i] = 0; });
      if (w.r.rnd(0.6)) w.put("snare", a + 3, 1);          // un colpo che riporta dentro il groove
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
    const w = makeWork(parent, r, v16);
    const before = snapshot(parent.roles);
    const did = OPS[type](w);
    // Un pattern gia' pieno o senza le voci giuste puo' non cambiare: si ripiega su piccoli ritocchi.
    if (did === false || snapshot(w.roles) === before) {
      if (type === "P") {
        // "sparse" non deve mai aggiungere: se non ha tolto nulla, toglie uno o due colpi non accentati.
        const cands = [];
        Object.keys(w.roles).forEach(role => { if (role !== "crash") for (let i = 0; i < w.safe; i++) if (w.roles[role][i] === 1 || w.roles[role][i] === 3) cands.push([role, i]); });
        r.some(cands, 1, 2).forEach(([role, i]) => { w.roles[role][i] = 0; });
      } else {
        const voices = Object.keys(w.roles).filter(v => v !== "kick" && v !== "crash");
        for (let t = 0; t < 4 && snapshot(w.roles) === before; t++) E.h.pointMutations(w.roles, voices, r, w.safe, r.int(1, 3));
      }
    }
    const meta = TYPES.find(t => t.id === type);
    const st = E.styles[parent.style];
    const suffix = "V" + type + hex(v16, 4);
    return Object.assign({}, parent, {
      code: parent.code + "~" + suffix, name: `${st.label} ${type}${hex(v16, 4)}`, roles: cleaned(w.roles),
      fill: w.fill, tag: `${parent.tag} · ${meta.label}${w.note ? ` (${w.note})` : ""}`,
    });
  }

  // Arrangiamento: da un pattern (la strofa) ricava le altre sezioni con le variazioni. Ogni sezione
  // e' un normale pattern con il suo codice, quindi si ascolta, si carica e si condivide come gli altri.
  const hash = str => { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  function arrange(parent) {
    const r = rng(hash(parent.code));
    const seed = () => r.int(0, 0xFFFF);
    const named = (p, label) => Object.assign({}, p, { name: `${parent.name} · ${label}`, tag: `${parent.tag} · ${label}` });
    return [
      named(vary(vary(parent, "P", seed()), "P", seed()), "intro"),
      named(vary(parent, "F", seed()), "chorus"),
      named(vary(vary(parent, "P", seed()), "H", seed()), "break"),
      named(vary(vary(parent, "P", seed()), "L", seed()), "outro"),
    ];
  }

  TYPES.forEach(t => E.defineOp(t.id, (p, seed) => vary(p, t.id, seed)));
  E.variationTypes = TYPES;
  E.vary = vary;
  E.hybridDonors = X_DONORS.slice();
  E.arrange = arrange;
  E.fills = FILLS;
})(typeof SPEngine !== "undefined" ? SPEngine : require("./core.js"));
