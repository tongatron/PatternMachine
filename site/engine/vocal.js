// Voce sulla canzone, dal Sequencer: il microfono registra mentre la canzone suona (dall'inizio o dalla battuta
// scelta sulla timeline, con count-in), la ripresa si allinea al beat togliendo la latenza di uscita e di ingresso,
// si riascolta con la canzone e si salva nel Sampler: solo la voce (mono, parte sul primo colpo della canzone) o
// voce + canzone (il render offline dell'export WAV, stesso tratto). Il salvataggio passa da PMSampler.add.
// La cattura e' un AudioWorklet nello stesso AudioContext del Play: ogni pezzo porta il suo currentTime, quindi la
// ripresa si mette in fila con i colpi che il trasporto ha programmato (nextTime), senza orologi da confrontare.
// Usa play(), stop() e il nextTime del trasporto senza cambiarli.
(function(){
  "use strict";

  // ---------- funzioni pure (provate da tests/vocal.test.js) ----------
  const util={
    // secondi dall'inizio della canzone allo step pos. blocks: [{len, repeats}]; dur(s): durata dello step s del pattern.
    secondsAt(blocks, pos, dur){
      let t=0, at=0;
      for(const b of blocks){
        const len=Math.max(1,b.len|0);
        for(let r=0;r<Math.max(1,b.repeats|0);r++) for(let s=0;s<len;s++){ if(at>=pos) return t; t+=dur(s); at++; }
      }
      return t;
    },
    // n campioni a partire dall'istante from, presi dai pezzi catturati ({t, data}, t in secondi del contesto):
    // ogni pezzo va al suo posto, i buchi restano silenzio.
    place(chunks, sr, from, n){
      const out=new Float32Array(Math.max(0,n|0));
      for(const c of chunks){
        const at=Math.round((c.t-from)*sr), a=Math.max(0,-at), b=Math.min(c.data.length,out.length-at);
        if(b>a) out.set(c.data.subarray(a,b),at+a);
      }
      return out;
    },
    // voce su entrambi i canali della canzone, lunga quanto la voce (dove la canzone manca: silenzio).
    mix(song, voice, gain=1){
      return [0,1].map(c=>{
        const s=song[Math.min(c,song.length-1)], o=new Float32Array(voice.length);
        for(let i=0;i<o.length;i++) o[i]=(i<s.length?s[i]:0)+voice[i]*gain;
        return o;
      });
    },
    // sopra la soglia si abbassa tutto quanto basta (come l'export WAV), altrimenti resta com'e'.
    underCeiling(chs, ceiling=0.989){
      let p=0;
      for(const d of chs) for(let i=0;i<d.length;i++){ const a=Math.abs(d[i]); if(a>p) p=a; }
      return p>ceiling ? chs.map(d=>d.map(v=>v*ceiling/p)) : chs;
    },
  };

  // Pezzi da 4096 campioni con l'istante del primo; se il flusso salta, il pezzo si chiude prima.
  const WORKLET=`class PMVocalRec extends AudioWorkletProcessor{
  constructor(){ super(); this.buf=new Float32Array(4096); this.n=0; this.t=0; this.next=0; this.on=false;
    this.port.onmessage=e=>{ if(e.data==="on") this.on=true; else if(e.data==="off"){ this.on=false; this.flush(); this.port.postMessage({done:true}); } }; }
  flush(){ if(this.n){ this.port.postMessage({t:this.t, data:this.buf.slice(0,this.n)}); this.n=0; } }
  process(inputs){
    const ch=inputs[0];
    if(this.on && ch && ch.length){
      const x=ch[0], k=ch.length;
      if(this.n && Math.abs(currentTime-this.next)>1e-4) this.flush();
      if(!this.n) this.t=currentTime;
      for(let i=0;i<x.length;i++){ let v=0; for(let c=0;c<k;c++) v+=ch[c][i]; this.buf[this.n+i]=v/k; }
      this.n+=x.length; this.next=currentTime+x.length/sampleRate;
      if(this.n+128>this.buf.length) this.flush();
    }
    return true;
  }
}
registerProcessor("pm-vocal-rec",PMVocalRec);`;

  const $=id=>document.getElementById(id);
  const LAT_KEY="pm.vocal-latency", MAX_LAT=400;
  const opt={from:"start", count:1, what:"voice", gain:1, device:""};
  let mic=null;          // {stream, src, an, node, mute}
  let phase="off";       // off | ready | count | rec | listen
  let take=null, saved=true, named=false, devices=[], meterRaf=0, meterPeak=0, watch=0, soloSaved=null, listenSrc=null, pending=null, workletCtx=null;

  const fmt=s=>{ s=Math.max(0,s); return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`; };
  const fmtBytes=n=>n<1024*1024 ? `${Math.max(1,Math.round(n/1024))} KB` : `${(n/1024/1024).toFixed(1)} MB`;
  const busy=()=>phase==="count"||phase==="rec";
  function note(msg,err=false){ const i=$("vocalInfo"); if(!i) return; i.textContent=msg; i.classList.toggle("err",err); }

  // ---------- canzone: da dove parte e quanto dura ----------
  const layoutBlocks=()=>project.song.map(b=>({len:patternById(b.patternId)?.len||16, repeats:b.repeats||1}));
  const timelinePos=()=>Math.max(0,Math.min(Math.max(0,songLayout().total-1),Math.floor(ui.songStartPos||0)));
  const startPos=()=>opt.from==="pos" ? timelinePos() : 0;
  const barOf=pos=>Math.floor(pos/rhythmBarSteps())+1;
  function songSpan(pos){
    const blocks=layoutBlocks(), from=util.secondsAt(blocks,pos,stepDur), end=util.secondsAt(blocks,songLayout().total,stepDur);
    return {from, len:Math.max(0,end-from)};
  }
  function beatSeconds(){ let t=0; for(let s=0;s<rhythmBeatSteps();s++) t+=stepDur(s); return t; }

  // ---------- latenza: uscita (quello che si sente arriva dopo) + ingresso (la voce arriva dopo) ----------
  function autoLatency(){
    const ctx=actx(), inLat=mic?.stream.getAudioTracks()[0]?.getSettings?.().latency||0;
    return Math.round(((ctx.outputLatency||0)+(ctx.baseLatency||0)+inLat)*1000);
  }
  function savedLatency(){ try{ const v=localStorage.getItem(LAT_KEY); return v===null?null:Math.max(0,Math.min(MAX_LAT,+v||0)); }catch(e){ return null; } }
  const latencyMs=()=>savedLatency()??autoLatency();
  function paintLatency(){
    const ms=latencyMs();
    $("vocalLatency").value=ms; $("vocalLatencyOut").textContent=`${ms} ms${savedLatency()===null?" · auto":""}`;
  }

  // ---------- microfono ----------
  async function openMic(){
    closeMic();
    if(!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone recording is not available in this browser");
    const ctx=actx(); if(ctx.state==="suspended") await ctx.resume();
    if(!ctx.audioWorklet) throw new Error("This browser cannot record in time with the song");
    if(workletCtx!==ctx){
      const url=URL.createObjectURL(new Blob([WORKLET],{type:"text/javascript"}));
      try{ await ctx.audioWorklet.addModule(url); } finally{ URL.revokeObjectURL(url); }
      workletCtx=ctx;
    }
    // niente cancellazione dell'eco, soppressione del rumore o guadagno automatico: rovinano la voce cantata
    const audio={echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1};
    if(opt.device) audio.deviceId={exact:opt.device};
    let stream;
    try{ stream=await navigator.mediaDevices.getUserMedia({audio}); }
    catch(e){ throw new Error(e?.name==="NotAllowedError"?"Microphone permission was not granted":"The microphone could not be opened"); }
    const src=ctx.createMediaStreamSource(stream), an=ctx.createAnalyser(), node=new AudioWorkletNode(ctx,"pm-vocal-rec"), mute=ctx.createGain();
    an.fftSize=1024; mute.gain.value=0;
    src.connect(an); src.connect(node); node.connect(mute).connect(ctx.destination);   // tirato dal grafo, senza suono
    node.port.onmessage=e=>{
      const m=e.data; if(!pending) return;
      if(m.done){ pending.done?.(); return; }
      pending.chunks.push(m); pending.end=m.t+m.data.length/ctx.sampleRate;
    };
    mic={stream, src, an, node, mute};
    try{ devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="audioinput"); }catch(e){ devices=[]; }
    stream.getAudioTracks()[0].onended=()=>{ if(busy() && playing) stop(); closeMic(); if(phase==="ready") phase="off"; note("The microphone was disconnected",true); };
    if(phase==="off") phase="ready";
  }
  function closeMic(){
    if(!mic) return;
    try{ mic.src.disconnect(); mic.node.disconnect(); mic.mute.disconnect(); }catch(e){}
    mic.stream.getTracks().forEach(t=>t.stop()); mic=null;
  }
  function meter(){
    meterRaf=0;
    if($("vocalPanel").hidden) return;
    const bar=$("vocalMeter"), out=$("vocalMeterDb");
    if(mic){
      const d=new Float32Array(mic.an.fftSize); mic.an.getFloatTimeDomainData(d);
      let p=0; for(const v of d){ const a=Math.abs(v); if(a>p) p=a; }
      meterPeak=Math.max(p,meterPeak*0.94);
      const db=20*Math.log10(Math.max(1e-5,meterPeak));
      bar.style.width=`${Math.max(0,Math.min(100,(db+60)/60*100))}%`;
      bar.classList.toggle("hot",db>-1); out.textContent=db<-59?"−∞ dB":`${db.toFixed(0)} dB`;
    }else{ bar.style.width="0%"; bar.classList.remove("hot"); out.textContent="off"; }
    meterRaf=requestAnimationFrame(meter);
  }

  // ---------- registrazione ----------
  function captureOn(){ pending={chunks:[], end:0, done:null}; mic.node.port.postMessage("on"); }
  function captureOff(){
    return new Promise(resolve=>{
      if(!pending) return resolve(null);
      const got=pending, finish=()=>{ pending=null; resolve(got); };
      if(!mic) return finish();
      got.done=finish; mic.node.port.postMessage("off");
      setTimeout(()=>{ if(pending===got) finish(); },500);
    });
  }
  function holdSolo(){ if(soloSaved===null){ soloSaved=ui.songSoloBlockId||""; ui.songSoloBlockId=null; } }
  function releaseSolo(){ if(soloSaved!==null){ ui.songSoloBlockId=soloSaved||null; soloSaved=null; } }
  // La canzone parte da pos (senza il blocco in solo); lead: secondi prima del primo colpo, per il count-in.
  // Ritorna l'istante (nel tempo del contesto) del primo colpo.
  async function startSong(pos, lead){
    if(playing) stop();
    holdSolo();
    ui.songStartPos=pos;
    if(ui.mode!=="song") setMode("song");
    await play();
    if(!playing){ releaseSolo(); return null; }
    nextTime=actx().currentTime+0.1+lead;          // il trasporto aspetta la fine del count-in
    return nextTime+stepOffset(cursor.step);
  }
  // Tiene d'occhio il trasporto: poco prima della fine della canzone la ferma (altrimenti ricomincerebbe da capo;
  // lo scheduler programma 0,12 s in anticipo) e, registrando, prende ancora 1,5 s per le code della voce.
  // Se il trasporto si ferma prima (Stop, barra spaziatrice) chiude subito.
  function watchSong(end, done, rec){
    clearInterval(watch);
    let over=0;
    watch=setInterval(()=>{
      const now=actx().currentTime;
      if(rec && phase==="count"){
        if(now>=rec.t0){ phase="rec"; paint(false); }
        else note(`Count-in… ${Math.ceil((rec.t0-now)/rec.beat)} · the recording starts on the first beat of bar ${barOf(rec.pos)}`);
      }
      if(rec && phase==="rec") note(now<rec.songEnd ? `● Recording ${fmt(now-rec.t0)} / ${fmt(rec.songEnd-rec.t0)} · from bar ${barOf(rec.pos)}`
        : "● The song is over · recording the last notes of the voice…");
      if(!over){
        if(playing && now>=end-0.17){ stop(); over=end+(rec?1.5:0); }
        else if(!playing) over=now;
      }
      if(over && now>=over){ clearInterval(watch); watch=0; done(); }
    },10);
  }
  async function record(){
    if(!project.song.length) return note("The song is empty: add blocks to the Sequencer first",true);
    if(take && !saved && !await ask({title:"Record again?",message:"The last take has not been saved in the Sampler: a new take replaces it.",ok:"Record again",cancel:"Keep it",danger:true})) return;
    try{ if(!mic) await openMic(); }catch(e){ return note(e.message,true); }
    stopListen();
    const pos=startPos(), span=songSpan(pos), bar=PMRhythm.beatsPerBar(rhythm()), beats=opt.count*bar, beat=beatSeconds();
    take=null; saved=true;
    captureOn();
    const t0=await startSong(pos, beats*beat);
    if(t0===null){ await captureOff(); return note("The song could not start",true); }
    for(let k=0;k<beats;k++) metronomeHit(t0-(beats-k)*beat, k%bar===0);
    phase=beats?"count":"rec";
    const rec={t0, pos, beat, songFrom:span.from, songEnd:t0+span.len};
    watchSong(rec.songEnd, ()=>finishTake(rec), rec);
    paint();
  }
  async function finishTake(rec){
    clearInterval(watch); watch=0;
    if(playing) stop();
    releaseSolo();
    const was=phase, got=await captureOff();
    phase=mic?"ready":"off";
    if(was==="count" || !got?.chunks.length){ paint(); return note("Recording stopped before the song started"); }
    take={chunks:got.chunks, end:got.end, t0:rec.t0, pos:rec.pos, songFrom:rec.songFrom, sr:actx().sampleRate};
    if(voiceLength()<0.2*take.sr){ take=null; paint(); return note("The take is too short"); }
    saved=false; named=false; $("vocalName").value=defaultName();
    paint();
    note(`Take: ${fmt(voiceLength()/take.sr)} from bar ${barOf(take.pos)} · listen with the song, adjust the latency if the voice is late or early, then save it`);
  }
  // la voce allineata al primo colpo: quello che si sentiva all'istante t0 arriva al microfono dopo la latenza
  function voiceLength(){ return take ? Math.max(0,Math.round((take.end-latencyMs()/1000-take.t0)*take.sr)) : 0; }
  function voice(){ return util.place(take.chunks, take.sr, take.t0+latencyMs()/1000, voiceLength()); }

  // ---------- ascolto con la canzone ----------
  async function listen(){
    if(phase==="listen") return stopListen();
    if(!take || busy()) return;
    const ctx=actx(), v=voice(), buf=ctx.createBuffer(1,v.length,take.sr); buf.copyToChannel(v,0);
    const t0=await startSong(take.pos,0.05);
    if(t0===null) return;
    const src=ctx.createBufferSource(), g=ctx.createGain();
    src.buffer=buf; g.gain.value=opt.gain; src.connect(g).connect(ctx.destination); src.start(t0);
    listenSrc=src; phase="listen";
    watchSong(t0+songSpan(take.pos).len, ()=>stopListen());
    paint(false);
  }
  function stopListen(){
    if(listenSrc){ try{ listenSrc.stop(); }catch(e){} listenSrc=null; }
    if(phase!=="listen") return;
    clearInterval(watch); watch=0;
    if(playing) stop();
    releaseSolo();
    phase=mic?"ready":"off"; paint(false);
  }

  // ---------- salvataggio nel Sampler ----------
  function defaultName(){
    const base=($("projectName")?.value||"").trim()||"Song";
    return `${base} ${opt.what==="mix"?"vocal mix":"vocal"}`.slice(0,60);
  }
  async function resampleTo(data,from,to){
    const OAC=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    const off=new OAC(1,Math.ceil(data.length*to/from),to), b=off.createBuffer(1,data.length,from);
    b.copyToChannel(data,0);
    const s=off.createBufferSource(); s.buffer=b; s.connect(off.destination); s.start();
    return (await off.startRendering()).getChannelData(0);
  }
  async function save(){
    if(!take || !window.PMSampler?.add) return;
    const btn=$("vocalSave"); btn.disabled=true;
    try{
      const name=($("vocalName").value.trim()||defaultName()).slice(0,60);
      let v=voice(), sr=take.sr, chs;
      if(opt.what==="mix"){
        note("Rendering the song…");
        if(sr!==WAV_RATE){ v=await resampleTo(v,sr,WAV_RATE); sr=WAV_RATE; }
        let song=[new Float32Array(0)];
        try{
          const {buf}=await renderWav("song",1), a=Math.round(take.songFrom*sr);
          song=[0,1].map(c=>buf.getChannelData(Math.min(c,buf.numberOfChannels-1)).slice(a,a+v.length));
        }catch(e){ if(e?.message!=="vuoto") throw new Error("The song could not be rendered"); }
        chs=util.mix(song,v,opt.gain);
      }else chs=[v.map(x=>x*opt.gain)];
      chs=util.underCeiling(chs);
      const audio=actx().createBuffer(chs.length,chs[0].length,sr);
      chs.forEach((d,c)=>audio.copyToChannel(d,c));
      const blob=new Blob([PMSampleEditor.dsp.encodeWav(chs,sr)],{type:"audio/wav"});
      if(blob.size>PMSampler.room()) throw new Error(`The take needs ${fmtBytes(blob.size)}: there is not enough room in the Sampler (20 MB)`);
      const r=await PMSampler.add(blob,audio,name);
      saved=true;
      note(`Saved “${r.name}” in the Sampler · ${fmt(audio.duration)} · ${fmtBytes(blob.size)}`);
      setStatus(`vocal saved in the Sampler as “${r.name}”`);
      if($("vocalEdit").checked) PMSampler.openEditor(r.id);
    }catch(e){ note(e.message||"The take could not be saved",true); }
    finally{ btn.disabled=false; }
  }

  // ---------- pannello ----------
  function drawTake(){
    const cv=$("vocalWave"); if(!cv || !take) return;
    const w=Math.max(220,Math.round(cv.getBoundingClientRect().width||600)), h=56, dpr=devicePixelRatio||1;
    cv.width=w*dpr; cv.height=h*dpr;
    const c=cv.getContext("2d"); c.scale(dpr,dpr); c.clearRect(0,0,w,h);
    const cs=getComputedStyle(document.documentElement), ink=cs.getPropertyValue("--text").trim()||"#222", edge=cs.getPropertyValue("--edge-soft").trim()||"#666";
    c.fillStyle=edge; c.fillRect(0,Math.floor(h/2),w,1);
    const d=voice(), per=d.length/w;
    c.fillStyle=ink; c.globalAlpha=.8;
    for(let x=0;x<w;x++){
      let p=0;
      for(let i=Math.floor(x*per), e=Math.min(d.length,Math.floor((x+1)*per)); i<e; i++){ const a=Math.abs(d[i]); if(a>p) p=a; }
      const y=Math.max(.5,Math.min(1,p*opt.gain)*h*.46); c.fillRect(x,h/2-y,1,2*y);
    }
    c.globalAlpha=1;
  }
  const pressed=(id,key,val)=>$(id).querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset[key]===String(val))));
  function paint(info=true){
    const rec=busy(), listening=phase==="listen", pos=timelinePos(), fromPos=$("vocalFrom").querySelector('[data-from="pos"]');
    if(pos<=0 && opt.from==="pos") opt.from="start";
    fromPos.textContent=`From bar ${barOf(pos)}`;
    pressed("vocalFrom","from",opt.from); pressed("vocalCount","count",opt.count); pressed("vocalWhat","what",opt.what);
    $("vocalFrom").querySelectorAll("button").forEach(b=>{ b.disabled=rec||listening||(b===fromPos&&pos<=0); });
    $("vocalCount").querySelectorAll("button").forEach(b=>{ b.disabled=rec||listening; });
    $("vocalLatency").disabled=rec||listening;
    PMSampler.menu($("vocalInput"),[
      {value:"",label:"Default microphone"},
      ...(devices.some(d=>d.label && d.deviceId!=="default")?[{head:"Inputs"}]:[]),
      ...devices.filter(d=>d.label && d.deviceId && d.deviceId!=="default").map(d=>({value:d.deviceId,label:d.label})),
    ],opt.device,async v=>{
      if(busy()||phase==="listen") return note("Stop first, then change the microphone",true);
      opt.device=v;
      try{ await openMic(); readyInfo(); }catch(e){ note(e.message,true); }
      paint(false);
    });
    const recBtn=$("vocalRec");
    recBtn.classList.toggle("on",rec);
    recBtn.innerHTML=`<span class="rec-dot" aria-hidden="true">●</span> ${rec?"Stop":take?"Record again":"Record"}`;
    recBtn.disabled=listening;
    $("vocalTake").hidden=!take;
    $("vocalListen").hidden=$("vocalSave").hidden=!take;
    $("vocalListen").textContent=listening?"■ Stop":"▶ Listen with the song";
    $("vocalListen").classList.toggle("on",listening);
    $("vocalListen").disabled=$("vocalSave").disabled=rec;
    $("vocalGainOut").textContent=`${Math.round(opt.gain*100)}%`;
    paintLatency();
    if(take) requestAnimationFrame(drawTake);
    if(info && !rec && !listening && !take) readyInfo();
  }
  function readyInfo(){
    if(!project.song.length) return note("The song is empty: add blocks to the Sequencer first",true);
    const pos=startPos(), span=songSpan(pos), secs=PMSampler.room()/(2*actx().sampleRate);
    note(`${mic?"Microphone ready":"Microphone off"} · the song from bar ${barOf(pos)} lasts ${fmt(span.len)} · room for about ${fmt(secs)} of voice in the Sampler`
      +(secs<span.len?" (not enough for the whole song)":""), secs<span.len);
  }
  async function toggleRec(){
    if(busy()){ if(playing) stop(); return; }      // il controllo del trasporto chiude la ripresa
    await record();
  }
  async function open(){
    const box=$("vocalPanel");
    if(!box.hidden) return close();
    box.hidden=false; $("vocalBtn").setAttribute("aria-expanded","true");
    if(!take) opt.from=timelinePos()>0?"pos":"start";
    paint(false); note("Opening the microphone…");
    try{ if(!mic) await openMic(); paint(); }catch(e){ note(e.message,true); paint(false); }
    if(!meterRaf) meterRaf=requestAnimationFrame(meter);
  }
  async function close(){
    if(busy()) return note("Stop the recording first",true);
    if(take && !saved && !await ask({title:"Discard the take?",message:"The take has not been saved in the Sampler.",ok:"Discard",cancel:"Keep it",danger:true})) return;
    stopListen(); closeMic(); take=null; saved=true; phase="off";
    $("vocalPanel").hidden=true; $("vocalBtn").setAttribute("aria-expanded","false"); $("vocalBtn").focus();
  }
  function init(){
    if(!$("vocalBtn")) return;
    $("vocalBtn").onclick=open;
    $("vocalClose").onclick=close;
    $("vocalRec").onclick=toggleRec;
    $("vocalListen").onclick=listen;
    $("vocalSave").onclick=save;
    $("vocalFrom").onclick=e=>{ const b=e.target.closest("button"); if(b && !b.disabled){ opt.from=b.dataset.from; paint(); } };
    $("vocalCount").onclick=e=>{ const b=e.target.closest("button"); if(b && !b.disabled){ opt.count=+b.dataset.count; paint(); } };
    $("vocalWhat").onclick=e=>{ const b=e.target.closest("button"); if(!b) return; opt.what=b.dataset.what; if(!named) $("vocalName").value=defaultName(); paint(false); };
    $("vocalName").oninput=()=>{ named=true; };
    $("vocalGain").oninput=e=>{ opt.gain=+e.target.value/100; $("vocalGainOut").textContent=`${e.target.value}%`; drawTake(); };
    const lat=$("vocalLatency");
    lat.max=MAX_LAT;
    lat.oninput=()=>{ try{ localStorage.setItem(LAT_KEY,lat.value); }catch(e){} paintLatency(); drawTake(); };
    lat.ondblclick=()=>{ try{ localStorage.removeItem(LAT_KEY); }catch(e){} paintLatency(); drawTake(); };   // torna automatica
    // la battuta di partenza si sceglie cliccando la timeline
    $("timeline")?.addEventListener("click",()=>setTimeout(()=>{ if(!$("vocalPanel").hidden && !busy() && phase!=="listen"){ if(!take && timelinePos()>0) opt.from="pos"; paint(!take); } }));
    addEventListener("resize",()=>{ if(take && !$("vocalPanel").hidden) drawTake(); });
    // l'onda ha il colore dell'inchiostro del tema: al cambio chiaro/scuro si ridisegna
    new MutationObserver(drawTake).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
    addEventListener("pm:project-loaded",()=>{ if(!$("vocalPanel").hidden && !take) paint(); });
  }

  window.PMVocal={util, init};
})();
