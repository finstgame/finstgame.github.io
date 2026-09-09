import * as THREE from './assets/vendor/three.module.min.js';

const TAU = Math.PI * 2;
const COLORS = [0x33d9be, 0xff5f7e];
const vector = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const ease = t => 1 - Math.pow(1-t,3);
const glowMat = (color, opacity=1) => new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,side:THREE.DoubleSide});
const stoneMat = color => new THREE.MeshStandardMaterial({color,roughness:.82,metalness:.25,flatShading:true});

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
    this.renderer.localClippingEnabled=true;
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
    this.world=new THREE.Group();this.scene.add(this.world);
    this.buildWorld();
    this.labelHost=document.createElement('div');this.labelHost.className='arena-labels';host.append(this.labelHost);
    this.makeHands();
    this.raycaster=new THREE.Raycaster();
    this.pickListener=e=>{
      if(e.target!==this.renderer.domElement) return;
      const r=host.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),this.camera);
      const hit=this.raycaster.intersectObjects(this.targets,true)[0];
      if(hit){let o=hit.object;while(o && !o.userData.hand)o=o.parent;if(o){const [p,h]=o.userData.hand;this.onPick(p,h);}}
    };
    host.addEventListener('click',this.pickListener);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);
    this.visibility=()=>{this.last=0;if(document.hidden)this.clearEffects();};
    document.addEventListener('visibilitychange',this.visibility);
    this.resize();
    this.loop=t=>{
      this.frame=requestAnimationFrame(this.loop);
      if(!this.active || document.hidden || (this.reduced && !this.effects.length)) {this.last=t;return;}
      if(t-this.last<32)return;
      const dt=Math.min((t-this.last)/1000,.05);this.last=t;this.time+=dt;
      this.updateEffects(dt);
      if(!this.reduced){
        this.dust.rotation.y=this.time*.015;
        this.shards.forEach((s,i)=>{s.position.y=s.userData.y+Math.sin(this.time*.55+i)*.16;s.rotation.y+=dt*.09;});
        this.handNodes.flat().forEach(n=>{
          n.aura.material.opacity=n.selected?1:n.target?.7+Math.sin(this.time*4)*.15:.65;
          n.runes.rotation.y=this.time*.12;
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
      // A flat, luminous portal hides the wrist; the hand emerges through its surface.
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
      // The dorsal side (+Z) faces the camera, with fingers pointing away like the reference.
      const hand=new THREE.Group();hand.position.set(0,.37,.38);hand.rotation.x=-.72;root.add(hand);
      hand.scale.x=h===0?-1:1;
      const clip=[new THREE.Plane(vector(0,1,0),-.355)];
      const skin=new THREE.MeshStandardMaterial({color:0xc47b54,roughness:.72,clippingPlanes:clip});
      const nailMaterial=new THREE.MeshStandardMaterial({color:0xe9bba5,roughness:.38,clippingPlanes:clip});
      // An elliptical, tapered volume gives the wrist and back one continuous skin.
      const profile=new THREE.CatmullRomCurve3([
        vector(.25,-.5,.16),vector(.27,-.08,.175),vector(.32,.25,.19),
        vector(.46,.55,.225),vector(.51,.83,.225),vector(.49,1.02,.18),vector(.34,1.14,.09),vector(0,1.17,0)
      ]);
      const vertices=[],indices=[],rings=32,sides=32;
      for(let j=0;j<=rings;j++){
        const v=profile.getPoint(j/rings);
        for(let k=0;k<=sides;k++){
          const a=k/sides*TAU;
          vertices.push(Math.cos(a)*Math.max(0,v.x),v.y,Math.sin(a)*Math.max(0,v.z));
          if(j<rings&&k<sides){const i=j*(sides+1)+k;indices.push(i,i+sides+1,i+1,i+1,i+sides+1,i+sides+2);}
        }
      }
      const palmGeo=new THREE.BufferGeometry();palmGeo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));palmGeo.setIndex(indices);palmGeo.computeVertexNormals();
      const palm=this.mesh(palmGeo,skin,hand);
      const fingers=[];
      const positions=[[-.39,1.04,0],[-.12,1.105,0],[.16,1.07,0],[.405,.98,-.015],[-.49,.44,-.025]];
      for(let i=0;i<5;i++){
        const finger=this.makeFinger([1.03,1.16,1.07,.81,.74][i],skin,nailMaterial,i===4?.155:.132);
        finger.position.set(...positions[i]);hand.add(finger);fingers.push(finger);
      }
      const button=document.createElement('button');button.className='arena-hand';button.style.setProperty('--hand-color',`#${COLORS[p].toString(16)}`);
      button.addEventListener('click',()=>this.onPick(p,h));this.labelHost.append(button);
      this.handNodes[p][h]={root,hand,palm,fingers,aura,runes,button,selected:false,target:false};
    }
    this.setView({hands:[[1,1],[1,1]],max:[[4,4],[4,4]],bottom:0,names:['あなた','相手'],turn:0});
  }
  makeFinger(length,skin,nailMaterial,radius){
    const finger=new THREE.Group(), joints=[];
    let parent=finger;
    const lengths=[length*.44,length*.32,length*.24];
    for(let i=0;i<3;i++){
      const joint=new THREE.Group();parent.add(joint);joints.push(joint);
      if(i)joint.position.y=lengths[i-1];
      const r=radius*(1-i*.1),segment=lengths[i];
      if(i===2){
        const nail=this.mesh(new THREE.SphereGeometry(1,12,8),nailMaterial,joint,vector(0,segment*.45,r*.85));
        nail.scale.set(r*.72,segment*.32,.019);
      }
      parent=joint;
    }
    finger.userData.joints=joints;
    finger.userData.lengths=lengths;
    finger.userData.radius=radius;
    finger.userData.body=this.mesh(new THREE.BufferGeometry(),skin,finger);
    return finger;
  }
  poseHand(n,count){
    n.hand.visible=count>0;
    if(n.poseCount===count)return;
    n.poseCount=count;
    n.fingers.forEach((finger,i)=>{
      const extended=i<count;
      finger.userData.extended=extended;
      const joints=finger.userData.joints;
      if(i===4){
        // The thumb stays tucked until five; it grows from the side of the palm.
        finger.rotation.set(extended?-.10:-.65,0,extended?.78:-.55);
        joints[0].rotation.x=extended?0:-.7;
        joints[1].rotation.x=extended?-.1:-1.05;
        joints[2].rotation.x=extended?-.08:-.55;
      }else{
        const spread=count===2?[-.10,.10,0,0]:[-.06,-.015,.045,.14];
        finger.rotation.z=extended?-spread[i]:0;
        joints[0].rotation.x=extended?-.035:-1.30;
        joints[1].rotation.x=extended?-.045:-1.65;
        joints[2].rotation.x=extended?-.02:-.85;
      }
      this.updateFingerSurface(finger);
    });
  }
  updateFingerSurface(finger){
    // One continuous surface follows the bent joints, avoiding stacked capsule seams.
    const {joints,lengths,radius,body}=finger.userData;
    const points=[vector()],orientation=new THREE.Quaternion();
    joints.forEach((joint,i)=>{
      orientation.multiply(joint.quaternion);
      points.push(points[i].clone().add(vector(0,lengths[i],0).applyQuaternion(orientation)));
    });
    const curve=new THREE.CatmullRomCurve3(points);
    const geo=new THREE.TubeGeometry(curve,24,radius,12,false);
    const pos=geo.attributes.position;
    for(let j=0;j<=24;j++){
      const t=j/24,center=curve.getPointAt(t);
      const taper=t>.86?.8624*Math.sqrt(Math.max(0,1-((t-.86)/.14)**2)):1-t*.16;
      for(let k=0;k<=12;k++){
        const i=j*13+k,v=vector().fromBufferAttribute(pos,i).sub(center).multiplyScalar(taper).add(center);
        pos.setXYZ(i,v.x,v.y,v.z);
      }
    }
    geo.computeVertexNormals();body.geometry.dispose();body.geometry=geo;
  }
  point(p,h,y=.5){return this.handNodes[p][h].root.position.clone().add(vector(0,y,0));}
  setView(view){
    this.view=view;
    this.handNodes.forEach((row,p)=>row.forEach((n,h)=>{
      const near=p===view.bottom;
      n.root.position.set(h===0?-2.25:2.25,0,near?2.45:-2.45);
      const count=view.hands[p][h];
      this.poseHand(n,count);
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
    if(this.effects.length>=24)this.removeEffect(this.effects.shift());
    this.effects.push({group,age:0,duration:this.reduced?.28:duration,update});this.draw();
  }
  removeEffect(e){
    this.scene.remove(e.group);const materials=new Set();
    e.group.traverse(o=>{o.geometry?.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));});
    materials.forEach(m=>m.dispose());
  }
  updateEffects(dt){
    const running=this.effects; this.effects=[];
    for(const e of running){e.age+=dt;const t=Math.min(e.age/e.duration,1);e.update(e.group,this.reduced?.7:t,e.age);if(t>=1)this.removeEffect(e);else this.effects.push(e);}
  }
  clearEffects(){this.effects.forEach(e=>this.removeEffect(e));this.effects=[];}
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
    this.animate(1.12,g=>{
      const rock=this.mesh(new THREE.IcosahedronGeometry(.4,1),stoneMat(0x653a2b),g);rock.name='rock';rock.material.emissive=new THREE.Color(0xf35b12);rock.material.emissiveIntensity=.8;
      const wire=this.mesh(new THREE.IcosahedronGeometry(.414,1),new THREE.MeshBasicMaterial({color:0xffd384,wireframe:true,transparent:true}),rock);
      wire.name='cracks';
      for(let i=0;i<14;i++){const m=this.mesh(new THREE.IcosahedronGeometry(.25*(1-i/17),0),glowMat(i<6?0xffa33e:0xa74928,.8),g);m.userData.trail=i;}
    },(g,t)=>{
      const flight=Math.min(t/.58,1),pos=start.clone().lerp(end,flight*flight);
      const rock=g.children[0];rock.position.copy(pos);rock.rotation.set(t*6,t*3,0);rock.visible=t<.59;
      g.children.slice(1).forEach(m=>{const f=Math.max(0,flight-m.userData.trail*.026);m.position.copy(start).lerp(end,f*f);m.material.opacity=Math.max(0,1-t/.7)*.85;m.scale.setScalar(.75+Math.sin(t*50+m.userData.trail)*.2);});
      if(t>=.58&&!impact){impact=true;this.burst(end,0xffb454,1.2);this.magic(p,h,0xffcc73);}
    });
  }
  shield(p,h,wall=false){
    this.animate(.95,g=>{
      g.position.copy(this.point(p,h,.4));
      this.mesh(new THREE.SphereGeometry(1.08,wall?6:24,12,0,TAU,0,Math.PI/2),glowMat(wall?0xb8c4d8:0x7fd3ff,.3),g);
      this.mesh(new THREE.SphereGeometry(1.1,12,8,0,TAU,0,Math.PI/2),new THREE.MeshBasicMaterial({color:wall?0xe7efff:0xa6edff,wireframe:true,transparent:true,opacity:.55}),g);
      this.ring(g,1.1,wall?0xe7efff:0x7fd3ff,0,.035);
    },(g,t)=>{g.scale.setScalar(.6+ease(Math.min(t*3,1))*.55);g.children.forEach(m=>m.material.opacity=(m===g.children[0] ? .24 : .65)*Math.sin(t*Math.PI));});
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
    switch(id){
      case 1:for(let n=0;n<2;n++){this.beam([p,n],[opp,n],0x9b8cff,true);this.beam([opp,n],[p,n],0x9b8cff,true);}break;
      case 2:this.shield(p,h);break;
      case 3:this.meteor(p,h);break;
      case 4:this.magic(p,h,0x5ee6a8);break;
      case 5:this.magic(p,h,0xe3b778);break;
      case 6:this.magic(p,from,0xff7a5f);break; // Flight is tied to the resolved hit, including defenses.
      case 7:this.shield(p,h);this.beam([p,h],[opp,to],0xff5f7e,true);break;
      case 8:for(let n=0;n<2;n++)this.magic(p,n,0xff9f45);break;
      case 9:if(detail?.stage==='block')this.shield(p,h);else this.magic(p,h,0x6be39a);break;
      case 10:for(let n=0;n<2;n++)this.beam([opp,n],[p,n],0x8fd0ff);break;
      case 11:this.magic(opp,h,0xc08cff,'shrink');break;
      case 12:for(let n=0;n<2;n++)this.magic(opp,n,0x9fadd2,'seal');break;
      case 13:for(let n=0;n<2;n++)this.magic(opp,n,0x8fd0ff,'seal');break;
      case 14:this.beam([opp,0],[p,0],0xc08cff,true);break;
      case 15:this.magic(p,from,0x7fd36b);break;
      case 16:for(let n=0;n<2;n++)this.magic(p,n,0x9aa7bd,'rewind');break;
      case 17:this.shield(p,h,true);break;
      case 18:for(let n=0;n<2;n++)this.magic(p,n,0x9b8cff,'rewind');break;
    }
  }
  hit(hit){
    if(hit.kind==='counter')return; // The reflection is already shown by its card event.
    const c=hit.kind==='poison'?0x7fd36b:hit.kind==='twice'?0xff7a5f:hit.kind==='double'?0xff9f45:COLORS[hit.p??0];
    if(hit.p!=null)this.beam([hit.p,hit.h],[hit.dp,hit.dh],c);
    else this.burst(this.point(hit.dp,hit.dh,.5),c,.5);
    if(hit.out)this.dissolveHand(hit.dp,hit.dh);
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
