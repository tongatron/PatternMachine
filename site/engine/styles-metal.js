// Schede: rock classico, hard rock, doom e metal. Formato dei campi in styles-punk.js.
(function (E) {
  const { hits, cells, backbeat, cymbal, ghosts, openHat } = E.h;
  E.defineGroup({ id: "metal", label: "Heavy rock / Metal" });

  // Cassa e rullante alternati sui sedicesimi (blast beat): cassa sui pari, rullante sui dispari.
  const blast = (c, a = 0, b = c.len) => {
    for (let i = a; i < b; i++) i % 2 ? c.put("snare", i, 1) : c.put("kick", i, i % 8 === 0 ? 2 : 1);
  };

  E.defineStyles("metal", [
    {
      id: "rockclassic", label: "Classic rock", ref: "AC/DC, Led Zeppelin, The Who, Black Sabbath", bpm: [100, 142],
      fills: ["down", "toms", "roll"], must: { kick: [0, 8], snare: [4, 12] },
      gen(c) {
        cells(c, "kick", [[0, 8], [0, 6, 8], [0, 8, 10], [0, 3, 8]], [0, 8]);
        backbeat(c);
        if (c.verse) cymbal(c, "chh", 2);
        else { cymbal(c, "ride", 2); c.put("crash", 0, 2); }
        if (c.rnd(0.4)) c.perBar(o => c.put("snare", o + 14, 1));
      },
    },
    {
      id: "hardrock", label: "Hard rock", ref: "Guns N' Roses, Aerosmith, Van Halen, Kiss", bpm: [108, 150],
      fills: ["down", "toms", "unison"],
      variants: [
        { id: "driving", label: "", w: 3, must: { kick: [0, 8], snare: [4, 12] } },
        { id: "double", label: "doppia cassa", w: 2, must: { kick: [0, 2, 8, 10], snare: [4, 12] } },
      ],
      gen(c) {
        if (c.variant === "double") hits(c, "kick", [0, 2, 8, 10], [0, 8]);
        else cells(c, "kick", [[0, 8], [0, 6, 8], [0, 8, 11]], [0, 8]);
        backbeat(c);
        if (c.verse) cymbal(c, "chh", 2);
        else { cymbal(c, "ohh", 4); cymbal(c, "chh", 2); c.put("crash", 0, 2); c.note = "open hats"; }
        ghosts(c, "snare", [7, 15], 0, 1);
      },
    },
    {
      // Lentissimo: a 60 bpm ogni colpo pesa. Il vuoto tra i colpi e' parte del suono.
      id: "doom", label: "Stoner / doom", ref: "Black Sabbath, Sleep, Electric Wizard, Kyuss", bpm: [50, 80],
      fills: ["toms", "down"],
      variants: [
        { id: "doom", label: "doom", w: 3, must: { kick: [0], snare: [8] } },
        { id: "stoner", label: "stoner", w: 3, must: { kick: [0, 8], snare: [4, 12] } },
      ],
      gen(c) {
        if (c.variant === "stoner") {
          cells(c, "kick", [[0, 8], [0, 6, 8], [0, 8, 10]], [0, 8]);
          backbeat(c);
          cymbal(c, "ride", 4);
        } else {
          cells(c, "kick", [[0, 6], [0, 3, 6], [0, 10]], [0], 0.5);
          c.perBar(o => c.put("snare", o + 8, 2));
          cymbal(c, c.pick(["china", "ride"]), 4);
        }
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
    {
      id: "thrash", label: "Thrash metal", ref: "Slayer, Metallica, Anthrax, Kreator", bpm: [180, 235],
      fills: ["roll", "unison", "down"],
      variants: [
        { id: "gallop", label: "galoppo", w: 4, must: { kick: [0, 2, 3, 8], snare: [4, 12] } },
        { id: "double", label: "doppia cassa", w: 2, must: { kick: [0, 2, 4, 6], snare: [4, 12] } },
        { id: "skank", label: "thrash beat", w: 2, must: { kick: [0, 4, 8, 12], snare: [2, 6, 10, 14] } },
      ],
      gen(c) {
        if (c.variant === "double") {
          c.each(0, 2, i => c.put("kick", i, i % 8 === 0 ? 2 : 1));
          backbeat(c);
        } else if (c.variant === "skank") {
          c.each(0, 4, i => c.put("kick", i, i % 16 === 0 ? 2 : 1));
          c.each(2, 4, i => c.put("snare", i, 2));
        } else {
          hits(c, "kick", [0, 2, 3, 8, 10, 11], [0, 8]);
          backbeat(c);
        }
        if (c.verse) cymbal(c, c.pick(["chh", "ride"]), 2);
        else { cymbal(c, "ride", 2); c.put("crash", 0, 2); }
      },
    },
    {
      id: "deathmetal", label: "Death metal", ref: "Cannibal Corpse, Morbid Angel, Death, Obituary", bpm: [180, 240],
      fills: ["roll", "unison"],
      variants: [
        { id: "blast", label: "blast", w: 3, must: { kick: [0, 2, 4], snare: [1, 3] } },
        { id: "gravity", label: "gravity blast", w: 2, must: { kick: [0, 2, 4], snare: [0, 2, 4] } },
        { id: "double", label: "doppia cassa", w: 3, must: { kick: [0, 1, 2, 3], snare: [4, 12] } },
      ],
      gen(c) {
        if (c.variant === "blast") blast(c);
        else if (c.variant === "gravity") c.each(0, 2, i => { c.put("kick", i, i % 8 === 0 ? 2 : 1); c.put("snare", i, 1); });
        else { c.each(0, 1, i => c.put("kick", i, i % 4 === 0 ? 2 : 1)); backbeat(c); }
        if (c.verse) cymbal(c, c.pick(["chh", "china"]), 2);
        else { cymbal(c, "china", 4); c.put("crash", 0, 2); }
      },
    },
    {
      id: "blackmetal", label: "Black metal", ref: "Mayhem, Darkthrone, Burzum, Immortal", bpm: [170, 240],
      fills: ["roll", "unison"],
      variants: [
        { id: "blast", label: "blast", w: 4, must: { kick: [0, 2, 4], snare: [1, 3] } },
        { id: "mid", label: "tempo medio", w: 2, must: { kick: [0, 8], snare: [4, 12] } },
      ],
      gen(c) {
        if (c.variant === "mid") {
          cells(c, "kick", [[0, 8], [0, 8, 10], [0, 6, 8]], [0, 8]);
          backbeat(c);
          cymbal(c, "ride", 2);
        } else {
          blast(c);
          cymbal(c, c.pick(["ride", "crash"]), 4);
        }
        if (c.chorus) c.put("china", 0, 2);
      },
    },
    {
      id: "groovemetal", label: "Groove metal / metalcore", ref: "Pantera, Lamb of God, Machine Head, Gojira", bpm: [90, 140],
      fills: ["toms", "down", "unison"],
      variants: [
        { id: "groove", label: "", w: 3, must: { kick: [0], snare: [4, 12] } },
        { id: "breakdown", label: "breakdown", w: 2, must: { kick: [0], snare: [8] } },
      ],
      gen(c) {
        if (c.variant === "breakdown") {
          cells(c, "kick", [[0, 3, 6, 10], [0, 2, 3, 6, 10], [0, 6, 7, 10]], [0], 0.5);
          c.perBar(o => c.put("snare", o + 8, 2));
          c.each(0, 4, i => c.put("china", i, i % 8 === 0 ? 2 : 1));
        } else {
          cells(c, "kick", [[0, 3, 6, 10], [0, 3, 10, 11], [0, 6, 7, 10, 14]], [0]);
          backbeat(c);
          if (c.verse) cymbal(c, "chh", 2); else { cymbal(c, "china", 4); c.put("crash", 0, 2); }
        }
        if (c.rnd(0.4)) c.perBar(o => openHat(c, o + 14));
      },
    },
  ]);
})(typeof SPEngine !== "undefined" ? SPEngine : require("./core.js"));
