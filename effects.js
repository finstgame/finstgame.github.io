const cards=[
 [1,'反転','両陣営に渦が立ち、交差する光で指が入れ替わる。'],
 [2,'シールド','半球の結界が立ち上がり、足もとに波紋が広がる。'],
 [3,'隕石','落下地点に影が広がり、着弾の衝撃波と破片が盤を揺らす。'],
 [4,'召喚','空から光の柱が降り、魔法陣から力が立ち上がる。'],
 [5,'拡張','金の輪が三重に広がり、手の上限を押し広げる。'],
 [6,'倍返指','赤い力が手に吸い込まれて溜まり、2倍で撃ち出す。'],
 [7,'カウンター','結界で受け止めて砕き、その力を攻撃元へ弾き返す。'],
 [8,'ダブル','両手に同時に力が溜まり、それぞれ別の手を撃つ。'],
 [9,'ヒール','やわらかな光の柱の中を、回復の泡が昇っていく。'],
 [10,'コピー','相手の両手を走査して、自分の側へ写し取る。'],
 [11,'縮小','大きな輪が外から締まり、手に食い込んで弾ける。'],
 [12,'封印','相手の両手に鎖が巻きつき、錠が落ちる。'],
 [13,'透視','相手の陣の上に大きな目が開き、見回す。'],
 [14,'略奪','相手の手に渦ができ、カードが1枚こちらへ飛んでくる。'],
 [15,'ポイズン','毒の泡が湧き、刺さった手をむしばむ。'],
 [16,'なまけもの','雲とZが漂うだけ。何もせずに番を終える。'],
 [17,'鉄壁','地面から石の壁がせり上がり、攻撃を受け止める。'],
 [18,'巻き戻し','大きな時計が逆回りし、光が手もとへ戻っていく。']
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
