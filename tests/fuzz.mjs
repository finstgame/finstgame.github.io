// 大量の対局を自動で回して、ルールの壊れ方を探す。
//   node tests/fuzz.mjs [対局数] [種]
// 片方（または両方）がランダムに指し、カード・防御・分配も含めて打つ。
// 待ち時間は仮想の時計で早送りする。毎手のあとに盤の状態が正しいかを確かめる。
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/\nboot\(\);\s*$/, '');

function makeGame(seed){
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const elements = new Map();
  const el = () => ({classList:{add(){},remove(){},contains(){return false},toggle(){}},style:{setProperty(){}},dataset:{},innerHTML:'',textContent:'',tabIndex:0,offsetWidth:10,
    querySelector(){return el()},querySelectorAll(){return []},appendChild(){},remove(){},setAttribute(){},addEventListener(){},scrollIntoView(){},focus(){},getBoundingClientRect(){return {left:0,top:0,width:100,height:100}}});
  const doc = {title:'Finst',hidden:false,documentElement:el(),body:el(),getElementById(id){if(!elements.has(id))elements.set(id,el());return elements.get(id)},querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>el(),addEventListener(){}};
  // 仮想の時計
  let vt = 1_800_000_000_000, tid = 0;
  const timers = [];
  const RealDate = Date;
  class VDate extends RealDate { constructor(...a){ a.length ? super(...a) : super(vt); } static now(){ return vt; } }
  const sandbox = {document:doc, window:{matchMedia:()=>({matches:true}),addEventListener(){},finst3D:{enabled:false,sync(){},clear(){},card(){},hit(){},settle:()=>Promise.resolve()}},
    navigator:{}, localStorage:{getItem:()=>null,setItem(){}}, location:{hash:'',search:''}, URLSearchParams, console, Date:VDate,
    Math:Object.assign(Object.create(Math),{random:rnd}), Promise, crypto:{randomUUID:()=> 'fuzz'},
    setTimeout:(fn,ms=0)=>{const id=++tid;timers.push({id,at:vt+(ms||0),fn});return id;},
    clearTimeout:id=>{const i=timers.findIndex(t=>t.id===id);if(i>=0)timers.splice(i,1);},
    setInterval:()=>0, clearInterval(){}, alert(){}};
  const ctx = vm.createContext(sandbox);
  vm.runInContext(inline, ctx);
  vm.runInContext('render=()=>{}; showPass=()=>{}; showWin=()=>{}; say=()=>{}; notifyTurn=()=>{}; cpuPickNumber=n=>stepGotNumber(n);', ctx);
  const run = code => vm.runInContext(code, ctx);
  const flush = async () => { for(let i = 0; i < 40; i++) await Promise.resolve(); };
  // 予約された処理を時刻順に進める（上限つき）
  const settle = async (limit = 400) => {
    await flush();
    for(let n = 0; n < limit && timers.length; n++){
      timers.sort((a,b) => a.at - b.at);
      const t = timers.shift(); vt = Math.max(vt, t.at);
      t.fn(); await flush();
    }
    return timers.length;
  };
  return {run, settle, rnd, ctx};
}

const N = +process.argv[2] || 300, SEED = +process.argv[3] || 1;
const problems = new Map();
const note = (kind, detail) => { if(!problems.has(kind)) problems.set(kind, {count:0, sample:detail}); problems.get(kind).count++; };
let ended = 0, totalMoves = 0, cardUses = {};

for(let g = 0; g < N; g++){
  const G = makeGame(SEED * 100003 + g);
  const {run, settle, rnd} = G;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const deck = pick(['easy','hard','tech']);
  const cpu = rnd() < 0.5;
  try{
    run(`setDeck(${JSON.stringify(deck)}); online=false; seat=0; reset(); ${cpu ? 'S.cpu=true; NAMES[1]="CPU";' : ''}`);
    if(cpu) run('cpuTick()');
  }catch(e){ note('起動で例外', e.message); continue; }
  let moves = 0, stuck = 0, last = '', rematched = false;
  while(moves < 300){
    await settle();
    let st;
    try{ st = JSON.parse(run('JSON.stringify({S, busy, actor: S ? actor() : null})')); }catch(e){ note('状態が読めない', e.message); break; }
    const S = st.S;
    // ---- 盤の状態の検査 ----
    for(let p = 0; p < 2; p++) for(let h = 0; h < 2; h++){
      const v = S.hands[p][h], mx = S.max[p][h], out = S.outAt[p][h];
      if(!Number.isInteger(v) || v < 0) note('本数が整数でない/負', {deck, v, p, h, why:S.why, msg:S.msg});
      if(v > mx) note('本数が上限を超えた', {deck, v, mx, p, h, hist:S.hist.slice(-4)});
      if(out !== mx + 1) note('outAtとmaxが食い違い', {mx, out, p, h, hist:S.hist.slice(-4)});
      if(mx < 1 || mx > 5) note('上限が範囲外', {mx});
    }
    for(let p = 0; p < 2; p++) for(let h = 0; h < 2; h++){
      const mx = S.max[p][h];
      if((mx === 5) !== !!S.expanded[p][h]) note('拡張の印と上限が食い違い', {mx, exp:S.expanded[p][h], hist:S.hist.slice(-5)});
      if((mx < 4) !== !!(S.shrunk && S.shrunk[p][h])) note('縮小の印と上限が食い違い', {mx, shr:S.shrunk && S.shrunk[p][h], hist:S.hist.slice(-5)});
      if(S.mode === 'deep' && S.hands[p][h] >= S.outAt[p][h]) note('テクニカルで基準以上の本数', {v:S.hands[p][h], out:S.outAt[p][h]});
    }
    if(S.puppet && !S.puppet.armed && S.turn === S.puppet.by) note('操りが自分の番に残っている', {puppet:S.puppet, turn:S.turn, hist:S.hist.slice(-4)});
    if(S.seal && S.seal.some(v => v < 0)) note('封印の残りが負', {seal:S.seal});
    (S.poison || []).forEach(t => { if(!S.over && !t.fresh && S.hands[t.p][t.h] === 0) note('落ちた手に毒が残る', {poison:S.poison, hands:S.hands, hist:S.hist.slice(-4)}); });
    if(S.cards.some(cs => cs.length > 6)) note('手札が多すぎる', {cards:S.cards});
    if(/undefined|NaN|null/.test(S.msg || '')) note('メッセージにundefined等', {msg:S.msg});
    if((S.hist || []).some(x => /undefined|NaN/.test(x.t))) note('履歴にundefined等', {hist:S.hist.slice(-4)});
    if(!S.over && S.hands.some(hs => hs[0] === 0 && hs[1] === 0)) note('両手0なのに決着していない', {deck, hands:S.hands, phase:S.phase, busy:st.busy, hist:S.hist.slice(-4)});
    S.cards.forEach((cs,p) => cs.forEach(id => { if(!run(`!!CARDS[${id}]`)) note('存在しない札', {id}); }));
    if(S.cards.some(cs => new Set(cs).size !== cs.length) && false) note('同じ札を2枚', {cards:S.cards});
    if(S.over){
      ended++;
      // 3局に1回は「最初から」で同じモードのまま続ける
      if(!rematched && rnd() < 0.34){
        rematched = true; run('restart()');
        if(run('S.cards.some(cs=>cs.length!==3)')) note('連戦の配り直しが3枚でない', {cards:run('JSON.stringify(S.cards)')});
        await settle();
        const d2 = run('S.deck');
        if(d2 !== deck) note('連戦でモードが変わった', {deck, d2});
        if(run('S.over')) note('連戦しても決着のまま', {});
        continue;
      }
      break;
    }
    if(st.busy){ if(++stuck > 5){ note('busyのまま止まった', {deck, phase:S.phase, step:S.step, hist:S.hist.slice(-4), msg:S.msg}); break; } continue; }
    stuck = 0;
    // ---- 次の一手を選ぶ ----
    const key = JSON.stringify([S.hands, S.turn, S.phase, S.step, S.cards, S.seq, moves]);
    try{
      if(S.phase === 'defense'){
        const r = S.pending.responder;
        if(cpu && r === 1){ run('cpuTick && 0'); await settle(); const again = run('S.phase'); if(again === 'defense') run('passDefense(true)'); moves++; continue; }
        const defs = S.cards[r].filter(id => run(`CARDS[${id}].timing`) === 'defense' && (id !== 17 || S.pending.damage >= 3));
        if(defs.length && rnd() < 0.6){ const id = pick(defs); cardUses[id] = (cardUses[id]||0)+1; run(`respond(${id})`); }
        else run('passDefense(false)');
      } else if(S.step){
        const stp = S.step;
        if(stp.need === 'number'){
          const n = run(`(()=>{const st=S.step; if(st.id===3){const [tp,th]=st.data.target;return S.max[tp][th]-S.hands[tp][th];} const sh=S.hands[st.who].indexOf(0); return S.max[st.who][sh];})()`);
          run(`stepGotNumber(${1 + Math.floor(rnd() * Math.max(1, n))})`);
        } else {
          const p = stp.need === 'enemyHand' ? 1 - stp.who : stp.who;
          const hs = [0,1].sort(() => rnd() - .5);
          for(const h of hs){ run(`tap(${p},${h})`); await settle(); if(JSON.stringify(run('JSON.stringify(S.step)')) !== JSON.stringify(JSON.stringify(stp))) break; }
          if(run('JSON.stringify(S.step)') === JSON.stringify(stp) && !run('busy')){
            note('カードの入力が進まない', {id:stp.id, need:stp.need, hands:S.hands, max:S.max}); break;
          }
        }
      } else {
        const a = st.actor;
        if(cpu && a === 1){ await settle(); if(run('actor()') === 1 && !run('busy') && run('S.phase') === 'normal' && !run('S.over')){ run('cpuAct()'); } moves++; continue; }
        const t = S.turn, o = 1 - t;
        const opts = [];
        for(let h = 0; h < 2; h++) for(let oh = 0; oh < 2; oh++) if(S.hands[t][h] > 0 && S.hands[o][oh] > 0) opts.push(['atk', h, oh]);
        run('splitOptions()').forEach(([x,y]) => opts.push(['split', x, y]));
        S.cards[t].forEach(id => { if(run(`usable(${id},${t}).ok`)) opts.push(['card', id]); });
        if(!opts.length){ note('打てる手が無い', {hands:S.hands, max:S.max, cards:S.cards, puppet:S.puppet}); break; }
        // 札を使う手をやや多めに
        const cards = opts.filter(o => o[0] === 'card');
        const mv = cards.length && rnd() < 0.45 ? pick(cards) : pick(opts);
        if(mv[0] === 'atk'){ run(`tap(${t},${mv[1]})`); run(`tap(${o},${mv[2]})`); }
        else if(mv[0] === 'split') run(`applySplit(${mv[1]},${mv[2]})`);
        else { cardUses[mv[1]] = (cardUses[mv[1]]||0)+1; run(`useCard(${mv[1]})`); }
      }
    }catch(e){ note('例外: ' + e.message.slice(0,80), {deck, stack:(e.stack||'').split('\n').slice(0,3).join(' | '), hands:S.hands, step:S.step, phase:S.phase}); break; }
    moves++;
    await settle();
    const now = JSON.stringify(run('JSON.stringify([S.hands, S.turn, S.phase, S.step, S.cards, S.seq])'));
    if(now === JSON.stringify(JSON.stringify(JSON.parse(key).slice(0,6)))) { /* 何も変わらない手（不正な手）*/ }
  }
  totalMoves += moves;
}
console.log(`対局 ${N} / 決着 ${ended} / 手数 ${totalMoves}`);
console.log('使った札', Object.entries(cardUses).sort((a,b)=>a[0]-b[0]).map(([k,v])=>`${k}:${v}`).join(' '));
if(!problems.size) console.log('問題なし');
for(const [k, v] of problems) console.log(`\n[${v.count}回] ${k}\n  ${JSON.stringify(v.sample).slice(0, 600)}`);
