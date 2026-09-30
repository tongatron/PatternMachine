// Local browser sampler.
// Audio blobs stay outside project JSON; they live locally and can optionally sync to the account.
// Edit opens the full-screen editor (engine/sample-editor.js); Play on synth hands the sound to the synth (engine/synth.js).
(function(){
  "use strict";

  const DB_NAME="pm-local-sampler-v1", STORE="samples", MAX_BYTES=20*1024*1024, RECORD_LIMIT=30000;
  let db=null, records=[], recording=null, recordTimer=null;
  const buffers=new Map(), urls=new Map();
  let previewState=null, previewTimer=0, previewRequest=0;
  const $=id=>document.getElementById(id), desktop=!!window.pmDesktop, D=window.pmDesktop;
  let syncEnabled=false, syncBusy=false;
  const defaultSettings=()=>({start:0,tune:0,decay:100,reverse:false,vol:.8});
  function settingsOf(record){ return {...defaultSettings(),...(record.settings||{})}; }
  function fallbackName(name){ return String(name||"Sample").replace(/\.[^.]+$/,"" ).trim().slice(0,60)||"Sample"; }
  async function chooseName(defaultName){
    if(typeof ask!=="function") return defaultName;
    const answer=await ask({
      title:"Name sample",
      message:"This name is used on the sampler card and saved in projects that use the sound.",
      ok:"Use name",
      input:defaultName
    });
    return answer===null ? null : fallbackName(answer);
  }

  function setNote(message,error=false){
    const node=$("samplerStatus"); if(!node) return;
    node.textContent=message; node.style.color=error?"var(--danger)":"";
  }
  function syncChoice(){ try{return localStorage.getItem("pm.sampler-sync")==="1";}catch(e){return false;} }
  function setSyncChoice(value){ syncEnabled=!!value; try{localStorage.setItem("pm.sampler-sync",syncEnabled?"1":"0");}catch(e){} const c=$("samplerSync"); if(c)c.checked=syncEnabled; }
  async function syncServer(){
    if(syncBusy) return;
    if(desktop){
      try{
        const state=await D.account.sync();
        if(state?.state==="ok"){
          await hydrate();
          render(); refreshEngine();
          setNote("Samples and projects synced");
        }
        else if(state?.state==="signed-out"||state?.state==="expired") setNote("Sign in to sync samples",true);
        else setNote(state?.message||"Sample sync will retry when the server is available",true);
      }catch(e){ setNote("Sample sync will retry when the server is available",true); }
      return;
    }
    syncBusy=true; const button=$("samplerSyncNow"); if(button)button.disabled=true;
    try{
      const me=await fetch("/api/me",{credentials:"same-origin"});
      if(!me.ok) throw new Error("Sign in to sync samples");
      const listed=await fetch("/api/samples",{credentials:"same-origin"});
      if(!listed.ok) throw new Error("Could not reach sample storage");
      const remote=Object.fromEntries(((await listed.json()).samples||[]).map(x=>[x.id,x]));
      for(const r of [...records]){
        const server=remote[r.id], localTime=r.updatedAt||r.createdAt||0, serverTime=Date.parse(server?.updated_at||"")||0;
        if(!server || server.deleted || (r.serverSha!==server.sha256 && localTime>=serverTime)){
          const q=new URLSearchParams({name:r.name,duration:String(r.duration||0),mime:r.blob.type||r.mime||"application/octet-stream",settings:JSON.stringify(settingsOf(r))});
          const response=await fetch(`/api/samples/${encodeURIComponent(r.id)}?${q}`,{method:"PUT",credentials:"same-origin",headers:{"Content-Type":r.blob.type||"application/octet-stream"},body:r.blob});
          if(!response.ok) throw new Error(`Upload failed (${response.status})`);
          const saved=await response.json(); r.serverSha=saved.sha256; r.serverUpdatedAt=saved.updated_at; await persistRecord(r);
        }else if(server.sha256!==r.serverSha && serverTime>localTime){
          const response=await fetch(`/api/samples/${encodeURIComponent(r.id)}`,{credentials:"same-origin"}); if(!response.ok) throw new Error("Download failed");
          const blob=await response.blob(), buffer=await decode(blob);
          Object.assign(r,{name:server.name||r.name,blob,size:blob.size,duration:Number(server.duration)||buffer.duration,mime:server.mime,settings:server.settings||defaultSettings(),updatedAt:serverTime,serverSha:server.sha256,serverUpdatedAt:server.updated_at});
          await persistRecord(r); urls.set(r.id,URL.createObjectURL(blob)); addEntry(r,buffer);
        }
      }
      for(const server of Object.values(remote)) if(!server.deleted && !records.some(r=>r.id===server.id)){
        const response=await fetch(`/api/samples/${encodeURIComponent(server.id)}`,{credentials:"same-origin"}); if(!response.ok) continue;
        const blob=await response.blob(), buffer=await decode(blob), r={id:server.id,name:server.name||"Sample",blob,size:blob.size,duration:Number(server.duration)||buffer.duration,mime:server.mime,createdAt:serverTime(server),updatedAt:Date.parse(server.updated_at||"")||Date.now(),settings:server.settings||defaultSettings(),serverSha:server.sha256,serverUpdatedAt:server.updated_at};
        if(recordSize()+r.size>MAX_BYTES) continue;
        await persistRecord(r); records.push(r); urls.set(r.id,URL.createObjectURL(blob)); addEntry(r,buffer);
      }
      render(); refreshEngine(); setNote("Samples synced with your account");
    }catch(e){ if(!desktop)setSyncChoice(false); setNote(e.message||"Sample sync failed",true); }
    finally{ syncBusy=false; if(button)button.disabled=false; }
  }
  function serverTime(meta){ return Date.parse(meta?.updated_at||"")||Date.now(); }
  function formatBytes(n){ if(!n) return "0 B"; return n<1024*1024 ? `${Math.max(1,Math.round(n/1024))} KB` : `${(n/1024/1024).toFixed(1)} MB`; }
  function formatDuration(seconds){
    if(!Number.isFinite(seconds)) return "—";
    if(seconds<10) return seconds.toFixed(2)+" s";   // i suoni corti: 0.66 s, non 0:01
    const m=Math.floor(seconds/60), s=Math.round(seconds%60);
    return `${m}:${String(s).padStart(2,"0")}`;
  }
  function request(req){ return new Promise((resolve,reject)=>{ req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error||new Error("local sample storage failed")); }); }
  function transaction(mode,work){ return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode), store=tx.objectStore(STORE);
    let value;
    try{ value=work(store); }catch(e){ reject(e); return; }
    tx.oncomplete=()=>resolve(value); tx.onerror=()=>reject(tx.error||new Error("local sample storage failed"));
  }); }
  async function persistRecord(record){
    if(desktop){
      record.updatedAt=Date.now();
      await D.samples.set(record.id,{name:record.name,size:record.size,duration:record.duration,mime:record.blob.type||record.mime||"application/octet-stream",createdAt:record.createdAt,updatedAt:record.updatedAt,settings:settingsOf(record)},await record.blob.arrayBuffer());
      return;
    }
    await transaction("readwrite",store=>store.put(record));
  }
  async function deleteRecord(id){
    if(desktop) return D.samples.delete(id);
    return transaction("readwrite",store=>store.delete(id));
  }
  function openDb(){
    return new Promise((resolve,reject)=>{
      if(!window.indexedDB) return reject(new Error("this browser cannot keep local samples"));
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE,{keyPath:"id"}); };
      req.onsuccess=()=>{ db=req.result; resolve(db); };
      req.onerror=()=>reject(req.error||new Error("could not open local sample storage"));
    });
  }
  async function decode(blob){
    const data=await blob.arrayBuffer();
    return actx().decodeAudioData(data.slice(0));
  }
  function localIndex(id){ return SAMPLES.findIndex(s=>s.local && s.localId===id && !s.deleted); }
  function recordSize(){ return records.reduce((sum,r)=>sum+(r.size||0),0); }
  function addEntry(record,buffer){
    const old=SAMPLES.find(s=>s.local && s.localId===record.id);
    if(old){ old.name=record.name; old.settings=settingsOf(record); old.localUrl=urls.get(record.id)||old.localUrl; return old; }
    const local={name:record.name,bank:"D",local:true,localId:record.id,localUrl:urls.get(record.id),duration:record.duration,size:record.size,settings:settingsOf(record)};
    SAMPLES.push(local); if(buffer) buffers.set(record.id,buffer); return local;
  }
  // Forma d'onda da strumento di misura: inchiostro del tema invece dell'arancione, per ogni colonna di pixel
  // il picco (chiaro) e l'RMS (scuro); linea dello zero e righe tratteggiate a meta' ampiezza.
  function drawWave(canvas,buffer){
    const rect=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1, w=Math.max(220,Math.round(rect.width||420)), h=68;
    canvas.width=w*dpr; canvas.height=h*dpr;
    const c=canvas.getContext("2d"); c.scale(dpr,dpr); c.clearRect(0,0,w,h);
    const cs=getComputedStyle(document.documentElement), ink=cs.getPropertyValue("--text").trim()||"#222", edge=cs.getPropertyValue("--edge-soft").trim()||"#555";
    const mid=h/2, amp=h*.42, line=y=>Math.round(y)+.5;
    c.strokeStyle=edge; c.lineWidth=1;
    c.globalAlpha=.55; c.setLineDash([2,3]); c.beginPath();
    for(const y of [mid-amp/2,mid+amp/2]){ c.moveTo(0,line(y)); c.lineTo(w,line(y)); }
    c.stroke(); c.setLineDash([]);
    c.globalAlpha=.8; c.beginPath(); c.moveTo(0,line(mid)); c.lineTo(w,line(mid)); c.stroke();
    if(!buffer){ c.globalAlpha=1; return; }
    const data=buffer.getChannelData(0), per=data.length/w;
    c.fillStyle=ink;
    for(let x=0;x<w;x++){
      const a=Math.floor(x*per), b=Math.min(data.length,Math.max(a+1,Math.floor((x+1)*per)));
      let lo=0, hi=0, sq=0;
      for(let i=a;i<b;i++){ const v=data[i]; if(v<lo) lo=v; if(v>hi) hi=v; sq+=v*v; }
      const rms=Math.sqrt(sq/Math.max(1,b-a));
      c.globalAlpha=.35; c.fillRect(x,mid-hi*amp,1,Math.max(1,(hi-lo)*amp));
      c.globalAlpha=.85; c.fillRect(x,mid-rms*amp,1,Math.max(1,2*rms*amp));
    }
    c.globalAlpha=1;
  }
  function repaintCard(id){
    const card=document.querySelector(`.sample-card[data-sample-id="${CSS.escape(id)}"]`), canvas=card?.querySelector("canvas");
    if(canvas) drawWave(canvas,buffers.get(id));
  }
  function sampleTrack(id){
    const i=localIndex(id), record=records.find(r=>r.id===id);
    return i<0 || !record ? null : makeTrack(i,settingsOf(record));
  }
  function previewCard(id){ return document.querySelector(`.sample-card[data-sample-id="${CSS.escape(id)}"]`); }
  function previewPosition(){
    if(!previewState) return 0;
    if(previewState.paused) return previewState.position;
    return Math.min(previewState.duration,Math.max(0,previewState.ctx.currentTime-previewState.startedAt));
  }
  function updatePreviewUI(){
    document.querySelectorAll(".sample-card").forEach(card=>{
      const id=card.dataset.sampleId, active=previewState?.id===id, progress=card.querySelector(".sample-progress"), time=card.querySelector(".sample-time"), play=card.querySelector(".sample-preview"), stop=card.querySelector(".sample-stop");
      const record=records.find(r=>r.id===id), duration=active?previewState.duration:(record?.duration||0), position=active?previewPosition():0;
      if(progress){ progress.max=Math.max(.01,duration); progress.value=Math.min(progress.max,position); }
      if(time) time.textContent=`${formatDuration(position)} / ${formatDuration(duration)}`;
      if(play){ play.textContent=active?(previewState.paused?"▶ Resume":"Ⅱ Pause"):"▶ Preview"; play.classList.toggle("primary",active); }
      if(stop) stop.hidden=!active;
      card.classList.toggle("previewing",active);
    });
  }
  function previewFrame(){
    if(!previewState) return;
    updatePreviewUI();
    previewTimer=requestAnimationFrame(previewFrame);
  }
  function stopPreview(invalidate=true){
    if(invalidate) previewRequest++;
    const state=previewState;
    previewState=null;
    if(previewTimer) cancelAnimationFrame(previewTimer);
    previewTimer=0;
    if(state?.source){ try{ state.source.onended=null; state.source.stop(); }catch(e){} }
    updatePreviewUI();
  }
  function pausePreview(){
    if(!previewState || previewState.paused) return;
    previewState.position=previewPosition(); previewState.paused=true;
    const source=previewState.source; previewState.source=null;
    try{ source.onended=null; source.stop(); }catch(e){}
    if(previewTimer) cancelAnimationFrame(previewTimer); previewTimer=0;
    updatePreviewUI();
  }
  async function startPreview(id,position=0,request=previewRequest){
    const i=localIndex(id), track=sampleTrack(id); if(i<0 || !track || request!==previewRequest) return;
    const ctx=actx(); if(ctx.state==="suspended") await ctx.resume();
    const raw=bufferCache.get(cacheKey(i)); if(!raw || typeof raw.then==="function") return;
    const buffer=voiceBuffer(track,raw), rate=Math.pow(2,(track.tune||0)/12), offset=Math.min(.95,(track.start||0)/100)*buffer.duration;
    const available=Math.max(.01,(buffer.duration-offset)/rate), decay=(track.decay??100)/100, duration=Math.max(.01,available*decay*decay);
    const positionNow=Math.min(Math.max(0,position),Math.max(0,duration-.01));
    const source=ctx.createBufferSource(), gain=ctx.createGain();
    source.buffer=buffer; source.playbackRate.value=rate; gain.gain.value=Math.min(1.2,track.vol??.8); source.connect(gain).connect(ctx.destination);
    const state={id,ctx,source,duration,position:positionNow,startedAt:ctx.currentTime-positionNow,paused:false};
    previewState=state;
    source.onended=()=>{ if(previewState?.source!==source) return; previewState=null; if(previewTimer) cancelAnimationFrame(previewTimer); previewTimer=0; updatePreviewUI(); };
    source.start(ctx.currentTime,offset+positionNow*rate);
    source.stop(ctx.currentTime+Math.max(.02,duration-positionNow)+.02);
    updatePreviewUI(); previewTimer=requestAnimationFrame(previewFrame);
  }
  async function resumePreview(){
    const state=previewState; if(!state) return;
    const id=state.id, position=state.position, request=++previewRequest;
    stopPreview(false);
    try{ await loadBuffer(localIndex(id)); await startPreview(id,position,request); }
    catch(e){ setNote("Could not play sample",true); }
  }
  function render(){
    const list=$("samplerList"); if(!list) return;
    if(previewState) stopPreview();
    const total=recordSize(), count=$("samplerCount"), storage=$("samplerStorage");
    count.textContent=`${records.length} ${records.length===1?"sound":"sounds"}`;
    storage.textContent=`${formatBytes(total)} / 20 MB local`;
    list.innerHTML="";
    if(!records.length){ list.innerHTML='<div class="sampler-empty">Your private sample shelf is empty. Import a sound or record a voice to make the first pad.</div>'; return; }
    records.slice().sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)).forEach(r=>{
      const card=document.createElement("article"); card.className="sample-card"; card.dataset.sampleId=r.id;
      const top=document.createElement("div"); top.className="sample-card-top";
      const name=document.createElement("button"); name.type="button"; name.className="sample-card-name"; name.textContent=r.name; name.title="Rename sample";
      name.onclick=()=>renameWithDialog(r.id);
      const del=document.createElement("button"); del.type="button"; del.className="icon-btn"; del.textContent="×"; del.title="Delete local sample"; del.setAttribute("aria-label",`Delete ${r.name}`);
      del.onclick=()=>remove(r.id);
      top.append(name,del); card.appendChild(top);
      const meta=document.createElement("div"); meta.className="sample-card-meta"; meta.textContent=`${formatDuration(r.duration)} · ${formatBytes(r.size||0)} · local`; card.appendChild(meta);
      const canvas=document.createElement("canvas"); canvas.className="sample-card-wave"; canvas.setAttribute("aria-label",`Waveform of ${r.name}`); card.appendChild(canvas);
      canvas.title="Double-click to open the editor"; canvas.ondblclick=()=>openEditor(r.id);
      const progressRow=document.createElement("div"); progressRow.className="sample-progress-row";
      const progress=document.createElement("progress"); progress.className="sample-progress"; progress.max=Math.max(.01,r.duration||0); progress.value=0; progress.setAttribute("aria-label",`Preview progress for ${r.name}`);
      const time=document.createElement("span"); time.className="sample-time"; time.textContent=`0:00 / ${formatDuration(r.duration)}`;
      progressRow.append(progress,time); card.appendChild(progressRow);
      const settings=settingsOf(r), shape=document.createElement("details"); shape.className="sample-shape";
      const summary=document.createElement("summary"); summary.textContent="Shape sound"; shape.appendChild(summary);
      const controls=document.createElement("div"); controls.className="sample-shape-controls";
      const control=(label,key,min,max,step,format)=>{
        const field=document.createElement("label"); field.className="sample-param";
        const title=document.createElement("span"); title.textContent=label;
        const value=document.createElement("output"); value.textContent=format(settings[key]);
        const input=document.createElement("input"); input.type="range"; input.min=min; input.max=max; input.step=step; input.value=settings[key];
        input.oninput=()=>{ settings[key]=key==="tune"?+input.value:+input.value; value.textContent=format(settings[key]); };
        input.onchange=()=>updateSettings(r.id,{[key]:settings[key]});
        field.append(title,input,value); controls.appendChild(field);
      };
      control("Start","start",0,95,1,v=>v+"%");
      control("Pitch","tune",-12,12,1,v=>(v>0?"+":"")+v+" st");
      control("Tail","decay",5,100,1,v=>v+"%");
      const reverse=document.createElement("button"); reverse.type="button"; reverse.className="chip-btn rev"+(settings.reverse?" on s":""); reverse.textContent="REV"; reverse.title="Play the sample reversed";
      reverse.onclick=()=>{ settings.reverse=!settings.reverse; reverse.classList.toggle("on",settings.reverse); reverse.classList.toggle("s",settings.reverse); updateSettings(r.id,{reverse:settings.reverse}); };
      controls.appendChild(reverse); shape.appendChild(controls); card.appendChild(shape);
      const actions=document.createElement("div"); actions.className="sample-card-actions";
      const preview=document.createElement("button"); preview.type="button"; preview.className="mini sample-preview"; preview.textContent="▶ Preview"; preview.onclick=()=>previewSample(r.id);
      const stop=document.createElement("button"); stop.type="button"; stop.className="mini sample-stop"; stop.textContent="■ Stop"; stop.hidden=true; stop.onclick=()=>stopPreview();
      const edit=document.createElement("button"); edit.type="button"; edit.className="mini sample-edit"; edit.textContent="✎ Edit"; edit.title="Open the sample full screen: trim, fades, normalize…"; edit.onclick=()=>openEditor(r.id);
      actions.append(preview,stop,edit); card.appendChild(actions);
      const actions2=document.createElement("div"); actions2.className="sample-card-actions";
      const assign=document.createElement("button"); assign.type="button"; assign.className="mini primary"; assign.textContent="＋ Add to grid"; assign.onclick=()=>assignSample(r.id);
      const synth=document.createElement("button"); synth.type="button"; synth.className="mini"; synth.textContent="♪ Play on synth"; synth.title="Use this sound as the synth oscillator (Multi engine → Sample) and open the Synthesizer"; synth.onclick=()=>playOnSynth(r.id);
      actions2.append(assign,synth); card.appendChild(actions2); list.appendChild(card);
      requestAnimationFrame(()=>drawWave(canvas,buffers.get(r.id)));
    });
  }
  async function hydrate(){
    if(desktop){
      const metas=await D.samples.list(); records=[];
      for(const meta of metas){
        try{
          const got=await D.samples.get(meta.id), data=got.data instanceof Uint8Array?got.data:new Uint8Array(got.data);
          records.push({...meta,blob:new Blob([data],{type:meta.mime||"application/octet-stream"}),size:data.byteLength});
        }catch(e){}
      }
    }else records=await request(db.transaction(STORE,"readonly").objectStore(STORE).getAll());
    for(const r of records){
      const url=URL.createObjectURL(r.blob); urls.set(r.id,url); r.localUrl=url;
      try{ const buffer=await decode(r.blob); addEntry(r,buffer); }catch(e){ r.invalid=true; }
    }
    records=records.filter(r=>!r.invalid); render(); refreshEngine();
  }
  function refreshEngine(){
    if(typeof fillSampleSelect==="function") fillSampleSelect($("sampleSelect"));
    if(typeof renderAll==="function") renderAll();
    rebindProjectSamples();
  }
  function rebindProjectSamples(){
    if(typeof project==="undefined") return;
    let missing=0;
    project.tracks.forEach(t=>{
      if(!t.localSampleId) return;
      const i=localIndex(t.localSampleId);
      if(i>=0) t.sampleIndex=i; else { t.sampleIndex=sampleIdx("Perc 1"); missing++; }
    });
    syncProjectSampleNames().catch(()=>{});
    if(missing) setNote(`${missing} project sample${missing===1?"":"s"} not found in this browser`,true);
    if(typeof renderAll==="function") renderAll();
  }
  function syncProjectSampleNames(){
    if(typeof project==="undefined") return Promise.resolve();
    const changed=[];
    project.tracks.forEach(t=>{
      if(!t.localSampleId || !t.localSampleName) return;
      const r=records.find(x=>x.id===t.localSampleId); if(!r) return;
      const name=fallbackName(t.localSampleName);
      if(!name || name===r.name) return;
      r.name=name;
      const s=SAMPLES.find(x=>x.local && x.localId===r.id); if(s) s.name=name;
      changed.push(r);
    });
    if(changed.length) render();
    return changed.length ? Promise.all(changed.map(persistRecord)) : Promise.resolve();
  }
  async function importFiles(files){
    const list=[...files].filter(f=>f && (f.type.startsWith("audio/")||/\.(wav|mp3|m4a|ogg|opus|flac|aif|aiff)$/i.test(f.name)));
    if(!list.length) return setNote("Choose an audio file",true);
    for(const file of list){
      if(recordSize()+file.size>MAX_BYTES){ setNote("Local sampler limit reached: 20 MB",true); break; }
      try{
        setNote(`Analysing ${file.name}…`);
        const buffer=await decode(file), defaultName=fallbackName(file.name), name=await chooseName(defaultName);
        if(name===null){ setNote("Import cancelled"); continue; }
        const id=newId();
        const r={id,name,blob:file,size:file.size,duration:buffer.duration,mime:file.type,createdAt:Date.now(),updatedAt:Date.now(),settings:defaultSettings()};
        await persistRecord(r); records.push(r); urls.set(id,URL.createObjectURL(file)); r.localUrl=urls.get(id); addEntry(r,buffer);
        setNote(`${r.name} added locally`);
      }catch(e){ setNote(`${file.name}: unsupported or unreadable audio`,true); }
    }
    render(); refreshEngine(); if(syncEnabled) syncServer();
  }
  function chooseMime(){ return ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/mp4"].find(x=>window.MediaRecorder?.isTypeSupported?.(x))||""; }
  async function toggleRecording(){
    if(recording){ recording.stop(); return; }
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder) return setNote("Microphone recording is not available here",true);
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true}), mime=chooseMime(), chunks=[];
      recording=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
      recording.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
      recording.onstop=async()=>{
        clearTimeout(recordTimer); stream.getTracks().forEach(t=>t.stop()); recording=null; updateRecordButton(false);
        const blob=new Blob(chunks,{type:mime||"audio/webm"});
        if(recordSize()+blob.size>MAX_BYTES) return setNote("Local sampler limit reached: 20 MB",true);
        await importFiles([new File([blob],`voice-${new Date().toISOString().slice(11,19).replaceAll(":","-")}.webm`,{type:blob.type})]);
      };
      recording.start(); updateRecordButton(true); setNote("Recording… click Record voice to stop");
      recordTimer=setTimeout(()=>recording?.stop(),RECORD_LIMIT);
    }catch(e){ setNote("Microphone permission was not granted",true); }
  }
  function updateRecordButton(on){
    const b=$("samplerRecord"); if(!b) return;
    b.classList.toggle("on",on); b.innerHTML=on?'<span class="rec-dot" aria-hidden="true">●</span> Stop recording':'<span class="rec-dot" aria-hidden="true">●</span> Record voice';
  }
  function previewSample(id){
    const i=localIndex(id); if(i<0) return setNote("Sample is not available",true);
    if(previewState?.id===id){ if(previewState.paused) resumePreview(); else pausePreview(); return; }
    const request=++previewRequest; stopPreview(false);
    loadBuffer(i).then(()=>startPreview(id,0,request)).catch(()=>setNote("Could not play sample",true));
  }
  function assignSample(id){
    const i=localIndex(id); if(i<0) return setNote("Sample is not available",true);
    pushUndo(); project.tracks.push(sampleTrack(id)); normalize(); loadBuffer(i); renderAll(); setStatus(`added “${sampleLabel(i)}” to the grid`);
  }
  async function updateSettings(id,patch){
    const r=records.find(x=>x.id===id); if(!r) return;
    r.settings={...settingsOf(r),...patch};
    r.updatedAt=Date.now();
    const s=SAMPLES.find(x=>x.local && x.localId===id); if(s) s.settings=r.settings;
    await persistRecord(r);
    setNote(`${r.name} shape saved locally`);
    if(syncEnabled) syncServer();
  }
  // ---------- editor e synth ----------
  async function openEditor(id){
    const r=records.find(x=>x.id===id), i=localIndex(id); if(!r || i<0) return setNote("Sample is not available",true);
    if(!window.PMSampleEditor) return setNote("The editor is not available",true);
    stopPreview();
    try{ PMSampleEditor.open(editorTarget(r, buffers.get(id) || await loadBuffer(i))); }
    catch(e){ setNote("Could not open the sample",true); }
  }
  function editorTarget(r,buffer){
    return {name:r.name, buffer,
      save:(blob,audio)=>replaceAudio(r.id,blob,audio),
      saveAsNew:async(blob,audio,name)=>{ const n=await addRecord(blob,audio,name); return {name:n.name, save:(b,a)=>replaceAudio(n.id,b,a)}; }};
  }
  function newId(){ return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }
  async function addRecord(blob,audio,name){
    if(recordSize()+blob.size>MAX_BYTES) throw new Error("Local sampler limit reached: 20 MB");
    const id=newId(), r={id,name:fallbackName(name),blob,size:blob.size,duration:audio.duration,mime:blob.type,createdAt:Date.now(),updatedAt:Date.now(),settings:defaultSettings()};
    await persistRecord(r); records.push(r); urls.set(id,URL.createObjectURL(blob)); r.localUrl=urls.get(id); addEntry(r,audio);
    render(); refreshEngine(); setNote(`${r.name} added locally`); if(syncEnabled) syncServer();
    return r;
  }
  // Save dall'editor: stesso id, quindi le righe della griglia e il synth che usano il campione suonano la versione nuova.
  async function replaceAudio(id,blob,audio){
    const r=records.find(x=>x.id===id); if(!r) throw new Error("Sample is not available");
    if(recordSize()-(r.size||0)+blob.size>MAX_BYTES) throw new Error("Local sampler limit reached: 20 MB");
    const lengthChanged=Math.abs((r.duration||0)-audio.duration)>1e-4;
    Object.assign(r,{blob,size:blob.size,duration:audio.duration,mime:"audio/wav",updatedAt:Date.now()});
    if(lengthChanged) r.settings={...settingsOf(r),start:0};    // lo Start in % si riferiva al suono di prima
    await persistRecord(r);
    if(urls.has(id)) URL.revokeObjectURL(urls.get(id));
    urls.set(id,URL.createObjectURL(blob)); r.localUrl=urls.get(id);
    const s=addEntry(r,audio); Object.assign(s,{duration:r.duration,size:r.size,settings:settingsOf(r)});
    buffers.set(id,audio);
    const key="local:"+id;
    if(typeof bufferCache!=="undefined") bufferCache.set(key,audio);
    if(typeof revCache!=="undefined") revCache.delete(key);
    window.PMSynth?.refreshSample?.(key);
    render(); refreshEngine(); setNote(`${r.name} saved`);
    if(syncEnabled) syncServer();
    return true;
  }
  function playOnSynth(id){
    if(localIndex(id)<0) return setNote("Sample is not available",true);
    if(!window.PMSynth?.useSample) return setNote("The synth is not available",true);
    stopPreview(); PMSynth.useSample("local:"+id);
  }
  async function rename(id,name){
    const r=records.find(x=>x.id===id); if(!r) return;
    r.name=fallbackName(name);
    r.updatedAt=Date.now();
    const s=SAMPLES.find(x=>x.local && x.localId===id); if(s) s.name=r.name;
    if(typeof project!=="undefined") project.tracks.filter(t=>t.localSampleId===id).forEach(t=>{ t.localSampleName=r.name; });
    if(typeof project!=="undefined" && project.synth?.params?.mSample==="local:"+id) project.synth.params.mSmpName=r.name;
    await persistRecord(r);
    render(); refreshEngine();
    if(typeof renderAll==="function") renderAll();
    setStatus(`sample renamed: ${r.name}`);
    if(syncEnabled) syncServer();
  }
  async function renameWithDialog(id){
    const r=records.find(x=>x.id===id); if(!r) return;
    const next=await ask({title:"Rename sample",message:"The new name is saved in this browser and in projects that use the sound.",ok:"Rename",input:r.name});
    if(next===null) return;
    const clean=fallbackName(next); if(clean===r.name) return;
    await rename(id,clean);
  }
  async function remove(id){
    const i=localIndex(id); if(i>=0 && typeof project!=="undefined" && project.tracks.some(t=>t.sampleIndex===i)) return setNote("Remove this sound from the grid first",true);
    const sp=typeof project!=="undefined" && project.synth?.params;
    if(sp && sp.mType==="sample" && sp.mSample==="local:"+id) return setNote("The synth plays this sound (Multi engine → Sample): choose another one first",true);
    const r=records.find(x=>x.id===id); if(!r) return;
    if(typeof ask!=="function" || !await ask({title:"Delete sample",message:`Delete “${r.name}” from this browser?`,ok:"Delete",cancel:"Keep",danger:true})) return;
    await deleteRecord(id);
    if(syncEnabled&&!desktop){ const response=await fetch(`/api/samples/${encodeURIComponent(id)}`,{method:"DELETE",credentials:"same-origin"}); if(!response.ok&&response.status!==404) setNote("Sample deleted locally; server copy remains",true); }
    records=records.filter(x=>x.id!==id); const s=SAMPLES.find(x=>x.local && x.localId===id); if(s) s.deleted=true;
    if(urls.has(id)) URL.revokeObjectURL(urls.get(id)); urls.delete(id); buffers.delete(id); render(); refreshEngine(); setNote("Sample deleted");
  }
  function bind(){
    $("samplerFile").addEventListener("change",e=>{ importFiles(e.target.files); e.target.value=""; });
    $("samplerRecord").addEventListener("click",toggleRecording);
    const drop=$("samplerDrop");
    ["dragenter","dragover"].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault(); drop.style.background="rgba(200,71,31,.24)";}));
    ["dragleave","drop"].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault(); drop.style.background="";}));
    drop.addEventListener("drop",e=>importFiles(e.dataTransfer.files));
    const sync=$("samplerSync"); if(sync){ syncEnabled=desktop||syncChoice(); sync.checked=syncEnabled; sync.onchange=()=>{ setSyncChoice(sync.checked); if(sync.checked)syncServer(); }; }
    const syncNow=$("samplerSyncNow"); if(syncNow)syncNow.onclick=syncServer;
    addEventListener("resize",()=>records.forEach(r=>repaintCard(r.id)));
    // l'onda ha il colore dell'inchiostro del tema: al cambio chiaro/scuro si ridisegna
    new MutationObserver(()=>records.forEach(r=>repaintCard(r.id))).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
    addEventListener("pm:project-loaded",rebindProjectSamples);
  }
  async function init(){
    try{ if(!desktop) await openDb(); bind(); await hydrate(); if(syncEnabled&&!desktop) syncServer(); }
    catch(e){ setNote("Local sample storage is unavailable in this browser",true); $("samplerFile").disabled=true; $("samplerRecord").disabled=true; }
  }
  window.PMSampler={init,openEditor};
})();
