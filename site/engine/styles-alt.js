// Schede: alternative e indie. Formato dei campi in styles-punk.js.
(function (E) {
  const { cells, backbeat, cymbal, ghosts, euclidBars, openHat } = E.h;
  E.defineGroup({ id: "alt", label: "Alternative / Indie" });
  E.defineStyles("alt", [
    {
      id: "grunge", label: "Grunge", ref: "Nirvana, Soundgarden, Mudhoney", bpm: [98, 128],
      fills: ["down", "unison", "toms"], must: { kick: [0], snare: [4] },
      gen(c) {
        if (c.verse) {
          cells(c, "kick", [[0, 8], [0, 3, 8], [0, 8, 10], [0, 3, 10]]);
          cymbal(c, "chh", 2);
          ghosts(c, "snare", [7, 9, 15], 0, 2);
        } else {
          cells(c, "kick", [[0, 3, 6, 8, 10], [0, 2, 3, 8, 10, 11], [0, 6, 8, 11], [0, 3, 8, 10, 14]], [0, 8]);
          cymbal(c, c.pick(["ride", "crash", "ohh"]), 2);
          c.perBar(o => c.put("crash", o, 2));
        }
        backbeat(c);
      },
    },
    {
      id: "garage", label: "Garage / indie rock", ref: "Stooges, Velvet Underground, Strokes, White Stripes", bpm: [116, 150],
      fills: ["roll", "down"],
      variants: [
        { id: "rock", label: "", w: 8, must: { kick: [0], snare: [4] } },
        { id: "primitive", label: "primitivo", w: 2, must: { kick: [0, 4], tom2: [0, 4] } },   // alla Moe Tucker
      ],
      gen(c) {
        if (c.variant === "primitive") {
          c.each(0, 4, i => { c.put("tom2", i, 2); c.put("kick", i, 1); });
          c.each(0, 2, i => c.put("tamb", i, i % 4 === 0 ? 2 : 1));
          return;
        }
        cells(c, "kick", [[0, 8], [0, 7, 8], [0, 8, 10], [0, 6, 8]]);
        backbeat(c);
        if (c.verse) cymbal(c, c.pick(["chh", "tamb"]), 2);
        else { cymbal(c, "ohh", 2); backbeat(c, "tamb"); c.put("crash", 0, 2); }
      },
    },
    {
      id: "shoegaze", label: "Shoegaze / dream pop", ref: "My Bloody Valentine, Slowdive, Ride", bpm: [88, 120],
      fills: ["toms", "roll"], must: { kick: [0] },
      variants: [
        { id: "straight", label: "", w: 1, must: { snare: [4] } },
        { id: "half", label: "half-time", w: 1, must: { snare: [8] } },
      ],
      gen(c) {
        const half = c.variant === "half";
        cells(c, "kick", half ? [[0, 10], [0, 7, 10], [0, 3, 10]] : [[0, 8], [0, 6, 8], [0, 8, 11]]);
        if (half) c.perBar(o => c.put("snare", o + 8, 2)); else backbeat(c);
        if (c.verse) c.each(0, 2, i => c.put("ride", i, 1));
        else {
          c.each(0, 2, i => c.put("ohh", i, i % 4 === 0 ? 2 : 1));
          c.each(0, 8, i => c.put("crash", i, i % 16 === 0 ? 2 : 1));
          c.each(0, 2, i => c.put("tamb", i, 1));
        }
      },
    },
    {
      id: "noiserock", label: "Noise rock / no wave", ref: "Sonic Youth, Swans, The Jesus Lizard", bpm: [96, 134],
      fills: ["toms", "unison"], must: { kick: [0], snare: [4] },
      variants: [
        { id: "std", label: "", w: 65 },
        { id: "hammer", label: "martello", w: 35, must: { kick: [0, 4, 8], tom2: [0, 4, 8] } },
      ],
      gen(c) {
        if (c.variant === "hammer") {       // cassa e floor tom all'unisono sui quarti
          c.each(0, 4, i => { c.put("kick", i, 2); c.put("tom2", i, 2); });
          backbeat(c);
        } else {
          cells(c, "kick", [[0, 1, 8, 10], [0, 3, 6, 8], [0, 2, 3, 8, 11]], [0], 0.6);
          backbeat(c);
          c.each(0, 2, i => c.put(c.verse ? "tom2" : "ride", i, i % 4 === 0 ? 2 : 1));
        }
        euclidBars(c, "china", c.pick([3, 5]), c.pick([0, 3]), false);
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
    {
      id: "posthc", label: "Post-hardcore DC", ref: "Fugazi, Rites of Spring, Nation of Ulysses", bpm: [110, 142], swing: [0, 8],
      fills: ["toms", "down", "roll"], must: { kick: [0] },
      variants: [
        { id: "drive", label: "", w: 65 },
        { id: "dub", label: "dub", w: 35, sections: ["verse"], must: { kick: [8], rim: [8] } },   // one drop
      ],
      gen(c) {
        if (c.variant === "dub") {
          c.perBar(o => { c.put("kick", o + 8, 2); c.put("rim", o + 8, 2); c.put("ohh", o + 14, 1); });
          c.each(0, 2, i => { if (i % 16 !== 14) c.put("chh", i, i % 4 === 0 ? 2 : 1); });
          return;
        }
        cells(c, "kick", [[0, 3, 10], [0, 6, 10, 11], [0, 3, 8, 11], [0, 7, 10]]);
        if (c.verse) {
          backbeat(c, "rim");
          cymbal(c, "chh", 2);
          c.perBar(o => openHat(c, o + 7));
        } else {
          backbeat(c);
          cymbal(c, "ride", 2);
          c.put("crash", 0, 2);
          c.perBar(o => { c.put("tom2", o + 14, 1); c.put("tom", o + 15, 1); });
        }
        ghosts(c, "snare", [2, 7, 9, 15], 0, 2);
      },
    },
    {
      id: "math", label: "Math rock", ref: "Don Caballero, Slint, Hella, American Football", bpm: [118, 160],
      fills: ["toms", "roll"], must: { kick: [0] },
      gen(c) {
        const g = c.pick([3, 5, 7]);          // gruppo dispari che scorre contro il 4/4
        for (let i = 0; i < c.len; i += g) c.put("kick", i, i % 16 === 0 ? 2 : 1);
        const shift = c.pick([0, 0, -1, 2]);
        c.perBar(o => [4, 12].forEach(s => c.put("snare", o + s + shift, 2)));
        if (c.verse) c.each(0, 1, i => { if (i % g === 0) c.put("chh", i, 2); else if (i % 2 === 0) c.put("chh", i, 1); });
        else {
          c.each(0, 2, i => c.put("ride", i, 1));
          for (let i = 0; i < c.len; i += g) c.put("ride", i, 2);
          c.put("crash", 0, 2);
        }
        ghosts(c, "snare", [1, 7, 10, 15], 1, 2);
        c.note = `groups of ${g}`;
      },
    },
  ]);
})(typeof SPEngine !== "undefined" ? SPEngine : require("./core.js"));
