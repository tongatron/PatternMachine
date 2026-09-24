// Test del motore ritmico: node tests/engine.test.js
"use strict";
const assert = require("assert");
const path = require("path");

const dir = path.join(__dirname, "..", "site", "engine");
const E = require(path.join(dir, "core.js"));
["styles-punk", "styles-post", "styles-machines", "styles-alt", "styles-groove", "styles-dub"]
  .forEach(f => require(path.join(dir, f + ".js")));
require(path.join(dir, "variations.js"));

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const SEEDS = 60;
const ROLES = new Set(E.roles.order);

function test(name, fn) {
  try { fn(); console.log("ok  ", name); }
  catch (e) { console.log("FAIL", name, "\n     ", e.message); process.exitCode = 1; }
}

test("registro: schede coerenti", () => {
  const groups = new Set(E.groups.map(g => g.id));
  for (const st of Object.values(E.styles)) {
    ok(groups.has(st.group), `${st.id}: gruppo ${st.group}`);
    ok(st.label && st.ref, `${st.id}: label/ref`);
    ok(Array.isArray(st.bpm) && st.bpm[0] <= st.bpm[1] && st.bpm[0] >= 40 && st.bpm[1] <= 240, `${st.id}: bpm`);
    ok(st.fills.length && st.fills.every(f => E.fills[f]), `${st.id}: fill validi`);
    if (st.variants) {
      const ids = st.variants.map(v => v.id);
      ok(new Set(ids).size === ids.length, `${st.id}: varianti duplicate`);
      ["verse", "chorus"].forEach(sec =>
        ok(st.variants.some(v => !v.sections || v.sections.includes(sec)), `${st.id}: nessuna variante per ${sec}`));
    }
    Object.values(Object.assign({}, st.must, ...(st.variants || []).map(v => v.must || {})))
      .forEach(steps => ok(steps.every(s => s >= 0 && s < 16), `${st.id}: must fuori battuta`));
  }
  ok(Object.keys(E.styles).length >= 30, "almeno 30 stili");
});

test("generazione: griglie valide e colpi obbligatori", () => {
  for (const st of Object.values(E.styles)) {
    for (const len of [16, 32]) for (const section of ["verse", "chorus"]) for (const fill of [false, true]) {
      const variantsSeen = new Set();
      for (let seed = 0; seed < SEEDS; seed++) {
        const p = E.generate({ style: st.id, len, section, fill, seed: seed * 7919 });
        const where = p.code;
        ok(Object.keys(p.roles).length > 0, `${where}: vuoto`);
        for (const [role, arr] of Object.entries(p.roles)) {
          ok(ROLES.has(role), `${where}: voce ${role}`);
          ok(arr.length === len && arr.every(v => v === 0 || v === 1 || v === 2), `${where}: griglia ${role}`);
        }
        ok(p.bpm >= st.bpm[0] && p.bpm <= st.bpm[1], `${where}: bpm ${p.bpm}`);
        ok(p.swing >= 0 && p.swing <= 60, `${where}: swing`);
        variantsSeen.add(p.variant);
        if (!fill) {
          const v = (st.variants || []).find(x => x.id === p.variant);
          if (v && v.sections) ok(v.sections.includes(section), `${where}: variante ${v.id} in ${section}`);
          const must = Object.assign({}, st.must, v && v.must);
          for (const [role, steps] of Object.entries(must))
            for (const s of steps) ok((p.roles[role] || [])[s] > 0, `${where}: manca ${role}@${s}`);
        }
      }
      if (st.variants) {
        const allowed = st.variants.filter(v => !v.sections || v.sections.includes(section));
        ok(variantsSeen.size === allowed.length, `${st.id} ${len}${section}: varianti non tutte raggiunte (${[...variantsSeen]})`);
      }
    }
  }
});

test("determinismo: stesso codice, stesso pattern", () => {
  for (const id of Object.keys(E.styles)) {
    const p = E.generate({ style: id, len: 32, section: "chorus", fill: true, seed: 0xABCDEF });
    const q = E.fromCode(p.code);
    ok(q && JSON.stringify(q.roles) === JSON.stringify(p.roles) && q.bpm === p.bpm && q.variant === p.variant, `${id}: fromCode`);
    const d = E.decode(p.code);
    ok(E.encode(d.opts) === p.code, `${id}: encode/decode`);
  }
});

test("codici: formato e rifiuto di quelli invalidi", () => {
  const p = E.generate({ style: "dbeat", len: 16, section: "chorus", fill: false, seed: 0x7F3A9B });
  ok(p.code === "dbeat-16R-7F3A9B", "formato " + p.code);
  ok(E.decode("dbeat-16r-7f3a9b"), "minuscole accettate");
  ["", "dbeat", "nope-16S-000000", "dbeat-24S-000000", "dbeat-16S-00000", "dbeat-16S-000000~XYZ"]
    .forEach(bad => ok(E.decode(bad) === null, "invalido accettato: " + bad));
});

test("altri così: mutazioni riproducibili, vicine ma diverse", () => {
  let different = 0, total = 0;
  for (const id of Object.keys(E.styles)) {
    for (let s = 0; s < 10; s++) {
      const parent = E.generate({ style: id, len: 16, section: "verse", fill: s % 2 === 0, seed: s * 104729 });
      const child = E.mutate(parent, s * 331 + 17);
      total++;
      ok(child.code.startsWith(parent.code + "~"), "codice figlio");
      ok(child.style === parent.style && child.variant === parent.variant && child.len === parent.len, "stesso stile e variante");
      ok(Object.keys(child.roles).length > 0, "figlio vuoto");
      const again = E.fromCode(child.code);
      ok(JSON.stringify(again.roles) === JSON.stringify(child.roles), `${child.code}: non riproducibile`);
      if (JSON.stringify(child.roles) !== JSON.stringify(parent.roles)) different++;
    }
  }
  ok(different / total > 0.9, `troppe mutazioni identiche al genitore: ${different}/${total}`);
  const chain = E.fromCode("motorik-32SF-00A1C2~4C21~0003");
  ok(chain && chain.code === "motorik-32SF-00A1C2~4C21~0003", "catena di mutazioni");
});

test("blocca voce: le voci bloccate restano, il resto si rigenera, tutto riproducibile", () => {
  let changed = 0, total = 0;
  for (const id of Object.keys(E.styles)) {
    for (let s = 0; s < 8; s++) {
      const parent = E.generate({ style: id, len: s % 2 ? 32 : 16, section: s % 3 ? "verse" : "chorus", fill: s % 4 === 0, seed: s * 7331 + 1 });
      const present = Object.keys(parent.roles);
      const keep = present.filter((_, i) => i % 2 === 0);
      const mask = E.lockMask(keep);
      ok(JSON.stringify(E.lockedRoles(mask)) === JSON.stringify(E.roles.order.filter(r => keep.includes(r))), "maschera andata e ritorno");
      const child = E.relock(parent, mask, s * 4099 + 3);
      total++;
      ok(/~R[0-9A-F]{10}$/.test(child.code), `${child.code}: formato`);
      ok(child.bpm === parent.bpm && child.variant === parent.variant && child.len === parent.len, "tempo, variante e lunghezza invariati");
      keep.forEach(r => ok(JSON.stringify(child.roles[r]) === JSON.stringify(parent.roles[r]), `${child.code}: voce bloccata ${r} cambiata`));
      const again = E.fromCode(child.code);
      ok(again && JSON.stringify(again.roles) === JSON.stringify(child.roles), `${child.code}: non riproducibile`);
      if (JSON.stringify(child.roles) !== JSON.stringify(parent.roles)) changed++;
      // Le voci assenti e non bloccate possono arrivare dal fratello: bloccando tutto non cambia nulla.
      const all = E.relock(parent, E.lockMask(E.roles.order), 1);
      const sameRoles = (a, b) => Object.keys(a).length === Object.keys(b).length
        && Object.keys(a).every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));
      ok(sameRoles(all.roles, parent.roles), "tutto bloccato = identico");
    }
  }
  ok(changed / total > 0.8, `rigenerazioni troppo spesso identiche: ${changed}/${total}`);
  const chain = "dbeat-16S-111111~4C21~R000005BEEF~0003";
  ok(E.fromCode(chain)?.code === chain, "catena mista mutazione + blocca voce");
  ["dbeat-16S-111111~R00000", "dbeat-16S-111111~RFFFFFF0000", "dbeat-16S-111111~Q000005BEEF"]
    .forEach(bad => ok(E.decode(bad) === null, "passo invalido accettato: " + bad));
});

// I 33 stili della prima versione: il loro output non deve cambiare mai (i codici gia' condivisi restano validi).
const ORIGINAL_STYLES = ["punk77", "oi", "dbeat", "skank", "breakdown", "postpunk", "morris", "dubpunk", "fallbeat", "wire",
  "funkpunk", "afro", "motorik", "newwave", "dancepunk", "suicide", "ebm", "cabaret", "avalanche", "coldwave", "industrial",
  "grunge", "garage", "shoegaze", "noiserock", "posthc", "math", "boombap", "funk", "trap", "house", "latin", "euclid"];
test("regressione: i pattern di base non cambiano (i codici gia' condivisi restano validi)", () => {
  const h = require("crypto").createHash("md5");
  for (const id of ORIGINAL_STYLES) for (const len of [16, 32]) for (const sec of ["verse", "chorus"])
    for (const fill of [false, true]) for (let s = 0; s < 20; s++) {
      const p = E.generate({ style: id, len, section: sec, fill, seed: s * 7919 + 5 });
      h.update(p.code + JSON.stringify(p.roles) + p.bpm + p.swing);
    }
  ok(h.digest("hex") === "b6374c42d790f6317c5aed1d0c5782d7", "l'output di generate() e' cambiato");
});

test("variazioni: riproducibili, valide, fill intatto, quasi sempre diverse", () => {
  const seen = {}, total = {};
  for (const t of E.variationTypes) { seen[t.id] = 0; total[t.id] = 0; }
  for (const id of Object.keys(E.styles)) {
    for (let s = 0; s < 4; s++) {
      const len = s % 2 ? 32 : 16, fill = s >= 2;
      const parent = E.generate({ style: id, len, section: s % 3 ? "verse" : "chorus", fill, seed: s * 9973 + 11 });
      for (const t of E.variationTypes) {
        const child = E.vary(parent, t.id, s * 577 + 5);
        total[t.id]++;
        ok(child.code === `${parent.code}~V${t.id}${(s * 577 + 5).toString(16).toUpperCase().padStart(4, "0")}`, "codice " + child.code);
        ok(child.style === parent.style && child.len === parent.len && child.bpm === parent.bpm, "identita' " + child.code);
        ok(Object.keys(child.roles).length > 0, `${child.code}: vuoto`);
        for (const [role, arr] of Object.entries(child.roles)) {
          ok(ROLES.has(role), `${child.code}: voce ${role}`);
          ok(arr.length === len && arr.every(v => v === 0 || v === 1 || v === 2 || v === 3), `${child.code}: griglia ${role}`);
        }
        const again = E.fromCode(child.code);
        ok(again && JSON.stringify(again.roles) === JSON.stringify(child.roles), `${child.code}: non riproducibile`);
        if (fill && t.id !== "L") {                         // la finestra del fill non si tocca
          const w = len >= 32 ? 8 : 4;
          for (const [role, arr] of Object.entries(parent.roles))
            ok(JSON.stringify(arr.slice(len - w)) === JSON.stringify((child.roles[role] || new Array(len).fill(0)).slice(len - w)),
              `${child.code}: fill toccato su ${role}`);
        }
        if (JSON.stringify(child.roles) !== JSON.stringify(parent.roles)) seen[t.id]++;
      }
    }
  }
  for (const t of E.variationTypes) ok(seen[t.id] / total[t.id] > 0.9, `variazione ${t.id} quasi sempre identica: ${seen[t.id]}/${total[t.id]}`);
});

test("feel e ghost: micro-timing per stile, livello 3 solo nelle variazioni", () => {
  for (const st of Object.values(E.styles)) {
    const p = E.generate({ style: st.id, len: 16, section: "verse", fill: false, seed: 42 });
    ok(p.feel && typeof p.feel === "object", `${st.id}: feel`);
    for (const [role, ms] of Object.entries(p.feel)) ok(E.roles.order.includes(role) && Math.abs(ms) <= 30, `${st.id}: feel ${role}`);
    ok(Object.values(p.roles).every(a => a.every(v => v <= 2)), `${st.id}: generate() non emette ghost`);
    ok(JSON.stringify(E.vary(p, "G", 1).feel) === JSON.stringify(p.feel), `${st.id}: feel mantenuto`);
  }
  ok(E.generate({ style: "boombap", len: 16, section: "verse", fill: false, seed: 1 }).feel.snare > 0, "boom bap: rullante in ritardo");
  const rigid = Object.values(E.styles).filter(st => st.group === "machines");
  ok(rigid.length > 0 && rigid.every(st => Object.keys(E.generate({ style: st.id, len: 16, section: "verse", fill: false, seed: 1 }).feel).length === 0), "macchine: rigide");
  let ghosts = 0, tries = 0;
  for (const id of Object.keys(E.styles)) for (let s = 0; s < 3; s++) {
    const p = E.generate({ style: id, len: 16, section: "verse", fill: false, seed: s * 31 + 2 });
    const g = E.vary(p, "G", s + 1), m = E.vary(p, "M", s + 1);
    tries++; if (Object.values(g.roles).some(a => a.includes(3)) || Object.values(m.roles).some(a => a.includes(3))) ghosts++;
  }
  // le note fantasma vanno sul rullante (o sulla voce di backbeat), non altrove
  for (let seed = 0; seed < 40; seed++) {
    const p = E.generate({ style: "boombap", len: 16, section: "verse", fill: false, seed });
    const g = E.vary(p, "G", seed);
    ok(g.roles.snare.filter(v => v === 3).length >= 1, `boombap ${seed}: nessuna nota fantasma sul rullante`);
  }
  ok(ghosts / tries > 0.8, `ghost e dinamica emettono il livello 3: ${ghosts}/${tries}`);
});

test("variazioni: passi nel codice, catene con altri passi, rifiuto dei non validi", () => {
  const chain = "dbeat-16S-111111~VP00A1~4C21~VF0003~R000005BEEF";
  ok(E.fromCode(chain)?.code === chain, "catena mista");
  ["dbeat-16S-111111~VZ0000", "dbeat-16S-111111~VG00", "dbeat-16S-111111~V0000", "dbeat-16S-111111~vg00001"]
    .forEach(bad => ok(E.decode(bad) === null, "passo invalido accettato: " + bad));
  ok(E.decode("dbeat-16S-111111~vg00a1") !== null, "minuscole accettate");
  const p = E.generate({ style: "boombap", len: 16, section: "verse", fill: false, seed: 5 });
  const stop = E.vary(p, "L", 0);
  ok(stop.fill === true, "L aggiunge un fill");
  ok(E.vary(p, "H", 3).roles.snare[8] === 2 && !E.vary(p, "H", 3).roles.snare[4], "mezzo tempo: rullante sul 3");
  ok(E.vary(p, "P", 9).roles.kick.some(v => v === 2), "scarno: mantiene gli accenti di cassa");
});

test("risoluzione casuale: any e gruppi", () => {
  let seed = 1;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 200; i++) {
    const g = E.groups[i % E.groups.length].id;
    ok(E.styles[E.resolveStyle("group:" + g, random)].group === g, "gruppo " + g);
    ok(E.styles[E.resolveStyle("any", random)], "any");
  }
});

console.log(`\n${Object.keys(E.styles).length} stili, ${E.groups.length} gruppi, ${checks} verifiche`);
