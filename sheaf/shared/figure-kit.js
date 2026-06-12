/* ============================================================================
 * figure-kit.js  ·  v2.0.0  ·  Deterministic, DOM-free SVG figure builder
 * ----------------------------------------------------------------------------
 * Pure functions. No `document`, no `window`, no `Math.random`, no `Date`.
 * Identical input -> byte-identical SVG in Node and in the browser.
 *
 * Two builders:
 *   buildFigureSVG(config)  -> full 940x664 captioned 4-panel figure (string)
 *   buildInlineSVG(config)  -> 900x230 inline strip figure (string)
 *
 * WHY OVERFLOW IS IMPOSSIBLE (constructive guarantee):
 *   1. The caller supplies only SEMANTICS (text, numbers, accents). The kit
 *      owns EVERY coordinate from the frozen GRID / INLINE tables.
 *   2. Every text run is wrapped to its column with estTextWidth(), which is a
 *      deliberate OVER-estimate of Inter's true advance widths. Since the
 *      estimate is >= the true rendered width, the true right edge is always
 *      <= the budgeted right edge => right-overflow is impossible (<= 900).
 *   3. A single token wider than its column is hard-broken by character, so one
 *      long word can never spill out.
 *   4. Panel floors and the 5 caption baselines (<= 622, glyph bottom <= 628)
 *      are frozen. Panel content past the floor is clipped-with-ellipsis (or
 *      throws in strict mode); a 6th caption line throws CAPTION_OVERFLOW.
 *   5. Panels are disjoint frozen rects; within a panel each run lives on its
 *      own lineAdvance-separated baseline => no overlap.
 *
 * ----------------------------------------------------------------------------
 * USAGE (Node):
 *   const FK = require("./shared/figure-kit.js");
 *   const svg = FK.buildFigureSVG({
 *     id:"B07", block:"Block B · GNN Architectures",
 *     title:"Edge-aware message passing",
 *     panels:[
 *       { accent:"cyan", heading:"Blind aggregation", content:[
 *         {type:"formula", lines:["m_i = Σ_j x_j","(ignores edge type)"]},
 *         {type:"kv", rows:[["Σ incoming","9.0"],["rep drift","+3.0"]]},
 *         {type:"text", text:"All neighbours counted equally.", muted:true} ]},
 *       { accent:"rose", heading:"Edge-aware aggregation", content:[
 *         {type:"formula", lines:["m_i = Σ_j s(e_ij)·x_j"]},
 *         {type:"kv", rows:[["Σ incoming","0.9"],["rep drift","-2.1"]]} ]},
 *       { accent:"amber", heading:"Why it matters", content:[
 *         {type:"text", text:"Repressor edges must subtract."},
 *         {type:"plot", kind:"line", curve:[[0,0.1],[0.6,0.2],[1,0.05]]} ]},
 *       { accent:"violet", heading:"Takeaway", content:[
 *         {type:"kv", rows:[["Edge-blind","loses sign"],["Edge-aware","keeps sign"]]} ]}
 *     ],
 *     caption:"Figure B07. (a) Edge-blind sum 9.0. (b) Edge-aware 0.9, signed. "+
 *             "(c) Sign loss compounds with depth. (d) GRN needs signed messages."
 *   });
 *   process.stdout.write(svg);
 *   console.error(JSON.stringify(FK.buildFigureSVG.lastReport));
 *
 * USAGE (browser):
 *   <script src="shared/figure-kit.js"></script>
 *   document.getElementById('fig').innerHTML = FigureKit.buildFigureSVG(cfg);
 * ==========================================================================*/
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.FigureKit = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ========================================================================
   * 2.7  FROZEN PALETTE  (caller never types a hex)
   * ======================================================================*/
  var PALETTE = {
    accent: {
      cyan:   { base: "#4dd7ff", light: "#9fe0ff", tint: "#0e2740" },
      rose:   { base: "#fb7185", light: "#fda4b0", tint: "#3a1420" },
      amber:  { base: "#fbbf24", light: "#fde68a", tint: "#33270a" },
      violet: { base: "#a78bfa", light: "#c4b5fd", tint: "#241a40" },
      green:  { base: "#34d399", light: "#7fe7c0", tint: "#152a18" }
    },
    text: {
      title: "#e8eef6", caption: "#c7d2dd", heading: "#cfe0f0", body: "#9fb4cc",
      muted: "#8a99ad", axis: "#7f93a8", faint: "#6b7a8d"
    },
    surf: {
      bg: "#070b14", cardTop: "#0c1322", cardBot: "#0a1120",
      stroke: "rgba(150,170,200,.18)", sep: "rgba(150,170,200,.2)", axisLine: "#3a4a5e"
    }
  };

  /* ========================================================================
   * 2.3  FROZEN GRID for 940x664 (the ONLY legal coordinates)
   * Taken verbatim from _TEMPLATE-figure.svg + a14 + b01.
   * ======================================================================*/
  var GRID = {
    VB: { W: 940, H: 664 },
    SAFE: { L: 40, R: 900, T: 0, B: 628 },
    glowDefault: [
      { cx: 160, cy: 70, r: 230, color: "#4dd7ff", op: 0.05 },
      { cx: 800, cy: 450, r: 250, color: "#a78bfa", op: 0.05 }
    ],
    header: {
      eyebrowX: 40, eyebrowY: 34, eyebrowSize: 12, eyebrowLS: 2.5,
      titleX: 40, titleY: 62, titleSize: 24, titleMin: 16
    },
    panel: {
      col1X: 40, col1W: 430, col2X: 486, col2W: 414,
      rowTopY: 82, rowTopH: 150, rowBotY: 244, rowBotH: 248,
      rx: 12, strokeRow: "rgba(150,170,200,.18)",
      fillRowTop: "#0c1322", fillRowBot: "#0a1120",
      accentStripH: 4,
      badge: { dx: 24, dy: 26, r: 13 },
      headingDx: 46, headingDy: 24, headingSize: 14,
      padX: 16, padBottom: 14, contentTopDy: 46,
      lineAdvance: 20, blockGap: 8
    },
    caption: {
      dividerY: 512, firstLineY: 538, lineDy: 21, maxLines: 5,
      fontSize: 13, leadColor: "#e8eef6", bodyColor: "#c7d2dd",
      BOTTOM: 628, maxCharsPerLine: 108, spanLeftX: 40
    },
    kv: { valueDx: 140 }
  };

  /* ========================================================================
   * 2.4  FROZEN GRID for the inline strip 900x230
   * ======================================================================*/
  var INLINE = {
    VB: { W: 900, H: 230 }, SAFE: { L: 40, R: 860, T: 0, B: 214 },
    eyebrow: { x: 40, y: 30, size: 11, ls: 2.2 },
    zones: {
      left: { x: 40, w: 200 },
      arrowX: 270,
      mid: { x: 310, w: 150, cardW: 70, cardH: 40, colDx: 78, rowDy: 46, x0: 310, y0: 78 },
      sepX: 470,
      right: { x: 500, w: 300, rowY0: 86, rowDy: 24 }
    },
    takeaway: { x: 450, y: 210, size: 12, anchor: "middle" }
  };

  /* default accent mapping by panel index a,b,c,d */
  var DEFAULT_PANEL_ACCENTS = ["cyan", "rose", "amber", "violet"];
  var LETTERS = ["a", "b", "c", "d"];

  /* ========================================================================
   * 2.2  CONSERVATIVE TEXT-WIDTH MODEL (THE keystone — exported)
   * ======================================================================*/
  var FONT = { perChar: 0.62, bold: 1.04, mono: 1.10, headerPerChar: 0.72 };
  /* subscripts / superscripts render narrower (~0.7 em) */
  var SUB_RE = /[ᵢⱼₖᵣₐₙₜ₊₋⁻⁰¹²³⁴⁵ᵀᵏ]/;
  /* wide glyphs the per-char model under-estimates (em/en dash, arrows, math
     operators, ellipsis). perChar=0.62 would size an em-dash at 0.62em though it
     renders ~1em, so caption/kv advances packed too tight and overlapped. Count
     these at ~1.8 units (≈1.12em) so the estimate stays a conservative upper bound. */
  var WIDE_RE = /[—–―→←↔⇒⇔↦…™%‰@&≈≥≤≠±×÷∞∑∏∫√·•]/;

  function estTextWidth(str, fontSize, opts) {
    opts = opts || {};
    var bold = opts.bold ? FONT.bold : 1;
    var mono = opts.mono ? FONT.mono : 1;
    var s = String(str);
    var subs = 0, wides = 0, caps = 0, total = 0, i, ch;
    /* iterate by code point (handle surrogate pairs gracefully) */
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      var code = s.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < s.length) { i++; }
      total++;
      if (SUB_RE.test(ch)) subs++;
      else if (WIDE_RE.test(ch)) wides++;
      else if (ch >= 'A' && ch <= 'Z') caps++;   /* uppercase / acronyms (DMPNN, GNN...) render ~15% wider than the per-char avg */
    }
    var plain = total - subs - wides - caps;
    var em = plain + subs * 0.7 + wides * 1.8 + caps * 1.15;
    return em * fontSize * FONT.perChar * bold * mono;
  }

  function headerWidth(str, fontSize, ls) {
    ls = (ls == null) ? 2.5 : ls;
    var n = 0, s = String(str), i, code;
    for (i = 0; i < s.length; i++) {
      code = s.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < s.length) { i++; }
      n++;
    }
    return n * (fontSize * FONT.headerPerChar + ls);
  }

  /* ========================================================================
   * LOAD-BEARING PURE PRIMITIVES
   * ======================================================================*/
  function wrapText(str, maxW, fontSize, opts) {
    opts = opts || {};
    var words = String(str).split(/\s+/).filter(function (w) { return w.length; });
    var lines = [], cur = "";
    var fits = function (s) { return estTextWidth(s, fontSize, opts) <= maxW; };
    for (var k = 0; k < words.length; k++) {
      var w = words[k];
      /* hard-break a single token that is wider than the whole column */
      while (estTextWidth(w, fontSize, opts) > maxW && w.length > 1) {
        var i = w.length;
        while (i > 1 && !fits(w.slice(0, i))) i--;
        lines.push(w.slice(0, i));
        w = w.slice(i);
      }
      var t = cur ? cur + " " + w : w;
      if (fits(t)) cur = t;
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (!lines.length) lines.push("");
    return lines;
  }

  function ellipsize(str, maxW, fontSize, opts) {
    if (estTextWidth(str, fontSize, opts) <= maxW) return String(str);
    var s = String(str);
    while (s.length > 1 && estTextWidth(s + "…", fontSize, opts) > maxW) s = s.slice(0, -1);
    return s + "…";
  }

  /* letter-spacing-aware ellipsize for uppercase tracked headers (eyebrows).
     estTextWidth ignores letter-spacing, so eyebrows must fit via headerWidth. */
  function ellipsizeHeader(str, maxW, fontSize, ls) {
    if (headerWidth(str, fontSize, ls) <= maxW) return String(str);
    var s = String(str);
    while (s.length > 1 && headerWidth(s + "…", fontSize, ls) > maxW) s = s.slice(0, -1);
    return s + "…";
  }

  /* XML escaping for text content + attribute values */
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* clamp a numeric value into [lo,hi] (hi<lo collapses to lo) */
  function clampNum(v, lo, hi) {
    if (hi < lo) return lo;
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /* round numeric coordinates to keep SVG compact + byte-stable */
  function num(n) {
    if (!isFinite(n)) return "0";
    var r = Math.round(n * 100) / 100;
    if (r === Math.floor(r)) return String(r);
    return String(r);
  }

  /* svgText(x,y,{...}) -> a single escaped <text> element */
  function svgText(x, y, o) {
    o = o || {};
    var attrs = 'x="' + num(x) + '" y="' + num(y) + '"';
    attrs += ' fill="' + esc(o.fill || PALETTE.text.body) + '"';
    attrs += ' font-size="' + num(o.size == null ? 12 : o.size) + '"';
    if (o.weight) attrs += ' font-weight="' + esc(o.weight) + '"';
    if (o.anchor) attrs += ' text-anchor="' + esc(o.anchor) + '"';
    if (o.family) attrs += ' font-family="' + esc(o.family) + '"';
    if (o.ls != null) attrs += ' letter-spacing="' + num(o.ls) + '"';
    if (o.opacity != null) attrs += ' opacity="' + num(o.opacity) + '"';
    return "<text " + attrs + ">" + esc(o.text == null ? "" : o.text) + "</text>";
  }

  /* assertFits — throws if an estimated edge crosses a safe boundary */
  function assertFits(rec, safe) {
    var w = estTextWidth(rec.text, rec.fontSize, { bold: rec.bold, mono: rec.mono });
    var left = rec.x, right = rec.x + w;
    if (rec.anchor === "middle") { left = rec.x - w / 2; right = rec.x + w / 2; }
    else if (rec.anchor === "end") { left = rec.x - w; right = rec.x; }
    if (right > safe.R + 0.001) throw new Error("OVERFLOW_R: text right " + right.toFixed(1) + " > " + safe.R + " :: " + rec.text);
    if (left < safe.L - 0.001) throw new Error("OVERFLOW_L: text left " + left.toFixed(1) + " < " + safe.L + " :: " + rec.text);
    return { left: left, right: right };
  }

  /* ========================================================================
   * accent resolution helpers
   * ======================================================================*/
  function resolveAccent(name) {
    var a = PALETTE.accent[name];
    if (!a) throw new Error("FIGURE_ACCENT: unknown accent '" + name + "' (use cyan|rose|amber|violet|green)");
    return a;
  }
  function colorOf(token) {
    /* token can be an accent name OR a literal hex/rgba */
    if (token == null) return PALETTE.text.body;
    var s = String(token);
    if (PALETTE.accent[s]) return PALETTE.accent[s].base;
    return s; /* pass hex / rgba through */
  }

  /* track emitted <text> rows for the self-check (kit-model estimates) */
  function makeTracker() {
    return {
      rows: [], maxRight: 0, maxBottom: 0, minLeft: 1e9, lines: 0,
      add: function (x, y, str, fontSize, opts) {
        opts = opts || {};
        /* opts.width lets a caller record the TRUE advance (e.g. letter-spaced
           headers, whose width estTextWidth deliberately ignores) so the
           self-check + overlap check stay honest. */
        var w = (opts.width != null) ? opts.width : estTextWidth(str, fontSize, opts);
        var left = x, right = x + w;
        if (opts.anchor === "middle") { left = x - w / 2; right = x + w / 2; }
        else if (opts.anchor === "end") { left = x - w; right = x; }
        var bottom = y + fontSize * 0.30; /* descender allowance */
        this.maxRight = Math.max(this.maxRight, right);
        this.maxBottom = Math.max(this.maxBottom, bottom);
        this.minLeft = Math.min(this.minLeft, left);
        this.rows.push({ x: left, y: y - fontSize, w: w, h: fontSize * 1.3, right: right, bottom: bottom, top: y - fontSize });
      }
    };
  }

  /* real text-vs-text overlap check over tracked rows. Two boxes count as
     overlapping only when they cross by more than `tol` on BOTH axes, so
     abutting same-line runs and tight-but-legal stacks don't false-positive. */
  function findOverlaps(rows, tol) {
    tol = (tol == null) ? 1.5 : tol;
    var pairs = [];
    for (var i = 0; i < rows.length; i++) {
      for (var j = i + 1; j < rows.length; j++) {
        var a = rows[i], b = rows[j];
        var ox = Math.min(a.right, b.right) - Math.max(a.x, b.x);
        var oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > tol && oy > tol) {
          pairs.push({ i: i, j: j, ox: Math.round(ox * 10) / 10, oy: Math.round(oy * 10) / 10 });
        }
      }
    }
    return pairs;
  }

  /* ========================================================================
   * resolve a panel rect by index 0..3 (a,b,c,d = TL,TR,BL,BR)
   * ======================================================================*/
  function panelRect(i) {
    var P = GRID.panel;
    var x = (i % 2 === 0) ? P.col1X : P.col2X;
    var w = (i % 2 === 0) ? P.col1W : P.col2W;
    var y = (i < 2) ? P.rowTopY : P.rowBotY;
    var h = (i < 2) ? P.rowTopH : P.rowBotH;
    var fill = (i < 2) ? P.fillRowTop : P.fillRowBot;
    return { x: x, y: y, w: w, h: h, fill: fill };
  }

  /* ========================================================================
   * CONTENT-BLOCK RENDERERS  (each returns consumed height)
   * signature: render(block, colLeft, colRight, cursorY, budget, accent, ctx)
   *   ctx = { out:[], track, strict, letter }
   * ======================================================================*/
  var LA = GRID.panel.lineAdvance; /* 20 */

  function pushLine(ctx, x, baseY, str, fontSize, opts) {
    ctx.out.push(svgText(x, baseY, {
      text: str, size: fontSize, fill: opts.fill, weight: opts.weight,
      anchor: opts.anchor, family: opts.family
    }));
    ctx.track.add(x, baseY, str, fontSize, opts);
  }

  function clipNote(ctx, x, baseY, colW) {
    /* honest "…" overflow marker inside a panel */
    pushLine(ctx, x, baseY, "…", 11, { fill: PALETTE.text.muted });
  }

  /* Shared vertical flow for line-stacked renderers (text / formula / kv).
     Renders only the rows that fit; when truncated it RESERVES a slot for the
     "…" marker so the marker sits a full lineAdvance below the last real row
     (no ~3px box overlap, honest `used` height). drawRow(i, baseY) paints one
     row's content; we own the baselines + the marker. */
  function flowRows(ctx, colLeft, cursorY, budget, fontSize, adv, count, drawRow) {
    var capacity = Math.floor((budget - fontSize) / adv) + 1; /* # of baselines that fit */
    if (capacity < 1) {
      if (ctx.strict) throw new Error("OVERFLOW_PANEL_" + ctx.letter);
      return 0;
    }
    var truncated = count > capacity;
    if (truncated && ctx.strict) throw new Error("OVERFLOW_PANEL_" + ctx.letter);
    var shown = truncated ? capacity - 1 : count; /* leave the last fitting slot for "…" */
    var i, baseY;
    for (i = 0; i < shown; i++) {
      baseY = cursorY + (i + 1) * adv - (adv - fontSize);
      drawRow(i, baseY);
    }
    if (truncated) {
      baseY = cursorY + (shown + 1) * adv - (adv - fontSize);
      clipNote(ctx, colLeft, baseY, 0);
      return (shown + 1) * adv;
    }
    return shown * adv;
  }

  function render_text(b, colLeft, colRight, cursorY, budget, accent, ctx) {
    var fontSize = 11;
    var fill = b.muted ? PALETTE.text.muted : (b.warn ? "#fda4b0" : "#9fb4cc");
    var maxW = colRight - colLeft;
    var lines = wrapText(b.text || "", maxW, fontSize, {});
    return flowRows(ctx, colLeft, cursorY, budget, fontSize, LA, lines.length, function (i, baseY) {
      pushLine(ctx, colLeft, baseY, lines[i], fontSize, { fill: fill });
    });
  }

  function render_formula(b, colLeft, colRight, cursorY, budget, accent, ctx) {
    var fontSize = 11.5, adv = 20;
    var fam = "Cascadia Code, 'Cascadia Mono', Consolas, monospace";
    var maxW = colRight - colLeft;
    var lines = b.lines || [];
    return flowRows(ctx, colLeft, cursorY, budget, fontSize, adv, lines.length, function (i, baseY) {
      var line = ellipsize(String(lines[i]), maxW, fontSize, { mono: true });
      pushLine(ctx, colLeft, baseY, line, fontSize, { fill: PALETTE.text.heading, family: fam });
    });
  }

  function render_kv(b, colLeft, colRight, cursorY, budget, accent, ctx) {
    var fontSize = 11.5, adv = 20;
    var valX = colLeft + GRID.kv.valueDx;
    var rows = (b.rows || []).map(function (r) {
      if (Array.isArray(r)) return { label: r[0], value: r[1], accent: null };
      return { label: r.label, value: r.value, accent: r.accent || null };
    });
    var keyMaxW = GRID.kv.valueDx - 8;
    var valMaxW = colRight - valX;
    return flowRows(ctx, colLeft, cursorY, budget, fontSize, adv, rows.length, function (i, baseY) {
      var keyColor = rows[i].accent ? colorOf(rows[i].accent) : accent.base;
      var keyStr = ellipsize(String(rows[i].label), keyMaxW, fontSize, { bold: true });
      var valStr = ellipsize(String(rows[i].value), valMaxW, fontSize, {});
      pushLine(ctx, colLeft, baseY, keyStr, fontSize, { fill: keyColor, weight: "700" });
      pushLine(ctx, valX, baseY, valStr, fontSize, { fill: "#9fb4cc" });
    });
  }

  function render_matrix(b, colLeft, colRight, cursorY, budget, accent, ctx) {
    var tileW = 60, tileH = 34, gap = 4;
    var cells = b.cells || [];
    var tint = b.tint || null;
    var rows = cells.length, cols = rows ? cells[0].length : 0;
    var gridH = rows * tileH + (rows - 1) * gap;
    if (gridH > budget && ctx.strict) throw new Error("OVERFLOW_PANEL_" + ctx.letter);
    var x0 = colLeft, y0 = cursorY + 4;
    var maxAvail = colRight - colLeft;
    var totalW = cols * tileW + (cols - 1) * gap;
    if (totalW > maxAvail) {
      tileW = Math.max(20, Math.floor((maxAvail - (cols - 1) * gap) / cols));
    }
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var tx = x0 + c * (tileW + gap);
        var ty = y0 + r * (tileH + gap);
        if (ty + tileH - cursorY > budget) {
          if (ctx.strict) throw new Error("OVERFLOW_PANEL_" + ctx.letter);
          return r * (tileH + gap);
        }
        var fillTile = (tint && tint[r] && tint[r][c]) ? colorOf(tint[r][c]) : "#16202c";
        ctx.out.push('<rect x="' + num(tx) + '" y="' + num(ty) + '" width="' + num(tileW) +
          '" height="' + tileH + '" rx="4" fill="' + esc(fillTile) + '"/>');
        var cv = String(cells[r][c]);
        var cx = tx + tileW / 2, cy = ty + tileH / 2 + 4;
        pushLine(ctx, cx, cy, ellipsize(cv, tileW - 6, 12, {}), 12, { fill: "#e8eef6", anchor: "middle" });
      }
    }
    return gridH + 8;
  }

  function render_plot(b, colLeft, colRight, cursorY, budget, accent, ctx) {
    var W = 120, H = 120;
    var maxAvail = colRight - colLeft;
    if (W > maxAvail) W = maxAvail;
    if (H > budget) H = Math.max(40, budget - 4);
    var x0 = colLeft, y0 = cursorY + 2;
    /* axes */
    ctx.out.push('<rect x="' + num(x0) + '" y="' + num(y0) + '" width="' + num(W) + '" height="' + num(H) +
      '" fill="none" stroke="' + esc(PALETTE.surf.axisLine) + '" stroke-width="1"/>');
    /* baseline diagonal for roc/pr */
    if (b.kind === "roc" || b.kind === "pr" || b.baseline) {
      ctx.out.push('<line x1="' + num(x0) + '" y1="' + num(y0 + H) + '" x2="' + num(x0 + W) + '" y2="' + num(y0) +
        '" stroke="' + esc(PALETTE.surf.axisLine) + '" stroke-width="1" stroke-dasharray="4 4"/>');
    }
    /* curve */
    var curve = b.curve || [];
    if (curve.length) {
      var d = "";
      for (var i = 0; i < curve.length; i++) {
        var px = x0 + curve[i][0] * W;
        var py = y0 + H - curve[i][1] * H;
        d += (i === 0 ? "M" : "L") + num(px) + " " + num(py) + " ";
      }
      ctx.out.push('<path d="' + d.trim() + '" fill="none" stroke="' + esc(accent.base) +
        '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>');
    }
    if (b.label) {
      var ly = y0 + H + 14;
      if (ly - cursorY <= budget) pushLine(ctx, x0, ly, ellipsize(String(b.label), maxAvail, 11, {}), 11, { fill: PALETTE.text.muted });
      return H + 22;
    }
    return H + 6;
  }

  function render_bars(b, colLeft, colRight, cursorY, budget, accent, ctx) {
    var values = b.values || [];
    var labels = b.labels || [];
    var colors = b.colors || [];
    var pitch = 16, barW = 12;
    var maxAvail = colRight - colLeft;
    var chartH = 64;
    if (chartH > budget) chartH = Math.max(24, budget - 16);
    var maxV = 0, i;
    for (i = 0; i < values.length; i++) maxV = Math.max(maxV, Math.abs(values[i]));
    if (maxV === 0) maxV = 1;
    var x0 = colLeft, baseY = cursorY + chartH + 2;
    /* widen pitch so adjacent labels (font 9) can never collide; clamp to the column if needed */
    var maxLblW = 0;
    for (i = 0; i < labels.length; i++) if (labels[i] != null) maxLblW = Math.max(maxLblW, estTextWidth(String(labels[i]), 9));
    pitch = Math.max(pitch, Math.ceil(maxLblW) + 6);
    barW = Math.min(12, Math.max(4, pitch - 6));
    var needW = values.length * pitch;
    if (needW > maxAvail) { pitch = Math.max(6, Math.floor(maxAvail / values.length)); barW = Math.max(4, pitch - 4); }
    var lblMaxW = Math.max(8, pitch - 3);   /* labels stay narrower than the pitch -> >=3px gap */
    for (i = 0; i < values.length; i++) {
      var h = (Math.abs(values[i]) / maxV) * chartH;
      var bx = x0 + i * pitch;
      var by = baseY - h;
      var col = colors[i] ? colorOf(colors[i]) : accent.base;
      ctx.out.push('<rect x="' + num(bx) + '" y="' + num(by) + '" width="' + barW +
        '" height="' + num(h) + '" rx="2" fill="' + esc(col) + '"/>');
      if (labels[i] != null) {
        var lblY = baseY + 12;
        pushLine(ctx, bx + barW / 2, lblY, ellipsize(String(labels[i]), lblMaxW, 9, { anchor: "middle" }), 9, { fill: PALETTE.text.muted, anchor: "middle" });
      }
    }
    /* dashed threshold line */
    if (b.threshold != null) {
      var ty = baseY - (Math.abs(b.threshold) / maxV) * chartH;
      ctx.out.push('<line x1="' + num(x0) + '" y1="' + num(ty) + '" x2="' + num(x0 + values.length * pitch) +
        '" y2="' + num(ty) + '" stroke="' + esc(PALETTE.accent.rose.base) + '" stroke-width="1" stroke-dasharray="3 3"/>');
    }
    return chartH + (labels.length ? 20 : 6);
  }

  function render_legend(b, colLeft, colRight, cursorY, budget, accent, ctx) {
    var fontSize = 11, adv = 18;
    var items = b.items || [];
    var maxW = colRight - colLeft;
    var x = colLeft, y = cursorY + fontSize + 2, used = 0;
    var rowItems = 0, rowStartUsed = 0;
    for (var i = 0; i < items.length; i++) {
      var label = String(items[i].label);
      var swatch = 14;
      var w = swatch + 4 + estTextWidth(label, fontSize, {}) + 12;
      if (x + w > colLeft + maxW && rowItems > 0) {
        x = colLeft; y += adv; rowItems = 0;
      }
      if (y - cursorY > budget) {
        if (ctx.strict) throw new Error("OVERFLOW_PANEL_" + ctx.letter);
        break;
      }
      var col = colorOf(items[i].color);
      ctx.out.push('<circle cx="' + num(x + 5) + '" cy="' + num(y - 4) + '" r="5" fill="' + esc(col) + '"/>');
      pushLine(ctx, x + swatch, y, label, fontSize, { fill: PALETTE.text.body });
      x += w; rowItems++;
      used = (y - cursorY) + 4;
    }
    return used;
  }

  function render_spacer(b, colLeft, colRight, cursorY, budget, accent, ctx) {
    return Math.max(0, Number(b.h) || 0);
  }

  var BLOCK_RENDERERS = {
    text: render_text, formula: render_formula, kv: render_kv,
    matrix: render_matrix, plot: render_plot, bars: render_bars,
    legend: render_legend, spacer: render_spacer
  };

  /* ========================================================================
   * CAPTION packing
   * ======================================================================*/
  /* tokenize a string caption into runs: lead + body, auto-coloring (x) markers */
  function tokenizeCaption(str, id) {
    var runs = [];
    var s = String(str);
    /* lead = "Figure <ID>." if it appears at the start */
    var leadRe = new RegExp("^\\s*(Figure\\s+" + (id ? id : "[A-Za-z0-9]+") + "\\.)\\s*", "i");
    var m = s.match(leadRe);
    var lead = null;
    if (m) { lead = m[1]; s = s.slice(m[0].length); }
    /* split on (x) markers, keeping them */
    var parts = s.split(/(\([a-d]\))/g);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      var mk = p.match(/^\(([a-d])\)$/);
      if (mk) runs.push({ panel: mk[1], text: p, marker: true });
      else runs.push({ text: p });
    }
    return { lead: lead, runs: runs };
  }

  function captionRunColor(run) {
    if (run.panel) {
      var map = { a: PALETTE.accent.cyan.light, b: PALETTE.accent.rose.light, c: PALETTE.accent.amber.light, d: PALETTE.accent.violet.light };
      return { fill: map[run.panel] || GRID.caption.bodyColor, weight: run.marker ? "700" : null };
    }
    return { fill: GRID.caption.bodyColor, weight: null };
  }

  /* greedily wrap runs into lines (each line is an array of {text,fill,weight}) */
  function wrapCaptionRuns(lead, runs, maxW, fontSize, maxChars) {
    var lines = [];
    var cur = [];
    var curW = 0, curChars = 0;
    function pushWord(text, fill, weight) {
      var w = estTextWidth(text + " ", fontSize, { bold: !!weight });
      var chars = text.length + 1;
      if ((curW + w > maxW || curChars + chars > maxChars) && cur.length) {
        lines.push(cur); cur = []; curW = 0; curChars = 0;
      }
      cur.push({ text: text, fill: fill, weight: weight });
      curW += w; curChars += chars;
    }
    /* lead first */
    if (lead) pushWord(lead, GRID.caption.leadColor, "700");
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      var col = captionRunColor(r);
      if (r.marker) {
        pushWord(r.text, col.fill, col.weight);
      } else {
        var words = String(r.text).split(/\s+/).filter(function (w) { return w.length; });
        for (var j = 0; j < words.length; j++) pushWord(words[j], col.fill, col.weight);
      }
    }
    if (cur.length) lines.push(cur);
    return lines;
  }

  function emitCaption(config, ctx) {
    var C = GRID.caption;
    var out = ctx.out;
    /* divider */
    out.push('<line x1="40" y1="' + C.dividerY + '" x2="900" y2="' + C.dividerY +
      '" stroke="' + esc(PALETTE.surf.stroke) + '" stroke-width="1"/>');

    var lead, runs;
    if (config.caption && typeof config.caption === "object" && config.caption.runs) {
      lead = config.caption.lead || ("Figure " + config.id + ".");
      runs = config.caption.runs.map(function (r) {
        return { panel: r.panel || null, text: r.text };
      });
    } else {
      var tk = tokenizeCaption(config.caption || "", config.id);
      lead = tk.lead || ("Figure " + config.id + ".");
      runs = tk.runs;
    }

    var maxW = 900 - C.spanLeftX; /* 860 */
    var lines = wrapCaptionRuns(lead, runs, maxW, C.fontSize, C.maxCharsPerLine);

    if (lines.length > C.maxLines) {
      throw new Error("CAPTION_OVERFLOW: needs " + lines.length + " lines, max " + C.maxLines +
        " — shorten or move text into panels.");
    }

    for (var li = 0; li < lines.length; li++) {
      var baseY = C.firstLineY + li * C.lineDy;
      var x = C.spanLeftX;
      var lineArr = lines[li];
      for (var ri = 0; ri < lineArr.length; ri++) {
        var seg = lineArr[ri];
        var txt = (ri === lineArr.length - 1) ? seg.text : seg.text + " ";
        out.push(svgText(x, baseY, {
          text: txt, size: C.fontSize, fill: seg.fill, weight: seg.weight || undefined
        }));
        ctx.track.add(x, baseY, txt, C.fontSize, { bold: !!seg.weight });
        x += estTextWidth(seg.text + " ", C.fontSize, { bold: !!seg.weight });
      }
    }
  }

  /* ========================================================================
   * buildFigureSVG(config)
   * ======================================================================*/
  function buildFigureSVG(config) {
    config = config || {};
    /* ---- 0. validate ---- */
    if (!config.id) throw new Error("FIGURE_CONFIG: 'id' is required");
    if (!config.block) throw new Error("FIGURE_CONFIG: 'block' is required");
    if (!config.title) throw new Error("FIGURE_CONFIG: 'title' is required");
    if (!Array.isArray(config.panels) || config.panels.length !== 4) {
      throw new Error("FIGURE_PANELS: need exactly 4");
    }
    for (var pv = 0; pv < 4; pv++) {
      var pp = config.panels[pv];
      if (!pp || !pp.accent) throw new Error("FIGURE_PANEL_" + LETTERS[pv] + ": 'accent' required");
      if (!pp.heading) throw new Error("FIGURE_PANEL_" + LETTERS[pv] + ": 'heading' required");
    }

    var strict = !!config.strict;
    var out = [];
    var track = makeTracker();
    var ctx = { out: out, track: track, strict: strict, letter: "" };

    /* ---- SVG open ---- */
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ' +
      GRID.VB.W + ' ' + GRID.VB.H +
      '" font-family="Inter, \'Segoe UI\', system-ui, sans-serif" role="img" aria-labelledby="t d">');
    out.push('<title id="t">Figure ' + esc(config.id) + ' — ' + esc(config.title) + '</title>');
    out.push('<desc id="d">' + esc("Four-panel captioned figure: " + config.title) + '</desc>');

    /* ---- 1. background + glow ---- */
    out.push('<rect x="0" y="0" width="940" height="664" fill="' + esc(PALETTE.surf.bg) + '"/>');
    var glow = config.glow || GRID.glowDefault;
    for (var g = 0; g < glow.length; g++) {
      var gl = glow[g];
      out.push('<circle cx="' + num(gl.cx) + '" cy="' + num(gl.cy) + '" r="' + num(gl.r) +
        '" fill="' + esc(gl.color) + '" opacity="' + num(gl.op) + '"/>');
    }

    /* ---- 2. header ---- */
    var H = GRID.header;
    var eyebrow = ("FIGURE " + config.id + " · " + config.block).toUpperCase();
    /* letter-spacing-aware fit: estTextWidth ignores ls (=2.5), so a long block
       would silently overflow past x=900 while the self-check under-counts.
       Guard with headerWidth + ellipsize, and record the TRUE width. */
    eyebrow = ellipsizeHeader(eyebrow, GRID.SAFE.R - H.eyebrowX, H.eyebrowSize, H.eyebrowLS);
    var eyebrowW = headerWidth(eyebrow, H.eyebrowSize, H.eyebrowLS);
    out.push(svgText(H.eyebrowX, H.eyebrowY, {
      text: eyebrow, size: H.eyebrowSize, fill: PALETTE.accent.cyan.base, weight: "700", ls: H.eyebrowLS
    }));
    track.add(H.eyebrowX, H.eyebrowY, eyebrow, H.eyebrowSize, { width: eyebrowW });

    var titleSize = H.titleSize;
    var titleW = estTextWidth(config.title, titleSize, { bold: true });
    while (titleW > (GRID.SAFE.R - H.titleX) && titleSize > H.titleMin) {
      titleSize -= 1;
      titleW = estTextWidth(config.title, titleSize, { bold: true });
    }
    if (titleW > (GRID.SAFE.R - H.titleX)) {
      throw new Error("TITLE_OVERFLOW: title too wide even at size " + H.titleMin + " — shorten title.");
    }
    out.push(svgText(H.titleX, H.titleY, {
      text: config.title, size: titleSize, fill: PALETTE.text.title, weight: "700"
    }));
    track.add(H.titleX, H.titleY, config.title, titleSize, { bold: true });

    /* ---- 3. panels ---- */
    var P = GRID.panel;
    for (var i = 0; i < 4; i++) {
      var panel = config.panels[i];
      var letter = panel.letter || LETTERS[i];
      var accentName = panel.accent || DEFAULT_PANEL_ACCENTS[i];
      var accent = resolveAccent(accentName);
      var rect = panelRect(i);
      ctx.letter = letter;

      /* card rect */
      out.push('<rect x="' + num(rect.x) + '" y="' + num(rect.y) + '" width="' + num(rect.w) +
        '" height="' + num(rect.h) + '" rx="' + P.rx + '" fill="' + esc(rect.fill) +
        '" stroke="' + esc(P.strokeRow) + '"/>');
      /* accent strip */
      out.push('<rect x="' + num(rect.x) + '" y="' + num(rect.y) + '" width="' + num(rect.w) +
        '" height="' + P.accentStripH + '" rx="2" fill="' + esc(accent.base) + '"/>');
      /* letter badge */
      var bcx = rect.x + P.badge.dx, bcy = rect.y + P.badge.dy;
      out.push('<circle cx="' + num(bcx) + '" cy="' + num(bcy) + '" r="' + P.badge.r +
        '" fill="' + esc(accent.tint) + '" stroke="' + esc(accent.base) + '" stroke-width="1"/>');
      out.push(svgText(bcx, bcy + 5, {
        text: letter, size: 14, fill: accent.light, weight: "700", anchor: "middle"
      }));
      track.add(bcx, bcy + 5, letter, 14, { anchor: "middle" });

      /* heading (ellipsized to fit) */
      var headX = rect.x + P.headingDx;
      var headY = rect.y + P.headingDy;
      var headMaxW = (rect.x + rect.w - P.padX) - headX;
      var headStr = ellipsize(String(panel.heading), headMaxW, P.headingSize, { bold: true });
      out.push(svgText(headX, headY, {
        text: headStr, size: P.headingSize, fill: PALETTE.text.heading, weight: "700"
      }));
      track.add(headX, headY, headStr, P.headingSize, { bold: true });

      /* content flow */
      var colLeft = rect.x + P.padX;
      var colRight = rect.x + rect.w - P.padX;
      var cursorY = rect.y + P.contentTopDy;
      var floor = rect.y + rect.h - P.padBottom;
      var content = panel.content || [];
      for (var ci = 0; ci < content.length; ci++) {
        var block = content[ci];
        var renderer = BLOCK_RENDERERS[block.type];
        if (!renderer) throw new Error("FIGURE_BLOCK: unknown content type '" + block.type + "' in panel " + letter);
        var budget = floor - cursorY;
        if (budget <= 0) {
          if (strict) throw new Error("OVERFLOW_PANEL_" + letter);
          break;
        }
        var h = renderer(block, colLeft, colRight, cursorY, budget, accent, ctx);
        cursorY += h + P.blockGap;
        if (cursorY >= floor) {
          if (ci < content.length - 1 && !strict) {
            /* signal more content was clipped */
            if (cursorY < floor + 4) clipNote(ctx, colLeft, floor, colRight - colLeft);
          }
          if (cursorY > floor + 2 && strict) throw new Error("OVERFLOW_PANEL_" + letter);
        }
      }
    }

    /* ---- 4. caption ---- */
    emitCaption(config, ctx);

    /* ---- 5. self-check ---- */
    var R = GRID.SAFE.R, B = GRID.SAFE.B, L = GRID.SAFE.L;
    if (track.maxRight > R + 0.5) throw new Error("SELFCHECK: maxRight " + track.maxRight.toFixed(1) + " > " + R);
    if (track.maxBottom > B + 0.5) throw new Error("SELFCHECK: maxBottom " + track.maxBottom.toFixed(1) + " > " + B);
    if (track.minLeft < L - 0.5) throw new Error("SELFCHECK: minLeft " + track.minLeft.toFixed(1) + " < " + L);
    /* real text-vs-text overlap check (kit-model boxes) */
    var overlaps = findOverlaps(track.rows, 1.5);
    if (overlaps.length && strict) throw new Error("SELFCHECK_OVERLAP: " + overlaps.length +
      " text overlaps; first " + JSON.stringify(overlaps[0]));

    out.push('</svg>');

    buildFigureSVG.lastReport = {
      textNodes: track.rows.length,
      maxRight: Math.round(track.maxRight * 10) / 10,
      maxBottom: Math.round(track.maxBottom * 10) / 10,
      minLeft: Math.round(track.minLeft * 10) / 10,
      overlaps: overlaps.length,
      overlapPairs: overlaps.slice(0, 8),
      lines: track.rows.length
    };

    return out.join("\n");
  }
  buildFigureSVG.lastReport = null;

  /* ========================================================================
   * INLINE block renderers (compact zone-scoped)
   * ======================================================================*/
  function inlineBars(zone, spec, ctx) {
    var values = spec.values || [];
    var labels = spec.labels || [];
    var colors = spec.colors || [];
    var x0 = zone.x, w = zone.w;
    var maxLblW = 0; for (var li = 0; li < labels.length; li++) if (labels[li] != null) maxLblW = Math.max(maxLblW, estTextWidth(String(labels[li]), 9));
    var avail = Math.floor(w / Math.max(1, values.length));
    var pitch = Math.min(avail, Math.max(20, Math.ceil(maxLblW) + 6));   /* widen to fit labels (incl. acronyms) when the zone allows */
    var barW = Math.max(6, Math.min(14, pitch - 6));
    var lblMaxW = Math.max(8, pitch - 3);   /* label box stays narrower than pitch -> no collision */
    var chartH = 70, baseY = 150;
    var maxV = 0, i;
    for (i = 0; i < values.length; i++) maxV = Math.max(maxV, Math.abs(values[i]));
    if (maxV === 0) maxV = 1;
    if (spec.sectionLabel) {
      pushLineInline(ctx, x0, 56, ellipsize(String(spec.sectionLabel), w, 11, {}), 11, { fill: PALETTE.text.muted });
    }
    for (i = 0; i < values.length; i++) {
      var h = (Math.abs(values[i]) / maxV) * chartH;
      var bx = x0 + i * pitch;
      var by = baseY - h;
      var col = colors[i] ? colorOf(colors[i]) : PALETTE.accent.cyan.base;
      ctx.out.push('<rect x="' + num(bx) + '" y="' + num(by) + '" width="' + barW +
        '" height="' + num(h) + '" rx="2" fill="' + esc(col) + '"/>');
      if (labels[i] != null) {
        var lblStr = ellipsize(String(labels[i]), lblMaxW, 9, { anchor: "middle" });
        /* keep the centered label's estimated box inside [SAFE.L, SAFE.R] */
        var lblHalf = estTextWidth(lblStr, 9, {}) / 2;
        var lblCx = clampNum(bx + barW / 2, INLINE.SAFE.L + lblHalf, INLINE.SAFE.R - lblHalf);
        pushLineInline(ctx, lblCx, baseY + 14, lblStr, 9, { fill: PALETTE.text.muted, anchor: "middle" });
      }
    }
    if (spec.threshold != null) {
      var ty = baseY - (Math.abs(spec.threshold) / maxV) * chartH;
      ctx.out.push('<line x1="' + num(x0) + '" y1="' + num(ty) + '" x2="' + num(x0 + values.length * pitch) +
        '" y2="' + num(ty) + '" stroke="' + esc(PALETTE.accent.rose.base) + '" stroke-width="1" stroke-dasharray="3 3"/>');
    }
  }

  function inlineCards(zone, spec, ctx) {
    var mid = INLINE.zones.mid;
    var cards = (spec.cards || []).slice(0, 4);
    for (var i = 0; i < cards.length; i++) {
      var col = i % 2, row = Math.floor(i / 2);
      var cx = mid.x0 + col * mid.colDx;
      var cy = mid.y0 + row * mid.rowDy;
      var card = cards[i];
      var accent = PALETTE.accent[card.accent] ? PALETTE.accent[card.accent] : PALETTE.accent.cyan;
      ctx.out.push('<rect x="' + num(cx) + '" y="' + num(cy) + '" width="' + mid.cardW +
        '" height="' + mid.cardH + '" rx="6" fill="' + esc(PALETTE.surf.cardTop) +
        '" stroke="' + esc(PALETTE.surf.stroke) + '"/>');
      var label = ellipsize(String(card.label), mid.cardW - 8, 9, { anchor: "middle" });
      var value = ellipsize(String(card.value), mid.cardW - 8, 13, { anchor: "middle", bold: true });
      pushLineInline(ctx, cx + mid.cardW / 2, cy + 15, label, 9, { fill: PALETTE.text.muted, anchor: "middle" });
      pushLineInline(ctx, cx + mid.cardW / 2, cy + 32, value, 13, { fill: accent.light, anchor: "middle", weight: "700" });
    }
  }

  function inlineKv(zone, spec, ctx) {
    var right = INLINE.zones.right;
    var rows = (spec.rows || []).slice(0, 4);
    var keyMaxW = 110, valX = right.x + 120, valMaxW = (right.x + right.w) - valX;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var label, value, accentTok;
      if (Array.isArray(r)) { label = r[0]; value = r[1]; accentTok = r[2]; }
      else { label = r.label; value = r.value; accentTok = r.accent; }
      var y = right.rowY0 + i * right.rowDy;
      var keyColor = accentTok ? colorOf(accentTok) : PALETTE.accent.cyan.base;
      pushLineInline(ctx, right.x, y, ellipsize(String(label), keyMaxW, 11.5, { bold: true }), 11.5, { fill: keyColor, weight: "700" });
      pushLineInline(ctx, valX, y, ellipsize(String(value), valMaxW, 11.5, {}), 11.5, { fill: PALETTE.text.body });
    }
  }

  function pushLineInline(ctx, x, y, str, fontSize, opts) {
    ctx.out.push(svgText(x, y, {
      text: str, size: fontSize, fill: opts.fill, weight: opts.weight, anchor: opts.anchor, family: opts.family
    }));
    ctx.track.add(x, y, str, fontSize, opts);
  }

  function renderInlineZone(zoneName, zone, spec, ctx) {
    if (!spec) return;
    if (spec.type === "bars") inlineBars(zone, spec, ctx);
    else if (spec.type === "cards") inlineCards(zone, spec, ctx);
    else if (spec.type === "kv") inlineKv(zone, spec, ctx);
    else throw new Error("INLINE_ZONE: unknown type '" + spec.type + "' for zone " + zoneName);
  }

  /* ========================================================================
   * buildInlineSVG(config)
   * ======================================================================*/
  function buildInlineSVG(config) {
    config = config || {};
    if (!config.id) throw new Error("INLINE_CONFIG: 'id' is required");
    var out = [];
    var track = makeTracker();
    var ctx = { out: out, track: track };

    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ' +
      INLINE.VB.W + ' ' + INLINE.VB.H +
      '" font-family="Inter, \'Segoe UI\', system-ui, sans-serif" role="img" aria-label="' +
      esc("Figure " + config.id + " inline") + '">');

    /* background */
    out.push('<rect x="0" y="0" width="900" height="230" fill="' + esc(PALETTE.surf.bg) + '"/>');

    /* eyebrow */
    var ey = INLINE.eyebrow;
    var eyebrowStr = (config.eyebrow != null ? String(config.eyebrow) :
      (config.id + (config.block ? " · " + config.block : ""))).toUpperCase();
    /* letter-spacing-aware fit (estTextWidth ignores ls) */
    eyebrowStr = ellipsizeHeader(eyebrowStr, INLINE.SAFE.R - ey.x, ey.size, ey.ls);
    var eyebrowStrW = headerWidth(eyebrowStr, ey.size, ey.ls);
    out.push(svgText(ey.x, ey.y, {
      text: eyebrowStr, size: ey.size, fill: PALETTE.accent.cyan.base, weight: "700", ls: ey.ls
    }));
    track.add(ey.x, ey.y, eyebrowStr, ey.size, { width: eyebrowStrW });

    /* left zone */
    renderInlineZone("left", INLINE.zones.left, config.left, ctx);

    /* arrow connector */
    var ax = INLINE.zones.arrowX;
    out.push(svgText(ax, 124, { text: "→", size: 26, fill: PALETTE.text.muted, anchor: "middle" }));
    track.add(ax, 124, "→", 26, { anchor: "middle" });

    /* mid zone */
    renderInlineZone("mid", INLINE.zones.mid, config.mid, ctx);

    /* vertical separator */
    var sx = INLINE.zones.sepX;
    out.push('<line x1="' + sx + '" y1="60" x2="' + sx + '" y2="178" stroke="' +
      esc(PALETTE.surf.sep) + '" stroke-width="1"/>');

    /* right zone */
    renderInlineZone("right", INLINE.zones.right, config.right, ctx);

    /* takeaway moral */
    if (config.takeaway) {
      var tk = INLINE.takeaway;
      var maxW = INLINE.SAFE.R - INLINE.SAFE.L;
      var tstr = ellipsize(String(config.takeaway), maxW, tk.size, { anchor: tk.anchor });
      out.push(svgText(tk.x, tk.y, { text: tstr, size: tk.size, fill: PALETTE.text.caption, anchor: tk.anchor }));
      track.add(tk.x, tk.y, tstr, tk.size, { anchor: tk.anchor });
    }

    /* self-check */
    var R = INLINE.SAFE.R, B = INLINE.SAFE.B, L = INLINE.SAFE.L;
    if (track.maxRight > R + 0.5) throw new Error("INLINE_SELFCHECK: maxRight " + track.maxRight.toFixed(1) + " > " + R);
    if (track.maxBottom > B + 0.5) throw new Error("INLINE_SELFCHECK: maxBottom " + track.maxBottom.toFixed(1) + " > " + B);
    if (track.minLeft < L - 0.5) throw new Error("INLINE_SELFCHECK: minLeft " + track.minLeft.toFixed(1) + " < " + L);
    var inlineOverlaps = findOverlaps(track.rows, 1.5);

    out.push('</svg>');

    buildInlineSVG.lastReport = {
      textNodes: track.rows.length,
      maxRight: Math.round(track.maxRight * 10) / 10,
      maxBottom: Math.round(track.maxBottom * 10) / 10,
      minLeft: Math.round(track.minLeft * 10) / 10,
      overlaps: inlineOverlaps.length,
      overlapPairs: inlineOverlaps.slice(0, 8),
      lines: track.rows.length
    };

    return out.join("\n");
  }
  buildInlineSVG.lastReport = null;

  /* ========================================================================
   * EXPORTS
   * ======================================================================*/
  return {
    buildFigureSVG: buildFigureSVG,
    buildInlineSVG: buildInlineSVG,
    estTextWidth: estTextWidth,
    headerWidth: headerWidth,
    wrapText: wrapText,
    ellipsize: ellipsize,
    PALETTE: PALETTE,
    GRID: GRID,
    INLINE: INLINE,
    VERSION: "2.0.0"
  };
}));
