import { useState, useEffect, useCallback, useRef } from "react";
import Head from "next/head";

const PROXY = "/api/probe";

const ENDPOINTS = [
  { id:"nxcor",      name:"nXcor",      tag:"PROD", url:"https://n-xcor.com",               healthUrl:"https://n-xcor.com/api/health",               type:"health", desc:"VPS · Socket.IO · SQLite",    color:"#E8622A" },
  { id:"aura",       name:"AURA",        tag:"PROD", url:"https://aura-ar-world.vercel.app", healthUrl:"https://aura-ar-world.vercel.app/api/health", type:"health", desc:"AR · PulsePoint · Vercel",    color:"#60a5fa" },
  { id:"findafiend", name:"findafiend",  tag:"PROD", url:"https://findafiend.vercel.app",    healthUrl:"https://findafiend.vercel.app/api/health",    type:"health", desc:"Rideshare · Redis · Next.js",  color:"#a78bfa" },
  { id:"clarusign",  name:"ClaruSign",   tag:"PROD", url:"https://clarusign.com",            healthUrl:null,                                          type:"http",   desc:"Static · Legal · Vercel",     color:"#34d399" },
];

const MAX_HIST = 24;
const LS_KEY = "diaghub_v5";

const SC = { ok:"#4ade80", degraded:"#facc15", down:"#f87171", checking:"#E8622A", idle:"#2a2a28" };
const sc = s => SC[s]||SC.idle;
const lc = ms => !ms?"#555":ms<400?"#4ade80":ms<1200?"#facc15":"#f87171";
const glow = s => s==="ok"?"0 0 12px rgba(74,222,128,0.45)":s==="down"?"0 0 12px rgba(248,113,113,0.4)":s==="degraded"?"0 0 10px rgba(250,204,21,0.35)":"none";
const rel = ts => { if(!ts) return "—"; const s=Math.floor((Date.now()-ts)/1000); return s<5?"just now":s<60?s+"s ago":s<3600?Math.floor(s/60)+"m ago":Math.floor(s/3600)+"h ago"; };
const fmtUp = s => !s?"—":s<60?s+"s":s<3600?Math.floor(s/60)+"m "+s%60+"s":Math.floor(s/3600)+"h "+Math.floor((s%3600)/60)+"m";
const upPct = arr => { if(!arr||arr.length<2) return null; return Math.round((arr.filter(x=>x==="ok"||x==="degraded").length/arr.length)*100); };

function loadSaved() { try { return JSON.parse(localStorage.getItem(LS_KEY)||"{}"); } catch { return {}; } }

async function probe(ep) {
  const target = ep.healthUrl || ep.url;
  const url = `${PROXY}?url=${encodeURIComponent(target)}&type=${ep.type}`;
  const t0 = Date.now();
  try {
    const r = await fetch(url, { cache:"no-store" });
    const data = await r.json();
    return { status:data.status||(data.ok?"ok":"down"), latencyMs:data.latencyMs??(Date.now()-t0), httpStatus:data.httpStatus, checks:data.checks||{}, error:data.error||null, timestamp:Date.now() };
  } catch(e) {
    return { status:"down", latencyMs:Date.now()-t0, httpStatus:null, checks:{}, error:e.message, timestamp:Date.now() };
  }
}

function Spark({ data, color="#E8622A" }) {
  if(!data||data.length<2) return <div style={{width:80,height:22}}/>;
  const vals=data.map(d=>d.latencyMs||0), max=Math.max(...vals,1), W=80, H=22;
  const pts=vals.map((v,i)=>`${Math.round((i/(vals.length-1))*W)},${Math.round(H-(v/max)*(H-4)+2)}`).join(" ");
  return (
    <svg width={W} height={H} style={{display:"block",overflow:"visible"}}>
      <polyline points={pts} fill="none" stroke={`${color}55`} strokeWidth="1.5" strokeLinejoin="round"/>
      {data.map((d,i)=>(
        <circle key={i} cx={Math.round((i/(data.length-1))*W)} cy={Math.round(H-(d.latencyMs||0)/max*(H-4)+2)}
          r={i===data.length-1?3:2} fill={sc(d.status)} opacity={i===data.length-1?1:0.65}/>
      ))}
    </svg>
  );
}

function Checks({ checks }) {
  const entries = Object.entries(checks||{});
  if(!entries.length) return null;
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(165px,1fr))",gap:7,marginTop:12}}>
      {entries.map(([k,v])=>(
        <div key={k} style={{background:"rgba(0,0,0,0.4)",border:"1px solid rgba(242,237,228,0.07)",borderRadius:2,padding:"9px 11px"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
            <span style={{fontFamily:"'Syne Mono',monospace",fontSize:9,letterSpacing:"0.1em",color:"rgba(242,237,228,0.4)"}}>{k.toUpperCase()}</span>
            <span style={{fontFamily:"'Syne Mono',monospace",fontSize:9,fontWeight:700,color:SC[v?.status]||"#4ade80"}}>{(v?.status||"ok").toUpperCase()}</span>
          </div>
          {Object.entries(v||{}).filter(([kk])=>kk!=="status").map(([kk,vv])=>(
            <div key={kk} style={{display:"flex",justifyContent:"space-between",gap:6,marginTop:2}}>
              <span style={{fontFamily:"'Syne Mono',monospace",fontSize:9,color:"rgba(242,237,228,0.25)"}}>{kk}</span>
              <span style={{fontFamily:"'Syne Mono',monospace",fontSize:9,color:"rgba(242,237,228,0.55)",maxWidth:90,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {typeof vv==="boolean"?(vv?"yes":"no"):String(vv)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function DiagHub() {
  const [mounted,setMounted]=useState(false);
  const [eps,setEps]=useState(ENDPOINTS);
  const [results,setResults]=useState({});
  const [hist,setHist]=useState({});
  const [incs,setIncs]=useState([]);
  const [checking,setChecking]=useState({});
  const [expanded,setExpanded]=useState({});
  const [auto,setAuto]=useState(false);
  const [tab,setTab]=useState("monitors");
  const [log,setLog]=useState([]);
  const [globalBusy,setGlobalBusy]=useState(false);
  const [lastScan,setLastScan]=useState(null);
  const [ntfPerm,setNtfPerm]=useState("default");
  const [addUrl,setAddUrl]=useState("");
  const [addName,setAddName]=useState("");
  const prevStatus=useRef({});
  const epsRef=useRef(eps); epsRef.current=eps;

  useEffect(()=>{
    const s=loadSaved();
    if(s.hist) setHist(s.hist);
    if(s.incs) setIncs(s.incs);
    if("Notification" in window) setNtfPerm(Notification.permission);
    setMounted(true);
  },[]);

  useEffect(()=>{ if(mounted) try{localStorage.setItem(LS_KEY,JSON.stringify({hist,incs}))}catch{} },[hist,incs,mounted]);

  const addLog=useCallback((msg,type="info")=>{
    const ts=new Date().toLocaleTimeString([],{hour12:false});
    setLog(p=>[{ts,msg,type,id:Math.random()},...p].slice(0,100));
  },[]);

  const notify=useCallback((title,body)=>{
    if("Notification" in window&&Notification.permission==="granted") try{new Notification(title,{body})}catch{}
  },[]);

  const checkOne=useCallback(async(ep)=>{
    setChecking(p=>({...p,[ep.id]:true}));
    const r=await probe(ep);
    const prev=prevStatus.current[ep.id];
    if(prev&&prev!==r.status){
      const inc={ts:Date.now(),name:ep.name,from:prev,to:r.status};
      setIncs(p=>[inc,...p].slice(0,200));
      if(r.status==="down"){addLog(`⚠ ${ep.name} went DOWN`,"err");notify(`${ep.name} DOWN`,`Was ${prev}`);}
      else if(prev==="down"){addLog(`✓ ${ep.name} recovered · ${r.latencyMs}ms`,"ok");notify(`${ep.name} recovered`,`${r.latencyMs}ms`);}
    }
    prevStatus.current[ep.id]=r.status;
    setResults(p=>({...p,[ep.id]:r}));
    setHist(p=>({...p,[ep.id]:[...(p[ep.id]||[]).slice(-(MAX_HIST-1)),{status:r.status,latencyMs:r.latencyMs,ts:r.timestamp}]}));
    setChecking(p=>({...p,[ep.id]:false}));
    addLog(`${ep.name} → ${(r.status||"down").toUpperCase()}  ${r.latencyMs}ms${r.httpStatus?"  HTTP "+r.httpStatus:""}${r.error?"  ✕ "+r.error:""}`,r.status==="ok"?"ok":r.status==="degraded"?"warn":"err");
    return r;
  },[addLog,notify]);

  const scanAll=useCallback(async()=>{
    if(globalBusy) return;
    setGlobalBusy(true); addLog("── scan ──","sep");
    await Promise.all(epsRef.current.map(ep=>checkOne(ep)));
    setLastScan(Date.now()); setGlobalBusy(false); addLog("── done ──","sep");
  },[checkOne,addLog,globalBusy]);

  useEffect(()=>{ if(mounted) scanAll(); },[mounted]);
  useEffect(()=>{ if(!auto) return; const iv=setInterval(scanAll,60000); return()=>clearInterval(iv); },[auto,scanAll]);

  const addEndpoint=()=>{
    const raw=addUrl.trim(); if(!raw) return;
    const url=raw.startsWith("http")?raw:`https://${raw}`;
    const isHealth=url.includes("/api/")||url.includes("/health");
    let host=url; try{host=new URL(url).hostname}catch{}
    const ep={id:`c_${Date.now()}`,name:addName.trim()||host,tag:"CUSTOM",url:isHealth?url.split("/api")[0]:url,healthUrl:isHealth?url:null,type:isHealth?"health":"http",desc:"Custom",color:"#94a3b8"};
    setEps(p=>[...p,ep]); setAddUrl(""); setAddName(""); checkOne(ep);
  };

  const removeEp=id=>{
    setEps(p=>p.filter(e=>e.id!==id));
    setResults(p=>{const n={...p};delete n[id];return n});
    setHist(p=>{const n={...p};delete n[id];return n});
  };

  const counts={ok:eps.filter(e=>results[e.id]?.status==="ok").length,degraded:eps.filter(e=>results[e.id]?.status==="degraded").length,down:eps.filter(e=>results[e.id]?.status==="down").length};
  const overall=counts.down>0?"down":counts.degraded>0?"degraded":Object.keys(results).length>0?"ok":"idle";
  const M="'Syne Mono',monospace";

  const Btn=({children,active,danger,sm,onClick,disabled=false,style:st={}})=>(
    <button onClick={onClick} disabled={disabled} style={{background:danger?"rgba(248,113,113,0.1)":active?"#E8622A":"transparent",color:danger?"#f87171":active?"#080806":disabled?"#555":"#F2EDE4",border:`1px solid ${danger?"rgba(248,113,113,0.3)":active?"#E8622A":"rgba(242,237,228,0.15)"}`,padding:sm?"4px 9px":"7px 16px",borderRadius:2,fontSize:sm?9:11,fontFamily:M,letterSpacing:"0.08em",fontWeight:700,cursor:disabled?"default":"pointer",opacity:disabled?0.4:1,transition:"all 0.12s",...st}}>{children}</button>
  );

  const TABS=[["monitors","MONITORS"],["incidents","INCIDENTS"+(incs.length?` (${incs.length})`:"")],["add","+ ADD"],["log","LOG"]];

  return(
    <>
      <Head>
        <title>DIAGHUB — Live System Status</title>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Syne+Mono&display=swap"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <meta name="theme-color" content="#080806"/>
      </Head>
      <style global jsx>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html,body{background:#080806;color:#F2EDE4;font-family:'Syne',sans-serif;min-height:100vh}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(242,237,228,0.1)}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.15}}
        @keyframes slide{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
        .card{animation:slide 0.18s ease}
        button{cursor:pointer}button:hover:not(:disabled){opacity:0.75}
        input,select{outline:none;font-family:'Syne Mono',monospace}
        .sl{position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(255,255,255,0.005) 3px,rgba(255,255,255,0.005) 4px);pointer-events:none;z-index:99}
      `}</style>
      <div className="sl"/>
      <div style={{maxWidth:940,margin:"0 auto",padding:"24px 16px 80px",position:"relative",zIndex:1}}>

        {/* HEADER */}
        <div style={{borderBottom:"1px solid rgba(242,237,228,0.09)",paddingBottom:18,marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12}}>
            <div>
              <h1 style={{fontWeight:800,fontSize:"clamp(26px,5vw,40px)",letterSpacing:"-0.03em",lineHeight:1}}>DIAG<span style={{color:"#E8622A"}}>HUB</span></h1>
              <div style={{fontFamily:M,fontSize:10,color:"rgba(242,237,228,0.3)",letterSpacing:"0.12em",marginTop:5,display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{color:sc(overall),fontWeight:700}}>{overall.toUpperCase()}</span>
                <span style={{opacity:0.3}}>·</span><span>SERVER-SIDE PROBES</span>
                {lastScan&&<><span style={{opacity:0.3}}>·</span><span>last scan {rel(lastScan)}</span></>}
              </div>
            </div>
            <div style={{display:"flex",gap:18}}>
              {[["ok","#4ade80","UP"],["degraded","#facc15","DEG"],["down","#f87171","DOWN"]].map(([k,c,l])=>(
                <div key={k} style={{textAlign:"right"}}>
                  <div style={{fontFamily:M,fontSize:26,fontWeight:700,color:c,lineHeight:1}}>{counts[k]}</div>
                  <div style={{fontFamily:M,fontSize:9,color:"rgba(242,237,228,0.3)",letterSpacing:"0.1em",marginTop:2}}>{l}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginTop:16,flexWrap:"wrap",alignItems:"center"}}>
            <Btn active={globalBusy} onClick={scanAll} disabled={globalBusy}>
              {globalBusy?<span style={{display:"flex",alignItems:"center",gap:6}}><span style={{display:"inline-block",width:9,height:9,border:"1.5px solid #080806",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>SCANNING</span>:"▶ SCAN ALL"}
            </Btn>
            <Btn active={auto} onClick={()=>setAuto(v=>!v)}>{auto?"⏸ AUTO ON (60s)":"⏵ AUTO OFF"}</Btn>
            {ntfPerm!=="granted"
              ?<Btn style={{color:"#facc15",borderColor:"rgba(250,204,21,0.3)"}} onClick={()=>{if("Notification"in window)Notification.requestPermission().then(p=>setNtfPerm(p))}}>🔔 ENABLE ALERTS</Btn>
              :<span style={{fontFamily:M,fontSize:10,color:"rgba(74,222,128,0.5)"}}>🔔 ALERTS ON</span>
            }
          </div>
        </div>

        {/* TABS */}
        <div style={{display:"flex",borderBottom:"1px solid rgba(242,237,228,0.07)",marginBottom:16}}>
          {TABS.map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} style={{background:"transparent",color:tab===k?"#F2EDE4":"rgba(242,237,228,0.3)",border:"none",borderBottom:`2px solid ${tab===k?"#E8622A":"transparent"}`,padding:"8px 14px",fontSize:10,fontFamily:M,letterSpacing:"0.1em",cursor:"pointer",marginBottom:-1,transition:"all 0.12s"}}>{l}</button>
          ))}
          <div style={{flex:1}}/>
          <button onClick={()=>{setHist({});setIncs([]);setResults({});addLog("cleared","info");}} style={{background:"transparent",color:"rgba(242,237,228,0.18)",border:"none",fontFamily:M,fontSize:9,cursor:"pointer",padding:"8px 12px"}}>CLEAR</button>
        </div>

        {/* MONITORS */}
        {tab==="monitors"&&(
          <div style={{display:"flex",flexDirection:"column",gap:3}}>
            {eps.map(ep=>{
              const r=results[ep.id],isC=checking[ep.id];
              const status=isC?"checking":(r?.status||"idle");
              const h=hist[ep.id]||[],isExp=expanded[ep.id];
              const hasC=r?.checks&&Object.keys(r.checks).length>0;
              const isBuiltIn=ENDPOINTS.some(e=>e.id===ep.id);
              const pct=upPct(h.map(d=>d.status));
              return(
                <div key={ep.id} className="card" style={{background:"rgba(242,237,228,0.02)",borderLeft:`2px solid ${sc(status)}`,overflow:"hidden",transition:"border-color 0.3s"}}>
                  <div style={{padding:"14px 16px",display:"grid",gridTemplateColumns:"10px 1fr auto",gap:"0 12px",alignItems:"center"}}>
                    <div style={{width:9,height:9,borderRadius:"50%",background:sc(status),boxShadow:glow(status),flexShrink:0,animation:isC?"pulse 0.9s infinite":"none"}}/>
                    <div style={{overflow:"hidden",minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontWeight:700,fontSize:14,letterSpacing:"0.02em"}}>{ep.name}</span>
                        <span style={{fontFamily:M,fontSize:9,letterSpacing:"0.1em",padding:"1px 5px",borderRadius:2,color:ep.tag==="PROD"?"#E8622A":ep.tag==="STAGING"?"#facc15":"rgba(242,237,228,0.35)",border:`1px solid ${ep.tag==="PROD"?"rgba(232,98,42,0.35)":ep.tag==="STAGING"?"rgba(250,204,21,0.25)":"rgba(242,237,228,0.12)"}`}}>{ep.tag}</span>
                        <span style={{fontFamily:M,fontSize:9,color:"rgba(242,237,228,0.25)"}}>{ep.desc}</span>
                      </div>
                      <div style={{fontFamily:M,fontSize:9,color:"rgba(242,237,228,0.18)",marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ep.healthUrl||ep.url}</div>
                      {h.length>1&&(
                        <div style={{display:"flex",alignItems:"center",gap:8,marginTop:5}}>
                          <div style={{display:"flex",gap:1.5}}>
                            {h.slice(-MAX_HIST).map((d,i)=>(
                              <div key={i} title={`${d.status}·${d.latencyMs}ms`} style={{width:4,height:13,borderRadius:1,background:sc(d.status),opacity:0.85,flexShrink:0}}/>
                            ))}
                          </div>
                          {pct!==null&&<span style={{fontFamily:M,fontSize:9,color:"rgba(242,237,228,0.28)"}}>{pct}% up</span>}
                        </div>
                      )}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
                      <Spark data={h} color={ep.color}/>
                      <div style={{textAlign:"right",minWidth:62}}>
                        <div style={{fontFamily:M,fontSize:13,fontWeight:700,color:lc(r?.latencyMs)}}>
                          {isC?<span style={{animation:"pulse 0.9s infinite",display:"inline-block"}}>···</span>:r?`${r.latencyMs}ms`:"—"}
                        </div>
                        {r&&<div style={{height:2,background:"rgba(242,237,228,0.06)",borderRadius:1,marginTop:3}}><div style={{height:"100%",borderRadius:1,background:lc(r.latencyMs),width:`${Math.min(100,(r.latencyMs/3000)*100)}%`,transition:"width 0.5s"}}/></div>}
                      </div>
                      <div style={{textAlign:"right",minWidth:60}}>
                        <div style={{fontFamily:M,fontSize:10,fontWeight:700,color:sc(status),letterSpacing:"0.06em"}}>{isC?"···":status.toUpperCase()}</div>
                        <div style={{fontFamily:M,fontSize:9,color:"rgba(242,237,228,0.2)",marginTop:2}}>{r?rel(r.timestamp):"—"}</div>
                      </div>
                      <div style={{display:"flex",gap:4}}>
                        <Btn sm onClick={()=>checkOne(ep)} disabled={isC}>{isC?<span style={{display:"inline-block",animation:"spin 0.7s linear infinite"}}>↻</span>:"↺"}</Btn>
                        {hasC&&<Btn sm onClick={()=>setExpanded(p=>({...p,[ep.id]:!p[ep.id]}))}>{isExp?"▲":"▼"}</Btn>}
                        {!isBuiltIn&&<Btn sm danger onClick={()=>removeEp(ep.id)}>×</Btn>}
                      </div>
                    </div>
                  </div>
                  {isExp&&hasC&&(
                    <div style={{borderTop:"1px solid rgba(242,237,228,0.06)",padding:"10px 16px 14px 34px"}}>
                      <Checks checks={r.checks}/>
                      {r.checks?.system&&<div style={{fontFamily:M,fontSize:9,color:"rgba(242,237,228,0.2)",marginTop:8}}>uptime {fmtUp(r.checks.system.uptimeSeconds)}{r.checks.system.memoryMB?`  ·  ${r.checks.system.memoryMB}MB RAM`:""}{r.checks.system.node?`  ·  ${r.checks.system.node}`:""}</div>}
                      {r.checks?.socketio&&<div style={{fontFamily:M,fontSize:9,color:"rgba(242,237,228,0.2)",marginTop:3}}>{r.checks.socketio.connections} sockets  ·  {r.checks.socketio.activeStreams} active streams</div>}
                      {r.checks?.database&&<div style={{fontFamily:M,fontSize:9,color:"rgba(242,237,228,0.2)",marginTop:3}}>{r.checks.database.users} users  ·  {r.checks.database.posts} posts  ·  {r.checks.database.messages} messages</div>}
                    </div>
                  )}
                  {r?.error&&<div style={{padding:"4px 16px 10px 34px",fontFamily:M,fontSize:10,color:"#f87171"}}>✕ {r.error}</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* INCIDENTS */}
        {tab==="incidents"&&(
          <div>
            {incs.length===0
              ?<div style={{fontFamily:M,fontSize:11,color:"rgba(242,237,228,0.2)",padding:"40px 0",textAlign:"center"}}>No incidents recorded</div>
              :<div style={{display:"flex",flexDirection:"column",gap:2}}>
                {incs.map((inc,i)=>(
                  <div key={i} style={{background:"rgba(242,237,228,0.025)",borderLeft:`2px solid ${inc.to==="down"?"#f87171":"#4ade80"}`,padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                    <div style={{display:"flex",gap:12,alignItems:"center"}}>
                      <span style={{fontWeight:700,fontSize:13}}>{inc.name}</span>
                      <span style={{fontFamily:M,fontSize:10,color:"rgba(242,237,228,0.4)"}}>{inc.from.toUpperCase()} → <span style={{color:sc(inc.to),fontWeight:700}}>{inc.to.toUpperCase()}</span></span>
                    </div>
                    <span style={{fontFamily:M,fontSize:10,color:"rgba(242,237,228,0.25)"}}>{new Date(inc.ts).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            }
          </div>
        )}

        {/* ADD */}
        {tab==="add"&&(
          <div style={{maxWidth:520}}>
            <div style={{fontFamily:M,fontSize:9,color:"rgba(242,237,228,0.3)",letterSpacing:"0.15em",marginBottom:14}}>ADD ENDPOINT</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <input value={addUrl} onChange={e=>setAddUrl(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addEndpoint()}
                placeholder="https://yoursite.com  or  https://yoursite.com/api/health"
                style={{background:"rgba(242,237,228,0.04)",border:"1px solid rgba(242,237,228,0.14)",color:"#F2EDE4",padding:"10px 14px",borderRadius:2,fontSize:12,width:"100%"}}/>
              <div style={{display:"flex",gap:8}}>
                <input value={addName} onChange={e=>setAddName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addEndpoint()}
                  placeholder="Label (optional)"
                  style={{background:"rgba(242,237,228,0.04)",border:"1px solid rgba(242,237,228,0.14)",color:"#F2EDE4",padding:"9px 12px",borderRadius:2,fontSize:12,flex:1}}/>
                <Btn active onClick={addEndpoint}>+ ADD</Btn>
              </div>
            </div>
            <div style={{fontFamily:M,fontSize:10,color:"rgba(242,237,228,0.2)",marginTop:16,lineHeight:2}}>
              <div>· URLs with /api/ or /health → JSON health endpoint</div>
              <div>· All other URLs → HTTP probe (200 = UP)</div>
              <div>· All probes run server-side — no CORS issues</div>
            </div>
          </div>
        )}

        {/* LOG */}
        {tab==="log"&&(
          <div style={{background:"rgba(0,0,0,0.5)",border:"1px solid rgba(242,237,228,0.07)",borderRadius:2,padding:"14px 16px",height:"60vh",overflowY:"auto",fontFamily:M,fontSize:11,lineHeight:1.9}}>
            {log.length===0&&<span style={{color:"rgba(242,237,228,0.2)"}}>Waiting…</span>}
            {log.map(e=>(
              <div key={e.id} style={{color:e.type==="ok"?"rgba(74,222,128,0.75)":e.type==="err"?"rgba(248,113,113,0.75)":e.type==="warn"?"rgba(250,204,21,0.65)":e.type==="sep"?"rgba(232,98,42,0.5)":"rgba(242,237,228,0.35)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                <span style={{opacity:0.35}}>[{e.ts}]</span> {e.msg}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#080806",borderTop:"1px solid rgba(242,237,228,0.06)",padding:"9px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",fontFamily:M,fontSize:10,color:"rgba(242,237,228,0.25)",zIndex:200,flexWrap:"wrap",gap:8}}>
        <span>DIAGHUB · {eps.length} endpoints · diaghub.vercel.app</span>
        <div style={{display:"flex",gap:16,alignItems:"center"}}>
          <span style={{cursor:"pointer",color:auto?"#4ade80":"rgba(242,237,228,0.25)"}} onClick={()=>setAuto(v=>!v)}>{auto?"● AUTO 60s":"○ MANUAL"}</span>
          <span style={{color:sc(overall),fontWeight:700}}>SYSTEM {overall.toUpperCase()}</span>
        </div>
      </div>
    </>
  );
}
