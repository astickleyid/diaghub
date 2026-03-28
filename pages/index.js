import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';

// ─── Endpoints config ─────────────────────────────────────────────────────
const BUILT_IN = [
  { id: 'nxcor',      name: 'nXcor',      tag: 'PROD', url: 'https://n-xcor.com',                  healthUrl: 'https://n-xcor.com/api/health',                    desc: 'VPS · Socket.IO · SQLite' },
  { id: 'aura',       name: 'AURA',        tag: 'PROD', url: 'https://aura-ar-world.vercel.app',    healthUrl: 'https://aura-ar-world.vercel.app/api/health',       desc: 'AR · PulsePoint · Vercel' },
  { id: 'findafiend', name: 'findafiend',  tag: 'PROD', url: 'https://findafiend.vercel.app',       healthUrl: 'https://findafiend.vercel.app/api/health',          desc: 'Rideshare · Redis · Next.js' },
  { id: 'clarusign',  name: 'ClaruSign',   tag: 'PROD', url: 'https://clarusign.com',               healthUrl: null,                                               desc: 'Static · Legal · Vercel' },
];

const TIMEOUT = 9000;
const MAX_HIST = 30;
const STORAGE_KEY = 'diaghub_endpoints_v1';

// ─── Helpers ─────────────────────────────────────────────────────────────
const SC = { ok:'#4ade80', degraded:'#facc15', down:'#f87171', checking:'#E8622A', idle:'#383836' };
const sc = s => SC[s] || SC.idle;
const lc = ms => ms==null?'#555':ms<400?'#4ade80':ms<1200?'#facc15':'#f87171';
const rel = ts => { if(!ts) return '—'; const s=Math.floor((Date.now()-ts)/1000); if(s<5) return 'just now'; if(s<60) return s+'s ago'; if(s<3600) return Math.floor(s/60)+'m ago'; return Math.floor(s/3600)+'h ago'; };
const fmtUp = s => !s?'—':s<60?s+'s':s<3600?Math.floor(s/60)+'m '+s%60+'s':Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m';
const upPct = arr => { if(!arr||arr.length<2) return null; const ok=arr.filter(x=>x==='ok'||x==='degraded').length; return Math.round((ok/arr.length)*100); };

// ─── Server probe via our own API route ──────────────────────────────────
async function serverProbe(ep) {
  const type = ep.healthUrl ? 'health' : 'http';
  const target = ep.healthUrl || ep.url;
  const apiUrl = `/api/probe?url=${encodeURIComponent(target)}&type=${type}`;
  try {
    const r = await fetch(apiUrl, { cache: 'no-store' });
    if (!r.ok) throw new Error('Probe API ' + r.status);
    return await r.json();
  } catch (e) {
    return { ok: false, status: 'down', latencyMs: 0, httpStatus: null, checks: {}, error: e.message, timestamp: Date.now() };
  }
}

// ─── Sparkline ───────────────────────────────────────────────────────────
function Spark({ hist }) {
  if (!hist || hist.length < 2) return <div style={{width:72,height:18}} />;
  const vals = hist.map(h => h.latencyMs || 0);
  const max = Math.max(...vals, 1);
  const W = 72, H = 18;
  const pts = vals.map((v,i) => `${Math.round((i/(vals.length-1))*W)},${Math.round(H-(v/max)*(H-2)+1)}`).join(' ');
  return (
    <svg width={W} height={H} style={{display:'block'}}>
      <polyline points={pts} fill="none" stroke="rgba(232,98,42,0.5)" strokeWidth="1.5" strokeLinejoin="round"/>
      {hist.map((h,i)=>(
        <circle key={i}
          cx={Math.round((i/(vals.length-1))*W)}
          cy={Math.round(H-(h.latencyMs||0)/max*(H-2)+1)}
          r="2" fill={sc(h.status)}/>
      ))}
    </svg>
  );
}

// ─── Check grid ──────────────────────────────────────────────────────────
function Checks({ checks }) {
  const entries = Object.entries(checks || {});
  if (!entries.length) return null;
  return (
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(175px,1fr))',gap:7,marginTop:12}}>
      {entries.map(([k,v])=>(
        <div key={k} style={{background:'rgba(0,0,0,0.35)',border:'1px solid rgba(242,237,228,0.07)',borderRadius:2,padding:'9px 11px'}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
            <span style={{fontFamily:'var(--mono)',fontSize:9,letterSpacing:'0.12em',color:'rgba(242,237,228,0.4)'}}>{k.toUpperCase()}</span>
            <span style={{fontFamily:'var(--mono)',fontSize:9,fontWeight:700,color:SC[v?.status]||'#4ade80',letterSpacing:'0.08em'}}>{(v?.status||'ok').toUpperCase()}</span>
          </div>
          {Object.entries(v||{}).filter(([kk])=>kk!=='status').map(([kk,vv])=>(
            <div key={kk} style={{display:'flex',justifyContent:'space-between',gap:6,marginTop:2}}>
              <span style={{fontFamily:'var(--mono)',fontSize:9,color:'rgba(242,237,228,0.25)'}}>{kk}</span>
              <span style={{fontFamily:'var(--mono)',fontSize:9,color:'rgba(242,237,228,0.55)',maxWidth:90,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {typeof vv==='boolean'?(vv?'yes':'no'):String(vv)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Main app ─────────────────────────────────────────────────────────────
export default function DiagHub() {
  const [eps,     setEps]     = useState(BUILT_IN);
  const [results, setResults] = useState({});
  const [hist,    setHist]    = useState({});
  const [incs,    setIncs]    = useState([]);
  const [busy,    setBusy]    = useState({});
  const [exp,     setExp]     = useState({});
  const [auto,    setAuto]    = useState(false);
  const [tab,     setTab]     = useState('monitors');
  const [log,     setLog]     = useState([]);
  const [newUrl,  setNewUrl]  = useState('');
  const [newName, setNewName] = useState('');
  const [newTag,  setNewTag]  = useState('CUSTOM');
  const [globalBusy, setGB]   = useState(false);
  const [ntfPerm, setNtfPerm] = useState('default');
  const [lastScan,setLastScan]= useState(null);

  const prevSt  = useRef({});
  const epsRef  = useRef(eps);
  epsRef.current = eps;

  // Load persisted custom endpoints
  useEffect(()=>{
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const custom = JSON.parse(saved);
        setEps(p => [...BUILT_IN, ...custom.filter(c=>!BUILT_IN.find(b=>b.id===c.id))]);
      }
    } catch {}
    if ('Notification' in window) setNtfPerm(Notification.permission);
  },[]);

  // Persist custom endpoints
  useEffect(()=>{
    try {
      const custom = eps.filter(e=>e.tag==='CUSTOM'||e.tag==='STAGING'||e.tag==='DEV');
      if(custom.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
    } catch {}
  },[eps]);

  const addLog = useCallback((msg, type='info')=>{
    const ts = new Date().toLocaleTimeString([],{hour12:false});
    setLog(p=>[{ts,msg,type,id:Math.random()},...p].slice(0,100));
  },[]);

  const notify = useCallback((title, body)=>{
    if ('Notification' in window && Notification.permission==='granted') {
      try { new Notification(title, {body}); } catch{}
    }
  },[]);

  const checkOne = useCallback(async (ep)=>{
    setBusy(p=>({...p,[ep.id]:true}));
    const r = await serverProbe(ep);
    const prev = prevSt.current[ep.id];
    if (prev && prev!==r.status) {
      const inc = {ts:Date.now(), name:ep.name, from:prev, to:r.status};
      setIncs(p=>[inc,...p].slice(0,200));
      if (r.status==='down') { addLog(`⚠ ${ep.name} went DOWN`, 'err'); notify(`${ep.name} DOWN`,`Was ${prev}`); }
      else if (prev==='down') { addLog(`✓ ${ep.name} recovered → ${r.status}`, 'ok'); notify(`${ep.name} recovered`,`${r.latencyMs}ms`); }
    }
    prevSt.current[ep.id] = r.status;
    setResults(p=>({...p,[ep.id]:r}));
    setHist(p=>({...p,[ep.id]:[...(p[ep.id]||[]).slice(-(MAX_HIST-1)),{status:r.status,latencyMs:r.latencyMs,ts:r.timestamp}]}));
    setBusy(p=>({...p,[ep.id]:false}));
    addLog(`${ep.name} → ${(r.status||'down').toUpperCase()}  ${r.latencyMs}ms${r.httpStatus?'  HTTP '+r.httpStatus:''}${r.error?'  ✕ '+r.error:''}`, r.status==='ok'?'ok':r.status==='degraded'?'warn':'err');
    return r;
  },[addLog, notify]);

  const scanAll = useCallback(async ()=>{
    if (globalBusy) return;
    setGB(true);
    addLog('── full scan ──','sep');
    await Promise.all(epsRef.current.map(ep=>checkOne(ep)));
    setLastScan(Date.now());
    setGB(false);
    addLog('── complete ──','sep');
  },[checkOne, addLog, globalBusy]);

  useEffect(()=>{ scanAll(); },[]);
  useEffect(()=>{
    if (!auto) return;
    const iv = setInterval(scanAll, 60000);
    return ()=>clearInterval(iv);
  },[auto, scanAll]);

  const addEp = ()=>{
    const raw = newUrl.trim();
    if (!raw) return;
    const url = raw.startsWith('http') ? raw : 'https://'+raw;
    let hostname = url; try{hostname=new URL(url).hostname}catch{}
    const isHealth = url.includes('/health') || url.includes('/api/');
    const id = 'custom_'+Date.now();
    const ep = {id, name:newName.trim()||hostname, tag:newTag, url: isHealth?url.split('/api/')[0]:url, healthUrl:isHealth?url:null, desc:'Custom endpoint'};
    setEps(p=>[...p,ep]);
    setNewUrl(''); setNewName('');
    checkOne(ep);
  };

  const removeEp = (id)=>{
    setEps(p=>p.filter(e=>e.id!==id));
    setResults(p=>{const n={...p};delete n[id];return n});
    setHist(p=>{const n={...p};delete n[id];return n});
    addLog('Removed endpoint '+id,'info');
  };

  const counts = {
    ok: eps.filter(e=>results[e.id]?.status==='ok').length,
    degraded: eps.filter(e=>results[e.id]?.status==='degraded').length,
    down: eps.filter(e=>results[e.id]?.status==='down').length,
  };
  const overall = counts.down>0?'down':counts.degraded>0?'degraded':Object.keys(results).length>0?'ok':'idle';

  const MONO="'Syne Mono', monospace";
  const SANS="'Syne', sans-serif";

  const Btn = ({children,active,danger,sm,onClick,disabled=false,style:st={}})=>(
    <button onClick={onClick} disabled={disabled} style={{
      background:danger?'rgba(248,113,113,0.1)':active?'#E8622A':'transparent',
      color:danger?'#f87171':active?'#080806':disabled?'#444':'#F2EDE4',
      border:`1px solid ${danger?'rgba(248,113,113,0.35)':active?'#E8622A':'rgba(242,237,228,0.15)'}`,
      padding:sm?'4px 10px':'7px 16px',
      borderRadius:2, fontSize:sm?9:11, fontFamily:MONO,
      letterSpacing:'0.08em', fontWeight:700,
      cursor:disabled?'not-allowed':'pointer',
      opacity:disabled?0.5:1, transition:'all 0.15s', ...st
    }}>{children}</button>
  );

  const tabs = [
    ['monitors','MONITORS'],
    ['incidents','INCIDENTS'+(incs.length?' ('+incs.length+')':'')],
    ['add','+ ADD'],
    ['log','LOG'],
  ];

  return (
    <>
      <Head>
        <title>DIAGHUB — System Status</title>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Syne+Mono&display=swap"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="theme-color" content="#080806"/>
      </Head>

      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html,body{background:#080806;color:#F2EDE4;font-family:'Syne',sans-serif;min-height:100vh}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-thumb{background:rgba(242,237,228,0.12)}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.2}}
        @keyframes fadein{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
        .card{animation:fadein 0.2s ease}
        input,select,button{font-family:'Syne Mono',monospace;outline:none}
        button:hover:not(:disabled){opacity:0.75}
        a{color:inherit;text-decoration:none}
        .scanlines{position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(255,255,255,0.006) 3px,rgba(255,255,255,0.006) 4px);pointer-events:none;z-index:99}
      `}</style>

      <div className="scanlines"/>

      <div style={{maxWidth:920,margin:'0 auto',padding:'24px 16px 80px',position:'relative',zIndex:1}}>

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',flexWrap:'wrap',gap:12,borderBottom:'1px solid rgba(242,237,228,0.1)',paddingBottom:18,marginBottom:20}}>
          <div>
            <h1 style={{fontWeight:800,fontSize:'clamp(26px,5vw,38px)',letterSpacing:'-0.03em',lineHeight:1}}>
              DIAG<span style={{color:'#E8622A'}}>HUB</span>
            </h1>
            <div style={{fontFamily:MONO,fontSize:10,color:'rgba(242,237,228,0.3)',letterSpacing:'0.12em',marginTop:5,display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
              <span style={{color:sc(overall),fontWeight:700}}>{overall.toUpperCase()}</span>
              <span style={{opacity:0.3}}>·</span>
              <span>{eps.length} ENDPOINTS</span>
              <span style={{opacity:0.3}}>·</span>
              <span>SERVER PROBES</span>
              {lastScan && <><span style={{opacity:0.3}}>·</span><span>last scan {rel(lastScan)}</span></>}
            </div>
          </div>
          <div style={{display:'flex',gap:20}}>
            {[['ok','#4ade80','UP'],['degraded','#facc15','DEG'],['down','#f87171','DOWN']].map(([k,c,l])=>(
              <div key={k} style={{textAlign:'right'}}>
                <div style={{fontFamily:MONO,fontSize:24,fontWeight:700,color:c,lineHeight:1}}>{counts[k]}</div>
                <div style={{fontFamily:MONO,fontSize:9,color:'rgba(242,237,228,0.3)',letterSpacing:'0.1em',marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CONTROLS ───────────────────────────────────────────────── */}
        <div style={{display:'flex',gap:8,marginBottom:18,flexWrap:'wrap',alignItems:'center'}}>
          <Btn active={globalBusy} onClick={scanAll} disabled={globalBusy}>
            {globalBusy
              ? <span style={{display:'flex',alignItems:'center',gap:7}}><span style={{display:'inline-block',width:9,height:9,border:'1.5px solid #080806',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/>SCANNING</span>
              : '▶ SCAN ALL'}
          </Btn>
          <Btn active={auto} onClick={()=>setAuto(v=>!v)}>
            {auto?'⏸ AUTO ON (60s)':'⏵ AUTO OFF'}
          </Btn>
          {ntfPerm!=='granted'
            ? <Btn onClick={()=>{ if('Notification' in window) Notification.requestPermission().then(p=>setNtfPerm(p)); }} style={{color:'#facc15',borderColor:'rgba(250,204,21,0.3)'}}>🔔 ENABLE ALERTS</Btn>
            : <span style={{fontFamily:MONO,fontSize:10,color:'rgba(74,222,128,0.55)'}}>🔔 ALERTS ON</span>
          }
        </div>

        {/* ── TABS ──────────────────────────────────────────────────── */}
        <div style={{display:'flex',borderBottom:'1px solid rgba(242,237,228,0.08)',marginBottom:16}}>
          {tabs.map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} style={{
              background:'transparent',
              color:tab===k?'#F2EDE4':'rgba(242,237,228,0.3)',
              border:'none',
              borderBottom:`2px solid ${tab===k?'#E8622A':'transparent'}`,
              padding:'8px 14px',fontSize:10,fontFamily:MONO,
              letterSpacing:'0.1em',cursor:'pointer',
              transition:'all 0.15s',marginBottom:-1,
            }}>{l}</button>
          ))}
          <div style={{flex:1}}/>
          <button onClick={()=>{setHist({});setIncs([]);setResults({});addLog('History cleared','info');}} style={{background:'transparent',color:'rgba(242,237,228,0.18)',border:'none',fontFamily:MONO,fontSize:9,cursor:'pointer',padding:'8px 12px',letterSpacing:'0.08em'}}>CLEAR</button>
        </div>

        {/* ══ MONITORS ═══════════════════════════════════════════════ */}
        {tab==='monitors' && (
          <div style={{display:'flex',flexDirection:'column',gap:3}}>
            {eps.map(ep=>{
              const r = results[ep.id];
              const isB = busy[ep.id];
              const status = isB?'checking':(r?.status||'idle');
              const h = hist[ep.id]||[];
              const isExp = exp[ep.id];
              const hasC = r?.checks && Object.keys(r.checks).length>0;
              const pct = upPct(h.map(x=>x.status));

              return (
                <div key={ep.id} className="card" style={{background:'rgba(242,237,228,0.02)',borderLeft:`2px solid ${sc(status)}`,overflow:'hidden',transition:'border-color 0.3s'}}>
                  {/* Row */}
                  <div style={{padding:'13px 14px',display:'grid',gridTemplateColumns:'10px 1fr auto',gap:'0 12px',alignItems:'center'}}>
                    {/* Dot */}
                    <div style={{width:9,height:9,borderRadius:'50%',background:sc(status),boxShadow:status==='ok'?`0 0 8px rgba(74,222,128,0.5)`:status==='down'?`0 0 8px rgba(248,113,113,0.4)`:'none',animation:isB?'pulse 0.8s infinite':'none'}}/>

                    {/* Info */}
                    <div style={{overflow:'hidden',minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                        <span style={{fontWeight:700,fontSize:14,letterSpacing:'0.02em'}}>{ep.name}</span>
                        <span style={{fontFamily:MONO,fontSize:9,letterSpacing:'0.1em',padding:'1px 5px',borderRadius:2,
                          color:ep.tag==='PROD'?'#E8622A':ep.tag==='STAGING'?'#facc15':'rgba(242,237,228,0.4)',
                          border:`1px solid ${ep.tag==='PROD'?'rgba(232,98,42,0.35)':ep.tag==='STAGING'?'rgba(250,204,21,0.25)':'rgba(242,237,228,0.15)'}`
                        }}>{ep.tag}</span>
                        <span style={{fontFamily:MONO,fontSize:9,color:'rgba(242,237,228,0.25)'}}>{ep.desc}</span>
                      </div>
                      <div style={{fontFamily:MONO,fontSize:9,color:'rgba(242,237,228,0.18)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {ep.healthUrl||ep.url}
                      </div>
                      {/* History ticks */}
                      {h.length>1 && (
                        <div style={{display:'flex',alignItems:'center',gap:8,marginTop:5}}>
                          <div style={{display:'flex',gap:1.5}}>
                            {h.slice(-MAX_HIST).map((hh,i)=>(
                              <div key={i} style={{width:4,height:13,borderRadius:1,background:sc(hh.status),opacity:0.8}} title={`${hh.status} · ${hh.latencyMs}ms`}/>
                            ))}
                          </div>
                          {pct!==null && <span style={{fontFamily:MONO,fontSize:9,color:'rgba(242,237,228,0.28)'}}>{pct}% up</span>}
                        </div>
                      )}
                    </div>

                    {/* Right */}
                    <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
                      <Spark hist={h}/>
                      {/* Latency */}
                      <div style={{textAlign:'right',minWidth:58}}>
                        <div style={{fontFamily:MONO,fontSize:13,fontWeight:700,color:lc(r?.latencyMs)}}>
                          {isB?<span style={{animation:'pulse 0.8s infinite',display:'inline-block'}}>···</span>:r?r.latencyMs+'ms':'—'}
                        </div>
                        {r && <div style={{height:2,background:'rgba(242,237,228,0.06)',borderRadius:1,marginTop:3}}><div style={{height:'100%',borderRadius:1,background:lc(r.latencyMs),width:Math.min(100,(r.latencyMs/3000)*100)+'%',transition:'width 0.5s'}}/></div>}
                      </div>
                      {/* Status */}
                      <div style={{textAlign:'right',minWidth:56}}>
                        <div style={{fontFamily:MONO,fontSize:10,fontWeight:700,color:sc(status),letterSpacing:'0.06em'}}>
                          {isB?'···':status.toUpperCase()}
                        </div>
                        <div style={{fontFamily:MONO,fontSize:9,color:'rgba(242,237,228,0.2)',marginTop:2}}>{r?rel(r.timestamp):'—'}</div>
                      </div>
                      {/* Actions */}
                      <div style={{display:'flex',gap:4}}>
                        <Btn sm onClick={()=>checkOne(ep)} disabled={isB}>
                          {isB?<span style={{display:'inline-block',animation:'spin 0.7s linear infinite'}}>↻</span>:'↺'}
                        </Btn>
                        {hasC && <Btn sm onClick={()=>setExp(p=>({...p,[ep.id]:!p[ep.id]}))}>
                          {isExp?'▲':'▼'}
                        </Btn>}
                        {!['nxcor','aura','findafiend','clarusign'].includes(ep.id) && (
                          <Btn sm danger onClick={()=>removeEp(ep.id)}>×</Btn>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded */}
                  {isExp && hasC && (
                    <div style={{borderTop:'1px solid rgba(242,237,228,0.06)',padding:'10px 14px 14px 32px'}}>
                      <Checks checks={r.checks}/>
                      {r.checks?.system && (
                        <div style={{fontFamily:MONO,fontSize:9,color:'rgba(242,237,228,0.2)',marginTop:8}}>
                          uptime {fmtUp(r.checks.system.uptimeSeconds)}
                          {r.checks.system.memoryMB?'  ·  '+r.checks.system.memoryMB+'MB RSS':''}
                          {r.checks.system.node?'  ·  '+r.checks.system.node:''}
                        </div>
                      )}
                      {r.checks?.socketio && (
                        <div style={{fontFamily:MONO,fontSize:9,color:'rgba(242,237,228,0.2)',marginTop:3}}>
                          {r.checks.socketio.connections} socket connections  ·  {r.checks.socketio.activeStreams} active streams
                        </div>
                      )}
                      {r.checks?.database && (
                        <div style={{fontFamily:MONO,fontSize:9,color:'rgba(242,237,228,0.2)',marginTop:3}}>
                          {r.checks.database.users} users  ·  {r.checks.database.posts} posts  ·  {r.checks.database.messages} messages
                        </div>
                      )}
                    </div>
                  )}

                  {r?.error && (
                    <div style={{padding:'4px 14px 10px 32px',fontFamily:MONO,fontSize:10,color:'#f87171'}}>✕ {r.error}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ══ INCIDENTS ══════════════════════════════════════════════ */}
        {tab==='incidents' && (
          <div>
            {incs.length===0
              ? <div style={{fontFamily:MONO,fontSize:11,color:'rgba(242,237,228,0.2)',padding:'40px 0',textAlign:'center'}}>No incidents this session</div>
              : <div style={{display:'flex',flexDirection:'column',gap:2}}>
                  {incs.map((inc,i)=>(
                    <div key={i} style={{background:'rgba(242,237,228,0.025)',borderLeft:`2px solid ${inc.to==='down'?'#f87171':'#4ade80'}`,padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
                      <div style={{display:'flex',gap:12,alignItems:'center'}}>
                        <span style={{fontWeight:700,fontSize:13}}>{inc.name}</span>
                        <span style={{fontFamily:MONO,fontSize:10,color:'rgba(242,237,228,0.4)'}}>
                          {inc.from.toUpperCase()} → <span style={{color:sc(inc.to),fontWeight:700}}>{inc.to.toUpperCase()}</span>
                        </span>
                      </div>
                      <span style={{fontFamily:MONO,fontSize:10,color:'rgba(242,237,228,0.25)'}}>{new Date(inc.ts).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
            }
          </div>
        )}

        {/* ══ ADD ════════════════════════════════════════════════════ */}
        {tab==='add' && (
          <div style={{maxWidth:540}}>
            <div style={{fontFamily:MONO,fontSize:9,color:'rgba(242,237,228,0.3)',letterSpacing:'0.15em',marginBottom:14}}>ADD ENDPOINT</div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <input value={newUrl} onChange={e=>setNewUrl(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addEp()}
                placeholder="https://yourapp.com  or  https://yourapp.com/api/health"
                style={{background:'rgba(242,237,228,0.04)',border:'1px solid rgba(242,237,228,0.15)',color:'#F2EDE4',padding:'10px 14px',borderRadius:2,fontSize:12,width:'100%'}}
              />
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <input value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addEp()}
                  placeholder="Label (optional)"
                  style={{background:'rgba(242,237,228,0.04)',border:'1px solid rgba(242,237,228,0.15)',color:'#F2EDE4',padding:'9px 12px',borderRadius:2,fontSize:12,flex:1,minWidth:120}}
                />
                <select value={newTag} onChange={e=>setNewTag(e.target.value)}
                  style={{background:'#0d0d0b',border:'1px solid rgba(242,237,228,0.15)',color:'#F2EDE4',padding:'9px 12px',borderRadius:2,fontSize:11}}>
                  <option>CUSTOM</option><option>PROD</option><option>STAGING</option><option>DEV</option>
                </select>
                <Btn active onClick={addEp}>+ ADD</Btn>
              </div>
            </div>
            <div style={{fontFamily:MONO,fontSize:10,color:'rgba(242,237,228,0.2)',marginTop:16,lineHeight:2}}>
              <div>· URL ending with /health or /api/* → parsed as JSON health response</div>
              <div>· Any other URL → HTTP HEAD probe (200 = UP)</div>
              <div>· Server-side proxy — no CORS issues</div>
              <div>· Custom endpoints persist in localStorage</div>
            </div>
            <div style={{marginTop:24,borderTop:'1px solid rgba(242,237,228,0.07)',paddingTop:16}}>
              <div style={{fontFamily:MONO,fontSize:9,color:'rgba(242,237,228,0.3)',letterSpacing:'0.12em',marginBottom:10}}>ACTIVE ENDPOINTS</div>
              {eps.map(ep=>(
                <div key={ep.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid rgba(242,237,228,0.05)',gap:8,flexWrap:'wrap'}}>
                  <div>
                    <span style={{fontWeight:700,fontSize:12,marginRight:10}}>{ep.name}</span>
                    <span style={{fontFamily:MONO,fontSize:9,color:'rgba(242,237,228,0.25)'}}>{ep.healthUrl||ep.url}</span>
                  </div>
                  {!['nxcor','aura','findafiend','clarusign'].includes(ep.id) && (
                    <Btn sm danger onClick={()=>removeEp(ep.id)}>REMOVE</Btn>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ LOG ════════════════════════════════════════════════════ */}
        {tab==='log' && (
          <div style={{background:'rgba(0,0,0,0.5)',border:'1px solid rgba(242,237,228,0.07)',borderRadius:2,padding:'14px 16px',height:'60vh',overflowY:'auto',fontFamily:MONO,fontSize:11,lineHeight:1.9}}>
            {log.length===0 && <span style={{color:'rgba(242,237,228,0.2)'}}>Waiting…</span>}
            {log.map(e=>(
              <div key={e.id} style={{color:e.type==='ok'?'rgba(74,222,128,0.7)':e.type==='err'?'rgba(248,113,113,0.75)':e.type==='warn'?'rgba(250,204,21,0.65)':e.type==='sep'?'rgba(232,98,42,0.5)':'rgba(242,237,228,0.35)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                <span style={{opacity:0.35}}>[{e.ts}]</span> {e.msg}
              </div>
            ))}
          </div>
        )}

      </div>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <div style={{position:'fixed',bottom:0,left:0,right:0,background:'#080806',borderTop:'1px solid rgba(242,237,228,0.07)',padding:'9px 20px',display:'flex',justifyContent:'space-between',alignItems:'center',fontFamily:MONO,fontSize:10,color:'rgba(242,237,228,0.25)',zIndex:200,flexWrap:'wrap',gap:8}}>
        <span>DIAGHUB · {eps.length} endpoints · server-side probes</span>
        <div style={{display:'flex',gap:16,alignItems:'center'}}>
          <span style={{cursor:'pointer',color:auto?'#4ade80':'rgba(242,237,228,0.25)'}} onClick={()=>setAuto(v=>!v)}>
            {auto?'● AUTO 60s':'○ MANUAL'}
          </span>
          <span style={{color:overall==='ok'?'#4ade80':overall==='degraded'?'#facc15':overall==='down'?'#f87171':'#444',fontWeight:700}}>
            SYSTEM {overall.toUpperCase()}
          </span>
        </div>
      </div>
    </>
  );
}
