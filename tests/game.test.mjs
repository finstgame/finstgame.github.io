import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {FinstArena} from '../arena3d.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/\nboot\(\);\s*$/,'');
function harness(){
 const elements=new Map();
 const el=()=>({classList:{add(){},remove(){},contains(){return false},toggle(){}},style:{setProperty(){}},dataset:{},innerHTML:'',textContent:'',tabIndex:0,offsetWidth:10,
  querySelector(){return el()},querySelectorAll(){return []},appendChild(){},remove(){},setAttribute(){},addEventListener(){},scrollIntoView(){},getBoundingClientRect(){return {left:0,top:0,width:100,height:100}}});
 const doc={title:'Finst',hidden:false,documentElement:el(),body:el(),getElementById(id){if(!elements.has(id))elements.set(id,el());return elements.get(id)},querySelector:()=>el(),querySelectorAll:()=>[],createElement:()=>el(),addEventListener(){}};
 const cardEvents=[],hitEvents=[];
 const sandbox={document:doc,window:{matchMedia:()=>({matches:true}),addEventListener(){},finst3D:{enabled:true,sync(){},clear(){},card:(...a)=>cardEvents.push(a),hit:e=>hitEvents.push(e),settle:()=>Promise.resolve()}},navigator:{},localStorage:{getItem:()=>null,setItem(){}},location:{hash:'',search:''},URLSearchParams,console,Date,Math,Promise,crypto:{randomUUID:()=> 'test-client'},setTimeout:(fn,ms)=>{if(ms<1000)Promise.resolve().then(fn);return 1},clearTimeout(){},setInterval:()=>1,clearInterval(){}};
 const ctx=vm.createContext(sandbox);vm.runInContext(inline,ctx);
 vm.runInContext('S=newState(); S.turn=0; S.cpu=false; render=()=>{}; showPass=()=>{}; cpuTick=()=>{}; showWin=()=>{}; say=()=>{};',ctx);
 const run=code=>vm.runInContext(code,ctx);
 const state=()=>JSON.parse(run('JSON.stringify(S)'));
 const drain=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
 return {run,state,drain,cardEvents,hitEvents};
}
test('normal attack preserves quick/deep rules and emits the actual target',async()=>{
 const t=harness();t.run('S.hands=[[3,1],[3,1]]; S.cards=[[],[]]; declareAttack({from:0,fromHand:0,to:1,toHand:0,damage:3,kind:"touch"});');await t.drain();
 assert.equal(t.state().hands[1][0],0);assert.equal(t.hitEvents[0].dh,0);assert.equal(t.hitEvents[0].dmg,3);
 const d=harness();d.run('S.mode="deep";S.hands=[[3,1],[3,1]];S.cards=[[],[]];declareAttack({from:0,fromHand:0,to:1,toHand:0,damage:3,kind:"touch"});');await d.drain();assert.equal(d.state().hands[1][0],1);
});
test('meteor increases the chosen own hand, consumes once, and names that hand for 3D',async()=>{
 const t=harness();t.run('S.cards=[[3],[]];useCard(3);stepGotHand(0,1);stepGotNumber(2);');await t.drain();
 assert.deepEqual(t.state().hands,[[1,3],[1,1]]);assert.deepEqual(t.state().used[0],[3]);assert.equal(t.state().turn,1);assert.equal(t.cardEvents[0][0],3);assert.equal(t.cardEvents[0][2].h,1);
});
test('counter reflection returns to the attacking hand and preserves damage',async()=>{
 const t=harness();t.run('S.cards=[[],[7]];S.hands=[[1,2],[1,1]]; S.phase="defense";S.pending={from:0,fromHand:1,to:1,toHand:0,responder:1,damage:2,kind:"touch",modifiers:[]};respond(7);');await t.drain();
 assert.deepEqual(t.state().hands,[[1,4],[1,1]]);assert.equal(t.cardEvents[0][0],7);assert.equal(t.cardEvents[0][2].h,0);assert.equal(t.cardEvents[0][2].to,1);
});
test('heal animation and remote metadata follow the chosen hand, including an OUT hand',async()=>{
 const t=harness();t.run('S.cards=[[],[9]];S.hands=[[2,1],[2,0]];S.phase="defense";S.pending={from:0,fromHand:0,to:1,toHand:0,responder:1,damage:2,kind:"touch",modifiers:[]};respond(9);stepGotHand(1,1);');await t.drain();
 assert.deepEqual(t.state().hands,[[2,1],[2,2]]);assert.equal(t.cardEvents[0][2].stage,'block');assert.equal(t.cardEvents[1][2].h,1);assert.deepEqual(t.state().play.detail,{h:1,stage:'heal'});
});
test('human cannot operate the CPU turn but the CPU uses the original engine',()=>{
 const t=harness();t.run('S.cpu=true;S.turn=1;S.sel=null;humanTap(1,0);');assert.equal(t.run('S.sel'),null);
 t.run('tap(1,0)');assert.equal(t.run('S.sel[0]'),1);
});
test('repeated remote snapshots do not replay the same 3D impact',async()=>{
 const t=harness();t.run('S.hit={n:"unique",p:0,h:0,dp:1,dh:1,dmg:1};animateDiff(S.hands);animateDiff(S.hands);');await t.drain();assert.equal(t.hitEvents.length,1);
});
test('all 20 cards have a 3D presentation without mutating their input',()=>{
 const a=Object.create(FinstArena.prototype),events=[];
 // Every presentation primitive counts; positions are stubbed because this arena has no hands.
 for(const method of ['magic','meteor','shield','beam','burst','shockwave','pillar','vortex','shatter','implode','chains','clock','eye','wall','bubbles','sleepy','cardShard','flash','later','shake'])a[method]=(...args)=>events.push([method,...args]);
 a.point=a.side=()=>({});
 for(let id=1;id<=20;id++){const before=events.length;const detail=Object.freeze({h:1,from:1,to:0});a.card(id,0,detail);assert.ok(events.length>before,`card ${id}`);}
});
test('impact-created child effects survive the frame and are later disposed',()=>{
 const a=Object.create(FinstArena.prototype);let disposed=0;
 a.removeEffect=()=>disposed++;
 const child={group:{},age:0,duration:1,update(){}};
 a.effects=[{group:{},age:0,duration:.01,update(){a.effects.push(child)}}];
 a.updateEffects(.02);assert.equal(a.effects.length,1);assert.equal(a.effects[0],child);assert.equal(disposed,1);
 a.updateEffects(2);assert.equal(a.effects.length,0);assert.equal(disposed,2);
});
test('offline shell includes every locally imported 3D dependency',()=>{
 const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 for(const file of ['arena3d.js','game3d.js','arena3d.css','effects.html','effects.js','assets/vendor/three.module.min.js','assets/vendor/three.core.min.js']){
  assert.ok(sw.includes(`"./${file}"`),file);assert.ok(readFileSync(new URL('../'+file,import.meta.url)).length>0);
 }
});
test('a new impact remains distinct after a card clears the previous hit',async()=>{
 const t=harness();t.run('S.cards=[[],[]];declareAttack({from:0,fromHand:0,to:1,toHand:0,damage:1,kind:"touch"});');await t.drain();const first=t.state().hit.n;
 t.run('S.hit=null;S.turn=0;busy=false;S.phase="normal";S.cards=[[],[]];declareAttack({from:0,fromHand:0,to:1,toHand:1,damage:1,kind:"touch"});');await t.drain();assert.notEqual(t.state().hit.n,first);
});
test('presentation state flips correctly for the second online seat',()=>{
 const t=harness();t.run('online=true;seat=1;S.turn=1;');assert.equal(t.run('window.getFinst3DView().bottom'),1);
 t.run('online=false;S.cpu=true;');assert.equal(t.run('window.getFinst3DView().bottom'),0);
});
test('all 3D geometries animate and dispose cleanly, including meteor child effects',async()=>{
 const THREE=await import('../assets/vendor/three.module.min.js');
 const oldDocument=globalThis.document;globalThis.document={hidden:false};
 try{
  for(const reduced of [false,true]){
   const a=Object.create(FinstArena.prototype);a.scene=new THREE.Scene();a.world=a.scene;a.active=true;a.effects=[];a.reduced=reduced;a.draw=()=>{};
   a.handNodes=[0,1].map(p=>[0,1].map(h=>({root:{position:new THREE.Vector3(h?2:-2,0,p?-2:2)}})));
   for(let id=1;id<=20;id++){
    a.card(id,0,{h:1,from:1,to:0});
    for(let frame=0;frame<60;frame++)a.updateEffects(.05);
    assert.equal(a.effects.length,0,`card ${id}, reduced ${reduced}`);assert.equal(a.scene.children.length,0);
   }
   a.hit({p:0,h:1,dp:1,dh:0,dmg:3,kind:'twice',out:true});
   for(let frame=0;frame<60;frame++)a.updateEffects(.05);
   assert.equal(a.scene.children.length,0);
  }
 }finally{globalThis.document=oldDocument;}
});
test('visiting the effects gallery preserves the offline game document',async()=>{
 const listeners={};const stored=new Map([['./index.html',new Response('game')]]);
 const key=req=>typeof req==='string'?req:new URL(req.url).pathname;
 const cache={put:async(k,v)=>stored.set(key(k),v),match:async k=>stored.get(key(k))?.clone()};
 const ctx=vm.createContext({URL,Response,self:{location:{origin:'https://finstgame.github.io',hostname:'finstgame.github.io'},addEventListener:(name,fn)=>listeners[name]=fn},caches:{open:async()=>cache},fetch:async()=>new Response('gallery')});
 vm.runInContext(readFileSync(new URL('../sw.js',import.meta.url),'utf8'),ctx);
 const navigate=async path=>{let response;listeners.fetch({request:{method:'GET',mode:'navigate',url:'https://finstgame.github.io'+path},respondWith:p=>response=p});return response;};
 assert.equal(await (await navigate('/effects.html')).text(),'gallery');
 ctx.fetch=async()=>{throw new Error('offline')};
 assert.equal(await (await navigate('/')).text(),'game');
 assert.equal(await (await navigate('/effects.html')).text(),'gallery');
});
test('crystal clusters preserve counts 0–5 and opponent labels follow either viewing seat',async()=>{
 const THREE=await import('../assets/vendor/three.module.min.js');const oldDocument=globalThis.document;
 globalThis.document={createElement:()=>({style:{setProperty(){}},dataset:{},addEventListener(){},setAttribute(){}})};
 try{
  const a=Object.create(FinstArena.prototype);a.world=new THREE.Group();a.targets=[];a.labelHost={append(){}};a.draw=()=>{};a.onPick=()=>{};a.makeHands();
  for(const bottom of [0,1])for(let count=0;count<=5;count++){
   a.setView({hands:[[count,count],[count,count]],max:[[5,5],[5,5]],bottom,names:['A','B'],turn:0});
   for(let p=0;p<2;p++)for(const n of a.handNodes[p]){
    assert.equal(n.relic.visible,count>0);
    assert.equal(n.crystals.filter(c=>c.visible).length,count);
    const visible=n.crystals.filter(c=>c.visible);
    assert.equal(new Set(visible.map(c=>c.position.toArray().join(','))).size,count);
    for(const crystal of n.crystals){
     assert.ok(crystal.position.toArray().every(Number.isFinite));
     assert.ok(crystal.position.y>.8);
    }
    assert.ok(n.runes.children.length>0);
    assert.equal(n.button.dataset.side,p===bottom?'near':'far');
   }
  }
  a.world.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
 }finally{globalThis.document=oldDocument;}
});
test('update 2.0: an empty hand is dealt one random card from the current deck at the start of that turn',async()=>{
 const t=harness();t.run('S.deck="easy";S.cards=[[],[]];S.hands=[[1,1],[1,1]];declareAttack({from:0,fromHand:0,to:1,toHand:0,damage:1,kind:"touch"});');await t.drain();
 const s=t.state();assert.equal(s.turn,1);assert.equal(s.cards[1].length,1);assert.ok(t.run('DECKS.easy.ids').includes(s.cards[1][0]));
 assert.equal(s.cards[0].length,0,'only the player whose turn starts is dealt');
 assert.ok(!/「/.test(s.msg),'the shared message does not reveal the dealt card');
});
test('update 2.0: modes are easy 10 / hard 20 quick, technical 20 deep',()=>{
 const t=harness();
 assert.equal(t.run('deckIds("easy").length'),10);assert.equal(t.run('deckIds("hard").length'),20);assert.equal(t.run('deckIds("tech").length'),20);
 assert.equal(t.run('DECKS.easy.rule'),'quick');assert.equal(t.run('DECKS.hard.rule'),'quick');assert.equal(t.run('DECKS.tech.rule'),'deep');
 assert.equal(t.run('RATING_ON'),false);
});
test('update 2.0: puppet hands the opponent turn to the user, hides and blocks their cards, then returns',async()=>{
 const t=harness();t.run('S.cards=[[19],[2,3]];S.hands=[[1,1],[2,1]];useCard(19);');await t.drain();
 let s=t.state();assert.equal(s.turn,1);assert.deepEqual(s.puppet,{by:0,armed:false});
 assert.equal(t.run('actor()'),0);assert.equal(t.run('usable(3,1).ok'),false);
 assert.equal(t.run('enterDefense.toString().includes("puppetOn")'),true);
 // 操作している側が、相手の手で自分の手を叩く
 t.run('tap(1,0);tap(0,0);');await t.drain();
 s=t.state();assert.equal(s.hands[0][0],3);assert.equal(s.turn,0);assert.equal(s.puppet,null);assert.equal(t.run('actor()'),0);
});
test('update 2.0: the CPU never moves while the human is puppeting its turn',()=>{
 const t=harness();t.run('S.cpu=true;S.turn=1;S.puppet={by:0,armed:false};S.sel=null;humanTap(1,0);');assert.equal(t.run('JSON.stringify(S.sel)'),'[1,0]');
 t.run('S.puppet={by:1,armed:false};S.turn=0;S.sel=null;humanTap(0,0);');assert.equal(t.run('S.sel'),null);
});
test('update 2.0: world end leaves exactly one hand with one finger on one side',async()=>{
 for(let i=0;i<12;i++){
  const t=harness();t.run('S.cards=[[20],[]];S.hands=[[3,4],[2,2]];useCard(20);');await t.drain();
  const s=t.state(),d=t.cardEvents[0][2];assert.equal(t.cardEvents[0][0],20);
  assert.deepEqual(s.hands[d.tp],d.th===0?[1,0]:[0,1]);assert.deepEqual(s.hands[1-d.tp],d.tp===0?[2,2]:[3,4]);assert.equal(s.turn,1);
 }
});
test('update 2.0: the CPU can use puppet and world end, and drives the human hands while puppeting',async()=>{
 for(let i=0;i<6;i++){
  const t=harness();t.run('S.cpu=true;S.turn=1;S.cards=[[],[19,20]];S.hands=[[2,3],[1,1]];busy=false;cpuAct();');await t.drain();
  const s=t.state();assert.ok(s.turn===0||s.used[1].length>0||s.sel,'CPU acted');
 }
 const t=harness();t.run('S.cpu=true;S.turn=0;S.puppet={by:1,armed:false};S.cards=[[3],[]];S.hands=[[4,1],[1,1]];busy=false;cpuAct();');await t.drain();
 const s=t.state();assert.ok(s.turn===1||/プレイヤー1のタッチ/.test(s.msg),'CPU moves the human side');assert.ok(!/プレイヤー2の(左|右)手へ/.test(s.msg)||!/4ダメージ/.test(s.msg),'does not make the human knock out a CPU hand on a tie');assert.deepEqual(s.used[0],[],'puppeted cards stay unused');
});
test('skins: CPU wins unlock pieces, each seat shows its own skin, and a match counts once',()=>{
 const t=harness();
 t.run('globalThis.__s=new Map();localStorage.getItem=k=>globalThis.__s.get(k)??null;localStorage.setItem=(k,v)=>globalThis.__s.set(k,String(v));');
 assert.equal(t.run('mySkin()'),'standard');
 t.run('localStorage.setItem("finst_skin","flame")');assert.equal(t.run('mySkin()'),'standard','locked skin falls back');
 t.run('S.cpu=true;online=false;localStorage.setItem("finst_cpu_wins","2");');
 assert.equal(t.run('countCpuWin(0).map(k=>k.id).join()'),'flame','the 3rd win unlocks flame');
 assert.equal(t.run('countCpuWin(0).length'),0);assert.equal(t.run('cpuWins()'),3,'the same match is counted once');
 t.run('S.counted=false');assert.equal(t.run('countCpuWin(1).length'),0);assert.equal(t.run('cpuWins()'),3,'a CPU win is not counted');
 assert.equal(t.run('mySkin()'),'flame');
 assert.equal(t.run('JSON.stringify(window.getFinst3DView().skins)'),'["flame","standard"]');
 t.run('online=true;seat=1;S.skins=["star","standard"];');
 assert.equal(t.run('JSON.stringify(window.getFinst3DView().skins)'),'["star","flame"]');
 assert.ok(t.run('SYNC.includes("skins")'));
});
test('skins: every piece shape builds, re-skins, and disposes cleanly',async()=>{
 const THREE=await import('../assets/vendor/three.module.min.js');
 const {PIECE_IDS}=await import('../arena3d.js');
 const oldDocument=globalThis.document;globalThis.document={hidden:false,createElement:()=>({className:'',style:{setProperty(){}},dataset:{},addEventListener(){},setAttribute(){}})};
 try{
  const a=Object.create(FinstArena.prototype);a.world=new THREE.Group();a.targets=[];a.labelHost={append(){}};a.draw=()=>{};a.onPick=()=>{};a.makeHands();
  for(const id of PIECE_IDS){
   a.setView({hands:[[3,1],[2,4]],max:[[4,4],[4,4]],bottom:0,names:['A','B'],turn:0,skins:[id,'standard']});
   const n=a.handNodes[0][0];assert.equal(n.skin,id);assert.equal(n.crystals.length,5);assert.equal(n.crystals.filter(c=>c.visible).length,3);
   for(const c of n.crystals)c.traverse(o=>{if(o.geometry){o.geometry.computeBoundingBox();assert.ok(Number.isFinite(o.geometry.boundingBox.max.x),id);}});
   assert.equal(a.handNodes[1][0].skin,'standard');
  }
  a.setView({hands:[[1,1],[1,1]],max:[[4,4],[4,4]],bottom:0,names:['A','B'],turn:0,skins:['nope','standard']});
  assert.equal(a.handNodes[0][0].skin,'standard','unknown skin falls back');
 }finally{globalThis.document=oldDocument;}
});
