// Import di pattern da altri formati. Solo lettura dei file: niente pagina, niente audio da suonare.
// Ogni lettore restituisce la stessa forma:
//   {name, bpm, map, sections:[{name, len, hits:[{pos, note, vel}]}], order?}
// pos in sedicesimi dall'inizio della sezione (anche con la virgola: la pagina arrotonda),
// note = nota MIDI (General MIDI, o la mappa del kit di PATTERN-MACHINE se map === "pm"), vel 1..127.
// len = lunghezza della sezione in sedicesimi; order = indici delle sezioni nell'ordine della canzone.
(function(){
"use strict";

// ---------- nomi degli strumenti -> nota General MIDI ----------
// Usato da drum tab, Hydrogen e MusicXML, che chiamano gli strumenti per nome.
const NAME_RULES=[
  [/\b(open|aperto)\b.*\b(h(i|igh)?[- ]?hat|hh)\b|\b(ohh?|hho|oh)\b/i,46],
  [/\bpedal|\bfoot|\bhf\b|\bph\b/i,44],
  [/h(i|igh)?[- ]?hat|\bhh\b|\bchh?\b|\bhats?\b/i,42],
  [/kick|bass ?drum|\bbd\b|\bkd\b|\bk\b|\bb\b|cassa/i,36],
  [/\brim|stick|\brs\b|side ?stick/i,37],
  [/clap|\bcp\b|\bhc\b|\bcl\b|snap/i,39],
  [/snare|\bsd\b|\bsn\b|\bs\b|rullante/i,38],
  [/chin|\bcn\b/i,52],
  [/splash|\bspl?\b/i,55],
  [/cow/i,56],
  [/bell/i,53],
  [/ride|\brc\b|\brd\b|\br\b/i,51],
  [/crash|\bcc\b|\bcr\b|\bc\b|cymbal|piatto/i,49],
  [/tamb/i,54],
  [/(hi|high|alto)\s*tom|tom\s*(hi|high|1)\b|\bt1\b|\bht\b/i,50],
  [/(low|floor)\s*tom|tom\s*(low|floor|3)\b|\bt3\b|\bft\b|\blt\b/i,43],
  [/tom|\bt2\b|\bmt\b|\bt\b/i,47],
  [/conga/i,63],[/bongo/i,60],[/timbal/i,65],[/agogo/i,67],
  [/cabasa/i,69],[/shaker|maraca/i,70],[/clave/i,75],[/guiro/i,73],
  [/triang/i,81],[/vibra/i,58],[/wood|block/i,76],[/perc/i,76],
];
function nameToNote(name){
  const n=String(name||"").trim();
  if(!n) return null;
  for(const [re,note] of NAME_RULES) if(re.test(n)) return note;
  return null;
}

// ---------- MIDI (.mid, .midi, .kar, .rmi) ----------
function parseMidi(buf, name){
  const d=new DataView(buf), u8=new Uint8Array(buf);
  const str=(o,n)=>String.fromCharCode(...u8.slice(o,o+n));
  if(str(0,4)!=="MThd") throw new Error("not a MIDI file");
  const ntr=d.getUint16(10), div=d.getUint16(12);
  if(div&0x8000) throw new Error("SMPTE-timed MIDI isn't supported");
  let o=8+d.getUint32(4), bpm=null, title=null, num=4, den=4, endTick=0;
  const notes=[];
  for(let t=0;t<ntr && o+8<=u8.length;t++){
    if(str(o,4)!=="MTrk"){ o+=8+d.getUint32(o+4); continue; }
    const end=Math.min(u8.length, o+8+d.getUint32(o+4));
    let p=o+8, tick=0, status=0, trackEnd=0;
    const notesBefore=notes.length;
    const vlq=()=>{ let v=0,b; do{ b=u8[p++]; v=(v<<7)|(b&0x7f); }while(b&0x80 && p<end); return v; };
    while(p<end){
      tick+=vlq();
      if(u8[p]&0x80){ status=u8[p]; p++; } else if(!status) break;
      const hi=status&0xf0;
      if(status===0xff){
        const type=u8[p++], len=vlq(), at=p; p+=len;
        if(type===0x51 && bpm===null && len===3) bpm=60000000/((u8[at]<<16)|(u8[at+1]<<8)|u8[at+2]);
        else if(type===0x58 && len>=2 && tick===0){ num=u8[at]; den=Math.pow(2,u8[at+1]); }
        else if(type===0x03 && !title){ const s=new TextDecoder().decode(u8.slice(at,at+len)).trim(); if(s && !/^(drums?|track ?\d*|batteria)$/i.test(s)) title=s; }
        else if(type===0x2f){ trackEnd=tick; break; }
        status=0;
      } else if(status===0xf0||status===0xf7){ p+=vlq(); status=0; }
      else if(hi===0x90){ const n=u8[p++], v=u8[p++]; if(v>0) notes.push({tick, ch:status&0x0f, note:n, vel:v}); }
      else if(hi===0xc0||hi===0xd0) p+=1;
      else p+=2;
    }
    // la fine conta solo per le tracce con note: quella del tempo, nei file di Logic, dura quanto tutto il progetto
    if(notes.length>notesBefore) endTick=Math.max(endTick,trackEnd||tick);
    o=end;
  }
  if(!notes.length) throw new Error("the MIDI file has no notes");
  // se c'e' il canale 10 (batteria General MIDI) si prende solo quello
  const drums=notes.filter(n=>n.ch===9), use=drums.length?drums:notes;
  const per16=div/4, barLen=Math.round(num*16/den)||16;
  const last=Math.max(...use.map(n=>n.tick))/per16;
  // Lunghezza: fino alla battuta dell'ultima nota. La fine dichiarata dal file puo' aggiungere al massimo una
  // battuta (un loop che chiude in silenzio); una coda piu' lunga e' spazio vuoto del progetto, non musica.
  const upTo=x=>Math.max(barLen, Math.ceil(x/barLen)*barLen);
  const lenNotes=upTo(last+0.5), lenEnd=upTo(endTick/per16-0.5);
  const len=lenEnd-lenNotes<=barLen ? Math.max(lenNotes,lenEnd) : lenNotes;
  return {name:title||name, bpm,
    sections:[{name:title||name, len, hits:use.map(n=>({pos:n.tick/per16, note:n.note, vel:n.vel}))}]};
}

// ---------- PatternTXT (.ptxt, .pattern.txt) ----------
function parsePatternTxt(text, name){
  const map={BD:36,KICK:36,SN:38,SD:38,SNARE:38,HH:42,CH:42,OH:46,CRASH:49,RIDE:51,CLAP:39,CP:39,RIM:37,RS:37,COW:56,TOM:47};
  let bpm=null, num=4, den=4, res=16, inMap=false, cur=null, bar=0;
  const sections=[];
  text.split(/\r?\n/).forEach(raw=>{
    const line=raw.replace(/#.*$/,"").trim();
    if(!line || /^PATTERNTXT/i.test(line)) return;
    let m;
    if((m=line.match(/^TEMPO\s+([\d.]+)/i))) { bpm=+m[1]; return; }
    if((m=line.match(/^TIME\s+(\d+)\s*\/\s*(\d+)/i))) { num=+m[1]; den=+m[2]; return; }
    if((m=line.match(/^RESOLUTION\s+1\s*\/\s*(\d+)/i))) { res=+m[1]; return; }
    if(/^MAP$/i.test(line)) { inMap=true; return; }
    if(/^ENDMAP$/i.test(line)) { inMap=false; return; }
    if(inMap){ if((m=line.match(/^(\S+)\s*=\s*(\d+)/))) map[m[1].toUpperCase()]=+m[2]; return; }
    if((m=line.match(/^PATTERN\s+(.+)$/i))) { cur={name:m[1].trim(), hits:[], len:0}; sections.push(cur); bar=0; return; }
    if((m=line.match(/^BAR\s+(\d+)/i))) { bar=Math.max(0,+m[1]-1); return; }
    if((m=line.match(/^([^\s=#]+)\s+([-xX>.|\s]+)$/))){
      if(!cur){ cur={name, hits:[], len:0}; sections.push(cur); }
      const note=map[m[1].toUpperCase()]??nameToNote(m[1]);
      const steps=m[2].replace(/[\s|]/g,"").split("");
      const stepLen=16/res, barLen=num*16/den;
      steps.forEach((c,i)=>{
        const vel=c===">"?127:c==="X"?100:c==="x"?70:0;
        if(vel && note!=null) cur.hits.push({pos:bar*barLen+i*stepLen, note, vel});
      });
      cur.len=Math.max(cur.len,(bar+1)*barLen);
    }
  });
  const used=sections.filter(s=>s.hits.length);
  if(!used.length) throw new Error("no hits found in the PatternTXT");
  return {name, bpm, sections:used};
}

// ---------- drum tab in testo (.txt, .tab) ----------
// Righe tipo "HH|x-x-x-x-x-x-x-x-|" o "BD: o---o---": una battuta per ogni tratto tra due "|".
const TAB_ROW=/^\s*([A-Za-z][A-Za-z0-9#]{0,5})\s*[|:]\s*([-xXoOgGfF>@#*.|0-9 ]+?)\s*\|?\s*$/;
function looksLikeTab(text){ return text.split(/\r?\n/).filter(l=>TAB_ROW.test(l) && /[xXoO]/.test(l)).length>=2; }
function parseDrumTab(text, name){
  const hits=[];
  let barBase=0, sys=[];
  const flush=()=>{
    if(!sys.length) return;
    let bars=0;
    sys.forEach(({label,body})=>{
      const note=nameToNote(label);
      const parts=body.split("|").map(x=>x.replace(/\s/g,"")).filter(Boolean);
      bars=Math.max(bars,parts.length);
      if(note==null) return;
      parts.forEach((part,b)=>{
        const n=part.length;
        [...part].forEach((c,i)=>{
          if("-.#".includes(c)) return;                  // pausa o piatto strozzato
          let nt=note, vel=90;
          if(c==="X"||c===">"||c==="O") vel=120;
          else if(c==="g"||c==="G") vel=45;
          if((c==="o"||c==="O") && note===42) nt=46;     // negli hi-hat la "o" e' l'aperto
          if(c==="@") nt=53;
          hits.push({pos:(barBase+b)*16+i*16/n, note:nt, vel});
        });
      });
    });
    barBase+=bars; sys=[];
  };
  text.split(/\r?\n/).forEach(l=>{
    const m=l.match(TAB_ROW);
    if(m && /[xXoOgf@-]/.test(m[2])) sys.push({label:m[1], body:m[2]});
    else flush();
  });
  flush();
  if(!hits.length) throw new Error("no hits recognized in the drum tab");
  return {name, bpm:null, sections:[{name, len:barBase*16, hits}]};
}

// ---------- Hydrogen (.h2song, .h2pattern) ----------
// Nei .h2pattern gli strumenti sono solo numeri: si usa l'ordine del kit "GMRockKit" di Hydrogen.
const H2_GMKIT=["Kick","Stick","Snare Jazz","Hand Clap","Snare Rock","Tom Low","Closed HH","Tom Mid","Pedal HH","Tom Hi","Open HH","Cowbell","Ride Jazz","Crash","Ride Rock","Crash Jazz"];
function parseHydrogen(doc, name){
  const txt=(el,tag)=>el.getElementsByTagName(tag)[0]?.textContent?.trim();
  const inst={};
  [...doc.getElementsByTagName("instrument")].forEach(i=>{
    const id=txt(i,"id"), nm=txt(i,"name");
    if(id!=null && nm && i.parentNode.nodeName==="instrumentList") inst[id]=nm;
  });
  const bpm=parseFloat(txt(doc,"bpm"))||null;
  const pats=[...doc.getElementsByTagName("pattern")].filter(p=>p.getElementsByTagName("noteList").length);
  const sections=pats.map(p=>{
    const size=parseInt(txt(p,"size"),10)||192;                // 48 tick per quarto
    const hits=[];
    [...p.getElementsByTagName("note")].forEach(n=>{
      const pos=parseInt(txt(n,"position"),10), id=txt(n,"instrument"), v=parseFloat(txt(n,"velocity")??"0.8");
      const note=nameToNote(inst[id] ?? H2_GMKIT[+id]);
      if(isNaN(pos)||note==null) return;
      hits.push({pos:pos/12, note, vel:Math.max(1,Math.min(127,Math.round(v*127)))});
    });
    return {name:txt(p,"name")||name, len:size/12, hits};
  });
  const byName=Object.fromEntries(sections.map((s,i)=>[s.name,i]));
  const order=[...doc.getElementsByTagName("group")].map(g=>byName[txt(g,"patternID")]).filter(i=>i!=null);
  if(!sections.some(s=>s.hits.length)) throw new Error("no notes in the Hydrogen file");
  return {name:doc.documentElement.nodeName==="song"?(txt(doc,"name")||name):name, bpm, sections, order:order.length?order:null};
}

// ---------- REAPER (.rpp) ----------
function parseReaper(text, name){
  const bpm=parseFloat((text.match(/^\s*TEMPO\s+([\d.]+)/m)||[])[1])||120;
  const hits=[];
  let pos=0, ppq=960, inMidi=false, tick=0;
  text.split(/\r?\n/).forEach(l=>{
    const t=l.trim();
    let m;
    if((m=t.match(/^POSITION\s+([\d.]+)/))) pos=+m[1];
    else if(t.startsWith("<SOURCE MIDI")){ inMidi=true; tick=0; }
    else if(inMidi && (m=t.match(/^HASDATA\s+\d+\s+(\d+)/))) ppq=+m[1];
    else if(inMidi && (m=t.match(/^[Ee]\s+(\d+)\s+([0-9a-f]{2})\s+([0-9a-f]{2})\s+([0-9a-f]{2})/i))){
      tick+=+m[1];
      const st=parseInt(m[2],16), n=parseInt(m[3],16), v=parseInt(m[4],16);
      if((st&0xf0)===0x90 && v>0) hits.push({pos:pos*bpm/60*4+tick/ppq*4, note:n, vel:v});
    }
    else if(inMidi && t===">") inMidi=false;
  });
  if(!hits.length) throw new Error("the REAPER project has no MIDI notes");
  const last=Math.max(...hits.map(h=>h.pos));
  return {name, bpm, sections:[{name, len:Math.ceil((last+0.5)/16)*16, hits}]};
}

// ---------- Ableton Live (.als) ----------
function parseAbleton(doc, name){
  const val=(el,tag)=>el.getElementsByTagName(tag)[0]?.getAttribute("Value");
  const tempoEl=doc.getElementsByTagName("Tempo")[0];
  const bpm=tempoEl?parseFloat(val(tempoEl,"Manual")):null;
  const clips=[...doc.getElementsByTagName("MidiClip")];
  const read=clip=>{
    const start=parseFloat(val(clip,"CurrentStart"))||0, endV=parseFloat(val(clip,"CurrentEnd"));
    const hits=[];
    [...clip.getElementsByTagName("KeyTrack")].forEach(kt=>{
      const key=parseInt(val(kt,"MidiKey"),10);
      [...kt.getElementsByTagName("MidiNoteEvent")].forEach(ev=>{
        if(ev.getAttribute("IsEnabled")==="false") return;
        const t=parseFloat(ev.getAttribute("Time"));
        if(t<start || (!isNaN(endV) && t>=endV)) return;
        hits.push({pos:(t-start)*4, note:key, vel:Math.round(parseFloat(ev.getAttribute("Velocity"))||100)});
      });
    });
    const nm=clip.getElementsByTagName("Name")[0]?.getAttribute("Value")||name;
    return {name:nm, time:parseFloat(clip.getAttribute("Time"))||0, len:isNaN(endV)?null:(endV-start)*4, hits, arranged:clip.parentNode?.nodeName==="Events"};
  };
  const all=clips.map(read).filter(c=>c.hits.length);
  if(!all.length) throw new Error("the Live Set has no MIDI clips with notes");
  // clip nell'arrangiamento: una canzone sola in ordine di tempo; clip di sessione: un pattern per clip
  const arranged=all.filter(c=>c.arranged);
  if(arranged.length){
    const hits=[];
    arranged.forEach(c=>c.hits.forEach(h=>hits.push({...h, pos:h.pos+c.time*4})));
    const last=Math.max(...hits.map(h=>h.pos));
    return {name, bpm, sections:[{name, len:Math.ceil((last+0.5)/16)*16, hits}]};
  }
  return {name, bpm, sections:all.map(c=>({name:c.name, len:c.len||Math.ceil((Math.max(...c.hits.map(h=>h.pos))+0.5)/16)*16, hits:c.hits}))};
}

// ---------- MusicXML (.musicxml, .xml, .mxl) ----------
// Notazione per batteria: senza indicazioni di strumento si usano le posizioni sul rigo.
const STAFF_NOTE={"F4":36,"E4":36,"C5":38,"G5":42,"A5":49,"F5":51,"E5":47,"D5":48,"A4":43,"B4":45,"D4":44};
function parseMusicXml(doc, name){
  if(!doc.getElementsByTagName("score-partwise").length) throw new Error("a partwise MusicXML file is required");
  const txt=(el,tag)=>el.getElementsByTagName(tag)[0]?.textContent?.trim();
  const instNote={};
  [...doc.getElementsByTagName("score-part")].forEach(sp=>{
    [...sp.getElementsByTagName("score-instrument")].forEach(si=>{ const n=nameToNote(txt(si,"instrument-name")); if(n!=null) instNote[si.getAttribute("id")]=n; });
    [...sp.getElementsByTagName("midi-instrument")].forEach(mi=>{ const u=parseInt(txt(mi,"midi-unpitched"),10); if(u) instNote[mi.getAttribute("id")]=u-1; });
  });
  // la parte con note senza altezza (percussioni); altrimenti la prima
  const parts=[...doc.getElementsByTagName("part")];
  const part=parts.find(p=>p.getElementsByTagName("unpitched").length)||parts[0];
  if(!part) throw new Error("MusicXML senza parti");
  let div=1, num=4, den=4, barStart=0, bpm=null;
  const hits=[];
  [...part.children].filter(c=>c.nodeName==="measure").forEach(m=>{
    let pos=0, lastStart=0;
    [...m.children].forEach(c=>{
      if(c.nodeName==="attributes"){
        div=parseInt(txt(c,"divisions"),10)||div;
        const b=parseInt(txt(c,"beats"),10), bt=parseInt(txt(c,"beat-type"),10);
        if(b&&bt){ num=b; den=bt; }
      } else if(c.nodeName==="sound" && c.getAttribute("tempo") && !bpm) bpm=parseFloat(c.getAttribute("tempo"));
      else if(c.nodeName==="direction"){ const s=c.getElementsByTagName("sound")[0]; if(s?.getAttribute("tempo") && !bpm) bpm=parseFloat(s.getAttribute("tempo")); }
      else if(c.nodeName==="backup") pos-=parseInt(txt(c,"duration"),10)||0;
      else if(c.nodeName==="forward") pos+=parseInt(txt(c,"duration"),10)||0;
      else if(c.nodeName==="note"){
        if(c.getElementsByTagName("grace").length) return;
        const chord=c.getElementsByTagName("chord").length>0, dur=parseInt(txt(c,"duration"),10)||0;
        const at=chord?lastStart:pos;
        if(!c.getElementsByTagName("rest").length){
          const iid=c.getElementsByTagName("instrument")[0]?.getAttribute("id");
          let note=iid!=null?instNote[iid]:undefined;
          if(note==null){
            const un=c.getElementsByTagName("unpitched")[0]||c.getElementsByTagName("pitch")[0];
            if(un){ const k=(txt(un,"display-step")||txt(un,"step"))+(txt(un,"display-octave")||txt(un,"octave")); note=STAFF_NOTE[k]; }
            if(note===42 && txt(c,"notehead")==="circle-x") note=46;
          }
          const dyn=parseFloat(c.getAttribute("dynamics"));
          const acc=c.getElementsByTagName("accent").length||c.getElementsByTagName("strong-accent").length;
          if(note!=null) hits.push({pos:barStart+at/div*4, note, vel:acc?120:(isNaN(dyn)?90:Math.min(127,Math.round(dyn*0.9)))});
        }
        if(!chord){ lastStart=pos; pos+=dur; }
      }
    });
    barStart+=num*16/den;
  });
  if(!hits.length) throw new Error("no drum notes in the MusicXML");
  const title=txt(doc,"work-title")||txt(doc,"movement-title")||name;
  return {name:title, bpm, sections:[{name:title, len:Math.round(barStart), hits}]};
}

// Zip (per .mxl): directory centrale, file compressi con deflate o salvati.
async function unzip(buf){
  const d=new DataView(buf), u8=new Uint8Array(buf);
  let e=u8.length-22; while(e>=0 && d.getUint32(e,true)!==0x06054b50) e--;
  if(e<0) throw new Error("invalid zip");
  let p=d.getUint32(e+16,true); const n=d.getUint16(e+10,true), files={};
  for(let i=0;i<n;i++){
    const method=d.getUint16(p+10,true), csize=d.getUint32(p+20,true), nl=d.getUint16(p+28,true),
      xl=d.getUint16(p+30,true), cl=d.getUint16(p+32,true), off=d.getUint32(p+42,true);
    const fname=new TextDecoder().decode(u8.slice(p+46,p+46+nl));
    const lo=off+30+d.getUint16(off+26,true)+d.getUint16(off+28,true);
    files[fname]={method, data:u8.slice(lo,lo+csize)};
    p+=46+nl+xl+cl;
  }
  const read=async f=>{
    if(f.method===0) return f.data;
    if(f.method!==8) throw new Error("unsupported zip compression");
    return new Uint8Array(await new Response(new Blob([f.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
  };
  return {names:Object.keys(files), read:async nm=>new TextDecoder().decode(await read(files[nm]))};
}
async function gunzip(buf){
  return new TextDecoder().decode(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
}
const xml=text=>{
  const doc=new DOMParser().parseFromString(text,"application/xml");
  if(doc.getElementsByTagName("parsererror").length) throw new Error("invalid XML");
  return doc;
};

// ---------- audio: loop di batteria -> pattern (approssimato) ----------
// Tre bande (bassi = cassa, medi = rullante/clap, acuti = hi-hat), inviluppo a finestre di 5 ms,
// attacchi dove l'energia sale oltre una soglia che segue il segnale; il tempo si stima
// dall'autocorrelazione degli attacchi se non e' dato. I colpi vanno poi sulla griglia a sedicesimi.
async function analyzeAudio(buffer, opts={}){
  const rate=buffer.sampleRate, n=Math.min(buffer.length, Math.floor(rate*60));   // al massimo un minuto
  const OAC=window.OfflineAudioContext||window.webkitOfflineAudioContext;
  const band=async(types,freqs)=>{
    const c=new OAC(1,n,rate), src=c.createBufferSource(); src.buffer=buffer;
    let node=src;
    types.forEach((t,i)=>{ const f=c.createBiquadFilter(); f.type=t; f.frequency.value=freqs[i]; f.Q.value=0.7; node.connect(f); node=f; });
    node.connect(c.destination); src.start();
    return (await c.startRendering()).getChannelData(0);
  };
  const [low,mid,high]=await Promise.all([band(["lowpass"],[130]),band(["highpass","lowpass"],[180,3000]),band(["highpass"],[7000])]);
  const hop=Math.round(rate*0.005), frames=Math.floor(n/hop);
  const env=d=>{ const e=new Float32Array(frames); for(let f=0;f<frames;f++){ let s=0; for(let i=f*hop;i<(f+1)*hop;i++) s+=d[i]*d[i]; e[f]=Math.sqrt(s/hop); } return e; };
  const onsets=(e,minGapMs,k)=>{
    const f=new Float32Array(e.length); for(let i=1;i<e.length;i++) f[i]=Math.max(0,e[i]-e[i-1]);
    const out=[], win=40, gap=Math.round(minGapMs/5);
    let last=-1e9;
    for(let i=1;i<f.length-1;i++){
      let s=0, s2=0, c=0;
      for(let j=Math.max(0,i-win);j<Math.min(f.length,i+win);j++){ s+=f[j]; s2+=f[j]*f[j]; c++; }
      const mean=s/c, sd=Math.sqrt(Math.max(0,s2/c-mean*mean));
      if(f[i]>mean+k*sd && f[i]>=f[i-1] && f[i]>=f[i+1] && f[i]>1e-4 && i-last>=gap){ out.push({t:i*hop/rate, s:f[i]}); last=i; }
    }
    return out;
  };
  // tengo solo gli attacchi forti rispetto al piu' forte della banda: le code (la cassa lunga di un'808,
  // il basso del rullante) fanno piccoli picchi che non sono colpi
  const strong=(list,r)=>{ const m=Math.max(0,...list.map(o=>o.s)); return list.filter(o=>o.s>=m*r); };
  const kicks=strong(onsets(env(low),90,2.2),0.35), snares=strong(onsets(env(mid),90,2.4),0.3), hats=strong(onsets(env(high),50,2.0),0.2);
  // cassa e rullante si sentono un po' in entrambe le bande: se cadono insieme resta quello piu' forte
  // (rispetto al massimo della sua banda), tutti e due solo se sono forti entrambi
  const rel=list=>{ const m=Math.max(1e-9,...list.map(o=>o.s)); list.forEach(o=>{ o.r=o.s/m; }); };
  rel(kicks); rel(snares);
  const drop=new Set();
  kicks.forEach(k=>snares.forEach(sn=>{
    if(Math.abs(k.t-sn.t)>=0.03 || (k.r>0.7 && sn.r>0.7)) return;
    drop.add(k.r>=sn.r?sn:k);
  }));
  const kickOnly=kicks.filter(o=>!drop.has(o)), snareOnly=snares.filter(o=>!drop.has(o));
  const all=[...kickOnly,...snareOnly,...hats].sort((a,b)=>a.t-b.t);
  if(all.length<3) throw new Error("no clear hits can be heard in the audio file");
  let bpm=opts.bpm;
  if(!bpm){
    // autocorrelazione della somma degli inviluppi di attacco (continua, non solo i picchi) tra 60 e 200 BPM,
    // sommando anche il doppio del periodo (la battuta) e con una preferenza morbida per i tempi vicini a 120
    const fl=[low,mid,high].map(d=>{ const e=env(d), f=new Float32Array(frames); let m=1e-9;
      for(let i=1;i<frames;i++){ f[i]=Math.max(0,e[i]-e[i-1]); if(f[i]>m) m=f[i]; } for(let i=0;i<frames;i++) f[i]/=m; return f; });
    const o=new Float32Array(frames); for(let i=0;i<frames;i++) o[i]=fl[0][i]+fl[1][i]+fl[2][i];
    const ac=lag=>{ const L=Math.round(lag); let x=0; for(let i=0;i+L<frames;i++) x+=o[i]*o[i+L]; return x/(frames-L); };
    let best=-1, bestB=120;
    for(let b=60;b<=200;b+=0.25){
      const lag=60/b*rate/hop;
      const score=(ac(lag)+0.5*ac(2*lag)+0.25*ac(4*lag))*Math.exp(-0.5*Math.pow(Math.log2(b/120)/0.9,2));
      if(score>best){ best=score; bestB=b; }
    }
    bpm=bestB;
  }
  let t0=(kickOnly[0]||all[0]).t;
  // rifinitura: tempo (intorno alla stima) e punto di partenza con cui gli attacchi cadono piu' vicini alla
  // griglia a sedicesimi: un BPM di errore sposta i colpi di mezzo step dopo qualche battuta
  {
    const fit=(b,z)=>{ const p16=60/b/4; let e=0; all.forEach(o=>{ const x=(o.t-z)/p16; e+=Math.abs(x-Math.round(x))*o.s; }); return e; };
    const lo=opts.bpm?bpm:bpm-3, hi=opts.bpm?bpm:bpm+3;
    let best=bpm, bestZ=t0, bestE=Infinity;
    for(let b=lo;b<=hi+1e-9;b+=0.05){
      const p16=60/b/4;
      for(let k=-4;k<=4;k++){ const z=t0+k*p16/10, e=fit(b,z); if(e<bestE-1e-9){ bestE=e; best=b; bestZ=z; } }
    }
    bpm=opts.bpm?bpm:(Math.abs(best-Math.round(best))<0.35?Math.round(best):best); t0=bestZ;
  }
  const per16=60/bpm/4;
  const peak=Math.max(...all.map(o=>o.s));
  const hits=[];
  const put=(list,note)=>list.forEach(o=>{ const pos=(o.t-t0)/per16; if(pos>=-0.4) hits.push({pos:Math.max(0,pos), note, vel:Math.round(40+87*Math.min(1,o.s/peak*1.6))}); });
  put(kickOnly,36); put(snareOnly,38); put(hats,42);
  const bars=Math.min(64, Math.max(1, Math.ceil((Math.max(...hits.map(h=>h.pos))+0.5)/16)));
  return {bpm:Math.round(bpm), sections:[{name:opts.name, len:bars*16, hits:hits.filter(h=>h.pos<bars*16)}]};
}

// ---------- riconoscimento del formato ----------
const AUDIO_EXT=/\.(wav|wave|aif|aiff|aifc|mp3|m4a|aac|ogg|oga|opus|flac|webm|caf)$/i;
const ACCEPT=".mid,.midi,.kar,.smf,.rmi,.ptxt,.txt,.tab,.json,.h2song,.h2pattern,.rpp,.als,.musicxml,.xml,.mxl,"+
  ".wav,.wave,.aif,.aiff,.aifc,.mp3,.m4a,.aac,.ogg,.oga,.opus,.flac,.webm,.caf";

// Testo incollato o letto da file. Restituisce il risultato, oppure {project} per un progetto PATTERN-MACHINE.
async function fromText(text, name="Import"){
  const t=text.replace(/^﻿/,"").trim();
  if(!t) throw new Error("testo vuoto");
  if(t[0]==="{"){
    let j; try{ j=JSON.parse(t); }catch(e){ throw new Error("invalid JSON"); }
    if(Array.isArray(j.patterns) && Array.isArray(j.tracks)) return {project:j};
    throw new Error("this JSON isn't a PATTERN-MACHINE project");
  }
  if(/^<REAPER_PROJECT/.test(t)) return parseReaper(t,name);
  if(t[0]==="<"){
    const doc=xml(t);
    if(doc.getElementsByTagName("score-partwise").length) return parseMusicXml(doc,name);
    if(doc.getElementsByTagName("noteList").length) return parseHydrogen(doc,name);
    if(doc.getElementsByTagName("Ableton").length) return parseAbleton(doc,name);
    throw new Error("XML in an unknown format");
  }
  if(/^PATTERNTXT/i.test(t) || (/^\s*PATTERN\s+\S/im.test(t) && /^\s*BAR\s+\d/im.test(t))) return parsePatternTxt(t,name);
  if(looksLikeTab(t)) return parseDrumTab(t,name);
  throw new Error("unrecognized text (PatternTXT, drum tab, JSON, MusicXML, Hydrogen, REAPER)");
}

// File scelto o trascinato. decodeAudio(arrayBuffer) -> AudioBuffer lo passa la pagina (serve il suo AudioContext).
async function fromFile(file, {decodeAudio, audioBpm}={}){
  const name=file.name.replace(/\.(pattern\.txt|[^.]+)$/i,"");
  const buf=await file.arrayBuffer(), u8=new Uint8Array(buf);
  const head=String.fromCharCode(...u8.slice(0,4));
  if(head==="MThd") return parseMidi(buf,name);
  if(head==="RIFF" && String.fromCharCode(...u8.slice(8,12))==="RMID"){       // .rmi: MIDI dentro un RIFF
    let p=12; const d=new DataView(buf);
    while(p+8<u8.length){ const id=String.fromCharCode(...u8.slice(p,p+4)), sz=d.getUint32(p+4,true); if(id==="data") return parseMidi(buf.slice(p+8,p+8+sz),name); p+=8+sz+(sz&1); }
  }
  if(u8[0]===0x1f && u8[1]===0x8b) return parseAbleton(xml(await gunzip(buf)),name);   // gzip: Live Set di Ableton
  if(head.startsWith("PK")){                                                           // zip: MusicXML compresso
    const z=await unzip(buf);
    let root=z.names.find(n=>/\.(musicxml|xml)$/i.test(n) && !/^META-INF\//i.test(n));
    if(z.names.includes("META-INF/container.xml")){
      const c=xml(await z.read("META-INF/container.xml")).getElementsByTagName("rootfile")[0]?.getAttribute("full-path");
      if(c) root=c;
    }
    if(!root) throw new Error("the zip has no MusicXML file");
    return parseMusicXml(xml(await z.read(root)),name);
  }
  if(AUDIO_EXT.test(file.name) || /^audio\//.test(file.type) || ["RIFF","FORM","fLaC","OggS"].includes(head) || head.startsWith("ID3")){
    if(!decodeAudio) throw new Error("audio not supported here");
    let ab;
    try{ ab=await decodeAudio(buf); }catch(e){ throw new Error("this browser can't read this audio file"); }
    return {name, audio:true, ...(await analyzeAudio(ab,{bpm:audioBpm, name}))};
  }
  return fromText(new TextDecoder().decode(buf), name);
}

window.PMImport={fromFile, fromText, nameToNote, ACCEPT};
})();
