// Lingua dell'interfaccia (ITA / ENG).
// Le pagine restano scritte in italiano: e' l'unica fonte. In inglese questo script sostituisce al volo
// testi, attributi (title, placeholder, aria-label, alt) e blocchi di testo con markup usando il dizionario
// di lang-en.js (window.PM_EN). Un MutationObserver traduce anche quello che il codice scrive dopo
// (stato, finestre, menu). Tornando all'italiano si rimettono gli originali.
// Frasi senza traduzione: restano in italiano e finiscono in PMI18N.missing() (vedi scripts/i18n-check.mjs).
(function(){
  const KEY="pm.lang", ATTRS=["title","placeholder","aria-label","alt"];
  const BLOCKS="p,li,td,th,h1,h2,h3,h4,dt,dd,figcaption,summary,caption,label,.i18n-block";
  const SKIP=new Set(["SCRIPT","STYLE","TEXTAREA","CODE","PRE","NOSCRIPT"]);
  let lang="it";
  try{ lang=localStorage.getItem(KEY)==="en"?"en":"it"; }catch(e){}
  const q=new URLSearchParams(location.search).get("lang");
  if(q==="en"||q==="it") lang=q;
  const root=document.documentElement;
  root.lang=lang;
  if(lang==="en") root.classList.add("i18n-wait");

  const norm=s=>s.replace(/\s+/g," ").trim();
  let text=null, html=null, rules=[], same=new Set(), sameRe=[];
  function load(){
    if(text) return;
    const D=window.PM_EN||{};
    text=new Map(Object.entries(D.text||{}).map(([k,v])=>[norm(k),v]));
    html=new Map(Object.entries(D.html||{}).map(([k,v])=>[norm(k),v]));
    rules=(D.rules||[]).map(([re,to])=>[new RegExp("^"+re+"$","u"),to]);
    same=new Set((D.same||[]).map(norm));
    sameRe=(D.sameRe||[]).map(r=>new RegExp("^"+r+"$","u"));
  }
  const missing=new Set();
  // Traduce una frase intera; per le frasi con parti variabili (numeri, nomi) valgono le regole.
  function tr(s){
    const k=norm(s);
    if(!k || !/\p{L}{2}/u.test(k)) return null;
    if(text.has(k)) return text.get(k);
    if(same.has(k) || sameRe.some(r=>r.test(k))) return null;
    for(const [re,to] of rules){
      const m=k.match(re);
      if(m) return typeof to==="function" ? to(m,trOr) : to.replace(/\$(\d)/g,(_x,n)=>trOr(m[n]||""));
    }
    missing.add(k);
    return null;
  }
  const trOr=s=>tr(s)??s;

  const origText=new WeakMap(), doneText=new WeakMap();
  const origAttr=new WeakMap(), doneAttr=new WeakMap();
  const origBlock=new WeakMap(), doneBlock=new WeakMap();
  const touched=new Set();   // elementi e nodi tradotti, per tornare all'italiano

  const skipped=n=>{ for(let e=n.nodeType===1?n:n.parentElement; e; e=e.parentElement){ if(SKIP.has(e.tagName)||e.hasAttribute("data-no-i18n")||e.hasAttribute("data-i18n-done")) return true; } return false; };

  function doText(n){
    if(n.data===doneText.get(n)) return;
    const en=tr(n.data);
    if(en==null) return;
    const lead=n.data.match(/^\s*/)[0], trail=n.data.match(/\s*$/)[0];
    origText.set(n,n.data);
    const out=lead+en+trail;
    doneText.set(n,out); n.data=out; touched.add(n);
  }
  function doAttrs(e){
    for(const a of ATTRS){
      const v=e.getAttribute(a);
      if(v==null) continue;
      const done=doneAttr.get(e)||{};
      if(v===done[a]) continue;
      const en=tr(v);
      if(en==null) continue;
      const o=origAttr.get(e)||{}; o[a]=v; origAttr.set(e,o);
      done[a]=en; doneAttr.set(e,done); e.setAttribute(a,en); touched.add(e);
    }
  }
  function doBlock(e){
    if(!html.size || doneBlock.get(e)===e.innerHTML) return;
    const en=html.get(norm(e.innerHTML));
    if(en==null) return;
    origBlock.set(e,e.innerHTML); e.innerHTML=en; e.setAttribute("data-i18n-done",""); doneBlock.set(e,e.innerHTML); touched.add(e);
  }
  function walk(node){
    if(node.nodeType===3){ if(!skipped(node)) doText(node); return; }
    if(node.nodeType!==1 || skipped(node)) return;
    if(node.matches(BLOCKS)) doBlock(node);
    node.querySelectorAll(BLOCKS).forEach(e=>{ if(!skipped(e)) doBlock(e); });
    doAttrs(node);
    node.querySelectorAll("["+ATTRS.join("],[")+"]").forEach(e=>{ if(!skipped(e)) doAttrs(e); });
    const w=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);
    for(let t=w.nextNode(); t; t=w.nextNode()) if(!skipped(t)) doText(t);
  }

  const obs=new MutationObserver(recs=>{
    for(const r of recs){
      if(r.type==="characterData") { if(!skipped(r.target)) doText(r.target); }
      else if(r.type==="attributes") { if(!skipped(r.target)) doAttrs(r.target); }
      else r.addedNodes.forEach(walk);
    }
  });
  function start(){
    load();
    walk(document.body);
    const t=document.querySelector("title"); if(t&&t.firstChild) doText(t.firstChild);
    obs.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRS});
  }
  function restore(){
    obs.disconnect();
    touched.forEach(n=>{
      if(!n.isConnected) return;
      if(n.nodeType===3){ if(n.data===doneText.get(n)) n.data=origText.get(n); return; }
      if(origBlock.has(n) && n.innerHTML===doneBlock.get(n)) n.innerHTML=origBlock.get(n);
      n.removeAttribute("data-i18n-done");
      const o=origAttr.get(n), d=doneAttr.get(n)||{};
      if(o) for(const a in o) if(n.getAttribute(a)===d[a]) n.setAttribute(a,o[a]);
    });
    touched.clear();
    const t=document.querySelector("title"); if(t&&t.firstChild&&origText.has(t.firstChild)) t.firstChild.data=origText.get(t.firstChild);
  }

  function setLang(l){
    if(l===lang) return;
    lang=l; root.lang=l;
    try{ localStorage.setItem(KEY,l); }catch(e){}
    if(l==="en") start(); else restore();
    paintSwitch();
    document.dispatchEvent(new CustomEvent("pm-lang",{detail:l}));
  }

  // Switch ITA / ENG: va in ogni elemento .lang-switch della pagina.
  function paintSwitch(){
    document.querySelectorAll(".lang-switch").forEach(box=>{
      if(!box.firstChild){
        box.setAttribute("data-no-i18n",""); box.setAttribute("role","group"); box.setAttribute("aria-label","Language / Lingua");
        [["it","ITA","Italiano"],["en","ENG","English"]].forEach(([l,label,name])=>{
          const b=document.createElement("button"); b.type="button"; b.dataset.lang=l; b.textContent=label; b.title=name;
          b.onclick=()=>setLang(l); box.appendChild(b);
        });
      }
      box.querySelectorAll("button").forEach(b=>{ const on=b.dataset.lang===lang; b.classList.toggle("on",on); b.setAttribute("aria-pressed",String(on)); });
    });
  }

  const css=document.createElement("style");
  css.textContent=`html.i18n-wait body{visibility:hidden}
.lang-switch{display:inline-flex; border:1px solid var(--edge,#55534b); border-radius:3px; overflow:hidden; flex-shrink:0; vertical-align:middle;}
.lang-switch button{all:unset; cursor:pointer; padding:4px 8px; font:700 10.5px/1.3 var(--mono,ui-monospace,Menlo,monospace); letter-spacing:.08em;
  color:var(--dim,#3a3833); background:transparent;}
.lang-switch button + button{border-left:1px solid var(--edge,#55534b);}
.lang-switch button.on{background:var(--key-primary,var(--accent,#c8471f)); color:var(--on-accent,#fff6ee);}
.lang-switch button:focus-visible{outline:2px solid var(--accent,#c8471f); outline-offset:-2px;}`;
  document.head.appendChild(css);

  document.addEventListener("DOMContentLoaded",()=>{
    paintSwitch();
    if(lang==="en") start();
    root.classList.remove("i18n-wait");
  });
  setTimeout(()=>root.classList.remove("i18n-wait"),1500);

  window.PMI18N={
    get lang(){ return lang; }, setLang,
    t:s=>lang==="en"?(load(),trOr(s)):s,
    missing:()=>[...missing].sort()
  };
})();
