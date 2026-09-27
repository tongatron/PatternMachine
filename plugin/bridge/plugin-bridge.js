// Ponte fra il sito e il plug-in Audio Unit: lo aggiunge PluginEditor.cpp in fondo a index.html.
// Il sito non sa niente del plug-in. Qui la pagina diventa solo l'editor: la musica la suona il C++
// (plugin/Source/Engine.cpp) agganciato al trasporto di Logic, e l'audio passa dal mixer di Logic.
//
// Messaggi sull'evento "pm" (window.__JUCE__.backend):
//   pagina -> plug-in: hello, sync {engine, state}, hit {voice, vel, delay}, transport {play, start},
//                      projects {req, op, id, data}, export {req, filename, base64}, reveal {name}
//   plug-in -> pagina: init {state}, load {state}, pos {...}, reply {req, result, error}
// Funzioni del sito sostituite: trigger, play, stop, setStatus, db, downloadsCap.
// Se cambia scheduler() o trigger() nel sito, va allineato plugin/Source/Engine.cpp.
(function pmPluginBridge(){
  const B=window.__JUCE__ && window.__JUCE__.backend;
  if(!B) return;
  document.documentElement.classList.add("pm-plugin");
  const send=msg=>B.emitEvent("pm",msg);

  let reqSeq=0;
  const waiting=new Map();
  let instanceTrack=-1;
  let instanceSelect=null;
  const call=(type,payload)=>new Promise((ok,ko)=>{
    const req=++reqSeq;
    waiting.set(req,{ok,ko});
    send({type, req, ...payload});
  });

  // ---------- stato mandato al motore ----------
  // engine: solo cio' che serve per suonare (vedi Snapshot::fromVar). state: per riaprire la pagina.
  const voiceOf=t=>({output:Math.max(0,project.tracks.indexOf(t)), file:sampleFile(t.sampleIndex), vol:t.vol, tune:t.tune||0, choke:t.choke||0,
    decay:t.decay, cutoff:t.cutoff, reso:t.reso, start:t.start, reverse:!!t.reverse});
  function engineState(){
    const solo=project.tracks.some(t=>t.solo);
    return {
      mode:ui.mode, patternId:curPattern().id, soloBlockId:ui.songSoloBlockId||"",
      swing:+el("swingRange").value||0, human:+el("humanRange").value||0, master:+el("masterVol").value,
      metronome:!!ui.metronome, bpm:bpm(),
      tracks:project.tracks.map(t=>({id:t.id, ...voiceOf(t), nudge:t.nudge||0, on:!t.mute && (!solo || t.solo)})),
      patterns:project.patterns.map(p=>({id:p.id, len:p.len, grid:p.grid, mods:p.mods||{}, lens:p.lens||{}})),
      song:project.song.map(b=>({id:b.id, patternId:b.patternId, repeats:b.repeats, fillPatternId:b.fillPatternId||""})),
    };
  }
  function pluginState(){
    const d=serialize(); delete d.updatedAt;
    return {project:d, currentProjectId, master:+el("masterVol").value,
      ui:{mode:ui.mode, patternId:ui.patternId, blockId:ui.blockId, songSoloBlockId:ui.songSoloBlockId||null, metronome:!!ui.metronome}};
  }

  // Ogni modifica (griglia, blocchi, mixer, kit, canzone...) arriva al plug-in entro un decimo di secondo.
  let ready=false, lastSync="";
  function pushSync(force){
    if(!ready || !project) return;
    let engine, state;
    try{ engine=engineState(); state=pluginState(); }catch(e){ return; }
    const key=JSON.stringify([engine,state]);
    if(!force && key===lastSync) return;
    lastSync=key;
    send({type:"sync", engine, state});
  }
  setInterval(pushSync,100);

  function restore(s){
    if(!s || !s.project) return;
    try{
      if(playing) stop();
      deserialize(s.project);
      const u=s.ui||{};
      if(s.master!=null) el("masterVol").value=s.master;
      if(!!u.metronome!==!!ui.metronome) el("metronomeBtn").click();
      currentProjectId=s.currentProjectId||null;
      setView(u.mode==="song"?"seq":"grid");
      if(u.patternId && patternById(u.patternId)) ui.patternId=u.patternId;
      if(u.blockId && project.song.some(b=>b.id===u.blockId)) ui.blockId=u.blockId;
      ui.songSoloBlockId=u.songSoloBlockId||null;
      renderAll(); markSaved(); markCurrentRecent();
    }catch(e){ console.error("PatternMachine: stato non leggibile",e); }
  }

  // ---------- suono: tutto passa dal plug-in ----------
  // Colpi dal vivo (pad, anteprima, ascolto della libreria): al motore C++, con lo stesso anticipo.
  // I render offline (export WAV/MP3/stems) restano nel WebView con il trigger del sito.
  const siteTrigger=trigger;
  trigger=function(track,time,velocity,ctx){
    if(ctx && ctx!==audioCtx) return siteTrigger.apply(this,arguments);
    if(!(velocity>0)) return;
    const now=audioCtx ? audioCtx.currentTime : 0;
    send({type:"hit", vel:velocity, delay:Math.max(0,(time||0)-now), voice:{...voiceOf(track), master:+el("masterVol").value}});
  };
  // Il clock del WebView serve all'ascolto della libreria e alla testina: va tenuto sveglio.
  const wake=()=>{ const c=actx(); if(c.state==="suspended") c.resume(); };
  addEventListener("pointerdown",wake,{capture:true});
  addEventListener("keydown",wake,{capture:true});

  // ---------- trasporto ----------
  // Se Logic suona comanda Logic. Da fermo il Play della pagina fa girare il motore da solo (anteprima).
  let hostPlaying=false, hostTempo=false;
  // Play/Stop della pagina: finche' il thread audio non li ha presi, la posizione riporta ancora lo stato vecchio.
  let localUntil=0;
  const localCommand=()=>{ localUntil=performance.now()+400; };
  const paintPlayBtn=on=>{
    const b=el("playBtn");
    b.classList.toggle("on",on);
    b.innerHTML=on?'<span class="ico">&#9632;</span> Stop':'<span class="ico">&#9654;</span> Play';
  };
  play=function(){
    stopAudition();
    if(hostPlaying) return;
    if(ui.mode==="song" && !project.song.length){ setStatus("la canzone e' vuota","err"); return; }
    let start=0;
    if(ui.mode==="song" && !ui.songSoloBlockId){
      seqLayout=songLayout();
      start=Math.max(0,Math.min(Math.max(0,seqLayout.total-1),Math.floor(ui.songStartPos||0)));
    }
    pushSync(true);
    send({type:"transport", play:true, start}); localCommand();
    playing=true; paintPlayBtn(true);
  };
  stop=function(){
    if(hostPlaying) return;
    send({type:"transport", play:false}); localCommand();
    playing=false; paintPlayBtn(false);
    visible={step:-1, patternId:null, blockIndex:-1, bar:1};
    paintPlayhead();
  };
  el("playBtn").onclick=()=>{
    if(hostPlaying){ setStatus("suona Logic: fermalo dal trasporto di Logic"); return; }
    playing?stop():play();
  };

  function onPos(m){
    hostPlaying=!!m.host;
    if(m.hostTempo!==hostTempo){
      hostTempo=!!m.hostTempo;
      ["bpmNum","bpmRange"].forEach(id=>{ el(id).disabled=hostTempo; el(id).title=hostTempo?"Il tempo lo decide Logic":""; });
    }
    if(hostTempo && m.bpm && Math.round(m.bpm)!==+el("bpmNum").value){
      el("bpmNum").value=Math.round(m.bpm);
      el("bpmRange").value=Math.min(180,Math.max(60,Math.round(m.bpm)));
      project.bpm=Math.round(m.bpm);
    }
    paintBadge();
    if(!!m.playing!==playing && (m.host || performance.now()>localUntil)){
      playing=!!m.playing; paintPlayBtn(playing);
      if(!playing){ visible={step:-1, patternId:null, blockIndex:-1, bar:1}; paintPlayhead(); return; }
    }
    if(!playing || !m.playing || !m.valid) return;
    const pat=project.patterns[m.pattern];
    const nv={step:m.step, cycle:m.cycle, patternId:pat?pat.id:null, blockIndex:m.block<0?0:m.block,
      bar:Math.floor(m.n/16)+1, rep:m.rep, time:actx().currentTime-m.frac*m.stepSec, dur:m.stepSec};
    const changed=nv.step!==visible.step || nv.patternId!==visible.patternId || nv.blockIndex!==visible.blockIndex;
    visible=nv;
    if(changed) paintPlayhead();
  }

  // ---------- pannellino "Logic" accanto al Play ----------
  const badge=document.createElement("span");
  badge.className="pm-plugin-badge";
  badge.innerHTML='<span class="pm-dot"></span><span class="pm-txt">Logic</span><button type="button" class="mini" title="Apri la cartella degli export nel Finder">Export ↗</button>';
  el("playBtn").insertAdjacentElement("afterend",badge);
  badge.querySelector("button").onclick=()=>send({type:"reveal", name:lastExport||""});
  function paintBadge(){
    badge.classList.toggle("live",hostPlaying);
    badge.querySelector(".pm-txt").textContent=hostPlaying
      ? `Logic ▶ ${ui.mode==="song"?"canzone":"pattern"}`
      : (hostTempo?"agganciato a Logic":"plug-in");
    badge.title=hostPlaying
      ? "Suona agganciato al trasporto di Logic: bpm, posizione e cicli arrivano da Logic"
      : "Premi Play in Logic: PatternMachine parte a tempo dalla battuta di Logic";
  }
  paintBadge();

  // Modalità Logic: ogni istanza può suonare una sola riga del progetto.
  const instanceBox=document.createElement("label");
  instanceBox.className="pm-instance-track";
  instanceBox.title="In Logic questa istanza suona solo lo strumento scelto";
  instanceBox.append("Istanza ");
  instanceSelect=document.createElement("select");
  instanceBox.appendChild(instanceSelect);
  badge.insertAdjacentElement("afterend",instanceBox);
  instanceSelect.onchange=()=>{
    instanceTrack=+instanceSelect.value;
    send({type:"instance-track", track:instanceTrack});
  };
  function renderInstanceTrack(){
    if(!instanceSelect || !project) return;
    instanceSelect.innerHTML="";
    const all=document.createElement("option"); all.value=-1; all.textContent="Tutti"; instanceSelect.appendChild(all);
    project.tracks.forEach((t,i)=>{
      const o=document.createElement("option");
      o.value=i; o.textContent=`${i+1}. ${t.name||t.id||`Strumento ${i+1}`}`;
      instanceSelect.appendChild(o);
    });
    instanceSelect.value=String(instanceTrack);
  }
  renderInstanceTrack();

  // ---------- progetti come file in ~/Music/PatternMachine/Progetti (come l'app per Mac) ----------
  const listeners=new Set();
  const snapshot=async()=>{
    const list=await call("projects",{op:"list"});
    list.sort((a,b)=>(b.data.updatedAt||0)-(a.data.updatedAt||0));
    return {docs:list.map(x=>({id:x.id, data:()=>x.data}))};
  };
  const notify=()=>snapshot().then(s=>listeners.forEach(cb=>cb(s)));
  const query={
    orderBy:()=>query, limit:()=>query, get:snapshot,
    onSnapshot(cb){ listeners.add(cb); snapshot().then(cb).catch(()=>{}); return ()=>listeners.delete(cb); },
  };
  db={
    collection:()=>Object.assign({}, query, {
      async add(data){ const id="p"+Date.now(); await call("projects",{op:"set", id, data}); notify(); return {id}; },
    }),
    doc(p){
      const id=String(p).split("/")[1];
      return {
        async set(data){ await call("projects",{op:"set", id, data}); notify(); },
        async get(){ const d=await call("projects",{op:"get", id}); return {exists:!!d, data:()=>d}; },
        async delete(){ await call("projects",{op:"delete", id}); notify(); },
      };
    },
  };
  unsubRecent=db.collection("projects").onSnapshot(s=>renderRecent(s.docs.map(d=>({id:d.id,...d.data()}))));

  // ---------- esportazioni in ~/Music/PatternMachine/Export ----------
  let lastExport="";
  const toB64=bytes=>{
    let s="";
    for(let i=0;i<bytes.length;i+=0x8000) s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
    return btoa(s);
  };
  downloadsCap={
    async save({filename, data}){
      const bytes=new Uint8Array(await data.arrayBuffer());
      lastExport=await call("export",{filename, base64:toB64(bytes)});
    },
  };
  const siteSetStatus=setStatus;
  setStatus=(msg,kind)=>{
    msg=String(msg).replace("· cloud","· su file");
    if(/ esportato$/.test(msg) && lastExport) msg+=` · Musica › PatternMachine › Export › ${lastExport}`;
    siteSetStatus(msg,kind);
  };

  // ---------- messaggi dal plug-in ----------
  B.addEventListener("pm",m=>{
    if(!m) return;
    if(m.type==="pos") onPos(m);
    else if(m.type==="reply"){
      const w=waiting.get(m.req); if(!w) return;
      waiting.delete(m.req);
      m.error ? w.ko(new Error(m.error)) : w.ok(m.result);
    }
    else if(m.type==="init"){
      restore(m.state);
      instanceTrack=Number.isInteger(+m.instanceTrack)?+m.instanceTrack:-1;
      renderInstanceTrack();
      ready=true; lastSync="";
      pushSync(true);             // anche un progetto nuovo suona subito, senza toccare niente
    }
    else if(m.type==="load"){ restore(m.state); renderInstanceTrack(); lastSync=""; pushSync(true); }
  });
  send({type:"hello"});
})();
