// Ponte fra il sito e l'app: lo aggiunge main.js in fondo a index.html, dopo lo script principale.
// Il sito non sa niente dell'app: qui si rimpiazzano alcune sue funzioni globali (trigger, stop,
// makeZip, setStatus) e i suoi agganci per salvataggio e download (db, downloadsCap).
(function pmDesktopBridge(){
  if(!window.pmDesktop) return;
  const D=window.pmDesktop;
  document.documentElement.classList.add("pm-desktop");

  // ---------- messaggio di aggiornamento ----------
  // Resta nella finestra dell'app, così segue il tema e la grafica della macchina.
  function showAppMessage(msg){
    if(!msg || document.querySelector(".pm-update-dialog[open]")) return;
    const d=document.createElement("dialog");
    d.className="pm-update-dialog";
    d.setAttribute("aria-labelledby","pmUpdateTitle");
    d.innerHTML=`<form method="dialog">
      <h3 id="pmUpdateTitle"></h3>
      <p class="pm-update-message"></p>
      <a class="pm-update-link" target="_blank" rel="noopener" hidden>Open the link</a>
      <div class="pm-update-actions">
        <button type="submit" value="ignore">Ignore</button>
        <button type="submit" value="later" class="primary">Close and remind me later</button>
      </div>
    </form>`;
    document.body.appendChild(d);
    d.querySelector("#pmUpdateTitle").textContent=msg.title;
    d.querySelector(".pm-update-message").textContent=msg.message;
    const link=d.querySelector(".pm-update-link");
    if(msg.url){ link.hidden=false; link.href=msg.url; link.addEventListener("click",e=>{ e.preventDefault(); D.appMessage.open(msg.url); }); }
    d.addEventListener("close",()=>{ if(d.returnValue==="ignore") D.appMessage.remember(msg.id); d.remove(); });
    d.addEventListener("click",e=>{ if(e.target===d) d.close("later"); });
    d.showModal();
    d.querySelector('[value="ignore"]').focus();
  }
  D.appMessage.onShow(showAppMessage);

  // ---------- drum machine personali ----------
  const customKitSlots=42;
  function registerCustomKit(meta){
    const bySlot=Object.fromEntries((meta.slots||[]).map(s=>[s.slot,s]));
    KITS[meta.id]={label:meta.label, source:"your own samples", custom:true,
      url:x=>`__kits/${meta.id}/${bySlot[x.name]?.file||""}`,
      name:x=>bySlot[x.name]?.label||x.name,
      has:x=>!!bySlot[x.name]};
  }
  function refreshCustomKitMenus(){
    const current=sampleSet;
    fillKitOptions(el("kitSelect")); fillKitOptions(el("libKitSelect"));
    el("kitSelect").value=KITS[current]?current:"tr808";
    el("libKitSelect").value=el("kitSelect").value;
    paintKitButtons(); updateKitEditorButton();
  }
  function kitDraftFromFiles(files){
    return files.slice(0,customKitSlots).map((f,i)=>({slot:SAMPLES[i].name,file:f.file,label:f.name.replace(/\.[^.]+$/,"" )}));
  }
  function showKitEditor({meta=null,stagingId="",files=[]}){
    const slots=meta ? meta.slots : kitDraftFromFiles(files);
    const d=document.createElement("dialog"); d.className="pm-kit-dialog"; d.setAttribute("aria-labelledby","pmKitTitle");
    d.innerHTML=`<form>
      <h3 id="pmKitTitle">${meta?"Edit":"Import"} Drum Machine</h3>
      <p>${meta?"Edit the name of the machine and the names of the instruments.":`Found ${files.length} samples. The first ${Math.min(files.length,customKitSlots)} will be assigned to the pads in order.`}</p>
      <label>Machine name<input type="text" id="pmKitName" maxlength="80" required></label>
      <label>Instrument names</label>
      <div class="pm-kit-slots"></div>
      <p class="pm-kit-status" role="status"></p>
      <div class="pm-kit-actions"><button type="button" value="cancel">Cancel</button><button type="button" value="save" class="primary">Save machine</button></div>
    </form>`;
    d.querySelector("#pmKitName").value=meta?.label||"Drum Machine";
    const list=d.querySelector(".pm-kit-slots");
    slots.forEach(s=>{
      const row=document.createElement("label"); row.className="pm-kit-slot"; row.title=s.file;
      row.innerHTML=`<span>${s.slot}</span><input type="text" maxlength="80" value=""></input>`;
      row.querySelector("input").value=s.label; row.dataset.slot=s.slot; row.dataset.file=s.file; list.appendChild(row);
    });
    const status=d.querySelector(".pm-kit-status");
    d.querySelector('[value="cancel"]').onclick=()=>d.close("cancel");
    d.querySelector('[value="save"]').onclick=async()=>{
      const label=d.querySelector("#pmKitName").value.trim();
      const edited=[...list.querySelectorAll(".pm-kit-slot")].map(row=>({slot:row.dataset.slot,file:row.dataset.file,label:row.querySelector("input").value.trim()}));
      if(!label){ status.textContent="Enter a name for the machine."; status.className="pm-kit-status err"; return; }
      if(!edited.length){ status.textContent="The kit has no samples."; status.className="pm-kit-status err"; return; }
      const save=d.querySelector('[value="save"]'); save.disabled=true; status.textContent="saving…";
      try{
        const saved=meta ? await D.kits.update(meta.id,{label,slots:edited}) : await D.kits.create(stagingId,{label,slots:edited});
        registerCustomKit(saved); refreshCustomKitMenus();
        setSampleSet(saved.id); localStorage.setItem(KIT_KEY,saved.id);
        d.close("saved"); setStatus(`${saved.label} imported`);
      }catch(e){ status.textContent=e.message||"saving failed"; status.className="pm-kit-status err"; save.disabled=false; }
    };
    d.addEventListener("click",e=>{if(e.target===d)d.close("cancel")});
    d.addEventListener("close",()=>{ if(stagingId && d.returnValue!=="saved") D.kits.discard(stagingId); d.remove(); });
    document.body.appendChild(d); d.showModal(); d.querySelector("#pmKitName").focus(); d.querySelector("#pmKitName").select();
  }
  async function importCustomKit(){
    try{ const picked=await D.kits.pick(); if(picked) showKitEditor({stagingId:picked.stagingId,files:picked.files}); }
    catch(e){ setStatus(e.message||"Drum Machine import failed","err"); }
  }
  function updateKitEditorButton(){
    const b=el("pmEditMachine"); if(!b) return;
    const del=el("pmDeleteMachine");
    const custom=KITS[sampleSet]?.custom; b.hidden=!custom; b.disabled=!custom;
    if(del){ del.hidden=!custom; del.disabled=!custom; }
  }
  const machineBar=el("machinePanel")?.querySelector(".machine-bar");
  if(machineBar){
    const tools=document.createElement("div"); tools.className="pm-machine-tools";
    tools.innerHTML=`<button type="button" id="pmImportMachine" class="mini">Import Drum Machine</button><button type="button" id="pmEditMachine" class="mini" hidden>Edit machine</button><button type="button" id="pmDeleteMachine" class="mini danger" hidden>Delete machine</button><span class="pm-machine-note">folder or ZIP of audio samples</span>`;
    machineBar.appendChild(tools);
    el("pmImportMachine").onclick=importCustomKit;
    el("pmEditMachine").onclick=()=>{ const m=KITS[sampleSet]; D.kits.list().then(list=>{ const meta=list.find(x=>x.id===sampleSet); if(meta) showKitEditor({meta}); }); };
    el("pmDeleteMachine").onclick=async()=>{
      const id=sampleSet, kit=KITS[id];
      if(!kit?.custom) return;
      if(!await ask({title:"Delete machine",message:`Delete “${kit.label}”? The imported files will be removed from the app.`,ok:"Delete",cancel:"Cancel",danger:true})) return;
      try{
        await D.kits.delete(id); delete KITS[id];
        localStorage.setItem(KIT_KEY,"tr808"); setSampleSet("tr808"); refreshCustomKitMenus();
        setStatus(`${kit.label} deleted`);
      }catch(e){ setStatus(e.message||"delete failed","err"); }
    };
    el("kitSelect").addEventListener("change",updateKitEditorButton);
    updateKitEditorButton();
  }
  D.kits.list().then(list=>{
    list.forEach(registerCustomKit); refreshCustomKitMenus();
    const wanted=localStorage.getItem(KIT_KEY);
    if(wanted && KITS[wanted] && wanted!==sampleSet){ setSampleSet(wanted,true); el("kitSelect").value=wanted; el("libKitSelect").value=wanted; updateKitEditorButton(); }
  }).catch(()=>{});

  const SETTINGS_KEY="pm.desktop";
  const settings=Object.assign({midiOut:true, midiRouting:"drums", noteMap:"gm", internalAudio:true, follow:false, daw:"logic"},
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
        async set(data){
          // il progetto aperto e' cambiato su un altro dispositivo mentre qui c'erano modifiche:
          // la versione di qui diventa una copia, come nel sito, e l'altra resta com'e'
          if(staleOpen.has(id)){
            staleOpen.delete(id);
            const copy="p"+Date.now(), name=(data.name||"Untitled")+" (copy)";
            await D.projects.set(copy,{...data, name});
            if(currentProjectId===id){ currentProjectId=copy; el("projectName").value=name; project.name=name; }
            notify();
            // dopo il "saved" del sito, che arriva appena finisce il salvataggio
            setTimeout(()=>setStatus(`changed on another device: yours is saved as "${name}"`),50);
            return;
          }
          await D.projects.set(id,data); notify();
        },
        async get(){ const d=await D.projects.get(id); return {exists:!!d, data:()=>d}; },
        async delete(){ await D.projects.delete(id); notify(); },
      };
    },
  };
  db=fileDb;
  unsubRecent=fileDb.collection("projects").onSnapshot(s=>renderRecent(s.docs.map(d=>({id:d.id,...d.data()}))));

  // ---------- account: progetti sincronizzati con il sito ----------
  // La sincronizzazione la fa main.js sui file della cartella; qui lo stato, l'accesso e il progetto
  // aperto: se cambia altrove e qui non ci sono modifiche si ricarica, altrimenti resta com'e' e al
  // prossimo salvataggio diventa una copia.
  const staleOpen=new Set();
  D.projects.onChanged(ch=>{
    (ch.renamed||[]).forEach(r=>{
      if(currentProjectId!==r.from) return;
      const clean=projectSnap()===savedSnap;
      currentProjectId=r.to; el("projectName").value=r.name; project.name=r.name;
      if(clean) markSaved();
      setStatus(`changed on another device: yours is saved as "${r.name}"`);
    });
    if((ch.deleted||[]).includes(currentProjectId)) currentProjectId=null;
    if((ch.updated||[]).includes(currentProjectId)){
      const id=currentProjectId;
      if(projectSnap()===savedSnap) D.projects.get(id).then(d=>{
        if(d && currentProjectId===id){ deserialize(d,true); markSaved(); setStatus("updated from another device"); }
      });
      else staleOpen.add(id);
    }
    notify(); markCurrentRecent();
  });

  const acct=document.createElement("div"); acct.className="pm-account";
  acct.innerHTML=`<span class="tiny" id="pmAccount"></span>
    <button type="button" class="mini primary" id="pmSignIn">Sign in</button>
    <button type="button" class="mini" id="pmSyncNow" hidden>Sync now</button>
    <button type="button" class="mini" id="pmSignOut" hidden>Sign out</button>`;
  el("recentTitle").after(acct);
  function paintAccount(st){
    const on=!!st.name && !["signed-out","expired"].includes(st.state);
    const time=st.at ? new Date(st.at).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}) : "";
    const text={
      "signed-out":"Sign in with your PatternMachine account to sync these projects with the website and your other computers.",
      expired:"Session expired: sign in again to keep syncing.",
      syncing:`Signed in as ${st.name} · syncing…`,
      ok:`Signed in as ${st.name} · synced ✓${time?" "+time:""}`,
      error:`Signed in as ${st.name} · ${st.message||"sync failed"}`,
    }[st.state]||"";
    const a=el("pmAccount"); a.textContent=text; a.className="tiny"+(st.state==="error"||st.state==="expired"?" err":"");
    el("pmSignIn").hidden=on; el("pmSyncNow").hidden=!on; el("pmSignOut").hidden=!on;
    el("pmSyncNow").disabled=st.state==="syncing";
  }
  D.account.onState(paintAccount);
  D.account.status().then(paintAccount);
  el("pmSyncNow").onclick=()=>D.account.sync();
  el("pmSignOut").onclick=async()=>{
    if(!await ask({title:"Sign out", message:"The projects stay in the Projects folder; they stop syncing until you sign in again.", ok:"Sign out"})) return;
    D.account.logout();
  };
  el("pmSignIn").onclick=()=>{
    const d=document.createElement("dialog"); d.className="pm-kit-dialog pm-login-dialog"; d.setAttribute("aria-labelledby","pmLoginTitle");
    d.innerHTML=`<form>
      <h3 id="pmLoginTitle">Sign in</h3>
      <p>Use your PatternMachine account: the projects in this app and on the website stay the same everywhere. The password is sent only to the PatternMachine server and is not stored.</p>
      <label>Name or email<input type="text" id="pmLoginName" autocomplete="username" required></label>
      <label>Password<input type="password" id="pmLoginPass" autocomplete="current-password" required></label>
      <p class="pm-kit-status" role="status"></p>
      <p class="pm-login-links"><a href="#" data-page="register">Create an account</a> · <a href="#" data-page="forgot">Forgot your password?</a></p>
      <div class="pm-kit-actions"><button type="button" value="cancel">Cancel</button><button type="submit" value="ok" class="primary">Sign in</button></div>
    </form>`;
    const status=d.querySelector(".pm-kit-status"), okB=d.querySelector('[value="ok"]');
    d.querySelectorAll("[data-page]").forEach(a=>a.onclick=e=>{ e.preventDefault(); D.account.open(a.dataset.page); });
    d.querySelector('[value="cancel"]').onclick=()=>d.close("cancel");
    d.querySelector("form").onsubmit=async e=>{
      e.preventDefault();
      const name=d.querySelector("#pmLoginName").value.trim(), pass=d.querySelector("#pmLoginPass").value;
      if(!name || !pass){ status.textContent="Enter name and password."; status.className="pm-kit-status err"; return; }
      okB.disabled=true; status.textContent="signing in…"; status.className="pm-kit-status";
      const r=await D.account.login(name,pass);
      if(r.ok){ d.close("ok"); setStatus("signed in as "+r.name); return; }
      status.textContent=r.error; status.className="pm-kit-status err"; okB.disabled=false;
      d.querySelector("#pmLoginPass").select();
    };
    d.addEventListener("click",e=>{ if(e.target===d) d.close("cancel"); });
    d.addEventListener("close",()=>d.remove());
    document.body.appendChild(d); d.showModal(); d.querySelector("#pmLoginName").focus();
  };

  const siteSetStatus=setStatus;
  setStatus=(msg,kind)=>siteSetStatus(String(msg).replace("· cloud","· to file"),kind);

  // ---------- esportazioni con dialogo nativo ----------
  // Il pacchetto per Logic esce come cartella gia' scompattata: si intercettano i file passati a makeZip.
  let lastExport=null, zipFiles=null;
  const siteMakeZip=makeZip;
  makeZip=files=>{ zipFiles=files; return siteMakeZip(files); };
  downloadsCap={
    async save({filename, data}){
      if(zipFiles && /\.zip$/.test(filename)){
        const files=zipFiles; zipFiles=null;
        const result=await D.exportFolder(files);
        if(result?.canceled){ const e=new Error("save cancelled"); e.code="declined"; throw e; }
        lastExport=result.path;
      } else {
        const result=await D.exportFile(filename, new Uint8Array(await data.arrayBuffer()));
        if(result?.canceled){ const e=new Error("save cancelled"); e.code="declined"; throw e; }
        lastExport=result.path;
      }
      paintExport();
    },
  };

  // ---------- uscita MIDI ----------
  // Ogni colpo suonato dal vivo (Play, pad, ascolto) diventa una nota sulla porta virtuale "PatternMachine".
  // L'audio e' programmato in anticipo sul tempo di audioCtx: la nota parte con lo stesso anticipo.
  const MIDI_CH=9, NOTE_MS=90;
  const MIDI_TRACK_CHANNELS=[0,1,2,3,4,5,6,7,8,10,11,12,13,14,15,9];
  let outBox=[];
  const noteOf=i=>settings.noteMap==="sp"?midiNoteFor(i):gmNoteFor(i);
  const channelOf=track=>{
    if(settings.midiRouting!=="multi") return MIDI_CH;
    const i=Math.max(0,project.tracks.indexOf(track));
    return MIDI_TRACK_CHANNELS[i%MIDI_TRACK_CHANNELS.length];
  };
  function queueNote(track,time,velocity){
    const vel=Math.max(1,Math.min(127,Math.round(velocity*(track.vol??0.8)*127)));
    const delay=Math.max(0,(time-audioCtx.currentTime)*1000);
    if(!outBox.length) queueMicrotask(()=>{ D.midi.notes(outBox); outBox=[]; });
    outBox.push({ch:channelOf(track), note:noteOf(track.sampleIndex), vel, delay, dur:NOTE_MS});
  }
  const siteTrigger=trigger;
  trigger=function(track,time,velocity,ctx){
    const live=!ctx || ctx===audioCtx;
    if(live && settings.midiOut && velocity>0) queueNote(track,time,velocity);
    if(live && !settings.internalAudio) return;
    return siteTrigger.apply(this,arguments);
  };

  // ---------- segui il clock della DAW ----------
  // La DAW invia MIDI Clock e Song Position alla porta virtuale "PatternMachine".
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
    if(!synthOnly && ui.metronome && cursor.step%4===0) metronomeHit(at,cursor.step===0);
    const cycle=ui.mode==="song" ? (cursor.rep||0) : (cursor.loops||0);
    const blockMutes=ui.mode==="song" ? (project.song[cursor.blockIndex]?.mutes||[]) : [];
    if(!synthOnly && !drumsSilent()) audibleTracks().forEach(t=>{
      if(blockMutes.includes(t.id)) return;
      const i=stepIdx(pat,t.id,cursor.step,cycle);
      const v=(pat.grid[t.id]||[])[i];
      if(!v) return;
      const m=modOf(pat,t.id,i);
      if(!stepPlays(m)) return;
      const tr=lockedTrack(t,m), j=jitterT(), jv=jitterV();
      stepHits(m,dur,FLAM_SEC).forEach(([h,f])=>trigger(tr, at+nudgeOf(t)+j+h, stepVel(v)*f*jv));
    });
    const syn=synthNow(pat);
    if(window.PMSynth && syn && !drumsOnly) PMSynth.step(syn.sp, syn.step, at);
    queue.push({time:at, dur, step:cursor.step, cycle, rep:cursor.rep||0, patternId:pat.id, blockIndex:cursor.blockIndex, bar:barCount,
      synthId:syn?syn.sp.id:null, synthStep:syn?syn.step:-1, synthIndex:syn?syn.index:-1});
    cursor.step++; cursor.abs=(cursor.abs||0)+1;
    if(cursor.step>=pat.len){
      cursor.step=0; barCount++; cursor.loops=(cursor.loops||0)+1;
      if(ui.mode==="song"){
        cursor.rep++;
        const block=project.song[cursor.blockIndex];
        if(cursor.rep>=Math.max(1,block?.repeats||1)){
          cursor.rep=0;
          const soloIdx=ui.songSoloBlockId ? project.song.findIndex(b=>b.id===ui.songSoloBlockId) : -1;
          cursor.blockIndex=soloIdx>=0 ? soloIdx : (cursor.blockIndex+1)%Math.max(1,project.song.length);
        }
      }
    }
  }
  // Il campo BPM segue la DAW (arrotondato: il sito lavora a BPM interi; il passo resta quello del clock).
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
    if(w==="song" && !project.song.length) return setStatus("the song is empty","err");
    if(kind==="midi"){
      const multi=settings.midiRouting==="multi" && settings.noteMap!=="sp";
      D.startDrag(exportBase(w)+(multi?" - multitrack.mid":".mid"), multi?buildMultiMidi(w):(settings.noteMap==="sp"?buildMidi(w):buildLogicMidi(w)));
    } else {
      const r=await wavJob;
      if(!r) return setStatus("nothing to drag: the pattern is empty or all muted","err");
      D.startDrag(r.name, new Uint8Array(await r.blob.arrayBuffer()));
    }
  }

  // ---------- pannello ----------
  const dawNames={logic:"Logic Pro", ableton:"Ableton Live", reaper:"REAPER", fl:"FL Studio", cubase:"Cubase", bitwig:"Bitwig", studioone:"Studio One", garageband:"GarageBand", other:"your DAW"};
  const panel=document.createElement("div");
  panel.className="panel pm-desk";
  panel.innerHTML=`
    <div class="flexline">
      <span class="pm-desk-title">DAW</span>
      <span class="pm-drag" draggable="true" data-kind="midi" title="Drag onto the DAW timeline: a MIDI region">&#10303; MIDI</span>
      <span class="pm-drag" draggable="true" data-kind="wav" title="Drag onto the DAW timeline: an audio region with mixer and effects">&#10303; WAV</span>
      <span class="pm-sep"></span>
      <label class="fld" title="Choose the DAW that sends MIDI Clock; it is used to name the source in the connection status"><select data-set="daw">
        <option value="logic">Logic Pro</option><option value="ableton">Ableton Live</option><option value="reaper">REAPER</option><option value="fl">FL Studio</option><option value="cubase">Cubase</option><option value="bitwig">Bitwig</option><option value="studioone">Studio One</option><option value="garageband">GarageBand</option><option value="other">Other DAW</option>
      </select></label>
      <label class="fld" title="Notes go out on the PatternMachine virtual MIDI port: the DAW receives them like a keyboard"><input type="checkbox" data-set="midiOut"> MIDI output</label>
      <label class="fld" title="Channel 10 stays compatible with drum racks; Separate channels gives each row its own channel"><select data-set="midiRouting"><option value="drums">Channel 10</option><option value="multi">Separate channels</option></select></label>
      <label class="fld" title="General MIDI for drum racks and compatible instruments, or the PatternMachine SP-1200 kit (36 + sample number)">Notes
        <select data-set="noteMap"><option value="gm">General MIDI</option><option value="sp">Kit SP-1200 (36+)</option></select></label>
      <label class="fld" title="Turn off to hear only the DAW instruments"><input type="checkbox" data-set="internalAudio"> Internal sound</label>
      <label class="fld" title="Play, stop, position and tempo come from the MIDI Clock the DAW sends to PatternMachine"><input type="checkbox" data-set="follow"> Follow the DAW clock</label>
      <span class="tiny pm-clock" id="pmClock"></span>
      <button class="mini" id="pmReveal" style="margin-left:auto" disabled>Show last export</button>
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
    else if(following && playing) c.textContent=`▶ locked to ${dawNames[settings.daw]||"DAW"}`;
    else c.textContent=performance.now()-lastClockAt<1000 ? `clock received: press Play in ${dawNames[settings.daw]||"DAW"}` : `waiting for the clock from ${dawNames[settings.daw]||"DAW"}`;
  }
  setInterval(()=>{ if(settings.follow && !following) paintClock(); },1000);
  D.midi.status().then(s=>{
    el("pmPort").textContent=s.ok ? `MIDI port: ${s.name}` : "MIDI not available";
    if(!s.ok) el("pmPort").title=s.error||"";
  });

  const lb=el("logicBtn");
  lb.textContent="Logic (folder)";
  lb.title="Folder for Logic Pro in ~/Music/PatternMachine/Export: General MIDI file, one WAV stem per instrument, kit samples. Follows Pattern/Song";
  paintClock();
})();
