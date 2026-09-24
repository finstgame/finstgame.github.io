// Load independently: a missing WebGL context or module must never stop a match.
const host=document.getElementById('arena3d');
const toggle=document.getElementById('view3d');
let arena,enabled=true;
try{enabled=localStorage.getItem('finst_3d')!=='off';}catch{}
function fallback(){
  enabled=false;
  document.body.classList.remove('has-3d');
  if(arena)arena.setActive(false);
  toggle.disabled=true;
  toggle.textContent='2D表示';toggle.setAttribute('aria-pressed','false');
  toggle.title='3D表示を使えないため、通常の盤面を表示しています';
}
function apply(){
  document.body.classList.toggle('has-3d',enabled);
  toggle.textContent=enabled?'3D表示':'2D表示';toggle.setAttribute('aria-pressed',String(enabled));
  toggle.title=enabled?'2D表示に切り替える':'3D表示に切り替える';
  sync();
}
function sync(){
  queueMicrotask(()=>{
    if(!arena)return;
    const hidden=document.getElementById('lobby').classList.contains('open');
    arena.setActive(enabled&&!hidden);
    const view=window.getFinst3DView?.();
    if(view)arena.setView(view);
  });
}
import('./arena3d.js').then(({FinstArena})=>{
  arena=new FinstArena(host,{onPick:(p,h)=>window.finstPick(p,h),onFailure:fallback});
  window.finst3D={
    sync,
    card(id,p,detail){if(enabled)arena.card(id,p,detail);},
    hit(hit){if(enabled)arena.hit(hit);},
    clear(){arena.clearEffects();sync();},
    settle(id){return new Promise(resolve=>setTimeout(resolve,enabled&&!arena.reduced&&id===3?650:0));},
    get enabled(){return enabled;},
    handAt(x,y){return enabled?arena.handAt(x,y):null;},
    stats(){return {effects:arena.effects.length,geometries:arena.renderer.info.memory.geometries,drawCalls:arena.renderer.info.render.calls};}
  };
  toggle.onclick=()=>{enabled=!enabled;try{localStorage.setItem('finst_3d',enabled?'on':'off');}catch{}apply();};
  new MutationObserver(sync).observe(document.getElementById('lobby'),{attributes:true,attributeFilter:['class']});
  apply();
}).catch(error=>{console.warn('3D表示を読み込めませんでした。通常の盤面で続行します。',error);fallback();toggle.disabled=true;});
