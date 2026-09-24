// Schede: reggae, ska e dub. Formato dei campi in styles-punk.js.
// Il "feel" (rim e cassa un po' in ritardo) da' il passo rilassato. Lo swing del sito sposta solo i
// sedicesimi dispari, quindi qui non c'e' un vero terzinato ne' un 6/8: servirebbe una griglia a 12 step.
(function (E) {
  const { euclid, hits, cells, backbeat, cymbal, openHat } = E.h;
  E.defineGroup({ id: "dub", label: "Reggae / Dub" });

  // Levare di hi-hat con accento sull'ottavo in levare (2, 6, 10, 14).
  const skankHat = (c, from = 0, step = 2) => c.each(from, step, i => c.put("chh", i, i % 4 === 2 ? 2 : 1));

  E.defineStyles("dub", [
    {
      id: "onedrop", label: "One drop", ref: "Bob Marley & The Wailers, Burning Spear, Steel Pulse", bpm: [68, 84], swing: [4, 14],
      fills: ["toms", "down"], feel: { rim: 12, kick: 6 },
      variants: [
        { id: "classic", label: "", w: 4, must: { kick: [8], rim: [8] } },
        { id: "lovers", label: "lovers rock", w: 2, must: { kick: [0, 8], rim: [8] } },
        { id: "ghost", label: "rim fantasma", w: 2, must: { kick: [8], rim: [8] } },
      ],
      gen(c) {
        c.perBar(o => { c.put("kick", o + 8, 2); c.put("rim", o + 8, 2); });
        if (c.variant === "lovers") { c.perBar(o => c.put("kick", o, 1)); c.each(0, 1, i => c.put("chh", i, i % 4 === 2 ? 2 : 1)); }
        else skankHat(c);
        if (c.variant === "ghost") c.perBar(o => { c.put("rim", o + 14, 1); if (c.rnd(0.5)) c.put("rim", o + 11, 1); });
        if (c.rnd(0.5)) c.perBar(o => openHat(c, o + 14));
        if (c.chorus) { c.perBar(o => openHat(c, o + 6)); c.note = "hat aperti"; }
      },
    },
    {
      id: "rockers", label: "Rockers", ref: "Sly & Robbie, Revolutionaries, Lee Perry (Upsetters)", bpm: [72, 90], swing: [4, 14],
      fills: ["toms", "down"], feel: { rim: 10, kick: 4 },
      variants: [
        { id: "std", label: "", w: 3, must: { kick: [0, 8], rim: [8] } },
        { id: "flying", label: "flying cymbals", w: 2, must: { kick: [0, 8], rim: [8] } },
        { id: "sixteen", label: "hat a sedicesimi", w: 2, must: { kick: [0, 8], rim: [8] } },
      ],
      gen(c) {
        hits(c, "kick", [0, 8], [0, 8]);
        if (c.rnd(0.5)) c.perBar(o => c.put("kick", o + 10, 1));
        c.perBar(o => c.put("rim", o + 8, 2));
        if (c.variant === "flying") { c.each(2, 4, i => c.put("ohh", i, i % 8 === 6 ? 2 : 1)); c.each(0, 4, i => c.put("chh", i, 1)); }
        else if (c.variant === "sixteen") c.each(0, 1, i => { if (i % 2 === 0 || i % 4 === 3) c.put("chh", i, i % 4 === 2 ? 2 : 1); });
        else skankHat(c);
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
    {
      id: "steppers", label: "Steppers", ref: "Aswad, Mikey Dread, Jah Shaka, Sly & Robbie", bpm: [120, 148], swing: [0, 8],
      fills: ["roll", "down"], feel: { rim: 6, snare: 4 },
      variants: [
        { id: "std", label: "", w: 4, must: { kick: [0, 4, 8, 12], rim: [8] } },
        { id: "military", label: "militare", w: 2, must: { kick: [0, 4, 8, 12], rim: [8], snare: [4, 12] } },
      ],
      gen(c) {
        c.each(0, 4, i => c.put("kick", i, i % 8 === 0 ? 2 : 1));
        c.perBar(o => c.put("rim", o + 8, 2));
        if (c.variant === "military") backbeat(c, "snare", [4, 12]);
        skankHat(c);
        if (c.rnd(0.6)) c.perBar(o => openHat(c, o + 14));
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
    {
      // Il vuoto e' il suono: poche note, tanto spazio per l'eco.
      id: "dub", label: "Dub", ref: "King Tubby, Scientist, Lee Perry, Augustus Pablo", bpm: [64, 80], swing: [4, 12],
      fills: ["toms", "down"], feel: { rim: 12, kick: 6, ohh: 4 },
      variants: [
        { id: "sparse", label: "spoglio", w: 3, must: { kick: [8], rim: [8] } },
        { id: "echo", label: "eco", w: 3, must: { kick: [8], rim: [8] } },
        { id: "riddim", label: "riddim pieno", w: 2, must: { kick: [8], rim: [8] } },
      ],
      gen(c) {
        c.perBar(o => { c.put("kick", o + 8, 2); c.put("rim", o + 8, 2); });
        if (c.variant === "echo") {
          // il rim torna piu' piano, come un delay: 3 e 6 step dopo
          c.perBar(o => { c.put("rim", o + 11, 1); if (c.rnd(0.6)) c.put("rim", o + 14, 1); });
        } else if (c.variant === "riddim") {
          skankHat(c);
          if (c.rnd(0.6)) c.perBar(o => c.put("kick", o, 1));
        } else if (c.rnd(0.6)) c.perBar(o => openHat(c, o + 14));
        if (c.rnd(0.5)) { c.put("tom2", c.len - 3, 1); c.put("tom", c.len - 1, 1); }
        if (c.chorus) c.each(2, 4, i => c.put("ohh", i, 1));
      },
    },
    {
      id: "rocksteady", label: "Rocksteady", ref: "The Heptones, Alton Ellis, Toots & The Maytals, Desmond Dekker", bpm: [88, 104], swing: [0, 10],
      fills: ["roll", "down"], feel: { rim: 6, snare: 6 },
      must: { kick: [0], rim: [4, 12] },
      gen(c) {
        cells(c, "kick", [[0, 8], [0, 6, 8], [0, 8, 11]], [0, 8]);
        backbeat(c, "rim", [4, 12]);
        skankHat(c);
        if (c.rnd(0.5)) c.perBar(o => openHat(c, o + 14));
        if (c.chorus) { c.put("crash", 0, 2); c.perBar(o => c.put("snare", o + 12, 1)); }
      },
    },
    {
      id: "ska", label: "Ska / 2-tone", ref: "The Skatalites, The Specials, Madness, The Selecter", bpm: [150, 178],
      fills: ["roll", "down"], feel: { snare: 3 },
      variants: [
        { id: "twotone", label: "2-tone", w: 3, must: { kick: [0, 4, 8, 12], snare: [4, 12] } },
        { id: "train", label: "train beat", w: 2, must: { kick: [0, 8], snare: [2, 6, 10, 14] } },
      ],
      gen(c) {
        if (c.variant === "train") {
          hits(c, "kick", [0, 8], [0, 8]);
          c.each(2, 4, i => c.put("snare", i, 1));
          c.perBar(o => { c.put("snare", o + 4, 1); c.put("snare", o + 12, 1); });
          cymbal(c, "chh", 2);
        } else {
          c.each(0, 4, i => c.put("kick", i, i % 8 === 0 ? 2 : 1));
          backbeat(c);
          c.each(2, 4, i => c.put("ohh", i, 1));
          c.each(0, 4, i => c.put("chh", i, 1));
        }
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
    {
      id: "dembow", label: "Dancehall / dembow", ref: "Shabba Ranks, Daddy Yankee, Sleng Teng riddim, Sean Paul", bpm: [86, 102],
      fills: ["claps", "roll"],
      variants: [
        { id: "snare", label: "", w: 3, must: { kick: [0, 4, 8, 12], snare: [3, 6, 11, 14] } },
        { id: "clap", label: "con clap", w: 2, must: { kick: [0, 4, 8, 12], clap: [3, 6, 11, 14] } },
      ],
      gen(c) {
        const hit = c.variant === "clap" ? "clap" : "snare";
        c.each(0, 4, i => c.put("kick", i, i % 16 === 0 ? 2 : 1));
        // tresillo 3+3+2: i colpi cadono sul 4, sul 7, poi ripetono a meta' battuta
        c.perBar(o => [3, 6, 11, 14].forEach(s => c.put(hit, o + s, s === 3 || s === 11 ? 2 : 1)));
        c.each(0, 2, i => c.put("chh", i, i % 4 === 2 ? 2 : 1));
        if (c.rnd(0.4)) c.perBar(o => c.put("rim", o + 15, 1));
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
    {
      id: "dubtechno", label: "Dub techno", ref: "Basic Channel, Rhythm & Sound, Deepchord, Maurizio", bpm: [118, 126],
      fills: ["claps", "hats"],
      variants: [
        { id: "std", label: "", w: 3, must: { kick: [0, 4, 8, 12], ohh: [2, 6, 10, 14] } },
        { id: "perc", label: "percussioni", w: 2, must: { kick: [0, 4, 8, 12], ohh: [2, 6, 10, 14] } },
      ],
      gen(c) {
        c.each(0, 4, i => c.put("kick", i, i % 16 === 0 ? 2 : 1));
        c.each(2, 4, i => c.put("ohh", i, 1));
        if (c.rnd(0.6)) c.each(1, 2, i => c.put("shaker", i, 1));
        if (c.variant === "perc") euclid(c.pick([3, 5]), c.len, c.pick([1, 2, 5])).forEach((v, i) => { if (v) c.put("perc", i, 1); });
        if (c.chorus) { c.backbeats.forEach(i => c.put("clap", i, 1)); c.each(0, 4, i => c.put("chh", i, 1)); }
      },
    },
  ]);
})(typeof SPEngine !== "undefined" ? SPEngine : require("./core.js"));
