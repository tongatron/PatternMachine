// Mini drum machine delle lezioni (learn/): la Drum Grid di PATTERN-MACHINE in piccolo, con gli stessi colori
// degli step, i tasti delle righe (1 2 3 4 · Q W E R · A S D F · Z X C V), Play, Rec, metronomo, annulla (cmd+Z)
// e la verifica dell'esercizio. Suona i campioni SP-1200 del sito con un motore suo: non dipende dalla pagina
// principale e non ne tocca le funzioni.
//   PMMini.create(elemento, {rows:[{id, label, sample, tab, lock, vol, choke}], bpm, controls, goal, ...})
// Opzioni: controls {rec, bpm, metronome, undo, clear}; variants [{id, label, rows:{riga: tab}}] per l'ascolto;
// guide/hint {riga: [step]} (step da indicare subito / con "Show me where"); goal {row, label, steps, exact, live};
// mark [step] evidenziati nel righello; callback onSolved, onHeard, onPlay.
(function(){
"use strict";
const L=window.PMLearn;
const tr=s=>window.PMLang?.t?window.PMLang.t(s):s;
const KEYS=["1","2","3","4","q","w","e","r","a","s","d","f","z","x","c","v"];
const VEL=[0,0.76,1,0.42];                  // come stepVel nell'app: spento, normale, accento, ghost
const LEVEL_NAME=["empty","normal","accent","ghost"];
const COUNT=["","e","&","a"];
const ROOT=new URL("../",document.currentScript.src);   // mini.js sta in learn/: i campioni sono nella radice
const KIT_DIR={std:"samples/","12bit":"samples12/"};   // SP-1200 a 16 e 12 bit: sempre presenti sul server

// ---------- audio: un solo contesto per la pagina ----------
let ctx=null, out=null;
function actx(){
  if(!ctx){
    ctx=new (window.AudioContext||window.webkitAudioContext)();
    out=ctx.createGain(); out.gain.value=0.85; out.connect(ctx.destination);
  }
  if(ctx.state==="suspended") ctx.resume();
  return ctx;
}
// Ritardo dell'uscita audio (cuffie Bluetooth: anche 150-250 ms): chi suona a orecchio preme in ritardo di
// tanto, quindi la registrazione lo toglie prima di scegliere lo step. Safari non lo dice: vale 0.
const outLag=()=>Math.min(0.25,Math.max(0,(ctx&&ctx.outputLatency)||0));
const buffers=new Map();
function load(url){
  if(!buffers.has(url)){
    const p=fetch(url).then(r=>{ if(!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(a=>new Promise((ok,ko)=>{ const q=actx().decodeAudioData(a,ok,ko); if(q&&q.then) q.then(ok,ko); }))
      .then(b=>{ buffers.set(url,b); return b; })
      .catch(e=>{ buffers.delete(url); throw e; });
    buffers.set(url,p);
  }
  return Promise.resolve(buffers.get(url));
}
const ready=url=>{ const b=buffers.get(url); return b instanceof AudioBuffer?b:null; };
// Click del metronomo, lo stesso dell'app: quarti, accento sull'1.
function click(time, accent){
  const c=actx(), o=c.createOscillator(), g=c.createGain();
  o.type="square"; o.frequency.value=accent?1320:880;
  g.gain.setValueAtTime(0.0001,time);
  g.gain.exponentialRampToValueAtTime(accent?0.18:0.11,time+0.002);
  g.gain.exponentialRampToValueAtTime(0.0001,time+0.055);
  o.connect(g).connect(out); o.start(time); o.stop(time+0.06);
}

// ---------- quale mini-macchina riceve i tasti ----------
// Quella usata per ultima (clic o focus dentro), o quella che suona. Suona una sola alla volta, come nell'app.
const all=[];
let active=null;
function activate(m){
  active=m;
  all.forEach(x=>x.host.classList.toggle("pmm-active",x===m));
}
const outside=t=>!all.some(m=>m.host.contains(t));
document.addEventListener("pointerdown",e=>{ if(outside(e.target)) activate(all.find(m=>m.playing)||null); },true);
document.addEventListener("focusin",e=>{ if(outside(e.target) && e.target!==document.body) activate(all.find(m=>m.playing)||null); });
document.addEventListener("keydown",e=>{
  const m=active;
  if(!m || e.defaultPrevented || document.querySelector("dialog[open]")) return;
  const t=e.target, tag=(t&&t.tagName)||"";
  if(tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA"||(t&&t.isContentEditable)) return;
  if(t!==document.body && t!==document.documentElement && !m.host.contains(t)) return;   // i tasti restano ai link della pagina
  if((e.metaKey||e.ctrlKey) && !e.altKey && e.key.toLowerCase()==="z"){ e.preventDefault(); e.shiftKey?m.redo():m.undo(); return; }
  if(e.metaKey||e.ctrlKey||e.altKey) return;
  if(e.code==="Space"){ e.preventDefault(); if(!e.repeat) m.toggle(); return; }
  const i=KEYS.indexOf(e.key.toLowerCase());
  if(i>=0 && i<m.rows.length && !e.repeat){ e.preventDefault(); m.pad(i); }
});
// Testina: un solo requestAnimationFrame per tutte, attivo solo mentre qualcuna suona.
let framing=false;
function frames(){
  if(framing) return;
  framing=true;
  requestAnimationFrame(function f(){
    const now=ctx?ctx.currentTime:0;
    let any=false;
    all.forEach(m=>{ if(m.playing){ any=true; m.tick(now); } });
    if(any) requestAnimationFrame(f); else framing=false;
  });
}

// ---------- DOM ----------
function make(tag, cls, html, title){
  const n=document.createElement(tag);
  if(cls) n.className=cls;
  if(html!=null) n.innerHTML=html;
  if(title) n.title=title;
  if(tag==="button") n.type="button";
  return n;
}
const PLAY_HTML='<span class="ico" aria-hidden="true">&#9654;</span> '+tr("Play");
const STOP_HTML='<span class="ico" aria-hidden="true">&#9632;</span> '+tr("Stop");

class Mini{
  constructor(host, o){
    this.host=host; this.o=o;
    this.len=o.steps||16;
    this.bpm=o.bpm||92;
    this.swing=o.swing||50;                 // percentuale MPC: 50 dritto, 66 terzina, 75 massimo
    this.kit=KIT_DIR[o.kit]?o.kit:"12bit";
    this.rows=o.rows.map((r,i)=>({...r, label:tr(r.label), key:KEYS[i], vol:r.vol??0.8, levels:L.parseTab(r.tab,this.len)}));
    this.guide=o.guide||{};
    this.variant=o.variant||(o.variants?o.variants[0].id:null);
    this.playing=false; this.recording=false; this.metronome=!!o.metronome;
    this.undoStack=[]; this.redoStack=[];
    this.live=new Set();                    // "riga:step" scritti con Rec (esercizi da registrare)
    this.timing=[];                         // ultimi colpi registrati: {label, step, ms}
    this.heard=new Set();                   // varianti ascoltate per una battuta intera
    this.solved=false;
    this.queue=[]; this.vis=null; this.chokes=new Map(); this.timer=null;
    this.build();
    if(this.variant) this.setVariant(this.variant);
    this.paint(); this.check(true); this.paintTiming();
    all.push(this);
    host.addEventListener("pointerdown",()=>activate(this));
    host.addEventListener("focusin",()=>activate(this));
  }
  url(r){ return new URL(KIT_DIR[this.kit]+r.sample+" SP-1200.wav",ROOT).href; }
  row(id){ return this.rows.find(r=>r.id===id); }

  build(){
    const o=this.o, c=o.controls||{}, h=this.host;
    h.classList.add("pmm"); h.innerHTML="";
    if(o.label) h.setAttribute("aria-label",o.label);
    h.setAttribute("role","group");
    const bar=make("div","pmm-bar");
    this.playBtn=make("button","pmm-play",PLAY_HTML,tr("Play / Stop (space bar)"));
    this.playBtn.onclick=()=>this.toggle();
    bar.append(this.playBtn);
    if(c.rec){
      this.recBtn=make("button","pmm-rec",'<span class="rec-dot" aria-hidden="true">&#9679;</span> Rec',tr("Rec: while it plays, what you play is written on the nearest step"));
      this.recBtn.setAttribute("aria-pressed","false");
      this.recBtn.onclick=()=>this.setRec(!this.recording);
      bar.append(this.recBtn);
    }
    if(c.bpm){
      const lab=make("label","pmm-fld","BPM ");
      const r=make("input"); r.type="range"; r.min=c.bpm.min||60; r.max=c.bpm.max||140; r.value=this.bpm; r.setAttribute("aria-label","Tempo in BPM");
      const val=make("output","pmm-val",String(this.bpm));
      r.oninput=()=>{ this.bpm=+r.value; val.textContent=r.value; };
      lab.append(r,val); bar.append(lab);
    }
    if(c.metronome){
      this.metroBtn=make("button","pmm-metro",tr("Metronome"),tr("Metronome on/off: a click on every beat, louder on the 1"));
      this.metroBtn.setAttribute("aria-pressed",String(this.metronome));
      this.metroBtn.onclick=()=>{ this.metronome=!this.metronome; this.paintTransport(); };
      bar.append(this.metroBtn);
    }
    if(o.variants){
      const g=make("div","pmm-variants"); g.setAttribute("role","radiogroup"); g.setAttribute("aria-label","What plays the backbeat");
      this.variantBtns=o.variants.map(v=>{
        const b=make("button","",v.label); b.setAttribute("role","radio"); b.dataset.v=v.id;
        b.onclick=()=>{ this.setVariant(v.id); if(!this.playing) this.play(); };
        g.append(b); return b;
      });
      bar.append(g);
    }
    if(o.hint){
      this.hintBtn=make("button","mini",tr("Show me where"),tr("Marks the steps to fill"));
      this.hintBtn.onclick=()=>{ this.guide={...this.guide,...o.hint}; this.hintBtn.hidden=true; this.paint(); };
      bar.append(this.hintBtn);
    }
    if(c.undo){
      this.undoBtn=make("button","mini","&#8630; "+tr("Undo"),tr("Undo the last change (⌘Z / Ctrl+Z)"));
      this.undoBtn.onclick=()=>this.undo();
      bar.append(this.undoBtn);
    }
    if(c.clear){
      this.clearBtn=make("button","mini danger",tr("Clear"),tr("Clear the rows you can edit"));
      this.clearBtn.onclick=()=>this.clear();
      bar.append(this.clearBtn);
    }
    this.counter=make("span","pmm-counter","1 . 1"); this.counter.setAttribute("aria-hidden","true");
    bar.append(this.counter);
    h.append(bar);

    const head=make("div","pmm-headline");
    this.led=make("span","pmm-led"); this.headLabel=make("span","","Ready");
    head.append(this.led,this.headLabel); h.append(head);

    const grid=make("div","pmm-grid");
    grid.style.setProperty("--steps",this.len);
    const ruler=make("div","pmm-ruler"); ruler.setAttribute("aria-hidden","true");
    const cells=make("div","pmm-cells");
    this.rulerCells=[];
    for(let i=0;i<this.len;i++){
      const s=make("span",i%4===0?`beat beat-color-${Math.floor(i/4)%4}`:"sub",i%4===0?String(i/4+1):(o.count==="beats"?"":COUNT[i%4]));
      if((o.mark||[]).includes(i)) s.classList.add("mark");
      cells.append(s); this.rulerCells.push(s);
    }
    ruler.append(make("span","pmm-spacer"),cells);
    grid.append(ruler);

    this.stepEls=[]; this.padEls=[];
    this.rows.forEach((r,ri)=>{
      const row=make("div","pmm-row"+(r.lock?" locked":""));
      const pad=make("button","pmm-pad",r.key.toUpperCase(),`Play ${r.label} (key ${r.key.toUpperCase()})`);
      pad.setAttribute("aria-label",`Play ${r.label}, key ${r.key.toUpperCase()}`);
      pad.onclick=()=>this.pad(ri);
      const name=make("span","pmm-name",r.label);
      if(r.lock){ name.title=tr("Locked in this exercise"); name.append(make("span","pmm-lock",tr("locked"))); }
      const steps=make("div","pmm-steps");
      const els=[];
      for(let i=0;i<this.len;i++){
        const b=make("button","pmm-step");
        b.tabIndex=(ri===0&&i===0)?0:-1;
        b.onclick=ev=>this.clickStep(ri,i,ev);
        b.onkeydown=ev=>this.nav(ri,i,ev);
        b.onfocus=()=>{ this.stepEls.forEach(e=>e.forEach(x=>{ x.tabIndex=-1; })); b.tabIndex=0; };
        steps.append(b); els.push(b);
      }
      this.stepEls.push(els); this.padEls.push(pad);
      row.append(pad,name,steps); grid.append(row);
    });
    h.append(grid);

    if(o.goal){ this.checksEl=make("ul","pmm-checks"); this.checksEl.setAttribute("aria-label","Exercise checks"); h.append(this.checksEl); }
    if(c.rec){ this.timingEl=make("div","pmm-timing"); h.append(this.timingEl); }
    this.msg=make("p","pmm-msg"); this.msg.setAttribute("aria-live","polite"); h.append(this.msg);
  }

  // ---------- disegno ----------
  paint(){
    const g=this.o.goal, extra=g&&g.exact ? L.checkGoal(this.row(g.row).levels,g).extra : [];
    const head=this.playing&&this.vis?this.vis.step:-1;
    this.rows.forEach((r,ri)=>{
      const guide=this.guide[r.id]||[];
      this.stepEls[ri].forEach((b,i)=>{
        const v=r.levels[i];
        b.className="pmm-step"+(i%4===0?` beat beat-color-${Math.floor(i/4)%4}`:"")
          +(v===1?" on":"")+(v===2?" on acc":"")+(v===3?" on gho":"")
          +(!v&&guide.includes(i)?" guide":"")+(g&&r.id===g.row&&extra.includes(i)?" wrong":"")+(i===head?" head":"");
        b.setAttribute("aria-pressed",String(!!v));
        b.setAttribute("aria-label",`${r.label}, step ${i+1}, ${LEVEL_NAME[v]}${!v&&guide.includes(i)?", place a hit here":""}${r.lock?", locked":""}`);
        if(r.lock) b.setAttribute("aria-disabled","true");
      });
    });
    this.paintTransport();
  }
  paintHead(){
    const s=this.playing&&this.vis?this.vis.step:-1;
    this.stepEls.forEach(els=>els.forEach((b,i)=>b.classList.toggle("head",i===s)));
    this.rulerCells.forEach((c,i)=>c.classList.toggle("now",i===s));
    this.counter.textContent=s<0?"1 . 1":`${this.vis.bar} . ${Math.floor(s/4)+1} . ${s%4+1}`;
    this.led.classList.toggle("on",s>=0);
    this.headLabel.textContent=s<0?(this.playing?tr("Starting…"):tr("Ready")):`${tr("Step")} ${s+1} · ${tr("beat")} ${Math.floor(s/4)+1}`;
  }
  paintTransport(){
    this.playBtn.classList.toggle("on",this.playing);
    this.playBtn.innerHTML=this.playing?STOP_HTML:PLAY_HTML;
    if(this.recBtn){ this.recBtn.classList.toggle("on",this.recording); this.recBtn.setAttribute("aria-pressed",String(this.recording)); }
    if(this.metroBtn){ this.metroBtn.classList.toggle("on",this.metronome); this.metroBtn.setAttribute("aria-pressed",String(this.metronome)); }
    if(this.variantBtns) this.variantBtns.forEach(b=>{ const on=b.dataset.v===this.variant; b.classList.toggle("on",on); b.setAttribute("aria-checked",String(on)); });
    if(this.undoBtn) this.undoBtn.disabled=!this.undoStack.length;
    this.paintHead();
  }
  paintTiming(){
    const box=this.timingEl; if(!box) return;
    const last=this.timing.slice(-6);
    if(!last.length){ box.innerHTML=`<p class="pmm-tl">${tr("Your timing appears here as you record: how early or late each hit was, in milliseconds.")}</p>`; return; }
    const word=ms=>ms===0?tr("right on"):ms<0?`${-ms} ms ${tr("early")}`:`${ms} ms ${tr("late")}`;
    const cls=ms=>Math.abs(ms)<=20?"tight":Math.abs(ms)<=50?"near":"off";
    const x=ms=>Math.max(0,Math.min(100,50+ms/2));   // da -100 a +100 ms
    // distanza media dallo step (anticipi e ritardi non si compensano) e da che parte si tende a cadere
    const off=Math.round(last.reduce((s,t)=>s+Math.abs(t.ms),0)/last.length), bias=last.reduce((s,t)=>s+t.ms,0)/last.length;
    box.innerHTML=`<div class="pmm-meter" aria-hidden="true"><span class="pmm-meter-l">${tr("early")}</span><span class="pmm-meter-c">${tr("on time")}</span><span class="pmm-meter-r">${tr("late")}</span>`
      +last.map((t,i)=>`<i class="${cls(t.ms)}${i===last.length-1?" last":""}" style="left:${x(t.ms)}%"></i>`).join("")+`</div>`
      +`<ul class="pmm-hits">${last.map(t=>`<li class="${cls(t.ms)}">${t.label} · step ${t.step+1} · ${word(t.ms)}</li>`).join("")}</ul>`
      +`<p class="pmm-tl">${tr("Last")} ${last.length} ${last.length===1?tr("hit"):tr("hits")}: ${tr("on average")} <b>${off} ms</b> ${tr("from the step")}${bias>10?", "+tr("mostly late"):bias<-10?", "+tr("mostly early"):""}. ${tr("Within 20 ms is tight; past 50 ms you can hear it.")}</p>`;
  }
  say(text){ this.msg.textContent=text||""; }

  // ---------- verifica ----------
  check(initial){
    const g=this.o.goal; if(!g) return;
    const res=L.checkGoal(this.row(g.row).levels,g), items=res.items.slice();
    if(g.live) items.push({id:"live", text:tr("Recorded live with Rec (not clicked)"), ok:g.steps.every(i=>this.live.has(g.row+":"+i))});
    const solved=items.every(x=>x.ok);
    this.checksEl.innerHTML=items.map(x=>`<li class="${x.ok?"ok":"todo"}"><span class="pmm-tick" aria-hidden="true">${x.ok?"&#10003;":"&#9675;"}</span>`
      +`<span>${tr(x.text)}${x.note&&!x.ok?` <em>(${tr(x.note)})</em>`:""}</span><span class="pmm-sr">${x.ok?tr(" done"):tr(" to do")}</span></li>`).join("");
    this.host.classList.toggle("pmm-solved",solved);
    if(solved && !this.solved && !initial){
      this.say(this.o.solvedText||"Well done!");
      g.steps.forEach(i=>{ const b=this.stepEls[this.rows.indexOf(this.row(g.row))][i]; b.classList.remove("win"); void b.offsetWidth; b.classList.add("win"); });
      this.o.onSolved&&this.o.onSolved(this);
    }
    this.solved=solved;
  }

  // ---------- modifica ----------
  snap(){ return JSON.stringify({rows:this.rows.map(r=>r.levels), live:[...this.live]}); }
  restore(s){
    const d=JSON.parse(s);
    this.rows.forEach((r,i)=>{ r.levels=d.rows[i].slice(); });
    this.live=new Set(d.live);
    this.paint(); this.check();
  }
  pushUndo(){
    this.undoStack.push(this.snap());
    if(this.undoStack.length>80) this.undoStack.shift();
    this.redoStack.length=0;
  }
  undo(){
    if(!this.undoStack.length){ this.say("Nothing to undo."); return; }
    this.redoStack.push(this.snap()); this.restore(this.undoStack.pop()); this.say("Undone.");
  }
  redo(){
    if(!this.redoStack.length){ this.say("Nothing to redo."); return; }
    this.undoStack.push(this.snap()); this.restore(this.redoStack.pop()); this.say("Redone.");
  }
  clear(){
    if(!this.rows.some(r=>!r.lock&&r.levels.some(Boolean))){ this.say("Nothing to clear."); return; }
    this.pushUndo();
    this.rows.forEach(r=>{ if(!r.lock) r.levels.fill(0); });
    this.live.clear(); this.timing=[]; this.paintTiming();
    this.paint(); this.check(); this.say("Cleared: ⌘Z brings it back.");
  }
  setVariant(id){
    const v=(this.o.variants||[]).find(x=>x.id===id); if(!v) return;
    this.variant=id;
    Object.entries(v.rows).forEach(([rid,tab])=>{ const r=this.row(rid); if(r) r.levels=L.parseTab(tab,this.len); });
    this.paint();
  }
  // Click sullo step come nell'app: on/off, alt = accento, shift = ghost.
  clickStep(ri, i, ev){
    const r=this.rows[ri];
    if(r.lock){ this.say(`${r.label} is locked in this exercise.`); return; }
    this.pushUndo();
    const a=r.levels;
    if(ev.altKey) a[i]=a[i]===2?0:2;
    else if(ev.shiftKey) a[i]=a[i]===3?0:3;
    else a[i]=a[i]?0:1;
    this.live.delete(r.id+":"+i);
    if(a[i] && !this.playing) this.hit(r,actx().currentTime,VEL[a[i]]);   // da fermo: senti subito il colpo
    this.paint(); this.check();
  }
  // Frecce, Home e Fine tra gli step (come nella griglia dell'app); Invio accende o spegne.
  nav(ri, i, ev){
    let r=ri, s=i;
    if(ev.key==="ArrowLeft") s--; else if(ev.key==="ArrowRight") s++;
    else if(ev.key==="ArrowUp") r--; else if(ev.key==="ArrowDown") r++;
    else if(ev.key==="Home") s=0; else if(ev.key==="End") s=this.len-1;
    else return;
    ev.preventDefault();
    const t=this.stepEls[r]&&this.stepEls[r][Math.max(0,Math.min(this.len-1,s))];
    if(t) t.focus();
  }

  // ---------- suono ----------
  hit(r, when, vel){
    const b=ready(this.url(r)); if(!b) return;
    const c=actx(), src=c.createBufferSource(), g=c.createGain();
    src.buffer=b; g.gain.value=vel*r.vol;
    src.connect(g).connect(out);
    // gruppo di choke: l'hi-hat nuovo zittisce quello di prima (chiuso e aperto)
    if(r.choke){
      const prev=this.chokes.get(r.choke);
      if(prev){ try{ prev.g.gain.setTargetAtTime(0,when,0.008); prev.src.stop(when+0.06); }catch(e){} }
      this.chokes.set(r.choke,{src,g});
    }
    src.start(when);
  }
  preload(){
    if(!this.loading) this.loading=Promise.allSettled(this.rows.map(r=>load(this.url(r)))).then(res=>{
      if(res.some(x=>x.status==="rejected")) this.say("Some sounds couldn't be loaded: check the connection and reload the page.");
    });
    return this.loading;
  }
  pad(i){
    const r=this.rows[i]; if(!r) return;
    const c=actx();
    if(ready(this.url(r))) this.hit(r,c.currentTime,1);
    else load(this.url(r)).then(()=>this.hit(r,actx().currentTime,1)).catch(()=>{});
    this.preload();
    const p=this.padEls[i]; p.classList.add("hit"); setTimeout(()=>p.classList.remove("hit"),90);
    if(this.recording){
      if(this.playing) this.record(i);
      else this.say("Rec is on: press Play (space bar), then play along.");
    }
  }
  // Rec: il colpo va sullo step piu' vicino, come recordHit nell'app. Il ritardo dell'uscita audio si toglie.
  record(i){
    const r=this.rows[i];
    if(r.lock){ this.say(`${r.label} is locked here: only the rows you can edit record.`); return; }
    const now=ctx.currentTime-outLag();
    let cur=this.vis, nxt=null;
    for(const q of this.queue){ if(q.time<=now) cur=q; else { nxt=q; break; } }
    const tgt=(!cur || (nxt && nxt.time-now < now-cur.time)) ? nxt : cur;
    if(!tgt) return;
    const ms=Math.round((now-tgt.time)*1000);
    this.pushUndo();
    if(!r.levels[tgt.step]) r.levels[tgt.step]=1;
    this.live.add(r.id+":"+tgt.step);
    this.timing.push({label:r.label, step:tgt.step, ms});
    if(this.timing.length>12) this.timing.shift();
    this.paint(); this.paintTiming(); this.check();
  }
  setRec(on){
    this.recording=on; this.paintTransport();
    this.say(on ? (this.playing ? "Recording: play the keys." : "Rec is on: press Play (space bar), then play along.") : "Rec off: the keys just play.");
  }

  // ---------- trasporto ----------
  stepDur(s){
    const sw=Math.max(0,Math.min(0.5,(this.swing-50)/50));   // 50..75% -> 0..0.5, come swing() nell'app
    return 60/this.bpm/4*(s%2===0?1+sw:1-sw);
  }
  schedule(){
    const c=ctx;
    while(this.next<c.currentTime+0.12){
      const s=this.step, t=this.next;
      if(this.metronome && s%4===0) click(t,s===0);
      this.rows.forEach(r=>{ const v=r.levels[s]; if(v) this.hit(r,t,VEL[v]); });
      this.queue.push({time:t, step:s, bar:this.bar});
      this.next+=this.stepDur(s);
      this.step=(s+1)%this.len;
      if(this.step===0) this.bar++;
    }
  }
  tick(now){
    let moved=false;
    while(this.queue.length && this.queue[0].time<=now){
      this.vis=this.queue.shift(); moved=true;
      const s=this.vis.step;
      // una battuta intera con la stessa variante = variante ascoltata
      if(s===0) this.barVariant=this.variant;
      if(s===this.len-1 && this.variant && this.barVariant===this.variant && !this.heard.has(this.variant)){
        this.heard.add(this.variant); this.o.onHeard&&this.o.onHeard(this.heard,this);
      }
    }
    if(moved) this.paintHead();
  }
  async play(){
    all.forEach(m=>{ if(m!==this && m.playing) m.stop(); });
    activate(this);
    const c=actx();
    this.playing=true; this.vis=null; this.paintTransport();
    await this.preload();
    if(!this.playing) return;                        // fermata mentre caricava
    this.step=0; this.bar=1; this.queue=[]; this.barVariant=null;
    this.next=c.currentTime+0.08;
    clearInterval(this.timer); this.timer=setInterval(()=>this.schedule(),25);
    this.schedule(); frames();
    if(this.recording) this.say("Recording: play the keys.");
    this.o.onPlay&&this.o.onPlay(this);
  }
  stop(){
    this.playing=false;
    clearInterval(this.timer); this.timer=null; this.queue=[]; this.vis=null;
    this.paintTransport();
  }
  toggle(){ this.playing?this.stop():this.play(); }
}

window.PMMini={create:(host,o)=>new Mini(host,o), all};
})();
