// Corso di PATTERN-MACHINE (learn/): livelli, lezioni, missioni nell'app e avanzamento.
// Lo usano le pagine del corso, la mini drum machine (mini.js) e la scheda della missione dentro
// l'app (coach.js, caricata da index.html solo con ?lesson=<id>).
// I pattern si scrivono come drum tab, il formato che l'Import dell'app sa gia' leggere:
// uno step per carattere (16 = una battuta), X accento, x normale, g ghost, - pausa.
(function(){
"use strict";

// Il percorso completo. Una lezione con `url` e' pronta; le altre compaiono nell'indice come "soon".
const LEVELS=[
  {id:"basics", title:"First steps", titleIt:"Primi passi", lessons:[
    {id:"drum-machine", title:"What a drum machine does", titleIt:"Cosa fa una drum machine", url:"drum-machine.html", minutes:8, summary:"Hear sounds become a beat: rows, steps and playback."},
    {id:"time", title:"Tempo, bars and steps", titleIt:"Tempo, battute e step", url:"time.html", minutes:8, summary:"Count a bar of 4/4 and place four quarter-note kicks."},
    {id:"kit", title:"The drum kit", titleIt:"La batteria", url:"kit.html", minutes:8, summary:"Meet kick, snare and hi-hat, then build a first beat."},
    {id:"tour", title:"A tour of PATTERN-MACHINE", titleIt:"Un giro di PATTERN-MACHINE", url:"tour.html", minutes:10, summary:"Use the grid, transport and keyboard together."}]},
  {id:"steps", title:"Step programming", titleIt:"Programmazione step", lessons:[
    {id:"four-on-the-floor", title:"Four on the floor", titleIt:"Four on the floor", url:"four-on-the-floor.html", minutes:10, summary:"Put the kick on every quarter note and feel the steady pulse."},
    {id:"backbeat", title:"The backbeat", titleIt:"Il backbeat", url:"backbeat.html", minutes:10,
      summary:"Snare or clap on beats 2 and 4: hear it, place it, play it with the keys, build it in the drum machine."},
    {id:"hihats", title:"Hi-hats: eighths, sixteenths, open", titleIt:"Hi-hat: ottavi, sedicesimi, aperti", url:"hihats.html", minutes:10, summary:"Make the hi-hat move from eighths to sixteenths and open it on the offbeat."},
    {id:"classic-beats", title:"Classic beats: rock and boom bap", titleIt:"Beat classici: rock e boom bap", url:"classic-beats.html", minutes:10, summary:"Build two familiar grooves and hear what changes between them."},
    {id:"syncopation", title:"Rests and syncopation", titleIt:"Pause e sincopi", url:"syncopation.html", minutes:10, summary:"Leave space, then move a kick away from the obvious beats."}]},
  {id:"dynamics", title:"Dynamics", titleIt:"Dinamica", lessons:[
    {id:"accents", title:"Accents and ghost notes", titleIt:"Accenti e ghost notes", url:"accents.html", minutes:10, summary:"Use three hit levels to make a pattern speak."},
    {id:"hihat-dynamics", title:"Hi-hat dynamics", titleIt:"La dinamica degli hi-hat", url:"hihat-dynamics.html", minutes:10, summary:"Shape a steady hi-hat line with accents and ghost hits."},
    {id:"ghost-snare", title:"Ghost notes on the snare", titleIt:"Ghost notes sul rullante", url:"ghost-snare.html", minutes:10, summary:"Add quiet snare notes without taking over the backbeat."},
    {id:"levels", title:"Levels and the Mixer", titleIt:"Livelli e Mixer", url:"levels.html", minutes:10, summary:"Balance rows with levels and the Mixer."}]},
  {id:"keys", title:"Playing with the keyboard", titleIt:"Suonare con la tastiera", lessons:[
    {id:"key-map", title:"The key map", titleIt:"La mappa dei tasti", url:"key-map.html", minutes:10, summary:"Learn the 4×4 keyboard layout and find every drum row."},
    {id:"timing", title:"Playing in time", titleIt:"Suonare a tempo", url:"timing.html", minutes:10, summary:"Listen, count and land hits on the nearest step."},
    {id:"recording", title:"Recording with Rec", titleIt:"Registrare con Rec", url:"recording.html", minutes:10, summary:"Record a pattern from the keyboard while the loop plays."},
    {id:"no-mouse", title:"The grid without a mouse", titleIt:"La griglia senza mouse", url:"no-mouse.html", minutes:10, summary:"Navigate, edit and undo with the keyboard."},
    {id:"midi-pads", title:"MIDI pads", titleIt:"Pad MIDI", url:"midi-pads.html", minutes:10, summary:"Use pads for rows and transport, then remap a control."}]},
  {id:"groove", title:"Groove and sound", titleIt:"Groove e suono", lessons:[
    {id:"swing", title:"Swing and humanize", titleIt:"Swing e humanize", url:"swing.html", minutes:10, summary:"Move the offbeats and add controlled variation."},
    {id:"step-params", title:"Probability, ratchets and flams", titleIt:"Probabilità, ratchet e flam", url:"step-params.html", minutes:10, summary:"Make steps repeat, split and surprise you."},
    {id:"polyrhythm", title:"Polyrhythms and Euclidean rhythms", titleIt:"Poliritmi e ritmi euclidei", url:"polyrhythm.html", minutes:10, summary:"Fit different repeating cycles into the same bar."},
    {id:"kit-shaping", title:"Shaping the kit", titleIt:"Dare forma al kit", url:"kit-shaping.html", minutes:10, summary:"Choose sounds, tune them and make a kit your own."}]},
  {id:"song", title:"From pattern to song", titleIt:"Dal pattern alla canzone", lessons:[
    {id:"sections", title:"Verse, chorus and break", titleIt:"Strofa, ritornello e break", url:"sections.html", minutes:10, summary:"Give patterns a role and arrange contrasting sections."},
    {id:"fills", title:"Fills", titleIt:"Fill", url:"fills.html", minutes:10, summary:"Use a short fill to lead into the next section."},
    {id:"sequencer", title:"The Sequencer", titleIt:"Il Sequencer", url:"sequencer.html", minutes:10, summary:"Chain blocks, repeats and pattern changes into a timeline."},
    {id:"form", title:"Song form", titleIt:"La forma della canzone", url:"form.html", minutes:10, summary:"Plan an intro, build, drop and ending that make musical sense."}]},
  {id:"styles", title:"Styles", titleIt:"Stili", lessons:[
    {id:"boom-bap", title:"Boom bap", titleIt:"Boom bap", url:"boom-bap.html", minutes:10, summary:"Leave space around the snare and let the kick answer."}, {id:"electro", title:"Electro", titleIt:"Electro", url:"electro.html", minutes:10, summary:"Combine a precise drum-machine pulse with syncopated accents."}, {id:"house", title:"House", titleIt:"House", url:"house.html", minutes:10, summary:"Build the four-on-the-floor pulse and keep the hats moving."},
    {id:"techno", title:"Techno", titleIt:"Techno", url:"techno.html", minutes:10, summary:"Make repetition evolve through hats, accents and space."}, {id:"trap", title:"Trap", titleIt:"Trap", url:"trap.html", minutes:10, summary:"Use half-time weight, hats and a late kick response."}, {id:"breakbeat", title:"Breakbeat and drum & bass", titleIt:"Breakbeat e drum & bass", url:"breakbeat.html", minutes:10, summary:"Break the regular pulse and keep the loop driving forward."},
    {id:"funk", title:"Funk", titleIt:"Funk", url:"funk.html", minutes:10, summary:"Lock kick, snare and ghost notes into a pocket."}, {id:"reggae", title:"Reggae", titleIt:"Reggae", url:"reggae.html", minutes:10, summary:"Put the emphasis behind the beat and leave room around it."}, {id:"dembow", title:"Dembow", titleIt:"Dembow", url:"dembow.html", minutes:10, summary:"Hear the characteristic two-bar kick and snare conversation."},
    {id:"afrobeat", title:"Afrobeat", titleIt:"Afrobeat", url:"afrobeat.html", minutes:10, summary:"Layer interlocking percussion over a patient groove."}, {id:"bossa", title:"Bossa nova and samba", titleIt:"Bossa nova e samba", url:"bossa.html", minutes:10, summary:"Use syncopation and cross-rhythms without losing the bar."}, {id:"synth-pop", title:"Synth pop", titleIt:"Synth pop", url:"synth-pop.html", minutes:10, summary:"Make a clean, memorable machine groove around the synth."},
    {id:"post-punk", title:"Post-punk drum machine", titleIt:"Drum machine post-punk", url:"post-punk.html", minutes:10, summary:"Turn a dry machine pulse into post-punk tension."}, {id:"coldwave", title:"Coldwave and minimal synth", titleIt:"Coldwave e minimal synth", url:"coldwave.html", minutes:10, summary:"Use sparse patterns, sequenced bass and dark space."}, {id:"industrial", title:"Industrial and EBM", titleIt:"Industrial ed EBM", url:"industrial.html", minutes:10, summary:"Make a rigid, physical groove from hard machine pulses."},
    {id:"trip-hop", title:"Trip-hop", titleIt:"Trip-hop", url:"trip-hop.html", minutes:10, summary:"Let a sparse, behind-the-grid beat breathe."}, {id:"indie-dance", title:"Indie dance", titleIt:"Indie dance", url:"indie-dance.html", minutes:10, summary:"Join a club pulse to guitars, bass and human-feeling parts."}, {id:"lo-fi-indie", title:"Lo-fi indie", titleIt:"Lo-fi indie", url:"lo-fi-indie.html", minutes:10, summary:"Use simple, dry patterns that leave the song exposed."}]},
];

// Le parti di una lezione, nell'ordine in cui si fanno: la lezione e' finita quando ci sono tutte.
const PARTS={
  "drum-machine":["listen","copy","play"],
  time:["listen","copy","play"],
  kit:["listen","copy","play"],
  tour:["listen","copy","play"],
  backbeat:["listen","copy","record","mission"], "four-on-the-floor":["listen","copy","play"]
  ,hihats:["listen","copy","play"], "classic-beats":["listen","copy","play"], syncopation:["listen","copy","play"],
  accents:["listen","copy","play"], "hihat-dynamics":["listen","copy","play"], "ghost-snare":["listen","copy","play"], levels:["listen","copy","play"],
  "key-map":["listen","copy","play"], timing:["listen","copy","play"], recording:["listen","copy","play"], "no-mouse":["listen","copy","play"], "midi-pads":["listen","copy","play"],
  swing:["listen","copy","play"], "step-params":["listen","copy","play"], polyrhythm:["listen","copy","play"], "kit-shaping":["listen","copy","play"],
  sections:["listen","copy","play"], fills:["listen","copy","play"], sequencer:["listen","copy","play"], form:["listen","copy","play"]
  ,"boom-bap":["listen","copy","play"], electro:["listen","copy","play"], house:["listen","copy","play"], techno:["listen","copy","play"], trap:["listen","copy","play"], breakbeat:["listen","copy","play"], funk:["listen","copy","play"], reggae:["listen","copy","play"], dembow:["listen","copy","play"], afrobeat:["listen","copy","play"], bossa:["listen","copy","play"], "synth-pop":["listen","copy","play"], "post-punk":["listen","copy","play"], coldwave:["listen","copy","play"], industrial:["listen","copy","play"], "trip-hop":["listen","copy","play"], "indie-dance":["listen","copy","play"], "lo-fi-indie":["listen","copy","play"]
};

// Missioni nell'app: il beat di partenza (righe nell'ordine dei tasti 1, 2, 3...) e l'obiettivo.
// `sample` e' il nome dello slot (lo stesso su tutte le macchine), `back` la pagina a cui tornare.
const MISSIONS={
  backbeat:{
    title:"The backbeat", task:"Put the snare on 2 and 4", project:"Lesson · The backbeat", bpm:92, back:"learn/backbeat.html#mission",
    rows:[
      {role:"kick", label:"Kick", sample:"Kick 1", tab:"X-------X-x-----", vol:0.95},
      {role:"snare", label:"Snare", sample:"Snare 1", tab:"----------------", vol:0.9},
      {role:"hat", label:"Closed hat", sample:"Closed Hat 1", tab:"x-x-x-x-x-x-x-x-", vol:0.55, choke:1},
    ],
    goal:{row:"snare", label:"Snare", steps:[4,12], exact:true},
  },
};

// ---------- drum tab ----------
const LEVEL_OF={X:2, x:1, g:3, G:3, o:1, O:2};
function parseTab(tab, len=16){
  const out=new Array(len).fill(0);
  [...String(tab||"").replace(/[|\s]/g,"")].slice(0,len).forEach((c,i)=>{ out[i]=LEVEL_OF[c]||0; });
  return out;
}
const toTab = levels => levels.map(v=>["-","x","X","g"][v]||"-").join("");

// ---------- nomi degli step ----------
// 16 step = una battuta di 4/4: i quattro sedicesimi di ogni movimento si contano "1 e & a".
const COUNT=["","e","&","a"];
const beatOf = i => Math.floor(i/4)+1;
const countOf = i => i%4 ? `${beatOf(i)} ${COUNT[i%4]}` : String(beatOf(i));
const stepName = i => { const beat=window.PMLang?.lang==="it"?"movimento":"beat"; return i%4 ? `“${countOf(i)}” (step ${i+1})` : `${beat} ${beatOf(i)} (step ${i+1})`; };

// Verifica di un obiettivo su una riga: un colpo su ciascuno degli step richiesti e, con exact,
// nessun altro colpo sulla riga (spuntato solo quando la riga ha dei colpi: vuota non vale come fatto).
// `levels` = livelli della riga (0 spento, 1 normale, 2 accento, 3 ghost).
function checkGoal(levels, goal){
  const a=levels||[];
  const italian=window.PMLang?.lang==="it", label=italian?({Kick:"Cassa",Snare:"Rullante","Hi-hat":"Hi-hat"}[goal.label]||goal.label):goal.label;
  const items=goal.steps.map(i=>({id:"s"+i, text:italian?`${label} su ${stepName(i)}`:`${label} on ${stepName(i)}`, ok:!!a[i]}));
  const extra=a.map((v,i)=>v&&!goal.steps.includes(i)?i:-1).filter(i=>i>=0);
  if(goal.exact) items.push({id:"clean", text:italian?`Nessun altro colpo di ${label.toLowerCase()}`:`No other ${goal.label.toLowerCase()} hits`, ok:!extra.length && a.some(Boolean),
    note:extra.length?`remove ${extra.map(i=>"step "+(i+1)).join(", ")}`:""});
  return {items, extra, solved:items.every(x=>x.ok)};
}

// ---------- avanzamento ----------
// Nel browser (localStorage "pm.learn"): {<lezione>: {<parte>: data ISO}}. La scheda della missione
// scrive qui dall'app, la pagina della lezione lo rilegge (evento storage se e' aperta in un'altra scheda).
const KEY="pm.learn";
function readAll(){ try{ return JSON.parse(localStorage.getItem(KEY)||"{}")||{}; }catch(e){ return {}; } }
function writeAll(all){ try{ localStorage.setItem(KEY,JSON.stringify(all)); }catch(e){} }
const progress={
  get:id=>readAll()[id]||{},
  mark(id, part){
    const all=readAll(), p=all[id]||(all[id]={});
    if(!p[part]){ p[part]=new Date().toISOString(); writeAll(all); }
    document.dispatchEvent(new CustomEvent("pmlearn:progress",{detail:{id, part}}));
    return p;
  },
  done(id){ const p=readAll()[id]||{}, parts=PARTS[id]||[]; return parts.length>0 && parts.every(k=>p[k]); },
  reset(id){ const all=readAll(); delete all[id]; writeAll(all); document.dispatchEvent(new CustomEvent("pmlearn:progress",{detail:{id}})); },
};

const lesson = id => { for(const lv of LEVELS){ const l=lv.lessons.find(x=>x.id===id); if(l) return {...l, level:lv}; } return null; };

window.PMLearn={levels:LEVELS, parts:PARTS, missions:MISSIONS, lesson, parseTab, toTab, countOf, stepName, checkGoal, progress};
})();
