export const MATCHPULSE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="MatchPulse turns verified TxLINE match events into accessible, non-betting fan explanations.">
  <title>MatchPulse — Verified match moments, explained</title>
  <style>
    :root{color-scheme:dark;--ink:#eef6f0;--muted:#98aa9e;--line:#294335;--lime:#b7f56b;--cyan:#69e6d1;--panel:#132219;--bg:#07120d}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 0,#17392b 0,transparent 34rem),var(--bg);color:var(--ink);font:16px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;min-height:100vh}
    a{color:inherit}.shell{width:min(1120px,calc(100% - 32px));margin:auto}.top{display:flex;justify-content:space-between;align-items:center;padding:24px 0}.brand{font-weight:800;letter-spacing:.02em}.pill{border:1px solid var(--line);border-radius:999px;padding:7px 12px;color:var(--muted);font-size:13px}.hero{padding:76px 0 42px;display:grid;grid-template-columns:1.2fr .8fr;gap:42px;align-items:end}.eyebrow{color:var(--lime);font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.hero h1{font-size:clamp(42px,8vw,86px);line-height:.92;letter-spacing:-.06em;margin:18px 0 24px;max-width:850px}.hero p{max-width:640px;color:var(--muted);font-size:18px}.metric{border-left:1px solid var(--line);padding-left:28px}.metric b{font-size:36px;color:var(--cyan);display:block}.controls{display:flex;gap:10px;flex-wrap:wrap;padding:20px 0 28px;border-top:1px solid var(--line)}button,select{font:inherit;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:11px;padding:11px 15px}button{cursor:pointer;font-weight:750}button.primary{background:var(--lime);color:#10200f;border-color:var(--lime)}button:disabled{cursor:not-allowed;opacity:.45}button:focus-visible,select:focus-visible{outline:3px solid var(--cyan);outline-offset:2px}.status{margin-left:auto;color:var(--muted);display:flex;align-items:center;gap:8px}.dot{width:8px;height:8px;border-radius:50%;background:#f5b86b}.dot.live{background:var(--lime);box-shadow:0 0 16px var(--lime)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding-bottom:70px}.card{background:linear-gradient(145deg,#15271d,#0e1c14);border:1px solid var(--line);border-radius:18px;padding:22px;min-height:210px;position:relative;overflow:hidden}.card:before{content:"";position:absolute;inset:0 0 auto;height:2px;background:linear-gradient(90deg,var(--lime),var(--cyan),transparent)}.card h2{font-size:22px;margin:6px 0 12px}.meta{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--cyan)}.copy{color:#c2d0c6}.empty{grid-column:1/-1;text-align:center;padding:64px 20px;color:var(--muted)}.provenance{font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:14px;margin-top:18px;overflow-wrap:anywhere}.footer{border-top:1px solid var(--line);padding:24px 0 38px;color:var(--muted);font-size:13px;display:flex;justify-content:space-between;gap:20px}.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    @media(max-width:760px){.hero{grid-template-columns:1fr;padding-top:44px}.metric{border-left:0;padding-left:0}.grid{grid-template-columns:1fr}.status{width:100%;margin-left:0}.footer{display:block}.footer span{display:block}.footer span+span{margin-top:8px}}
    @media(max-width:520px){.top{align-items:flex-start;gap:14px}.brand{padding-top:7px}.pill{max-width:190px;text-align:right}.controls select{width:100%}.controls button{flex:1}.status{padding-top:4px}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
  </style>
</head>
<body>
  <header class="shell top"><div class="brand">MATCH<span style="color:var(--lime)">PULSE</span></div><div class="pill">No odds · No wagers · Verified provenance</div></header>
  <main class="shell">
    <section class="hero"><div><div class="eyebrow">Fan understanding layer</div><h1>Feel the match.<br>Understand the moment.</h1><p>Verified TxLINE events become bilingual moment cards and accessible spoken explanations—without betting advice, profit forecasts, or trading links.</p></div><div class="metric"><b id="eventCount">0</b><span>verified events in this replay</span></div></section>
    <section class="controls" aria-label="Replay controls">
      <label class="sr" for="fixture">Fixture</label><select id="fixture"><option value="">Latest captured fixture</option></select>
      <button class="primary" id="load">Load replay</button><button id="play" disabled>▶ Play</button><button id="speak" disabled>🔊 Read latest</button>
      <div class="status" aria-live="polite"><span class="dot" id="statusDot"></span><span id="status">Checking source…</span></div>
    </section>
    <section class="grid" id="cards" aria-live="polite"><div class="card empty">Loading verified replay data…</div></section>
  </main>
  <footer class="shell footer"><span>Built for TxODDS Consumer & Fan Experiences.</span><span>Every card exposes source and capture time.</span></footer>
  <script>
    const state={events:[],cursor:0,timer:null};
    const cards=document.querySelector('#cards'), fixture=document.querySelector('#fixture');
    const esc=(value)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    function syncReplayControls(){const hasEvents=state.events.length>0;document.querySelector('#play').disabled=!hasEvents;document.querySelector('#speak').disabled=!hasEvents}
    function render(events){
      document.querySelector('#eventCount').textContent=events.length;
      syncReplayControls();
      if(!events.length){cards.innerHTML='<div class="card empty"><strong>No captured TxLINE replay yet.</strong><br>Live credentials require a human-approved on-chain subscription. EarnSignal will never sign it automatically.</div>';return}
      cards.innerHTML=events.map((event,index)=>{
        const payload=event.payload||{}; const action=payload.action||event.eventType||'Update';
        return '<article class="card" tabindex="0"><div class="meta">#'+esc(index+1)+' · '+esc(action)+'</div><h2>'+esc(payload.gameState||'Match event')+'</h2><p class="copy">'+esc('A verified event was recorded for fixture '+event.fixtureId+'. Use Explain for a bilingual fan summary.')+'</p><button class="explain" data-index="'+index+'">Explain moment</button><div class="provenance">Captured '+esc(event.capturedAt)+' · <a href="'+esc(event.sourceUrl)+'" rel="noreferrer">TxLINE source endpoint</a></div></article>';
      }).join('');
      document.querySelectorAll('.explain').forEach(button=>button.addEventListener('click',()=>explain(Number(button.dataset.index),button)));
    }
    async function explain(index,button){button.disabled=true;button.textContent='Explaining…';try{const response=await fetch('/v1/matchpulse/brief',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:state.events[index]})});const data=await response.json();const copy=button.parentElement.querySelector('.copy');copy.textContent=(navigator.language.startsWith('zh')?data.zh:data.en);copy.dataset.spoken=copy.textContent;button.textContent=data.usedAi?'AI explained':'Safe fallback';}catch{button.textContent='Try again';button.disabled=false}}
    async function load(){clearInterval(state.timer);const suffix=fixture.value?'?fixtureId='+encodeURIComponent(fixture.value):'';const response=await fetch('/v1/matchpulse/replay'+suffix);const data=await response.json();state.events=data.events||[];state.cursor=0;render(state.events)}
    function play(){if(state.timer){clearInterval(state.timer);state.timer=null;document.querySelector('#play').textContent='▶ Play';return}if(!state.events.length)return;document.querySelector('#play').textContent='Ⅱ Pause';state.timer=setInterval(()=>{const card=cards.children[state.cursor%state.events.length];card?.scrollIntoView({behavior:'smooth',block:'center'});card?.focus();state.cursor++},2200)}
    function speak(){const latest=[...document.querySelectorAll('.copy')].at(-1);if(!latest||!('speechSynthesis'in window))return;speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(latest.dataset.spoken||latest.textContent))}
    async function boot(){try{const response=await fetch('/v1/matchpulse/fixtures');const data=await response.json();document.querySelector('#status').textContent=data.live?'TxLINE live feed ready':'Replay mode · live feed awaits human activation';document.querySelector('#statusDot').classList.toggle('live',data.live);(data.fixtures||[]).forEach(item=>{const option=document.createElement('option');option.value=item.fixtureId;option.textContent=item.home+' vs '+item.away+' · '+item.competition;fixture.append(option)});await load()}catch{document.querySelector('#status').textContent='Source unavailable';render([])}}
    document.querySelector('#load').addEventListener('click',load);document.querySelector('#play').addEventListener('click',play);document.querySelector('#speak').addEventListener('click',speak);boot();
  </script>
</body></html>`;
