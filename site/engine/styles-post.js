// Schede: post-punk e new wave ('78-'84). Formato dei campi in styles-punk.js.
(function (E) {
  const { cells, hits, backbeat, cymbal, ghosts, euclid, euclidBars, openHat } = E.h;
  E.defineGroup({ id: "post", label: "Post-punk / New wave" });
  E.defineStyles("post", [
    {
      id: "postpunk", label: "Post-punk tribale", ref: "Siouxsie (Budgie), Killing Joke, Bauhaus", bpm: [118, 145],
      fills: ["toms", "down"], must: { kick: [0] },
      gen(c) {
        euclidBars(c, "tom2", c.pick([7, 9]), c.pick([0, 2, 3]));
        const hi = euclid(c.pick([3, 5]), 16, c.pick([1, 5, 6]));
        c.perBar(o => hi.forEach((v, s) => { if (v && !c.get("tom2", o + s)) c.put("tom", o + s, 1); }));
        c.each(0, c.rnd(0.5) ? 4 : 8, i => c.put("kick", i, i % 16 === 0 ? 2 : 1));
        if (c.verse) c.perBar(o => c.put("rim", o + 12, 2));
        else { backbeat(c, "snare3"); cymbal(c, "tamb", 2); c.put("crash", 0, 2); }
        if (c.rnd(0.5)) euclidBars(c, "chh", c.pick([5, 7]), c.pick([2, 3]), false);
      },
    },
    {
      // Stephen Morris: rullante secco e preciso, hi-hat a 16esimi o tom che spingono.
      id: "morris", label: "Cold drums", ref: "Joy Division, primi New Order, The Chameleons", bpm: [122, 150],
      fills: ["toms", "down"], must: { kick: [0], snare3: [4] },
      variants: [
        { id: "sixteen", label: "hi-hat a 16esimi", w: 4 },
        { id: "toms", label: "tom drive", w: 3 },
        { id: "syndrum", label: "syndrum", w: 2 },
      ],
      gen(c) {
        if (c.variant === "toms") {
          c.each(0, 2, i => c.put("tom2", i, i % 4 === 0 ? 2 : 1));
          hits(c, "tom", [6, 14]);
          hits(c, "kick", [0, 8], [0, 8]);
          backbeat(c, "snare3");
          if (c.chorus) { cymbal(c, "ride", 2); c.put("crash", 0, 2); }
          return;
        }
        if (c.variant === "syndrum") {
          c.each(0, 4, i => c.put("kick", i, 2));
          backbeat(c, "snare3"); backbeat(c, "clap");
          c.each(0, 1, i => c.put("chh", i, i % 4 === 0 ? 2 : 1));
          c.perBar(o => openHat(c, o + 14));
          if (c.chorus) { c.perBar(o => { c.put("tom", o + 11, 1); c.put("tom2", o + 15, 2); }); c.put("crash", 0, 2); }
          return;
        }
        cells(c, "kick", [[0, 8], [0, 8, 10], [0, 7, 8], [0, 3, 8]]);
        backbeat(c, "snare3");
        if (c.verse) c.each(0, 1, i => c.put("chh", i, i % 4 === 0 ? 2 : 1));
        else { cymbal(c, "ride", 2); c.put("crash", 0, 2); }
        if (c.rnd(0.6)) c.perBar((o, b) => { if (b === c.bars - 1) { c.put("tom", o + 14, 1); c.put("tom2", o + 15, 2); } });
      },
    },
    {
      // Strofe dub, ritornelli punk: nel ritornello entra il rullante sul 2 e sul 4.
      id: "dubpunk", label: "Dub-punk", ref: "Public Image Ltd, The Ruts, The Slits", bpm: [100, 128], swing: [0, 10],
      fills: ["toms", "down"],
      variants: [
        { id: "steppers", label: "steppers", w: 3, must: { kick: [0, 4, 8], rim: [8] } },
        { id: "onedrop", label: "one drop", w: 3, sections: ["verse"], must: { kick: [8], rim: [8] } },
        { id: "rockers", label: "rockers", w: 2, must: { kick: [0, 8], rim: [8] } },
      ],
      gen(c) {
        if (c.variant === "steppers") {
          c.each(0, 4, i => c.put("kick", i, 2));
          c.perBar(o => c.put("rim", o + 8, 2));
          c.each(0, 2, i => c.put("chh", i, i % 4 === 2 ? 2 : 1));
          if (c.rnd(0.6)) c.perBar(o => openHat(c, o + 14));
        } else if (c.variant === "onedrop") {
          c.perBar(o => { c.put("kick", o + 8, 2); c.put("rim", o + 8, 2); });
          c.each(0, 2, i => c.put("chh", i, i % 4 === 2 ? 2 : 1));
          if (c.rnd(0.5)) c.perBar(o => openHat(c, o + 6));
          if (c.rnd(0.5)) { c.put("tom", c.len - 3, 1); c.put("tom2", c.len - 1, 2); }
        } else {
          hits(c, "kick", [0, 8], [0, 8]);
          if (c.rnd(0.5)) c.perBar(o => c.put("kick", o + 10, 1));
          c.perBar(o => c.put("rim", o + 8, 2));
          c.each(0, 1, i => { if (i % 4 !== 1) c.put("chh", i, i % 4 === 2 ? 2 : 1); });
        }
        if (c.chorus) { backbeat(c); c.put("crash", 0, 2); }
      },
    },
    {
      // Ripetitivo per scelta: nessuna risposta tra le battute.
      id: "fallbeat", label: "Fall beat", ref: "The Fall, Swell Maps, Television Personalities", bpm: [138, 172],
      fills: ["roll", "unison"],
      variants: [
        { id: "garage", label: "garage", w: 3, must: { kick: [0, 8], snare: [4] } },
        { id: "train", label: "train beat", w: 2, must: { kick: [0, 8], snare: [4] } },
        { id: "double", label: "due batterie", w: 2, must: { kick: [0, 4, 8], snare: [4], tom2: [0] } },
      ],
      gen(c) {
        if (c.variant === "train") {
          hits(c, "kick", [0, 8], [0, 8]);
          c.each(0, 1, i => { if (i % 4 !== 1) c.put("snare", i, (i % 16 === 4 || i % 16 === 12) ? 2 : 1); });
          if (c.chorus) c.each(0, 8, i => c.put("crash", i, i % 16 === 0 ? 2 : 1));
        } else if (c.variant === "double") {
          c.each(0, 4, i => c.put("kick", i, 2));
          backbeat(c);
          c.each(0, 2, i => c.put("tom2", i, i % 4 === 0 ? 2 : 1));
          hits(c, "snare2", [6, 14]);
          c.each(0, 2, i => c.put("tamb", i, 1));
          if (c.chorus) c.put("crash", 0, 2);
        } else {
          hits(c, "kick", [0, 8, 10], [0, 8]);
          backbeat(c);
          c.each(0, 2, i => c.put(c.verse ? "tom2" : "ride", i, i % 4 === 0 ? 2 : 1));
          if (c.chorus) c.put("crash", 0, 2);
        }
      },
    },
    {
      // Minimalismo alla Pink Flag: ottavi senza accenti, e il vuoto come parte del pezzo.
      id: "wire", label: "Minimale", ref: "Wire, Mission of Burma, The Feelies", bpm: [132, 176],
      fills: ["roll", "unison"], must: { kick: [0], snare: [4] },
      variants: [
        { id: "straight", label: "", w: 4 },
        { id: "stop", label: "stop", w: 2 },
        { id: "feelies", label: "tom e 16esimi", w: 2 },
      ],
      gen(c) {
        hits(c, "kick", [0, 8], [0, 8]);
        backbeat(c);
        if (c.variant === "feelies") {
          c.each(0, 4, i => c.put("tom2", i, 1));
          c.each(0, 1, i => c.put("chh", i, 1));
        } else c.each(0, 2, i => c.put(c.chorus ? "ride" : "chh", i, 1));
        if (c.variant === "stop") {
          const s = c.len - 8;
          ["chh", "ride", "kick", "snare"].forEach(r => { if (c.R[r]) for (let i = s + 1; i < c.len; i++) c.R[r][i] = 0; });
          c.put("snare", s, 2); c.put("kick", s, 2);
        }
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
    {
      id: "funkpunk", label: "Funk-punk", ref: "The Pop Group, Au Pairs, A Certain Ratio, Bush Tetras", bpm: [104, 126],
      swing: [0, 6], fills: ["roll", "toms"], must: { kick: [0], snare: [4, 12] },
      variants: [
        { id: "tight", label: "", w: 3 },
        { id: "perc", label: "percussioni", w: 2 },
        { id: "dirty", label: "sporco", w: 2 },
      ],
      gen(c) {
        cells(c, "kick", [[0, 3, 6, 10], [0, 3, 10, 11], [0, 6, 7, 10, 14], [0, 2, 7, 10]]);
        backbeat(c);
        ghosts(c, "snare", [2, 7, 9, 14, 15], 1, 3);
        c.each(0, 1, i => c.put("chh", i, i % 4 === 2 ? 2 : 1));
        const open = c.pick([6, 14]);
        c.perBar(o => openHat(c, o + open));
        if (c.variant === "perc") { euclidBars(c, "conga", c.pick([5, 7]), c.pick([1, 3]), false); hits(c, "cow", [0, 6, 10], [0]); }
        if (c.variant === "dirty") euclidBars(c, "china", 3, c.pick([2, 5]), false);
        if (c.chorus) { c.put("crash", 0, 2); c.each(2, 4, i => openHat(c, i)); }
      },
    },
    {
      id: "afro", label: "Afro-post-punk", ref: "Talking Heads (Remain in Light), Pere Ubu, ESG", bpm: [104, 122],
      fills: ["congas", "toms"], must: { kick: [0], snare3: [12] },
      variants: [
        { id: "bell", label: "campana", w: 3, must: { cow: [0, 3, 6] } },
        { id: "three", label: "3 contro 4", w: 2, must: { perc: [0, 3, 6, 9] } },
      ],
      gen(c) {
        cells(c, "kick", [[0, 6, 10], [0, 3, 8, 11], [0, 7, 10]], [0], 0.3);
        c.perBar(o => c.put("snare3", o + 12, 2));
        if (c.rnd(0.5)) c.perBar(o => c.put("snare3", o + 4, 1));
        if (c.variant === "three") {
          for (let i = 0; i < c.len; i += 3) c.put("perc", i, i % 16 === 0 ? 2 : 1);
          euclidBars(c, "conga", 5, c.pick([2, 3]));
        } else {
          hits(c, "cow", [0, 3, 6, 8, 10, 13], [0]);
          euclidBars(c, "conga", 7, c.pick([1, 2]), false);
        }
        c.each(0, 1, i => c.put("shaker", i, i % 4 === 0 ? 2 : 1));
        if (c.chorus) { c.each(0, 2, i => c.put("chh", i, i % 4 === 0 ? 2 : 1)); c.put("crash", 0, 2); }
      },
    },
    {
      id: "motorik", label: "Motorik", ref: "Neu!, Can, Wire, Stereolab", bpm: [126, 152],
      fills: ["roll", "down"], must: { kick: [0, 8, 10], snare: [4] },
      gen(c) {
        hits(c, "kick", [0, 8, 10], [0, 8]);
        backbeat(c);
        cymbal(c, "chh", 2);
        if (c.chorus) { c.each(1, 2, i => c.put("tamb", i, 1)); c.put("crash", 0, 2); }
      },
    },
    {
      id: "newwave", label: "New wave", ref: "Blondie, The Cure, Talking Heads, Devo", bpm: [136, 162],
      fills: ["roll", "down", "unison"], must: { kick: [0], snare: [4] },
      variants: [
        { id: "rock", label: "", w: 1 },
        { id: "disco", label: "disco", w: 1, sections: ["chorus"], must: { kick: [0, 4, 8] } },
      ],
      gen(c) {
        if (c.variant === "disco") c.each(0, 4, i => c.put("kick", i, 2));
        else cells(c, "kick", [[0, 6, 8], [0, 8, 10], [0, 6, 8, 14], [0, 8]]);
        backbeat(c);
        if (c.verse) cymbal(c, "chh", 2);
        else { c.each(0, 1, i => c.put("chh", i, i % 4 === 0 ? 2 : 1)); c.each(2, 4, i => openHat(c, i)); }
      },
    },
    {
      id: "dancepunk", label: "Dance-punk", ref: "Gang of Four, ESG, Liquid Liquid, The Rapture", bpm: [110, 128],
      fills: ["toms", "roll"], must: { kick: [0, 4, 8], snare: [4] },
      gen(c) {
        c.each(0, 4, i => c.put("kick", i, 2));
        backbeat(c);
        c.each(2, 4, i => c.put("ohh", i, c.chorus ? 2 : 1));
        if (c.chorus) c.each(1, 2, i => c.put("chh", i, 1));
        if (c.rnd(0.75)) hits(c, "cow", c.pick([[0, 3, 6, 10, 12], [0, 3, 8, 11], [2, 6, 7, 10, 14]]), [0]);
        if (c.rnd(0.4)) hits(c, "tom", [c.pick([7, 11, 15])]);
      },
    },
  ]);
})(typeof SPEngine !== "undefined" ? SPEngine : require("./core.js"));
