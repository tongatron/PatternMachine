// Schede: breakbeat, jungle, drum'n'bass, garage, trip hop. Formato dei campi in styles-punk.js.
// Il colpo di rullante fantasma qui e' a livello 1: il livello 3 (morbido) lo aggiunge la variazione "dinamica".
(function (E) {
  const { hits, cells, backbeat, cymbal, ghosts, openHat } = E.h;
  E.defineGroup({ id: "break", label: "Breakbeat / DnB" });

  E.defineStyles("break", [
    {
      id: "jungle", label: "Jungle / amen", ref: "Goldie, Shy FX, Remarc, The Winstons (Amen, brother)", bpm: [155, 172],
      fills: ["roll", "unison"],
      variants: [
        { id: "amen", label: "amen", w: 4, must: { kick: [0, 2, 10], snare: [4, 12] } },
        { id: "choppy", label: "ragga", w: 3, must: { kick: [0, 10], snare: [4, 12] } },
        { id: "roll", label: "con rullata", w: 2, must: { kick: [0, 10], snare: [4, 12] } },
      ],
      gen(c) {
        if (c.variant === "choppy") {
          cells(c, "kick", [[0, 10], [0, 3, 10], [0, 6, 10]]);
          backbeat(c);
          ghosts(c, "snare", [3, 7, 9, 11, 15], 2, 3);
          c.each(0, 1, i => c.put("chh", i, i % 4 === 0 ? 2 : 1));
        } else if (c.variant === "roll") {
          hits(c, "kick", [0, 10], [0]);
          backbeat(c);
          c.perBar(o => { c.put("snare", o + 14, 1); c.put("snare", o + 15, 1); });
          cymbal(c, "chh", 2);
        } else {
          cells(c, "kick", [[0, 2, 10], [0, 2, 10, 11], [0, 2, 8, 10]]);
          backbeat(c);
          ghosts(c, "snare", [7, 9, 14, 15], 1, 3);
          cymbal(c, c.pick(["ride", "chh"]), 2);
        }
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
    {
      id: "dnb", label: "Drum'n'bass", ref: "Roni Size, Pendulum, Andy C, LTJ Bukem", bpm: [168, 178],
      fills: ["roll", "unison", "down"],
      variants: [
        { id: "twostep", label: "two-step", w: 4, must: { kick: [0, 10], snare: [4, 12] } },
        { id: "liquid", label: "liquid", w: 3, must: { kick: [0, 10], snare: [4, 12] } },
        { id: "half", label: "half-time", w: 2, must: { kick: [0], snare: [8] } },
      ],
      gen(c) {
        if (c.variant === "half") {
          cells(c, "kick", [[0, 10], [0, 6, 10], [0, 3, 10]]);
          c.perBar(o => c.put("snare", o + 8, 2));
          cymbal(c, "chh", 2);
        } else if (c.variant === "liquid") {
          hits(c, "kick", [0, 10], [0]);
          backbeat(c);
          ghosts(c, "snare", [7, 9, 15], 1, 2);
          cymbal(c, "ride", 2);
          c.each(1, 2, i => { if (c.rnd(0.5)) c.put("shaker", i, 1); });
        } else {
          hits(c, "kick", [0, 10], [0]);
          backbeat(c);
          cymbal(c, "chh", 2);
          if (c.rnd(0.5)) c.perBar(o => openHat(c, o + 14));
        }
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
    {
      // Swing sui sedicesimi dispari: qui e' il tipo di swing che la griglia sa fare.
      id: "garage2", label: "UK garage 2-step", ref: "Artful Dodger, MJ Cole, Burial, Todd Edwards", bpm: [128, 140], swing: [12, 26],
      fills: ["claps", "roll"], feel: { snare: 4 },
      variants: [
        { id: "std", label: "", w: 3, must: { kick: [0, 10], snare: [4, 12] } },
        { id: "skip", label: "skippy", w: 2, must: { kick: [0, 7, 10], snare: [4, 12] } },
      ],
      gen(c) {
        hits(c, "kick", c.variant === "skip" ? [0, 7, 10] : [0, 10], [0]);
        backbeat(c);
        c.backbeats.forEach(i => c.put("clap", i, 1));
        c.each(0, 1, i => c.put("chh", i, i % 4 === 2 ? 2 : 1));
        if (c.rnd(0.5)) c.perBar(o => openHat(c, o + 6));
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
    {
      id: "bigbeat", label: "Big beat", ref: "The Chemical Brothers, Fatboy Slim, Propellerheads, The Prodigy", bpm: [108, 130],
      fills: ["roll", "unison", "down"], must: { kick: [0, 10], snare: [4, 12] },
      gen(c) {
        cells(c, "kick", [[0, 3, 10], [0, 6, 10], [0, 10, 13]]);
        backbeat(c);
        cymbal(c, "chh", 2);
        if (c.rnd(0.6)) c.perBar(o => openHat(c, o + 14));
        if (c.chorus) { c.each(1, 2, i => c.put("tamb", i, 1)); c.put("crash", 0, 2); c.note = "tamburello"; }
      },
    },
    {
      id: "triphop", label: "Trip hop", ref: "Portishead, Massive Attack, Tricky, DJ Shadow", bpm: [66, 92],
      fills: ["down", "toms"], feel: { snare: 10, kick: -3, chh: 4 },
      variants: [
        { id: "std", label: "", w: 3, must: { kick: [0], snare: [4, 12] } },
        { id: "sparse", label: "spoglio", w: 2, must: { kick: [0], snare: [12] } },
      ],
      gen(c) {
        cells(c, "kick", [[0, 7], [0, 10], [0, 7, 10]], [0], 0.6);
        if (c.variant === "sparse") { c.perBar(o => { c.put("snare", o + 12, 2); c.put("rim", o + 15, 1); }); }
        else { backbeat(c); if (c.rnd(0.6)) c.perBar(o => c.put("snare", o + 14, 1)); }
        cymbal(c, "chh", 2);
        c.some(Array.from({ length: c.len / 2 }, (_, i) => i * 2).filter(i => i % 4 !== 0), 1, 3).forEach(i => c.put("chh", i, 0));
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
  ]);
})(typeof SPEngine !== "undefined" ? SPEngine : require("./core.js"));
