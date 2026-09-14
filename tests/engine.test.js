// Test del motore ritmico: node tests/engine.test.js
"use strict";
const assert = require("assert");
const path = require("path");

const dir = path.join(__dirname, "..", "site", "engine");
const E = require(path.join(dir, "core.js"));
["styles-punk", "styles-post", "styles-machines", "styles-alt", "styles-groove"]
  .forEach(f => require(path.join(dir, f + ".js")));

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
