// Schede: hip hop, dance, latin. Formato dei campi in styles-punk.js.
(function (E) {
  const { euclid } = E.h;
  E.defineGroup({ id: "groove", label: "Hip hop / Dance / Latin" });

  function boomFunk(c, dense) {
    const { len, bars, put } = c;
    for (let b = 0; b < bars; b++) {
      put("kick", b * 16, 2);
      c.some([3, 6, 7, 10, 11, 14].map(i => b * 16 + i), dense ? 3 : 2, dense ? 4 : 3).forEach(i => put("kick", i, 1));
    }
    c.backbeats.forEach(i => put("snare", i, 2));
    c.some([3, 7, 11, 15].flatMap(i => Array.from({ length: bars }, (_, b) => b * 16 + i)), 1, dense ? 3 : 2)
      .forEach(i => { if (!c.get("snare", i)) put("snare", i, 1); });
    c.each(0, dense ? 1 : 2, i => put("chh", i, i % 4 === 0 ? 2 : 1));
    if (!dense && c.rnd(0.5)) c.some(Array.from({ length: len }, (_, i) => i).filter(i => i % 2 === 1), 2, 4).forEach(i => put("chh", i, 1));
    if (dense && c.rnd(0.6)) c.some(Array.from({ length: len }, (_, i) => i), 1, 3).forEach(i => put("chh", i, 0));
    if (c.rnd(0.75)) { const o = c.pick([7, 15].map(i => (bars - 1) * 16 + i)); put("ohh", o, 1); put("chh", o, 0); }
    if (c.rnd(0.35)) put("rim", c.pick([9, 13, 25, 29].filter(i => i < len)), 1);
  }

  E.defineStyles("groove", [
    { id: "boombap", label: "Boom bap", ref: "hip hop anni '90", bpm: [88, 96], swing: 18,
      fills: ["roll", "down"], must: { kick: [0], snare: [4] }, gen(c) { boomFunk(c, false); } },
    { id: "funk", label: "Funk", ref: "James Brown, The Meters", bpm: [98, 110], swing: 8,
      fills: ["roll", "down"], must: { kick: [0], snare: [4] }, gen(c) { boomFunk(c, true); } },
    {
      id: "trap", label: "Trap", ref: "trap half time", bpm: [136, 148], fills: ["hats"], must: { kick: [0], clap: [8] },
      gen(c) {
        const { len, bars, put } = c;
        for (let b = 0; b < bars; b++) {
          put("kick", b * 16, 2);
          c.some([6, 10, 11, 14, 19, 22].map(i => b * 16 + i).filter(i => i < len), 2, 3).forEach(i => put("kick", i, 1));
        }
        for (let b = 0; b < bars; b++) put("clap", b * 16 + 8, 2);
        c.each(0, 1, i => put("chh", i, i % 4 === 0 ? 2 : 1));
        c.some(Array.from({ length: len }, (_, i) => i), 2, 4).forEach(i => put("chh", i, 0));
        if (c.rnd(0.7)) {
          const s = c.pick([len - 6, len - 4, len - 12].filter(i => i > 0));
          for (let i = s; i < Math.min(len, s + 4); i++) put("chh", i, i === s ? 2 : 1);
        }
        if (c.rnd(0.5)) put("ohh", c.pick([11, 14, 27, 30].filter(i => i < len)), 1);
      },
    },
    {
      id: "house", label: "House", ref: "Chicago, deep house", bpm: [120, 126], fills: ["claps"], must: { kick: [0, 4, 8], clap: [4] },
      gen(c) {
        const { len, put } = c;
        c.each(0, 4, i => put("kick", i, 2));
        c.backbeats.forEach(i => put("clap", i, 2));
        c.each(2, 4, i => put("ohh", i, 1));
        c.each(1, 2, i => put("shaker", i, 1));
        if (c.rnd(0.6)) euclid(c.pick([5, 7]), len, c.pick([0, 2, 3])).forEach((v, i) => { if (v) put("perc", i, 1); });
        if (c.rnd(0.4)) put("crash", 0, 1);
      },
    },
    {
      id: "latin", label: "Latin", ref: "son, salsa", bpm: [94, 102], fills: ["congas"], must: { kick: [0] },
      gen(c) {
        const { len, bars, put } = c;
        const clave = c.rnd(0.5) ? [0, 3, 6, 10, 12] : [2, 5, 8, 12, 14];
        for (let b = 0; b < bars; b++) clave.forEach(i => put("clave", b * 16 + i, i === 0 ? 2 : 1));
        euclid(c.pick([7, 9]), len, c.pick([0, 1, 2])).forEach((v, i) => { if (v) put("conga", i, i % 4 === 0 ? 2 : 1); });
        if (c.rnd(0.7)) euclid(c.pick([5, 6]), len, c.pick([1, 3])).forEach((v, i) => { if (v) put("conga2", i, 1); });
        for (let b = 0; b < bars; b++) { put("kick", b * 16, 2); put("kick", b * 16 + c.pick([10, 11, 14]), 1); }
        c.each(0, 2, i => put("shaker", i, i % 4 === 0 ? 2 : 1));
      },
    },
    {
      id: "euclid", label: "Euclideo", ref: "ritmi euclidei (Toussaint)", bpm: [96, 104], fills: ["toms"], must: { kick: [0] },
      gen(c) {
        const { len, put } = c;
        put("kick", 0, 2);
        euclid(c.pick([3, 4, 5]), len, 0).forEach((v, i) => { if (v) put("kick", i, i === 0 ? 2 : 1); });
        euclid(c.pick([2, 3]), len, c.pick([4, 6, 8])).forEach((v, i) => { if (v) put("snare", i, 2); });
        euclid(c.pick([7, 9, 11, 13]), len, c.pick([0, 1])).forEach((v, i) => { if (v) put("chh", i, i % 4 === 0 ? 2 : 1); });
        if (c.rnd(0.7)) euclid(c.pick([5, 7]), len, c.pick([2, 3, 5])).forEach((v, i) => { if (v) put("perc", i, 1); });
        if (c.rnd(0.4)) euclid(3, len, c.pick([1, 2])).forEach((v, i) => { if (v) put("cow", i, 1); });
      },
    },
  ]);
})(typeof SPEngine !== "undefined" ? SPEngine : require("./core.js"));
