/* RIDA project page: charts, explainers and small interactions. Plain SVG, no chart library. */
(function () {
  "use strict";
  const D = window.RIDA_DATA;
  const NS = "http://www.w3.org/2000/svg";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) {
      if (k === "text") e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(e);
    return e;
  }
  function svgRoot(w, h, label) {
    const s = el("svg", { viewBox: `0 0 ${w} ${h}`, role: "img" });
    if (label) s.setAttribute("aria-label", label);
    return s;
  }
  const fmt = (v, d = 2) => (v == null || isNaN(v) ? "–" : v.toFixed(d));
  const sgn = (v, d = 2) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d);
  const ranks = (v) => v.map((x) => 1 + v.filter((y) => y < x).length);

  /* ---------- shared bits ---------- */
  const tip = $("#tip");
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.classList.add("show");
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = Math.max(8, top) + "px";
  }
  const hideTip = () => tip.classList.remove("show");
  function hover(node, html) {
    node.style.cursor = "default";
    node.addEventListener("pointermove", (e) => showTip(typeof html === "function" ? html() : html, e.clientX, e.clientY));
    node.addEventListener("pointerleave", hideTip);
    node.addEventListener("pointerdown", (e) => showTip(typeof html === "function" ? html() : html, e.clientX, e.clientY));
  }
  window.addEventListener("scroll", hideTip, { passive: true });

  function seg(box, cb) {
    if (!box) return;
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !box.contains(b)) return;
      $$("button", box).forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      cb(b.dataset.v ?? b.dataset.px);
    });
  }
  const pressed = (box) => {
    const b = $('button[aria-pressed="true"]', box);
    return b ? b.dataset.v ?? b.dataset.px : null;
  };
  function setButtons(box, items, active) {
    box.innerHTML = "";
    items.forEach(([v, label]) => {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.v = v; b.textContent = label;
      b.setAttribute("aria-pressed", v === active ? "true" : "false");
      box.appendChild(b);
    });
  }

  const METHODS = D.methods;
  const MNAME = Object.fromEntries(METHODS.map((m) => [m.key, m.name]));
  const COMP = METHODS.filter((m) => ["natural", "medical", "bio"].includes(m.family)).map((m) => m.key);
  const FAMLABEL = { natural: "Natural-image UDA", medical: "Medical-image UDA", bio: "Biological-image UDA" };
  const BB = [["unet", "U-Net"], ["dinov3", "DINOv3"], ["medsam", "MedSAM"]];
  const BBN = Object.fromEntries(BB);
  const BENCH = {
    abdomen: { name: "Abdomen", dirs: { mr2ct: "MR→CT", ct2mr: "CT→MR" } },
    mmwhs: { name: "MM-WHS", dirs: { mr2ct: "MR→CT", ct2mr: "CT→MR" } },
    lucchi: { name: "VNC III→Lucchi", dirs: { s1: "Subset 1", s2: "Subset 2" } },
    mitoem: { name: "MitoEM", dirs: { r2h: "R→H", h2r: "H→R" } },
  };
  const lowerBetter = (metric) => /ASSD/i.test(metric);

  /* ---------- nav, copy, lightbox ---------- */
  const navLinks = $$(".nav a");
  const secs = navLinks.map((a) => $(a.getAttribute("href"))).filter(Boolean);
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((ents) => {
      ents.forEach((en) => {
        if (en.isIntersecting) {
          navLinks.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + en.target.id));
        }
      });
    }, { rootMargin: "-35% 0px -60% 0px" });
    secs.forEach((s) => io.observe(s));
  }
  $$(".copy").forEach((b) => {
    b.addEventListener("click", () => {
      const pre = b.parentElement.querySelector("pre");
      const text = pre.innerText;
      const done = () => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1400); };
      const fallback = () => {
        const r = document.createRange(); r.selectNodeContents(pre);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        b.textContent = "Selected";
        setTimeout(() => (b.textContent = "Copy"), 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    });
  });
  document.addEventListener("click", (e) => {
    const img = e.target.closest(".plate img");
    if (!img) return;
    const box = document.createElement("div");
    box.className = "lightbox";
    const big = document.createElement("img");
    big.src = img.src; big.alt = img.alt;
    box.appendChild(big);
    const close = () => { box.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (k) => { if (k.key === "Escape") close(); };
    box.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(box);
  });


  const topbar = $(".top");
  const onScroll = () => topbar && topbar.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ================= cover: one pixel's similarities under a drifting monotone shift ================= */
  (function drawArt() {
    const svg = $("#art");
    if (!svg) return;
    const W = 520, H = 470, X0 = 44, X1 = W - 44, T = 14, B = 66, N = 32, ETA = 0.62;
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const s = Array.from({ length: N }, (_, i) => 0.05 + 0.9 * Math.pow((i + 0.5 + 0.7 * (rnd() - 0.5)) / N, 1.12));
    const yv = (v) => T + (1 - v) * (H - T - B);
    const sig = (z) => 1 / (1 + Math.exp(-z));
    // increasing in v at every t and phase, so no two strands ever cross;
    // the map itself drifts along t, which makes the strands ripple
    function warp(v, t, ph) {
      const lam = t * t * (3 - 2 * t);
      const gam = Math.exp(0.8 * Math.sin(ph + 2.4 * t));
      const c = 0.5 + 0.2 * Math.sin(0.7 * ph + 1.1 + 1.7 * t), k = 7;
      const lo = sig(-k * c), hi = sig(k * (1 - c));
      const h = 0.55 * Math.pow(v, gam) + 0.45 * (sig(k * (v - c)) - lo) / (hi - lo);
      return (1 - lam) * v + lam * h;
    }
    const lab = "font-size:11px;fill:var(--muted)";
    [X0, X1].forEach((x) => el("line", { x1: x, x2: x, y1: T - 6, y2: yv(0) + 6, style: "stroke:var(--rule-2);stroke-width:1" }, svg));
    el("line", { x1: X0 - 14, x2: X1 + 14, y1: yv(ETA), y2: yv(ETA), style: "stroke:var(--ink-2);stroke-width:1;stroke-dasharray:2 4" }, svg);
    el("text", { x: X0 - 20, y: yv(ETA) + 4, "text-anchor": "end", style: "font-family:var(--f-serif);font-style:italic;font-size:15px;fill:var(--muted)", text: "η" }, svg);
    const g = el("g", {}, svg);
    const top = N - 1;
    const paths = s.map((_, i) => el("path", {
      fill: "none", "stroke-linecap": "round",
      style: i === top ? "stroke:var(--accent);stroke-width:1.7" : `stroke:var(--ink);stroke-width:.8;stroke-opacity:${(0.14 + 0.62 * i / (N - 1)).toFixed(2)}`,
    }, g));
    s.forEach((v, i) => el("circle", { cx: X0, cy: yv(v), r: i === top ? 2.8 : 1.7, style: `fill:${i === top ? "var(--accent)" : "var(--ink)"}` }, g));
    const ends = s.map((_, i) => el("circle", { cx: X1, r: i === top ? 2.8 : 1.7, style: `fill:${i === top ? "var(--accent)" : "var(--ink)"}` }, g));
    const yb = yv(0) + 28;
    el("text", { x: X0, y: yb, style: lab, text: "Source" }, svg);
    el("text", { x: X1, y: yb, "text-anchor": "end", style: lab, text: "Target" }, svg);
    const cnt = "font-size:11px;fill:var(--ink-2)";
    el("text", { x: X0, y: yb + 20, style: cnt, text: `${s.filter((v) => v >= ETA).length} above η` }, svg);
    const cntR = el("text", { x: X1, y: yb + 20, "text-anchor": "end", style: cnt }, svg);
    const STEPS = 80;
    function frame(ph) {
      let n1 = 0;
      s.forEach((v, i) => {
        let d = "";
        for (let j = 0; j <= STEPS; j++) {
          const t = j / STEPS;
          d += (j ? "L" : "M") + (X0 + t * (X1 - X0)).toFixed(1) + " " + yv(warp(v, t, ph)).toFixed(1);
        }
        paths[i].setAttribute("d", d);
        const e = warp(v, 1, ph);
        ends[i].setAttribute("cy", yv(e).toFixed(1));
        if (e >= ETA) n1++;
      });
      cntR.textContent = `${n1} above η`;
    }
    const PH0 = 2.2;
    frame(PH0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let visible = true, t0 = null, raf = 0;
    const tick = (now) => {
      if (t0 === null) t0 = now;
      frame(PH0 + ((now - t0) / 26000) * 2 * Math.PI);
      raf = visible ? requestAnimationFrame(tick) : 0;
    };
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([en]) => {
        visible = en.isIntersecting;
        if (visible && !raf) raf = requestAnimationFrame((now) => { t0 = t0 === null ? now : t0; tick(now); });
      }).observe(svg);
    }
    raf = requestAnimationFrame(tick);
  })();

  /* ================= motivation demo: threshold against ranking ================= */
  const DEMO_ANCH = [
    { n: "AA", c: "#e9967a" }, { n: "LAC", c: "#e8c478" }, { n: "LVC", c: "#9c9ce4" },
    { n: "MYO", c: "#79bdb2" }, { n: "BG", c: "#b3bdbf" },
  ];
  const DEMO_PX = {
    aa: { sims: [0.93, 0.52, 0.40, 0.30, 0.18], k: 0.35 },
    lvc: { sims: [0.36, 0.63, 0.90, 0.55, 0.20], k: 1.3 },
    myo: { sims: [0.30, 0.42, 0.58, 0.88, 0.25], k: 2.8 },
  };
  let demoPx = "myo";
  function drawDemo() {
    const svg = $("#demo-svg");
    if (!svg) return;
    svg.innerHTML = "";
    const t = +$("#shift").value;
    const px = DEMO_PX[demoPx];
    const cur = px.sims.map((s) => Math.pow(s, 1 + px.k * t));
    const W = 460, L = 36, R = 44, T = 18, B = 52, H = 250 - T - B;
    const y = (v) => T + (1 - v) * H;
    [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
      el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), style: "stroke:var(--rule);stroke-width:1" }, svg);
      el("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", style: "fill:var(--muted);font-size:10px", text: v.toFixed(2) }, svg);
    });
    const slot = (W - L - R) / 5, bw = 24;
    const rk = ranks(cur);
    cur.forEach((v, i) => {
      const cx = L + slot * (i + 0.5);
      el("rect", { x: cx - bw / 2, y: y(px.sims[i]), width: bw, height: Math.max(0, y(0) - y(px.sims[i])), style: "fill:none;stroke:var(--ink-2);stroke-width:.8;stroke-dasharray:2 2" }, svg);
      el("rect", { x: cx - bw / 2 + 4, y: y(v), width: bw - 8, height: Math.max(0, y(0) - y(v)), style: `fill:${DEMO_ANCH[i].c}` }, svg);
      el("text", { x: cx, y: y(Math.max(v, px.sims[i])) - 6, "text-anchor": "middle", style: "fill:var(--ink);font-size:11px;font-variant-numeric:tabular-nums", text: v.toFixed(2) }, svg);
      el("text", { x: cx, y: y(0) + 17, "text-anchor": "middle", style: "fill:var(--ink-2);font-size:11px;font-weight:500", text: DEMO_ANCH[i].n }, svg);
      el("text", { x: cx, y: y(0) + 40, "text-anchor": "middle", style: "fill:var(--accent);font-family:var(--f-serif);font-size:15px", text: String(6 - rk[i]) }, svg);
    });
    el("line", { x1: L, x2: W - R, y1: y(0.7), y2: y(0.7), style: "stroke:var(--flip);stroke-width:1;stroke-dasharray:3 3" }, svg);
    el("text", { x: W - R + 6, y: y(0.7) + 5, style: "fill:var(--flip);font-family:var(--f-serif);font-style:italic;font-size:14px", text: "η" }, svg);
    el("line", { x1: L, x2: W - R, y1: y(0), y2: y(0), style: "stroke:var(--ink-2);stroke-width:1" }, svg);
    el("text", { x: W - R + 6, y: y(0) + 39, style: "fill:var(--muted);font-size:10px", text: "rank" }, svg);

    const top = Math.max(...cur), own = DEMO_ANCH[px.sims.indexOf(Math.max(...px.sims))].n;
    const gate = $("#demo-gate");
    const pass = top >= 0.7;
    gate.className = "readline" + (pass ? "" : " bad");
    $(":scope > span", gate).textContent = pass
      ? `${own} similarity ${top.toFixed(2)} ≥ 0.7, pseudo-label kept`
      : `${own} similarity ${top.toFixed(2)} < 0.7, pseudo-label dropped`;
    const order = cur.map((v, i) => [v, DEMO_ANCH[i].n]).sort((a, b) => b[0] - a[0]).map((x) => x[1]).join(" › ");
    $(":scope > span", $("#demo-rank")).textContent = `${order}, as on the source`;
  }
  seg($("#demo .seg"), (v) => { demoPx = v; drawDemo(); });
  $("#shift").addEventListener("input", drawDemo);
  drawDemo();

  /* ================= dumbbell: 24 settings ================= */
  function strongest(rows, bb, dir, mi, metric) {
    const lb = lowerBetter(metric);
    let best = null;
    COMP.forEach((k) => {
      const v = rows[k][bb][dir][mi];
      if (best === null || (lb ? v < best.v : v > best.v)) best = { k, v };
    });
    return best;
  }
  function drawDumbbell() {
    const host = $("#dumbbell");
    host.innerHTML = "";
    const seedOf = {};
    let ti = 0;
    Object.entries(BENCH).forEach(([bk]) => D.main[bk].dirs.forEach((dk) => (seedOf[bk + dk] = D.seeds[ti++])));
    // two panels: cross-modality (Dice) and electron microscopy (F1), each on its own axis
    [["abdomen", "mmwhs"], ["lucchi", "mitoem"]].forEach((group) => {
      const items = [];
      group.forEach((bk) => {
        const b = BENCH[bk], M = D.main[bk];
        M.dirs.forEach((dk) => {
          const seeds = seedOf[bk + dk];
          items.push({ head: `${b.name} ${b.dirs[dk]}`, metric: M.metrics[0] });
          BB.forEach(([bb, bbn], j) => {
            const r = M.rows.rida[bb][dk][0];
            const c = strongest(M.rows, bb, dk, 0, M.metrics[0]);
            items.push({ bench: b.name, dir: b.dirs[dk], bb: bbn, r, c, seed: seeds.bb[j], metric: M.metrics[0] });
          });
        });
      });
      const vals = items.filter((it) => !it.head).flatMap((it) => [it.r, it.c.v, it.seed.mean - it.seed.std, it.seed.mean + it.seed.std]);
      const lo = Math.floor((Math.min(...vals) - 1) / 5) * 5, hi = Math.ceil((Math.max(...vals) + 0.5) / 5) * 5;
      const W = 460, L = 62, R = 50, rowH = 21, headH = 27;
      let H = 24;
      items.forEach((it) => (H += it.head ? headH : rowH));
      H += 6;
      const x = (v) => L + (v - lo) / (hi - lo) * (W - L - R);
      const svg = svgRoot(W, H, `RIDA and the strongest competitor, ${group.map((k) => BENCH[k].name).join(" and ")}`);
      const step = hi - lo > 30 ? 10 : 5;
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
        el("line", { x1: x(v), x2: x(v), y1: 18, y2: H - 4, class: "grid-line" }, svg);
        el("text", { x: x(v), y: 11, "text-anchor": "middle", style: "font-size:10.5px;fill:var(--muted)", text: v }, svg);
      }
      el("text", { x: W, y: 11, "text-anchor": "end", style: "font-size:10.5px;fill:var(--muted)", text: "Δ" }, svg);
      let yy = 22;
      items.forEach((it) => {
        if (it.head) {
          const ht = el("text", { x: 0, y: yy + 19, style: "font-family:var(--f-serif);font-size:14.5px;fill:var(--ink)", text: it.head + "  " }, svg);
          el("tspan", { style: "font-family:var(--f-sans);font-size:10.5px;fill:var(--muted)", text: it.metric }, ht);
          yy += headH;
          return;
        }
        const cy = yy + rowH / 2;
        const g = el("g", {}, svg);
        const bg = el("rect", { x: 0, y: yy, width: W, height: rowH, style: "fill:transparent" }, g);
        g.addEventListener("pointerenter", () => (bg.style.fill = "var(--paper-2)"));
        g.addEventListener("pointerleave", () => (bg.style.fill = "transparent"));
        el("text", { x: 10, y: cy + 4, style: "font-size:11px;fill:var(--ink-2)", text: it.bb }, g);
        el("line", { x1: x(it.c.v), x2: x(it.r), y1: cy, y2: cy, style: "stroke:var(--gray-1);stroke-width:1.5" }, g);
        el("rect", { x: x(it.seed.mean - it.seed.std), y: cy - 4, width: Math.max(2, x(it.seed.mean + it.seed.std) - x(it.seed.mean - it.seed.std)), height: 8, rx: 4, style: "fill:var(--accent);opacity:.28" }, g);
        el("circle", { cx: x(it.c.v), cy, r: 4.5, style: "fill:var(--gray-2);stroke:var(--surface);stroke-width:2" }, g);
        el("circle", { cx: x(it.r), cy, r: 5, style: "fill:var(--accent);stroke:var(--surface);stroke-width:2" }, g);
        el("text", { x: W, y: cy + 4, "text-anchor": "end", style: "font-size:11px;font-weight:500;fill:var(--ink);font-variant-numeric:tabular-nums", text: sgn(it.r - it.c.v) }, g);
        hover(g, `<b>${it.bench} ${it.dir} · ${it.bb}</b><br>RIDA <span class="tv">${fmt(it.r)}</span> · ${MNAME[it.c.k]} <span class="tv">${fmt(it.c.v)}</span><br>Δ <span class="tv">${sgn(it.r - it.c.v)}</span> ${it.metric}<br>RIDA over 3 seeds <span class="tv">${fmt(it.seed.mean)} ± ${fmt(it.seed.std)}</span>`);
        yy += rowH;
      });
      host.appendChild(svg);
    });
  }
  drawDumbbell();

  /* ================= benchmark explorer ================= */
  const ex = { bench: "mmwhs", dir: "ct2mr", bb: "dinov3", mi: 0, view: "chart" };
  function syncExplorerButtons() {
    const b = BENCH[ex.bench], M = D.main[ex.bench];
    if (!M.dirs.includes(ex.dir)) ex.dir = M.dirs[0];
    setButtons($("#ex-dir"), M.dirs.map((d) => [d, b.dirs[d]]), ex.dir);
    setButtons($("#ex-met"), M.metrics.map((m, i) => [String(i), m + (lowerBetter(m) ? " ↓" : " ↑")]), String(ex.mi));
  }
  function explorerRows() {
    const order = ["srconly", ...COMP, "rida", "oracle"];
    return order.filter((k) => D.main[ex.bench].rows[k]);
  }
  function drawExplorer() {
    const M = D.main[ex.bench], metric = M.metrics[ex.mi], lb = lowerBetter(metric);
    const rows = M.rows;
    const v = (k) => rows[k][ex.bb][ex.dir][ex.mi];
    const best = strongest(rows, ex.bb, ex.dir, ex.mi, metric);
    const listed = [...COMP, "rida"];
    const vals = listed.map(v);
    const refs = ["oracle", "srconly"].filter((k) => rows[k]).map(v);
    const all = vals.concat(refs);
    let lo, hi;
    if (lb) { lo = 0; hi = Math.ceil(Math.max(...all) + 0.5); }
    else { lo = Math.max(0, Math.floor((Math.min(...all) - 3) / 5) * 5); hi = Math.min(100, Math.ceil((Math.max(...all) + 1) / 5) * 5); }
    const W = 900, L = 150, R = 70, rowH = 24, famH = 26;
    const famOrder = ["natural", "medical", "bio"];
    let H = 30 + famOrder.length * famH + COMP.length * rowH + 14 + rowH + 12;
    const x = (val) => L + (val - lo) / (hi - lo) * (W - L - R);
    const svg = svgRoot(W, H, "Scores of all methods on the selected setting");
    const step = (hi - lo) > 40 ? 10 : (hi - lo) > 16 ? 5 : (hi - lo) > 6 ? 2 : 1;
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) {
      el("line", { x1: x(t), x2: x(t), y1: 22, y2: H - 8, class: "grid-line" }, svg);
      el("text", { x: x(t), y: 14, "text-anchor": "middle", style: "font-size:11px;fill:var(--muted)", text: t }, svg);
    }
    const refLine = (k, color, label, dash) => {
      if (!rows[k]) return;
      const xv = x(v(k));
      el("line", { x1: xv, x2: xv, y1: 22, y2: H - 8, style: `stroke:${color};stroke-width:1.2${dash ? ";stroke-dasharray:4 3" : ""}` }, svg);
      const tg = el("text", { x: xv + 4, y: H - 10, style: `font-size:10.5px;font-weight:600;fill:var(--ink-2)`, text: `${label} ${fmt(v(k))}` }, svg);
      if (xv > W - R - 110) { tg.setAttribute("x", xv - 4); tg.setAttribute("text-anchor", "end"); }
    };
    let yy = 26;
    const drawRow = (k) => {
      const cy = yy + rowH / 2, val = v(k);
      const isR = k === "rida", isB = best && k === best.k;
      const g = el("g", {}, svg);
      el("rect", { x: 0, y: yy, width: W, height: rowH, style: `fill:${isR ? "var(--accent-soft)" : "transparent"}` }, g);
      el("text", { x: 10, y: cy + 4, style: `font-size:12px;font-weight:${isR || isB ? 600 : 400};fill:${isR ? "var(--accent)" : "var(--ink)"}`, text: MNAME[k] }, g);
      el("line", { x1: L, x2: W - R, y1: cy, y2: cy, style: "stroke:var(--line);stroke-width:1" }, g);
      const base = lb ? x(0) : x(lo);
      el("line", { x1: base, x2: x(val), y1: cy, y2: cy, style: `stroke:${isR ? "var(--accent)" : isB ? "var(--gray-2)" : "var(--gray-1)"};stroke-width:2;opacity:.55` }, g);
      el("circle", { cx: x(val), cy, r: isR ? 6.5 : 5, style: `fill:${isR ? "var(--accent)" : isB ? "var(--gray-2)" : "var(--gray-1)"};stroke:var(--surface);stroke-width:2` }, g);
      el("text", { x: W - 10, y: cy + 4, "text-anchor": "end", style: `font-size:12px;font-weight:${isR || isB ? 600 : 400};fill:var(--ink);font-variant-numeric:tabular-nums`, text: fmt(val) }, g);
      const d = isR && best ? ` · ${sgn(lb ? best.v - val : val - best.v)} vs ${MNAME[best.k]}` : "";
      hover(g, `<b>${MNAME[k]}</b><br>${metric} <span class="tv">${fmt(val)}</span>${d}`);
      yy += rowH;
    };
    famOrder.forEach((f) => {
      el("text", { x: 0, y: yy + 18, style: "font-family:var(--f-serif);font-style:italic;font-size:13px;fill:var(--muted)", text: FAMLABEL[f] }, svg);
      yy += famH;
      METHODS.filter((m) => m.family === f).forEach((m) => drawRow(m.key));
    });
    yy += 8;
    el("line", { x1: 0, x2: W, y1: yy - 4, y2: yy - 4, style: "stroke:var(--ink-2);stroke-width:1" }, svg);
    drawRow("rida");
    refLine("oracle", "var(--ink-2)", "Oracle");
    refLine("srconly", "var(--muted)", "Source-only", true);
    const host = $("#explorer");
    host.innerHTML = "";
    host.appendChild(svg);
    $("#ex-leg-src").hidden = !rows.srconly;
    $("#ex-sub").textContent = `${BENCH[ex.bench].name} ${BENCH[ex.bench].dirs[ex.dir]} · ${BBN[ex.bb]} · ${metric}${lb ? " (voxels, lower is better)" : " (%, higher is better)"}${ex.bench === "abdomen" ? " · Source-only row not shown for Abdomen" : ""}`;
    drawExplorerTable();
  }
  function marks(values, lb) {
    const uniq = [...new Set(values.filter((v) => v != null))].sort((a, b) => (lb ? a - b : b - a));
    return { b1: uniq[0], b2: uniq[1] };
  }
  function drawExplorerTable() {
    const M = D.main[ex.bench], B = BENCH[ex.bench], rows = M.rows;
    const keys = explorerRows();
    const cols = [];
    BB.forEach(([bb, bbn]) => M.dirs.forEach((d) => M.metrics.forEach((m, mi) => cols.push({ bb, bbn, d, m, mi }))));
    const mk = cols.map((c) => marks(keys.filter((k) => k !== "oracle").map((k) => rows[k][c.bb][c.d][c.mi]), lowerBetter(c.m)));
    let h = '<div class="tbl-wrap"><table class="data"><thead><tr class="grp"><th></th>';
    BB.forEach(([, bbn], i) => (h += `<th colspan="4" class="${i ? "sep" : ""}">${bbn}</th>`));
    h += '</tr><tr class="grp"><th></th>';
    BB.forEach((_, i) => M.dirs.forEach((d, j) => (h += `<th colspan="2" class="${i && !j ? "sep" : ""}">${B.dirs[d]}</th>`)));
    h += "</tr><tr><th>Method</th>";
    cols.forEach((c, i) => (h += `<th class="${i && i % 4 === 0 ? "sep" : ""}">${c.m}${lowerBetter(c.m) ? " ↓" : " ↑"}</th>`));
    h += "</tr></thead><tbody>";
    let lastFam = null;
    keys.forEach((k) => {
      const fam = METHODS.find((m) => m.key === k).family;
      if (FAMLABEL[fam] && fam !== lastFam) h += `<tr><td class="fam" colspan="${cols.length + 1}">${FAMLABEL[fam]}</td></tr>`;
      lastFam = fam;
      h += `<tr class="${k === "rida" ? "ours" : k === "oracle" ? "oracle" : ""}"><td>${MNAME[k]}</td>`;
      cols.forEach((c, i) => {
        const val = rows[k][c.bb][c.d][c.mi];
        const cls = [i && i % 4 === 0 ? "sep" : ""];
        if (k !== "oracle" && val === mk[i].b1) cls.push("b1");
        else if (k !== "oracle" && val === mk[i].b2) cls.push("b2");
        h += `<td class="${cls.join(" ")}">${fmt(val)}</td>`;
      });
      h += "</tr>";
    });
    h += "</tbody></table></div>";
    h += `<p class="tbl-foot">Bold: best; underline: second best; oracle excluded.${ex.bench === "abdomen" ? " The Abdomen Source-only row is not shown." : ""}</p>`;
    $("#explorer-table").innerHTML = h;
  }
  function setView() {
    $("#explorer").hidden = ex.view !== "chart";
    $("#ex-legend").hidden = ex.view !== "chart";
    $("#explorer-table").hidden = ex.view !== "table";
  }
  seg($("#ex-bench"), (v) => { ex.bench = v; syncExplorerButtons(); drawExplorer(); });
  seg($("#ex-dir"), (v) => { ex.dir = v; drawExplorer(); });
  seg($("#ex-bb"), (v) => { ex.bb = v; drawExplorer(); });
  seg($("#ex-met"), (v) => { ex.mi = +v; drawExplorer(); });
  seg($("#ex-view"), (v) => { ex.view = v; setView(); });
  syncExplorerButtons();
  drawExplorer();
  setView();

  /* ================= per-class table ================= */
  function classTable(head1, head2, keys, getRow, colMeta, sepEvery) {
    const data = keys.map((k) => getRow(k));
    const ncol = colMeta.length;
    const stats = colMeta.map((c, i) => {
      const vs = keys.map((k, r) => (k === "oracle" ? null : data[r][i])).filter((v) => v != null);
      return marks(vs, c.lb);
    });
    let h = `<div class="tbl-wrap"><table class="data"><thead>${head1}${head2}</thead><tbody>`;
    let lastFam = null;
    keys.forEach((k, r) => {
      const fam = METHODS.find((m) => m.key === k).family;
      if (FAMLABEL[fam] && fam !== lastFam) h += `<tr><td class="fam" colspan="${ncol + 1}">${FAMLABEL[fam]}</td></tr>`;
      lastFam = fam;
      h += `<tr class="${k === "rida" ? "ours" : k === "oracle" ? "oracle" : ""}"><td>${MNAME[k]}</td>`;
      data[r].forEach((v, i) => {
        const s = stats[i];
        const cls = [i && i % sepEvery === 0 ? "sep" : ""];
        if (k !== "oracle" && v === s.b1) cls.push("b1");
        else if (k !== "oracle" && v === s.b2) cls.push("b2");
        h += `<td class="${cls.join(" ")}">${fmt(v)}</td>`;
      });
      h += "</tr>";
    });
    return h + "</tbody></table></div>";
  }
  const pc = { task: "mmwhs_ct2mr", bb: "unet" };
  function drawPerClass() {
    const host = $("#perclass");
    let html;
    if (D.perclass[pc.task]) {
      const P = D.perclass[pc.task], rows = P.rows[pc.bb];
      const keys = ["srconly", ...COMP, "rida", "oracle"].filter((k) => rows[k]);
      const cls = [...P.classes, "Avg"];
      const head1 = `<tr class="grp"><th></th><th colspan="5">Dice (%) ↑</th><th colspan="5" class="sep">ASSD (voxel) ↓</th></tr>`;
      const head2 = `<tr><th>Method</th>${cls.map((c) => `<th>${c}</th>`).join("")}${cls.map((c, i) => `<th class="${i ? "" : "sep"}">${c}</th>`).join("")}</tr>`;
      const meta = cls.map(() => ({ lb: false })).concat(cls.map(() => ({ lb: true })));
      html = classTable(head1, head2, keys, (k) => rows[k].dice.concat(rows[k].assd), meta, 5);
      if (pc.task.startsWith("abdomen")) html += '<p class="tbl-foot">The Abdomen Source-only row is not shown.</p>';
    } else {
      const E = D.emall[pc.task], rows = E.rows[pc.bb], B = BENCH[pc.task];
      const keys = ["srconly", ...COMP, "rida", "oracle"].filter((k) => rows[k]);
      const head1 = `<tr class="grp"><th></th>${E.dirs.map((d, i) => `<th colspan="4" class="${i ? "sep" : ""}">${B.dirs[d]}</th>`).join("")}</tr>`;
      const head2 = `<tr><th>Method</th>${E.dirs.map((d, i) => E.metrics.map((m, j) => `<th class="${i && !j ? "sep" : ""}">${m}</th>`).join("")).join("")}</tr>`;
      const meta = E.dirs.flatMap(() => E.metrics.map(() => ({ lb: false })));
      html = classTable(head1, head2, keys, (k) => E.dirs.flatMap((d) => rows[k][d]), meta, 4);
    }
    host.innerHTML = html;
  }
  seg($("#pc-task"), (v) => { pc.task = v; drawPerClass(); });
  seg($("#pc-bb"), (v) => { pc.bb = v; drawPerClass(); });
  drawPerClass();

  /* ================= GTA5 -> Cityscapes ================= */
  (function drawGTA() {
    const G = D.gta;
    const W = 900, L = 120, R = 20, rowH = 22, T = 26;
    const H = T + G.rows.length * rowH + 10;
    const lo = 40, hi = 100;
    const x = (v) => L + (v - lo) / (hi - lo) * (W - L - R);
    const svg = svgRoot(W, H, "Per-class IoU on GTA5 to Cityscapes");
    for (let t = lo; t <= hi; t += 10) {
      el("line", { x1: x(t), x2: x(t), y1: T - 6, y2: H - 6, class: "grid-line" }, svg);
      el("text", { x: x(t), y: 14, "text-anchor": "middle", style: "font-size:11px;fill:var(--muted)", text: t }, svg);
    }
    G.rows.forEach((r, i) => {
      const [src, daf, mic, rida, orc] = r.vals;
      const cy = T + i * rowH + rowH / 2;
      const best = rida >= Math.max(daf, mic);
      const g = el("g", {}, svg);
      const bg = el("rect", { x: 0, y: cy - rowH / 2, width: W, height: rowH, style: "fill:transparent" }, g);
      g.addEventListener("pointerenter", () => (bg.style.fill = "var(--paper-2)"));
      g.addEventListener("pointerleave", () => (bg.style.fill = "transparent"));
      el("text", { x: 8, y: cy + 4, style: `font-size:12px;font-weight:${best ? 600 : 400};fill:var(--ink)`, text: r.cls }, g);
      el("line", { x1: L, x2: W - R, y1: cy, y2: cy, style: "stroke:var(--line);stroke-width:1" }, g);
      const vs = [daf, mic, rida];
      el("line", { x1: x(Math.min(...vs)), x2: x(Math.max(...vs)), y1: cy, y2: cy, style: "stroke:var(--gray-1);stroke-width:1.5" }, g);
      el("line", { x1: x(orc), x2: x(orc), y1: cy - 7, y2: cy + 7, style: "stroke:var(--ink-2);stroke-width:2" }, g);
      el("circle", { cx: x(daf), cy, r: 4.5, style: "fill:var(--gray-1);stroke:var(--surface);stroke-width:2" }, g);
      el("circle", { cx: x(mic), cy, r: 4.5, style: "fill:var(--gray-2);stroke:var(--surface);stroke-width:2" }, g);
      el("circle", { cx: x(rida), cy, r: 5.5, style: "fill:var(--accent);stroke:var(--surface);stroke-width:2" }, g);
      hover(g, `<b>${r.cls}</b><br>RIDA <span class="tv">${fmt(rida)}</span> · MIC <span class="tv">${fmt(mic)}</span> · DAFormer <span class="tv">${fmt(daf)}</span><br>Source-only <span class="tv">${fmt(src)}</span> · Oracle <span class="tv">${fmt(orc)}</span>`);
    });
    $("#gta").appendChild(svg);
  })();

  /* ================= qualitative ================= */
  const QUAL = {
    med: [
      ["abd_unet_ct2mr", "Abdomen CT→MR", "U-Net"], ["abd_dino_mr2ct", "Abdomen MR→CT", "DINOv3"],
      ["mmwhs_sam_ct2mr", "MM-WHS CT→MR", "MedSAM"], ["mmwhs_unet_mr2ct", "MM-WHS MR→CT", "U-Net"],
    ],
    em: [
      ["vnc_unet_s1", "VNC III→Lucchi Subset 1", "U-Net"], ["vnc_dino_s2", "VNC III→Lucchi Subset 2", "DINOv3"],
      ["mitoem_sam_h2r", "MitoEM H→R", "MedSAM"], ["mitoem_unet_r2h", "MitoEM R→H", "U-Net"],
    ],
  };
  const QLEG = {
    med: [["#e9967a", "AA / Liver"], ["#e8c478", "LAC / Spleen"], ["#9c9ce4", "LVC / L. kidney"], ["#79bdb2", "MYO / R. kidney"], ["#c41e3a", "Over-segmentation or wrong class"], ["#2ea043", "Missed"]],
    em: [["#79bdb2", "Mitochondria"], ["#c41e3a", "False positive"], ["#2ea043", "False negative"]],
  };
  function drawQual(kind) {
    $("#qual-legend").innerHTML = QLEG[kind].map(([c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join("");
    const head = '<div class="trip sh"><span>Target image</span><span>RIDA</span><span>Ground truth</span></div>';
    let h = head + head;
    QUAL[kind].forEach(([id, task, bb]) => {
      h += `<div class="ex"><div class="trip">
        <img src="static/img/qual_${id}_image.webp" alt="${task} target image" loading="lazy" width="472" height="472">
        <img src="static/img/qual_${id}_rida.webp" alt="RIDA prediction with errors marked, ${task}, ${bb}" loading="lazy" width="472" height="472">
        <img src="static/img/qual_${id}_gt.webp" alt="Ground truth, ${task}" loading="lazy" width="472" height="472">
        </div><p class="rl">${task}<span>${bb}</span></p></div>`;
    });
    $("#qual").innerHTML = h;
  }
  seg($("#qual-tab"), drawQual);
  drawQual("med");

  /* ================= cost ================= */
  (function drawCost() {
    const C = D.cost;
    const max = [0, 1, 2, 3, 4, 5].map((i) => Math.max(...C.map((r) => r.vals[i])));
    let h = '<div class="tbl-wrap"><table class="data"><thead><tr class="grp"><th></th><th colspan="2">U-Net</th><th colspan="2" class="sep">DINOv3</th><th colspan="2" class="sep">MedSAM</th></tr>';
    h += "<tr><th>Method</th>" + ["s / iter", "GB", "s / iter", "GB", "s / iter", "GB"].map((t, i) => `<th class="${i && i % 2 === 0 ? "sep" : ""}">${t}</th>`).join("") + "</tr></thead><tbody>";
    C.forEach((r) => {
      const ours = r.method === "RIDA";
      h += `<tr class="${ours ? "ours" : ""}"><td>${r.method === "Threshold (Eq. 2)" ? "Confidence threshold" : r.method}</td>`;
      r.vals.forEach((v, i) => {
        const pct = (v / max[i]) * 100;
        h += `<td class="${i && i % 2 === 0 ? "sep" : ""}"><div style="display:flex;align-items:center;gap:8px;justify-content:flex-end"><span style="display:block;height:4px;width:${(pct * 0.42).toFixed(1)}px;background:${ours ? "var(--accent)" : "var(--gray-1)"}"></span>${v.toFixed(2)}</div></td>`;
      });
      h += "</tr>";
    });
    h += "</tbody></table></div>";
    $("#cost").innerHTML = h;
  })();
})();
