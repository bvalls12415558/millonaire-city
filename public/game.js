import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const $=id=>document.getElementById(id);
let token=null, me=null, socket=null, scene,camera,renderer,player,clock, yaw=0, pitch=.25, locked=false;
const keys={}, remote=new Map(), colliders=[];
const login=async (path)=>{
  const username=$("username").value.trim(), password=$("password").value;
  try{
    const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});
    const data=await r.json(); if(!r.ok) throw Error(data.error);
    token=data.token; me=data.player; startGame();
  }catch(e){$("loginError").textContent=e.message}
};
$("register").onclick=()=>login("/api/register");
$("loginBtn").onclick=()=>login("/api/login");

function material(color,roughness=.8){return new THREE.MeshStandardMaterial({color,roughness})}
function box(x,y,z,sx,sy,sz,mat,group=scene){const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;group.add(m);return m}
function buildCity(){
  scene.background=new THREE.Color(0x8db3c9);scene.fog=new THREE.Fog(0x8db3c9,55,180);
  scene.add(new THREE.HemisphereLight(0xc9e7ff,0x39404a,2));
  const sun=new THREE.DirectionalLight(0xffe2ad,2.5);sun.position.set(-35,55,20);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-90;sun.shadow.camera.right=90;sun.shadow.camera.top=90;sun.shadow.camera.bottom=-90;scene.add(sun);
  const ground=box(0,-.6,0,240,1,240,material(0x34434a));ground.receiveShadow=true;
  const roadMat=material(0x202831),lineMat=material(0xd8c99a);
  for(let i=-3;i<=3;i++){box(i*22,-.08,0,9,.12,230,roadMat);box(0,-.07,i*22,230,.12,9,roadMat);
    for(let k=-5;k<=5;k++){box(i*22,-.005,k*19, .18,.03,5,lineMat);box(k*19,-.005,i*22,5,.03,.18,lineMat)}}
  const colors=[0x657b91,0x9a7863,0x56616e,0x8c8c80,0x526d70,0x75677d];
  for(let x=-5;x<=5;x++)for(let z=-5;z<=5;z++){
    if(Math.abs(x)%1===0 && Math.abs(z)%1===0 && (Math.abs(x*22)%44===0 || Math.abs(z*22)%44===0))continue;
    if(Math.abs(x)<2&&Math.abs(z)<2)continue;
    const h=8+Math.random()*23, w=7+Math.random()*5;
    const b=box(x*22+ (Math.random()-.5)*5,h/2,z*22+(Math.random()-.5)*5,w,h,w,material(colors[Math.floor(Math.random()*colors.length)]));
    const winMat=new THREE.MeshBasicMaterial({color:0xffd98c});
    for(let yy=3;yy<h-1;yy+=3)for(let xx=-w/2+1;xx<w/2;xx+=2)box(b.position.x+xx,yy,b.position.z+w/2+.02,.8,1.1,.05,winMat);
    colliders.push({x:b.position.x,z:b.position.z,r:Math.max(w,w)/2});
  }
  // Casino landmark
  const casino= new THREE.Group();scene.add(casino);casino.position.set(0,0,0);
  box(0,5,0,30,10,24,material(0x171a24),casino);
  box(0,10.2,0,31,.5,25,material(0xd5a944),casino);
  box(0,3.3,12.2,18,3,.3,material(0xd8ad4f),casino);
  const sign=box(0,8,12.5,15,2,.25,new THREE.MeshBasicMaterial({color:0xffc84d}),casino);
  // glowing entrance pillars
  for(let x of [-9,-5,5,9])box(x,3,12.6,.5,6,.5,new THREE.MeshBasicMaterial({color:0x64d9ff}),casino);
  // industrial warehouse
  box(-48,4,-48,28,8,24,material(0x4b5960));
  box(-48,8.2,-48,29,.4,25,material(0xd6a84c));
  // garage
  box(48,3,-48,24,6,18,material(0x43505e));
  // trees / lamps
  for(let i=0;i<45;i++){const x=(Math.random()-.5)*180,z=(Math.random()-.5)*180;if(Math.abs(x)<18&&Math.abs(z)<18)continue;
    const trunk=box(x,1.2,z,.7,2.4,.7,material(0x60452f));const crown=new THREE.Mesh(new THREE.SphereGeometry(2.2,8,7),material(0x397a57));crown.position.set(x,3.5,z);crown.castShadow=true;scene.add(crown)}
}
function makeAvatar(color=0x46b5d9){
 const g=new THREE.Group();const body=new THREE.Mesh(new THREE.CapsuleGeometry(.48,.85,4,8),material(color));body.position.y=1.05;body.castShadow=true;g.add(body);
 const head=new THREE.Mesh(new THREE.SphereGeometry(.32,12,10),material(0xe3b992));head.position.y=1.9;g.add(head);return g;
}
function startGame(){
 $("login").hidden=true;$("game").hidden=false;$("myName").textContent=me.username;
 scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(70,innerWidth/innerHeight,.1,400);
 renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;$("world").appendChild(renderer.domElement);
 clock=new THREE.Clock();buildCity();player=makeAvatar();scene.add(player);player.position.set(0,0,18);
 socket=io({auth:{token}});
 socket.on("connect_error",()=>toast("Error de conexión o sesión caducada"));
 socket.on("world:init",d=>{updateEconomy(d.balance);d.players.forEach(addRemote)});
 socket.on("players:update",list=>{ $("playerCount").textContent=list.length; $("players").innerHTML=list.map(p=>`<div>● ${escapeHtml(p.username)}</div>`).join("")});
 socket.on("player:moved",p=>{let obj=remote.get(p.id);if(!obj){addRemote(p);obj=remote.get(p.id)}obj.position.set(p.x,p.y,p.z);obj.rotation.y=p.rotation});
 socket.on("economy:update",d=>updateEconomy(d.balance));
 socket.on("chat:message",m=>addChat(m.username,m.text));
 socket.on("action:error",toast);socket.on("action:success",d=>toast(d.message));
 socket.on("casino:result",d=>{$("reels").innerHTML=d.reels.map(s=>`<span>${s}</span>`).join("");toast(d.win?`¡Premio ${d.win}$! Neto: ${d.net}$`:`Sin premio. Neto: ${d.net}$`)});
 socket.on("game:victory",()=>{$("victory").hidden=false});
 renderer.domElement.addEventListener("click",()=>renderer.domElement.requestPointerLock());
 document.addEventListener("pointerlockchange",()=>locked=document.pointerLockElement===renderer.domElement);
 document.addEventListener("mousemove",e=>{if(locked){yaw-=e.movementX*.002;pitch=Math.max(-.2,Math.min(.8,pitch+e.movementY*.0015))}});
 document.addEventListener("keydown",e=>{keys[e.code]=true;if(["Space","ArrowUp","ArrowDown"].includes(e.code))e.preventDefault()});
 document.addEventListener("keyup",e=>keys[e.code]=false);
 addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
 animate();
}
function addRemote(p){if(p.id===me.id||remote.has(p.id))return;const a=makeAvatar(0xd6a84c);a.position.set(p.x,p.y,p.z);scene.add(a);remote.set(p.id,a)}
function updateEconomy(n){$("balance").textContent="$"+Number(n).toLocaleString("en-US");$("target").textContent=Number(n).toLocaleString("en-US")+" / 1.000.000 $";$("progress").style.width=Math.min(100,n/10000)+"%"}
function animate(){
 requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);
 const forward=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)),right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw)),dir=new THREE.Vector3();
 if(keys.KeyW)dir.add(forward);if(keys.KeyS)dir.sub(forward);if(keys.KeyD)dir.add(right);if(keys.KeyA)dir.sub(right);
 if(dir.lengthSq())dir.normalize().multiplyScalar((keys.ShiftLeft?12:7)*dt);
 player.position.add(dir);player.position.x=THREE.MathUtils.clamp(player.position.x,-112,112);player.position.z=THREE.MathUtils.clamp(player.position.z,-112,112);
 if(dir.lengthSq())player.rotation.y=Math.atan2(dir.x,dir.z);
 const target=new THREE.Vector3(player.position.x,player.position.y+1.5,player.position.z);
 const offset=new THREE.Vector3(Math.sin(yaw)*9,4+pitch*7,Math.cos(yaw)*9);
 camera.position.lerp(target.clone().add(offset),.12);camera.lookAt(target);
 if(socket?.connected && Math.random()<.12)socket.emit("player:move",{x:player.position.x,y:player.position.y,z:player.position.z,rotation:player.rotation.y});
 renderer.render(scene,camera);
}
function toast(msg){$("toast").textContent=msg;$("toast").classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>$("toast").classList.remove("show"),2600)}
function addChat(user,text){const el=document.createElement("div");el.className="msg";const b=document.createElement("b");b.textContent=user+": ";el.append(b,document.createTextNode(text));$("chat").append(el);$("chat").scrollTop=$("chat").scrollHeight}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
document.querySelectorAll("[data-job]").forEach(b=>b.onclick=()=>socket?.emit("job:complete",b.dataset.job));
$("spin").onclick=()=>socket?.emit("casino:bet",{game:"slots",amount:Number($("bet").value)});
$("chatForm").onsubmit=e=>{e.preventDefault();const v=$("chatInput").value.trim();if(v){socket.emit("chat:send",v);$("chatInput").value=""}};
