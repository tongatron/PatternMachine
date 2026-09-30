// Risoluzione della griglia e groove. Le vecchie griglie 16/32 restano identiche:
// questo modulo aggiunge solo una metrica esplicita per triplette e 6/8.
(function(root){
  "use strict";
  const GROOVES={
    straight:{label:"Straight", swing:0, offsets:[]},
    mpc:{label:"MPC swing", swing:.16, offsets:[]},
    shuffle:{label:"Shuffle", swing:.33, offsets:[]},
    laidback:{label:"Laid back", swing:0, offsets:[0,7,0,5,0,8,0,5]},
    pushed:{label:"Pushed", swing:0, offsets:[-5,0,-4,0,-5,0,-4,0]},
    dilla:{label:"Dilla pocket", swing:.08, offsets:[0,10,-2,7,0,12,-3,8]},
  };
  const normalize=r=>{
    r=r&&typeof r==="object"?r:{};
    const meter=r.meter==="6/8"?"6/8":"4/4", resolution=r.resolution==="triplet"?"triplet":"straight";
    const groove=GROOVES[r.groove]?r.groove:"straight";
    return {meter,resolution,groove};
  };
  const stepsPerBar=r=>{
    r=normalize(r);
    if(r.meter==="6/8") return r.resolution==="triplet"?18:12;
    return r.resolution==="triplet"?12:16;
  };
  const barQuarters=r=>normalize(r).meter==="6/8"?1.5:4;
  const beatsPerBar=r=>normalize(r).meter==="6/8"?6:4;
  const secondsPerStep=(bpm,r)=>60/Math.max(1,bpm)*barQuarters(r)/stepsPerBar(r);
  function timing(bpm,rhythm,swing,step){
    const r=normalize(rhythm), groove=GROOVES[r.groove], base=secondsPerStep(bpm,r);
    const triplet=r.resolution==="triplet";
    // Il cursore resta utilizzabile anche con Straight; un template puo' aggiungere
    // una soglia minima (MPC/Shuffle) senza impedire una regolazione manuale.
    const amount=triplet?0:Math.max(groove.swing,Math.min(.5,(+swing||0)/100*0.5));
    const pair=(step%2===0?1+amount:1-amount);
    const offsets=groove.offsets;
    const offset=(offsets.length?offsets[step%offsets.length]:0)/1000;
    return {dur:base*pair,offset};
  }
  const stepsForBars=(bars,r)=>Math.max(1,Math.round(bars*stepsPerBar(r)));
  const patternBars=(len,r)=>len/stepsPerBar(r);
  const timeSignature=r=>normalize(r).meter==="6/8"?[6,3]:[4,2];
  root.PMRhythm={GROOVES,normalize,stepsPerBar,barQuarters,beatsPerBar,secondsPerStep,timing,stepsForBars,patternBars,timeSignature};
})(typeof self!=="undefined"?self:globalThis);
