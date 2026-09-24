import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

const source=readFileSync(new URL('../feedback.js',import.meta.url),'utf8');
const visitor=randomUUID();

function harness(options={}){
  const sent=[],listeners={};let responder=async()=>({ok:true,status:201});
  const target={addEventListener:(k,f)=>listeners[k]=f,removeEventListener:k=>delete listeners[k]};
  const ctx=vm.createContext({window:{},document:target,
    location:{hostname:options.host??'finstgame.github.io',search:options.search??''},
    URLSearchParams,crypto:{randomUUID},AbortController,Math,Date,JSON,String,Object,Promise,
    setTimeout:()=>1,clearTimeout(){},
    fetch:async(url,init)=>{sent.push({url,init,body:JSON.parse(init.body)});return responder(url,init);}});
  vm.runInContext(source,ctx);
  const F=ctx.window.FinstFeedback;
  let opened=0;
  const api=F.create({url:'https://test.invalid',key:'anon',visitorId:visitor,target,
    getContext:options.getContext??(()=>({screen:'game',play:'cpu',room:'ABC123',board:{hands:[[1,2],[3,4]]}})),
    isInteractive:options.isInteractive,onOpen:()=>opened++});
  // closest を持つ偽の要素。interactive=true ならボタン扱い
  const el=interactive=>({closest:sel=>interactive?{}:null});
  const tap=(x,y,t,interactive=false)=>listeners.pointerdown({isPrimary:true,clientX:x,clientY:y,timeStamp:t,target:el(interactive)});
  return {F,api,sent,tap,opened:()=>opened,respond:fn=>responder=fn,listeners};
}

test('三回すばやく同じあたりを叩くと開く',()=>{
  const t=harness();
  t.tap(100,100,0);t.tap(102,99,200);assert.equal(t.opened(),0);
  t.tap(101,101,400);assert.equal(t.opened(),1);
});

test('遅い・散らばる・ボタンの上は数えない（対戦の操作が誤爆しない）',()=>{
  const slow=harness();slow.tap(100,100,0);slow.tap(100,100,500);slow.tap(100,100,1100);
  assert.equal(slow.opened(),0,'0.6秒を超えたら数え直し');

  const spread=harness();spread.tap(50,300,0);spread.tap(300,300,150);spread.tap(50,300,300);
  assert.equal(spread.opened(),0,'左右の手を行き来する操作では開かない');

  const button=harness();button.tap(100,100,0,true);button.tap(100,100,100,true);button.tap(100,100,200,true);
  assert.equal(button.opened(),0,'ボタン・手・カードの上では開かない');

  const mixed=harness();mixed.tap(100,100,0);mixed.tap(100,100,100,true);mixed.tap(100,100,200);mixed.tap(100,100,300);
  assert.equal(mixed.opened(),0,'途中でボタンを押したら数え直し');
});

test('4回目以降は続けて開かない（開いたら数え直し）',()=>{
  const t=harness();[0,100,200,300,400].forEach(ms=>t.tap(10,10,ms));
  assert.equal(t.opened(),1);
});

test('本文と状況を送る。部屋コードは送らない',async()=>{
  const t=harness();
  const r=await t.api.send('  縮小のあと5でアウトになった  ');
  assert.equal(r.ok,true);
  assert.equal(t.sent.length,1);
  const {url,init,body}=t.sent[0];
  assert.match(url,/\/rest\/v1\/feedback$/);
  assert.equal(init.headers.Prefer,'return=minimal');
  assert.equal(body.message,'縮小のあと5でアウトになった');
  assert.equal(body.visitor_id,visitor);
  assert.equal(body.is_test,false);
  assert.equal(body.context.room,undefined);
  assert.deepEqual(body.context.board.hands,[[1,2],[3,4]]);
  assert.deepEqual(Object.keys(body).sort(),['context','id','is_test','message','visitor_id']);
});

test('空の本文は送らない',async()=>{
  const t=harness();const r=await t.api.send('   \n  ');
  assert.equal(r.ok,false);assert.equal(r.reason,'empty');assert.equal(t.sent.length,0);
});

test('長すぎる本文は切り詰め、大きすぎる盤面は落として本文だけ届ける',async()=>{
  const huge={screen:'game',board:{blob:'x'.repeat(40000)}};
  const t=harness({getContext:()=>huge});
  await t.api.send('あ'.repeat(3000));
  const b=t.sent[0].body;
  assert.equal(b.message.length,2000);
  assert.equal(b.context.board,undefined);
  assert.equal(b.context.board_dropped,true);
  assert.equal(b.context.screen,'game');
});

test('本番以外から送ったものはテスト扱い',async()=>{
  const t=harness({host:'localhost'});await t.api.send('テスト');
  assert.equal(t.sent[0].body.is_test,true);
});

test('通信やサーバーの失敗は例外にせず、理由を返す（文章は呼び出し側に残る）',async()=>{
  const t=harness();
  t.respond(async()=>{throw Error('offline')});
  const r=await t.api.send('a');
  assert.equal(r.ok,false);assert.equal(r.reason,'network');
  t.respond(async()=>({ok:false,status:404}));
  assert.equal((await t.api.send('a')).reason,'not_ready');
  t.respond(async()=>({ok:false,status:500}));
  assert.equal((await t.api.send('a')).reason,'server');
});

test('状況の取得で落ちても本文は送る',async()=>{
  const t=harness({getContext:()=>{throw Error('broken')}});
  const r=await t.api.send('盤面が壊れていても届いてほしい');
  assert.equal(r.ok,true);assert.deepEqual(t.sent[0].body.context,{});
});

test('3D盤のクリスタル（要素では分からない押せる物）の上では開かない',()=>{
  // 画面の(100,100)にクリスタルがある、という3D盤の答えを模す
  const onCrystal=e=>Math.hypot(e.clientX-100,e.clientY-100)<30;
  const t=harness({isInteractive:onCrystal});
  t.tap(100,100,0);t.tap(100,100,100);t.tap(100,100,200);
  assert.equal(t.opened(),0,'同じクリスタルを連打しても開かない');
  t.tap(300,300,300);t.tap(300,300,400);t.tap(300,300,500);
  assert.equal(t.opened(),1,'何も無い所なら開く');
});

test('押せる物の判定が壊れていても、タップの処理は止まらない',()=>{
  const t=harness({isInteractive:()=>{throw Error('webgl lost')}});
  t.tap(10,10,0);t.tap(10,10,100);t.tap(10,10,200);
  assert.equal(t.opened(),1);
});
