// オンライン対戦を2台ぶん仮想的につないで回し、2台の盤がずれないかを探す。
//   node tests/fuzz-online.mjs [対局数] [種]
// 書き込みは相手に遅れて届く（ふだん0.05〜0.8秒、ときどき4秒）。届く順番は保つ。
// 防御側はときどき応答しない（攻撃側の見張りが肩代わりする）。
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html = readFileSync(process.env.FINST_HTML || new URL('../index.html', import.meta.url), 'utf8');
const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/\nboot\(\);\s*$/, '');
const SYNCKEYS = vm.runInNewContext(html.match(/const SYNC = (\[[^\]]*\]);/)[1]);

const N = +process.argv[2] || 100, SEED = +process.argv[3] || 1;
const problems = new Map();
const note = (kind, detail) => { if(!problems.has(kind)) problems.set(kind, {count:0, sample:detail}); problems.get(kind).count++; };

let vt = 1_800_000_000_000, tid = 0;
const timers = [];
const RealDate = Date;
class VDate extends RealDate { constructor(...a){ a.length ? super(...a) : super(vt); } static now(){ return vt; } }
const flush = async () => { for(let i = 0; i < 40; i++) await Promise.resolve(); };
async function settle(limit = 600){
  await flush();
  for(let n = 0; n < limit && timers.length; n++){
    timers.sort((a,b) => a.at - b.at || a.id - b.id);
    const t = timers.shift(); vt = Math.max(vt, t.at);
    t.fn(); await flush();
  }
}

function client(seed, seat, deliver){
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const el = () => ({classList:{add(){},remove(){},contains(){return false},toggle(){}},style:{setProperty(){}},dataset:{},innerHTML:'',textContent:'',tabIndex:0,offsetWidth:10,
    querySelector(){return el()},querySelectorAll(){return []},appendChild(){},remove(){},setAttribute(){},addEventListener(){},scrollIntoView(){},focus(){},getBoundingClientRect(){return {left:0,top:0,width:100,height:100}}});
  const elements = new Map();
  const doc = {title:'Finst',hidden:false,visibilityState:'visible',documentElement:el(),body:el(),getElementById(id){if(!elements.has(id))elements.set(id,el());return elements.get(id)},querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>el(),addEventListener(){}};
  const sb = {rpc:()=>Promise.resolve({data:0}), channel:()=>({on(){return this},subscribe(){return this},track(){},untrack(){}}), removeChannel(){}, from:()=>({update:o=>({eq:()=>{ deliver(JSON.parse(JSON.stringify(o.state))); return Promise.resolve({}); }})})};
  const sandbox = {document:doc, window:{matchMedia:()=>({matches:true}),addEventListener(){},finst3D:{enabled:false,sync(){},clear(){},card(){},hit(){},settle:()=>Promise.resolve()}},
    navigator:{}, localStorage:{getItem:()=>null,setItem(){}}, location:{hash:'',search:''}, URLSearchParams, console, Date:VDate,
    Math:Object.assign(Object.create(Math),{random:rnd}), Promise, crypto:{randomUUID:()=> 'c'+seat},
    setTimeout:(fn,ms=0)=>{const id=++tid;timers.push({id,at:vt+(ms||0),fn});return id;},
    clearTimeout:id=>{const i=timers.findIndex(t=>t.id===id);if(i>=0)timers.splice(i,1);},
    setInterval:()=>0, clearInterval(){}, alert(){}, __sb:sb};
  const ctx = vm.createContext(sandbox);
  vm.runInContext(inline, ctx);
  vm.runInContext(`render=()=>{}; showPass=()=>{}; showWin=()=>{}; say=()=>{}; buzz=()=>{}; renderGone=()=>{}; readPresence=()=>{};
    sb=__sb; online=true; room="R"; seat=${seat};`, ctx);
  const run = code => vm.runInContext(code, ctx);
  return {run, rnd, seat};
}

let ended = 0, totalMoves = 0;
for(let g = 0; g < N; g++){
  timers.length = 0;
  const queues = [[], []];          // それぞれの端末へ届く順番
  const lastAt = [0, 0];
  let A, B;
  const deliverTo = to => snap => {
    const r = Math.random();
    const delay = r < .08 ? (+process.env.FUZZ_LONG || 4000) : 50 + Math.floor(Math.random() * 750);
    const at = Math.max(vt + delay, lastAt[to] + 1);   // 順番は保つ
    lastAt[to] = at;
    const target = to === 0 ? () => A : () => B;
    timers.push({id:++tid, at, fn:() => target().run(`applyRemote(${JSON.stringify(snap)})`)});
  };
  A = client(SEED * 7919 + g * 2, 0, deliverTo(1));
  B = client(SEED * 7919 + g * 2 + 1, 1, deliverTo(0));
  const rnd = A.rnd, pick = a => a[Math.floor(rnd() * a.length)];
  const deck = pick(['easy','hard','tech']);
  for(const c of [A, B]) c.run(`deckMode = ${JSON.stringify(deck)}; ruleMode = DECKS[deckMode].rule;`);
  A.run(`S = newState(${JSON.stringify(deck)}); S.seq = 1;`);
  B.run(`S = ${A.run('JSON.stringify(S)')}; S.seq = 1;`);
  let moves = 0, idle = 0, rematched = false;
  while(moves < 250){
    await settle();
    const st = [A, B].map(c => JSON.parse(c.run('JSON.stringify({S, busy, me: actor() === seat && myTurn(), resp: iRespond(), step: S.step})')));
    // ---- 2台の盤がそろっているか（届くものが全部届いたあと）----
    const diff = SYNCKEYS.filter(k => k !== 'skins' && JSON.stringify(st[0].S[k]) !== JSON.stringify(st[1].S[k]));
    if(diff.length && !st[0].busy && !st[1].busy && !st[0].step && !st[1].step){
      note('2台の盤がずれた', {deck, keys:diff, a:{seq:st[0].S.seq, hands:st[0].S.hands, turn:st[0].S.turn, phase:st[0].S.phase}, b:{seq:st[1].S.seq, hands:st[1].S.hands, turn:st[1].S.turn, phase:st[1].S.phase}, histA:(st[0].S.hist||[]).slice(-3), histB:(st[1].S.hist||[]).slice(-3)});
      break;
    }
    const S0 = st[0].S;
    if(S0.over && st[1].S.over){
      ended++;
      if(!rematched && rnd() < .5){
        rematched = true;
        // 片方だけ、または2人ほぼ同時に「もう一戦」
        if(rnd() < .5) A.run('restart()'); else { A.run('restart()'); B.run('restart()'); }
        continue;
      }
      break;
    }
    // ---- 動ける端末を選ぶ ----
    const actors = [A, B].filter((c,i) => !st[i].busy && !st[i].S.over && (
      (st[i].S.phase === 'defense' && st[i].resp) ||
      (st[i].step && st[i].step.who === c.seat) ||
      (st[i].S.phase === 'normal' && !st[i].step && st[i].me)));
    if(!actors.length){
      if(++idle > 3){
        // 締切を過ぎるまで時間を進めて、見張りに任せる
        vt += 30000; await settle();
        if(++idle > 8){ note('どちらも動けない', {deck, a:{phase:S0.phase, turn:S0.turn, seq:S0.seq, busy:st[0].busy, puppet:S0.puppet}, b:{phase:st[1].S.phase, turn:st[1].S.turn, seq:st[1].S.seq, busy:st[1].busy}}); break; }
      }
      continue;
    }
    idle = 0;
    const c = pick(actors), i = c.seat, S = st[i].S;
    try{
      if(S.phase === 'defense'){
        if(rnd() < .15){ vt += 30000; moves++; continue; }        // 応答しない（見張りが肩代わり）
        const r = S.pending.responder;
        const defs = S.cards[r].filter(id => c.run(`CARDS[${id}].timing`) === 'defense' && (id !== 17 || S.pending.damage >= 3));
        if(defs.length && rnd() < .6) c.run(`respond(${pick(defs)})`); else c.run('passDefense(false)');
      } else if(st[i].step){
        const stp = st[i].step;
        if(stp.need === 'number'){
          const n = c.run(`(()=>{const st=S.step; if(st.id===3){const [tp,th]=st.data.target;return S.max[tp][th]-S.hands[tp][th];} const sh=S.hands[st.who].indexOf(0); return S.max[st.who][sh];})()`);
          c.run(`stepGotNumber(${1 + Math.floor(rnd() * Math.max(1, n))})`);
        } else {
          const p = stp.need === 'enemyHand' ? 1 - stp.who : stp.who;
          for(const h of [0,1].sort(() => rnd() - .5)){ c.run(`tap(${p},${h})`); await settle(); if(c.run('JSON.stringify(S.step)') !== JSON.stringify(stp)) break; }
        }
      } else {
        const t = S.turn, o = 1 - t, opts = [];
        for(let h = 0; h < 2; h++) for(let oh = 0; oh < 2; oh++) if(S.hands[t][h] > 0 && S.hands[o][oh] > 0) opts.push(['atk', h, oh]);
        c.run('splitOptions()').forEach(([x,y]) => opts.push(['split', x, y]));
        S.cards[t].forEach(id => { if(c.run(`usable(${id},${t}).ok`)) opts.push(['card', id]); });
        const cards = opts.filter(o => o[0] === 'card');
        const mv = cards.length && rnd() < .45 ? pick(cards) : pick(opts);
        if(mv[0] === 'atk'){ c.run(`tap(${t},${mv[1]})`); c.run(`tap(${o},${mv[2]})`); }
        else if(mv[0] === 'split') c.run(`applySplit(${mv[1]},${mv[2]})`);
        else c.run(`useCard(${mv[1]})`);
      }
    }catch(e){ note('例外: ' + e.message.slice(0, 80), {deck, stack:(e.stack||'').split('\n').slice(0,3).join(' | ')}); break; }
    moves++;
  }
  totalMoves += moves;
}
console.log(`対局 ${N} / 決着 ${ended} / 手数 ${totalMoves}`);
if(!problems.size) console.log('問題なし');
for(const [k, v] of problems) console.log(`\n[${v.count}回] ${k}\n  ${JSON.stringify(v.sample).slice(0, 900)}`);
