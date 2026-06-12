/* scenes.js — reusable scene factories for the MathLab engine.
   A generated lab is one line: MathLab.create(MathLabScenes.<family>({id,title,eyebrow,subtitle})).
   The scene LOGIC lives here once; per-lesson specialization is layered on top later.
   Families: graph (signal message passing), sheaf (stalk synchronization), matrix (operator).  */
(function () {
  "use strict";
  const TAU = Math.PI * 2;
  // ---- deterministic graph helpers (shared) ----
  function layout(n) { const R = 2.0 + n * 0.10, pos = []; for (let i = 0; i < n; i++) { const a = i * 2.399963, r = R * Math.sqrt((i + 0.5) / n); pos.push([Math.cos(a) * r, Math.sin(a) * r]); } return { pos, R }; }
  function edgesKNN(pos, k) { const n = pos.length, set = new Set(), E = []; for (let i = 0; i < n; i++) { const d = []; for (let j = 0; j < n; j++) if (j !== i) { const dx = pos[i][0] - pos[j][0], dz = pos[i][1] - pos[j][1]; d.push([dx * dx + dz * dz, j]); } d.sort((a, b) => a[0] - b[0]); for (let t = 0; t < Math.min(k, d.length); t++) { const j = d[t][1], key = i < j ? i + "_" + j : j + "_" + i; if (!set.has(key)) { set.add(key); E.push([Math.min(i, j), Math.max(i, j)]); } } } return E; }
  const stdev = a => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length); };

  // ============================ GRAPH family ============================
  // graph signal as a 3D landscape; message passing averages neighbourhoods -> over-smoothing.
  function graph(opts) {
    const COLD = "#3b6fd6", HOT = "#fb7185"; let scene = {};
    function adjacency(n, E, alpha) { const A = Array.from({ length: n }, () => new Float64Array(n)); for (const e of E) { A[e[0]][e[1]] = 1; A[e[1]][e[0]] = 1; } for (let i = 0; i < n; i++) A[i][i] += alpha; return A; }
    function degrees(A) { return A.map(r => r.reduce((s, v) => s + v, 0)); }
    function propagator(A, deg, mode) { const n = A.length, M = Array.from({ length: n }, () => new Float64Array(n)); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { if (A[i][j] === 0) continue; M[i][j] = mode === "sym" ? A[i][j] / Math.sqrt(deg[i] * deg[j]) : mode === "mean" ? A[i][j] / deg[i] : A[i][j]; } return M; }
    function applyL(M, x, L) { let h = x.slice(); for (let t = 0; t < L; t++) { const o = new Float64Array(M.length); for (let i = 0; i < M.length; i++) { let s = 0; for (let j = 0; j < M.length; j++) s += M[i][j] * h[j]; o[i] = s; } h = o; } return h; }
    function build(api) {
      const T = api.THREE, s = api.state, n = Math.round(s.nodes), lay = layout(n), pos = lay.pos, R = lay.R, E = edgesKNN(pos, Math.round(s.connectivity));
      const A = adjacency(n, E, s.alpha), deg = degrees(A), M = propagator(A, deg, s.mode);
      const x = pos.map(p => 0.5 + 0.5 * s.signal * (p[0] >= 0 ? 1 : -1)), h = applyL(M, x, Math.round(s.layers));
      let norm; if (s.mode === "sum") { let mn = Math.min.apply(null, h), mx = Math.max.apply(null, h); if (mx - mn < 1e-9) mx = mn + 1; norm = v => (v - mn) / (mx - mn); } else norm = v => Math.max(0, Math.min(1, v));
      const nodeDeg = new Array(n).fill(0); for (const e of E) { nodeDeg[e[0]]++; nodeDeg[e[1]]++; }
      const gG = api.group("graph"), eG = api.group("edges"), lG = api.group("labels"), P = pos.map((p, i) => [p[0], norm(h[i]) * 1.7, p[1]]);
      if (E.length) { const pts = []; for (const e of E) pts.push(new T.Vector3(P[e[0]][0], P[e[0]][1], P[e[0]][2]), new T.Vector3(P[e[1]][0], P[e[1]][1], P[e[1]][2])); eG.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0x2c4a6e, transparent: true, opacity: 0.55 }))); }
      const sel = (s.sel && s.sel.i < n) ? s.sel.i : -1, nbr = new Set(); if (sel >= 0) for (const e of E) { if (e[0] === sel) nbr.add(e[1]); if (e[1] === sel) nbr.add(e[0]); }
      if (sel >= 0) for (const j of nbr) { const dir = new T.Vector3(P[sel][0] - P[j][0], P[sel][1] - P[j][1], P[sel][2] - P[j][2]); const len = dir.length(); gG.add(new T.ArrowHelper(dir.normalize(), new T.Vector3(P[j][0], P[j][1], P[j][2]), len * 0.8, 0xfbbf24, 0.26, 0.16)); }
      for (let i = 0; i < n; i++) { const isSel = i === sel, isNbr = nbr.has(i), rad = 0.16 + 0.05 * Math.sqrt(nodeDeg[i] || 1), col = api.ramp(norm(h[i]), COLD, HOT); const mat = new T.MeshStandardMaterial({ color: col, roughness: 0.42, metalness: 0.08, emissive: col.clone().multiplyScalar(isSel ? 0.9 : (isNbr ? 0.5 : 0.2)), emissiveIntensity: isSel ? 0.7 : (isNbr ? 0.45 : 0.25) }); const m = new T.Mesh(new T.SphereGeometry(rad * (isSel ? 1.35 : 1), 22, 22), mat); m.position.set(P[i][0], P[i][1], P[i][2]); api.pick(m, { i }); gG.add(m); const lb = api.label(String(i), isSel ? "#fff" : (isNbr ? "#fde68a" : "#9fb4cc"), 0.34); lb.position.set(P[i][0], P[i][1] + rad + 0.18, P[i][2]); lG.add(lb); }
      const eqn = s.mode === "sym" ? "hᵢ ← Σ ãᵢⱼ /√(d̃ᵢd̃ⱼ)·hⱼ" : (s.mode === "mean" ? "hᵢ ← meanⱼ hⱼ" : "hᵢ ← Σⱼ hⱼ");
      gG.add((sp => (sp.position.set(0, 2.6, -R - 0.5), sp))(api.bigLabel((opts.title || "Graph") + " · " + eqn, "#d4e4f4", 6.4)));
      const spread = stdev(h.map(norm)); scene = { n, edges: E.length, nodeDeg, spread, h };
      return { badge: (s.mode === "sym" ? "GCN" : s.mode === "mean" ? "Mean" : "Sum") + " · " + Math.round(s.layers) + " layers",
        formula: n + " nodes, " + E.length + " edges · self-loop α=<b>" + s.alpha.toFixed(1) + "</b>.",
        insight: opts.subtitle || "Each node averages its neighbourhood. Height + colour = feature; add layers and watch it flatten (over-smoothing).",
        state: Math.round(s.layers) === 0 ? "Layer 0: the raw signal." : "Spread " + spread.toFixed(2) + " after " + Math.round(s.layers) + " layers" + (spread < 0.12 ? " — over-smoothed." : "."),
        metrics: { nodes: n, edges: E.length, spread: spread.toFixed(2), maxdeg: Math.max.apply(null, nodeDeg) },
        focus: { center: [0, 0.6, 0], radius: Math.min(26, R * 2.3 + 4) } };
    }
    return cfg(opts, {
      kind: "graph", selectedLabel: "Selected node", selectedHint: "Click a node — see its aggregation.",
      modes: [{ value: "sym", label: "GCN · symmetric D̃⁻½ÃD̃⁻½" }, { value: "mean", label: "Mean · random-walk" }, { value: "sum", label: "Sum · unnormalized (hubs blow up)" }],
      params: [{ key: "nodes", label: "nodes", min: 6, max: 16, step: 1, value: 11 }, { key: "layers", label: "layers", min: 0, max: 8, step: 1, value: 0 }, { key: "alpha", label: "self-loop α", min: 0, max: 1.5, step: 0.1, value: 1, fmt: v => v.toFixed(1) }, { key: "connectivity", label: "neighbours k", min: 2, max: 6, step: 1, value: 3 }, { key: "signal", label: "signal contrast", min: 0, max: 1, step: 0.1, value: 1, fmt: v => v.toFixed(1) }],
      metrics: [{ key: "nodes", label: "Nodes |V|", accent: "cyan" }, { key: "edges", label: "Edges |E|", accent: "violet" }, { key: "spread", label: "Signal spread", accent: "amber" }, { key: "maxdeg", label: "Max degree", accent: "rose" }],
      layers: [{ group: "edges", label: "Edges" }, { group: "labels", label: "Labels" }],
      primary: { label: "Propagate +1 layer", on: api => api.setParam("layers", Math.min(8, Math.round(api.state.layers) + 1)) },
      secondary: { label: "Reset layers", on: api => api.setParam("layers", 0) },
      defaultCam: { theta: -0.7, phi: 0.6, r: 10 },
      hint: '<b>blue</b>=low · <span class="r">rose</span>=high feature · height = value · <span class="a">amber</span>=selected messages.',
      onParam: (api) => { if (scene.n) api.frame([0, 0.6, 0], 12); }, onSelect: (api, d) => api.setSelected(scene.nodeDeg ? "node " + d.i + " · degree " + scene.nodeDeg[d.i] : "node " + d.i),
      build, snapshot: s => ({ mode: s.mode, nodes: Math.round(s.nodes), layers: Math.round(s.layers), spread: scene.spread != null ? +scene.spread.toFixed(3) : null, edges: scene.edges })
    });
  }

  // ============================ SHEAF family ============================
  // stalks (vectors) on nodes, restriction maps on edges; sheaf diffusion -> consistency, unless frustrated.
  function sheaf(opts) {
    let scene = {};
    const restriction = (a, b, mode, twist) => mode === "trivial" ? 0 : mode === "signed" ? (((a * 7 + b * 13) % 2) ? Math.PI : 0) : twist * Math.PI * ((((a * 7 + b * 13) % 11) / 11) * 2 - 1);
    function sync(n, E, theta, a0, L, selfw) { const nbr = Array.from({ length: n }, () => []); E.forEach((e, i) => { nbr[e[0]].push([e[1], +theta[i]]); nbr[e[1]].push([e[0], -theta[i]]); }); let a = a0.slice(); for (let t = 0; t < L; t++) { const na = new Float64Array(n); for (let i = 0; i < n; i++) { let sx = selfw * Math.cos(a[i]), sy = selfw * Math.sin(a[i]); for (const q of nbr[i]) { sx += Math.cos(a[q[0]] + q[1]); sy += Math.sin(a[q[0]] + q[1]); } na[i] = Math.atan2(sy, sx); } a = na; } return a; }
    const energy = (E, theta, a) => { let s = 0; E.forEach((e, i) => s += 1 - Math.cos(a[e[0]] - a[e[1]] - theta[i])); return E.length ? s / E.length : 0; };
    function disagree(n, E, theta, a) { const d = new Float64Array(n), c = new Float64Array(n); E.forEach((e, i) => { const v = (1 - Math.cos(a[e[0]] - a[e[1]] - theta[i])) / 2; d[e[0]] += v; d[e[1]] += v; c[e[0]]++; c[e[1]]++; }); for (let i = 0; i < n; i++) d[i] = c[i] ? d[i] / c[i] : 0; return d; }
    function build(api) {
      const T = api.THREE, s = api.state, n = Math.round(s.nodes), lay = layout(n), pos = lay.pos, R = lay.R, E = edgesKNN(pos, 3);
      const theta = E.map(e => restriction(e[0], e[1], s.mode, s.twist)), a0 = pos.map((p, i) => s.noise * ((i * 1.7) % TAU)), a = sync(n, E, theta, a0, Math.round(s.diffuse), Math.max(0.01, s.selfweight));
      const En = energy(E, theta, a), dis = disagree(n, E, theta, a), nodeDeg = new Array(n).fill(0); for (const e of E) { nodeDeg[e[0]]++; nodeDeg[e[1]]++; }
      const gG = api.group("graph"), eG = api.group("edges"), sG = api.group("stalks"), lG = api.group("labels"), P = pos.map(p => [p[0], 0.15, p[1]]);
      if (E.length) { const pts = []; for (const e of E) pts.push(new T.Vector3(P[e[0]][0], P[e[0]][1], P[e[0]][2]), new T.Vector3(P[e[1]][0], P[e[1]][1], P[e[1]][2])); eG.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0x2c4a6e, transparent: true, opacity: 0.5 }))); }
      const sel = (s.sel && s.sel.i < n) ? s.sel.i : -1, nbr = new Set(); if (sel >= 0) for (const e of E) { if (e[0] === sel) nbr.add(e[1]); if (e[1] === sel) nbr.add(e[0]); }
      for (let i = 0; i < n; i++) { const isSel = i === sel, isNbr = nbr.has(i), col = api.ramp(dis[i], "#34d399", "#fb7185"); const m = new T.Mesh(new T.SphereGeometry(isSel ? 0.2 : 0.15, 20, 20), new T.MeshStandardMaterial({ color: col, roughness: 0.42, metalness: 0.08, emissive: col.clone().multiplyScalar(isSel ? 0.8 : 0.28), emissiveIntensity: isSel ? 0.6 : 0.3 })); m.position.set(P[i][0], P[i][1], P[i][2]); api.pick(m, { i }); gG.add(m); sG.add(new T.ArrowHelper(new T.Vector3(Math.cos(a[i]), 0, Math.sin(a[i])), new T.Vector3(P[i][0], P[i][1] + 0.05, P[i][2]), 0.72, isSel ? 0xffffff : (isNbr ? 0xfde68a : 0x4dd7ff), 0.22, 0.15)); const lb = api.label(String(i), isSel ? "#fff" : "#9fb4cc", 0.32); lb.position.set(P[i][0], 0.6, P[i][2]); lG.add(lb); }
      const eqn = s.mode === "trivial" ? "θ=0 · uᵢ ← mean(uⱼ)" : (s.mode === "signed" ? "θ∈{0,π} activation/repression" : "uᵢ ← mean(Rₑ uⱼ)");
      gG.add((sp => (sp.position.set(0, 2.0, -R - 0.5), sp))(api.bigLabel((opts.title || "Sheaf") + " · " + eqn, "#d4e4f4", 6.2)));
      scene = { n, edges: E.length, energy: En, dis, nodeDeg, angles: a };
      const cons = Math.round((1 - En / 2) * 100);
      return { badge: (s.mode === "trivial" ? "Trivial" : s.mode === "signed" ? "Signed ±" : "Twisted") + " sheaf · " + Math.round(s.diffuse) + " steps",
        formula: (s.mode === "twisted" ? "twist=<b>" + s.twist.toFixed(2) + "</b> · " : "") + n + " genes, " + E.length + " edges.",
        insight: opts.subtitle || "Each gene carries a stalk; edges transport it. Diffusion averages transported neighbours until stalks agree — unless holonomy frustrates it.",
        state: "Energy " + En.toFixed(3) + " after " + Math.round(s.diffuse) + " steps; " + cons + "% consistent" + (En > 0.08 && s.diffuse > 10 ? " (obstruction)." : "."),
        metrics: { nodes: n, edges: E.length, energy: En.toFixed(3), consistency: cons + "%" },
        focus: { center: [0, 0.4, 0], radius: Math.min(26, R * 2.3 + 4) } };
    }
    return cfg(opts, {
      kind: "sheaf", selectedLabel: "Selected gene", selectedHint: "Click a node — see its stalk and disagreement.",
      modes: [{ value: "trivial", label: "Trivial sheaf · θ=0" }, { value: "twisted", label: "Twisted · holonomy / obstruction" }, { value: "signed", label: "Signed ± · activation / repression" }],
      params: [{ key: "nodes", label: "genes", min: 6, max: 16, step: 1, value: 11 }, { key: "diffuse", label: "diffusion steps", min: 0, max: 20, step: 1, value: 0 }, { key: "twist", label: "restriction twist", min: 0, max: 1, step: 0.05, value: 0.5, fmt: v => v.toFixed(2), modes: ["twisted"] }, { key: "noise", label: "initial scramble", min: 0, max: 1, step: 0.1, value: 1, fmt: v => v.toFixed(1) }, { key: "selfweight", label: "self-weight", min: 0, max: 2, step: 0.1, value: 0.4, fmt: v => v.toFixed(1) }],
      metrics: [{ key: "nodes", label: "Genes |V|", accent: "cyan" }, { key: "edges", label: "Edges |E|", accent: "violet" }, { key: "energy", label: "Sheaf energy", accent: "rose" }, { key: "consistency", label: "Consistency", accent: "green" }],
      layers: [{ group: "edges", label: "Edges" }, { group: "stalks", label: "Stalks" }, { group: "labels", label: "Labels" }],
      primary: { label: "Diffuse +1 step", on: api => api.setParam("diffuse", Math.min(20, Math.round(api.state.diffuse) + 1)) },
      secondary: { label: "Reset steps", on: api => api.setParam("diffuse", 0) },
      defaultCam: { theta: -0.7, phi: 0.62, r: 10 },
      hint: '<span class="g">green</span>=consistent · <span class="r">rose</span>=disagrees · <b>cyan</b> arrows = stalks · edges carry restriction maps.',
      onParam: (api) => { if (scene.n) api.frame([0, 0.4, 0], 12); }, onSelect: (api, d) => api.setSelected(scene.nodeDeg ? "gene " + d.i + " · degree " + scene.nodeDeg[d.i] + " · disagreement " + scene.dis[d.i].toFixed(2) : "gene " + d.i),
      build, snapshot: s => ({ mode: s.mode, nodes: Math.round(s.nodes), steps: Math.round(s.diffuse), energy: scene.energy != null ? +scene.energy.toFixed(4) : null, edges: scene.edges })
    });
  }

  function matrix(opts) { return graph(opts); }   // fallback until a dedicated operator scene exists

  // assemble a MathLab config from a scene's pieces + the lesson opts
  function cfg(opts, sc) {
    return Object.assign({ id: opts.id || "lab", eyebrow: opts.eyebrow || "", title: opts.title || "", subtitle: opts.subtitle || "" }, sc);
  }

  window.MathLabScenes = { graph: graph, sheaf: sheaf, matrix: matrix, default: graph };
})();
