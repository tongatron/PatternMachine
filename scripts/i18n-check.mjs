#!/usr/bin/env node
// Controlla la traduzione inglese del sito: apre ogni pagina in inglese in Chrome headless, passa per viste,
// finestre, libreria e macchine, ed elenca i testi rimasti in italiano (cioe' senza voce in site/engine/lang-en.js).
//
//   node scripts/i18n-check.mjs          elenco dei testi da tradurre (uscita 1 se ce ne sono)
//
// Un testo che resta uguale in inglese (nome, sigla) va in "same" di site/engine/lang-en.js; una frase nuova va in
// "text" (o in "html" se ha grassetti/tasti dentro, o in "rules" se contiene numeri o nomi che cambiano).
// Serve Google Chrome; il sito viene servito da un server locale temporaneo.
import {spawn} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const SITE=join(dirname(fileURLToPath(import.meta.url)),"..","site");
const CHROME=process.env.CHROME||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT=8790+Math.floor(Math.random()*100), DEBUG=9400+Math.floor(Math.random()*100);
const PAGES=["index.html","funzioni.html","macchine.html","plugin.html"];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const server=spawn("python3",["-m","http.server",String(PORT),"--bind","127.0.0.1","--directory",SITE],{stdio:"ignore"});
const profile=mkdtempSync(join(tmpdir(),"pm-i18n-"));
const chrome=spawn(CHROME,["--headless=new",`--remote-debugging-port=${DEBUG}`,`--user-data-dir=${profile}`,"--mute-audio","about:blank"],{stdio:"ignore"});
const done=code=>{ try{chrome.kill();}catch(e){} try{server.kill();}catch(e){} try{rmSync(profile,{recursive:true,force:true});}catch(e){} process.exit(code); };

let target;
for(let i=0;i<60 && !target;i++){ try{ target=(await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json()).find(t=>t.type==="page"); }catch(e){} if(!target) await sleep(200); }
if(!target){ console.error("Chrome non risponde (imposta CHROME con il percorso di Chrome)"); done(2); }
const ws=new WebSocket(target.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0; const pending={};
ws.onmessage=e=>{ const m=JSON.parse(e.data); if(m.id&&pending[m.id]){ pending[m.id](m); delete pending[m.id]; } };
const cmd=(method,params={})=>new Promise(r=>{ const i=++id; pending[i]=r; ws.send(JSON.stringify({id:i,method,params})); });
const run=async js=>(await cmd("Runtime.evaluate",{expression:js,awaitPromise:true,returnByValue:true})).result?.result?.value;
await cmd("Page.enable");
await cmd("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});

// Nella pagina principale si aprono le parti che il codice crea solo quando servono.
const EXERCISE=`(async()=>{ const w=ms=>new Promise(r=>setTimeout(r,ms));
  const closeAll=()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  for(const v of ["seq","recent","sound","grid"]){ try{ setView(v); }catch(e){} await w(300); closeAll(); }
  for(const d of document.querySelectorAll('dialog')){ try{ d.showModal(); await w(120); d.close(); }catch(e){} }
  try{ document.querySelector('#rows .trk-name').click(); await w(200); }catch(e){}
  for(const b of document.querySelectorAll('#stepMode button')){ b.click(); await w(60); }
  const m=document.querySelector('details'); if(m) m.open=true;
  try{ const sel=el("kitSelect"); for(const o of [...sel.options]){ setSampleSet(o.value); await w(120); } }catch(e){}
  try{ [...document.querySelectorAll('button')].find(x=>/Scegli|Browse/.test(x.textContent)).click(); await w(900); }catch(e){}
  await w(400); })()`;

const report={};
for(const page of PAGES){
  await cmd("Page.navigate",{url:`http://127.0.0.1:${PORT}/${page}?lang=en`});
  await sleep(2500);
  if(page==="index.html") await run(EXERCISE);
  report[page]=await run("window.PMI18N ? PMI18N.missing() : ['(i18n.js non caricato)']")||[];
}
ws.close();
let total=0;
for(const [page,list] of Object.entries(report)){
  if(!list.length) continue;
  total+=list.length;
  console.log(`\n${page} · ${list.length} testi senza traduzione:`);
  list.forEach(s=>console.log("  "+s));
}
console.log(total ? `\n${total} testi da tradurre in site/engine/lang-en.js` : "traduzione inglese completa");
done(total?1:0);
