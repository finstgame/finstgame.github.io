import * as THREE from './assets/vendor/three.module.min.js';

const TAU = Math.PI * 2;
const COLORS = [0x33d9be, 0xff5f7e];
const vector = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const ease = t => 1 - Math.pow(1-t,3);
const glowMat = (color, opacity=1) => new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,side:THREE.DoubleSide});
const stoneMat = color => new THREE.MeshStandardMaterial({color,roughness:.82,metalness:.25,flatShading:true});
// Additive glow: overlapping particles brighten instead of stacking into flat colour.
const addMat = (color, opacity=1) => new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending});
const easeOutBack = t => 1 + 2.7*Math.pow(t-1,3) + 1.7*Math.pow(t-1,2);

/** Presentation only. Game state and turn deadlines remain owned by the game. */
export class FinstArena {
  constructor(host, {onPick=()=>{}, onFailure=()=>{}}={}) {
    this.host=host; this.onPick=onPick; this.onFailure=onFailure;
    this.effects=[]; this.targets=[]; this.active=true; this.time=0; this.last=0; this.reduced=false;
    this.motion=matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced=this.motion.matches;
    this.motionListener=()=>{this.reduced=this.motion.matches; this.clearEffects(); this.draw();};
    this.motion.addEventListener('change',this.motionListener);
    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x09131e);
    this.scene.fog=new THREE.FogExp2(0x09131e,.035);
    this.camera=new THREE.PerspectiveCamera(43,1,.1,100);
    this.camera.position.set(0,11.5,13.5); this.camera.lookAt(0,.2,0);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.35;
    this.renderer.domElement.setAttribute('aria-hidden','true');
    host.prepend(this.renderer.domElement);
    this.lost=e=>{e.preventDefault(); this.setActive(false); this.onFailure();};
    this.renderer.domElement.addEventListener('webglcontextlost',this.lost);
    this.scene.add(new THREE.HemisphereLight(0xb2d5e7,0x132030,3));
    const sun=new THREE.DirectionalLight(0xffdec0,4); sun.position.set(-5,9,4);this.scene.add(sun);
    const rim=new THREE.DirectionalLight(0x77c9ff,3);rim.position.set(4,5,-7);this.scene.add(rim);
    // One permanent light for card effects. Adding/removing lights recompiles every material and stutters.
    this.fxLight=new THREE.PointLight(0xffffff,0,16,1.4);this.fxLight.position.set(0,2,0);this.scene.add(this.fxLight);
    this.shakeAge=0;this.shakeDur=0;this.shakePower=0;
    // A screen-space glow over the canvas sells the impact far more than scene lighting alone.
    this.flashEl=document.createElement('div');this.flashEl.className='arena-flash';this.flashEl.setAttribute('aria-hidden','true');host.append(this.flashEl);
    this.world=new THREE.Group();this.scene.add(this.world);
    this.buildWorld();
    this.labelHost=document.createElement('div');this.labelHost.className='arena-labels';host.append(this.labelHost);
    this.makeHands();
    this.raycaster=new THREE.Raycaster();
    this.pickListener=e=>{
      if(e.target!==this.renderer.domElement) return;
      const hand=this.handAt(e.clientX,e.clientY);
      if(hand)this.onPick(hand[0],hand[1]);
    };
    host.addEventListener('click',this.pickListener);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);
    this.visibility=()=>{this.last=0;if(document.hidden)this.clearEffects();};
    document.addEventListener('visibilitychange',this.visibility);
    this.resize();
    this.loop=t=>{
      this.frame=requestAnimationFrame(this.loop);
      if(!this.active || document.hidden || (this.reduced && !this.effects.length)) {this.last=t;return;}
      // 30fps when idle to save battery; 60fps while an effect is on screen so it stays smooth.
      if(t-this.last<(this.effects.length||this.shakeDur?14:32))return;
      const dt=Math.min((t-this.last)/1000,.05);this.last=t;this.time+=dt;
      this.updateEffects(dt);
      this.applyShake(dt);
      if(!this.reduced){
        this.dust.rotation.y=this.time*.015;
        this.shards.forEach((s,i)=>{s.position.y=s.userData.y+Math.sin(this.time*.55+i)*.16;s.rotation.y+=dt*.09;});
        this.handNodes.flat().forEach(n=>{
          n.aura.material.opacity=n.selected?1:n.target?.7+Math.sin(this.time*4)*.15:.65;
          n.runes.rotation.y=this.time*.12;
          n.crystals.forEach((crystal,i)=>{
            if(!crystal.visible)return;
            crystal.position.y=crystal.userData.restY+Math.sin(this.time*1.3+i*1.7)*.065;
            crystal.rotation.y+=dt*.22;
          });
        });
      }
      this.draw();
    };
    this.frame=requestAnimationFrame(this.loop);
  }
  mesh(geometry, material, parent=this.world, pos=vector()) {
    const m=new THREE.Mesh(geometry,material);m.position.copy(pos);parent.add(m);return m;
  }
  ring(parent, radius, color, y=.1, tube=.018) {
    const m=this.mesh(new THREE.TorusGeometry(radius,tube,6,64),glowMat(color),parent,vector(0,y,0));m.rotation.x=-Math.PI/2;return m;
  }
  buildWorld(){
    this.mesh(new THREE.CylinderGeometry(6.1,5.1,.85,12),stoneMat(0x263c49),this.world,vector(0,-.65,0));
    this.mesh(new THREE.CylinderGeometry(5.95,6.15,.16,96),stoneMat(0x304650),this.world,vector(0,-.16,0));
    this.mesh(new THREE.CylinderGeometry(5.4,5.5,.12,64),stoneMat(0x1b303b),this.world,vector(0,-.025,0));
    this.mesh(new THREE.ConeGeometry(4.7,2.6,9),stoneMat(0x142832),this.world,vector(0,-2.3,0)).rotation.z=Math.PI;
    this.ring(this.world,5.8,0x9b8253,-.055,.024);
    this.ring(this.world,4.85,0x577b83,.05,.012);
    this.ring(this.world,1.15,0xa98b52,.075,.028);
    this.ring(this.world,.92,0x426575,.076,.01);
    for(let i=0;i<48;i++){
      const a=i/48*TAU;
      const m=this.mesh(new THREE.BoxGeometry(i%4===0?.035:.02,.018,i%4===0?.23:.09),glowMat(i%4===0?0xc4a770:0x4d6f7b),this.world,vector(Math.sin(a)*5.55,.045,Math.cos(a)*5.55));m.rotation.y=a;
    }
    // The crossed chopsticks are the game's original emblem, now engraved in the arena.
    for(const a of [-.6,.6]){
      const m=this.mesh(new THREE.BoxGeometry(.10,.045,1.25),stoneMat(0xe3b778),this.world,vector(0,.09,0));m.rotation.y=a;
    }
    for(const z of [-5,5]){
      for(const x of [-3.2,3.2]){
        this.mesh(new THREE.CylinderGeometry(.19,.34,.85,6),stoneMat(0x3a535e),this.world,vector(x,.25,z));
        this.mesh(new THREE.OctahedronGeometry(.18),glowMat(z<0?COLORS[1]:COLORS[0]),this.world,vector(x,.86,z));
      }
    }
    this.shards=[];
    for(let i=0;i<16;i++){
      const a=i*2.39996,r=6.7+(i%3)*.7,y=-1.4+(i%4)*.4;
      const m=this.mesh(new THREE.IcosahedronGeometry(.14+(i%3)*.11,0),stoneMat(0x31515c),this.world,vector(Math.sin(a)*r,y,Math.cos(a)*r));m.scale.y=2;m.userData.y=y;this.shards.push(m);
    }
    const pts=[];for(let i=0;i<160;i++)pts.push(Math.sin(i*129.1)*17,Math.sin(i*93.7)*8+4,Math.cos(i*67.3)*16);
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
    this.dust=new THREE.Points(geo,new THREE.PointsMaterial({color:0x91b5c6,size:.032,transparent:true,opacity:.6}));this.scene.add(this.dust);
  }
  makeHands(){
    this.handNodes=[[],[]];
    for(let p=0;p<2;p++)for(let h=0;h<2;h++){
      const root=new THREE.Group();root.userData.hand=[p,h];this.world.add(root);this.targets.push(root);
      // A luminous summoning seal anchors a cluster of floating arcane crystals.
      this.mesh(new THREE.CylinderGeometry(1.06,1.1,.13,64),stoneMat(0x172c38),root,vector(0,.27,0));
      const portal=this.mesh(new THREE.CircleGeometry(.94,64),glowMat(0x061820),root,vector(0,.345,0));
      portal.rotation.x=-Math.PI/2;
      const halo=this.mesh(new THREE.RingGeometry(.56,1.12,64),glowMat(COLORS[p],.12),root,vector(0,.36,0));
      halo.rotation.x=-Math.PI/2;halo.material.toneMapped=false;
      const aura=this.ring(root,1.03,COLORS[p],.37,.025);
      aura.material.toneMapped=false;
      this.ring(root,.89,COLORS[p],.375,.012);
      this.ring(root,.59,COLORS[p],.38,.014);
      const runes=new THREE.Group();root.add(runes);
      const lines=[];
      const stroke=(a,b)=>lines.push(...a,...b);
      for(let i=0;i<6;i++){
        const a=i*TAU/6,b=(i+2)*TAU/6;
        stroke([Math.sin(a)*.82,.38,Math.cos(a)*.82],[Math.sin(b)*.82,.38,Math.cos(b)*.82]);
      }
      for(let i=0;i<16;i++){
        const a=i*TAU/16, x=Math.sin(a),z=Math.cos(a);
        stroke([x*.935,.38,z*.935],[x*.985,.38,z*.985]);
        if(i%2===0)stroke([x*.95-z*.025,.38,z*.95+x*.025],[x*.975+z*.025,.38,z*.975-x*.025]);
      }
      const runeGeo=new THREE.BufferGeometry();runeGeo.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));
      runes.add(new THREE.LineSegments(runeGeo,new THREE.LineBasicMaterial({color:COLORS[p],transparent:true,opacity:.75})));
      const relic=new THREE.Group();root.add(relic);
      const crystals=[];
      for(let i=0;i<5;i++){
        const crystal=new THREE.Group();relic.add(crystal);
        const geometry=new THREE.OctahedronGeometry(1,0);
        const body=this.mesh(geometry,new THREE.MeshStandardMaterial({
          color:p===0?0x155f67:0x62233f,emissive:COLORS[p],emissiveIntensity:.42,
          roughness:.27,metalness:.35,flatShading:true
        }),crystal);
        const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:new THREE.Color(COLORS[p]).lerp(new THREE.Color(0xffffff),.4),toneMapped:false,transparent:true,opacity:.95}));
        crystal.add(edges);
        crystal.rotation.set(.12,.6+i*1.3,.14);
        crystals.push(crystal);
      }
      const button=document.createElement('button');button.className='arena-hand';button.style.setProperty('--hand-color',`#${COLORS[p].toString(16)}`);
      button.addEventListener('click',()=>this.onPick(p,h));this.labelHost.append(button);
      this.handNodes[p][h]={root,relic,crystals,aura,runes,button,selected:false,target:false};
    }
    this.setView({hands:[[1,1],[1,1]],max:[[4,4],[4,4]],bottom:0,names:['あなた','相手'],turn:0});
  }
  setCrystalCount(n,count){
    n.relic.visible=count>0;
    if(n.crystalCount===count)return;
    n.crystalCount=count;
    n.crystals.forEach((crystal,i)=>{
      crystal.visible=i<count;
      // A shallow fan keeps every crystal silhouette separate from this camera angle.
      const spacing=[0,0,.82,.59,.47,.38][count];
      const x=(i-(count-1)/2)*spacing;
      const y=count===1?1.35:1.18+Math.cos((i-(count-1)/2)*.65)*.14;
      crystal.position.set(x,y,0);
      crystal.userData.restY=y;
      crystal.scale.setScalar([.24,.49,.35,.31,.27,.24][count]);
      crystal.scale.y*=1.65;
    });
  }
  /* 画面上のその位置に手（クリスタル）があれば [p,h]、無ければ null。
     押した時の判定と、タップを数える側（フィードバック）が同じ物差しを使うための入口。 */
  handAt(clientX,clientY){
    const r=this.host.getBoundingClientRect();
    if(!r.width||!r.height||clientX<r.left||clientX>r.right||clientY<r.top||clientY>r.bottom)return null;
    this.raycaster.setFromCamera(new THREE.Vector2((clientX-r.left)/r.width*2-1,-(clientY-r.top)/r.height*2+1),this.camera);
    let o=this.raycaster.intersectObjects(this.targets,true)[0]?.object;
    while(o && !o.userData.hand)o=o.parent;
    return o?o.userData.hand:null;
  }
  point(p,h,y=.5){return this.handNodes[p][h].root.position.clone().add(vector(0,y,0));}
  setView(view){
    this.view=view;
    this.handNodes.forEach((row,p)=>row.forEach((n,h)=>{
      const near=p===view.bottom;
      n.root.position.set(h===0?-2.25:2.25,0,near?2.45:-2.45);
      const count=view.hands[p][h];
      this.setCrystalCount(n,count);
      n.button.dataset.side=near?'near':'far';
      n.selected=!!view.selected && view.selected[0]===p && view.selected[1]===h;
      n.target=!!view.targets?.[p]?.[h];
      n.aura.material.opacity=n.selected?1:n.target?.85:.65;
      n.button.dataset.selected=String(n.selected);n.button.dataset.target=String(n.target);
      n.button.disabled=!!view.disabled || (view.clickable ? !view.clickable[p][h] : false);
      n.button.innerHTML=`<span>${h===0?'左手':'右手'}</span><b>${view.hands[p][h]||'OUT'}</b><small>${view.max[p][h]+1}${view.mode==='deep'?'ちょうど':'以上'}でOUT</small>`;
      n.button.setAttribute('aria-label',`${view.names[p]}の${h===0?'左':'右'}手 ${view.hands[p][h]||'アウト'}${view.hands[p][h]?'本':''}`);
      n.root.scale.setScalar(view.hands[p][h]===0?.9:1);
    }));
    this.draw();
  }
  resize(){
    const width=this.host.clientWidth, height=this.host.clientHeight;if(!width||!height)return;
    this.width=width;this.height=height;this.camera.aspect=width/height;
    // Keep the four selectable hands visible even on a narrow portrait screen.
    const dist=this.camera.aspect<1.1?1.08:(this.camera.aspect>2?.76:1);
    this.camera.position.set(0,11.5*dist,13.5*dist);this.camera.lookAt(0,.35,0);this.camera.fov=this.camera.aspect<1?51:43;
    this.camBase=this.camera.position.clone();
    this.camera.updateProjectionMatrix();this.renderer.setSize(width,height);this.draw();
  }
  draw(){
    if(!this.active || !this.renderer || !this.width)return;
    this.renderer.render(this.scene,this.camera);
    this.handNodes?.flat().forEach(n=>{
      const pt=n.root.position.clone().add(vector(0,.05,1.05)).project(this.camera);
      n.button.style.left=`${(pt.x*.5+.5)*this.width}px`;
      const near=n.button.dataset.side==='near';
      // Opponent controls live in the empty space above the board, as in the reference.
      const top=near ? (-pt.y*.5+.5)*this.height : Math.max(40,Math.min(62,this.height*.14));
      n.button.style.top=`${top}px`;
    });
  }
  setActive(active){this.active=active;this.last=0;if(!active)this.clearEffects();else{this.resize();this.draw();}}
  animate(duration,build,update){
    if(!this.active || document.hidden)return;
    const group=new THREE.Group();this.scene.add(group);build(group);
    if(this.effects.length>=40)this.removeEffect(this.effects.shift());
    this.effects.push({group,age:0,duration:this.reduced?.28:duration,update});this.draw();
  }
  removeEffect(e){
    this.scene.remove(e.group);const materials=new Set();
    e.group.traverse(o=>{o.geometry?.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));});
    materials.forEach(m=>{m.map?.dispose();m.dispose();});
  }
  updateEffects(dt){
    const running=this.effects; this.effects=[];
    for(const e of running){e.age+=dt;const t=Math.min(e.age/e.duration,1);e.update(e.group,this.reduced?.7:t,e.age);if(t>=1)this.removeEffect(e);else this.effects.push(e);}
    // A flash evicted mid-way (effect cap) must not leave the board lit.
    if(this.fxLight&&!this.effects.some(e=>e.group.userData.flash)){this.fxLight.intensity=0;if(this.flashEl)this.flashEl.style.opacity='0';}
  }
  clearEffects(){
    this.effects.forEach(e=>this.removeEffect(e));this.effects=[];
    if(this.fxLight)this.fxLight.intensity=0;
    if(this.flashEl)this.flashEl.style.opacity='0';
    if(this.shakeDur&&this.camBase){this.shakeDur=0;this.camera.position.copy(this.camBase);this.camera.lookAt(0,.35,0);}
  }
  /* ---- 画面全体の手ごたえ（揺れ・光・時間差） ---- */
  shake(power=.25,duration=.45){
    if(this.reduced||!this.camBase)return;
    const left=this.shakeDur?this.shakePower*Math.max(0,1-this.shakeAge/this.shakeDur):0;
    if(power<left)return;                         // 強い揺れを弱い揺れで上書きしない
    this.shakePower=power;this.shakeDur=duration;this.shakeAge=0;
  }
  applyShake(dt){
    if(!this.shakeDur||!this.camBase)return;
    this.shakeAge+=dt;
    const k=Math.max(0,1-this.shakeAge/this.shakeDur);
    if(k<=0){this.shakeDur=0;this.camera.position.copy(this.camBase);this.camera.lookAt(0,.35,0);return;}
    const a=this.shakePower*k*k;
    this.camera.position.set(this.camBase.x+(Math.random()-.5)*a,this.camBase.y+(Math.random()-.5)*a*.6,this.camBase.z+(Math.random()-.5)*a*.4);
    this.camera.lookAt(0,.35,0);
  }
  /* 盤面全体をカードの色で照らす。常設の光を動かすだけ */
  flash(at,color,power=6,duration=.8){
    if(!this.fxLight||!this.camera)return;          // 光を持たない最小の盤（試験など）では照らさない
    const hex='#'+new THREE.Color(color).getHexString();
    this.animate(duration,g=>{g.userData.flash=true;},(g,t)=>{
      if(t<.02){
        this.fxLight.color.setHex(color);this.fxLight.position.copy(at).add(vector(0,1.8,0));
        const pt=at.clone().project(this.camera);
        this.flashEl.style.setProperty('--x',`${(pt.x*.5+.5)*100}%`);this.flashEl.style.setProperty('--y',`${(-pt.y*.5+.5)*100}%`);
        this.flashEl.style.setProperty('--c',hex);
      }
      const k=t<.1?t/.1:Math.pow(1-(t-.1)/.9,2);
      this.fxLight.intensity=power*9*k;
      if(!this.reduced&&this.flashEl)this.flashEl.style.opacity=String(Math.min(.62,power/16)*k);
    });
  }
  /* 少し遅れて何かを起こす（着弾の瞬間に揺らす等） */
  later(delay,fn){let done=false;this.animate(delay,()=>{},(g,t)=>{if(t>=1&&!done){done=true;fn();}});}
  /* 遅れて始まる演出。t は本人の持ち時間で 0→1 */
  timed(duration,build,update,delay=0){
    this.animate(duration+delay,build,(g,t,age)=>{
      if(this.reduced){g.visible=true;update(g,.7);return;}
      g.visible=age>=delay;update(g,Math.max(0,Math.min(1,(age-delay)/duration)));
    });
  }
  side(p,y=.4){return this.point(p,0,y).lerp(this.point(p,1,y),.5);}

  /* ---- 部品 ---- */
  shockwave(at,color,size=1,delay=0){
    this.timed(.7,g=>{
      g.position.copy(at).setY(.08);
      for(let i=0;i<2;i++){const r=this.mesh(new THREE.TorusGeometry(1,.12-i*.05,8,80),addMat(color),g);r.rotation.x=-Math.PI/2;r.userData.i=i;}
      const d=this.mesh(new THREE.CircleGeometry(1,48),addMat(color,.45),g);d.rotation.x=-Math.PI/2;d.name='disc';
    },(g,t)=>g.children.forEach(m=>{
      const k=m.name==='disc'?ease(t)*.9:ease(Math.max(0,t-(m.userData.i||0)*.12));
      m.scale.setScalar(.2+k*3.2*size);m.material.opacity=(m.name==='disc'?.45:1)*Math.pow(1-t,1.3);
    }),delay);
  }
  pillar(at,color,{height=7,radius=.55,duration=1.15,delay=0}={}){
    this.timed(duration,g=>{
      g.position.copy(at).setY(0);
      const outer=this.mesh(new THREE.CylinderGeometry(radius,radius*1.15,height,32,1,true),addMat(color,.35),g,vector(0,height/2,0));outer.name='outer';
      const core=this.mesh(new THREE.CylinderGeometry(radius*.28,radius*.35,height,16,1,true),addMat(0xffffff,.8),g,vector(0,height/2,0));core.name='core';
      const base=this.mesh(new THREE.CircleGeometry(radius*2.2,40),addMat(color,.55),g,vector(0,.06,0));base.rotation.x=-Math.PI/2;base.name='base';
    },(g,t)=>g.children.forEach(m=>{
      const drop=Math.min(t/.18,1);              // 空から一気に降りる
      const fade=t<.55?1:Math.pow(1-(t-.55)/.45,1.6);
      if(m.name==='base'){m.scale.setScalar(.4+ease(drop)*.9+Math.sin(t*24)*.04);m.material.opacity=.55*fade;return;}
      m.scale.set(1+(m.name==='core'?Math.sin(t*40)*.25:0),drop,1+(m.name==='core'?Math.sin(t*40)*.25:0));
      m.position.y=height-(height/2)*drop;
      m.material.opacity=(m.name==='core'?.8:.35)*fade;
    }),delay);
  }
  vortex(at,color,{inward=true,count=28,radius=1.7,duration=1,delay=0}={}){
    this.timed(duration,g=>{
      g.position.copy(at);
      for(let i=0;i<count;i++){const m=this.mesh(new THREE.OctahedronGeometry(.075+(i%3)*.04),addMat(color),g);m.userData.a=i/count*TAU;m.userData.k=.7+(i%5)*.08;}
    },(g,t)=>g.children.forEach(m=>{
      const u=inward?ease(t):t, r=radius*m.userData.k*(inward?1-u:u), a=m.userData.a+(inward?u:-u)*7;
      m.position.set(Math.sin(a)*r,.25+(inward?u:1-u)*.9+Math.sin(a*3)*.08,Math.cos(a)*r);
      m.material.opacity=Math.sin(t*Math.PI);m.rotation.set(a,a,0);
    }),delay);
  }
  shatter(at,color,{count=18,speed=1,delay=0,stone=false}={}){
    this.timed(.9,g=>{
      g.position.copy(at);
      for(let i=0;i<count;i++){
        const a=i*2.3999;const m=this.mesh(new THREE.TetrahedronGeometry(.13+(i%4)*.06),stone?stoneMat(color):addMat(color),g);
        m.userData.v=vector(Math.sin(a)*(1.2+i%3*.6),2+i%4*.7,Math.cos(a)*(1.2+i%3*.6)).multiplyScalar(speed);
        if(stone){m.material.transparent=true;}
      }
    },(g,t)=>g.children.forEach((m,i)=>{
      m.position.copy(m.userData.v).multiplyScalar(t*.8);m.position.y-=t*t*3.2;
      m.rotation.set(t*9+i,t*7,0);m.material.opacity=1-Math.pow(t,2);
    }),delay);
  }
  /* 大きな輪が外から締まって、手に食い込む（縮小） */
  implode(at,color){
    this.timed(.95,g=>{
      g.position.copy(at).setY(.3);
      for(let i=0;i<3;i++){const r=this.mesh(new THREE.TorusGeometry(1,.09-i*.02,8,80),addMat(color),g);r.rotation.x=-Math.PI/2;r.userData.i=i;}
    },(g,t)=>g.children.forEach(r=>{
      const k=Math.pow(Math.min(1,Math.max(0,t-r.userData.i*.1)/.8),2.2);   // だんだん速く締まる
      r.scale.setScalar(3.4-k*3.1);r.position.y=r.userData.i*.22*(1-k);
      r.material.opacity=t>.9?(1-t)/.1:.9;
    }));
  }
  chains(at,color){
    this.timed(1.25,g=>{
      g.position.copy(at).setY(.55);
      for(let i=0;i<16;i++){
        const a=i/16*TAU;const link=this.mesh(new THREE.TorusGeometry(.2,.06,8,16),stoneMat(0xc4cde0),g);
        link.material.emissive=new THREE.Color(color);link.material.emissiveIntensity=1.3;
        link.scale.set(1,.62,1);link.userData.a=a;link.userData.turn=i%2;
      }
      const lock=this.mesh(new THREE.BoxGeometry(.52,.44,.18),stoneMat(0xd8b36a),g);lock.name='lock';
      lock.material.emissive=new THREE.Color(0xffd58a);
      const shackle=this.mesh(new THREE.TorusGeometry(.17,.05,8,16,Math.PI),stoneMat(0xd8b36a),lock,vector(0,.23,0));shackle.name='shackle';
    },(g,t)=>{
      const close=ease(Math.min(t/.5,1)), r=2.6-close*1.55;
      g.children.forEach(m=>{
        if(m.name==='lock'){
          const pop=Math.max(0,(t-.45)/.2);m.visible=t>.45;m.position.set(0,.1,r+.05);
          m.scale.setScalar(Math.min(1,easeOutBack(Math.min(pop,1))));m.material.emissiveIntensity=t>.6&&t<.7?2.5:.5;
          m.material.opacity=1;return;
        }
        const a=m.userData.a+(1-close)*2.4;m.position.set(Math.sin(a)*r,Math.sin(a*2)*.08,Math.cos(a)*r);
        m.rotation.set(0,a+(m.userData.turn?Math.PI/2:0),Math.PI/2);
        m.material.transparent=true;m.material.opacity=t>.85?1-(t-.85)/.15:1;
      });
      if(t>.85)g.children.forEach(m=>{if(m.name==='lock')m.scale.setScalar(1-(t-.85)/.15);});
    });
  }
  clock(at,color){
    this.timed(1.3,g=>{
      g.position.copy(at).setY(.12);
      this.ring(g,1.35,color,0,.04);this.ring(g,1.15,color,0,.015);
      for(let i=0;i<12;i++){const a=i/12*TAU;const m=this.mesh(new THREE.BoxGeometry(i%3?.05:.09,.02,i%3?.18:.3),addMat(color),g,vector(Math.sin(a)*1.22,.02,Math.cos(a)*1.22));m.rotation.y=a;}
      for(const [len,w,name] of [[.95,.07,'long'],[.6,.1,'short']]){
        const hand=new THREE.Group();hand.name=name;g.add(hand);
        this.mesh(new THREE.BoxGeometry(w,.04,len),addMat(0xffffff,.9),hand,vector(0,.05,len/2));
      }
    },(g,t)=>{
      const spin=ease(t);
      g.getObjectByName('long').rotation.y=-spin*TAU*3;   // 逆回り
      g.getObjectByName('short').rotation.y=-spin*TAU*.6;
      g.rotation.y=spin*.6;g.scale.setScalar(.5+easeOutBack(Math.min(t/.3,1))*.5);
      g.traverse(m=>{if(m.material)m.material.opacity=(m.material.color.getHex()===0xffffff?.9:1)*(t<.8?1:1-(t-.8)/.2);});
    });
  }
  eye(at,color){
    this.timed(1.35,g=>{
      g.position.copy(at).add(vector(0,2.4,0));if(this.camera)g.lookAt(this.camera.position);
      const lid=this.mesh(new THREE.TorusGeometry(1,.06,8,64),addMat(color),g);lid.scale.set(1.5,.62,1);lid.name='lid';
      const iris=this.mesh(new THREE.TorusGeometry(.42,.07,8,40),addMat(color),g);iris.name='iris';
      const pupil=this.mesh(new THREE.CircleGeometry(.24,32),addMat(0xffffff,.95),g);pupil.name='pupil';
      const cone=this.mesh(new THREE.ConeGeometry(2.2,2.4,40,1,true),addMat(color,.16),g,vector(0,0,-1.3));cone.rotation.x=-Math.PI/2;cone.name='cone';
    },(g,t)=>{
      const open=t<.2?ease(t/.2):t>.82?1-(t-.82)/.18:1;
      g.getObjectByName('lid').scale.set(1.5,.62*open,1);
      const look=Math.sin(t*9)*.45*(t>.2&&t<.82?1:0);
      for(const n of ['iris','pupil']){const m=g.getObjectByName(n);m.scale.set(1,open,1);m.position.x=look;}
      const c=g.getObjectByName('cone');c.material.opacity=.16*open;c.rotation.z=look*.4;
    });
  }
  wall(at,color){
    const toward=at.z>0?-1:1;
    this.timed(1.3,g=>{
      g.position.copy(at).add(vector(0,0,toward*1.15));
      const slab=this.mesh(new THREE.BoxGeometry(2.3,1.6,.34),stoneMat(0x5f6f82),g);slab.name='slab';
      slab.material.emissive=new THREE.Color(color);slab.material.emissiveIntensity=.15;slab.material.transparent=true;
      const edge=new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry),new THREE.LineBasicMaterial({color,transparent:true,blending:THREE.AdditiveBlending}));edge.name='edge';slab.add(edge);
      for(let i=0;i<5;i++){const rune=this.mesh(new THREE.OctahedronGeometry(.07),addMat(color),slab,vector(-.8+i*.4,.2,toward*-.19));rune.name='rune';}
    },(g,t)=>{
      const rise=easeOutBack(Math.min(t/.28,1)),sink=t>.8?(t-.8)/.2:0;
      const slab=g.getObjectByName('slab');slab.position.y=-1.4+rise*2.2-sink*1.6;
      slab.material.opacity=1-sink;slab.material.emissiveIntensity=.15+(t>.25&&t<.4?1.2:0);
      slab.traverse(m=>{if(m!==slab&&m.material)m.material.opacity=(1-sink)*(m.name==='rune'?.5+Math.sin(t*30)*.5:1);});
    });
  }
  bubbles(at,color,{count=16,rise=2.2}={}){
    this.timed(1.25,g=>{
      g.position.copy(at);
      for(let i=0;i<count;i++){
        const b=this.mesh(new THREE.SphereGeometry(.08+(i%4)*.045,12,10),addMat(color,.75),g);
        b.userData.a=i*2.39;b.userData.r=.25+(i%5)*.13;b.userData.pop=.55+(i%6)*.07;b.userData.d=(i%4)*.08;
      }
    },(g,t)=>g.children.forEach(b=>{
      const lt=Math.max(0,t-b.userData.d),a=b.userData.a+lt*6;
      b.position.set(Math.sin(a)*b.userData.r,.2+lt*rise,Math.cos(a)*b.userData.r);
      const popped=lt>b.userData.pop;
      b.scale.setScalar(popped?1+(lt-b.userData.pop)*6:1);
      b.material.opacity=popped?Math.max(0,.75-(lt-b.userData.pop)*5):.75*Math.min(1,lt*8);
    }));
  }
  sleepy(at,color){
    const canDraw=typeof document!=='undefined'&&typeof document.createElement==='function';
    const tex=canDraw?this.letterTexture('Z',color):null;
    this.timed(1.4,g=>{
      g.position.copy(at).add(vector(0,.9,0));
      if(tex)for(let i=0;i<3;i++){const z=new THREE.Sprite(new THREE.SpriteMaterial({map:tex.clone(),transparent:true,depthWrite:false}));z.userData.i=i;z.material.map.needsUpdate=true;g.add(z);}
      for(let i=0;i<5;i++){const c=this.mesh(new THREE.SphereGeometry(.36,14,10),glowMat(0xcfd8e6,.22),g,vector(-.7+i*.35,-.35,Math.sin(i)*.15));c.scale.y=.45;c.name='cloud';}
    },(g,t)=>g.children.forEach(m=>{
      if(m.name==='cloud'){m.position.x+=.002;m.material.opacity=.22*Math.sin(t*Math.PI);return;}
      const lt=Math.max(0,t-m.userData.i*.2);
      m.position.set(.3+lt*1.1,lt*1.9,0);m.scale.setScalar(.75+lt*.9+m.userData.i*.2);
      m.material.opacity=Math.sin(Math.min(lt/.7,1)*Math.PI);m.material.rotation=Math.sin(lt*6)*.25;
    }));
    tex?.dispose();
  }
  letterTexture(ch,color){
    const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');
    x.fillStyle='#'+new THREE.Color(color).getHexString();x.font='900 104px system-ui, sans-serif';
    x.textAlign='center';x.textBaseline='middle';x.shadowColor='rgba(255,255,255,.8)';x.shadowBlur=12;x.fillText(ch,64,70);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
  }
  cardShard(from,to,color){
    const a=this.point(from[0],from[1],1),b=this.point(to[0],to[1],1);
    const curve=new THREE.QuadraticBezierCurve3(a,a.clone().lerp(b,.5).add(vector(0,3.2,0)),b);
    this.timed(1.05,g=>{
      const card=this.mesh(new THREE.PlaneGeometry(.55,.78),addMat(color,.95),g);card.name='card';
      const frame=new THREE.LineSegments(new THREE.EdgesGeometry(card.geometry),new THREE.LineBasicMaterial({color:0xffffff,transparent:true}));card.add(frame);
      for(let i=0;i<10;i++){const m=this.mesh(new THREE.OctahedronGeometry(.06),addMat(color),g);m.userData.i=i;}
    },(g,t)=>{
      const u=ease(t);const card=g.getObjectByName('card');card.position.copy(curve.getPoint(u));card.rotation.set(u*TAU*2,u*TAU,0);
      card.traverse(m=>{if(m.material)m.material.opacity=t>.85?(1-t)/.15:1;});
      g.children.forEach(m=>{if(m.userData.i===undefined)return;m.position.copy(curve.getPoint(Math.max(0,u-m.userData.i*.025)));m.material.opacity=(1-m.userData.i/10)*(t>.85?(1-t)/.15:1);});
    });
  }
  magic(p,h,color=0x63e6ba,kind='rise'){
    const at=this.point(p,h,0);
    this.animate(.95,g=>{
      g.position.copy(at);
      this.ring(g,.95,color,.42,.035);this.ring(g,.72,color,.43,.017);
      for(let i=0;i<8;i++){
        const a=i/8*TAU;
        const rune=this.mesh(new THREE.OctahedronGeometry(.065),glowMat(color),g,vector(Math.sin(a)*.86,.45,Math.cos(a)*.86));rune.name='rune';
      }
      for(let i=0;i<18;i++){
        const a=i*2.4;const m=this.mesh(new THREE.OctahedronGeometry(.035+(i%3)*.016),glowMat(color),g,vector(Math.sin(a)*.8,.5,Math.cos(a)*.8));m.userData.spark=i;
      }
      if(kind==='seal'){
        for(let i=0;i<3;i++){const ring=this.ring(g,1.1,color,.85+i*.32,.032);ring.name='cage';ring.rotation.z=(i-1)*.6;}
      }
    },(g,t)=>{
      const scale=kind==='shrink'?1.5-t*.8:kind==='rewind'?1.4-t*.45:.5+ease(t)*.7;
      g.scale.setScalar(scale);g.rotation.y=(kind==='rewind'?-1:1)*t*2;
      g.children.forEach(o=>{
        o.material.opacity=Math.sin(t*Math.PI)*.85;
        if(o.userData.spark!==undefined)o.position.y=.4+(kind==='rewind'?1-t:t)*(1.4+(o.userData.spark%4)*.4);
      });
    });
  }
  burst(at,color=0xffb454,size=1){
    this.animate(.7,g=>{
      g.position.copy(at);
      for(let i=0;i<28;i++){
        const a=i*2.3999;const m=this.mesh(new THREE.IcosahedronGeometry(.04+(i%3)*.025,0),glowMat(color),g);
        m.userData.velocity=vector(Math.sin(a)*(1+i%4),1.4+i%3,Math.cos(a)*(1+i%4)).multiplyScalar(size);
      }
      this.ring(g,.15,color,.08,.045).name='wave';
    },(g,t)=>{
      g.children.forEach(m=>{
        if(m.name==='wave'){m.scale.setScalar(1+t*18*size);m.material.opacity=1-t;}
        else{m.position.copy(m.userData.velocity).multiplyScalar(t*.75);m.position.y-=t*t*2;m.rotation.x=t*5;m.material.opacity=1-t;}
      });
    });
  }
  meteor(p,h){
    const end=this.point(p,h,.55),start=end.clone().add(vector(-3,8,-2));let impact=false;
    this.flash(start.clone().lerp(end,.6),0xff7a3a,3,.7);
    this.animate(1.12,g=>{
      const rock=this.mesh(new THREE.IcosahedronGeometry(.4,1),stoneMat(0x653a2b),g);rock.name='rock';rock.material.emissive=new THREE.Color(0xf35b12);rock.material.emissiveIntensity=.8;
      const wire=this.mesh(new THREE.IcosahedronGeometry(.414,1),new THREE.MeshBasicMaterial({color:0xffd384,wireframe:true,transparent:true}),rock);
      wire.name='cracks';
      for(let i=0;i<14;i++){const m=this.mesh(new THREE.IcosahedronGeometry(.25*(1-i/17),0),glowMat(i<6?0xffa33e:0xa74928,.8),g);m.userData.trail=i;}
      // 落ちてくる場所に、だんだん濃くなる影
      const shadow=this.mesh(new THREE.CircleGeometry(1,40),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0,depthWrite:false}),g,end.clone().setY(.07));
      shadow.rotation.x=-Math.PI/2;shadow.name='shadow';
    },(g,t)=>{
      const flight=Math.min(t/.58,1),pos=start.clone().lerp(end,flight*flight);
      const sh=g.getObjectByName('shadow');sh.scale.setScalar(.3+flight*1.1);sh.material.opacity=t<.59?flight*.55:Math.max(0,.55-(t-.59)*2);
      const rock=g.children[0];rock.position.copy(pos);rock.rotation.set(t*6,t*3,0);rock.visible=t<.59;
      g.children.slice(1).forEach(m=>{const f=Math.max(0,flight-m.userData.trail*.026);m.position.copy(start).lerp(end,f*f);m.material.opacity=Math.max(0,1-t/.7)*.85;m.scale.setScalar(.75+Math.sin(t*50+m.userData.trail)*.2);});
      if(t>=.58&&!impact){
        impact=true;this.burst(end,0xffb454,1.4);this.magic(p,h,0xffcc73);
        this.shockwave(end,0xffb454,1.3);this.shockwave(end,0xff7a3a,.8,.08);
        this.shatter(end,0x6b4a3a,{count:16,speed:1.2,stone:true});this.shatter(end,0xffa33e,{count:12,speed:.9});
        this.flash(end,0xffa33e,14,.9);this.shake(.55,.6);
      }
    });
  }
  shield(p,h,wall=false){
    this.animate(.95,g=>{
      g.position.copy(this.point(p,h,.4));
      this.mesh(new THREE.SphereGeometry(1.08,wall?6:24,12,0,TAU,0,Math.PI/2),glowMat(wall?0xb8c4d8:0x7fd3ff,.3),g);
      this.mesh(new THREE.SphereGeometry(1.1,12,8,0,TAU,0,Math.PI/2),new THREE.MeshBasicMaterial({color:wall?0xe7efff:0xa6edff,wireframe:true,transparent:true,opacity:.55}),g);
      this.ring(g,1.1,wall?0xe7efff:0x7fd3ff,0,.035);
    },(g,t)=>{g.scale.setScalar(.6+ease(Math.min(t*3,1))*.55);g.children.forEach(m=>m.material.opacity=(m===g.children[0] ? .24 : .65)*Math.sin(t*Math.PI));});
    const at=this.point(p,h,0);
    this.shockwave(at,wall?0xe7efff:0x7fd3ff,.7);this.shockwave(at,wall?0xe7efff:0xa6edff,.55,.18);
  }
  beam(from,to,color=0x7fd3ff,reflection=false){
    const a=this.point(from[0],from[1],1),b=this.point(to[0],to[1],1);let hit=false;
    const curve=new THREE.QuadraticBezierCurve3(a,a.clone().lerp(b,.5).add(vector(reflection?1.8:0,reflection?2.6:1,0)),b);
    this.animate(.65,g=>{
      this.mesh(new THREE.TubeGeometry(curve,32,.026,6,false),glowMat(color,.3),g).name='path';
      for(let i=0;i<8;i++){const m=this.mesh(new THREE.SphereGeometry(.15*(1-i/10),10,8),glowMat(color),g);m.userData.trail=i;}
    },(g,t)=>{
      g.children.forEach(m=>{if(m.name==='path')m.material.opacity=Math.sin(t*Math.PI)*.35;else{m.position.copy(curve.getPoint(Math.max(0,Math.min(1,t*1.35-m.userData.trail*.045))));m.material.opacity=1-t*.7;}});
      if(t>.75&&!hit){hit=true;this.burst(b,color,.38);}
    });
  }
  card(id,p,detail={}){
    const h=detail?.h??0,opp=1-p,from=detail?.from??h,to=detail?.to??0;
    const at=(pp,hh,y=.4)=>this.point(pp,hh,y), center=vector(0,.4,0);
    switch(id){
      case 1:{ // 反転：両陣営に渦が立ち、光がねじれて入れ替わる
        const c=0x9b8cff;
        this.vortex(this.side(p),c,{inward:false});this.vortex(this.side(opp),c,{inward:false});
        for(let n=0;n<2;n++){this.beam([p,n],[opp,n],c,true);this.beam([opp,n],[p,n],c,true);}
        this.shockwave(center,c,1.6,.25);this.flash(center,c,9);this.shake(.2,.45);break;}
      case 2: // シールド：半球の結界と波紋
        this.shield(p,h);this.flash(at(p,h),0x7fd3ff,8,.7);break;
      case 3: // 隕石：影が広がって落ち、衝撃波と破片
        this.meteor(p,h);break;
      case 4:{ // 召喚：空から光の柱が降り、粒が立ち上がる
        const c=0x5ee6a8;
        this.pillar(at(p,h),c);this.vortex(at(p,h),c,{inward:false,delay:.15});this.magic(p,h,c);
        this.shockwave(at(p,h),c,.9,.15);this.flash(at(p,h),c,11);this.later(.15,()=>this.shake(.18,.35));break;}
      case 5:{ // 拡張：金の輪が三重に広がり、細い柱が立つ
        const c=0xe3b778;
        [0,.14,.28].forEach((d,i)=>this.shockwave(at(p,h),c,.7+i*.35,d));
        this.pillar(at(p,h),c,{radius:.3,height:5});this.magic(p,h,c);this.flash(at(p,h),c,10);break;}
      case 6:{ // 倍返指：力が手に吸い込まれて溜まる（放つのは着弾側の演出）
        const c=0xff7a5f;
        this.vortex(at(p,from),c,{inward:true,count:36,radius:2.2});this.magic(p,from,c);
        this.later(.85,()=>{this.shockwave(at(p,from),c,.8);this.shake(.2,.3);});this.flash(at(p,from),c,10,1);break;}
      case 7:{ // カウンター：結界が割れ、その破片ごと攻撃元へ弾き返す
        const c=0xff5f7e;
        this.shield(p,h);this.later(.3,()=>{this.shatter(at(p,h,.8),c,{count:20,speed:1.1});this.shake(.28,.4);});
        this.beam([p,h],[opp,to],c,true);this.flash(at(p,h),c,11);break;}
      case 8:{ // ダブル：両手に同時に力が溜まる
        const c=0xff9f45;
        for(let n=0;n<2;n++){this.pillar(at(p,n),c,{radius:.32,height:4.5});this.vortex(at(p,n),c,{inward:true,count:20});this.magic(p,n,c);}
        this.flash(this.side(p),c,11);this.later(.2,()=>this.shake(.15,.3));break;}
      case 9:{ // ヒール：やわらかい光の柱と、昇っていく泡
        const c=0x6be39a;
        if(detail?.stage==='block'){this.shield(p,h);this.flash(at(p,h),0x7fd3ff,8);break;}
        this.pillar(at(p,h),c,{radius:.45,duration:1.3});this.bubbles(at(p,h),c,{count:18});this.magic(p,h,c);
        this.flash(at(p,h),c,8,1.1);break;}
      case 10:{ // コピー：相手の手を走査して、自分の側へ写し取る
        const c=0x8fd0ff;
        for(let n=0;n<2;n++){this.shockwave(at(opp,n),c,.6);this.beam([opp,n],[p,n],c);this.pillar(at(p,n),c,{radius:.3,height:4,delay:.35});}
        this.flash(center,c,9);break;}
      case 11:{ // 縮小：相手の手に渦が吸い込まれ、締めつけて弾ける
        const c=0xc08cff;
        this.implode(at(opp,h),c);this.vortex(at(opp,h),c,{inward:true,count:40,radius:3,duration:.9});this.magic(opp,h,c,'shrink');
        this.shatter(at(opp,h),c,{count:14,speed:.8,delay:.85});this.shockwave(at(opp,h),c,.6,.85);
        this.later(.85,()=>this.shake(.28,.35));this.flash(at(opp,h),c,11,1.1);break;}
      case 12:{ // 封印：相手の両手に鎖が巻きつき、錠が落ちる
        const c=0x9fadd2;
        for(let n=0;n<2;n++){this.chains(at(opp,n,0),c);this.magic(opp,n,c,'seal');}
        this.later(.6,()=>this.shake(.25,.35));this.flash(this.side(opp),0x7f93c9,9,1.1);break;}
      case 13:{ // 透視：相手の陣の上に大きな目が開き、見回す
        const c=0x8fd0ff;
        this.eye(this.side(opp,0),c);for(let n=0;n<2;n++)this.shockwave(at(opp,n),c,.5,.3);
        this.flash(this.side(opp),c,8,1.2);break;}
      case 14:{ // 略奪：相手の手に渦ができ、カードが1枚こちらへ飛んでくる
        const c=0xc08cff;
        this.vortex(at(opp,0),c,{inward:true,count:24,duration:.6});this.cardShard([opp,0],[p,0],c);
        this.later(.95,()=>{this.shockwave(at(p,0),c,.7);this.shake(.12,.25);});this.flash(center,c,9);break;}
      case 15:{ // ポイズン：毒の泡が湧き、どす黒い光をまとう
        const c=0x7fd36b;
        this.bubbles(at(p,from),c,{count:22,rise:1.6});this.bubbles(at(p,from),0x3b7a2a,{count:10,rise:1});
        this.magic(p,from,c);this.flash(at(p,from),0x55c43a,9,1.1);break;}
      case 16:{ // なまけもの：雲とZが漂うだけ。揺らさない
        const c=0xb9c6da;
        this.sleepy(this.side(p),c);this.magic(p,0,0x9aa7bd,'rewind');this.flash(this.side(p),0x8a97b0,3,1.2);break;}
      case 17:{ // 鉄壁：地面から石の壁がせり上がる
        const c=0xb8c4d8;
        this.wall(at(p,h,0),c);this.shield(p,h,true);
        this.later(.2,()=>{this.shatter(at(p,h,0),0x5f6f82,{count:14,speed:.8,stone:true});this.shake(.4,.45);});
        this.flash(at(p,h),0xdfe8ff,10);break;}
      case 18:{ // 巻き戻し：大きな時計が逆回りし、光が戻っていく
        const c=0x9b8cff;
        this.clock(this.side(p,0),c);for(let n=0;n<2;n++)this.magic(p,n,c,'rewind');
        this.vortex(this.side(p),c,{inward:true,count:30,radius:2.6,duration:1.2});this.flash(this.side(p),c,9,1.2);break;}
    }
  }
  hit(hit){
    if(hit.kind==='counter')return; // The reflection is already shown by its card event.
    const c=hit.kind==='poison'?0x7fd36b:hit.kind==='twice'?0xff7a5f:hit.kind==='double'?0xff9f45:COLORS[hit.p??0];
    if(hit.p!=null)this.beam([hit.p,hit.h],[hit.dp,hit.dh],c);
    else this.burst(this.point(hit.dp,hit.dh,.5),c,.5);
    // カードでの攻撃は、着弾の瞬間（光線が届く頃）に衝撃を足す
    const land=hit.p!=null?.48:0, card=['twice','double','poison'].includes(hit.kind), at=this.point(hit.dp,hit.dh,.4);
    if(card){this.shockwave(at,c,hit.kind==='twice'?1.2:.8,land);this.later(land||.01,()=>{this.shake(hit.kind==='twice'?.35:.2,.35);});this.flash(at,c,8,.6);}
    if(hit.kind==='poison')this.bubbles(at,c,{count:12,rise:1.2});
    if(hit.out){this.dissolveHand(hit.dp,hit.dh);this.shockwave(at,COLORS[hit.dp],1,land+.3);this.later(land+.3,()=>this.shake(.3,.4));}
  }
  dissolveHand(p,h){
    const at=this.point(p,h,.8);
    this.animate(.85,g=>{
      g.position.copy(at);
      for(let i=0;i<10;i++){
        const m=this.mesh(new THREE.OctahedronGeometry(.09),glowMat(COLORS[p]),g,vector((i%5-2)*.22,i%2*.55,0));
        m.userData.start=m.position.clone();
        m.userData.v=vector(Math.sin(i*2.4)*1.5,1+(i%3)*.3,Math.cos(i*2.4)*1.5);
      }
    },(g,t)=>{
      const fall=Math.max(0,(t-.4)/.6);
      g.visible=t>=.4;
      g.children.forEach((m,i)=>{
        m.position.copy(m.userData.start).addScaledVector(m.userData.v,fall);
        m.position.y+=fall*.9;m.material.opacity=1-fall;m.rotation.set(fall*(i%2?3:-3),0,fall*2);m.scale.setScalar(1-fall*.7);
      });
    });
  }
  dispose(){
    cancelAnimationFrame(this.frame);this.observer.disconnect();this.clearEffects();
    this.motion.removeEventListener('change',this.motionListener);document.removeEventListener('visibilitychange',this.visibility);
    this.host.removeEventListener('click',this.pickListener);this.renderer.domElement.removeEventListener('webglcontextlost',this.lost);
    this.scene.traverse(o=>{o.geometry?.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());});
    this.renderer.dispose();this.renderer.domElement.remove();this.labelHost.remove();
  }
}
