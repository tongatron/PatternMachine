// Schede: punk e hardcore.
// Campi: id, label, ref (riferimenti), bpm [min,max], swing, fills, variants [{id,label,w,sections,must}],
// must {voce:[step]} = colpi che devono esserci nella prima battuta (verificati dai test), gen(c).
(function (E) {
  const { cells, hits, backbeat, cymbal } = E.h;
  E.defineGroup({ id: "punk", label: "Punk / Hardcore" });
  E.defineStyles("punk", [
    {
      id: "punk77", label: "Punk '77", ref: "Ramones, Sex Pistols, The Clash", bpm: [165, 195],
      fills: ["roll", "down", "unison"], must: { kick: [0], snare: [4] },
      gen(c) {
        cells(c, "kick", [[0, 8], [0, 8, 10], [0, 6, 8], [0, 2, 8], [0, 8, 11]]);
        backbeat(c);
        const [cy, st] = c.verse ? c.pick([["chh", 2], ["chh", 2], ["ride", 2]]) : c.pick([["ride", 2], ["ohh", 2], ["crash", 4]]);
        cymbal(c, cy, st);
        if (c.chorus) c.put("crash", 0, 2);
        if (c.rnd(0.35)) c.perBar(o => c.put("snare", o + 14, 1));
      },
    },
    {
      id: "oi", label: "Oi! / street punk", ref: "Cock Sparrer, Cockney Rejects, Rancid", bpm: [138, 168],
      fills: ["down", "toms", "roll"], must: { kick: [0, 8], snare: [4] },
      gen(c) {
        cells(c, "kick", [[0, 8, 10], [0, 7, 8], [0, 8], [0, 3, 8, 10]], [0, 8]);
        backbeat(c);
        if (c.verse) cymbal(c, "chh", 2);
        else { cymbal(c, "tom2", 2); c.perBar(o => c.put("crash", o, 2)); c.note = "floor tom"; }
      },
    },
    {
      id: "dbeat", label: "D-beat", ref: "Discharge, Anti Cimex, Wolfbrigade", bpm: [168, 200],
      fills: ["unison", "roll", "down"], must: { kick: [0, 6, 8], snare: [4] },
      gen(c) {
        c.perBar((o, b) => {
          [0, 6, 8].forEach(s => c.put("kick", o + s, s === 0 ? 2 : 1));
          if (b % 2 === 1 && c.rnd(0.4)) c.put("kick", o + 14, 1);
        });
        backbeat(c);
        if (c.verse) cymbal(c, c.pick(["chh", "ride"]), 2);
        else { cymbal(c, c.pick(["crash", "china"]), 4); c.put("crash", 0, 2); }
      },
    },
    {
      id: "skank", label: "Skank beat", ref: "hardcore '80: Minor Threat, Bad Brains, D.R.I.", bpm: [176, 215],
      fills: ["roll", "unison"],
      variants: [
        { id: "std", label: "", w: 7, must: { kick: [0, 4, 8], snare: [2, 6, 10] } },
        { id: "flip", label: "rovesciato", w: 3, must: { snare: [0, 4, 8], kick: [2, 6, 10] } },
      ],
      gen(c) {
        const flip = c.variant === "flip";          // rullante in battere, cassa in levare
        c.each(0, 4, i => c.put(flip ? "snare" : "kick", i, 2));
        c.each(2, 4, i => c.put(flip ? "kick" : "snare", i, 2));
        if (c.verse) cymbal(c, c.pick(["ride", "chh"]), 2);
        else c.each(0, 4, i => c.put("crash", i, i % 16 === 0 ? 2 : 1));
      },
    },
    {
      id: "breakdown", label: "Breakdown half-time", ref: "NYHC: Agnostic Front, Madball, Sick of It All", bpm: [80, 105],
      fills: ["toms", "down"], must: { kick: [0], snare: [8] },
      gen(c) {
        cells(c, "kick", [[0, 3, 6, 10], [0, 2, 3, 6, 7, 10], [0, 6, 7, 10, 14], [0, 3, 10, 11]], [0], 0.6);
        c.perBar(o => c.put("snare", o + 8, 2));
        if (c.verse) cymbal(c, "chh", 4);
        else { c.each(0, 4, i => c.put("china", i, i % 8 === 0 ? 2 : 1)); c.put("crash", 0, 2); }
        if (c.rnd(0.4)) c.perBar(o => { c.put("tom2", o + 14, 1); c.put("tom2", o + 15, 1); });
      },
    },
  ]);

  // Altri punk: stessa struttura, generi vicini ma con un ritmo riconoscibile.
  E.defineStyles("punk", [
    {
      id: "skate", label: "Skate punk", ref: "Bad Religion, NOFX, Descendents, Pennywise", bpm: [180, 215],
      fills: ["roll", "down", "unison"],
      variants: [
        { id: "std", label: "", w: 4, must: { kick: [0, 8], snare: [4, 12] } },
        { id: "double", label: "doppia cassa", w: 3, must: { kick: [0, 2, 8, 10], snare: [4, 12] } },
        { id: "toms", label: "tom nel ritornello", w: 2, sections: ["chorus"], must: { kick: [0, 8], snare: [4, 12] } },
      ],
      gen(c) {
        if (c.variant === "double") hits(c, "kick", [0, 2, 8, 10], [0, 8]);
        else cells(c, "kick", [[0, 8], [0, 8, 10], [0, 6, 8], [0, 8, 14]], [0, 8]);
        backbeat(c);
        if (c.variant === "toms") { cymbal(c, "tom2", 2); c.perBar(o => c.put("crash", o, 2)); c.note = "floor tom"; }
        else if (c.verse) cymbal(c, c.pick(["chh", "chh", "ride"]), 2);
        else { cymbal(c, c.pick(["ride", "crash"]), c.pick([2, 4])); c.put("crash", 0, 2); }
        if (c.rnd(0.4)) c.perBar(o => c.put("snare", o + 14, 1));
      },
    },
    {
      id: "poppunk", label: "Pop punk", ref: "Green Day, Blink-182, Descendents, The Queers", bpm: [150, 185],
      fills: ["roll", "down", "unison"], must: { kick: [0], snare: [4, 12] },
      gen(c) {
        cells(c, "kick", [[0, 8], [0, 6, 8], [0, 8, 10], [0, 3, 8, 10, 14]], [0, 8]);
        backbeat(c);
        if (c.verse) cymbal(c, "chh", 2);
        else { cymbal(c, "ohh", 2); c.put("crash", 0, 2); c.note = "hat aperti"; }
        if (c.rnd(0.5)) c.perBar(o => { c.put("snare", o + 14, 1); if (c.rnd(0.5)) c.put("snare", o + 15, 1); });
      },
    },
    {
      id: "crust", label: "Crust", ref: "Amebix, Doom, Disfear, His Hero Is Gone", bpm: [160, 200],
      fills: ["roll", "unison", "down"],
      variants: [
        { id: "gallop", label: "galoppo", w: 4, must: { kick: [0, 2, 3, 8], snare: [4] } },
        { id: "blast", label: "blast", w: 2, must: { kick: [0, 2, 4], snare: [1, 3] } },
        { id: "half", label: "half-time", w: 2, must: { kick: [0], snare: [8] } },
      ],
      gen(c) {
        if (c.variant === "blast") {
          c.each(0, 2, i => c.put("kick", i, i % 8 === 0 ? 2 : 1));
          c.each(1, 2, i => c.put("snare", i, 1));
          if (c.verse) cymbal(c, "chh", 2); else { cymbal(c, "crash", 4); c.put("crash", 0, 2); }
        } else if (c.variant === "half") {
          cells(c, "kick", [[0, 3, 6], [0, 6, 7, 10], [0, 3, 10]], [0], 0.6);
          c.perBar(o => c.put("snare", o + 8, 2));
          if (c.verse) cymbal(c, "chh", 4); else { c.each(0, 4, i => c.put("china", i, i % 8 === 0 ? 2 : 1)); c.put("crash", 0, 2); }
        } else {
          hits(c, "kick", [0, 2, 3, 8, 10, 11], [0, 8]);
          backbeat(c);
          if (c.verse) cymbal(c, "chh", 2); else { cymbal(c, "china", 4); c.put("crash", 0, 2); }
        }
      },
    },
    {
      id: "anarcho", label: "Anarcho-punk", ref: "Crass, Flux of Pink Indians, Conflict, Subhumans", bpm: [138, 172],
      fills: ["toms", "down", "roll"],
      variants: [
        { id: "stomp", label: "stomp", w: 3, must: { kick: [0, 8], snare: [4, 12] } },
        { id: "tribal", label: "tribale", w: 3, must: { kick: [0, 8], snare: [12] } },
      ],
      gen(c) {
        hits(c, "kick", [0, 8], [0, 8]);
        if (c.variant === "tribal") {
          c.perBar(o => c.put("snare", o + 12, 2));
          cells(c, "tom", [[2, 3, 6], [3, 6, 7], [2, 6, 10]], []);
          cells(c, "tom2", [[10, 14], [11, 14], [10, 11, 14]], []);
        } else {
          backbeat(c);
          cymbal(c, "tom2", 4, 2);
          if (c.chorus) { cymbal(c, "tom", 4, 3); c.put("crash", 0, 2); }
        }
      },
    },
    {
      // Blast e rallentamenti a blocchi di 8 step: il contrasto e' il genere.
      id: "powerviolence", label: "Powerviolence", ref: "Infest, Crossed Out, Man Is The Bastard, Charles Bronson", bpm: [170, 230],
      fills: ["unison", "roll"],
      variants: [
        { id: "blast", label: "blast", w: 3, must: { kick: [0, 2, 4], snare: [1, 3] } },
        { id: "sludge", label: "sludge", w: 2, must: { kick: [0], snare: [8] } },
        { id: "mixed", label: "blast + sludge", w: 3, must: { kick: [0, 2, 8], snare: [1, 3, 12] } },
      ],
      gen(c) {
        const blast = (a, b) => { for (let i = a; i < b; i++) i % 2 ? c.put("snare", i, 1) : c.put("kick", i, i % 8 === 0 ? 2 : 1); };
        const sludge = a => { c.put("kick", a, 2); c.put("snare", a + 4, 2); c.put("china", a, 2); };
        if (c.variant === "blast") {
          blast(0, c.len); cymbal(c, c.pick(["chh", "china"]), 2);
        } else if (c.variant === "sludge") {
          cells(c, "kick", [[0, 3, 6], [0, 6, 7, 10], [0, 3, 10, 11]], [0], 0.6);
          c.perBar(o => c.put("snare", o + 8, 2));
          c.each(0, 4, i => c.put("china", i, i % 8 === 0 ? 2 : 1));
        } else {
          for (let a = 0; a < c.len; a += 8) (a / 8) % 2 ? sludge(a) : blast(a, a + 8);
          c.each(0, 2, i => { if ((Math.floor(i / 8)) % 2 === 0) c.put("chh", i, i % 8 === 0 ? 2 : 1); });
        }
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
  ]);
})(typeof SPEngine !== "undefined" ? SPEngine : require("./core.js"));
