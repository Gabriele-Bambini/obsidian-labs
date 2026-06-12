/* ===========================================================================
   MathLab engine v2 — reusable 3D lesson-lab runtime.
   ---------------------------------------------------------------------------
   PUBLIC API CONTRACT (100% byte-compatible with v1 — existing labs a01..a14,
   b01..b06 depend on every line of this contract; do NOT change shapes):

   GLOBAL REQUIREMENT
     window.THREE must be the three.js r128 global, loaded BEFORE this file.

   ENTRY
     window.MathLab.create(cfg) -> api

   cfg FIELDS
     id            string   lab id; drives shell[data-lab-id], window.__<id>LabSnapshot
     kind          string   optional slug for shell[data-lab-kind]
     eyebrow       string   drawer eyebrow
     title         string   drawer h1
     subtitle      string   drawer sub
     selectedLabel string   label for the "selected object" corner card
     selectedHint  string   placeholder text for the selected card
     insightLabel  string   heading above the insight paragraph
     hint          string   HTML legend pinned at the bottom of the right drawer
     modes         [{value,label}]            structure selector (#ml-mode)
     params        [{key,label,min,max,step,value,fmt,modes:[...]}]  range inputs (#ml-p-<key>)
     metrics       [{key,label,accent}]       readout chips
     layers        [{group,label}]            visibility toggles (group == api.group name)
     views         [{key,label,theta,phi}]    camera presets (defaults provided)
     defaultCam    {theta,phi,r}              initial / reset camera
     primary       {label,on(api)}            primary action button
     secondary     {label,on(api)}            secondary action button
     build(api) -> {badge, formula, insight, insightLabel, state,
                    metrics:{key:val}, metricLabels:{key:val}, focus:{center,radius}}
     snapshot(state) -> obj                   merged into the engine snapshot
     onMode(api)            optional   fired after a mode change / first build
     onParam(api,key)       optional   fired after a param input changes
     onSelect(api,data)     optional   fired after a pick
     onReset(api)           optional   fired during reset
     tick(api,t)            optional   per-frame hook (t = rAF timestamp)
     -- v2 additive, all default-OFF (omit => v1 behavior bit-for-bit) --
     tune              partial override of the internal TUNE constants
     selfTest          bool   when true, snapshot() carries a ._selfTest block
     snapshotPrecision int    when set, param values in snapshot() round to N decimals

   api SURFACE  (every member below is preserved from v1)
     THREE, scene, root, state, group(name), clear(name),
     label(text,color,scale), bigLabel(text,color,worldW), flatNum(text,color,size),
     ramp(t,a,b), pick(mesh,data),
     setMetric(k,v), setMetricLabel(k,v), setSelected(t),
     setParam(k,v), setParamRange(k,{min,max}), frame(center,radius), COL
   api SURFACE  (v2 additive uniformity layer — existing labs ignore these)
     col(name|hex), accent(name), mat(color,opts),
     node(pos,opts), edge(a,b,opts), arrow(from,to,opts), halo(pos,opts),
     plane(pos,opts), legend(items,opts), connectRamp(a,b,t,opts),
     setMode(value) -> bool, dispose() -> void

   snapshot() KEYS
     mode, step, cameraTheta, cameraPhi, cameraRadius, <param keys>,
     ...cfg.snapshot(state), [._selfTest when cfg.selfTest]

   AUTO-EXPOSED GLOBALS
     window.__gLabSnapshot()          latest engine snapshot()
     window.__<cfg.id>LabSnapshot()   same, id-scoped
     window.__mlReady === true        readiness flag for verifiers

   PUBLIC DOM (verifier-stable; never rename)
     ids:     #ml-vp #ml-canvas #ml-badge #ml-badge-val #ml-selected #ml-views
              #ml-toggle-right #ml-drawer-right #ml-metrics #ml-insightlbl
              #ml-insight #ml-state #ml-hint #ml-dock-bottom #ml-dock-head
              #ml-formula #ml-command #ml-mode #ml-p-<key>
     classes: ml-shell ml-stage ml-viewport ml-corner-tl ml-badge ml-selected
              ml-views ml-viewrow lbl ml-toggle-right ml-drawer-right eyebrow
              sub ml-scroll ml-metrics ml-metric k-<accent> ml-insight state
              ml-hint ml-dock-bottom ml-dock-head ml-grip ml-formula ml-caret
              ml-command ctl mode ml-btns primary dim off controls-open stats-open err
   =========================================================================== */
(function(){
  "use strict";
  const THREE = window.THREE;
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const el = (tag,cls,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;};
  const isFin = Number.isFinite;
  const safeNum=(v,def)=>{const n=parseFloat(v);return isFin(n)?n:def;};

  function create(cfg){
    // ---------- §1.3 early fail-loud guards ----------
    if(!THREE) throw new Error("MathLab.create: THREE (r128) must be loaded before lab-engine.js.");
    if(!cfg || typeof cfg!=="object") throw new Error("MathLab.create: cfg object required.");
    if(cfg.modes && !cfg.modes.length) throw new Error("MathLab.create: cfg.modes must be non-empty if provided.");

    // ---------- §1.2 TUNE block (single source for magic numbers; defaults == v1) ----------
    const TUNE_DEFAULT = {
      orbitLerp:0.16, centerLerp:0.12, phiMin:0.12, phiMax:1.5,
      zoomMin:4, zoomMax:30, frameMin:3, frameMax:40,
      dragX:0.008, dragY:0.006, wheel:0.6, pinch:0.045, zoomBtn:2, fog:0.019,
      dpiMin:2, dpiMax:3, gridSize:44, gridDiv:44
    };
    const TUNE = Object.assign({}, TUNE_DEFAULT, (cfg && cfg.tune) ? cfg.tune : {});

    // ---------- shell DOM ----------
    const presets = cfg.views || [
      {key:"3d",label:"3D",theta:-0.62,phi:0.84},
      {key:"top",label:"Top",theta:-0.62,phi:0.16},
      {key:"front",label:"Front",theta:-1.5708,phi:1.16}
    ];
    const shell = el("main","ml-shell");
    shell.dataset.labId = cfg.id; shell.dataset.labKind = cfg.kind||"";
    // §1.4 re-entry guard: tear down a prior renderer/rAF loop for the same lab id
    if(cfg.id){ const prev=document.querySelector('.ml-shell[data-lab-id="'+cfg.id+'"]');
      if(prev && prev.__mlDispose) prev.__mlDispose(); }
    shell.innerHTML =
      '<div class="ml-stage">'+
        '<div class="ml-viewport" id="ml-vp" title="Drag / one-finger to orbit · wheel / pinch / zoom buttons to zoom · click to inspect"><canvas id="ml-canvas"></canvas></div>'+
        '<div class="ml-corner-tl">'+
          // §1.6 duplicate id fix: value lives in #ml-badge-val; outer div keeps #ml-badge
          '<div class="ml-badge" id="ml-badge"><span>Live structure</span><strong id="ml-badge-val">—</strong></div>'+
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
          '<div class="ml-dock-head" id="ml-dock-head" role="button" tabindex="0" aria-label="Show / hide controls" title="Show / hide controls"><span class="ml-grip"></span><span class="ml-formula" id="ml-formula"></span><span class="ml-caret">&#9662;</span></div>'+
          '<div class="ml-command" id="ml-command"></div>'+
        '</div>'+
      '</div>';
    document.body.appendChild(shell);

    // ---------- §1.5 no-scroll self-enforcement (survives a missing stylesheet) ----------
    const _he=document.documentElement, _be=document.body;
    _he.style.overflow=_be.style.overflow="hidden"; _he.style.height=_be.style.height="100%";
    _be.style.margin="0"; shell.style.overflow="hidden";

    shell.classList.add("controls-open");
    const _dockHead=shell.querySelector("#ml-dock-head");
    const _toggleControls=()=>shell.classList.toggle("controls-open");
    _dockHead.addEventListener("click",_toggleControls);
    // §1.11 a11y: keyboard-toggle the controls dock
    _dockHead.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();_toggleControls();}});
    const _tR=shell.querySelector("#ml-toggle-right");
    _tR.addEventListener("click",()=>{const open=shell.classList.toggle("stats-open");_tR.setAttribute("aria-expanded",String(open));});

    const $ = id=>shell.querySelector("#"+id);
    const refs = {badge:$("ml-badge-val"),formula:$("ml-formula"),selected:$("ml-selected"),
      insight:$("ml-insight"),insightlbl:$("ml-insightlbl"),state:$("ml-state")};
    const canvas=$("ml-canvas"), viewport=$("ml-vp");

    // ---------- state + controls ----------
    const paramDefs={}; const paramInputs={};
    const state={ mode: cfg.modes?String(cfg.modes[0].value):null, step:0, sel:null };
    (cfg.params||[]).forEach(p=>{paramDefs[p.key]=p; state[p.key]=p.value;});

    const cmd=$("ml-command");
    let modeSelect=null;
    if(cfg.modes){
      const wrap=el("div","ctl mode"); wrap.innerHTML='<label for="ml-mode">structure</label>';
      const sel=el("select"); sel.id="ml-mode"; modeSelect=sel;
      cfg.modes.forEach(m=>{const o=el("option");o.value=String(m.value);o.textContent=m.label;sel.appendChild(o);});
      sel.value=state.mode;
      // §1.9 single mode code path: route the inline change handler through api.setMode
      sel.addEventListener("change",()=>{ setMode(sel.value); });
      wrap.appendChild(sel);cmd.appendChild(wrap);
    }
    (cfg.params||[]).forEach(p=>{
      const wrap=el("div","ctl");
      const out=el("output"); out.textContent=p.fmt?p.fmt(p.value):p.value;
      const lab=el("label"); lab.setAttribute("for","ml-p-"+p.key); lab.textContent=p.label+" "; lab.appendChild(out);
      const inp=el("input"); inp.type="range"; inp.id="ml-p-"+p.key; inp.min=p.min; inp.max=p.max; inp.step=p.step; inp.value=p.value;
      inp.addEventListener("input",()=>{
        // §1.7 clamp-on-ingress: guard non-finite + clamp into the declared range
        let v=safeNum(inp.value,state[p.key]); v=clamp(v,p.min,p.max); state[p.key]=v;
        out.textContent=p.fmt?p.fmt(v):v;
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
    // §v2 universal zoom controls — work on every device (wheel is dead on touch / inside scrolling iframes)
    const zoomBy=d=>{tgt.r=clamp(tgt.r+d,TUNE.zoomMin,TUNE.zoomMax);};
    camRow.appendChild(el("span","lbl","zoom"));
    const zInBtn=el("button",null,"+");zInBtn.type="button";zInBtn.id="ml-zoom-in";zInBtn.title="Zoom in";zInBtn.setAttribute("aria-label","Zoom in");
    zInBtn.addEventListener("click",()=>zoomBy(-TUNE.zoomBtn));
    const zOutBtn=el("button",null,"−");zOutBtn.type="button";zOutBtn.id="ml-zoom-out";zOutBtn.title="Zoom out";zOutBtn.setAttribute("aria-label","Zoom out");
    zOutBtn.addEventListener("click",()=>zoomBy(TUNE.zoomBtn));
    camRow.appendChild(zInBtn);camRow.appendChild(zOutBtn);
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
    renderer.setPixelRatio(clamp(window.devicePixelRatio||1,TUNE.dpiMin,TUNE.dpiMax)); // supersample: crisp output
    const scene=new THREE.Scene();
    scene.fog=new THREE.FogExp2(0x070b14,TUNE.fog);
    const camera=new THREE.PerspectiveCamera(44,1,0.1,200);
    const root=new THREE.Group(); scene.add(root);
    scene.add(new THREE.HemisphereLight(0xc6dcff,0x0a1018,0.78));
    scene.add(new THREE.AmbientLight(0x9fb4cc,0.22));
    const key=new THREE.DirectionalLight(0xffffff,0.95); key.position.set(5,9,6); scene.add(key);
    const rim=new THREE.DirectionalLight(0x6aa8ff,0.5); rim.position.set(-6,4,-6); scene.add(rim);
    // ground grid (spatial reference) + soft platform glow
    const grid=new THREE.GridHelper(TUNE.gridSize,TUNE.gridDiv,0x335a82,0x18324c);
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
    function setParam(k,v){
      // §1.7 clamp-on-ingress for programmatic callers
      v=safeNum(v,state[k]);const p=paramDefs[k];if(p)v=clamp(v,p.min,p.max);state[k]=v;
      const pi=paramInputs[k];if(pi){pi.input.value=v;pi.out.textContent=p&&p.fmt?p.fmt(v):v;}}
    function setParamRange(k,r){const pi=paramInputs[k];if(pi){if(r.min!=null)pi.input.min=r.min;if(r.max!=null)pi.input.max=r.max;}}

    // ---------- §1.14 uniformity-layer color/material helpers ----------
    const COL={cyan:"#4dd7ff",violet:"#a78bfa",amber:"#fbbf24",rose:"#fb7185",green:"#34d399",white:"#ffffff"};
    // 5-hue accent ramp triplets — shared color system with figure-kit PALETTE.accent
    const ACCENT={
      cyan:  {base:"#4dd7ff", light:"#9fe0ff", tint:"#0e2740"},
      rose:  {base:"#fb7185", light:"#fda4b0", tint:"#3a1420"},
      amber: {base:"#fbbf24", light:"#fde68a", tint:"#33270a"},
      violet:{base:"#a78bfa", light:"#c4b5fd", tint:"#241a40"},
      green: {base:"#34d399", light:"#7fe7c0", tint:"#152a18"}
    };
    function col(name){ if(name==null) return COL.cyan;
      if(typeof name==="string" && name[0]==="#") return name;
      if(COL[name]) return COL[name];
      if(ACCENT[name]) return ACCENT[name].base;
      return String(name); }
    function accent(name){ return ACCENT[name] || ACCENT.cyan; }
    function mat(color,opts){opts=opts||{};const hex=col(color);
      if(opts.basic) return new THREE.MeshBasicMaterial({color:hex});
      const em=(opts.emissive==null)?0.35:opts.emissive;
      const rough=(opts.rough==null)?0.4:opts.rough;
      const metal=(opts.metal==null)?0:opts.metal;
      const emCol=new THREE.Color(hex).multiplyScalar(em);
      return new THREE.MeshStandardMaterial({color:hex,emissive:emCol,emissiveIntensity:0.9,roughness:rough,metalness:metal});}

    const _v0=new THREE.Vector3(),_v1=new THREE.Vector3(),_vd=new THREE.Vector3(),_up=new THREE.Vector3(0,1,0),_q=new THREE.Quaternion();
    const asVec=p=>Array.isArray(p)?new THREE.Vector3(p[0],p[1],p[2]):p.clone?p.clone():new THREE.Vector3(p.x,p.y,p.z);
    function fileInto(obj,opts){ if(opts&&opts.group) group(opts.group).add(obj); else root.add(obj); return obj; }

    // additive radial glow sprite (factored from the platform-glow code)
    function haloSprite(color,opacity){
      const c=document.createElement("canvas");c.width=c.height=256;const g=c.getContext("2d");
      const gr=g.createRadialGradient(128,128,4,128,128,128);
      const tc=new THREE.Color(col(color)); const rgb=Math.round(tc.r*255)+","+Math.round(tc.g*255)+","+Math.round(tc.b*255);
      gr.addColorStop(0,"rgba("+rgb+","+(opacity==null?0.85:opacity)+")");
      gr.addColorStop(0.55,"rgba("+rgb+",0.12)"); gr.addColorStop(1,"rgba("+rgb+",0)");
      g.fillStyle=gr;g.fillRect(0,0,256,256);
      const tex=new THREE.CanvasTexture(c);tex.anisotropy=MAXANISO;tex.minFilter=THREE.LinearFilter;tex.generateMipmaps=false;
      return new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
    }
    function halo(pos,opts){opts=opts||{};const r=opts.r==null?0.9:opts.r;
      const sp=haloSprite(opts.color||"cyan",opts.opacity);const p=asVec(pos);sp.position.copy(p);sp.scale.set(r*2,r*2,1);
      return fileInto(sp,opts);}

    function node(pos,opts){opts=opts||{};const r=opts.r==null?0.34:opts.r;const p=asVec(pos);
      const g=new THREE.Group();g.position.copy(p);
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(r,32,24),mat(opts.color||"cyan"));g.add(mesh);
      if(opts.halo!==false){const hs=haloSprite(opts.color||"cyan",0.85);const hsc=(opts.haloScale==null?2.4:opts.haloScale)*r;hs.scale.set(hsc,hsc,1);g.add(hs);}
      if(opts.label!=null){const lb=bigLabel(String(opts.label),col(opts.labelColor||"#e8eef6"),r*2.2);lb.position.set(0,r*1.9,0);g.add(lb);}
      if(opts.pick!=null)mesh.userData.pick=opts.pick;
      return fileInto(g,opts);}

    function edge(a,b,opts){opts=opts||{};const pa=asVec(a),pb=asVec(b);
      const cHex=col(opts.color||"#2a3a4e");const w=opts.width==null?0.045:opts.width;
      if(opts.dashed){
        const geo=new THREE.BufferGeometry().setFromPoints([pa,pb]);
        const lm=new THREE.LineDashedMaterial({color:cHex,dashSize:0.18,gapSize:0.12,transparent:true,opacity:opts.opacity==null?0.95:opts.opacity});
        const ln=new THREE.LineSegments(geo,lm);ln.computeLineDistances();return fileInto(ln,opts);
      }
      const len=pa.distanceTo(pb);
      const geo=new THREE.CylinderGeometry(w,w,len,12,1,true);
      const m=new THREE.MeshStandardMaterial({color:cHex,emissive:new THREE.Color(cHex).multiplyScalar(0.18),roughness:0.5,metalness:0,transparent:true,opacity:opts.opacity==null?0.95:opts.opacity});
      const mesh=new THREE.Mesh(geo,m);
      mesh.position.copy(pa).add(pb).multiplyScalar(0.5);
      _vd.copy(pb).sub(pa).normalize();_q.setFromUnitVectors(_up,_vd);mesh.quaternion.copy(_q);
      return fileInto(mesh,opts);}

    function arrow(from,to,opts){opts=opts||{};const pa=asVec(from),pb=asVec(to);
      const cHex=col(opts.color||"cyan");const head=opts.head==null?0.22:opts.head;const w=opts.width==null?0.045:opts.width;
      const g=new THREE.Group();
      _vd.copy(pb).sub(pa);const full=_vd.length();_vd.normalize();
      const shaftLen=Math.max(0.0001,full-head);
      const shaftGeo=new THREE.CylinderGeometry(w,w,shaftLen,12,1,true);
      const shaftMat=new THREE.MeshStandardMaterial({color:cHex,emissive:new THREE.Color(cHex).multiplyScalar(0.2),roughness:0.5,metalness:0});
      const shaft=new THREE.Mesh(shaftGeo,shaftMat);
      const shaftMid=pa.clone().add(_vd.clone().multiplyScalar(shaftLen*0.5));shaft.position.copy(shaftMid);
      _q.setFromUnitVectors(_up,_vd);shaft.quaternion.copy(_q);g.add(shaft);
      const coneGeo=new THREE.ConeGeometry(head*0.6,head,16);
      const cone=new THREE.Mesh(coneGeo,mat(opts.color||"cyan",{emissive:0.4}));
      const coneCtr=pa.clone().add(_vd.clone().multiplyScalar(full-head*0.5));cone.position.copy(coneCtr);cone.quaternion.copy(_q);g.add(cone);
      if(opts.label!=null){const lb=bigLabel(String(opts.label),col(opts.labelColor||cHex),0.6);
        const mid=pa.clone().add(pb).multiplyScalar(0.5);lb.position.copy(mid).add(new THREE.Vector3(0,0.22,0));g.add(lb);}
      return fileInto(g,opts);}

    function plane(pos,opts){opts=opts||{};const w=opts.w==null?2:opts.w,h=opts.h==null?2:opts.h;
      const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),
        new THREE.MeshBasicMaterial({color:col(opts.color||"cyan"),transparent:true,opacity:opts.opacity==null?0.18:opts.opacity,side:THREE.DoubleSide,depthWrite:false}));
      m.position.copy(asVec(pos));if(opts.flat!==false)m.rotation.x=-Math.PI/2;
      return fileInto(m,opts);}

    function legend(items,opts){opts=opts||{};items=items||[];const scale=opts.scale==null?0.5:opts.scale;const gap=opts.gap==null?0.6:opts.gap;
      const g=new THREE.Group();
      items.forEach((it,i)=>{const row=new THREE.Group();row.position.y=-i*gap;
        const dot=new THREE.Mesh(new THREE.SphereGeometry(scale*0.18,16,12),mat(it.color||"cyan",{emissive:0.5}));dot.position.x=-scale*0.7;row.add(dot);
        const lb=bigLabel(String(it.label),col("#cfe0f0"),scale*2);lb.position.x=scale*0.55;row.add(lb);
        g.add(row);});
      const corner=opts.corner||"bl"; const ox=(corner==="bl"||corner==="tl")?-5.4:3.4; const oy=(corner==="tl"||corner==="tr")?3.2:-3.0;
      g.position.set(ox,oy,0);
      return fileInto(g,opts);}

    function connectRamp(a,b,t,opts){opts=opts||{};
      const fromC=accent(opts.from||"rose").base, toC=accent(opts.to||"green").base;
      const c=ramp(clamp(safeNum(t,0),0,1),fromC,toC);
      const hex="#"+c.getHexString();
      return edge(a,b,{color:hex,width:opts.width==null?0.045:opts.width,group:opts.group});}

    // ---------- api ----------
    const api={THREE,scene,root,state,group,clear:name=>clearGroup(group(name)),
      label,bigLabel,flatNum,ramp,
      pick:(mesh,data)=>{mesh.userData.pick=data;},
      setMetric,setMetricLabel,setSelected:setSelectedText,setParam,setParamRange,
      frame:(center,radius)=>{
        // §1.7 finite-guard each component; clamp radius
        if(center){if(isFin(center[0]))tgt.cx=center[0];if(isFin(center[1]))tgt.cy=center[1];if(isFin(center[2]))tgt.cz=center[2];}
        if(radius!=null)tgt.r=clamp(safeNum(radius,tgt.r),TUNE.frameMin,TUNE.frameMax);},
      COL,
      // v2 additive uniformity layer
      col,accent,mat,node,edge,arrow,halo,plane,legend,connectRamp,
      setMode:setMode,
      dispose:()=>dispose()};

    // ---------- update / telemetry ----------
    function applyLayers(){if(cfg.layers)cfg.layers.forEach(L=>{const g=groups.get(L.group);if(g)g.visible=layerState[L.group];});}
    // dim + disable params that have no effect in the current mode (param.modes = list of modes it applies to)
    function applyParamModes(){(cfg.params||[]).forEach(p=>{if(!p.modes)return;const pi=paramInputs[p.key];if(!pi)return;
      const on=p.modes.indexOf(state.mode)>=0;pi.input.disabled=!on;const ctl=pi.input.parentNode;if(ctl)ctl.classList.toggle("dim",!on);});}
    // disable a layer toggle when its group is empty in the current scene
    function applyLayerEnable(){if(!cfg.layers)return;cfg.layers.forEach(L=>{const b=layerBtns[L.group],g=groups.get(L.group);if(!b)return;
      const empty=!g||g.children.length===0;b.disabled=empty;b.classList.toggle("off",empty);});}
    // §1.12 telemetry hardening: back-compat data-<key> + data-mode, plus namespaced data-ml-<key>
    function writeTelemetry(){const t=snapshot();shell.dataset.mode=String(t.mode);
      Object.keys(t).forEach(k=>{const v=t[k];if(typeof v!=="number")return;if(!isFin(v))return;
        const s=v.toFixed(4).slice(0,10);
        shell.dataset[k]=(""+v).slice(0,8);            // legacy key (back-compat)
        try{shell.setAttribute("data-ml-"+k,s);}catch(e){} });}
    function update(reframe){
      clearAll();
      // §1.8 build() try/catch: one bad rebuild never freezes the rAF loop
      let res={};
      try{ res=cfg.build(api)||{};
        if(refs.state)refs.state.classList.remove("err");
      }catch(err){ console.error("[MathLab build error]",err);
        if(refs.state){refs.state.textContent="build error: "+((err&&err.message)||err);refs.state.classList.add("err");}
        res={}; }
      if(res.metrics)for(const k in res.metrics)setMetric(k,res.metrics[k]);
      if(res.metricLabels)for(const k in res.metricLabels)setMetricLabel(k,res.metricLabels[k]);
      if(res.badge!=null)refs.badge.textContent=res.badge;
      if(res.formula!=null)refs.formula.innerHTML=res.formula;
      if(res.insight!=null)refs.insight.textContent=res.insight;
      if(res.insightLabel!=null)refs.insightlbl.textContent=res.insightLabel;
      if(res.state!=null && !refs.state.classList.contains("err"))refs.state.textContent=res.state;
      applyLayers();applyParamModes();applyLayerEnable();
      if(res.focus){const f=res.focus;
        if(f.center){if(isFin(f.center[0]))tgt.cx=f.center[0];if(isFin(f.center[1]))tgt.cy=f.center[1];if(isFin(f.center[2]))tgt.cz=f.center[2];}
        if(reframe&&f.radius!=null)tgt.r=clamp(safeNum(f.radius,tgt.r),TUNE.frameMin,TUNE.frameMax);}
      writeTelemetry();
    }

    // §1.9 unified mode handler — the single code path for mode changes
    function setMode(value){
      value=String(value);
      if(cfg.modes && !cfg.modes.some(m=>String(m.value)===value)) return false;
      state.mode=value; if(modeSelect)modeSelect.value=value;
      state.step=0; state.sel=null;
      setSelectedText(cfg.selectedHint||"Click an object to inspect it.");
      if(cfg.onMode)cfg.onMode(api);
      update(true);
      return true;
    }

    function resetAll(){
      // §1.9 verify the first mode option exists before assigning
      if(cfg.modes&&cfg.modes.length){state.mode=String(cfg.modes[0].value);if(modeSelect)modeSelect.value=state.mode;}
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
      const prec=cfg.snapshotPrecision;
      (cfg.params||[]).forEach(p=>{let v=state[p.key];
        if(typeof v==="number" && prec!=null && isFin(v)){const f=Math.pow(10,prec|0);v=Math.round(v*f)/f;}
        s[p.key]=v;});
      // §1.13 opt-in self-test, merged BEFORE cfg.snapshot so labs can override
      if(cfg.selfTest)Object.assign(s,{_selfTest:{
        noScroll: document.documentElement.scrollHeight <= window.innerHeight+1,
        controlsResponsive: !!cmd && cmd.querySelectorAll("input,select,button").length>0,
        modeCount: cfg.modes?cfg.modes.length:0,
        paramCount:(cfg.params||[]).length,
        metricCount:(cfg.metrics||[]).length,
        layerCount:(cfg.layers||[]).length,
        ready:(window.__mlReady===true),
        webgl: !!renderer.getContext()
      }});
      if(cfg.snapshot)Object.assign(s,cfg.snapshot(state));return s;}
    window.__gLabSnapshot=snapshot; if(cfg.id)window["__"+cfg.id+"LabSnapshot"]=snapshot;
    Object.defineProperty(window,"__mlReady",{configurable:true,get:()=>true});

    // ---------- interaction ----------
    let dragging=false,moved=false,lx=0,ly=0;
    const RM=window.matchMedia?window.matchMedia("(prefers-reduced-motion:reduce)"):{matches:false};
    viewport.addEventListener("pointerdown",e=>{if(e.pointerType==="touch")return;dragging=true;moved=false;lx=e.clientX;ly=e.clientY;
      try{viewport.setPointerCapture(e.pointerId);}catch(err){}});
    viewport.addEventListener("pointermove",e=>{if(!dragging||e.pointerType==="touch")return;const dx=e.clientX-lx,dy=e.clientY-ly;if(Math.abs(dx)+Math.abs(dy)>3)moved=true;
      tgt.theta+=dx*TUNE.dragX;tgt.phi=clamp(tgt.phi-dy*TUNE.dragY,TUNE.phiMin,TUNE.phiMax);cur.theta=tgt.theta;cur.phi=tgt.phi;lx=e.clientX;ly=e.clientY;});
    viewport.addEventListener("pointerup",e=>{if(e.pointerType==="touch")return;dragging=false;try{viewport.releasePointerCapture(e.pointerId);}catch(err){}if(!moved)pick(e);});
    // §1.11 cancel/lost-capture safety
    viewport.addEventListener("pointercancel",()=>{dragging=false;});
    viewport.addEventListener("lostpointercapture",()=>{dragging=false;});
    // §v2 touch gestures: one-finger orbit + two-finger pinch-zoom. Pointer/wheel events get
    // swallowed by the scrolling iframe on Android/iOS, so handle raw touch explicitly + preventDefault.
    let _tMode=0,_tlx=0,_tly=0,_tDist=0,_tMoved=false;
    const _tdist=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
    viewport.addEventListener("touchstart",e=>{
      if(e.touches.length===1){_tMode=1;_tlx=e.touches[0].clientX;_tly=e.touches[0].clientY;_tMoved=false;}
      else if(e.touches.length>=2){_tMode=2;_tDist=_tdist(e.touches);}
      if(viewport.contains(e.target))e.preventDefault();
    },{passive:false});
    viewport.addEventListener("touchmove",e=>{
      if(_tMode===1&&e.touches.length===1){
        const dx=e.touches[0].clientX-_tlx,dy=e.touches[0].clientY-_tly;
        if(Math.abs(dx)+Math.abs(dy)>3)_tMoved=true;
        tgt.theta+=dx*TUNE.dragX;tgt.phi=clamp(tgt.phi-dy*TUNE.dragY,TUNE.phiMin,TUNE.phiMax);
        cur.theta=tgt.theta;cur.phi=tgt.phi;_tlx=e.touches[0].clientX;_tly=e.touches[0].clientY;
      }else if(_tMode===2&&e.touches.length>=2){
        const d=_tdist(e.touches);tgt.r=clamp(tgt.r-(d-_tDist)*TUNE.pinch,TUNE.zoomMin,TUNE.zoomMax);_tDist=d;
      }
      if(viewport.contains(e.target))e.preventDefault();
    },{passive:false});
    viewport.addEventListener("touchend",e=>{
      if(_tMode===1&&!_tMoved&&e.changedTouches.length)pick(e.changedTouches[0]);
      if(e.touches.length===0)_tMode=0;
      else if(e.touches.length===1){_tMode=1;_tlx=e.touches[0].clientX;_tly=e.touches[0].clientY;_tMoved=false;}
      else _tMode=2;
    },{passive:false});
    viewport.addEventListener("touchcancel",()=>{_tMode=0;});
    viewport.addEventListener("wheel",e=>{
      // §1.11 only preventDefault when the wheel is over the viewport
      if(viewport.contains(e.target))e.preventDefault();
      tgt.r=clamp(tgt.r+Math.sign(e.deltaY)*TUNE.wheel,TUNE.zoomMin,TUNE.zoomMax);},{passive:false});
    // §1.11 keyboard nudge: arrows orbit, +/- zoom
    viewport.setAttribute("tabindex","0");
    viewport.addEventListener("keydown",e=>{
      if(e.key==="ArrowLeft"){tgt.theta-=0.12;e.preventDefault();}
      else if(e.key==="ArrowRight"){tgt.theta+=0.12;e.preventDefault();}
      else if(e.key==="ArrowUp"){tgt.phi=clamp(tgt.phi-0.08,TUNE.phiMin,TUNE.phiMax);e.preventDefault();}
      else if(e.key==="ArrowDown"){tgt.phi=clamp(tgt.phi+0.08,TUNE.phiMin,TUNE.phiMax);e.preventDefault();}
      else if(e.key==="+"||e.key==="="){tgt.r=clamp(tgt.r-TUNE.wheel,TUNE.zoomMin,TUNE.zoomMax);e.preventDefault();}
      else if(e.key==="-"||e.key==="_"){tgt.r=clamp(tgt.r+TUNE.wheel,TUNE.zoomMin,TUNE.zoomMax);e.preventDefault();}});
    const ray=new THREE.Raycaster(),mouse=new THREE.Vector2();
    function pick(e){const r=canvas.getBoundingClientRect();mouse.x=((e.clientX-r.left)/r.width)*2-1;mouse.y=-((e.clientY-r.top)/r.height)*2+1;
      ray.setFromCamera(mouse,camera);const hits=ray.intersectObjects(root.children,true);
      for(const h of hits){let o=h.object;while(o&&!(o.userData&&o.userData.pick))o=o.parent;
        if(o&&o.userData.pick){state.sel=o.userData.pick;if(cfg.onSelect)cfg.onSelect(api,o.userData.pick);update(false);return;}}}

    // ---------- resize + loop + dispose ----------
    let _rafId=0,_ro=null,_disposed=false;
    function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;if(!w||!h)return;
      // §1.10 DPR-aware: re-apply pixel ratio before setSize so monitor moves stay crisp
      renderer.setPixelRatio(clamp(window.devicePixelRatio||1,TUNE.dpiMin,TUNE.dpiMax));
      renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
    _ro=new ResizeObserver(resize);_ro.observe(viewport);
    function loop(t){_rafId=requestAnimationFrame(loop);
      if(RM.matches){ // §1.10 reduced-motion: snap instead of easing
        cur.theta=tgt.theta;cur.phi=tgt.phi;cur.r=tgt.r;cur.cx=tgt.cx;cur.cy=tgt.cy;cur.cz=tgt.cz;
      }else{
        cur.theta+=(tgt.theta-cur.theta)*TUNE.orbitLerp;cur.phi+=(tgt.phi-cur.phi)*TUNE.orbitLerp;cur.r+=(tgt.r-cur.r)*TUNE.orbitLerp;
        cur.cx+=(tgt.cx-cur.cx)*TUNE.centerLerp;cur.cy+=(tgt.cy-cur.cy)*TUNE.centerLerp;cur.cz+=(tgt.cz-cur.cz)*TUNE.centerLerp;
      }
      placeCamera();if(cfg.tick)cfg.tick(api,t);renderer.render(scene,camera);}

    // §1.11 full teardown — cancels rAF loop, disconnects observer, frees GPU, removes DOM
    function dispose(){ if(_disposed)return; _disposed=true;
      cancelAnimationFrame(_rafId); if(_ro)_ro.disconnect();
      clearAll(); try{renderer.dispose();}catch(e){}
      if(shell.parentNode)shell.parentNode.removeChild(shell);
      try{delete window.__gLabSnapshot;}catch(e){}
      if(cfg.id)try{delete window["__"+cfg.id+"LabSnapshot"];}catch(e){} }
    shell.__mlDispose=dispose;

    resize();placeCamera();
    if(cfg.onMode)cfg.onMode(api);
    update(true);
    _rafId=requestAnimationFrame(loop);
    return api;
  }

  window.MathLab={create};
})();
