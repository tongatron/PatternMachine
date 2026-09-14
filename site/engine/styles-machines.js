// Schede: drum machine e freddo (minimal synth, EBM, industrial, goth con batteria elettronica).
// Qui la macchina e' dichiarata: poche risposte tra le battute, accenti regolari. Formato in styles-punk.js.
(function (E) {
  const { cells, hits, backbeat, euclidBars, openHat } = E.h;
  E.defineGroup({ id: "machines", label: "Macchine e freddo" });
  E.defineStyles("machines", [
    {
      id: "suicide", label: "Rhythm box", ref: "Suicide, Silver Apples, Soft Cell", bpm: [110, 150],
      fills: ["machine"],
      variants: [
        { id: "rockabilly", label: "rockabilly box", w: 3, must: { kick: [0, 6, 8], rim: [4] } },
        { id: "motorik", label: "motorik box", w: 2, must: { kick: [0, 8, 10] } },
        { id: "pulse", label: "pulsazione", w: 2, must: { kick: [0, 4, 8], clave: [4] } },
      ],
      gen(c) {
        if (c.variant === "rockabilly") {
          hits(c, "kick", [0, 6, 8, 14]);
          hits(c, "rim", [4, 12]);
          c.each(0, 2, i => c.put("shaker", i, 1));
        } else if (c.variant === "motorik") {
          hits(c, "kick", [0, 8, 10]);
          hits(c, c.pick(["rim", "snare3"]), [4, 12]);
          c.each(0, 2, i => c.put("chh", i, 1));
        } else {
          c.each(0, 4, i => c.put("kick", i, 1));
          c.each(1, 2, i => c.put("chh", i, 1));
          hits(c, "clave", [4, 12]);
        }
        if (c.chorus) { backbeat(c, "clap"); c.perBar(o => openHat(c, o + 14)); }
      },
    },
    {
      id: "ebm", label: "EBM / body music", ref: "DAF, Front 242, Nitzer Ebb", bpm: [116, 134],
      fills: ["machine", "claps"], must: { kick: [0, 4, 8], clap: [4] },
      variants: [
        { id: "body", label: "", w: 3 },
        { id: "upbeat", label: "cassa in levare", w: 2, must: { kick: [7] } },
        { id: "metal", label: "metallo", w: 2 },
      ],
      gen(c) {
        c.each(0, 4, i => c.put("kick", i, 2));
        backbeat(c, "snare3"); backbeat(c, "clap");
        if (c.variant === "upbeat") hits(c, "kick", [7, 15]);
        c.each(0, 1, i => { if (i % 4 !== 0) c.put("chh", i, i % 4 === 2 ? 2 : 1); });   // 16esimi da sequencer
        if (c.variant === "metal") { euclidBars(c, "cow", 7, c.pick([1, 3]), false); euclidBars(c, "china", 3, 2, false); }
        if (c.chorus) { c.each(2, 4, i => openHat(c, i, 2)); c.put("crash", 0, 2); }
      },
    },
    {
      id: "cabaret", label: "Industrial funk", ref: "Cabaret Voltaire, 23 Skidoo, Clock DVA", bpm: [100, 122], swing: [0, 8],
      fills: ["congas", "machine"], must: { kick: [0] },
      variants: [
        { id: "loop", label: "tape loop", w: 3, must: { kick: [7, 10], clap: [4] } },
        { id: "dub", label: "dub", w: 2, must: { kick: [10], rim: [12] } },
      ],
      gen(c) {
        if (c.variant === "dub") {
          hits(c, "kick", [0, 10], [0]);
          hits(c, "rim", [12], [12]);
          c.perBar(o => openHat(c, o + 6));
        } else {
          hits(c, "kick", [0, 7, 10], [0]);
          backbeat(c, "clap");
          c.each(0, 1, i => c.put("chh", i, i % 4 === 2 ? 2 : 1));
          c.some(Array.from({ length: c.len }, (_, i) => i), 2, 5).forEach(i => { c.R.chh[i] = 0; });   // buchi nel nastro
        }
        euclidBars(c, "conga", 7, c.pick([0, 2, 3]), false);
        euclidBars(c, "perc", 5, c.pick([1, 4]), false);
        if (c.rnd(0.5)) hits(c, "cow", [c.pick([3, 11, 14])]);
        if (c.chorus) { c.each(1, 2, i => c.put("shaker", i, 1)); c.put("crash", 0, 2); }
      },
    },
    {
      id: "avalanche", label: "Goth rock machine", ref: "The Sisters of Mercy, The March Violets, Xmal Deutschland",
      bpm: [130, 162], fills: ["machine", "toms"], must: { snare: [4], clap: [4] },
      variants: [
        { id: "pulse", label: "ottavi di cassa", w: 3, must: { kick: [0, 2, 4, 6] } },
        { id: "rock", label: "rock", w: 3, must: { kick: [0, 8] } },
        { id: "run", label: "corsa sui tom", w: 2, must: { kick: [0, 8] } },
      ],
      gen(c) {
        if (c.variant === "pulse") c.each(0, 2, i => c.put("kick", i, i % 8 === 0 ? 2 : 1));
        else cells(c, "kick", [[0, 8, 10], [0, 3, 8], [0, 8, 11]], [0, 8], 0.4);
        backbeat(c); backbeat(c, "clap");
        c.each(0, 1, i => c.put("chh", i, i % 4 === 0 ? 2 : 1));
        if (c.variant === "run") c.perBar((o, b) => {
          if (b === c.bars - 1) [12, 13, 14, 15].forEach((s, k) => c.put(k < 2 ? "tom" : "tom2", o + s, k % 2 ? 1 : 2));
        });
        if (c.chorus) { c.each(2, 4, i => openHat(c, i)); c.put("crash", 0, 2); }
      },
    },
    {
      id: "coldwave", label: "Cold wave / goth", ref: "The Cure (Seventeen Seconds), Clan of Xymox, Asylum Party",
      bpm: [118, 142], fills: ["toms", "roll"], must: { kick: [0], snare3: [4] },
      gen(c) {
        c.each(0, c.verse ? 8 : 4, i => c.put("kick", i, 2));
        if (c.verse && c.rnd(0.5)) c.perBar(o => c.put("kick", o + 10, 1));
        backbeat(c, "snare3");
        if (c.chorus) backbeat(c, "clap");
        c.each(0, 1, i => c.put("chh", i, i % 4 === 2 ? 2 : 1));     // 16esimi, accento in levare
        if (c.chorus) c.each(2, 4, i => openHat(c, i));
        if (c.rnd(0.4)) c.perBar(o => { c.put("tom", o + 14, 1); c.put("tom2", o + 15, 2); });
      },
    },
    {
      id: "industrial", label: "Industrial rock", ref: "Killing Joke, Ministry, Big Black, NIN", bpm: [108, 132],
      fills: ["unison", "roll"], must: { kick: [0, 8], snare: [4], clap: [4] },
      gen(c) {
        cells(c, "kick", [[0, 3, 6, 8, 11], [0, 2, 8, 10], [0, 6, 8, 11, 14], [0, 3, 8, 10, 11]], [0, 8], 0.3);
        backbeat(c); backbeat(c, "clap");
        c.each(0, c.chorus ? 1 : 2, i => c.put("chh", i, i % 4 === 0 ? 2 : 1));
        euclidBars(c, "china", c.pick([3, 5]), c.pick([2, 3, 6]), false);
        if (c.rnd(0.6)) euclidBars(c, "cow", 5, c.pick([1, 3]), false);
      },
    },
  ]);
})(typeof SPEngine !== "undefined" ? SPEngine : require("./core.js"));
