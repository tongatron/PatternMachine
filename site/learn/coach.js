// Scheda della missione di una lezione del corso (learn/) dentro la drum machine.
// index.html la carica solo con ?lesson=<id>, dopo learn/lessons.js: apre il beat della lezione in un progetto
// a parte e controlla sul progetto vero che il compito sia fatto, evidenziando il comando da usare.
// Finche' e' aperto il beat della lezione la bozza automatica va in una chiave sua (DRAFT_KEY): la bozza del
// lavoro vero resta com'e'. Se si apre un altro progetto torna quella normale e la missione va in pausa.
// Usa dall'app: project, playing, recording, serialize, deserialize, uid, sampleIdx, remapUnavailable, renderAll,
// markSaved, markCurrentRecent, undoStack, redoStack, paintUndo, setView, setMode, stop, ask, okToDiscard,
// setStatus, el, PAD_LABEL, LESSON_ID, DRAFT_MAIN, DRAFT_KEY, currentProjectId.
(function(){
"use strict";
const L=window.PMLearn, ID=LESSON_ID, M=L&&L.missions[ID];
if(!M){ setStatus(`lesson "${ID}" not found`,"err"); return; }
const LESSON_DRAFT=DRAFT_MAIN+".lesson";
const esc=t=>String(t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const S={ids:{}, patId:null, played:false, rec:false, live:false, solved:false, last:""};
const goalRow=M.rows.find(r=>r.role===M.goal.row);

// ---------- beat della lezione ----------
function openLesson(){
  if(playing) stop();
  const base=serialize();      // synth, macchina e il resto restano quelli dell'app
  const tracks=M.rows.map(r=>({id:uid(), sampleIndex:Math.max(0,sampleIdx(r.sample)), vol:r.vol??0.8, tune:0, choke:r.choke||0}));
  const pat={id:uid(), name:M.title, len:16, grid:Object.fromEntries(M.rows.map((r,i)=>[tracks[i].id, L.parseTab(r.tab,16)]))};
  S.ids=Object.fromEntries(M.rows.map((r,i)=>[r.role, tracks[i].id])); S.patId=pat.id;
  const data={...base, name:M.project, bpm:M.bpm, swing:0, human:0, tracks, patterns:[pat], song:[]};
  delete data.mix;
  DRAFT_KEY=LESSON_DRAFT;
  currentProjectId=null;
  deserialize(data); remapUnavailable(); renderAll(); markCurrentRecent(); markSaved();
  undoStack.length=0; redoStack.length=0; paintUndo();
  setView("grid"); setMode("pattern");
  Object.assign(S,{played:false, rec:false, live:false, solved:false, last:""});
  setStatus(`lesson: ${M.title}`);
  tick();
}
// E' ancora aperto il beat della lezione? (nome e righe: undo/redo lo ricreano, altri progetti no)
const lessonOpen=()=>project.name===M.project && project.tracks.some(t=>t.id===S.ids[M.goal.row]) && project.patterns.some(p=>p.id===S.patId);

// ---------- scheda: un pannello tra il trasporto e la griglia, cosi' non copre niente ----------
const css=document.createElement("style");
css.textContent=`
.pm-coach{border-color:var(--accent); box-shadow:0 0 0 1px var(--accent) inset, var(--shadow); font-size:12px; line-height:1.45;}
.pm-coach-head{display:flex; align-items:flex-start; gap:10px;}
.pm-coach-head h2{flex:1;}
.pm-coach-min{width:28px; height:24px; padding:0; font-size:13px; margin-top:-4px;}
.pm-coach-body{display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:6px 22px; align-items:start;}
.pm-coach-title{font-size:14px; font-weight:800; margin:0 0 6px;}
.pm-coach-tasks{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:3px;}
.pm-coach-tasks li{display:flex; gap:7px; align-items:baseline;}
.pm-coach-tasks li::before{content:"○"; flex:0 0 15px; text-align:center; color:var(--text-faint); font-weight:800;}
.pm-coach-tasks li.ok{color:var(--ok);}
.pm-coach-tasks li.ok::before{content:"✓"; color:var(--ok);}
.pm-coach-tasks em{font-style:normal; color:var(--danger);}
.pm-coach-msg{margin:0 0 8px; padding:8px 10px; border-radius:6px; background:var(--panel-2); border:1px solid var(--edge);}
.pm-coach.done .pm-coach-msg{background:var(--ok); border-color:var(--ok); color:var(--on-ok);}
.pm-coach-btns{display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between;}
.pm-coach-back{font-weight:700; color:var(--accent); font-size:11.5px;}
.pm-coach.min .pm-coach-body{display:none;}
.pm-coach.min h2{margin-bottom:0;}
.pm-coach-focus{outline:3px solid var(--led-head) !important; outline-offset:3px; animation:pmCoach 1.2s ease-in-out infinite;}
@keyframes pmCoach{50%{outline-color:transparent;}}
#rows .step.pm-coach-step:not(.on){box-shadow:inset 0 0 0 3px var(--ok) !important;}
@media (max-width:700px){ .pm-coach-body{grid-template-columns:1fr;} }
@media (prefers-reduced-motion:reduce){ .pm-coach-focus{animation:none;} }`;
document.head.appendChild(css);

const box=document.createElement("aside");
box.className="panel pm-coach"; box.setAttribute("aria-label",`Lesson mission: ${M.title}`);
box.innerHTML=`<div class="pm-coach-head"><h2>Lesson · ${esc(M.title)}</h2>`
  +`<button type="button" class="pm-coach-min" aria-expanded="true" title="Hide or show the mission">–</button></div>`
  +`<div class="pm-coach-body"><div><p class="pm-coach-title">Mission: ${esc(M.task)}</p><ol class="pm-coach-tasks"></ol></div>`
  +`<div><p class="pm-coach-msg" aria-live="polite"></p><div class="pm-coach-btns">`
  +`<a class="pm-coach-back" href="${esc(M.back)}">← Back to the lesson</a><button type="button" class="pm-coach-again">Start over</button></div></div></div>`;
el("panelGrid").before(box);
const q=s=>box.querySelector(s);
q(".pm-coach-min").onclick=()=>{
  const min=box.classList.toggle("min");
  q(".pm-coach-min").textContent=min?"+":"–"; q(".pm-coach-min").setAttribute("aria-expanded",String(!min));
};
q(".pm-coach-again").onclick=async()=>{
  if(lessonOpen()){
    if(!await ask({title:"Start the mission over?", message:"The lesson beat is loaded again: your changes to it are lost.", ok:"Start over"})) return;
  } else if(!await okToDiscard("Load the lesson beat")) return;
  openLesson();
};

// Evidenzia i comandi da usare adesso (Play, Rec, gli step della riga) e toglie gli altri.
function focusOn(els, steps){
  document.querySelectorAll(".pm-coach-focus").forEach(x=>{ if(!els.includes(x)) x.classList.remove("pm-coach-focus"); });
  els.forEach(x=>x&&x.classList.add("pm-coach-focus"));
  document.querySelectorAll(".pm-coach-step").forEach(x=>{ if(!steps.includes(x)) x.classList.remove("pm-coach-step"); });
  steps.forEach(x=>x&&x.classList.add("pm-coach-step"));
}

let lastHtml="", lastMsg="";
function paint(tasks, msg, done){
  const html=tasks.map(t=>`<li class="${t.ok?"ok":""}">${t.html}</li>`).join("");
  if(html!==lastHtml){ q(".pm-coach-tasks").innerHTML=html; lastHtml=html; }
  if(msg!==lastMsg){ q(".pm-coach-msg").innerHTML=msg; lastMsg=msg; }
  box.classList.toggle("done",!!done);
  q(".pm-coach-again").textContent=lessonOpen()?"Start over":"Load the lesson beat";
}

// ---------- controllo, 4 volte al secondo ----------
function tick(){
  if(!lessonOpen()){
    DRAFT_KEY=DRAFT_MAIN;           // un altro progetto: la sua bozza va dove va sempre
    focusOn([],[]);
    paint([], "You opened another project, so the mission is paused. Load the lesson beat to carry on.", false);
    return;
  }
  DRAFT_KEY=LESSON_DRAFT;
  const idx=project.tracks.findIndex(t=>t.id===S.ids[M.goal.row]);
  const key=PAD_LABEL[idx]||"", pat=project.patterns.find(p=>p.id===S.patId);
  const lv=(pat.grid[S.ids[M.goal.row]]||[]).slice(0,16), now=lv.join("");
  // colpi nuovi mentre Rec registra: la missione e' stata suonata dal vivo
  if(now!==S.last){ if(recording && playing && lv.some((v,i)=>v && !+(S.last[i]||0))) S.live=true; S.last=now; }
  if(playing) S.played=true;
  if(recording) S.rec=true;
  const res=L.checkGoal(lv,M.goal), label=goalRow.label.toLowerCase();
  const steps=M.goal.steps.map(i=>`${i+1}`).join(" and ");
  const tasks=[{ok:S.played, html:"Press <b>Play</b> or the space bar"}]
    .concat(res.items.map(x=>({ok:x.ok, html:esc(x.text)+(x.note&&!x.ok?` <em>(${esc(x.note)})</em>`:"")})));
  let msg;
  if(res.solved) msg=S.live ? `<b>Mission complete</b>: a backbeat played live. Go back to the lesson, or keep playing with it.`
                            : `<b>Mission complete!</b> Next time try recording it live: <b>Rec</b>, then <kbd>${key}</kbd> on beats 2 and 4.`;
  else if(res.extra.length) msg=`Take out the ${label} on step ${res.extra.map(i=>i+1).join(", ")}: click it.`;
  else if(!S.played) msg=`Kick and hi-hat are ready. Press <b>Play</b> (or the space bar) and listen for a bar or two.`;
  else if(recording && !playing) msg=`Rec is on: press <b>Play</b>, then <kbd>${key}</kbd> on beats 2 and 4.`;
  else if(recording) msg=`Press <kbd>${key}</kbd> on beats 2 and 4. Count along: one, <b>two</b>, three, <b>four</b>.`;
  else msg=`Turn on <b>Rec</b>, then press <kbd>${key}</kbd> on beats 2 and 4. Or click steps ${steps} on the ${esc(goalRow.label)} row (row ${idx+1}).`;
  if(res.solved && !S.solved) L.progress.mark(ID,"mission");
  S.solved=res.solved;
  paint(tasks, msg, res.solved);
  // cosa evidenziare: Play finche' non parte, poi Rec e gli step che mancano
  const row=el("rows").children[idx], stepEls=row?[...row.querySelectorAll(".steps .step")]:[];
  const missing=res.solved?[]:M.goal.steps.filter(i=>!lv[i]).map(i=>stepEls[i]);
  const pad=row&&row.querySelector(".pad");
  if(res.solved) focusOn([],[]);
  else if(!S.played) focusOn([el("playBtn")],[]);
  else if(!recording) focusOn([el("recBtn")],missing);
  else focusOn(playing?[pad]:[el("playBtn")],missing);
}

openLesson();
setInterval(tick,250);
})();
