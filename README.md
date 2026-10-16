# Obsidian Labs

**130 interactive 3D labs and figures on graph learning for biology**, from message passing
to single-cell data, gene regulatory networks (GRNs) and cellular sheaves.

Companion to the *Sheaf-GNN-GRN* Obsidian vault: each note in the vault links to one lab.
This repository is the GitHub Pages backup of the local Obsidian plugin's lab output.

Open [`index.html`](index.html) for a searchable gallery of every lab.

## Curriculum

| Module | Topic | Labs |
|---|---|---|
| A | Graph foundations: Laplacians, message passing, evaluation basics | 14 |
| B | GNN architectures: GCN, GraphSAGE, GAT, GIN, transformers | 14 |
| C | Geometry, topology and cellular sheaves | 9 |
| D | Biological graphs and knowledge graphs | 14 |
| E | Single-cell and spatial omics | 13 |
| F | Gene regulatory network inference | 20 |
| G | Sheaf models for regulation | 15 |
| H | Benchmarks and data | 7 |
| I | Engineering and reproducibility | 10 |
| J | Robustness and advanced topics | 8 |
| K | Graph foundation models | 6 |

## Repository layout

```
.
├── index.html            gallery of all labs (generated, do not edit by hand)
├── tools/
│   └── build_index.py    regenerates index.html from the labs' <title> tags
└── sheaf/
    ├── <id>-<slug>-lab.html   one self-contained lab per topic (e.g. g03-neural-sheaf-diffusion-lab.html)
    ├── _TEMPLATE-lab.html     starting point for a new lab
    ├── __static/              static SVG figures, one per lab (+ inline variant)
    └── shared/                lab engine (JS/CSS) and three.min.js used by every lab
```

Lab file names follow `<module letter><number>-<topic slug>-lab.html`. The prefix decides
which module a lab belongs to in the gallery.

## Run locally

No build step. Labs are plain HTML that load `sheaf/shared/`.

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

## Add or rename a lab

1. Copy `sheaf/_TEMPLATE-lab.html` to `sheaf/<letter><nn>-<slug>-lab.html` and set its `<title>` to `X00 · Title`.
2. Run `python3 tools/build_index.py`.
3. Commit the lab and the regenerated `index.html`.

## Notes

- Paths under `sheaf/` are stable on purpose: published links and vault notes point at them.
- Labs use WebGL (three.js); a current desktop browser is recommended.
