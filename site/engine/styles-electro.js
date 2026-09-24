// Schede: electro, techno, gabber, footwork. Formato dei campi in styles-punk.js.
(function (E) {
  const { euclid, hits, cells, backbeat, cymbal, openHat } = E.h;
  E.defineGroup({ id: "electro", label: "Elettronica / Club" });

  E.defineStyles("electro", [
    {
      id: "electro", label: "Electro", ref: "Kraftwerk, Man Parrish, Afrika Bambaataa, Egyptian Lover, Drexciya", bpm: [108, 130],
      fills: ["claps", "hats"], must: { kick: [0], clap: [4, 12] },
      gen(c) {
        cells(c, "kick", [[0, 7, 10], [0, 3, 10, 14], [0, 6, 10], [0, 7, 11]], [0], 0.6);
        c.backbeats.forEach(i => c.put("clap", i, 2));
        backbeat(c, "snare", [4, 12]);
        cymbal(c, "chh", 2);
        if (c.rnd(0.6)) euclid(c.pick([3, 5]), c.len, c.pick([1, 2])).forEach((v, i) => { if (v) c.put("cow", i, 1); });
        if (c.chorus) { c.perBar(o => openHat(c, o + 14)); c.note = "hat aperto"; }
      },
    },
    {
      id: "techno", label: "Techno", ref: "Jeff Mills, Robert Hood, Surgeon, Regis, Detroit techno", bpm: [125, 140],
      fills: ["claps", "hats"],
      variants: [
        { id: "std", label: "", w: 3, must: { kick: [0, 4, 8, 12], ohh: [2, 6, 10, 14] } },
        { id: "minimal", label: "minimale", w: 2, must: { kick: [0, 4, 8, 12], ohh: [2, 6, 10, 14] } },
      ],
      gen(c) {
        c.each(0, 4, i => c.put("kick", i, i % 16 === 0 ? 2 : 1));
        c.each(2, 4, i => c.put("ohh", i, 1));
        if (c.variant === "minimal") {
          c.perBar(o => c.put("rim", o + c.pick([6, 11, 14]), 1));
          if (c.rnd(0.5)) c.each(1, 4, i => c.put("chh", i, 1));
        } else {
          c.backbeats.forEach(i => c.put("clap", i, 1));
          c.each(1, 2, i => { if (c.rnd(0.6)) c.put("chh", i, 1); });
        }
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
    {
      id: "gabber", label: "Gabber / hardcore techno", ref: "Rotterdam Terror Corps, Neophyte, Angerfist, Paul Elstak", bpm: [170, 200],
      fills: ["roll", "unison", "claps"],
      variants: [
        { id: "std", label: "", w: 3, must: { kick: [0, 4, 8, 12], clap: [4, 12] } },
        { id: "roll", label: "con rullata", w: 2, must: { kick: [0, 4, 8, 12], clap: [4, 12] } },
      ],
      gen(c) {
        c.each(0, 4, i => c.put("kick", i, 2));
        c.backbeats.forEach(i => c.put("clap", i, 1));
        c.each(2, 4, i => c.put("ohh", i, 1));
        if (c.variant === "roll") c.perBar(o => { c.put("snare", o + 14, 1); c.put("snare", o + 15, 1); });
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
    {
      // Il 3-3-2 (tresillo) due volte per battuta: il ritmo si sente "storto" rispetto al battere.
      id: "footwork", label: "Footwork / juke", ref: "DJ Rashad, DJ Spinn, RP Boo, Traxman", bpm: [155, 165],
      fills: ["claps", "roll"], must: { kick: [0, 3, 6, 8, 11, 14], clap: [4, 12] },
      gen(c) {
        hits(c, "kick", [0, 3, 6, 8, 11, 14], [0, 8]);
        c.backbeats.forEach(i => c.put("clap", i, 2));
        c.each(0, 2, i => c.put("chh", i, 1));
        euclid(c.pick([5, 7, 9]), c.len, c.pick([0, 1, 2])).forEach((v, i) => { if (v) c.put("rim", i, 1); });
        if (c.chorus) c.put("crash", 0, 2);
      },
    },
  ]);
})(typeof SPEngine !== "undefined" ? SPEngine : require("./core.js"));
