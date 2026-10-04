// Illustrazioni stilizzate delle drum machine (SVG disegnati, niente foto): le usano la pagina
// "The machines" (macchine.html) e la sezione Drum Machine del sito (index.html).
//   PMMachineArt.svg(id)  -> stringa <svg> della macchina, o "" se non c'e'
//   PMMachineArt.machines -> {id: {name, short, maker, year, look}}
// look: colori di scocca, pannello, legno laterale, tasti; numero di manopole, cursori e tasti; LCD.
(function(){
  "use strict";
  const MACHINES={
    cr78:{name:"Roland CR-78", short:"CR-78", maker:"Roland", year:1978,
      look:{body:"#d9d2bf", panel:"#e8e2d0", wood:"#7a4a26", keys:["#c86a2a","#e8e2d0","#3a3833"], knobs:6, lcd:null, faders:0, steps:6, text:"#3a3833"}},
    tr808:{name:"Roland TR-808", short:"TR-808", maker:"Roland", year:1980,
      look:{body:"#2a2927", panel:"#3a3835", wood:null, keys:["#d6402a","#e8672a","#f0a23a","#f1ead6"], knobs:10, lcd:null, faders:0, steps:16, text:"#e8672a"}},
    tr606:{name:"Roland TR-606 Drumatix", short:"TR-606", maker:"Roland", year:1981,
      look:{body:"#b9bbbe", panel:"#2a2a2d", wood:null, keys:["#e8e6e0","#e8e6e0","#d6402a"], knobs:8, lcd:null, faders:0, steps:16, text:"#e8e6e0"}},
    cr8000:{name:"Roland CR-8000", short:"CR-8000", maker:"Roland", year:1981,
      look:{body:"#2c2b29", panel:"#3a3936", wood:null, keys:["#e8a33a","#e8e2d0","#e8e2d0"], knobs:8, lcd:null, faders:0, steps:12, text:"#e8a33a"}},
    dmx:{name:"Oberheim DMX", short:"DMX", maker:"Oberheim", year:1981,
      look:{body:"#1e1e20", panel:"#2a2a2d", wood:null, keys:["#d9d6cc"], knobs:0, lcd:null, faders:12, steps:10, text:"#d9d6cc"}},
    sdsv:{name:"Simmons SDS-V", short:"SDS-V", maker:"Simmons", year:1981,
      look:{body:"#1b1b1d", panel:"#262629", wood:null, keys:["#c8302a"], knobs:10, lcd:null, faders:0, steps:5, text:"#c8302a"}},
    linn:{name:"Linn LinnDrum", short:"LinnDrum", maker:"Linn Electronics", year:1982,
      look:{body:"#1f1f22", panel:"#2c2c30", wood:"#6b4226", keys:["#e9e5da","#e9e5da","#c83a2a"], knobs:0, lcd:null, faders:15, steps:8, text:"#e9e5da"}},
    tr909:{name:"Roland TR-909", short:"TR-909", maker:"Roland", year:1983,
      look:{body:"#c9c7c0", panel:"#d8d6cf", wood:null, keys:["#d6402a","#f1ead6","#f1ead6","#3a3833"], knobs:14, lcd:null, faders:0, steps:16, text:"#2a2927"}},
    drumulator:{name:"E-mu Drumulator", short:"Drumulator", maker:"E-mu Systems", year:1983,
      look:{body:"#2d2f33", panel:"#3a3d42", wood:null, keys:["#3a6ea5","#d8d6cf"], knobs:0, lcd:"#e0432a", faders:0, steps:16, text:"#d8d6cf"}},
    drumtraks:{name:"Sequential DrumTraks", short:"DrumTraks", maker:"Sequential Circuits", year:1984,
      look:{body:"#1f1f22", panel:"#2c2c30", wood:"#6b4226", keys:["#d8d6cf"], knobs:0, lcd:"#e0432a", faders:0, steps:13, text:"#d8d6cf"}},
    tr707:{name:"Roland TR-707", short:"TR-707", maker:"Roland", year:1985,
      look:{body:"#3b3c40", panel:"#4a4b50", wood:null, keys:["#e46a2a","#e46a2a","#d8d6cf","#d8d6cf"], knobs:3, lcd:"#9fb89a", faders:0, steps:16, text:"#e46a2a"}},
    tr727:{name:"Roland TR-727", short:"TR-727", maker:"Roland", year:1985,
      look:{body:"#3b3c40", panel:"#4a4b50", wood:null, keys:["#3aa0a0","#3aa0a0","#d8d6cf","#d8d6cf"], knobs:3, lcd:"#9fb89a", faders:0, steps:16, text:"#3aa0a0"}},
    rx5:{name:"Yamaha RX5", short:"RX5", maker:"Yamaha", year:1986,
      look:{body:"#2e3033", panel:"#3a3d41", wood:null, keys:["#d8d6cf"], knobs:0, lcd:"#e0432a", faders:0, steps:12, text:"#d8d6cf"}},
    sp1200:{name:"E-mu SP-1200", short:"SP-1200", maker:"E-mu Systems", year:1987,
      look:{body:"#8f9194", panel:"#a3a5a8", wood:null, keys:["#d8d6cf"], knobs:0, lcd:"#5b7fb8", faders:8, steps:8, text:"#1f2a44"}},
    logicVintageArcade:{name:"Logic Pro Vintage Arcade", short:"Vintage Arcade", maker:"Apple", year:"Logic Pro",
      look:{body:"#3a3b42", panel:"#50525b", wood:null, keys:["#e0743f","#d8d6cf","#6e91b8"], knobs:4, lcd:"#c8471f", faders:0, steps:12, text:"#f0eee7"}},
  };
  function machineSvg(m){
    const L=m.look, W=320, H=150, x0=L.wood?16:0, w=W-2*x0, g=`g-${m.id}`;
    let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${m.name}, stylized illustration">`+
      `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient></defs>`;
    if(L.wood) s+=`<rect width="${W}" height="${H}" rx="6" fill="${L.wood}"/>`;
    s+=`<rect x="${x0}" width="${w}" height="${H}" rx="${L.wood?2:6}" fill="${L.body}"/>`+
       `<rect x="${x0+8}" y="8" width="${w-16}" height="${H-16}" rx="3" fill="${L.panel}"/>`+
       `<text x="${x0+16}" y="31" font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="17" fill="${L.text}">${m.short}</text>`+
       `<text x="${x0+16}" y="44" font-family="Helvetica,Arial,sans-serif" font-size="8" letter-spacing="1.5" fill="${L.text}" opacity=".75">${m.maker.toUpperCase()} · ${m.year}</text>`;
    // manopole: una o due file nella parte alta a destra
    const kn=L.knobs, perRow=Math.ceil(kn/(kn>7?2:1)), kxs=x0+130, kw=w-146;
    for(let i=0;i<kn;i++){
      const r=Math.floor(i/perRow), k=i%perRow, cx=kxs+(k+.5)*kw/perRow, cy=kn>7?(26+r*26):34;
      s+=`<circle cx="${cx}" cy="${cy}" r="7" fill="#1b1b1b"/><circle cx="${cx}" cy="${cy-3}" r="1.6" fill="#ddd"/>`;
    }
    if(L.lcd) s+=`<rect x="${x0+w-118}" y="18" width="92" height="28" rx="2" fill="#111"/><rect x="${x0+w-113}" y="23" width="82" height="18" rx="1" fill="${L.lcd}" opacity=".9"/>`;
    // cursori
    for(let i=0;i<L.faders;i++){
      const fx=x0+22+i*((w-44)/L.faders)+((w-44)/L.faders)/2;
      s+=`<rect x="${fx-1.5}" y="58" width="3" height="40" fill="#111"/><rect x="${fx-6}" y="${64+(i*13)%26}" width="12" height="8" rx="1" fill="#e6e3da"/>`;
    }
    // tasti in basso
    const n=L.steps, gap=4, bw=(w-36-(n-1)*gap)/n, by=L.faders?108:96, bh=L.faders?24:34;
    for(let i=0;i<n;i++){
      const col=L.keys[Math.min(L.keys.length-1,Math.floor(i*L.keys.length/n))];
      s+=`<rect x="${x0+18+i*(bw+gap)}" y="${by}" width="${bw}" height="${bh}" rx="2" fill="${col}" stroke="rgba(0,0,0,.35)"/>`;
    }
    if(!L.faders) s+=`<rect x="${x0+18}" y="62" width="${w-36}" height="22" rx="2" fill="rgba(0,0,0,.1)"/>`;
    s+=`<rect x="${x0}" width="${w}" height="${H}" rx="${L.wood?2:6}" fill="url(#${g})"/></svg>`;
    return s;
  }
  function svg(id){ const m=MACHINES[id]; return m ? machineSvg({id, ...m}) : ""; }
  window.PMMachineArt={machines:MACHINES, svg};
})();
