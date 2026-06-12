/* MathLab engine — reusable 3D lesson-lab runtime.
   A lesson supplies a config; the engine builds the shell, owns the camera
   (orbit/zoom/presets with smooth synced transitions + auto-reframe), wires the
   view/layer controls, and calls cfg.build(api) on every change.
   Requires THREE (r128) loaded first. */
(function(){
  "use strict";
  const THREE = window.THREE;
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const el = (tag,cls,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;};

  function create(cfg){
    // ---------- shell DOM ----------
    const presets = cfg.views || [
      {key:"3d",label:"3D",theta:-0.62,phi:0.84},
      {key:"top",label:"Top",theta:-0.62,phi:0.16},
      {key:"front",label:"Front",theta:-1.5708,phi:1.16}
    ];
    const shell = el("main","ml-shell");
    shell.dataset.labId = cfg.id; shell.dataset.labKind = cfg.kind||"";
    shell.innerHTML =
      '<div class="ml-stage">'+
        '<div class="ml-viewport" id="ml-vp" title="Drag to orbit · wheel to zoom · click to inspect"><canvas id="ml-canvas"></canvas></div>'+
        '<div class="ml-corner-tl">'+
          '<div class="ml-badge"><span>Live structure</span><strong id="ml-badge">—</strong></div>'+
          '<div class="ml-selected"><span>'+(cfg.selectedLabel||"Selected")+'</span><strong id="ml-selected">'+(cfg.selectedHint||"Click an object to inspect it.")+'</strong></div>'+
        '</div>'+
        '<div class="ml-views" id="ml-views"></div>'+
        '<button class="ml-toggle-right" id="ml-toggle-right" type="button" aria-label="Toggle stats panel" aria-expanded="false">stats &amp; info</button>'+
        '<aside class="ml-drawer-right" id="ml-drawer-right">'+
          '<header><p class="eyebrow">'+(cfg.eyebrow||"")+'</p><h1>'+(cfg.title||"")+'</h1><p class="sub">'+(cfg.subtitle||"")+'</p></header>'+
          '<div class="ml-scroll">'+
            '<div class="ml-metrics" id="ml-metrics"></div>'+
            '<div class="ml-insight"><h2 id="ml-insightlbl">'+(cfg.insightLabel||"What to watch")+'</h2><p id="ml-insight"></p><p class="state" id="ml-state"></p></div>'+
          '</div>'+
          '<p class="ml-hint" id="ml-hint">'+(cfg.hint||"")+'</p>'+
        '</aside>'+
        '<div class="ml-dock-bottom" id="ml-dock-bottom">'+
          '<div class="ml-dock-head" id="ml-dock-head" title="Show / hide controls"><span class="ml-grip"></span><span class="ml-formula" id="ml-formula"></span><span class="ml-caret">&#9662;</span></div>'+
          '<div class="ml-command" id="ml-command"></div>'+
        '</div>'+
      '</div>';
    document.body.appendChild(shell);
    shell.classList.add("controls-open");
    shell.querySelector("#ml-dock-head").addEventListener("click",()=>shell.classList.toggle("controls-open"));
    const _tR=shell.querySelector("#ml-toggle-right");
    _tR.addEventListener("click",()=>{const open=shell.classList.toggle("stats-open");_tR.setAttribute("aria-expanded",String(open));});

    const $ = id=>shell.querySelector("#"+id);
    const refs = {badge:$("ml-badge"),formula:$("ml-formula"),selected:$("ml-selected"),
      insight:$("ml-insight"),insightlbl:$("ml-insightlbl"),state:$("ml-state")};
    const canvas=$("ml-canvas"), viewport=$("ml-vp");

    // ---------- state + controls ----------
    const paramDefs={}; const paramInputs={};
    const state={ mode: cfg.modes?cfg.modes[0].value:null, step:0, sel:null };
    (cfg.params||[]).forEach(p=>{paramDefs[p.key]=p; state[p.key]=p.value;});

    const cmd=$("ml-command");
    if(cfg.modes){
      const wrap=el("div","ctl mode"); wrap.innerHTML='<label for="ml-mode">structure</label>';
      const sel=el("select"); sel.id="ml-mode";
      cfg.modes.forEach(m=>{const o=el("option");o.value=m.value;o.textContent=m.label;sel.appendChild(o);});
      sel.value=state.mode;
      sel.addEventListener("change",()=>{state.mode=sel.value;state.step=0;state.sel=null;setSelectedText(cfg.selectedHint||"Click an object to inspect it.");
        if(cfg.onMode)cfg.onMode(api);update(true);});
      wrap.appendChild(sel);cmd.appendChild(wrap);
    }
    (cfg.params||[]).forEach(p=>{
      const wrap=el("div","ctl");
      const out=el("output"); out.textContent=p.fmt?p.fmt(p.value):p.value;
      const lab=el("label"); lab.setAttribute("for","ml-p-"+p.key); lab.textContent=p.label+" "; lab.appendChild(out);
      const inp=el("input"); inp.type="range"; inp.id="ml-p-"+p.key; inp.min=p.min; inp.max=p.max; inp.step=p.step; inp.value=p.value;
      inp.addEventListener("input",()=>{state[p.key]=parseFloat(inp.value);out.textContent=p.fmt?p.fmt(state[p.key]):state[p.key];
        state.sel=null;setSelectedText(cfg.selectedHint||"Click an object to inspect it.");
        if(cfg.onParam)cfg.onParam(api,p.key);update(false);});
      wrap.appendChild(lab);wrap.appendChild(inp);cmd.appendChild(wrap);
      paramInputs[p.key]={input:inp,out:out};
    });
    const btns=el("div","ml-btns");
    const mkBtn=(label,cls,fn)=>{const b=el("button",cls);b.type="button";b.textContent=label;b.addEventListener("click",fn);btns.appendChild(b);return b;};
    if(cfg.primary) mkBtn(cfg.primary.label,"primary",()=>{cfg.primary.on(api);update(false);});
    if(cfg.secondary) mkBtn(cfg.secondary.label,null,()=>{cfg.secondary.on(api);update(false);});
    mkBtn("Reset",null,()=>resetAll());
    cmd.appendChild(btns);

    // metrics
    const mwrap=$("ml-metrics"); const metricEls={};
    (cfg.metrics||[]).forEach(m=>{const c=el("div","ml-metric"+(m.accent?" k-"+m.accent:""));
      c.innerHTML='<span data-mlabel="'+m.key+'">'+m.label+'</span><strong>—</strong>';
      mwrap.appendChild(c); metricEls[m.key]={strong:c.querySelector("strong"),span:c.querySelector("span")};});

    // ---------- view controls ----------
    const views=$("ml-views");
    const camRow=el("div","ml-viewrow"); camRow.appendChild(el("span","lbl","view"));
    const presetBtns={};
    presets.forEach(v=>{const b=el("button",null,v.label);b.type="button";b.setAttribute("aria-pressed",v.key==="3d"?"true":"false");
      b.addEventListener("click",()=>{Object.keys(presetBtns).forEach(k=>presetBtns[k].setAttribute("aria-pressed","false"));
        b.setAttribute("aria-pressed","true");tgt.theta=v.theta;tgt.phi=v.phi;});
      presetBtns[v.key]=b;camRow.appendChild(b);});
    views.appendChild(camRow);
    const layerState={}, layerBtns={};
    if(cfg.layers&&cfg.layers.length){
      const lr=el("div","ml-viewrow"); lr.appendChild(el("span","lbl","show"));
      cfg.layers.forEach(L=>{layerState[L.group]=true;const b=el("button",null,L.label);b.type="button";b.setAttribute("aria-pressed","true");
        b.addEventListener("click",()=>{if(b.disabled)return;layerState[L.group]=!layerState[L.group];b.setAttribute("aria-pressed",String(layerState[L.group]));
          const g=groups.get(L.group); if(g)g.visible=layerState[L.group];});
        layerBtns[L.group]=b; lr.appendChild(b);});
      views.appendChild(lr);
    }

    // ---------- three.js ----------
    const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
    renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio||1,2),3)); // supersample: always ≥2× for crisp output
    const scene=new THREE.Scene();
    scene.fog=new THREE.FogExp2(0x070b14,0.019);
    const camera=new THREE.PerspectiveCamera(44,1,0.1,200);
    const root=new THREE.Group(); scene.add(root);
    scene.add(new THREE.HemisphereLight(0xc6dcff,0x0a1018,0.78));
    scene.add(new THREE.AmbientLight(0x9fb4cc,0.22));
    const key=new THREE.DirectionalLight(0xffffff,0.95); key.position.set(5,9,6); scene.add(key);
    const rim=new THREE.DirectionalLight(0x6aa8ff,0.5); rim.position.set(-6,4,-6); scene.add(rim);
    // ground grid (spatial reference) + soft platform glow
    const grid=new THREE.GridHelper(44,44,0x335a82,0x18324c);
    grid.position.y=-0.06; grid.material.transparent=true; grid.material.opacity=0.2; scene.add(grid);
    (function(){const c=document.createElement("canvas");c.width=c.height=256;const g=c.getContext("2d");
      const gr=g.createRadialGradient(128,128,8,128,128,128);gr.addColorStop(0,"rgba(80,150,225,0.30)");gr.addColorStop(0.6,"rgba(80,150,225,0.07)");gr.addColorStop(1,"rgba(80,150,225,0)");
      g.fillStyle=gr;g.fillRect(0,0,256,256);
      const m=new THREE.Mesh(new THREE.PlaneGeometry(22,22),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
      m.rotation.x=-Math.PI/2;m.position.y=-0.05;scene.add(m);})();

    const d0=cfg.defaultCam||{theta:-0.62,phi:0.84,r:10};
    const cur={theta:d0.theta,phi:d0.phi,r:d0.r,cx:0,cy:0.35,cz:0};
    const tgt={theta:d0.theta,phi:d0.phi,r:d0.r,cx:0,cy:0.35,cz:0};
    function placeCamera(){const x=cur.cx+cur.r*Math.sin(cur.phi)*Math.cos(cur.theta);
      const y=cur.cy+cur.r*Math.cos(cur.phi); const z=cur.cz+cur.r*Math.sin(cur.phi)*Math.sin(cur.theta);
      camera.position.set(x,y,z);camera.lookAt(cur.cx,cur.cy,cur.cz);}

    // ---------- groups + disposal ----------
    const groups=new Map();
    function group(name){let g=groups.get(name);if(!g){g=new THREE.Group();groups.set(name,g);root.add(g);}return g;}
    function disposeObj(o){if(o.geometry)o.geometry.dispose();const m=o.material;
      if(m){(Array.isArray(m)?m:[m]).forEach(x=>{if(x.map)x.map.dispose();x.dispose();});}}
    function clearGroup(g){for(let i=g.children.length-1;i>=0;i--){const o=g.children[i];o.traverse&&o.traverse(disposeObj);g.remove(o);}}
    function clearAll(){groups.forEach(clearGroup);}

    // ---------- label helpers ----------
    const MAXANISO=(function(){try{return renderer.capabilities.getMaxAnisotropy()||8;}catch(e){return 8;}})();
    function label(text,color,scale){color=color||"#cfe0f0";scale=scale||0.6;
      const c=document.createElement("canvas");c.width=320;c.height=168;const x=c.getContext("2d");
      x.fillStyle=color;x.font="700 108px Inter,Segoe UI,sans-serif";x.textAlign="center";x.textBaseline="middle";x.fillText(text,160,92);
      const tex=new THREE.CanvasTexture(c);tex.anisotropy=MAXANISO;tex.minFilter=THREE.LinearFilter;tex.generateMipmaps=false;
      const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
      sp.scale.set(scale,scale*0.52,1);return sp;}
    function bigLabel(text,color,worldW){const fs=92,pad=20,c=document.createElement("canvas"),m=c.getContext("2d");
      m.font="700 "+fs+"px Inter,Segoe UI,sans-serif";c.width=Math.ceil(m.measureText(text).width)+pad*2;c.height=fs+pad*2;
      const x=c.getContext("2d");x.font="700 "+fs+"px Inter,Segoe UI,sans-serif";x.fillStyle=color;x.textAlign="center";x.textBaseline="middle";x.fillText(text,c.width/2,c.height/2);
      const tex=new THREE.CanvasTexture(c);tex.anisotropy=MAXANISO;tex.minFilter=THREE.LinearFilter;tex.generateMipmaps=false;
      const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
      sp.scale.set(worldW,worldW*c.height/c.width,1);return sp;}
    function flatNum(text,color,size){const c=document.createElement("canvas");c.width=c.height=256;const x=c.getContext("2d");
      x.fillStyle=color;x.font="800 168px Inter,Segoe UI,sans-serif";x.textAlign="center";x.textBaseline="middle";x.fillText(text,128,140);
      const tex=new THREE.CanvasTexture(c);tex.anisotropy=MAXANISO;tex.minFilter=THREE.LinearFilter;tex.generateMipmaps=false;
      const m=new THREE.Mesh(new THREE.PlaneGeometry(size,size),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false}));
      m.rotation.x=-Math.PI/2;return m;}
    const _a=new THREE.Color(),_b=new THREE.Color();
    function ramp(t,a,b){_a.set(a);_b.set(b);return _a.clone().lerp(_b,clamp(t,0,1));}

    // ---------- readouts ----------
    function setMetric(k,v){const m=metricEls[k];if(m)m.strong.textContent=v;}
    function setMetricLabel(k,v){const m=metricEls[k];if(m)m.span.textContent=v;}
    function setSelectedText(t){refs.selected.textContent=t;}
    function setParam(k,v){state[k]=v;const pi=paramInputs[k];if(pi){pi.input.value=v;const p=paramDefs[k];pi.out.textContent=p&&p.fmt?p.fmt(v):v;}}
    function setParamRange(k,r){const pi=paramInputs[k];if(pi){if(r.min!=null)pi.input.min=r.min;if(r.max!=null)pi.input.max=r.max;}}

    // ---------- api ----------
    const api={THREE,scene,root,state,group,clear:name=>clearGroup(group(name)),
      label,bigLabel,flatNum,ramp,
      pick:(mesh,data)=>{mesh.userData.pick=data;},
      setMetric,setMetricLabel,setSelected:setSelectedText,setParam,setParamRange,
      frame:(center,radius)=>{if(center){tgt.cx=center[0];tgt.cy=center[1];tgt.cz=center[2];}if(radius)tgt.r=clamp(radius,3,40);},
      COL:{cyan:"#4dd7ff",violet:"#a78bfa",amber:"#fbbf24",rose:"#fb7185",green:"#34d399",white:"#ffffff"}};

    // ---------- update / telemetry ----------
    function applyLayers(){if(cfg.layers)cfg.layers.forEach(L=>{const g=groups.get(L.group);if(g)g.visible=layerState[L.group];});}
    // dim + disable params that have no effect in the current mode (param.modes = list of modes it applies to)
    function applyParamModes(){(cfg.params||[]).forEach(p=>{if(!p.modes)return;const pi=paramInputs[p.key];if(!pi)return;
      const on=p.modes.indexOf(state.mode)>=0;pi.input.disabled=!on;const ctl=pi.input.parentNode;if(ctl)ctl.classList.toggle("dim",!on);});}
    // disable a layer toggle when its group is empty in the current scene
    function applyLayerEnable(){if(!cfg.layers)return;cfg.layers.forEach(L=>{const b=layerBtns[L.group],g=groups.get(L.group);if(!b)return;
      const empty=!g||g.children.length===0;b.disabled=empty;b.classList.toggle("off",empty);});}
    function writeTelemetry(){const t=snapshot();shell.dataset.mode=t.mode;
      Object.keys(t).forEach(k=>{if(typeof t[k]==="number")shell.dataset[k]=(""+t[k]).slice(0,8);});}
    function update(reframe){
      clearAll();
      const res=cfg.build(api)||{};
      if(res.metrics)for(const k in res.metrics)setMetric(k,res.metrics[k]);
      if(res.metricLabels)for(const k in res.metricLabels)setMetricLabel(k,res.metricLabels[k]);
      if(res.badge!=null)refs.badge.textContent=res.badge;
      if(res.formula!=null)refs.formula.innerHTML=res.formula;
      if(res.insight!=null)refs.insight.textContent=res.insight;
      if(res.insightLabel!=null)refs.insightlbl.textContent=res.insightLabel;
      if(res.state!=null)refs.state.textContent=res.state;
      applyLayers();applyParamModes();applyLayerEnable();
      if(res.focus){const f=res.focus;if(f.center){tgt.cx=f.center[0];tgt.cy=f.center[1];tgt.cz=f.center[2];}
        if(reframe&&f.radius)tgt.r=clamp(f.radius,3,40);}
      writeTelemetry();
    }
    function resetAll(){
      if(cfg.modes){state.mode=cfg.modes[0].value;const ms=shell.querySelector("#ml-mode");if(ms)ms.value=state.mode;}
      (cfg.params||[]).forEach(p=>setParam(p.key,p.value));
      state.step=0;state.sel=null;setSelectedText(cfg.selectedHint||"Click an object to inspect it.");
      tgt.theta=d0.theta;tgt.phi=d0.phi;tgt.r=d0.r;
      Object.keys(presetBtns).forEach(k=>presetBtns[k].setAttribute("aria-pressed",k==="3d"?"true":"false"));
      if(cfg.onReset)cfg.onReset(api);
      if(cfg.onMode)cfg.onMode(api);
      update(true);
    }

    function snapshot(){const s={mode:state.mode,step:state.step,
      cameraTheta:+cur.theta.toFixed(3),cameraPhi:+cur.phi.toFixed(3),cameraRadius:+cur.r.toFixed(2)};
      (cfg.params||[]).forEach(p=>s[p.key]=state[p.key]);
      if(cfg.snapshot)Object.assign(s,cfg.snapshot(state));return s;}
    window.__gLabSnapshot=snapshot; if(cfg.id)window["__"+cfg.id+"LabSnapshot"]=snapshot;
    Object.defineProperty(window,"__mlReady",{configurable:true,get:()=>true});

    // ---------- interaction ----------
    let dragging=false,moved=false,lx=0,ly=0;
    viewport.addEventListener("pointerdown",e=>{dragging=true;moved=false;lx=e.clientX;ly=e.clientY;viewport.setPointerCapture(e.pointerId);});
    viewport.addEventListener("pointermove",e=>{if(!dragging)return;const dx=e.clientX-lx,dy=e.clientY-ly;if(Math.abs(dx)+Math.abs(dy)>3)moved=true;
      tgt.theta-=dx*0.008;tgt.phi=clamp(tgt.phi-dy*0.006,0.12,1.5);cur.theta=tgt.theta;cur.phi=tgt.phi;lx=e.clientX;ly=e.clientY;});
    viewport.addEventListener("pointerup",e=>{dragging=false;if(!moved)pick(e);});
    viewport.addEventListener("wheel",e=>{e.preventDefault();tgt.r=clamp(tgt.r+Math.sign(e.deltaY)*0.6,4,30);},{passive:false});
    const ray=new THREE.Raycaster(),mouse=new THREE.Vector2();
    function pick(e){const r=canvas.getBoundingClientRect();mouse.x=((e.clientX-r.left)/r.width)*2-1;mouse.y=-((e.clientY-r.top)/r.height)*2+1;
      ray.setFromCamera(mouse,camera);const hits=ray.intersectObjects(root.children,true);
      for(const h of hits){let o=h.object;while(o&&!(o.userData&&o.userData.pick))o=o.parent;
        if(o&&o.userData.pick){state.sel=o.userData.pick;if(cfg.onSelect)cfg.onSelect(api,o.userData.pick);update(false);return;}}}

    // ---------- resize + loop ----------
    function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);
      camera.aspect=w/h;camera.updateProjectionMatrix();}
    new ResizeObserver(resize).observe(viewport);
    function loop(t){requestAnimationFrame(loop);
      cur.theta+=(tgt.theta-cur.theta)*0.16;cur.phi+=(tgt.phi-cur.phi)*0.16;cur.r+=(tgt.r-cur.r)*0.16;
      cur.cx+=(tgt.cx-cur.cx)*0.12;cur.cy+=(tgt.cy-cur.cy)*0.12;cur.cz+=(tgt.cz-cur.cz)*0.12;
      placeCamera();if(cfg.tick)cfg.tick(api,t);renderer.render(scene,camera);}
    resize();placeCamera();
    if(cfg.onMode)cfg.onMode(api);
    update(true);
    requestAnimationFrame(loop);
    return api;
  }

  window.MathLab={create};
})();
