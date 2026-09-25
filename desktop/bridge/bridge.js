// Ponte fra il sito e l'app: lo aggiunge main.js in fondo a index.html, dopo lo script principale.
// Il sito non sa niente dell'app: qui si rimpiazzano alcune sue funzioni globali (trigger, stop,
// makeZip, setStatus) e i suoi agganci per salvataggio e download (db, downloadsCap).
(function pmDesktopBridge(){
  if(!window.pmDesktop) return;
  const D=window.pmDesktop;
  document.documentElement.classList.add("pm-desktop");

  const SETTINGS_KEY="pm.desktop";
  const settings=Object.assign({midiOut:true, noteMap:"gm", internalAudio:true, follow:false},
    (()=>{ try{ return JSON.parse(localStorage.getItem(SETTINGS_KEY)||"{}"); }catch(e){ return {}; } })());
  const saveSettings=()=>{ try{ localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings)); }catch(e){} };

  // ---------- progetti come file in ~/Music/PatternMachine/Progetti ----------
  // Stessa forma dell'aggancio "db" che il sito gia' usa (doc/collection/onSnapshot).
  const listeners=new Set();
  const snapshot=async()=>{
    const list=await D.projects.list();
    list.sort((a,b)=>(b.data.updatedAt||0)-(a.data.updatedAt||0));
    return {docs:list.map(x=>({id:x.id, data:()=>x.data}))};
  };
  const notify=()=>snapshot().then(s=>listeners.forEach(cb=>cb(s)));
  const query={
    orderBy:()=>query, limit:()=>query, get:snapshot,
    onSnapshot(cb){ listeners.add(cb); snapshot().then(cb); return ()=>listeners.delete(cb); },
  };
  const fileDb={
    collection:()=>Object.assign({}, query, {
      async add(data){ const id="p"+Date.now(); await D.projects.set(id,data); notify(); return {id}; },
    }),
    doc(p){
      const id=String(p).split("/")[1];
      return {
        async set(data){ await D.projects.set(id,data); notify(); },
        async get(){ const d=await D.projects.get(id); return {exists:!!d, data:()=>d}; },
        async delete(){ await D.projects.delete(id); notify(); },
      };
    },
  };
  db=fileDb;
  unsubRecent=fileDb.collection("projects").onSnapshot(s=>renderRecent(s.docs.map(d=>({id:d.id,...d.data()}))));

  const siteSetStatus=setStatus;
  setStatus=(msg,kind)=>siteSetStatus(String(msg).replace("· cloud","· su file"),kind);

  // ---------- esportazioni nella cartella Export ----------
  // Il pacchetto per Logic esce come cartella gia' scompattata: si intercettano i file passati a makeZip.
  let lastExport=null, zipFiles=null;
  const siteMakeZip=makeZip;
  makeZip=files=>{ zipFiles=files; return siteMakeZip(files); };
  downloadsCap={
    async save({filename, data}){
      if(zipFiles && /\.zip$/.test(filename)){
        const files=zipFiles; zipFiles=null;
        lastExport=await D.exportFolder(files);
      } else {
        lastExport=await D.exportFile(filename, new Uint8Array(await data.arrayBuffer()));
      }
      paintExport();
    },
  };

  // ---------- uscita MIDI ----------
  // Ogni colpo suonato dal vivo (Play, pad, ascolto) diventa una nota sulla porta virtuale "PatternMachine".
  // L'audio e' programmato in anticipo sul tempo di audioCtx: la nota parte con lo stesso anticipo.
  const MIDI_CH=9, NOTE_MS=90;
  let outBox=[];
  const noteOf=i=>settings.noteMap==="sp"?midiNoteFor(i):gmNoteFor(i);
  function queueNote(track,time,velocity){
    const vel=Math.max(1,Math.min(127,Math.round(velocity*(track.vol??0.8)*127)));
    const delay=Math.max(0,(time-audioCtx.currentTime)*1000);
    if(!outBox.length) queueMicrotask(()=>{ D.midi.notes(outBox); outBox=[]; });
    outBox.push({ch:MIDI_CH, note:noteOf(track.sampleIndex), vel, delay, dur:NOTE_MS});
  }
  const siteTrigger=trigger;
  trigger=function(track,time,velocity,ctx){
    const live=!ctx || ctx===audioCtx;
    if(live && settings.midiOut && velocity>0) queueNote(track,time,velocity);
    if(live && !settings.internalAudio) return;
    return siteTrigger.apply(this,arguments);
  };

  // ---------- segui il clock di Logic ----------
  // In Logic: Impostazioni progetto > Sincronizzazione > MIDI > Clock MIDI verso "PatternMachine".
  // Start/Continue/Stop comandano il trasporto, la Song Position sposta il punto di partenza e
  // ogni 6 clock (un sedicesimo) si suona uno step: il passo lo detta Logic, non il timer del sito.
  const CLOCK_LEAD=0.010;          // s di margine per programmare l'audio
  let following=false, clockCount=0, sppSteps=0, clockTimes=[], lastClockAt=0, bpmShown=0;

  function clockPeriod(){
    if(clockTimes.length<2) return 60/bpm()/24;
    return (clockTimes[clockTimes.length-1]-clockTimes[0])/(clockTimes.length-1)/1000;
  }
  function seek(steps){
    if(ui.mode==="song"){
      const lens=project.song.map(b=>{ const p=patternById(b.patternId); return p?p.len*Math.max(1,b.repeats||1):0; });
      const total=lens.reduce((a,b)=>a+b,0);
      let s=total?steps%total:0;
      for(let i=0;i<lens.length;i++){
        if(s<lens[i]){ const p=patternById(project.song[i].patternId); cursor={step:s%p.len, blockIndex:i, rep:Math.floor(s/p.len), loops:0}; break; }
        s-=lens[i];
      }
    } else {
      const len=curPattern().len;
      cursor={step:steps%len, blockIndex:0, rep:0, loops:Math.floor(steps/len)};
    }
    barCount=Math.floor(steps/16)+1;
  }
  function startFollowing(steps){
    if(playing) stop();
    play();
    if(!playing) return;
    clearInterval(timer); timer=null;      // niente timer del sito: gli step arrivano dal clock
    following=true; clockCount=0;
    seek(steps);
    paintClock();
  }
  // Uno step, come fa scheduler() nel sito, ma al tempo dettato dal clock.
  function clockStep(){
    const ctx=actx(), pat=playingPattern();
    if(!pat){ stop(); return; }
    const base=clockPeriod()*6, sw=swing(), even=cursor.step%2===0;
    const at=ctx.currentTime+CLOCK_LEAD+(even?0:sw*base);
    const dur=base*(even?1+sw:1-sw);
    const cycle=ui.mode==="song" ? (cursor.rep||0) : (cursor.loops||0);
    audibleTracks().forEach(t=>{
      const i=stepIdx(pat,t.id,cursor.step,cycle);
      const v=(pat.grid[t.id]||[])[i];
      if(!v) return;
      const m=modOf(pat,t.id,i);
      if(!stepPlays(m)) return;
      const tr=lockedTrack(t,m), j=jitterT(), jv=jitterV();
      stepHits(m,dur,FLAM_SEC).forEach(([h,f])=>trigger(tr, at+nudgeOf(t)+j+h, stepVel(v)*f*jv));
    });
    queue.push({time:at, dur, step:cursor.step, cycle, rep:cursor.rep||0, patternId:pat.id, blockIndex:cursor.blockIndex, bar:barCount});
    cursor.step++;
    if(cursor.step>=pat.len){
      cursor.step=0; barCount++; cursor.loops=(cursor.loops||0)+1;
      if(ui.mode==="song"){
        cursor.rep++;
        const block=project.song[cursor.blockIndex];
        if(cursor.rep>=Math.max(1,block?.repeats||1)){
          cursor.rep=0;
          cursor.blockIndex=(cursor.blockIndex+1)%Math.max(1,project.song.length);
        }
      }
    }
  }
  // Il campo BPM segue Logic (arrotondato: il sito lavora a BPM interi; il passo resta quello del clock).
  function showTempo(){
    const est=Math.round(60/(clockPeriod()*24));
    if(est>=40 && est<=240 && est!==bpmShown){
      bpmShown=est;
      const n=el("bpmNum"); n.value=est; n.oninput&&n.oninput();
    }
  }
  D.midi.onInput(msg=>{
    if(!settings.follow) return;
    const s=msg[0];
    if(s===0xF8){
      const now=performance.now();
      if(now-lastClockAt>500) clockTimes=[];      // pausa lunga: la media ricomincia
      lastClockAt=now;
      clockTimes.push(now); if(clockTimes.length>25) clockTimes.shift();
      if(following && playing){
        if(clockCount%6===0) clockStep();
        clockCount++;
      }
      if(clockTimes.length>=25 && clockCount%24===0) showTempo();
    } else if(s===0xFA){ sppSteps=0; startFollowing(0); }
    else if(s===0xFB){ startFollowing(sppSteps); }
    else if(s===0xFC){ if(following) stop(); paintClock(); }
    else if(s===0xF2){
      sppSteps=(msg[1]&0x7f)|((msg[2]&0x7f)<<7);
      // salto durante il play (ciclo di Logic): si riparte dal nuovo punto al prossimo clock
      if(following && playing){ seek(sppSteps); clockCount=0; }
    }
  });

  const siteStop=stop;
  stop=function(){
    following=false;
    siteStop.apply(this,arguments);
    D.midi.panic();
    paintClock();
  };

  // ---------- trascina in Logic ----------
  // MIDI subito; il WAV si prepara alla pressione del mouse, cosi' e' pronto quando parte il trascinamento.
  const which=()=>ui.mode==="song"?"song":"pattern";
  let wavJob=null;
  function prepareWav(){
    const w=which();
    wavJob=renderWav(w).then(({buf})=>({name:exportBase(w)+".wav", blob:encodeWav(buf).blob})).catch(()=>null);
  }
  async function dragOut(kind){
    const w=which();
    if(w==="song" && !project.song.length) return setStatus("la canzone e' vuota","err");
    if(kind==="midi"){
      D.startDrag(exportBase(w)+".mid", settings.noteMap==="sp"?buildMidi(w):buildLogicMidi(w));
    } else {
      const r=await wavJob;
      if(!r) return setStatus("niente da trascinare: il pattern e' vuoto o tutto in mute","err");
      D.startDrag(r.name, new Uint8Array(await r.blob.arrayBuffer()));
    }
  }

  // ---------- pannello ----------
  const panel=document.createElement("div");
  panel.className="panel pm-desk";
  panel.innerHTML=`
    <div class="flexline">
      <span class="pm-desk-title">Logic</span>
      <span class="pm-drag" draggable="true" data-kind="midi" title="Trascina nella timeline di Logic: una regione MIDI">&#10303; MIDI</span>
      <span class="pm-drag" draggable="true" data-kind="wav" title="Trascina nella timeline di Logic: una regione audio con mixer ed effetti">&#10303; WAV</span>
      <span class="pm-sep"></span>
      <label class="fld" title="Le note escono sulla porta MIDI virtuale PatternMachine: in Logic arrivano come da una tastiera"><input type="checkbox" data-set="midiOut"> Uscita MIDI</label>
      <label class="fld" title="General MIDI per Drum Kit Designer e Drum Machine Designer, oppure il kit SP-1200 di Logic (36 + numero del campione)">Note
        <select data-set="noteMap"><option value="gm">General MIDI</option><option value="sp">Kit SP-1200 (36+)</option></select></label>
      <label class="fld" title="Spegni per sentire solo gli strumenti di Logic"><input type="checkbox" data-set="internalAudio"> Suono interno</label>
      <label class="fld" title="Play, stop, posizione e tempo arrivano dal MIDI Clock che Logic manda a PatternMachine"><input type="checkbox" data-set="follow"> Segui il clock di Logic</label>
      <span class="tiny pm-clock" id="pmClock"></span>
      <button class="mini" id="pmReveal" style="margin-left:auto" disabled>Mostra ultimo export</button>
      <span class="tiny pm-port" id="pmPort"></span>
    </div>`;
  document.querySelector(".wrap > .panel").after(panel);

  panel.querySelectorAll("[data-set]").forEach(inp=>{
    const k=inp.dataset.set;
    if(inp.type==="checkbox") inp.checked=!!settings[k]; else inp.value=settings[k];
    inp.onchange=()=>{
      settings[k]=inp.type==="checkbox"?inp.checked:inp.value;
      saveSettings();
      if(k==="midiOut" && !settings.midiOut) D.midi.panic();
      if(k==="follow"){ clockTimes=[]; if(!settings.follow && following) stop(); }
      paintClock();
    };
  });
  panel.querySelectorAll(".pm-drag").forEach(h=>{
    h.addEventListener("pointerdown",()=>{ if(h.dataset.kind==="wav") prepareWav(); });
    h.addEventListener("dragstart",e=>{ e.preventDefault(); dragOut(h.dataset.kind); });
  });
  const revealBtn=el("pmReveal");
  revealBtn.onclick=()=>lastExport && D.reveal(lastExport);
  function paintExport(){
    revealBtn.disabled=!lastExport;
    revealBtn.title=lastExport||"";
  }
  function paintClock(){
    const c=el("pmClock");
    if(!settings.follow) c.textContent="";
    else if(following && playing) c.textContent="▶ agganciato a Logic";
    else c.textContent=performance.now()-lastClockAt<1000 ? "clock presente: premi Play in Logic" : "in attesa del clock di Logic";
  }
  setInterval(()=>{ if(settings.follow && !following) paintClock(); },1000);
  D.midi.status().then(s=>{
    el("pmPort").textContent=s.ok ? `porta MIDI: ${s.name}` : "MIDI non disponibile";
    if(!s.ok) el("pmPort").title=s.error||"";
  });

  const lb=el("logicBtn");
  lb.textContent="Logic (cartella)";
  lb.title="Cartella per Logic Pro in ~/Music/PatternMachine/Export: MIDI General MIDI, uno stem WAV per strumento, campioni del kit. Segue Pattern/Canzone";
  paintClock();
})();
