// Schede: punk e hardcore.
// Campi: id, label, ref (riferimenti), bpm [min,max], swing, fills, variants [{id,label,w,sections,must}],
// must {voce:[step]} = colpi che devono esserci nella prima battuta (verificati dai test), gen(c).
(function (E) {
  const { cells, backbeat, cymbal } = E.h;
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
})(typeof SPEngine !== "undefined" ? SPEngine : require("./core.js"));
