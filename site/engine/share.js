// Link pubblici autosufficienti: il progetto resta nel fragment URL, quindi non finisce nei log del server.
(function(root){
  "use strict";

  const textEncoder=new TextEncoder(), textDecoder=new TextDecoder();
  const toB64=u8=>{
    let s="";
    for(let i=0;i<u8.length;i+=0x8000) s+=String.fromCharCode(...u8.subarray(i,i+0x8000));
    return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
  };
  const fromB64=s=>{
    const bin=atob(String(s).replace(/-/g,"+").replace(/_/g,"/")+"===".slice((String(s).length+3)%4));
    return Uint8Array.from(bin,c=>c.charCodeAt(0));
  };
  async function encode(data){
    const raw=textEncoder.encode(JSON.stringify(data));
    if("CompressionStream" in root){
      const zipped=await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
      return "g."+toB64(new Uint8Array(zipped));
    }
    return "j."+toB64(raw);
  }
  async function decode(payload){
    const p=String(payload||"");
    if(!p) return null;
    let bytes=fromB64(p.startsWith("g.")||p.startsWith("j.")?p.slice(2):p);
    if(p.startsWith("g.")||(!p.startsWith("j.")&&"DecompressionStream" in root)){
      bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    }
    return JSON.parse(textDecoder.decode(bytes));
  }
  function payloadFromLocation(loc=root.location){
    const hash=String(loc.hash||"").replace(/^#/,"");
    if(hash.startsWith("project=")) return decodeURIComponent(hash.slice(8));
    const q=new URLSearchParams(loc.search||"").get("project");
    return q?decodeURIComponent(q):null;
  }
  const hasProject=loc=>!!payloadFromLocation(loc);
  const link=(path,payload)=>`${root.location.origin}${path}#project=${encodeURIComponent(payload)}`;
  root.PMShare={encode,decode,payloadFromLocation,hasProject,link};
})(typeof self!=="undefined"?self:globalThis);
