
/* =========================================================
   TOUCHLINE — FPL projection model
   Data: FPL public API (Opta-derived xG / xA / xGC / CBIT).
   ========================================================= */
let DATA = null;
const POSN = {1:'GK',2:'DEF',3:'MID',4:'FWD'};
const POSFULL = {1:'Goalkeepers',2:'Defenders',3:'Midfielders',4:'Forwards'};
const SQUAD_N = {1:2,2:5,3:5,4:3};
const GOAL_PTS = {1:10,2:6,3:5,4:4};
const CS_PTS   = {1:4,2:4,3:1,4:0};
const DC_THR   = {1:999,2:10,3:12,4:12};
const CONC_MULT = {2:0.80,3:1.00,4:1.20,5:1.40};   // opponent strength -> goals conceded
const ATT_MULT  = {2:1.18,3:1.00,4:0.88,5:0.78};   // opponent strength -> attacking output
const KIT = {
 1:['#EF0107','#FFFFFF'],2:['#670E36','#95BFE5'],3:['#DA291C','#111111'],4:['#E30613','#FFFFFF'],
 5:['#0057B8','#FFFFFF'],6:['#034694','#FFFFFF'],7:['#78D0F3','#FFFFFF'],8:['#1B458F','#C4122E'],
 9:['#003399','#FFFFFF'],10:['#F5F5F5','#111111'],11:['#F5A12D','#111111'],12:['#3A64A3','#FFFFFF'],
 13:['#F5F5F5','#1D428A'],14:['#C8102E','#00B2A9'],15:['#6CABDD','#FFFFFF'],16:['#DA291C','#FBE122'],
 17:['#241F20','#FFFFFF'],18:['#DD0000','#FFFFFF'],19:['#F5F5F5','#132257'],20:['#EB172B','#FFFFFF']};

let state = {
  tab:'players', horizon:6, formW:0.30, minMins:0,
  squad:[], xi:[], cap:null, vice:null, chip:'none', chipGw:null,
  sortKey:'ep', sortDir:-1, q:'', fPos:0, fTeam:0, fMax:99, fAvail:'playing',
  fdrN:7, rotSize:2, fixMode:'table', rotShow:25, depth:26, passes:14, kitMode:'kit', pitchGw:null, view:'pitch', autoBasis:'current', manual:false
};

const T = {}, P = {}, GWS = [];

/* ---------- fixture helpers ---------- */
function fixturesFor(teamId, gw){
  const out=[];
  for(const f of DATA.fixtures){
    if(f.gw!==gw) continue;
    if(f.h===teamId) out.push({opp:f.a,home:true});
    else if(f.a===teamId) out.push({opp:f.h,home:false});
  }
  return out;
}
// FDR = opponent's strength rating at the venue the opponent is playing
function fdrOf(fx){ const o=T[fx.opp]; return fx.home ? o.sa : o.sh; }
function avgFdr(teamId,n){
  let s=0,c=0;
  for(let i=0;i<n;i++){
    const gw=GWS[i]; if(gw===undefined) break;
    for(const fx of fixturesFor(teamId,gw)){ s+=fdrOf(fx); c++; }
  }
  return c? s/c : null;
}

/* ---------- maths ---------- */
function poissonAtLeast(k, lam){
  if(lam<=0) return 0;
  let p=Math.exp(-lam), cum=p;
  for(let i=1;i<k;i++){ p*=lam/i; cum+=p; if(cum>0.999999) break; }
  return Math.max(0, 1-cum);
}

/* ---------- projection engine ---------- */
function projectPlayer(p, nWeeks){
  const team = T[p.t];
  const gwPlayed = DATA.gwPlayed || 4;
  let pStart = Math.min(p.st/gwPlayed,1) * (p.st>0 ? Math.min(p.mn/(p.st*90),1) : 0);
  // FPL's own availability flag: 'a' fit, 'd' doubt, 'i' injured, 's' suspended, 'u' gone
  if(p.s && p.s!=='a') pStart *= (p.ch!=null ? p.ch/100 : (p.s==='u' ? 0 : 0.25));
  const pDef = poissonAtLeast(DC_THR[p.p], Math.max(p.dc,0.01));

  // form multiplier: recent points per game vs season points per game
  let formMult = 1;
  if(p.tp>0){
    const seasonPg = p.tp/gwPlayed;
    const ratio = seasonPg>0 ? p.f/seasonPg : 1;
    formMult = 1 + state.formW*(ratio-1);
    formMult = Math.min(1.6, Math.max(0.55, formMult));
  }

  const perGw=[]; let total=0, csSum=0, nFix=0;
  for(let i=0;i<nWeeks;i++){
    const gw=GWS[i];
    if(gw===undefined){ perGw.push({gw:null,ep:0,fdr:null}); continue; }
    const fxs = fixturesFor(p.t,gw);
    if(!fxs.length){ perGw.push({gw,ep:0,fdr:0,blank:true}); continue; }
    let ep=0, fdrShown=null;
    for(const fx of fxs){
      const fdr = fdrOf(fx); fdrShown = fdrShown===null?fdr:Math.min(fdrShown,fdr);
      const cm = CONC_MULT[fdr] ?? 1, am = ATT_MULT[fdr] ?? 1;
      const xgcAdj = team.xgc * cm;
      const pCS = Math.exp(-xgcAdj);
      csSum += pCS; nFix++;

      let e = 2;                                  // appearance
      e += CS_PTS[p.p]*pCS;                       // clean sheet
      e += 2*pDef;                                // defensive contribution
      e += p.xg*GOAL_PTS[p.p]*am;                 // goals
      e += p.xa*3*am;                             // assists
      e += p.bo*0.9;                              // bonus
      e -= p.yc;                                  // cards
      if(p.p<=2) e -= 0.5*xgcAdj;                 // goals conceded
      if(p.p===1) e += p.sv/3;                    // saves
      ep += e;
    }
    ep *= pStart*formMult;
    perGw.push({gw,ep,fdr:fdrShown});
    total += ep;
  }
  return {ep:total, perGw, cs: nFix? csSum/nFix : 0, dcp:pDef, fdr:avgFdr(p.t,nWeeks), pStart, formMult};
}

let PROJ = {};
function recompute(){
  PROJ={};
  for(const p of DATA.players) PROJ[p.i]=projectPlayer(p, state.horizon);
}

/* ---------- squad logic ---------- */
function inSquad(id){ return state.squad.includes(id); }
function squadCost(){ return state.squad.reduce((s,id)=>s+P[id].cost,0); }
function countPos(pos){ return state.squad.filter(id=>P[id].p===pos).length; }
function countTeam(t){ return state.squad.filter(id=>P[id].t===t).length; }

function canAdd(p){
  if(state.squad.length>=15) return 'Squad is full at 15.';
  if(countPos(p.p)>=SQUAD_N[p.p]) return `You already have ${SQUAD_N[p.p]} ${POSFULL[p.p].toLowerCase()}.`;
  if(countTeam(p.t)>=3) return `Three ${T[p.t].n} players is the limit.`;
  if(squadCost()+p.cost>100.0) return 'That takes you over £100.0m.';
  return null;
}
function toggle(id){
  const p=P[id];
  if(inSquad(id)){
    state.squad=state.squad.filter(x=>x!==id);
    state.xi=state.xi.filter(x=>x!==id);
    if(state.cap===id) state.cap=null;
    if(state.vice===id) state.vice=null;
  } else {
    const err=canAdd(p);
    if(err){ toast(err); return; }
    state.squad.push(id);
  }
  autoXIifNeeded(); render();
}
function autoXIifNeeded(){ if(state.squad.length===15 && state.xi.length!==11) bestXI(); }

// A player's projection, either for one gameweek or across the whole horizon.
function epOf(id, gw){
  const pr=PROJ[id];
  if(!pr) return 0;
  if(gw==null) return pr.ep;
  const w=pr.perGw.find(x=>x.gw===gw);
  return w? w.ep : 0;
}

// Highest-scoring legal eleven. Pass a gameweek to pick for that week alone;
// pass nothing to pick for the whole horizon.
// It is not simply the top 11: FPL needs 1 keeper, 3-5 defenders,
// 2-5 midfielders and 1-3 forwards, so every legal shape is tried and the
// best-scoring one wins. Where the top 11 does form a legal shape, that is
// what comes out.
function bestXI(gw){
  const byPos={1:[],2:[],3:[],4:[]};
  // skip anything the current data doesn't know about, rather than throwing
  state.squad.forEach(id=>{ if(P[id]&&PROJ[id]) byPos[P[id].p].push(id); });
  for(const k in byPos) byPos[k].sort((a,b)=>epOf(b,gw)-epOf(a,gw));
  if(!byPos[1].length) return null;
  let best=null;
  for(let d=3;d<=5;d++) for(let m=2;m<=5;m++){
    const f=11-1-d-m;
    if(f<1||f>3) continue;
    if(byPos[2].length<d||byPos[3].length<m||byPos[4].length<f) continue;
    const pick=[byPos[1][0],...byPos[2].slice(0,d),...byPos[3].slice(0,m),...byPos[4].slice(0,f)];
    const tot=pick.reduce((s,id)=>s+epOf(id,gw),0);
    if(!best||tot>best.tot) best={tot,pick};
  }
  if(!best) return null;
  const before=state.xi.slice();
  const inNow=best.pick.filter(id=>!before.includes(id));
  const outNow=before.filter(id=>!best.pick.includes(id));
  state.xi=best.pick;
  // captain by the gameweek on screen, or by the next gameweek when
  // picking across a horizon — never by the horizon total
  const capGw = gw!=null ? gw : GWS[0];
  const ranked=[...best.pick].sort((a,b)=>epOf(b,capGw)-epOf(a,capGw));
  const capBefore=state.cap;
  state.cap=ranked[0]; state.vice=ranked[1];
  return {inNow, outNow, gw, hadXI:before.length>0, capChanged:capBefore!==state.cap, capBefore};
}

// the button: always says what it did, even when the answer is "nothing to change"
function pickBestXI(gw){
  if(state.squad.length<11){
    toast(`Add at least 11 players first — you have ${state.squad.length}.`);
    return;
  }
  const r=bestXI(gw);
  if(!r){
    toast('Need a goalkeeper and enough outfielders for a legal formation.');
    return;
  }
  render();
  const scope = gw!=null ? `GW${gw}` : `the next ${state.horizon} week${state.horizon>1?'s':''}`;
  if(!r.hadXI){ toast(`Best XI picked for ${scope}.`); return; }
  if(!r.inNow.length){
    const cap=state.cap?P[state.cap].n:'';
    toast(r.capChanged
      ? `Already the best XI for ${scope}. Armband moved to ${cap}.`
      : `Already the best XI for ${scope} — nothing to change.`);
    return;
  }
  const ins=r.inNow.map(id=>P[id].n).join(', ');
  const outs=r.outNow.map(id=>P[id].n).join(', ');
  toast(`For ${scope}: ${ins} in${outs?` for ${outs}`:''}.`);
}

// The armband is picked fresh every week, so it is scored that way.
// Doubling one player's whole-horizon total would assume you captain the
// same man for six straight weeks, which nobody does.
function bestCapForGw(ids, gw){
  let best=null, bv=-1;
  for(const id of ids){
    const v=epOf(id,gw);
    if(v>bv){ bv=v; best=id; }
  }
  return best;
}

// Next gameweek uses the armband you've actually set, because that is the
// decision in front of you. Later weeks assume you'll captain whoever the
// model rates highest that week.
function captainBonus(ids, capId){
  let bonus=0;
  for(let i=0;i<state.horizon;i++){
    const gw=GWS[i];
    if(gw===undefined) break;
    const pick = (i===0 && capId && ids.includes(capId)) ? capId : bestCapForGw(ids,gw);
    if(pick!=null) bonus += epOf(pick,gw);
  }
  return bonus;
}

function captainByWeek(ids, capId){
  const out=[];
  for(let i=0;i<state.horizon;i++){
    const gw=GWS[i];
    if(gw===undefined) break;
    const pick = (i===0 && capId && ids.includes(capId)) ? capId : bestCapForGw(ids,gw);
    if(pick!=null) out.push({gw, id:pick, ep:epOf(pick,gw)});
  }
  return out;
}

/* ---------- chips ----------
   Each chip lasts a single gameweek except the wildcard, which changes the
   squad permanently. So chip effects are applied to one week's score, never
   spread across the horizon.
     Bench Boost    the four subs score that week too
     Triple Captain the armband pays 3x instead of 2x
     Free Hit       field any legal XI for that week, squad reverts after
     Wildcard       rebuild the 15 for good, no reversion                */
const CHIP_NAME={none:'No chip',bboost:'Bench Boost',tc:'Triple Captain',fh:'Free Hit',wc:'Wildcard'};
function chipGw(){ return state.chipGw ?? (state.pitchGw || GWS[0]); }
function chipOn(kind, gw){ return state.chip===kind && gw===chipGw(); }

// which player wears the armband in a given week
function capUsedFor(gw){
  if(!state.xi.length) return null;
  if(gw===GWS[0] && state.cap && state.xi.includes(state.cap)) return state.cap;
  return bestCapForGw(state.xi, gw);
}

function benchIds(){ return state.squad.filter(id=>!state.xi.includes(id)); }

// one gameweek's projected score for the team as set, chips included
function gwPoints(gw){
  if(!state.xi.length) return 0;
  let t=state.xi.reduce((s,id)=>s+epOf(id,gw),0);
  const cap=capUsedFor(gw);
  if(cap) t += epOf(cap,gw) * (chipOn('tc',gw) ? 2 : 1);   // extra multiples on top of the base
  if(chipOn('bboost',gw)) t += benchIds().reduce((s,id)=>s+epOf(id,gw),0);
  if(chipOn('fh',gw)){
    const fh=freeHitBest(gw);
    if(fh) t = fh.score;                                    // a different XI entirely
  }
  return t;
}

function xiPoints(){
  let t=0;
  for(let i=0;i<state.horizon;i++){
    const gw=GWS[i];
    if(gw===undefined) break;
    t += gwPoints(gw);
  }
  return t;
}

// Free Hit: the best legal squad for one week, drawn from the whole pool
// at the money you have, since it reverts afterwards.
let FH_CACHE={};
function freeHitBest(gw){
  const budget=100.0;
  const key=gw+'|'+state.minMins+'|'+state.formW+'|'+state.horizon;
  if(FH_CACHE[key]) return FH_CACHE[key];
  const c=ceilingSquad(budget, gw);
  if(!c) return null;
  const prevXi=state.xi, prevSquad=state.squad;
  state.squad=c.ids; state.xi=[];
  const r=bestXI(gw);
  const xi=state.xi.slice(), cap=state.cap;
  const score=xi.reduce((s,id)=>s+epOf(id,gw),0)+(cap?epOf(cap,gw):0);
  state.squad=prevSquad; state.xi=prevXi;
  FH_CACHE[key]={ids:c.ids, xi, cap, score};
  return FH_CACHE[key];
}

/* ---------- optimiser: greedy seed + pairwise improvement ---------- */
function buildBest(){
  const pool=qualPool();
  if(pool.length<15){ toast('Not enough qualifying players — lower the minutes filter.'); return; }
  // seed: value-greedy, then upgrade while budget allows
  const need={1:2,2:5,3:5,4:3}; const chosen=[]; const teamN={};
  const byVal=[...pool].sort((a,b)=>(b.ep/b.cost)-(a.ep/a.cost));
  for(const c of byVal){
    if(!need[c.pos]) continue;
    if((teamN[c.team]||0)>=3) continue;
    const spend=chosen.reduce((s,x)=>s+x.cost,0);
    const left=Object.values(need).reduce((a,b)=>a+b,0)-1;
    if(spend+c.cost+left*4.0>100.0) continue;
    chosen.push(c); need[c.pos]--; teamN[c.team]=(teamN[c.team]||0)+1;
  }
  if(chosen.length<15){ toast('Could not fill a legal squad — try lowering the minutes filter.'); return; }
  const score=sq=>{
    const byPos={1:[],2:[],3:[],4:[]}; sq.forEach(c=>byPos[c.pos].push(c.ep));
    for(const k in byPos) byPos[k].sort((a,b)=>b-a);
    let best=0;
    for(let d=3;d<=5;d++) for(let m=2;m<=5;m++){
      const f=11-1-d-m; if(f<1||f>3) continue;
      if(byPos[2].length<d||byPos[3].length<m||byPos[4].length<f) continue;
      const t=(byPos[1][0]||0)+byPos[2].slice(0,d).reduce((a,b)=>a+b,0)
             +byPos[3].slice(0,m).reduce((a,b)=>a+b,0)+byPos[4].slice(0,f).reduce((a,b)=>a+b,0);
      best=Math.max(best,t);
    }
    return best + 0.05*sq.reduce((a,b)=>a+b.ep,0);
  };
  let cur=chosen.slice(), curScore=score(cur), improved=true, guard=0;
  while(improved && guard++<state.passes){
    improved=false;
    for(let i=0;i<cur.length;i++){
      const out=cur[i];
      const budget=100.0-(cur.reduce((s,x)=>s+x.cost,0)-out.cost);
      const cands=pool.filter(c=>c.pos===out.pos && c.cost<=budget && !cur.some(x=>x.id===c.id))
        .sort((a,b)=>b.ep-a.ep).slice(0, state.depth);
      for(const c of cands){
        const tn={}; cur.forEach((x,j)=>{ if(j!==i) tn[x.team]=(tn[x.team]||0)+1; });
        if((tn[c.team]||0)>=3) continue;
        const next=cur.slice(); next[i]=c;
        const s=score(next);
        if(s>curScore+1e-9){ cur=next; curScore=s; improved=true; break; }
      }
    }
  }
  state.squad=cur.map(c=>c.id); state.xi=[]; bestXI();
  go('squad'); render();
  toast('Built a 15 from the current model settings.');
}

/* =================== RENDER =================== */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

function fdrCell(v,label){
  if(v===null||v===undefined) return `<span class="fdr f0">–</span>`;
  const c=v<=2?'f2':v===3?'f3':v===4?'f4':'f5';
  return `<span class="fdr ${c}">${v}${label?`<small>${label}</small>`:''}</span>`;
}

// Everything downstream — prices, form, which gameweek is current, even
// which fixtures exist — comes from the data file. Once it is a few days
// old, say so loudly rather than quietly serving last week's season.
function renderStaleBanner(built, ageDays){
  const el=document.getElementById('stale');
  if(!el) return;
  if(!built || ageDays<3){ el.hidden=true; return; }
  el.hidden=false;
  const weeks=Math.floor(ageDays/7);
  el.innerHTML=`<b>This data is ${ageDays} days old</b> (built ${built}).
    Prices, form and injuries have moved since, fixtures stop at GW${GWS[GWS.length-1]},
    and team lookups will offer gameweek ${DATA.gwPlayed} rather than the current one.
    ${weeks>=1?'Refresh before trusting any projection. ':''}
    <button class="btn mini" id="staleHow">How to refresh</button>`;
  const b=document.getElementById('staleHow');
  if(b) b.onclick=()=>{
    const dlg=$('#swapDlg');
    $('#swapTitle').textContent='Keeping the data current';
    $('#swapBody').innerHTML=`
      <p class="note">The app reads one file, <b>data.json</b>. Rebuilding it from the live FPL API updates everything at once.</p>
      <h3>If it's hosted on GitHub Pages</h3>
      <p class="note">Nothing to do. The included action rebuilds the file every hour, provided Settings → Actions → General → Workflow permissions is set to <b>Read and write</b>. Check the Actions tab if it has stopped.</p>
      <h3>On any computer</h3>
      <p class="note">In the app folder: <code>pip install requests</code> then <code>python3 refresh_fpl_data.py data.json</code>. Takes a few seconds.</p>
      <h3>On a server, every hour</h3>
      <p class="note"><code>0 * * * * cd /srv/touchline && python3 refresh_fpl_data.py data.json</code></p>
      <h3>Running from a single downloaded file?</h3>
      <p class="note">Then the data is baked in and can't be refreshed in place — that build is a snapshot by design. Host the folder instead, which also makes team lookups work without copying and pasting.</p>`;
    dlg.showModal();
  };
}

function renderHeader(){
  const built=String(DATA.built||'').slice(0,10);
  const ageDays = built ? Math.floor((Date.now()-Date.parse(built))/86400000) : 0;
  renderStaleBanner(built, ageDays);
  const el=$('#built');
  el.textContent = ageDays>2
    ? `data ${built} — ${ageDays} days old · next GW${GWS[0]}`
    : `data ${built} · next GW${GWS[0]}`;
  el.classList.toggle('warn', ageDays>2);
  const pts=xiPoints();
  $('#xiTotal').textContent = state.squad.length? pts.toFixed(1) : '0.0';
  $('#xiTotal').classList.toggle('dim', state.squad.length===0);
  const wk=state.horizon===1?'week':'weeks';
  $('#xiLabel').textContent = state.chip==='none'
    ? `projected over ${state.horizon} ${wk}, starting XI only, best captain each week`
    : `projected over ${state.horizon} ${wk}, with ${CHIP_NAME[state.chip]} played in GW${chipGw()}`;
  const bank=100.0-squadCost();
  const b=$('#bankLbl'); b.textContent=`£${bank.toFixed(1)}m`; b.classList.toggle('over',bank<0);
  $('#sqLbl').textContent=`${state.squad.length}/15`;
}

function flagFor(p){
  if(!p || p.s==='a') return '';
  const label = p.s==='u' ? 'gone' : p.s==='s' ? 'susp'
    : p.ch!=null ? `${p.ch}%` : p.s==='i' ? 'inj' : 'doubt';
  const cls = (p.s==='u'||p.s==='i'||p.ch===0) ? 'out' : 'doubt';
  return ` <span class="flag ${cls}">${label}</span>`;
}

/* ---------- manual squad builder ----------
   Picking by hand needs two things the auto-build hides: what you still have
   to fill, and what you can actually afford for it once the remaining slots
   are paid for at the cheapest going rate. */
function cheapestFor(pos){
  let min=Infinity;
  for(const p of DATA.players){
    if(p.p!==pos || !playable(p)) continue;
    if(p.cost<min) min=p.cost;
  }
  return min===Infinity? 4.0 : min;
}
// most you can spend on one more player of this position and still fill the rest
function affordableFor(pos){
  const bank=100.0-squadCost();
  let reserve=0;
  for(const q of [1,2,3,4]){
    let need=SQUAD_N[q]-countPos(q);
    if(q===pos) need-=1;                       // the one being bought now
    if(need>0) reserve+=need*cheapestFor(q);
  }
  return Math.max(0, bank-reserve);
}
function renderManualBar(){
  const bar=$('#manualBar');
  bar.hidden=!state.manual;
  if(!state.manual) return;
  $('#slotbar').innerHTML=[1,2,3,4].map(pos=>{
    const have=countPos(pos), need=SQUAD_N[pos];
    const done=have>=need;
    const afford=done? null : affordableFor(pos);
    return `<button class="slot ${done?'done':''}" data-slot="${pos}"
      aria-pressed="${state.fPos===pos}">
      <div class="p">${POSN[pos]}</div>
      <div class="c">${have}/${need}</div>
      <div class="m">${done?'complete':`up to £${afford.toFixed(1)}m`}</div>
    </button>`;
  }).join('');
  const bank=100.0-squadCost();
  const left=15-state.squad.length;
  $('#slotBudget').innerHTML=
    `<b class="${bank<0?'over':''}">£${bank.toFixed(1)}m</b> left for <b>${left}</b> more `
    + (left>0? `· average £${(bank/left).toFixed(1)}m each` : '· squad complete');
}

function renderPlayers(){
  const rows=DATA.players.filter(p=>{
    if(p.mn<state.minMins) return false;
    const st=p.s||'a';
    const doubtful = st==='d' || (p.ch!=null && p.ch>0 && p.ch<100);
    const sidelined = st==='i' || st==='s' || p.ch===0;
    if(state.fAvail==='fit'     && st!=='a') return false;
    if(state.fAvail==='doubt'   && !doubtful) return false;
    if(state.fAvail==='out'     && !sidelined) return false;
    if(state.fAvail==='flagged' && !(doubtful||sidelined)) return false;
    if(state.fAvail!=='all' && st==='u') return false;
    if(state.fPos && p.p!==state.fPos) return false;
    if(state.fTeam && p.t!==state.fTeam) return false;
    if(p.cost>state.fMax) return false;
    if(state.manual && state.manualAfford && p.cost>state.manualAfford && !inSquad(p.i)) return false;
    if(state.q && !p.n.toLowerCase().includes(state.q.toLowerCase())) return false;
    return true;
  }).map(p=>{
    const pr=PROJ[p.i];
    return {p, ep:pr.ep, epg:pr.ep/state.horizon, ppm:pr.ep/p.cost, cs:pr.cs, dcp:pr.dcp, fdr:pr.fdr};
  });
  const k=state.sortKey;
  rows.sort((a,b)=>{
    const va = k==='n'?a.p.n : k==='cost'?a.p.cost : k==='tp'?a.p.tp : k==='f'?a.p.f : k==='sel'?a.p.sel : a[k];
    const vb = k==='n'?b.p.n : k==='cost'?b.p.cost : k==='tp'?b.p.tp : k==='f'?b.p.f : k==='sel'?b.p.sel : b[k];
    if(typeof va==='string') return state.sortDir*va.localeCompare(vb);
    return state.sortDir*((va??0)-(vb??0));
  });
  $('#poolNote').textContent=`Showing all ${rows.length} matching players of ${DATA.players.length} in the game. Projection runs ${state.horizon} week${state.horizon>1?'s':''} from GW${GWS[0]}.`;
  $('#ptable tbody').innerHTML = rows.map(r=>{
    const p=r.p, on=inSquad(p.i);
    const block = (state.manual && !on) ? canAdd(p) : null;
    return `<tr class="${on?'in':''} ${block?'blocked':''}">
      <td class="pick"><button class="add ${on?'on':''}" data-add="${p.i}" aria-label="${on?'Remove':'Add'} ${p.n}">${on?'\u2212':'+'}</button></td>
      <td data-add="${p.i}"><div class="pname">${p.n}${flagFor(p)}</div><div class="psub">${T[p.t].n} · ${POSN[p.p]}${block?` <span class="why-no">${block}</span>`:''}</div></td>
      <td>${p.cost.toFixed(1)}</td>
      <td class="ep">${r.ep.toFixed(1)}</td>
      <td>${r.epg.toFixed(1)}</td>
      <td>${r.ppm.toFixed(1)}</td>
      <td>${p.tp}</td>
      <td>${p.f.toFixed(1)}</td>
      <td>${(r.cs*100).toFixed(0)}</td>
      <td>${p.p===1?'–':(r.dcp*100).toFixed(0)}</td>
      <td>${r.fdr?r.fdr.toFixed(2):'–'}</td>
      <td>${p.sel.toFixed(1)}</td>
    </tr>`;
  }).join('');
  $$('#ptable th').forEach(th=>th.classList.toggle('sorted', th.dataset.k===k));
  renderManualBar();
}

function renderSquad(){
  const el=$('#squadList');
  if(!state.squad.length){
    el.innerHTML=`<div class="note">No players yet. Add them from the Players tab, or hit “Build best 15” to let the model choose.</div>`;
    $('#valid').textContent=''; return;
  }
  const problems=[];
  for(const pos of [1,2,3,4]){
    const c=countPos(pos);
    if(c!==SQUAD_N[pos]) problems.push(`${c}/${SQUAD_N[pos]} ${POSFULL[pos].toLowerCase()}`);
  }
  if(squadCost()>100.0) problems.push(`£${(squadCost()-100).toFixed(1)}m over budget`);
  $('#valid').innerHTML = problems.length
    ? `<span class="warn">Not a legal squad yet: ${problems.join(', ')}.</span>`
    : `Legal squad. Captain doubles; bench scores nothing unless bench boost is on.`;

  const plan=state.xi.length? captainByWeek(state.xi, state.cap) : [];
  let html = plan.length>1
    ? `<div class="note" style="margin:10px 0 0">Armband by week: ${plan.map(x=>`GW${x.gw} <b style="color:var(--chalk)">${P[x.id].n}</b>`).join(' · ')}</div>`
    : '';
  for(const pos of [1,2,3,4]){
    const gwNow=state.pitchGw||GWS[0];
    const ids=state.squad.filter(id=>P[id].p===pos).sort((a,b)=>{
      const sa=state.xi.includes(a)?0:1, sb=state.xi.includes(b)?0:1;
      if(sa!==sb) return sa-sb;                 // starters first, as FPL lists them
      return epOf(b,gwNow)-epOf(a,gwNow);
    });
    if(!ids.length) continue;
    html+=`<div class="poshead"><span>${POSFULL[pos]}</span><em>${ids.length}/${SQUAD_N[pos]} · GW${gwNow} points</em></div>`;
    for(const id of ids){
      const p=P[id], pr=PROJ[id], starting=state.xi.includes(id);
      const capRow=capUsedFor(gwNow);
      const isCapRow = (id===capRow && starting);
      const rowMult = isCapRow ? (chipOn('tc',gwNow) ? 3 : 2) : 1;
      const rowShown = epOf(id,gwNow) * rowMult;
      html+=`<div class="row ${starting?'starting':'benched'}" data-pid="${id}">
        <div class="grow">
          <div class="nm">${p.n}
            ${isCapRow?`<span class="chip">${rowMult===3?'CC':'C'}</span>`:''}
            ${state.vice===id?'<span class="chip v">V</span>':''}</div>
          <div class="meta">${T[p.t].n} · £${p.cost.toFixed(1)}m · ${pr.ep.toFixed(1)} over ${state.horizon}w · FDR ${pr.fdr?pr.fdr.toFixed(2):'–'}</div>
        </div>
        <div class="val${isCapRow?' capped':''}">${rowShown.toFixed(1)}${rowMult>1?`<i>×${rowMult}</i>`:''}</div>
        <button class="mini" data-bench="${id}">${starting?'Bench':'Start'}</button>
        <button class="mini" data-capt="${id}">C</button>
        <button class="mini" data-swap="${id}">Swap</button>
      </div>`;
    }
  }
  el.innerHTML=html;
}

function kitSvg(teamId){
  const [a,b]=KIT[teamId]||['#888','#fff'];
  return `<svg class="kit" viewBox="0 0 60 64" aria-hidden="true">
    <path d="M20 4 L8 10 L4 24 L13 27 L13 60 L47 60 L47 27 L56 24 L52 10 L40 4 L30 11 Z" fill="${a}" stroke="rgba(0,0,0,.35)" stroke-width="1.2"/>
    <path d="M20 4 L30 11 L40 4 L36 3 L30 7 L24 3 Z" fill="${b}"/>
    <rect x="26" y="27" width="8" height="33" fill="${b}" opacity=".55"/>
  </svg>`;
}

/* ---------- club shirts and player photos, straight from FPL ----------
   FPL keys its shirt art on the club's permanent code, not its season id,
   so a transferred player picks up his new club's shirt the moment the data
   refreshes. Several URL shapes have been in use across seasons and not every
   player has a photo, so each image walks a list of candidates and falls back
   to the drawn shirt rather than showing a broken frame. */
function shirtUrls(teamId, isGK){
  const t=T[teamId]; if(!t||!t.code) return [];
  const c=t.code, k=isGK?'_1':'';
  return [
    `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${c}${k}-110.png`,
    `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${c}${k}-66.png`,
    `https://resources.premierleague.com/premierleague/badges/50/t${c}.png`
  ];
}
function faceUrls(p){
  if(!p.c) return [];
  // The 110x140 path is the long-standing one and the only shape I could
  // confirm; the others are newer variants, kept as fallbacks.
  return [
    `https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.c}.png`,
    `https://resources.premierleague.com/premierleague/photos/players/250x250/p${p.c}.png`,
    `https://resources.premierleague.com/premierleague25/photos/players/250x250/${p.c}.png`
  ];
}
// step through the remaining candidates, then give up gracefully
let faceFailures=0;
function imgFallback(el){
  let rest=[];
  try{ rest=JSON.parse(el.dataset.alt||'[]'); }catch(e){}
  if(rest.length){
    el.src=rest.shift();
    el.dataset.alt=JSON.stringify(rest);
    return;
  }
  if(el.classList.contains('face')){
    faceFailures++;
    const note=document.getElementById('faceNote');
    if(note && faceFailures>=3){
      note.hidden=false;
      note.textContent='Photos aren\'t loading — the Premier League image server is unreachable from here. Shirts shown instead.';
    }
  }
  const tid=+el.dataset.team, gk=el.dataset.gk==='1';
  el.outerHTML = el.classList.contains('face')
    ? `<img class="kit" src="${(shirtUrls(tid,gk)[0]||'')}" alt="" loading="lazy" referrerpolicy="no-referrer" data-team="${tid}" data-gk="${gk?1:0}" data-alt="${esc(JSON.stringify(shirtUrls(tid,gk).slice(1)))}" onerror="imgFallback(this)">`
    : kitSvg(tid);
}
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function playerMedia(p){
  const gk = p.p===1;
  if(state.kitMode==='face'){
    const urls=faceUrls(p);
    if(urls.length){
      return `<img class="face" src="${urls[0]}" alt="" loading="lazy" referrerpolicy="no-referrer" data-team="${p.t}" data-gk="${gk?1:0}" data-alt="${esc(JSON.stringify(urls.slice(1)))}" onerror="imgFallback(this)">`;
    }
  }
  const shirts=shirtUrls(p.t,gk);
  if(shirts.length){
    return `<img class="kit" src="${shirts[0]}" alt="" loading="lazy" referrerpolicy="no-referrer" data-team="${p.t}" data-gk="${gk?1:0}" data-alt="${esc(JSON.stringify(shirts.slice(1)))}" onerror="imgFallback(this)">`;
  }
  return kitSvg(p.t);
}
function cardHtml(id, gw, where){
  const p=P[id], pr=PROJ[id];
  const g = gw ?? GWS[0];
  const fxs=fixturesFor(p.t,g);
  const fx = fxs.length? fxs.map(f=>`${T[f.opp].n}${f.home?'(H)':'(A)'}`).join(' ') : 'blank';
  const fdr = fxs.length? fdrOf(fxs[0]) : null;
  const wk = pr.perGw.find(x=>x.gw===g);
  // The armband is worth double, or triple with the chip on. Show what the
  // player actually contributes that week, not his raw score.
  const capNow = capUsedFor(g);
  const isCap = (id===capNow);
  const mult = isCap ? (chipOn('tc',g) ? 3 : 2) : 1;
  const shown = (wk? wk.ep : 0) * mult;
  const benchDead = where==='bench' && !chipOn('bboost',g);
  const media = playerMedia(p);
  return `<div class="pcard" data-pid="${id}" data-where="${where||'xi'}" data-swap="${id}" role="button" tabindex="0">
    ${media}
    <div class="nm">${p.n}${flagFor(p)}${isCap?(mult===3?' (CC)':' (C)'):state.vice===id?' (V)':''}</div>
    <div class="pt${isCap?' capped':''}${benchDead?' dead':''}">${shown.toFixed(1)}${mult>1?`<i>×${mult}</i>`:''}</div>
    <div class="fx">${fx} ${fdr?`<span style="color:${fdr<=2?'#00C07A':fdr===3?'#C9CF3A':fdr===4?'#F08A3C':'#E0434A'}">${fdr}</span>`:''}</div>
  </div>`;
}
function renderPitch(){
  // Pitch and list are two views of the same squad, switched by #viewMode.
  // The gameweek selector and the running total belong to both.
  const listMode = state.view==='list';
  $('#pitchWrap').hidden = listMode;
  $('#squadList').hidden = !listMode;
  $('#kitMode').style.display = listMode ? 'none' : '';
  const sel=$('#pitchGw');
  if(sel.options.length!==state.horizon){
    sel.innerHTML=GWS.slice(0,state.horizon).map((g,i)=>
      `<option value="${g}">Gameweek ${g}${i===0?' (current)':''}</option>`).join('');
  }
  const gw=+sel.value||GWS[0]; state.pitchGw=gw;
  if(state.chip!=='none' && state.chip!=='wc') state.chipGw=gw;
  const cur=GWS[0];
  const opts=$('#autoBasis').options;
  if(opts && opts.length===3){
    opts[0].textContent=`Best XI · GW${cur} (current)`;
    opts[1].textContent=`Best XI · GW${gw} (shown)`;
    opts[2].textContent=`Best XI · next ${state.horizon} week${state.horizon>1?'s':''}`;
  }
  const capId = capUsedFor(gw);
  const gwTotal = gwPoints(gw);
  const chipHere = state.chip!=='none' && gw===chipGw() ? ` · ${CHIP_NAME[state.chip]}` : '';
  const scope = chipOn('bboost',gw) ? 'all 15' : chipOn('fh',gw) ? 'free hit XI' : 'XI only';
  $('#pitchTotal').innerHTML = state.xi.length
    ? `<b>${gwTotal.toFixed(1)}</b><span>GW${gw} · ${scope}${capId&&!chipOn('fh',gw)?` · ${P[capId].n} (C${chipOn('tc',gw)?'C':''})`:''}${chipHere}</span>`
    : `<b>—</b><span>GW${gw}</span>`;
  if(listMode) return;                      // nothing to lay out on a hidden pitch
  // An incomplete squad gets FPL's selection board: every slot laid out by
  // position, empty ones as a + you tap to fill.
  if(state.squad.length<15){ renderSelectionPitch(gw); return; }
  const rows={1:[],2:[],3:[],4:[]};
  state.xi.forEach(id=>rows[P[id].p].push(id));
  for(const k in rows) rows[k].sort((a,b)=>PROJ[b].ep-PROJ[a].ep);
  // FPL orders the bench keeper first, then the outfield subs in the order
  // they'd come on. Best projected sub gets first refusal.
  const bench=state.squad.filter(id=>!state.xi.includes(id)).sort((a,b)=>{
    const ga=P[a].p===1?0:1, gb=P[b].p===1?0:1;
    if(ga!==gb) return ga-gb;
    return epOf(b,gw)-epOf(a,gw);
  });
  $('#pitch').innerHTML =
    [1,2,3,4].map(pos=>`<div class="prow" data-zone="xi">${rows[pos].map(id=>cardHtml(id,gw,'xi')).join('')}</div>`).join('')
    + `<div class="benchbar" data-zone="bench">${bench.map(id=>cardHtml(id,gw,'bench')).join('')}</div>`;
}

// Empty-slot board, the way FPL lays out squad selection.
function renderSelectionPitch(gw){
  const rows=[1,2,3,4].map(pos=>{
    const have=state.squad.filter(id=>P[id].p===pos)
      .sort((a,b)=>epOf(b,gw)-epOf(a,gw));
    const blanks=SQUAD_N[pos]-have.length;
    const cards=have.map(id=>cardHtml(id,gw,'xi')).join('')
      + Array.from({length:Math.max(0,blanks)},()=>slotHtml(pos)).join('');
    return `<div class="prow" data-zone="pick">${cards}</div>`;
  }).join('');
  const bank=100.0-squadCost();
  $('#pitch').innerHTML = rows +
    `<div class="pickfoot">${state.squad.length}/15 selected · £${bank.toFixed(1)}m left</div>`;
  $('#pitchHelp').textContent =
    'Tap a + to fill that slot. Only players you can still afford are offered.';
}
function slotHtml(pos){
  return `<button class="pcard empty" data-pick="${pos}" aria-label="Add a ${POSN[pos]}">
    <span class="plus">+</span>
    <span class="slotlab">${POSN[pos]}</span>
  </button>`;
}

// Position picker, filtered to what the remaining budget actually allows.
function openPicker(pos){
  const dlg=$('#swapDlg');
  const budget=affordableFor(pos);
  const cands=DATA.players
    .filter(c=>c.p===pos && !inSquad(c.i) && playable(c) && c.cost<=budget && countTeam(c.t)<3)
    .map(c=>({c, ep:PROJ[c.i]?PROJ[c.i].ep:0}))
    .sort((a,b)=>b.ep-a.ep);
  $('#swapTitle').textContent=`Add a ${POSFULL[pos].slice(0,-1).toLowerCase()}`;
  $('#swapBody').innerHTML=`
    <div class="note">${countPos(pos)}/${SQUAD_N[pos]} filled · up to £${budget.toFixed(1)}m for this one, keeping the rest fillable.</div>
    ${cands.length? cands.map(x=>`<div class="row">
      <div class="grow"><div class="nm">${x.c.n}${flagFor(x.c)}</div>
        <div class="meta">${T[x.c.t].n} · £${x.c.cost.toFixed(1)}m · ${x.c.tp} banked</div></div>
      <div class="val">${x.ep.toFixed(1)}</div>
      <button class="mini" data-pickin="${x.c.i}">In</button>
    </div>`).join('')
    : `<div class="note warn">Nothing affordable left for this slot. Sell someone first.</div>`}`;
  dlg.showModal();
}

// Explain the active chip and quantify it against playing no chip.
function renderChipPanel(){
  const el=$('#chipPanel');
  if(state.chip==='none'){ el.hidden=true; return; }
  el.hidden=false;
  const gw=chipGw();
  if(!state.squad.length){
    el.innerHTML=`<div class="chipbox"><b>${CHIP_NAME[state.chip]}</b><p>Pick a squad first.</p></div>`;
    return;
  }
  const saveChip=state.chip; state.chip='none';
  const plain=gwPoints(gw);
  state.chip=saveChip;
  const withChip=gwPoints(gw);
  const gain=withChip-plain;

  let body='', action='';
  if(state.chip==='bboost'){
    const b=benchIds();
    body=`Your four subs score in GW${gw} as well. `
      + b.map(id=>`${P[id].n} ${epOf(id,gw).toFixed(1)}`).join(' · ');
  } else if(state.chip==='tc'){
    const c=capUsedFor(gw);
    body=c? `${P[c].n} pays triple rather than double in GW${gw} — ${epOf(c,gw).toFixed(1)} becomes ${(epOf(c,gw)*3).toFixed(1)}.`
          : 'No captain set.';
  } else if(state.chip==='fh'){
    const fh=freeHitBest(gw);
    body=fh? `Any legal XI for GW${gw} at £100.0m, reverting afterwards. Best available: `
             + fh.xi.map(id=>P[id].n).join(', ')
           : 'Could not build a free hit side.';
    if(fh) action=`<button class="btn mini" id="loadFh">Load this side</button>`;
  } else if(state.chip==='wc'){
    body=`A permanent rebuild — no reversion, so it is judged over the whole ${state.horizon}-week horizon rather than one week. Build best 15 on the Players tab does exactly this.`;
    action=`<button class="btn mini" id="loadWc">Rebuild my 15</button>`;
  }
  const delta = state.chip==='wc' ? '' :
    `<div class="chipgain ${gain>=0?'up':'down'}">${gain>=0?'+':''}${gain.toFixed(1)} in GW${gw}</div>`;
  el.innerHTML=`<div class="chipbox">
    <div class="chiphead"><b>${CHIP_NAME[state.chip]}</b>${delta}</div>
    <p>${body}</p>${action}</div>`;
  const fhBtn=document.getElementById('loadFh');
  if(fhBtn) fhBtn.onclick=()=>{
    const fh=freeHitBest(gw);
    if(!fh) return;
    state.squad=fh.ids.slice(); state.xi=fh.xi.slice(); state.cap=fh.cap;
    render(); toast(`Free hit side loaded for GW${gw}.`);
  };
  const wcBtn=document.getElementById('loadWc');
  if(wcBtn) wcBtn.onclick=buildBest;
}

function renderFdr(){
  const n=state.fdrN, gws=GWS.slice(0,n);
  let teams=DATA.teams.map(t=>({t, avg:avgFdr(t.id,n)}));
  if(state.fdrSort==='avg') teams.sort((a,b)=>(a.avg??9)-(b.avg??9));
  else if(state.fdrSort==='hard') teams.sort((a,b)=>(b.avg??0)-(a.avg??0));
  else teams.sort((a,b)=>a.t.n.localeCompare(b.t.n));
  $('#fdrTable thead').innerHTML=`<tr><th>Club</th>${gws.map(g=>`<th>GW${g}</th>`).join('')}<th>Avg</th></tr>`;
  $('#fdrTable tbody').innerHTML=teams.map(({t,avg})=>{
    const cells=gws.map(g=>{
      const fxs=fixturesFor(t.id,g);
      if(!fxs.length) return `<td>${fdrCell(null)}</td>`;
      return `<td>${fxs.map(f=>fdrCell(fdrOf(f),`${T[f.opp].n}${f.home?'':'·a'}`)).join(' ')}</td>`;
    }).join('');
    return `<tr><td class="pname">${t.n}</td>${cells}<td class="ep">${avg?avg.toFixed(2):'–'}</td></tr>`;
  }).join('');
}

function renderRotation(){
  const n=state.fdrN, size=state.rotSize, gws=GWS.slice(0,n);
  const ids=DATA.teams.map(t=>t.id);
  const best=[];
  const combo=[];
  (function rec(start){
    if(combo.length===size){
      let sum=0, per=[];
      for(const g of gws){
        let mn=null, who=null;
        for(const id of combo) for(const fx of fixturesFor(id,g)){
          const d=fdrOf(fx);
          if(mn===null||d<mn){ mn=d; who=id; }
        }
        if(mn===null){ mn=5; who=null; }
        sum+=mn; per.push({gw:g,fdr:mn,team:who});
      }
      best.push({combo:combo.slice(), score:sum/gws.length, per});
      return;
    }
    for(let i=start;i<ids.length;i++){ combo.push(ids[i]); rec(i+1); combo.pop(); }
  })(0);
  best.sort((a,b)=>a.score-b.score);
  ROT_ALL=best;
  $('#rotOut').innerHTML = best.slice(0, state.rotShow).map(b=>`
    <div class="rot">
      <div class="rot-head">
        <div class="rot-teams">${b.combo.map(i=>T[i].n).join(' + ')}</div>
        <div class="rot-score">${b.score.toFixed(2)}</div>
      </div>
      <div class="rot-grid">${b.per.map(x=>`<div class="rot-cell">
        <div class="g">GW${x.gw}</div>${fdrCell(x.fdr, x.team?T[x.team].n:'')}
      </div>`).join('')}</div>
    </div>`).join('');
}

function renderModel(){
  $('#modelDoc').innerHTML=`
  <h3>How a projection is built</h3>
  <p class="note">Every player gets an expected score for each upcoming gameweek, assembled from separate pieces rather than from past points. That matters because past points reward luck — a defence can keep three clean sheets it had no business keeping.</p>
  <div class="scroll"><table><tbody>
    <tr><td class="pname">Appearance</td><td>2 points whenever the model expects a start.</td></tr>
    <tr><td class="pname">Clean sheet</td><td>The club's expected goals conceded per 90, stretched or squeezed by the opponent, then run through a Poisson to get the probability of nil. Worth 4 to keepers and defenders, 1 to midfielders.</td></tr>
    <tr><td class="pname">Defensive contribution</td><td>Tackles, clearances, blocks and interceptions per 90 against the 10-action threshold for defenders and 12 for everyone else, again via Poisson. Worth 2.</td></tr>
    <tr><td class="pname">Goals and assists</td><td>Expected goals and assists per 90, scaled by how tough the opponent is.</td></tr>
    <tr><td class="pname">Bonus, cards, saves, goals conceded</td><td>Rates per 90 from this season, carried forward.</td></tr>
    <tr><td class="pname">Minutes</td><td>Everything is multiplied by how reliably the player starts and finishes matches.</td></tr>
    <tr><td class="pname">Form</td><td>Recent scoring is compared with the season rate and blended in at whatever weight you set. At 0% the model ignores form entirely.</td></tr>
  </tbody></table></div>
  <h3>Fixture difficulty</h3>
  <p class="note">Difficulty is the opponent's own strength rating at the venue they're playing, taken straight from FPL, so it moves when FPL moves it. A 2 cuts expected goals conceded to 0.80 of normal and lifts attacking output to 1.18; a 5 does the reverse.</p>
  <h3>What it doesn't know</h3>
  <p class="note">Injuries and suspensions announced after the last data pull. Manager changes. Rotation before European nights. Penalty-taker changes. Four gameweeks is a small sample, so expected goals per 90 is noisy for anyone with few starts — raise the minutes filter if a name looks wrong.</p>`;
}

function render(){
  recompute();
  renderHeader();
  if(state.tab==='players') renderPlayers();
  if(state.tab==='squad'){ renderPitch(); renderSquad(); renderChipPanel(); }
  if(state.tab==='fdr'){
    const rot = state.fixMode==='rotation';
    $('#fixTable').hidden = rot;
    $('#fixRotation').hidden = !rot;
    if(!rot) renderFdr();
  }
  if(state.tab==='rate') renderRate();
  if(state.tab==='model') renderModel();
  if(state.tab==='look') renderLook();
}
function go(tab){
  state.tab=tab;
  $$('nav button').forEach(b=>b.setAttribute('aria-selected', b.dataset.tab===tab));
  $$('main section').forEach(s=>s.hidden = s.id!=='tab-'+tab);
  render();
}
let toastT;
function toast(msg){
  clearTimeout(toastT);
  let el=$('.toast');
  if(!el){ el=document.createElement('div'); el.className='toast'; document.body.appendChild(el); }
  el.textContent=msg;
  toastT=setTimeout(()=>el.remove(),2600);
}

/* ---------- swap dialog ---------- */
function openSwap(id){
  const p=P[id], dlg=$('#swapDlg');
  $('#swapTitle').textContent=`Replace ${p.n}`;
  const budget=100.0-(squadCost()-p.cost);
  const cands=DATA.players.filter(c=>c.p===p.p && c.i!==id && !inSquad(c.i) && c.cost<=budget && c.mn>=state.minMins)
    .map(c=>({c, ep:PROJ[c.i].ep, d:PROJ[c.i].ep-PROJ[id].ep}))
    .sort((a,b)=>b.ep-a.ep);
  $('#swapBody').innerHTML = `
    <div class="note">Budget available £${budget.toFixed(1)}m. Change shown is to the projected total over ${state.horizon} week${state.horizon>1?'s':''}.</div>
    <div class="row" style="background:var(--turf-3)">
      <div class="grow"><div class="nm">${p.n} — out</div><div class="meta">${T[p.t].n} · £${p.cost.toFixed(1)}m</div></div>
      <div class="val">${PROJ[id].ep.toFixed(1)}</div>
    </div>
    ${cands.map(x=>`<div class="row">
      <div class="grow"><div class="nm">${x.c.n}</div>
        <div class="meta">${T[x.c.t].n} · £${x.c.cost.toFixed(1)}m · ${countTeam(x.c.t)>=3?'<span class="warn">club limit</span>':`FDR ${PROJ[x.c.i].fdr?PROJ[x.c.i].fdr.toFixed(2):'–'}`}</div></div>
      <div class="val">${x.ep.toFixed(1)}</div>
      <div class="val delta ${x.d>=0?'up':'down'}">${x.d>=0?'+':''}${x.d.toFixed(1)}</div>
      <button class="mini" data-do="${id}:${x.c.i}" ${countTeam(x.c.t)>=3?'disabled':''}>In</button>
    </div>`).join('')}`;
  dlg.showModal();
}
function doSwap(outId,inId){
  const wasXI=state.xi.includes(outId), wasCap=state.cap===outId;
  state.squad=state.squad.map(x=>x===outId?inId:x);
  state.xi=state.xi.map(x=>x===outId?inId:x);
  if(wasCap) state.cap=inId;
  if(state.vice===outId) state.vice=inId;
  $('#swapDlg').close();
  render();
  toast(`${P[inId].n} in for ${P[outId].n}${wasXI?'':' (bench)'}.`);
}

/* ---------- live refresh from FPL ---------- */
// A same-origin proxy (see README) is tried first and is the only reliable route.
const PROXIES=[u=>`/api/fpl?url=${encodeURIComponent(u)}`,
               u=>`/.netlify/functions/fpl?url=${encodeURIComponent(u)}`,
               u=>`https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
               u=>`https://corsproxy.io/?url=${encodeURIComponent(u)}`];
async function grab(url){
  for(const mk of PROXIES){
    try{ const r=await fetch(mk(url)); if(r.ok) return await r.json(); }catch(e){}
  }
  try{ const r=await fetch(url); if(r.ok) return await r.json(); }catch(e){}
  return null;
}
async function refresh(){
  const msg=$('#refreshMsg'); msg.textContent='Fetching…'; $('#refresh').disabled=true;
  const boot=await grab('https://fantasy.premierleague.com/api/bootstrap-static/');
  const fix = boot ? await grab('https://fantasy.premierleague.com/api/fixtures/') : null;
  $('#refresh').disabled=false;
  if(!boot||!fix){
    msg.innerHTML='<span class="warn">Couldn\'t reach FPL from the browser — it blocks cross-site requests. The snapshot below is still live. Run the refresh script to rebuild the data file.</span>';
    return;
  }
  try{
    const played=boot.events.filter(e=>e.finished).length || 1;
    const nextGw=(boot.events.find(e=>e.is_next)||boot.events.find(e=>!e.finished)||{id:1}).id;
    const teams=boot.teams.map(t=>({id:t.id,n:t.short_name,name:t.name,
      sh:t.strength_overall_home,sa:t.strength_overall_away,xgc:1.2,xg:1.2}));
    const per=el=>Math.max(el.minutes,1)/90;
    // team xGC from high-minute defenders/keepers
    const acc={};
    boot.elements.forEach(el=>{
      if(el.minutes<300||el.element_type>2) return;
      (acc[el.team]=acc[el.team]||[]).push(+el.expected_goals_conceded/per(el));
    });
    const vals=Object.values(acc).map(a=>a.reduce((x,y)=>x+y,0)/a.length);
    const lg=vals.length? vals.reduce((a,b)=>a+b,0)/vals.length : 1.3;
    teams.forEach(t=>{ const a=acc[t.id]; const v=a? a.reduce((x,y)=>x+y,0)/a.length : lg;
      t.xgc=+(0.70*v+0.30*lg).toFixed(3); });
    const players=boot.elements.filter(e=>e.status==='a'&&e.minutes>=45).map(e=>({
      i:e.id,c:e.code,n:e.web_name,t:e.team,p:e.element_type,cost:e.now_cost/10,
      tp:e.total_points,mn:e.minutes,st:e.starts,
      xg:+(+e.expected_goals/per(e)).toFixed(3), xa:+(+e.expected_assists/per(e)).toFixed(3),
      dc:+(e.defensive_contribution/per(e)).toFixed(2), sv:+(e.saves/per(e)).toFixed(2),
      bo:+(e.bonus/per(e)).toFixed(3), yc:+(e.yellow_cards/per(e)).toFixed(3),
      f:+e.form, sel:+e.selected_by_percent, pen:e.penalties_order||0}));
    const fixtures=fix.filter(f=>!f.finished&&f.event).map(f=>({gw:f.event,h:f.team_h,a:f.team_a}));
    DATA.teams=teams; DATA.players=players; DATA.fixtures=fixtures;
    DATA.gwPlayed=played; DATA.built=new Date().toISOString().slice(0,10);
    for(const k in T) delete T[k]; teams.forEach(t=>T[t.id]=t);
    for(const k in P) delete P[k]; players.forEach(p=>P[p.i]=p);
    GWS.length=0; [...new Set(fixtures.map(f=>f.gw))].sort((a,b)=>a-b).forEach(g=>GWS.push(g));
    state.squad=state.squad.filter(id=>P[id]); state.xi=state.xi.filter(id=>P[id]);
    buildTeamFilter(); render();
    msg.textContent=`Updated. ${players.length} players, ${played} gameweeks played, next is GW${nextGw}.`;
  }catch(e){ msg.innerHTML='<span class="warn">FPL answered but the data didn\'t parse. Snapshot kept.</span>'; }
}

/* =========================================================
   RATE MY TEAM
   Pull a squad by FPL entry ID, then score it against what the
   model says was buildable at the same money.
   ========================================================= */

// best XI projection for an arbitrary set of 15, captain doubled
function xiScoreOf(ids, gw){
  const byPos={1:[],2:[],3:[],4:[]};
  ids.forEach(id=>{ if(P[id]&&PROJ[id]) byPos[P[id].p].push(id); });
  for(const k in byPos) byPos[k].sort((a,b)=>epOf(b,gw)-epOf(a,gw));
  if(!byPos[1].length) return {score:0,xi:[],cap:null};
  let best=null;
  for(let d=3;d<=5;d++) for(let m=2;m<=5;m++){
    const f=11-1-d-m; if(f<1||f>3) continue;
    if(byPos[2].length<d||byPos[3].length<m||byPos[4].length<f) continue;
    const pick=[byPos[1][0],...byPos[2].slice(0,d),...byPos[3].slice(0,m),...byPos[4].slice(0,f)];
    const tot=pick.reduce((s,id)=>s+epOf(id,gw),0);
    if(!best||tot>best.tot) best={tot,pick};
  }
  if(!best) return {score:0,xi:[],cap:null};
  if(gw!=null){
    const c=bestCapForGw(best.pick, gw);
    return {score:best.tot+(c?epOf(c,gw):0), xi:best.pick, cap:c};
  }
  const cap=bestCapForGw(best.pick, GWS[0]);
  return {score:best.tot+captainBonus(best.pick,cap), xi:best.pick, cap};
}

function playable(p){ return p.s!=='u' && p.s!=='i' && !(p.ch===0); }
function qualPool(){
  return DATA.players.filter(p=>p.mn>=state.minMins && PROJ[p.i] && playable(p))
    .map(p=>({id:p.i,pos:p.p,team:p.t,cost:p.cost,ep:PROJ[p.i].ep}));
}

// greedy legal squad under a budget, ranked by keyFn
function greedySquad(pool, budget, keyFn){
  const need={1:2,2:5,3:5,4:3}, teamN={}, out=[];
  const ranked=[...pool].sort((a,b)=>keyFn(b)-keyFn(a));
  for(const c of ranked){
    if(!need[c.pos]) continue;
    if((teamN[c.team]||0)>=3) continue;
    const spend=out.reduce((s,x)=>s+x.cost,0);
    const left=Object.values(need).reduce((a,b)=>a+b,0)-1;
    if(spend+c.cost+left*4.0>budget) continue;
    out.push(c); need[c.pos]--; teamN[c.team]=(teamN[c.team]||0)+1;
  }
  return out.length===15? out.map(c=>c.id) : null;
}

// the model's ceiling at this budget: greedy seed then pairwise upgrades
function ceilingSquad(budget, gw){
  const pool=qualPool();
  let cur=greedySquad(pool,budget,c=>c.ep/c.cost);
  if(!cur) return null;
  let curScore=xiScoreOf(cur, gw).score, guard=0, improved=true;
  while(improved && guard++<state.passes){
    improved=false;
    for(let i=0;i<cur.length;i++){
      const outId=cur[i], outP=P[outId];
      const rest=cur.filter(x=>x!==outId);
      const room=budget-rest.reduce((s,id)=>s+P[id].cost,0);
      const cands=pool.filter(c=>c.pos===outP.p && c.cost<=room && !cur.includes(c.id))
        .sort((a,b)=>(gw!=null? epOf(b.id,gw)-epOf(a.id,gw) : b.ep-a.ep)).slice(0, state.depth);
      for(const c of cands){
        const tn={}; rest.forEach(id=>{tn[P[id].t]=(tn[P[id].t]||0)+1;});
        if((tn[c.team]||0)>=3) continue;
        const next=[...rest,c.id];
        const s=xiScoreOf(next, gw).score;
        if(s>curScore+1e-9){ cur=next; curScore=s; improved=true; break; }
      }
    }
  }
  return {ids:cur, score:curScore};
}

// replacement level: the cheapest legal squad the model will allow.
// Most of an XI projection is appearance points every squad earns, so
// rating against zero would put everyone in the nineties. This is the
// anchor that makes the scale mean something.
function floorSquad(budget){
  const pool=qualPool();
  const ids=greedySquad(pool, budget, c=>-c.cost);
  return ids? xiScoreOf(ids).score : 0;
}

// spread of plausible squads at the same budget, for a percentile
function sampleScores(budget, n){
  const pool=qualPool(), out=[];
  for(let i=0;i<n;i++){
    const noise=new Map();
    pool.forEach(c=>noise.set(c.id, 0.30+Math.random()*1.5));
    // half the samples chase value, half chase raw points — different strategies
    const valueMode=i%2===0;
    const ids=greedySquad(pool,budget,c=>valueMode
      ? (c.ep*noise.get(c.id))/c.cost
      : c.ep*noise.get(c.id));
    if(ids) out.push(xiScoreOf(ids).score);
  }
  return out.sort((a,b)=>a-b);
}

let RATED=null;

function rateSquad(ids, capId, bank){
  const known=ids.filter(id=>P[id]&&PROJ[id]);
  const missing=ids.length-known.length;
  const value=known.reduce((s,id)=>s+P[id].cost,0);
  const budget=Math.min(100+ (bank||0), value+(bank||0));
  const mine=xiScoreOf(known);
  // honour their actual captain if it's in the XI
  let myScore=mine.score, capUsed=mine.cap;
  if(capId && mine.xi.includes(capId)){
    myScore = mine.xi.reduce((s,id)=>s+PROJ[id].ep,0) + captainBonus(mine.xi, capId);
    capUsed = capId;
  }
  const ceil=ceilingSquad(budget);
  const floor=floorSquad(budget);
  const span = ceil? ceil.score-floor : 0;
  const rating = span>0 ? Math.max(0,Math.min(100, 100*(myScore-floor)/span)) : 0;
  const dist=sampleScores(budget, 220);
  const beaten = dist.length? dist.filter(s=>s<myScore).length/dist.length*100 : 0;

  // component scores
  const xi=mine.xi;
  const fdrs=xi.map(id=>PROJ[id].fdr).filter(x=>x!=null);
  const avgFdrXI = fdrs.length? fdrs.reduce((a,b)=>a+b,0)/fdrs.length : 3;
  const fixtureScore = Math.max(0,Math.min(100, 100*(4.6-avgFdrXI)/(4.6-2.2)));
  const minsScore = 100*xi.reduce((s,id)=>s+PROJ[id].pStart,0)/Math.max(xi.length,1);
  const capGw = GWS[0];
  const bestCapId = xi.length? bestCapForGw(xi, capGw) : null;
  const bestCapEp = bestCapId? epOf(bestCapId, capGw) : 1;
  const capScore = capUsed? 100*epOf(capUsed, capGw)/(bestCapEp||1) : 0;
  const benchIds = known.filter(id=>!xi.includes(id));
  const benchEp = benchIds.reduce((s,id)=>s+PROJ[id].ep,0);
  const benchScore = Math.max(0,Math.min(100, 100*(benchEp/Math.max(benchIds.length,1))/ (myScore/12) ));

  // weakest links: biggest available upgrade at the same price or less
  const pool=qualPool();
  const weak=known.map(id=>{
    const p=P[id], room=p.cost+ (bank||0);
    const alts=pool.filter(c=>c.pos===p.p && c.cost<=room && !known.includes(c.id))
      .sort((a,b)=>b.ep-a.ep);
    const top=alts[0];
    return top? {id, gain:top.ep-PROJ[id].ep, alt:top.id} : {id,gain:0,alt:null};
  }).sort((a,b)=>b.gain-a.gain).slice(0,12);

  return {ids:known, missing, value, bank:bank||0, budget, myScore, xi, capUsed,
          rating, beaten, ceil, floor, fixtureScore, minsScore, capScore, benchScore,
          avgFdrXI, weak, bestCapId};
}

function verdictFor(r){
  if(r>=94) return ['Elite shape','Very little left on the table at this budget.'];
  if(r>=88) return ['Strong','Competitive squad — the gap is one or two picks, not a rebuild.'];
  if(r>=80) return ['Solid','Sound core with real upgrades available. Transfers, not a wildcard.'];
  if(r>=70) return ['Middling','Several picks are costing you. Worth planning a route out over a few weeks.'];
  return ['Needs work','Enough drag across the squad that a wildcard is worth considering.'];
}

function barHtml(label, pct, why){
  const cls = pct>=75?'good':pct>=50?'':pct>=35?'mid':'poor';
  return `<div class="bar">
    <div class="bar-top"><span>${label}</span><b>${Math.round(pct)}%</b></div>
    <div class="track"><div class="fill ${cls}" style="width:${Math.max(2,Math.min(100,pct))}%"></div></div>
    <div class="why">${why}</div>
  </div>`;
}

function renderRate(){
  renderBuiltHint();
  const sel=$('#rateGw');
  if(sel && !sel.options.length){
    const last=Math.max(1, DATA.gwPlayed||1);
    let html='<option value="0">Latest available</option>';
    for(let g=last; g>=1; g--) html+=`<option value="${g}">Gameweek ${g}</option>`;
    sel.innerHTML=html;
  }
  const out=$('#rateOut');
  if(!RATED){ out.innerHTML=''; return; }
  const r=RATED, [title,line]=verdictFor(r.rating);
  const wk=state.horizon===1?'week':'weeks';
  out.innerHTML=`
  <div class="gauge">
    <div class="score">${r.rating.toFixed(0)}<sup>%</sup></div>
    <div>
      <div class="verdict">${title}</div>
      <div class="sub">${line}</div>
      <div class="sub" style="margin-top:6px">Your XI projects <b style="color:var(--chalk)">${r.myScore.toFixed(1)}</b> over ${state.horizon} ${wk} with the captain doubled. At your £${r.budget.toFixed(1)}m the best buildable squad projects ${r.ceil?r.ceil.score.toFixed(1):'–'} and the cheapest legal one ${r.floor.toFixed(1)} — you sit ${r.rating.toFixed(0)}% of the way up that range.</div>
      <div class="sub" style="margin-top:4px">Ahead of <b style="color:var(--chalk)">${r.beaten.toFixed(0)}%</b> of plausible squads built at the same money.</div>
      ${r.missing?`<div class="sub warn" style="margin-top:4px">${r.missing} player${r.missing>1?'s':''} in your squad fell below the minutes filter and were left out.</div>`:''}
    </div>
  </div>
  <div class="bars">
    ${barHtml('Points ceiling reached', r.rating, `How close your XI gets to the best buildable squad at your budget.`)}
    ${barHtml('Fixture run', r.fixtureScore, `Your XI averages FDR ${r.avgFdrXI.toFixed(2)} over the next ${state.horizon} ${wk}.`)}
    ${barHtml('Minutes security', r.minsScore, `How reliably your eleven start and finish matches.`)}
    ${barHtml('Captain choice', r.capScore, r.capUsed?`${P[r.capUsed].n} against the best armband in your XI for GW${GWS[0]}${r.bestCapId&&r.bestCapId!==r.capUsed?`, which is ${P[r.bestCapId].n}`:''}.`:'No captain set.')}
    ${barHtml('Bench value', r.benchScore, `Bench scores nothing unless you play bench boost — but dead subs cost you when someone doesn't start.`)}
  </div>
  <div class="poshead"><span>Biggest upgrades available</span><em>at or below current price</em></div>
  <div class="scroll"><table class="weak"><thead><tr><th>Out</th><th>In</th><th>£</th><th>Gain</th></tr></thead><tbody>
    ${r.weak.filter(w=>w.alt&&w.gain>0.4).map(w=>`<tr>
      <td>${P[w.id].n}<div class="psub">${T[P[w.id].t].n} · ${PROJ[w.id].ep.toFixed(1)}</div></td>
      <td>${P[w.alt].n}<div class="psub">${T[P[w.alt].t].n} · ${PROJ[w.alt].ep.toFixed(1)}</div></td>
      <td>${P[w.alt].cost.toFixed(1)}</td>
      <td class="ep delta up">+${w.gain.toFixed(1)}</td></tr>`).join('') || '<tr><td colspan="4">Nothing obvious to upgrade at these prices.</td></tr>'}
  </tbody></table></div>
  <div class="controls" style="margin-top:12px">
    <button class="btn primary" id="loadRated">Open this squad in the planner</button>
  </div>
  <div class="note">The rating is not a league percentile — it measures your squad against what the model says was buildable with your money, over your chosen horizon. Change the horizon or form weight on the Model tab and it will move.</div>`;
  $('#loadRated').onclick=()=>{
    state.squad=r.ids.slice(0,15); state.xi=[]; bestXI();
    if(r.capUsed&&state.xi.includes(r.capUsed)) state.cap=r.capUsed;
    go('squad'); toast('Squad loaded — swap anyone from here.');
  };
}

function applyPicks(json, bankOverride){
  const picks=json.picks||json;
  if(!Array.isArray(picks)) throw new Error('no picks');
  const ids=picks.map(p=>p.element);
  const cap=(picks.find(p=>p.is_captain)||{}).element||null;
  const eh=json.entry_history||{};
  const bank=bankOverride!=null? bankOverride : (eh.bank!=null? eh.bank/10 : 0);
  RATED=rateSquad(ids, cap, bank);
  $('#rateFallback').hidden=true;
  renderRate();
}

// Rate the squad sitting in the Squad tab, rather than one fetched by ID.
// Uses the armband you've actually set, and your real bank from the build.
function rateBuiltSquad(){
  if(state.squad.length<15){
    toast(`You have ${state.squad.length} of 15 — fill the squad first.`);
    return;
  }
  const bank = Math.max(0, 100.0 - squadCost());
  RATED = rateSquad(state.squad.slice(), state.cap, bank);
  $('#rateFallback').hidden = true;
  $('#rateMsg').textContent = `Rating the squad you built — £${squadCost().toFixed(1)}m spent, £${bank.toFixed(1)}m in the bank.`;
  renderRate();
}

function renderBuiltHint(){
  const el=$('#builtHint');
  if(!el) return;
  const n=state.squad.length;
  el.textContent = n===15
    ? `15 picked, £${squadCost().toFixed(1)}m spent`
    : `${n}/15 picked so far`;
  $('#rateBuilt').disabled = n<15;
}

/* =========================================================
   SCREENSHOT IMPORT
   OCR is never clean on a phone screenshot, so nothing is rated until
   you've confirmed the read. Names are matched against the 658 players
   in the database, not trusted as typed.
   ========================================================= */

// strip accents and punctuation so "Ødegaard" matches "odegaard"
function normName(x){
  return String(x).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z ]/g,'').trim();
}
function editRatio(a,b){
  if(a===b) return 1;
  const m=a.length, n=b.length;
  if(!m||!n) return 0;
  let prev=Array.from({length:n+1},(_,j)=>j), cur=new Array(n+1);
  for(let i=1;i<=m;i++){
    cur[0]=i;
    for(let j=1;j<=n;j++){
      cur[j]=Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+(a[i-1]===b[j-1]?0:1));
    }
    [prev,cur]=[cur,prev];
  }
  return 1 - prev[n]/Math.max(m,n);
}
let NAME_INDEX=null;
function nameIndex(){
  if(!DATA || !DATA.players) return [];       // called before boot finished
  if(NAME_INDEX) return NAME_INDEX;
  NAME_INDEX=DATA.players.filter(playable).map(p=>({p, key:normName(p.n)}));
  return NAME_INDEX;
}
// best database match for one line of OCR text
function matchName(raw){
  const q=normName(raw);
  if(q.length<3) return null;
  let best=null;
  for(const e of nameIndex()){
    if(!e.key) continue;
    let sc;
    if(e.key===q) sc=1;
    else if(e.key.startsWith(q)||q.startsWith(e.key)) sc=0.93;
    else sc=editRatio(q,e.key);
    // break ties toward the more-owned player (two Silvas, one is obvious)
    if(!best||sc>best.sc||(sc===best.sc&&e.p.sel>best.p.sel)) best={p:e.p, sc};
  }
  return (best && best.sc>=0.70) ? best : null;
}

/* A fixed black/white cutoff wrecks as many screenshots as it helps: FPL's
   name chips are dark-on-white but score rows are light-on-dark, and a dark
   theme inverts everything. So there are three preparations and the reader
   tries them in turn until enough names come back. */
function drawScaled(img){
  const scale=Math.min(3, Math.max(1.6, 1600/img.naturalWidth));
  const c=document.createElement('canvas');
  c.width=Math.round(img.naturalWidth*scale);
  c.height=Math.round(img.naturalHeight*scale);
  const x=c.getContext('2d');
  x.imageSmoothingQuality='high';
  x.drawImage(img,0,0,c.width,c.height);
  return c;
}
function toGrey(c){
  const x=c.getContext('2d'), d=x.getImageData(0,0,c.width,c.height), a=d.data;
  for(let i=0;i<a.length;i+=4){
    const g=0.299*a[i]+0.587*a[i+1]+0.114*a[i+2];
    a[i]=a[i+1]=a[i+2]=g;
  }
  x.putImageData(d,0,0);
  return d;
}
// Otsu picks the cutoff from the image itself instead of a guess
function otsuLevel(data){
  const h=new Array(256).fill(0);
  for(let i=0;i<data.length;i+=4) h[data[i]|0]++;
  const total=data.length/4;
  let sum=0; for(let t=0;t<256;t++) sum+=t*h[t];
  let sumB=0,wB=0,best=0,lvl=128;
  for(let t=0;t<256;t++){
    wB+=h[t]; if(!wB) continue;
    const wF=total-wB; if(!wF) break;
    sumB+=t*h[t];
    const mB=sumB/wB, mF=(sum-sumB)/wF;
    const v=wB*wF*(mB-mF)*(mB-mF);
    if(v>best){ best=v; lvl=t; }
  }
  return lvl;
}
function prepImage(img, mode){
  const c=drawScaled(img);
  const x=c.getContext('2d');
  const d=toGrey(c), a=d.data;
  if(mode==='grey'){                       // let Tesseract do its own thresholding
    x.putImageData(d,0,0); return c;
  }
  const lvl=otsuLevel(a);
  const inv = mode==='invert';
  for(let i=0;i<a.length;i+=4){
    let v=a[i]<lvl?0:255;
    if(inv) v=255-v;
    a[i]=a[i+1]=a[i+2]=v;
  }
  x.putImageData(d,0,0);
  return c;
}

let ROT_ALL=[];
let SHOT=[];            // confirmed matches awaiting rating
function loadTesseract(){
  if(window.Tesseract) return Promise.resolve();
  const urls=[
    'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js',
    'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js'
  ];
  return new Promise((res,rej)=>{
    let i=0;
    const tryNext=()=>{
      if(i>=urls.length) return rej(new Error('no cdn'));
      const sc=document.createElement('script');
      sc.src=urls[i++]; sc.onload=()=>res(); sc.onerror=tryNext;
      document.body.appendChild(sc);
    };
    tryNext();
  });
}

let LAST_OCR='';
function ocrLines(text){
  return String(text||'').split(/[\n\r]+/).map(t=>t.trim()).filter(t=>t.length>2);
}
function countMatches(lines){
  const seen=new Set();
  for(const l of lines) for(const chunk of l.split(/[,|/]+/)){
    const m=matchName(chunk);
    if(m) seen.add(m.p.i);
  }
  return seen.size;
}

async function readScreenshot(file){
  const st=$('#shotStatus');
  st.hidden=false;
  $('#shotReview').hidden=true;
  st.textContent='Loading the text reader… the first run downloads it, so give it a moment.';

  try{ await loadTesseract(); }
  catch(e){
    st.innerHTML='<span class="warn">Couldn\'t reach the text reader. It needs a connection the first time you use it — after that it works offline. Use “Type names instead” meanwhile.</span>';
    return;
  }

  let img;
  try{
    img=new Image();
    img.src=URL.createObjectURL(file);
    await img.decode();
  }catch(e){
    st.innerHTML='<span class="warn">That image couldn\'t be opened. HEIC photos from an iPhone often fail — screenshot as PNG or JPG.</span>';
    return;
  }

  /* Benchmarked against a mock FPL pitch: automatic layout detection (PSM 3)
     found 8 of 12 names, block mode 7, and sparse-text mode 0 — it shreds
     short labels in boxes. Ordered by what actually scored. */
  const attempts=[
    {mode:'grey',   psm:'3', label:'automatic layout'},
    {mode:'otsu',   psm:'3', label:'high contrast'},
    {mode:'otsu',   psm:'6', label:'block text'},
    {mode:'invert', psm:'3', label:'inverted'}
  ];
  let best={lines:[], n:-1, label:''};
  for(let i=0;i<attempts.length;i++){
    const a=attempts[i];
    st.textContent=`Reading the image (pass ${i+1} of ${attempts.length}, ${a.label})…`;
    let text='';
    try{
      const canvas=prepImage(img, a.mode);
      const r=await window.Tesseract.recognize(canvas,'eng',{
        logger:m=>{
          if(m.status==='recognizing text'){
            st.textContent=`Reading the image (pass ${i+1} of ${attempts.length}) — ${Math.round((m.progress||0)*100)}%`;
          } else if(m.status && m.status.includes('loading language')){
            st.textContent='Downloading the language data, one time only…';
          }
        },
        tessedit_pageseg_mode:a.psm
      });
      text=r.data.text||'';
    }catch(e){ continue; }
    const lines=ocrLines(text);
    const n=countMatches(lines);
    if(n>best.n) best={lines, n, label:a.label, text};
    if(n>=13) break;                    // good enough, stop burning battery
  }
  LAST_OCR=best.text||'';
  st.hidden=true;
  showShotPreview(img, best);
  reviewNames(best.lines, 'screenshot');
}

// Show what was actually read, so a bad result is diagnosable rather than
// just disappointing.
function showShotPreview(img, best){
  const el=$('#shotStatus');
  el.hidden=false;
  el.innerHTML=`Matched ${best.n} name${best.n===1?'':'s'} using the ${best.label} pass.
    <button class="btn mini" id="ocrRaw" style="margin-left:6px">Show what it read</button>`;
  const b=document.getElementById('ocrRaw');
  if(b) b.onclick=()=>{
    const dlg=$('#swapDlg');
    $('#swapTitle').textContent='Raw text from the image';
    $('#swapBody').innerHTML=`<div class="note">If this looks like nonsense, crop tighter to just the pitch and try again — or type the names in.</div>
      <textarea rows="10" readonly id="rawBox"></textarea>`;
    const t=document.getElementById('rawBox'); if(t) t.value=LAST_OCR||'(nothing)';
    dlg.showModal();
  };
}

// Shared review step for both OCR and typed names.
function reviewNames(lines, source){
  if(!nameIndex().length){
    $('#shotStatus').hidden=false;
    $('#shotStatus').innerHTML='<span class="warn">Player data hasn\'t finished loading — try again in a moment.</span>';
    return;
  }
  const seen=new Set(); const found=[];
  for(const line of lines){
    for(const chunk of line.split(/[,|/]+/)){
      const m=matchName(chunk);
      if(m && !seen.has(m.p.i)){ seen.add(m.p.i); found.push({...m, raw:chunk.trim()}); }
    }
  }
  found.sort((a,b)=>a.p.p-b.p.p || b.sc-a.sc);
  SHOT=found;
  renderShotReview(source);
}

function renderShotReview(source){
  const el=$('#shotReview'); el.hidden=false;
  if(!SHOT.length){
    el.innerHTML=`<div class="note warn">No player names recognised. Try a sharper crop of just the pitch, or type the names in.</div>`;
    return;
  }
  const counts={1:0,2:0,3:0,4:0};
  SHOT.forEach(x=>counts[x.p.p]++);
  const missing=[1,2,3,4].filter(p=>counts[p]<SQUAD_N[p])
    .map(p=>`${SQUAD_N[p]-counts[p]} ${POSN[p]}`);
  const cost=SHOT.reduce((s,x)=>s+x.p.cost,0);
  el.innerHTML=`
    <div class="note">Read ${SHOT.length} of 15 from the ${source}. Check these before rating — remove anything wrong.</div>
    ${SHOT.map(x=>{
      const cls=x.sc>=0.95?'hi':x.sc>=0.8?'mid':'lo';
      return `<div class="shotrow">
        <span class="conf ${cls}">${Math.round(x.sc*100)}%</span>
        <div class="grow"><div class="nm">${x.p.n}</div>
          <div class="src">${T[x.p.t].n} · ${POSN[x.p.p]} · £${x.p.cost.toFixed(1)}m${x.raw&&normName(x.raw)!==normName(x.p.n)?` · read as “${x.raw}”`:''}</div></div>
        <button class="mini" data-shotdrop="${x.p.i}">Remove</button>
      </div>`;
    }).join('')}
    ${missing.length?`<div class="shotmiss">Still missing ${missing.join(', ')} — add them on the Squad tab, or rate what's here.</div>`:''}
    <div class="shotfoot">
      <button class="btn primary" id="shotApply">Put these in my squad</button>
      <span class="note" style="margin:0">£${cost.toFixed(1)}m so far</span>
    </div>`;
  $('#shotApply').onclick=()=>{
    state.squad=[]; state.xi=[]; state.cap=null; state.vice=null;
    let rejected=0;
    for(const x of SHOT){
      if(canAdd(x.p)) { rejected++; continue; }
      state.squad.push(x.p.i);
    }
    autoXIifNeeded();
    el.hidden=true;
    if(state.squad.length===15){ rateBuiltSquad(); }
    else { go('squad'); }
    toast(rejected
      ? `${state.squad.length} added, ${rejected} skipped (squad rules).`
      : `${state.squad.length} players loaded.`);
  };
}

/* The gameweek to fetch was being read from the snapshot's own gwPlayed,
   which is frozen at whatever was true when the data file was built. Ask FPL
   which gameweek the manager is actually on instead, and always report the
   gameweek that was really loaded rather than the one first attempted. */
async function latestGwFor(id){
  const entry=await grab(`https://fantasy.premierleague.com/api/entry/${id}/`);
  if(entry && entry.current_event) return entry.current_event;
  const boot=await grab('https://fantasy.premierleague.com/api/bootstrap-static/');
  if(boot && boot.events){
    const finished=boot.events.filter(e=>e.finished||e.is_current);
    if(finished.length) return finished[finished.length-1].id;
  }
  // Couldn't reach FPL. Fall back to the snapshot, but flag it, because a
  // stale file means a stale gameweek and an old team.
  GW_FROM_SNAPSHOT=true;
  return Math.max(1, DATA.gwPlayed||1);
}
let GW_FROM_SNAPSHOT=false;

async function rateById(){
  const id=($('#teamId').value||'').replace(/\D/g,'');
  if(!id){ toast('Enter your team ID first.'); return; }
  const msg=$('#rateMsg');
  msg.textContent='Asking FPL which gameweek this team is on…';
  $('#rateGo').disabled=true;

  GW_FROM_SNAPSHOT=false;
  const wanted=+($('#rateGw').value||0) || await latestGwFor(id);
  let json=null, gotGw=null;
  for(let g=wanted; g>=Math.max(1,wanted-3); g--){
    msg.textContent=`Fetching gameweek ${g}…`;
    const r=await grab(`https://fantasy.premierleague.com/api/entry/${id}/event/${g}/picks/`);
    if(r && r.picks){ json=r; gotGw=g; break; }
  }
  $('#rateGo').disabled=false;

  if(!json){
    msg.textContent='';
    $('#rateFallback').hidden=false;
    const url=`https://fantasy.premierleague.com/api/entry/${id}/event/${wanted}/picks/`;
    $('#fallbackUrl').innerHTML=`<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
    return;
  }

  const behind = gotGw<wanted
    ? ` <span class="warn">Gameweek ${wanted} wasn't available, so this is ${gotGw}.</span>` : '';
  const guessed = GW_FROM_SNAPSHOT
    ? `<br><span class="warn">FPL couldn't be reached to ask which gameweek is current, so this used gameweek ${DATA.gwPlayed} from a data file built ${String(DATA.built||'').slice(0,10)}. If that's out of date, so is this team — refresh the data, or set the gameweek yourself above.</span>`
    : '';
  msg.innerHTML=`Loaded team ${id} as it stood in <b>gameweek ${gotGw}</b>.${behind}
    ${guessed}
    <br><span style="color:var(--chalk-dim)">FPL only publishes a team once its deadline has passed, so the side you have set for the next gameweek is never available here. Build that one on the Squad tab.</span>`;
  try{ applyPicks(json); }
  catch(e){ msg.innerHTML='<span class="warn">That response didn\'t contain a squad.</span>'; }
}

/* ---------- squad codes ---------- */
function squadCode(){ return btoa(JSON.stringify({s:state.squad,x:state.xi,c:state.cap,v:state.vice})); }
function loadCode(code){
  try{
    const o=JSON.parse(atob(code.trim()));
    state.squad=(o.s||[]).filter(id=>P[id]); state.xi=(o.x||[]).filter(id=>P[id]);
    state.cap=o.c; state.vice=o.v; render(); toast('Squad loaded.');
  }catch(e){ toast('That code didn\'t read properly.'); }
}

/* ---------- wiring ---------- */
function buildTeamFilter(){
  $('#fTeam').innerHTML='<option value="0">All clubs</option>'+
    [...DATA.teams].sort((a,b)=>a.n.localeCompare(b.n)).map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
}
$$('nav button').forEach(b=>b.onclick=()=>go(b.dataset.tab));
document.addEventListener('click',e=>{
  const a=e.target.closest('[data-add]'); if(a){ toggle(+a.dataset.add); return; }
  const pk=e.target.closest('[data-pick]'); if(pk){ openPicker(+pk.dataset.pick); return; }
  const pi=e.target.closest('[data-pickin]'); if(pi){
    const id=+pi.dataset.pickin;
    const err=canAdd(P[id]);
    if(err){ toast(err); return; }
    state.squad.push(id);
    autoXIifNeeded();
    $('#swapDlg').close();
    render();
    toast(`${P[id].n} added — ${state.squad.length}/15.`);
    return;
  }
  const s=e.target.closest('[data-swap]'); if(s && !s.classList.contains('pcard')){ openSwap(+s.dataset.swap); return; }
  const d=e.target.closest('[data-do]'); if(d){ const [o,i]=d.dataset.do.split(':').map(Number); doSwap(o,i); return; }
  const b=e.target.closest('[data-bench]'); if(b){
    const id=+b.dataset.bench;
    if(state.xi.includes(id)) state.xi=state.xi.filter(x=>x!==id);
    else if(state.xi.length<11) state.xi.push(id);
    else toast('Eleven already picked — bench someone first.');
    render(); return;
  }
  const c=e.target.closest('[data-capt]'); if(c){
    const id=+c.dataset.capt;
    if(state.cap===id) state.cap=null; else { if(state.vice===id) state.vice=state.cap; state.cap=id; }
    render(); return;
  }
});
$('#q').oninput=e=>{state.q=e.target.value; renderPlayers();};
$('#fPos').onchange=e=>{state.fPos=+e.target.value; renderPlayers();};
$('#fTeam').onchange=e=>{state.fTeam=+e.target.value; renderPlayers();};
$('#fMax').onchange=e=>{state.fMax=+e.target.value; renderPlayers();};
$('#fAvail').onchange=e=>{state.fAvail=e.target.value; renderPlayers();};
$$('#ptable th').forEach(th=>th.onclick=()=>{
  const k=th.dataset.k; if(!k) return;   // the pick column doesn't sort
  if(state.sortKey===k) state.sortDir*=-1; else {state.sortKey=k; state.sortDir=k==='n'?1:-1;}
  renderPlayers();
});
$('#optimise').onclick=buildBest;
$('#manualToggle').onclick=e=>{
  state.manual=!state.manual;
  e.currentTarget.setAttribute('aria-pressed', state.manual);
  e.currentTarget.classList.toggle('primary', state.manual);
  if(!state.manual){ state.manualAfford=null; }
  renderPlayers();
};
$('#slotClearFilter').onclick=()=>{
  state.fPos=0; state.manualAfford=null;
  $('#fPos').value='0';
  renderPlayers();
};
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-slot]');
  if(!b) return;
  const pos=+b.dataset.slot;
  if(state.fPos===pos){ state.fPos=0; state.manualAfford=null; }
  else { state.fPos=pos; state.manualAfford=affordableFor(pos); }
  $('#fPos').value=String(state.fPos);
  renderPlayers();
});
// 'current' is always the next gameweek to be played, whatever the
// gameweek selector happens to be showing. 'shown' follows the selector.
function autoPickBasisGw(){
  if(state.autoBasis==='horizon') return null;
  if(state.autoBasis==='shown')   return state.pitchGw || GWS[0];
  return GWS[0];
}
$('#autoXI2').onclick=()=>pickBestXI(autoPickBasisGw());
$('#autoBasis').onchange=e=>{ state.autoBasis=e.target.value; render(); };
$('#clearSq').onclick=()=>{
  state.squad=[]; state.xi=[]; state.cap=null; state.vice=null;
  state.view='pitch'; $('#viewMode').value='pitch';   // show the empty board
  render();
  toast('Squad cleared — tap a + to start picking.');
};
$('#copyCode').onclick=async()=>{
  const code=squadCode();
  try{ await navigator.clipboard.writeText(code); toast('Squad code copied.'); }
  catch(e){
    const dlg=$('#swapDlg');
    $('#swapTitle').textContent='Your squad code';
    $('#swapBody').innerHTML=`<div class="note">Clipboard access was refused — copy this by hand.</div>
      <textarea id="codeOut" rows="4" readonly></textarea>
      <div class="controls" style="margin-top:10px"><button class="btn" id="codeDone">Done</button></div>`;
    const ta=document.getElementById('codeOut'); if(ta){ ta.value=code; ta.select(); }
    dlg.showModal();
    document.getElementById('codeDone').onclick=()=>dlg.close();
  }
};
$('#loadCode').onclick=()=>{
  const dlg=$('#swapDlg');
  $('#swapTitle').textContent='Load a squad code';
  $('#swapBody').innerHTML=`<textarea id="codeBox" rows="4" placeholder="Paste the code"></textarea>
    <div class="controls" style="margin-top:10px">
      <button class="btn primary" id="codeGo">Load</button>
      <button class="btn" id="codeNo">Cancel</button></div>`;
  dlg.showModal();
  document.getElementById('codeGo').onclick=()=>{
    const v=(document.getElementById('codeBox')||{}).value||'';
    dlg.close(); if(v.trim()) loadCode(v);
  };
  document.getElementById('codeNo').onclick=()=>dlg.close();
};
$('#chip').onchange=e=>{
  state.chip=e.target.value;
  state.chipGw=(state.chip==='none') ? null : (state.pitchGw||GWS[0]);
  render();
};
$('#viewMode').onchange=e=>{ state.view=e.target.value; render(); };
$('#kitMode').onchange=e=>{
  state.kitMode=e.target.value;
  faceFailures=0;
  const note=document.getElementById('faceNote');
  if(note) note.hidden=true;
  renderPitch();
};
$('#pitchGw').onchange=()=>render();
$('#hz').oninput=e=>{state.horizon=+e.target.value; $('#hzLbl').textContent=`${state.horizon} week${state.horizon>1?'s':''}`; render();};
$('#fw').oninput=e=>{state.formW=+e.target.value/100; $('#fwLbl').textContent=`${e.target.value}%`; render();};
$('#mm').oninput=e=>{state.minMins=+e.target.value; $('#mmLbl').textContent=e.target.value; render();};
$('#fdrN').oninput=e=>{
  state.fdrN=+e.target.value;
  $('#fdrNLbl').textContent=e.target.value;
  if(state.fixMode==='rotation') $('#rotOut').innerHTML='<div class="note">Weeks changed — run it again.</div>';
  else renderFdr();
};
$('#fixMode').onchange=e=>{ state.fixMode=e.target.value; render(); };
$('#fdrSort').onchange=e=>{state.fdrSort=e.target.value; renderFdr();};
$('#rotSize').onchange=e=>{state.rotSize=+e.target.value;};
$('#runRot').onclick=()=>{ $('#rotOut').innerHTML='<div class="note">Working…</div>'; setTimeout(renderRotation,20); };
$('#rotShow').onchange=e=>{ state.rotShow=+e.target.value; if(ROT_ALL.length) renderRotation(); };
$('#depth').onchange=e=>{
  const v=e.target.value;
  state.depth = v==='fast'?14 : v==='thorough'?26 : 999;
  state.passes= v==='fast'?8  : v==='thorough'?14 : 40;
  toast(v==='exhaustive'?'Exhaustive search — slower, but nothing is skipped.':'Search depth set.');
};
$('#refresh').onclick=refresh;
$('#rateGo').onclick=rateById;
$('#rateBuilt').onclick=rateBuiltSquad;
$('#shotFile').onchange=e=>{ const f=e.target.files&&e.target.files[0]; if(f) readScreenshot(f); };
// Chrome on Android silently returns null from prompt() once a page has been
// told to stop making dialogs, and a 15-line squad is miserable to type into
// one anyway. Use the in-page dialog instead.
function openNameEntry(){
  const dlg=$('#swapDlg');
  $('#swapTitle').textContent='Type your squad';
  $('#swapBody').innerHTML=`
    <div class="note">One player per line, or separated by commas. Surnames are enough — spelling doesn't have to be exact.</div>
    <textarea id="nameBox" rows="9" placeholder="Raya&#10;Gvardiol&#10;Konsa&#10;..."></textarea>
    <div class="controls" style="margin-top:10px">
      <button class="btn primary" id="nameGo">Match these</button>
      <button class="btn" id="nameCancel">Cancel</button>
    </div>`;
  dlg.showModal();
  const box=$('#nameBox'); if(box) box.focus();
  const go=document.getElementById('nameGo');
  if(go) go.onclick=()=>{
    const t=(document.getElementById('nameBox')||{}).value||'';
    dlg.close();
    if(t.trim()) reviewNames(t.split(/[\n,]+/), 'list you typed');
    else toast('Nothing typed.');
  };
  const no=document.getElementById('nameCancel');
  if(no) no.onclick=()=>dlg.close();
}
$('#pasteNames').onclick=openNameEntry;

// Labels pointing at a display:none input don't reliably open the picker in
// every Android browser. Click the input directly.
$('#shotPick').onclick=()=>{ const i=$('#shotFile'); if(i) i.click(); };
document.addEventListener('click',e=>{
  const d=e.target.closest('[data-shotdrop]');
  if(!d) return;
  SHOT=SHOT.filter(x=>x.p.i!==+d.dataset.shotdrop);
  renderShotReview('screenshot');
});
$('#teamId').addEventListener('keydown',e=>{ if(e.key==='Enter') rateById(); });
$('#pasteGo').onclick=()=>{
  const raw=$('#pasteBox').value.trim();
  if(!raw){ toast('Paste the page contents first.'); return; }
  try{
    const j=JSON.parse(raw.slice(raw.indexOf('{')));
    applyPicks(j);
    $('#rateMsg').textContent='Rated from pasted data.';
  }catch(e){ toast('That didn\'t parse as FPL picks data.'); }
};


/* =========================================================
   Drag to substitute on the pitch.
   Touch gets a short press-and-hold first so the page can still
   scroll normally; a mouse just drags. A plain tap still opens
   the transfer dialog.
   ========================================================= */
const drag = {id:null, from:null, ghost:null, active:false, timer:null, sx:0, sy:0, over:null, pid:null};

function legalAfterSub(outId, inId){
  const next=state.xi.filter(x=>x!==outId).concat(inId);
  const c={1:0,2:0,3:0,4:0};
  next.forEach(id=>c[P[id].p]++);
  if(c[1]!==1) return 'You can only field one goalkeeper.';
  if(c[2]<3) return 'You need at least three defenders.';
  if(c[2]>5) return 'Five defenders is the maximum.';
  if(c[3]<2) return 'You need at least two midfielders.';
  if(c[4]<1) return 'You need at least one forward.';
  if(c[4]>3) return 'Three forwards is the maximum.';
  return null;
}

function doSub(aId, bId){
  const aIn=state.xi.includes(aId), bIn=state.xi.includes(bId);
  if(aIn===bIn){ toast(aIn?'Both are already in the eleven.':'Both are on the bench.'); return; }
  const outId=aIn?aId:bId, inId=aIn?bId:aId;
  const err=legalAfterSub(outId,inId);
  if(err){ toast(err); return; }
  state.xi=state.xi.filter(x=>x!==outId).concat(inId);
  if(state.cap===outId) state.cap=inId;
  if(state.vice===outId) state.vice=inId;
  render();
  const gw=state.pitchGw||GWS[0];
  const d=epOf(inId,gw)-epOf(outId,gw);
  toast(`${P[inId].n} on for ${P[outId].n} — ${d>=0?'+':''}${d.toFixed(1)} in GW${gw}.`);
}

function ghostFrom(card, x, y){
  const g=card.cloneNode(true);
  g.className='pcard ghost';
  const r=card.getBoundingClientRect();
  g.style.width=r.width+'px';
  g.style.left=(x-r.width/2)+'px';
  g.style.top=(y-r.height/2)+'px';
  document.body.appendChild(g);
  return g;
}

function markTargets(on){
  document.querySelectorAll('#pitch .pcard').forEach(c=>{
    if(!on){ c.classList.remove('cand','noncand','lifted'); return; }
    const id=+c.dataset.pid;
    if(id===drag.id){ c.classList.add('lifted'); return; }
    const sameSide = state.xi.includes(id)===state.xi.includes(drag.id);
    const ok = !sameSide && !legalAfterSub(
      state.xi.includes(drag.id)?drag.id:id,
      state.xi.includes(drag.id)?id:drag.id);
    c.classList.add(ok?'cand':'noncand');
  });
}

function beginDrag(card, x, y){
  drag.active=true;
  drag.ghost=ghostFrom(card,x,y);
  document.body.classList.add('dragging');
  markTargets(true);
  if(navigator.vibrate) navigator.vibrate(12);
}

function endDrag(drop){
  clearTimeout(drag.timer);
  if(drag.ghost) drag.ghost.remove();
  const pitchEl=document.getElementById('pitch');
  if(pitchEl && drag.pid!=null){
    try{ pitchEl.releasePointerCapture(drag.pid); }catch(_){}
  }
  drag.pid=null;
  document.body.classList.remove('dragging');
  document.querySelectorAll('#pitch .pcard').forEach(c=>c.classList.remove('cand','noncand','lifted','hover'));
  const was=drag.active, id=drag.id;
  drag.active=false; drag.id=null; drag.ghost=null; drag.over=null;
  if(was && drop!=null && drop!==id) doSub(id, drop);
  return was;
}

(function wireDrag(){
  const pitch=document.getElementById('pitch');
  if(!pitch) return;

  pitch.addEventListener('pointerdown', e=>{
    const card=e.target.closest('.pcard');
    if(!card) return;
    drag.id=+card.dataset.pid; drag.sx=e.clientX; drag.sy=e.clientY; drag.active=false;
    // Capture the pointer so move and up keep reaching us once the cursor
    // leaves the pitch — without this a mouse drag freezes the moment it
    // strays outside the box and never releases.
    try{ pitch.setPointerCapture(e.pointerId); drag.pid=e.pointerId; }catch(_){}
    if(e.pointerType==='mouse'){
      e.preventDefault();      // stop the browser dragging the shirt image itself
      return;                  // a mouse drags on movement, no hold needed
    }
    drag.timer=setTimeout(()=>beginDrag(card,e.clientX,e.clientY), 260);   // touch holds first
  });

  // A shirt is an <img>, and on desktop mousedown on an image starts the
  // browser's own drag-and-drop, which cancels our pointer events outright.
  pitch.addEventListener('dragstart', e=>e.preventDefault());

  pitch.addEventListener('pointermove', e=>{
    if(drag.id==null) return;
    const moved=Math.hypot(e.clientX-drag.sx, e.clientY-drag.sy);
    if(!drag.active){
      if(e.pointerType==='mouse' && moved>6){
        const card=pitch.querySelector(`.pcard[data-pid="${drag.id}"]`);
        if(card) beginDrag(card,e.clientX,e.clientY);
      } else if(moved>12){
        clearTimeout(drag.timer);                        // a scroll, not a drag
        drag.id=null;
      }
      return;
    }
    drag.ghost.style.left=(e.clientX-drag.ghost.offsetWidth/2)+'px';
    drag.ghost.style.top=(e.clientY-drag.ghost.offsetHeight/2)+'px';
    drag.ghost.style.display='none';
    const under=document.elementFromPoint(e.clientX,e.clientY);
    drag.ghost.style.display='';
    const t=under && under.closest('#pitch .pcard');
    if(drag.over && drag.over!==t) drag.over.classList.remove('hover');
    drag.over = (t && t.classList.contains('cand')) ? t : null;
    if(drag.over) drag.over.classList.add('hover');
  });

  const finish=e=>{
    if(drag.id==null) return;
    const wasDragging=drag.active;
    const target=drag.over? +drag.over.dataset.pid : null;
    const id=drag.id;
    endDrag(target);
    if(!wasDragging && e.type==='pointerup'){
      openSwap(id);                                      // a tap means transfer
    }
  };
  pitch.addEventListener('pointerup', finish);
  pitch.addEventListener('pointercancel', ()=>endDrag(null));
  // Belt and braces: if a release still lands outside the pitch, clean up
  // rather than leaving the page stuck mid-drag.
  window.addEventListener('pointerup', e=>{ if(drag.id!=null) finish(e); });
  window.addEventListener('blur', ()=>{ if(drag.id!=null) endDrag(null); });
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape' && drag.id!=null){ endDrag(null); toast('Substitution cancelled.'); }
  });

  // stop the page scrolling underneath an active drag
  pitch.addEventListener('touchmove', e=>{ if(drag.active) e.preventDefault(); }, {passive:false});
})();

window.imgFallback=imgFallback;

/* =========================================================
   APPEARANCE
   Themes redefine tokens; the three accent roles survive every one,
   so colour keeps meaning what it meant. Saved where the browser
   allows it, and silently skipped where it doesn't.
   ========================================================= */
const THEMES={
  floodlit:{name:'Floodlit', swatch:['#0B1E18','#F5B93C','#35D7E1','#FF5C7A']},
  midnight:{name:'Midnight', swatch:['#0C0E14','#FFC94D','#7C9CFF','#FF7AB0']},
  terrace: {name:'Terrace',  swatch:['#F3F1E9','#8F5A08','#0E6E8C','#C22B55']},
  claret:  {name:'Claret',   swatch:['#1A0F16','#F0C24A','#6FD3B2','#FF6E8A']}
};
const FONTS={
  archivo:{name:'Archivo',   note:'Scoreboard figures',
    body:'Archivo,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    display:'"Archivo Narrow",Archivo,sans-serif'},
  system:{name:'System',     note:'Your phone\u2019s own',
    body:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    display:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'},
  serif:{name:'Serif',       note:'Match programme',
    body:'Georgia,"Times New Roman",serif',
    display:'Georgia,"Times New Roman",serif'},
  mono:{name:'Monospace',    note:'Everything aligns',
    body:'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    display:'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'},
  humanist:{name:'Humanist', note:'Softer, wider',
    body:'"Trebuchet MS",Verdana,"Segoe UI",sans-serif',
    display:'"Trebuchet MS",Verdana,"Segoe UI",sans-serif'}
};
const LOOK_DEFAULT={theme:'floodlit', font:'archivo', scale:100, compact:false, accents:{}};
let look={...LOOK_DEFAULT, accents:{}};

function saveLook(){
  try{ localStorage.setItem('touchline.look', JSON.stringify(look)); return true; }
  catch(e){ return false; }
}
function restoreLook(){
  try{
    const raw=localStorage.getItem('touchline.look');
    if(raw) look={...LOOK_DEFAULT, ...JSON.parse(raw)};
  }catch(e){}
  applyLook();
}
function applyLook(){
  const b=document.body, r=document.documentElement;
  b.setAttribute('data-theme', look.theme);
  b.classList.toggle('compact', !!look.compact);
  const f=FONTS[look.font]||FONTS.archivo;
  r.style.setProperty('--font-body', f.body);
  r.style.setProperty('--font-display', f.display);
  r.style.fontSize=(16*(look.scale/100)).toFixed(2)+'px';
  for(const k of ['projection','pick','boost']){
    if(look.accents[k]) r.style.setProperty('--'+k, look.accents[k]);
    else r.style.removeProperty('--'+k);
  }
}
function currentAccent(k){
  if(look.accents[k]) return look.accents[k];
  const i={projection:1, pick:2, boost:3}[k];
  return THEMES[look.theme].swatch[i];
}

function renderLook(){
  $('#themeSwatches').innerHTML=Object.entries(THEMES).map(([id,t])=>`
    <button class="swatch" data-theme="${id}" aria-pressed="${look.theme===id}"
      style="background:${t.swatch[0]};color:${t.swatch[1]}" aria-label="${t.name} theme">
      <span>${t.name}</span>
      <i><b style="background:${t.swatch[1]}"></b><b style="background:${t.swatch[2]}"></b><b style="background:${t.swatch[3]}"></b></i>
    </button>`).join('');
  $('#colProjection').value=currentAccent('projection');
  $('#colPick').value=currentAccent('pick');
  $('#colBoost').value=currentAccent('boost');
  $('#fontGrid').innerHTML=Object.entries(FONTS).map(([id,f])=>`
    <button class="fontbtn" data-font="${id}" aria-pressed="${look.font===id}">
      <b style="font-family:${f.display.replace(/"/g,'&quot;')}">${f.name}</b>
      <small>${f.note}</small>
    </button>`).join('');
  $('#uiScale').value=look.scale;
  $('#uiScaleLbl').textContent=look.scale+'%';
  $('#compact').checked=!!look.compact;
  $('#lookSaved').textContent = saveLook()
    ? 'Saved on this device.'
    : 'This browser will not keep settings between visits, so they last for this session only.';
}

function wireLook(){
  document.addEventListener('click', e=>{
    const t=e.target.closest('[data-theme]');
    if(t && t.classList.contains('swatch')){
      look.theme=t.dataset.theme; look.accents={};
      applyLook(); renderLook(); return;
    }
    const f=e.target.closest('[data-font]');
    if(f){ look.font=f.dataset.font; applyLook(); renderLook(); }
  });
  const bind=(id,key)=>{
    const el=$('#'+id); if(!el) return;
    el.oninput=e=>{ look.accents[key]=e.target.value; applyLook(); saveLook(); };
  };
  bind('colProjection','projection'); bind('colPick','pick'); bind('colBoost','boost');
  $('#resetAccents').onclick=()=>{ look.accents={}; applyLook(); renderLook(); };
  $('#uiScale').oninput=e=>{
    look.scale=+e.target.value; $('#uiScaleLbl').textContent=look.scale+'%';
    applyLook(); saveLook();
  };
  $('#compact').onchange=e=>{ look.compact=e.target.checked; applyLook(); saveLook(); };
  $('#resetLook').onclick=()=>{
    look={...LOOK_DEFAULT, accents:{}};
    applyLook(); renderLook(); toast('Appearance reset.');
  };
}

/* ---------- boot ---------- */
async function boot(){
  let d=null;
  try{
    const r=await fetch('data.json?v='+Date.now(), {cache:'no-cache'});
    if(r.ok) d=await r.json();
  }catch(e){}
  if(!d && window.__FPLDATA__) d=window.__FPLDATA__;
  if(!d){
    document.querySelector('main').innerHTML='<div class="note warn" style="padding:20px">Couldn\'t load the player data file. If you opened this straight from your files, serve the folder over http instead.</div>';
    return;
  }
  DATA=d;
  DATA.gwPlayed=DATA.gwPlayed||4;
  for(const k in T) delete T[k]; DATA.teams.forEach(t=>T[t.id]=t);
  for(const k in P) delete P[k]; DATA.players.forEach(p=>P[p.i]=p);
  GWS.length=0; [...new Set(DATA.fixtures.map(f=>f.gw))].sort((a,b)=>a-b).forEach(g=>GWS.push(g));
  buildTeamFilter();
  wireLook();
  restoreLook();
  go('players');
}
boot();
