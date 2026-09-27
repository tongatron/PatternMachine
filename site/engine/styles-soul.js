// Schede: soul, disco, afro e ritmi latini dritti. Formato dei campi in styles-punk.js.
// Solo sedicesimi dritti: blues shuffle e jazz swing chiederebbero una griglia a terzine.
(function (E) {
  const { euclid, hits, cells, backbeat, cymbal, ghosts, openHat } = E.h;
  E.defineGroup({ id: "soul", label: "Soul / Disco / Afro" });

  E.defineStyles("soul", [
    {
      id: "disco", label: "Disco", ref: "Chic, Donna Summer, Earth Wind & Fire, Sylvester", bpm: [110, 128],
      fills: ["claps", "roll"],
      variants: [
        { id: "std", label: "", w: 3, must: { kick: [0, 4, 8, 12], snare: [4, 12], ohh: [2, 6, 10, 14] } },
        { id: "sixteen", label: "hat a sedicesimi", w: 2, must: { kick: [0, 4, 8, 12], snare: [4, 12], ohh: [2, 6, 10, 14] } },
      ],
      gen(c) {
        c.each(0, 4, i => c.put("kick", i, i % 16 === 0 ? 2 : 1));
        backbeat(c);
        c.backbeats.forEach(i => c.put("clap", i, 1));
        c.each(2, 4, i => c.put("ohh", i, 1));
        if (c.variant === "sixteen") c.each(1, 2, i => c.put("chh", i, 1));
        else c.each(0, 4, i => c.put("chh", i, 1));
        if (c.chorus) { c.put("crash", 0, 2); c.each(1, 2, i => { if (i % 4 === 3) c.put("tamb", i, 1); }); }
      },
    },
    {
      id: "motown", label: "Motown", ref: "The Funk Brothers, The Supremes, Marvin Gaye, The Four Tops", bpm: [112, 132],
      fills: ["roll", "down"], feel: { snare: 3, tamb: -2 }, must: { kick: [0, 8], snare: [4, 12] },
      gen(c) {
        cells(c, "kick", [[0, 8], [0, 3, 8], [0, 8, 10]], [0, 8]);
        backbeat(c);
        cymbal(c, "tamb", 2);
        if (c.rnd(0.5)) c.perBar(o => c.put("snare", o + 14, 1));
        if (c.chorus) { c.put("crash", 0, 2); c.perBar(o => { c.put("snare", o, 1); c.put("snare", o + 8, 1); }); c.note = "snare on all four"; }
      },
    },
    {
      id: "afrobeat", label: "Afrobeat", ref: "Tony Allen, Fela Kuti, Antibalas, Fatai Rolling Dollar", bpm: [100, 118],
      fills: ["congas", "roll"], feel: { kick: 2, snare: 4 },
      variants: [
        { id: "std", label: "", w: 3, must: { kick: [0], snare: [4, 12] } },
        { id: "bell", label: "campana", w: 2, must: { kick: [0], snare: [4, 12] } },
      ],
      gen(c) {
        cells(c, "kick", [[0, 7, 10], [0, 6, 10, 11], [0, 10, 13]]);
        backbeat(c);
        ghosts(c, "snare", [3, 6, 9, 11, 14, 15], 2, 3);
        c.each(0, 1, i => c.put("chh", i, i % 4 === 2 ? 2 : 1));
        if (c.rnd(0.6)) c.perBar(o => openHat(c, o + 14));
        if (c.variant === "bell") euclid(5, c.len, c.pick([0, 3])).forEach((v, i) => { if (v) c.put("cow", i, 1); });
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
    {
      id: "bossa", label: "Bossa nova", ref: "João Gilberto, Antônio Carlos Jobim, Astrud Gilberto, Stan Getz", bpm: [112, 140],
      fills: ["congas"], feel: { rim: 5 }, must: { kick: [0, 6, 8, 14], rim: [0, 6, 12] },
      gen(c) {
        // cassa in due (1, 2 e, 3, 4 e) e clave 3-2 sul rim, una battuta si' e una no
        c.perBar((o, b) => {
          [0, 6, 8, 14].forEach(s => c.put("kick", o + s, s === 0 ? 2 : 1));
          (b % 2 === 0 ? [0, 6, 12] : [4, 8]).forEach(s => c.put("rim", o + s, 2));
        });
        cymbal(c, "chh", 2);
        if (c.chorus && c.rnd(0.5)) c.each(1, 2, i => { if (i % 4 === 3) c.put("shaker", i, 1); });
      },
    },
    {
      id: "cumbia", label: "Cumbia", ref: "Los Ángeles Azules, Celso Piña, Sonora Dinamita, Los Mirlos", bpm: [82, 104],
      fills: ["congas", "roll"], must: { kick: [0, 8], snare: [4, 12] },
      gen(c) {
        hits(c, "kick", [0, 8], [0, 8]);
        backbeat(c, "rim", [4, 12]);
        c.perBar(o => { c.put("snare", o + 4, 1); c.put("snare", o + 12, 1); });
        cymbal(c, "shaker", 2);
        cells(c, "conga", [[3, 6, 10, 14], [2, 6, 10, 14], [3, 7, 10, 15]], []);
        if (c.chorus) { c.put("crash", 0, 2); cells(c, "conga2", [[2, 11], [7, 14]], []); }
      },
    },
  ]);
})(typeof SPEngine !== "undefined" ? SPEngine : require("./core.js"));
