(function () {
  const TAU = Math.PI * 2;
  if (typeof CanvasRenderingContext2D !== "undefined" && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      r = Math.min(r || 0, Math.abs(w) / 2, Math.abs(h) / 2);
      this.moveTo(x + r, y);
      this.lineTo(x + w - r, y);
      this.quadraticCurveTo(x + w, y, x + w, y + r);
      this.lineTo(x + w, y + h - r);
      this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      this.lineTo(x + r, y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - r);
      this.lineTo(x, y + r);
      this.quadraticCurveTo(x, y, x + r, y);
      return this;
    };
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fmt(v) { return Number(v).toFixed(2); }
  function getConfig() {
    const el = document.getElementById("lab-config");
    return JSON.parse(el.textContent);
  }
  function cylinderBetween(a, b, radius, material) {
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geom = new THREE.CylinderGeometry(radius, radius, len, 10);
    const mesh = new THREE.Mesh(geom, material);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return mesh;
  }
  function textSprite(text, color) {
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 80;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(5,12,15,0.72)";
    ctx.strokeStyle = "rgba(211,235,230,0.24)";
    ctx.lineWidth = 2;
    ctx.roundRect(8, 10, 304, 48, 18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color || "#dffbf8";
    ctx.font = "700 22px Inter, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(text).slice(0, 22), 160, 42);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.45, 0.36, 1);
    return sprite;
  }
  function setupRenderer(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x05090c, 8, 19);
    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
    camera.position.set(0, 4.8, 9.7);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const key = new THREE.DirectionalLight(0xefffff, 1.6);
    key.position.set(4, 6, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0x58e0d3, 0.8);
    rim.position.set(-4, 3, -3); scene.add(rim);
    const grid = new THREE.GridHelper(12, 16, 0x24424e, 0x16262e);
    grid.position.y = -1.45; scene.add(grid);
    return { renderer, scene, camera };
  }
  function createLab() {
    const cfg = getConfig();
    const safeId = cfg.lessonId.replace(/[^A-Za-z0-9]/g, "");
    const root = document.querySelector(".lab-shell");
    const canvas = document.getElementById("canvas");
    const selected = root.querySelector("[data-role='selected'] strong");
    const formula = document.getElementById("formulaText");
    const stateText = document.getElementById("state");
    const insight = root.querySelector("[data-role='insight']");
    const rail = root.querySelector(".concept-rail");
    const metricEls = Array.from(root.querySelectorAll("[data-role='metric'] strong"));
    const { renderer, scene, camera } = setupRenderer(canvas);
    const graph = new THREE.Group();
    const matrix = new THREE.Group();
    const bars = new THREE.Group();
    scene.add(graph, matrix, bars);
    matrix.position.set(4.35, 0.7, -0.4);
    bars.position.set(4.25, -1.18, 0.1);
    const state = { mode: "object", step: 0, depth: 3, evidence: 0.62, noise: 0.18, threshold: 0.5, spin: 0, lastControl: "initial", controls: {} };
    cfg.nodes.slice(0, 4).forEach((name) => { const span = document.createElement("span"); span.textContent = name; rail.appendChild(span); });
    formula.textContent = cfg.formula;
    insight.textContent = cfg.insight;
    function positions() {
      return cfg.nodes.map((_, i) => {
        const t = i / cfg.nodes.length * TAU;
        const r = 2.55 + (i % 3) * 0.18;
        const y = Math.sin(i * 1.37 + state.step * 0.08) * 0.85;
        return new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r);
      });
    }
    function clearGroup(g) {
      while (g.children.length) {
        const child = g.children.pop();
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose && m.dispose());
          else child.material.dispose && child.material.dispose();
        }
      }
    }
    function metrics() {
      const d = state.depth, e = state.evidence, n = state.noise, s = state.step;
      return [
        clamp(0.18 + e * 0.72 - n * 0.26 + Math.sin(s * 0.17) * 0.06, 0, 1),
        clamp(0.58 - d * 0.035 + n * 0.22 + Math.cos(s * 0.11) * 0.04, 0, 1),
        clamp(0.24 + d * 0.055 + e * 0.18 - n * 0.08, 0, 1),
        clamp(0.12 + n * 0.72 + (state.mode === "diagnostic" ? 0.22 : 0), 0, 1)
      ];
    }
    function rebuildScene() {
      clearGroup(graph); clearGroup(matrix); clearGroup(bars);
      const pts = positions();
      const colorSet = cfg.colors.map((c) => new THREE.Color(c));
      const edgeMat = new THREE.MeshStandardMaterial({ color: state.mode === "diagnostic" ? 0xff6d8b : 0x58e0d3, roughness: 0.45, metalness: 0.15, transparent: true, opacity: 0.58 });
      const edgePairs = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,0],[0,4],[2,6],[1,5]];
      edgePairs.forEach((pair, idx) => {
        const [a, b] = pair;
        const radius = 0.018 + (idx % 3) * 0.008 + state.evidence * 0.018;
        const edge = cylinderBetween(pts[a], pts[b], radius, edgeMat.clone());
        graph.add(edge);
        if ((idx + state.step) % 4 === 0) {
          const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.06 + state.evidence * 0.06, 16, 10), new THREE.MeshStandardMaterial({ color: 0xe8b857, emissive: 0x4b2d00 }));
          pulse.position.copy(pts[a]).lerp(pts[b], (state.step * 0.08 + idx * 0.13) % 1);
          graph.add(pulse);
        }
      });
      pts.forEach((p, i) => {
        const c = colorSet[i % colorSet.length];
        const radius = 0.28 + metrics()[i % 4] * 0.18;
        const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.18, emissive: c.clone().multiplyScalar(state.mode === "process" ? 0.22 : 0.08) });
        const node = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 18), mat);
        node.position.copy(p);
        graph.add(node);
        const label = textSprite(cfg.nodes[i], "#dffbf8");
        label.position.copy(p).add(new THREE.Vector3(0, 0.55, 0));
        graph.add(label);
      });
      for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
        const v = ((r * 7 + c * 11 + state.step + Math.round(state.evidence * 10)) % 13) / 13;
        const mat = new THREE.MeshStandardMaterial({ color: colorSet[(r + c) % colorSet.length], transparent: true, opacity: 0.18 + v * 0.72, roughness: 0.6 });
        const cell = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.06 + v * 0.34, 0.21), mat);
        cell.position.set((c - 2.5) * 0.28, (v * 0.25), (r - 2.5) * 0.28);
        matrix.add(cell);
      }
      metrics().forEach((m, i) => {
        const mat = new THREE.MeshStandardMaterial({ color: colorSet[i % colorSet.length], roughness: 0.42, metalness: 0.08 });
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18 + m * 1.5, 0.22), mat);
        bar.position.set((i - 1.5) * 0.35, (0.18 + m * 1.5) / 2, 0);
        bars.add(bar);
      });
    }
    function updateUi() {
      const values = metrics();
      metricEls.forEach((el, i) => { el.textContent = fmt(values[i] || 0); });
      selected.textContent = cfg.controls[state.step % cfg.controls.length] + " | " + cfg.kind;
      stateText.textContent = `${state.mode}: ${cfg.insight} Depth ${state.depth}, evidence ${fmt(state.evidence)}, noise ${fmt(state.noise)}.`;
    }
    function setMode(mode) {
      state.mode = mode; state.lastControl = mode; state.controls.mode = mode;
      rebuildScene(); updateUi();
    }
    function command(name) {
      state.lastControl = name; state.step += 1; state.controls[name] = String(state.step);
      if (/threshold|bias|diagnostic|false|leak/i.test(name)) state.mode = "diagnostic";
      else if (/spectrum|formal|matrix|score/i.test(name)) state.mode = "formal";
      else state.mode = "process";
      rebuildScene(); updateUi();
    }
    function bindControls() {
      root.querySelectorAll("select[data-mode]").forEach((select) => {
        select.value = state.mode;
        select.addEventListener("change", () => setMode(select.value));
      });
      root.querySelectorAll("button[data-mode]").forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.mode)));
      root.querySelectorAll("[data-command]").forEach((btn) => btn.addEventListener("click", () => command(btn.dataset.command)));
      root.querySelectorAll("[data-param]").forEach((input) => input.addEventListener("input", () => {
        const key = input.dataset.param;
        state[key] = key === "depth" ? Number(input.value) : Number(input.value) / 100;
        const out = root.querySelector(`[data-output="${key}"]`);
        if (out) out.textContent = key === "depth" ? state[key] : fmt(state[key]);
        state.controls[key] = String(input.value);
        rebuildScene(); updateUi();
      }));
    }
    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      renderer.setSize(Math.max(10, rect.width), Math.max(10, rect.height), false);
      camera.position.y = rect.width < 560 ? 5.15 : 4.8;
      camera.position.z = rect.width < 560 ? 14 : clamp(camera.position.z, 5.8, 14);
      camera.lookAt(0, 0, 0);
      camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    }
    let dragging = false, lastX = 0, lastY = 0;
    canvas.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      graph.rotation.y += (e.clientX - lastX) * 0.008;
      graph.rotation.x += (e.clientY - lastY) * 0.005;
      matrix.rotation.y += (e.clientX - lastX) * 0.005;
      lastX = e.clientX; lastY = e.clientY;
    });
    canvas.addEventListener("pointerup", () => { dragging = false; });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      camera.position.z = clamp(camera.position.z + (e.deltaY > 0 ? 0.45 : -0.45), 5.8, 14);
    }, { passive: false });
    function animate() {
      state.spin += 0.006;
      graph.rotation.y += 0.0015;
      matrix.rotation.y = -0.35 + Math.sin(state.spin) * 0.15;
      bars.rotation.y = 0.25 + Math.cos(state.spin) * 0.12;
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }
    window.addEventListener("resize", resize);
    bindControls(); resize(); rebuildScene(); updateUi(); animate();
    window[`__${safeId}LabReady`] = true;
    window[`__${safeId}LabSnapshot`] = function () {
      return {
        kind: "ai-knowledge-style-gnn-bio-lab",
        labId: cfg.lessonId,
        title: cfg.title,
        status: "ready",
        currentMode: state.mode,
        currentControl: state.lastControl,
        objectCount: graph.children.length,
        matrixCellCount: matrix.children.length,
        metricCount: metricEls.length,
        geometryHash: [state.mode, state.step, state.depth, state.evidence, state.noise, graph.rotation.x, graph.rotation.y].map(String).join("|"),
        metrics: metrics().map((value, i) => ({ name: cfg.metrics[i], value: Number(value.toFixed(4)) })),
        has3d: true,
        visualKind: cfg.kind,
        visualQuality: "ai-knowledge-style-3d-command-lab",
        stateText: stateText.textContent,
        camera: { z: Number(camera.position.z.toFixed(3)), graphX: Number(graph.rotation.x.toFixed(3)), graphY: Number(graph.rotation.y.toFixed(3)) },
        controls: Object.assign({}, state.controls),
        revision: "gnn-bio-ai-style-v1"
      };
    };
  }
  window.createGnnBioLab = createLab;
})();
