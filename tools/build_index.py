#!/usr/bin/env python3
"""Regenerate index.html: a searchable gallery of every lab in sheaf/.

Usage:  python tools/build_index.py
Run it after adding or renaming a lab; titles are read from each lab's <title>.
"""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAB_DIR = ROOT / "sheaf"

# Module letter -> (name, one-line scope). Letters come from the lab file prefix.
MODULES = {
    "a": ("Graph foundations", "Graphs, matrices, Laplacians, message passing, evaluation basics"),
    "b": ("GNN architectures", "GCN, GraphSAGE, GAT, GIN, transformers, structure learning, explainability"),
    "c": ("Geometry, topology and sheaves", "Symmetry, gauge, cell complexes, cellular sheaves, sheaf Laplacians"),
    "d": ("Biological graphs and knowledge graphs", "PPI, pathways, drug-target, molecular and clinical graphs, causality"),
    "e": ("Single-cell and spatial omics", "scRNA/scATAC, multiome, spatial, velocity, Perturb-seq"),
    "f": ("Gene regulatory network inference", "Classical and deep GRN methods, ground truth, metrics, failure modes"),
    "g": ("Sheaf models for regulation", "Sheaf neural networks and Sheaf-GRN design"),
    "h": ("Benchmarks and data", "DREAM, BEELINE, priors, leakage audits, negative sampling"),
    "i": ("Engineering and reproducibility", "PyG/DGL, baselines, ablations, scaling, failure reports"),
    "j": ("Robustness and advanced topics", "Trustworthiness, calibration, causality, subgraph GNNs, prompting"),
    "k": ("Graph foundation models", "Pretraining, transfer, text-attributed, biomedical and single-cell"),
}

LAB_RE = re.compile(r"^([a-z])(\d+)-.*-lab\.html$")
labs = {}
for p in sorted(LAB_DIR.glob("*-lab.html")):
    m = LAB_RE.match(p.name)
    if not m:
        continue  # skips _TEMPLATE and _engine-seed
    raw = p.read_text(encoding="utf-8-sig", errors="replace")
    t = re.search(r"<title>(.*?)</title>", raw, re.S)
    title = html.unescape(t.group(1)).strip() if t else p.stem
    title = re.sub(r"^[A-Z]\d+\s*[·\-–—]\s*", "", title)
    labs.setdefault(m.group(1), []).append({"id": m.group(1).upper() + m.group(2), "title": title, "href": f"sheaf/{p.name}"})

data = [
    {"letter": k.upper(), "name": MODULES[k][0], "scope": MODULES[k][1], "labs": labs[k]}
    for k in sorted(labs) if k in MODULES
]
total = sum(len(m["labs"]) for m in data)

PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Obsidian Labs</title>
<meta name="description" content="Interactive 3D labs for graph learning, single-cell biology, gene regulatory networks and sheaf neural networks.">
<style>
:root{--bg:#fafaf8;--fg:#1c1c1a;--muted:#6b6b66;--line:#e4e3de;--card:#fff;--accent:#3b4fd8}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--fg:#ececea;--muted:#9a9a94;--line:#2a2a2e;--card:#1a1a1e;--accent:#8fa0ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:40px 16px 80px}
h1{font-size:2rem;margin:0 0 6px}
.lede{color:var(--muted);margin:0 0 24px;max-width:62ch}
input{width:100%;padding:12px 14px;font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:10px}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
section{margin-top:28px}
h2{font-size:1.1rem;margin:0}
h2 span{color:var(--accent);font-family:ui-monospace,monospace;margin-right:8px}
.scope{color:var(--muted);font-size:.9rem;margin:2px 0 10px}
ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px}
li{display:flex}
a{display:block;flex:1;padding:10px 12px;background:var(--card);border:1px solid var(--line);border-radius:10px;color:inherit;text-decoration:none}
a:hover,a:focus-visible{border-color:var(--accent)}
a b{font-family:ui-monospace,monospace;color:var(--accent);font-size:.8rem;display:block}
.hide{display:none}
#none{color:var(--muted);margin-top:24px}
</style>
</head>
<body>
<main>
<h1>Obsidian Labs</h1>
<p class="lede">__TOTAL__ interactive labs on graph learning for biology: from message passing to single-cell data, gene regulatory networks and cellular sheaves.</p>
<input id="q" type="search" placeholder="Search labs (e.g. Laplacian, GRN, attention)" aria-label="Search labs" autocomplete="off">
<div id="root"></div>
<p id="none" class="hide">No lab matches that search.</p>
</main>
<script>
const DATA = __DATA__;
const root = document.getElementById("root");
const esc = s => s.replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
root.innerHTML = DATA.map(m => `<section data-m><h2><span>${m.letter}</span>${esc(m.name)}</h2><p class="scope">${esc(m.scope)}</p><ul>` +
  m.labs.map(l => `<li data-t="${esc((l.id + " " + l.title + " " + m.name).toLowerCase())}"><a href="${esc(l.href)}"><b>${l.id}</b>${esc(l.title)}</a></li>`).join("") +
  `</ul></section>`).join("");
const q = document.getElementById("q"), none = document.getElementById("none");
q.addEventListener("input", () => {
  const v = q.value.trim().toLowerCase(); let any = false;
  document.querySelectorAll("[data-m]").forEach(sec => {
    let n = 0;
    sec.querySelectorAll("li").forEach(li => { const ok = !v || li.dataset.t.includes(v); li.classList.toggle("hide", !ok); if (ok) n++; });
    sec.classList.toggle("hide", n === 0); if (n) any = true;
  });
  none.classList.toggle("hide", any);
});
</script>
</body>
</html>
"""
out = PAGE.replace("__TOTAL__", str(total)).replace("__DATA__", json.dumps(data, ensure_ascii=False))
(ROOT / "index.html").write_text(out, encoding="utf-8")
print(f"index.html written: {total} labs in {len(data)} modules")
