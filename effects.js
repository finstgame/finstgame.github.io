const cards=[
 [1,'反転','両者の指を、交差する魔力が結ぶ。'],
 [2,'シールド','攻撃を受ける手を、青い半球の結界が覆う。'],
 [3,'隕石','自分の台座に隕石が降り、衝撃とともに指に力が宿る。'],
 [4,'召喚','緑の魔法陣から光の粒が立ち上がる。'],
 [5,'拡張','金色の魔法陣が広がり、指の上限を解放する。'],
 [6,'倍返指','赤い魔力をため、2倍の力を相手の手に放つ。'],
 [7,'カウンター','結界で受け止めた力が弧を描き、攻撃元へ戻る。'],
 [8,'ダブル','両手に力をため、それぞれ別の手へ攻撃する。'],
 [9,'ヒール','回復先に選んだ手から、緑の光が立ち上がる。'],
 [10,'コピー','相手の両手から、自分の両手へ光を写し取る。'],
 [11,'縮小','相手の手を囲む紫の輪が、内側へ締まる。'],
 [12,'封印','相手の台座を、幾重もの魔法の輪が封じる。'],
 [13,'透視','青い走査の輪が、相手の側を照らす。'],
 [14,'略奪','相手側から自分側へ、紫の光を引き寄せる。'],
 [15,'ポイズン','緑の魔力を帯びた攻撃が、相手の手へ走る。'],
 [16,'なまけもの','淡い光がゆっくり沈み、そのまま番を終える。'],
 [17,'鉄壁','硬い多面体の障壁が、攻撃を防ぐ。'],
 [18,'巻き戻し','逆回転する魔法陣に、光の粒が戻っていく。']
];
let selected=3,arena,timers=[];
const root=document.getElementById('effect-cards');
for(const [id,name] of cards){const b=document.createElement('button');b.className='effect-card';b.dataset.id=id;b.setAttribute('aria-pressed',String(id===selected));b.innerHTML=`<small>${String(id).padStart(2,'0')}</small>${name}`;b.onclick=()=>play(id);root.append(b);}
function play(id){
 selected=id;timers.forEach(clearTimeout);timers=[];
 const card=cards.find(c=>c[0]===id);
 document.getElementById('effect-name').textContent=card[1];document.getElementById('effect-desc').textContent=card[2];
 root.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.id===id)));
 if(!arena)return;
 arena.clearEffects();arena.card(id,0,{h:0,from:0,to:1});
 const hit=(h,dh,kind)=>arena.hit({p:0,h,dp:1,dh,kind,out:false});
 if(id===6||id===15)timers.push(setTimeout(()=>hit(0,1,id===6?'twice':'poison'),350));
 if(id===8){timers.push(setTimeout(()=>hit(0,1,'double'),300));timers.push(setTimeout(()=>hit(1,0,'double'),750));}
}
document.getElementById('replay').onclick=()=>play(selected);
import('./arena3d.js').then(({FinstArena})=>{
 arena=new FinstArena(document.getElementById('arena3d'),{onFailure:()=>document.getElementById('error').textContent='3D表示が停止しました。ページを再読み込みしてください。'});
 arena.setView({hands:[[3,2],[2,4]],max:[[4,4],[4,4]],bottom:0,names:['自分','相手'],turn:0,disabled:true});
 window.galleryArena=arena;play(selected);
}).catch(()=>{document.getElementById('error').textContent='この環境では3D表示を開始できません。対戦画面では2D表示で遊べます。';});
