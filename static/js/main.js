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
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  function corr(a, b) {
    const ma = mean(a), mb = mean(b);
    let s = 0, sa = 0, sb = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      s += x * y; sa += x * x; sb += y * y;
    }
    return s / Math.sqrt(sa * sb);
  }
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
      cb(b.dataset.v ?? b.dataset.px ?? b.dataset.lab ?? b.dataset.rm);
    });
  }
  const pressed = (box) => {
    const b = $('button[aria-pressed="true"]', box);
    return b ? b.dataset.v ?? b.dataset.px ?? b.dataset.lab ?? b.dataset.rm : null;
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

  /* ================= hero demo ================= */
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
      el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), style: "stroke:var(--line);stroke-width:1" }, svg);
      el("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", style: "fill:var(--muted);font-size:11px", text: v.toFixed(2) }, svg);
    });
    const slot = (W - L - R) / 5, bw = 26;
    const rk = ranks(cur);
    cur.forEach((v, i) => {
      const cx = L + slot * (i + 0.5);
      el("rect", { x: cx - bw / 2, y: y(px.sims[i]), width: bw, height: Math.max(0, y(0) - y(px.sims[i])), rx: 3, style: "fill:var(--surface-2);stroke:var(--line-2);stroke-width:1" }, svg);
      el("rect", { x: cx - bw / 2 + 4, y: y(v), width: bw - 8, height: Math.max(0, y(0) - y(v)), rx: 3, style: `fill:${DEMO_ANCH[i].c}` }, svg);
      el("text", { x: cx, y: y(Math.max(v, px.sims[i])) - 6, "text-anchor": "middle", style: "fill:var(--ink);font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums", text: v.toFixed(2) }, svg);
      el("text", { x: cx, y: y(0) + 17, "text-anchor": "middle", style: "fill:var(--ink-2);font-size:12px;font-weight:600", text: DEMO_ANCH[i].n }, svg);
      const badge = el("g", {}, svg);
      el("rect", { x: cx - 15, y: y(0) + 25, width: 30, height: 18, rx: 9, style: "fill:var(--accent-soft)" }, badge);
      el("text", { x: cx, y: y(0) + 38, "text-anchor": "middle", style: "fill:var(--accent);font-size:11px;font-weight:700", text: "#" + (6 - rk[i]) }, badge);
    });
    el("line", { x1: L, x2: W - R, y1: y(0.7), y2: y(0.7), style: "stroke:var(--amber);stroke-width:1.5" }, svg);
    el("text", { x: W - R + 4, y: y(0.7) + 4, style: "fill:var(--amber);font-size:11px;font-weight:700", text: "t=0.7" }, svg);
    el("line", { x1: L, x2: W - R, y1: y(0), y2: y(0), style: "stroke:var(--line-2);stroke-width:1" }, svg);
    el("text", { x: W - R + 4, y: y(0) + 37, style: "fill:var(--muted);font-size:10px", text: "rank" }, svg);

    const top = Math.max(...cur), own = DEMO_ANCH[px.sims.indexOf(Math.max(...px.sims))].n;
    const gate = $("#demo-gate");
    const pass = top >= 0.7;
    gate.className = "chipline " + (pass ? "" : "bad");
    $("span", gate).textContent = pass
      ? `${own} similarity ${top.toFixed(2)} ≥ 0.7: pseudo-label kept`
      : `${own} similarity ${top.toFixed(2)} < 0.7: pseudo-label dropped`;
    const order = cur.map((v, i) => [v, DEMO_ANCH[i].n]).sort((a, b) => b[0] - a[0]).map((x) => x[1]).join(" › ");
    $("#demo-rank span").textContent = `${order} · same as on the source`;
  }
  seg($("#demo .seg"), (v) => { demoPx = v; drawDemo(); });
  $("#shift").addEventListener("input", drawDemo);
  drawDemo();

  /* ================= rank lab: consistency & stability ================= */
  const LAB_ANCH = ["var(--a1)", "var(--a2)", "var(--a3)", "var(--a4)", "var(--a5)", "var(--a6)"];
  const LAB_PX = {
    stable: { w: [0.84, 0.66, 0.52, 0.41, 0.27, 0.12], n: [-0.06, 0.07, -0.05, 0.06, -0.04, 0.05], conf: 0.81 },
    fragile: { w: [0.71, 0.66, 0.60, 0.38, 0.33, 0.30], n: [-0.30, 0.22, 0.25, -0.20, 0.18, 0.10], conf: 0.97 },
  };
  let labPx = "stable";
  function quantile(arr, q) {
    const s = [...arr].sort((a, b) => a - b);
    const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  function drawLab() {
    const svg = $("#lab-svg");
    svg.innerHTML = "";
    const q = +$("#lab-q").value, aug = +$("#lab-aug").value;
    $("#lab-q-out").textContent = q.toFixed(2);
    $("#lab-aug-out").textContent = aug.toFixed(2);
    const P = LAB_PX[labPx], K = 6;
    const rw = P.w, rs = P.w.map((v, i) => Math.min(1, Math.max(0, v + aug * P.n[i])));
    const pairs = [];
    for (let k = 0; k < K; k++) for (let l = k + 1; l < K; l++) pairs.push([k, l]);
    const gw = pairs.map(([k, l]) => rw[k] - rw[l]), gs = pairs.map(([k, l]) => rs[k] - rs[l]);
    const delta = Math.max(1e-6, quantile(gw.map(Math.abs), q));
    let nT = 0, nK = 0, bce = 0;
    const status = pairs.map((_, i) => {
      if (Math.abs(gw[i]) <= delta) return "u";
      nT++;
      const target = gw[i] > 0 ? 1 : 0;
      const p = 1 / (1 + Math.exp(-gs[i] / delta));
      bce += -(target * Math.log(Math.max(p, 1e-9)) + (1 - target) * Math.log(Math.max(1 - p, 1e-9)));
      if (gw[i] * gs[i] > 0) { nK++; return "k"; }
      return "f";
    });
    const s = nT ? nK / nT : 0;
    const enough = nT >= 0.1 * pairs.length;
    const w = s >= 0.8 && enough ? s : 0;

    // bars: weak vs strong
    const L = 34, T = 22, H = 200, Wb = 252;
    const y = (v) => T + (1 - v) * H;
    [0, 0.5, 1].forEach((v) => {
      el("line", { x1: L, x2: L + Wb, y1: y(v), y2: y(v), style: "stroke:var(--line);stroke-width:1" }, svg);
      el("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end", style: "fill:var(--muted);font-size:10.5px", text: v.toFixed(1) }, svg);
    });
    const slot = Wb / K;
    for (let i = 0; i < K; i++) {
      const x0 = L + slot * i + 6;
      el("rect", { x: x0, y: y(rw[i]), width: 14, height: y(0) - y(rw[i]), rx: 2.5, style: `fill:${LAB_ANCH[i]};opacity:.45` }, svg);
      el("rect", { x: x0 + 16, y: y(rs[i]), width: 14, height: y(0) - y(rs[i]), rx: 2.5, style: `fill:${LAB_ANCH[i]}` }, svg);
      el("text", { x: x0 + 15, y: y(0) + 16, "text-anchor": "middle", style: "fill:var(--ink-2);font-size:11px;font-weight:600", text: "a" + (i + 1) }, svg);
      el("text", { x: x0 + 7, y: y(0) + 30, "text-anchor": "middle", style: "fill:var(--muted);font-size:9.5px", text: "w" }, svg);
      el("text", { x: x0 + 23, y: y(0) + 30, "text-anchor": "middle", style: "fill:var(--muted);font-size:9.5px", text: "s" }, svg);
    }
    el("line", { x1: L, x2: L + Wb, y1: y(0), y2: y(0), style: "stroke:var(--line-2);stroke-width:1" }, svg);
    el("text", { x: L, y: 12, style: "fill:var(--ink-2);font-size:11px;font-weight:600", text: "Similarity: weak (w) and strong (s) view" }, svg);

    // pair matrix (upper triangle)
    const cx0 = 330, cy0 = 40, c = 29;
    el("text", { x: cx0, y: 12, style: "fill:var(--ink-2);font-size:11px;font-weight:600", text: "Anchor pairs (k, l)" }, svg);
    for (let i = 0; i < K; i++) {
      el("rect", { x: cx0 + c * i + 8, y: cy0 - 18, width: c - 16, height: 8, rx: 2, style: `fill:${LAB_ANCH[i]}` }, svg);
      el("rect", { x: cx0 - 18, y: cy0 + c * i + 8, width: 8, height: c - 16, rx: 2, style: `fill:${LAB_ANCH[i]}` }, svg);
    }
    pairs.forEach(([k, l], i) => {
      const st = status[i];
      const fill = st === "k" ? "var(--accent)" : st === "f" ? "var(--flip)" : "var(--surface-2)";
      const r = el("rect", { x: cx0 + c * l + 1.5, y: cy0 + c * k + 1.5, width: c - 3, height: c - 3, rx: 4, style: `fill:${fill};${st === "u" ? "stroke:var(--line-2);stroke-width:1" : ""}` }, svg);
      hover(r, () => `<b>a${k + 1} vs a${l + 1}</b><br>weak gap <span class="tv">${sgn(gw[i], 3)}</span>, strong gap <span class="tv">${sgn(gs[i], 3)}</span><br>${st === "u" ? "not trusted: |gap| ≤ δ" : st === "k" ? "trusted, order kept" : "trusted, order flipped"}`);
    });
    for (let i = 0; i < K; i++) {
      el("rect", { x: cx0 + c * i + 1.5, y: cy0 + c * i + 1.5, width: c - 3, height: c - 3, rx: 4, style: "fill:none;stroke:var(--line);stroke-width:1" }, svg);
    }

    $("#ro-delta").textContent = delta.toFixed(3);
    $("#ro-trust").textContent = `${nT} / 15`;
    $("#ro-lrc").textContent = nT ? (bce / nT).toFixed(3) : "–";
    $("#ro-s").textContent = nT ? s.toFixed(2) : "–";
    $("#ro-w").textContent = w ? w.toFixed(2) : "0 (excluded)";
    $("#ro-s-box").className = "ro " + (nT && s >= 0.8 ? "ok" : "no");
    $("#ro-w-box").className = "ro " + (w ? "ok" : "no");
    $("#ro-conf").textContent = P.conf.toFixed(2) + (P.conf >= 0.9 ? " ≥ η" : " < η");
  }
  seg($('[aria-label="Pixel type"]'), (v) => { labPx = v; drawLab(); });
  $("#lab-q").addEventListener("input", drawLab);
  $("#lab-aug").addEventListener("input", drawLab);
  drawLab();

  /* ================= rank lab: rank matching ================= */
  const RM_ANCH = [
    { c: "#9c9ce4", cls: "LVC" }, { c: "#9c9ce4", cls: "LVC" }, { c: "#79bdb2", cls: "MYO" },
    { c: "#79bdb2", cls: "MYO" }, { c: "#b3bdbf", cls: "BG" }, { c: "#b3bdbf", cls: "BG" },
  ];
  const SIG = {
    LVC: [5.6, 5.2, 3.4, 2.9, 2.0, 1.9],
    MYO: [3.1, 3.6, 5.5, 5.1, 2.2, 1.5],
    BG: [1.8, 2.1, 2.5, 2.9, 5.4, 6.3],
  };
  const RM_PX = {
    interior: [0.31, 0.42, 0.86, 0.79, 0.22, 0.12],
    boundary: [0.70, 0.52, 0.74, 0.48, 0.20, 0.15],
    bg: [0.18, 0.25, 0.30, 0.22, 0.81, 0.88],
  };
  let rmPx = "interior";
  function drawRM() {
    const svg = $("#rm-svg");
    svg.innerHTML = "";
    const g = +$("#rm-gamma").value;
    $("#rm-gamma-out").textContent = "γ = " + g.toFixed(2);
    const sims = RM_PX[rmPx].map((v) => Math.pow(v, g));
    const pi = ranks(sims);
    const L = 34, T = 22, H = 112, Wb = 250;
    const y = (v) => T + (1 - v) * H;
    el("text", { x: L, y: 12, style: "fill:var(--ink-2);font-size:11px;font-weight:600", text: "Similarity to source anchors, and rank" }, svg);
    [0, 1].forEach((v) => {
      el("line", { x1: L, x2: L + Wb, y1: y(v), y2: y(v), style: "stroke:var(--line);stroke-width:1" }, svg);
      el("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end", style: "fill:var(--muted);font-size:10.5px", text: v.toFixed(1) }, svg);
    });
    const slot = Wb / 6;
    sims.forEach((v, i) => {
      const x = L + slot * i + slot / 2;
      el("rect", { x: x - 11, y: y(v), width: 22, height: y(0) - y(v), rx: 3, style: `fill:${RM_ANCH[i].c}` }, svg);
      el("text", { x, y: y(0) + 15, "text-anchor": "middle", style: "fill:var(--ink-2);font-size:10.5px;font-weight:600", text: RM_ANCH[i].cls }, svg);
      el("rect", { x: x - 13, y: y(0) + 21, width: 26, height: 17, rx: 8.5, style: "fill:var(--accent-soft)" }, svg);
      el("text", { x, y: y(0) + 33.5, "text-anchor": "middle", style: "fill:var(--accent);font-size:10.5px;font-weight:700", text: String(pi[i]) }, svg);
    });
    // signatures as rank strips
    const sx = 312;
    el("text", { x: sx, y: 12, style: "fill:var(--ink-2);font-size:11px;font-weight:600", text: "Class signatures μ (mean source rank)" }, svg);
    Object.entries(SIG).forEach(([cls, mu], r) => {
      const yy = 26 + r * 36;
      el("text", { x: sx, y: yy + 15, style: "fill:var(--ink-2);font-size:11px;font-weight:600", text: cls }, svg);
      mu.forEach((v, i) => {
        const a = 0.12 + 0.88 * (v - 1) / 5;
        el("rect", { x: sx + 38 + i * 26, y: yy, width: 23, height: 22, rx: 3, style: `fill:var(--accent);opacity:${a.toFixed(2)}` }, svg);
        el("text", { x: sx + 38 + i * 26 + 11.5, y: yy + 15, "text-anchor": "middle", style: `fill:${a > 0.55 ? "var(--on-accent)" : "var(--ink)"};font-size:9.5px;font-weight:600`, text: v.toFixed(1) }, svg);
      });
    });
    // correlations
    const rho = Object.fromEntries(Object.entries(SIG).map(([k, mu]) => [k, corr(pi, mu)]));
    const sorted = Object.entries(rho).sort((a, b) => b[1] - a[1]);
    const label = sorted[0][0], m = sorted[0][1] - sorted[1][1];
    const by = 210, zx = 300, sc = 150;
    el("text", { x: L, y: by - 10, style: "fill:var(--ink-2);font-size:11px;font-weight:600", text: "Rank correlation ρ with each signature" }, svg);
    el("line", { x1: zx, x2: zx, y1: by - 4, y2: by + 3 * 30 - 6, style: "stroke:var(--line-2);stroke-width:1" }, svg);
    ["-1", "0", "+1"].forEach((t, i) => el("text", { x: zx + (i - 1) * sc, y: by + 3 * 30 + 6, "text-anchor": "middle", style: "fill:var(--muted);font-size:10px", text: t }, svg));
    Object.entries(rho).forEach(([cls, v], r) => {
      const yy = by + r * 30;
      const win = cls === label;
      el("text", { x: zx - sc - 8, y: yy + 14, "text-anchor": "end", style: "fill:var(--ink-2);font-size:11px;font-weight:600", text: cls }, svg);
      el("rect", { x: zx - sc, y: yy + 3, width: 2 * sc, height: 16, rx: 3, style: "fill:var(--surface-2)" }, svg);
      const x0 = v >= 0 ? zx : zx + v * sc;
      el("rect", { x: x0, y: yy + 3, width: Math.abs(v) * sc, height: 16, rx: 3, style: `fill:${win ? "var(--accent)" : "var(--gray-1)"}` }, svg);
      el("text", { x: zx + sc + 8, y: yy + 15, style: `fill:${win ? "var(--accent)" : "var(--ink-2)"};font-size:11.5px;font-weight:700;font-variant-numeric:tabular-nums`, text: (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(3) }, svg);
    });
    $("#rm-label").textContent = label;
    $("#rm-margin").textContent = m.toFixed(3);
    $("#rm-weight").textContent = (m / 2).toFixed(3);
  }
  seg($('[aria-label="Target pixel"]'), (v) => { rmPx = v; drawRM(); });
  $("#rm-gamma").addEventListener("input", drawRM);
  drawRM();

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
    const items = [];
    let ti = 0;
    Object.entries(BENCH).forEach(([bk, b]) => {
      const M = D.main[bk];
      M.dirs.forEach((dk) => {
        const seeds = D.seeds[ti++];
        items.push({ head: `${b.name} ${b.dirs[dk]}`, metric: M.metrics[0] });
        BB.forEach(([bb, bbn], j) => {
          const r = M.rows.rida[bb][dk][0];
          const c = strongest(M.rows, bb, dk, 0, M.metrics[0]);
          items.push({ bench: b.name, dir: b.dirs[dk], bb: bbn, r, c, seed: seeds.bb[j], metric: M.metrics[0] });
        });
      });
    });
    const W = 900, L = 200, R = 80, rowH = 22, headH = 30;
    let H = 26;
    items.forEach((it) => (H += it.head ? headH : rowH));
    H += 8;
    const lo = 55, hi = 95;
    const x = (v) => L + (v - lo) / (hi - lo) * (W - L - R);
    const svg = svgRoot(W, H, "Dumbbell chart of RIDA and the strongest competitor in 24 settings");
    for (let v = lo; v <= hi; v += 5) {
      el("line", { x1: x(v), x2: x(v), y1: 18, y2: H - 6, class: "grid-line" }, svg);
      el("text", { x: x(v), y: 12, "text-anchor": "middle", style: "font-size:11px;fill:var(--muted)", text: v }, svg);
    }
    el("text", { x: W - R + 16, y: 12, style: "font-size:11px;fill:var(--muted)", text: "Δ" }, svg);
    let yy = 26;
    items.forEach((it) => {
      if (it.head) {
        const ht = el("text", { x: 0, y: yy + 20, style: "font-size:12.5px;font-weight:700;fill:var(--ink)", text: it.head + "  " }, svg);
        el("tspan", { style: "font-size:10.5px;font-weight:500;fill:var(--muted)", text: it.metric }, ht);
        yy += headH;
        return;
      }
      const cy = yy + rowH / 2;
      const g = el("g", {}, svg);
      el("rect", { x: 0, y: yy, width: W, height: rowH, style: "fill:transparent" }, g);
      el("text", { x: 14, y: cy + 4, style: "font-size:11.5px;fill:var(--ink-2)", text: it.bb }, g);
      el("line", { x1: x(it.c.v), x2: x(it.r), y1: cy, y2: cy, style: "stroke:var(--gray-1);stroke-width:2" }, g);
      el("rect", { x: x(it.seed.mean - it.seed.std), y: cy - 4, width: Math.max(2, x(it.seed.mean + it.seed.std) - x(it.seed.mean - it.seed.std)), height: 8, rx: 4, style: "fill:var(--accent);opacity:.28" }, g);
      el("circle", { cx: x(it.c.v), cy, r: 5, style: "fill:var(--gray-2);stroke:var(--surface);stroke-width:2" }, g);
      el("circle", { cx: x(it.r), cy, r: 5.5, style: "fill:var(--accent);stroke:var(--surface);stroke-width:2" }, g);
      el("text", { x: W - R + 16, y: cy + 4, style: "font-size:11.5px;font-weight:700;fill:var(--ink);font-variant-numeric:tabular-nums", text: sgn(it.r - it.c.v) }, g);
      hover(g, `<b>${it.bench} ${it.dir} · ${it.bb}</b><br>RIDA <span class="tv">${fmt(it.r)}</span> · ${MNAME[it.c.k]} <span class="tv">${fmt(it.c.v)}</span><br>Δ <span class="tv">${sgn(it.r - it.c.v)}</span> ${it.metric}<br>RIDA over 3 seeds <span class="tv">${fmt(it.seed.mean)} ± ${fmt(it.seed.std)}</span>`);
      yy += rowH;
    });
    host.innerHTML = "";
    host.appendChild(svg);
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
    const refLine = (k, color, label) => {
      if (!rows[k]) return;
      const xv = x(v(k));
      el("line", { x1: xv, x2: xv, y1: 22, y2: H - 8, style: `stroke:${color};stroke-width:1.5` }, svg);
      const tg = el("text", { x: xv + 4, y: H - 10, style: `font-size:10.5px;font-weight:600;fill:var(--ink-2)`, text: `${label} ${fmt(v(k))}` }, svg);
      if (xv > W - R - 110) { tg.setAttribute("x", xv - 4); tg.setAttribute("text-anchor", "end"); }
    };
    let yy = 26;
    const drawRow = (k) => {
      const cy = yy + rowH / 2, val = v(k);
      const isR = k === "rida", isB = best && k === best.k;
      const g = el("g", {}, svg);
      el("rect", { x: 0, y: yy, width: W, height: rowH, style: `fill:${isR ? "var(--accent-soft)" : "transparent"}` }, g);
      el("text", { x: 12, y: cy + 4, style: `font-size:12px;font-weight:${isR || isB ? 700 : 500};fill:${isR ? "var(--accent)" : "var(--ink)"}`, text: MNAME[k] }, g);
      el("line", { x1: L, x2: W - R, y1: cy, y2: cy, style: "stroke:var(--line);stroke-width:1" }, g);
      const base = lb ? x(0) : x(lo);
      el("line", { x1: base, x2: x(val), y1: cy, y2: cy, style: `stroke:${isR ? "var(--accent)" : isB ? "var(--gray-2)" : "var(--gray-1)"};stroke-width:2;opacity:.55` }, g);
      el("circle", { cx: x(val), cy, r: isR ? 6.5 : 5, style: `fill:${isR ? "var(--accent)" : isB ? "var(--gray-2)" : "var(--gray-1)"};stroke:var(--surface);stroke-width:2` }, g);
      el("text", { x: W - 10, y: cy + 4, "text-anchor": "end", style: `font-size:12px;font-weight:${isR || isB ? 700 : 500};fill:var(--ink);font-variant-numeric:tabular-nums`, text: fmt(val) }, g);
      const d = isR && best ? ` · ${sgn(lb ? best.v - val : val - best.v)} vs ${MNAME[best.k]}` : "";
      hover(g, `<b>${MNAME[k]}</b><br>${metric} <span class="tv">${fmt(val)}</span>${d}`);
      yy += rowH;
    };
    famOrder.forEach((f) => {
      el("text", { x: 12, y: yy + 17, style: "font-size:10px;letter-spacing:.08em;font-weight:600;fill:var(--muted)", text: FAMLABEL[f].toUpperCase() }, svg);
      yy += famH;
      METHODS.filter((m) => m.family === f).forEach((m) => drawRow(m.key));
    });
    yy += 8;
    el("line", { x1: 0, x2: W, y1: yy - 4, y2: yy - 4, style: "stroke:var(--line-2);stroke-width:1" }, svg);
    drawRow("rida");
    refLine("oracle", "var(--ink-2)", "Oracle");
    refLine("srconly", "var(--amber)", "Source-only");
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

  /* ================= per-class heat table ================= */
  const heat = (t) => `background:color-mix(in srgb, var(--accent) ${(4 + 30 * t).toFixed(0)}%, transparent)`;
  function heatTable(head1, head2, keys, getRow, colMeta, sepEvery) {
    const data = keys.map((k) => getRow(k));
    const ncol = colMeta.length;
    const stats = colMeta.map((c, i) => {
      const vs = keys.map((k, r) => (k === "oracle" ? null : data[r][i])).filter((v) => v != null);
      return { min: Math.min(...vs), max: Math.max(...vs), ...marks(vs, c.lb) };
    });
    let h = `<div class="tbl-wrap"><table class="data"><thead>${head1}${head2}</thead><tbody>`;
    let lastFam = null;
    keys.forEach((k, r) => {
      const fam = METHODS.find((m) => m.key === k).family;
      if (FAMLABEL[fam] && fam !== lastFam) h += `<tr><td class="fam" colspan="${ncol + 1}">${FAMLABEL[fam]}</td></tr>`;
      lastFam = fam;
      h += `<tr class="${k === "rida" ? "ours" : k === "oracle" ? "oracle" : ""}"><td>${MNAME[k]}</td>`;
      data[r].forEach((v, i) => {
        const s = stats[i], c = colMeta[i];
        const cls = [i && i % sepEvery === 0 ? "sep" : ""];
        let style = "";
        if (k !== "oracle" && k !== "rida") {
          let t = s.max > s.min ? (v - s.min) / (s.max - s.min) : 0.5;
          if (c.lb) t = 1 - t;
          style = heat(t);
        }
        if (k !== "oracle" && v === s.b1) cls.push("b1");
        else if (k !== "oracle" && v === s.b2) cls.push("b2");
        h += `<td class="${cls.join(" ")}" style="${style}">${fmt(v)}</td>`;
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
      html = heatTable(head1, head2, keys, (k) => rows[k].dice.concat(rows[k].assd), meta, 5);
      if (pc.task.startsWith("abdomen")) html += '<p class="tbl-foot">The Abdomen Source-only row is not shown.</p>';
    } else {
      const E = D.emall[pc.task], rows = E.rows[pc.bb], B = BENCH[pc.task];
      const keys = ["srconly", ...COMP, "rida", "oracle"].filter((k) => rows[k]);
      const head1 = `<tr class="grp"><th></th>${E.dirs.map((d, i) => `<th colspan="4" class="${i ? "sep" : ""}">${B.dirs[d]}</th>`).join("")}</tr>`;
      const head2 = `<tr><th>Method</th>${E.dirs.map((d, i) => E.metrics.map((m, j) => `<th class="${i && !j ? "sep" : ""}">${m}</th>`).join("")).join("")}</tr>`;
      const meta = E.dirs.flatMap(() => E.metrics.map(() => ({ lb: false })));
      html = heatTable(head1, head2, keys, (k) => E.dirs.flatMap((d) => rows[k][d]), meta, 4);
    }
    host.innerHTML = html;
  }
  seg($("#pc-task"), (v) => { pc.task = v; drawPerClass(); });
  seg($("#pc-bb"), (v) => { pc.bb = v; drawPerClass(); });
  drawPerClass();

  /* ================= ablation ================= */
  (function drawAblation() {
    const A = D.ablation;
    const rows = A.rows;
    const n = rows[0].vals.length;
    const stats = Array.from({ length: n }, (_, i) => {
      const vs = rows.map((r) => r.vals[i]);
      return { min: Math.min(...vs), max: Math.max(...vs), ...marks(vs, false) };
    });
    let h = '<div class="tbl-wrap"><table class="data"><thead>';
    h += '<tr class="grp"><th></th><th colspan="3"></th><th colspan="3" class="sep">MitoEM R→H · F1</th><th colspan="3" class="sep">MM-WHS MR→CT · Dice</th></tr>';
    h += '<tr><th>Variant</th><th style="text-align:center">L<sub>rc</sub></th><th style="text-align:center">L<sub>rs</sub></th><th style="text-align:center">L<sub>rm</sub></th>';
    ["U-Net", "DINOv3", "MedSAM", "U-Net", "DINOv3", "MedSAM"].forEach((b, i) => (h += `<th class="${i % 3 === 0 ? "sep" : ""}">${b}</th>`));
    h += "</tr></thead><tbody>";
    rows.forEach((r) => {
      const full = r.rc && r.rs && r.rm;
      const nOn = [r.rc, r.rs, r.rm].filter(Boolean).length;
      const name = r.pl ? "Confidence-threshold self-training" : nOn === 0 ? "Source-only" : full ? "RIDA (full)" : nOn === 1 ? "One loss" : "Two losses";
      h += `<tr class="${full ? "ours" : ""}"><td>${name}</td>`;
      if (r.pl) h += '<td colspan="3" style="text-align:center;color:var(--muted)">Eq. (2), η threshold</td>';
      else [r.rc, r.rs, r.rm].forEach((f) => (h += `<td style="text-align:center">${f ? '<span class="chk">✓</span>' : '<span class="dash">·</span>'}</td>`));
      r.vals.forEach((v, i) => {
        const s = stats[i];
        const t = s.max > s.min ? (v - s.min) / (s.max - s.min) : 0.5;
        const cls = [i % 3 === 0 ? "sep" : ""];
        if (v === s.b1) cls.push("b1"); else if (v === s.b2) cls.push("b2");
        h += `<td class="${cls.join(" ")}" style="${full ? "" : heat(t)}">${fmt(v)}</td>`;
      });
      h += "</tr>";
    });
    h += "</tbody></table></div>";
    $("#ablation").innerHTML = h;
  })();

  /* ================= GTA5 -> Cityscapes ================= */
  (function drawGTA() {
    const G = D.gta;
    const W = 900, L = 120, R = 20, rowH = 24, T = 26;
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
      el("rect", { x: 0, y: cy - rowH / 2, width: W, height: rowH, style: "fill:transparent" }, g);
      el("text", { x: 8, y: cy + 4, style: `font-size:12px;font-weight:${best ? 700 : 500};fill:var(--ink)`, text: r.cls }, g);
      el("line", { x1: L, x2: W - R, y1: cy, y2: cy, style: "stroke:var(--line);stroke-width:1" }, g);
      const vs = [daf, mic, rida];
      el("line", { x1: x(Math.min(...vs)), x2: x(Math.max(...vs)), y1: cy, y2: cy, style: "stroke:var(--gray-1);stroke-width:2" }, g);
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
    $("#qual").innerHTML = QUAL[kind].map(([id, task, bb]) => `
      <div class="qual">
        <p class="qual-title">${task} <span>${bb}</span></p>
        <div class="qual-row">
          <img src="static/img/qual_${id}_image.webp" alt="${task} target image" loading="lazy" width="472" height="472">
          <img src="static/img/qual_${id}_rida.webp" alt="RIDA prediction with errors marked, ${task}, ${bb}" loading="lazy" width="472" height="472">
          <img src="static/img/qual_${id}_gt.webp" alt="Ground truth, ${task}" loading="lazy" width="472" height="472">
        </div>
        <div class="qual-cap"><span>Image</span><span>RIDA</span><span>Ground truth</span></div>
      </div>`).join("");
  }
  seg($("#qual-tab"), drawQual);
  drawQual("med");

  /* ================= sensitivity ================= */
  (function drawSens() {
    const host = $("#sens");
    const panels = [];
    const bbs = [["U-Net", "var(--bb-unet)"], ["DINOv3", "var(--bb-dino)"], ["MedSAM", "var(--bb-sam)"]];
    D.sens_select.params.forEach(([name, values, main], pi) => {
      const mainIdx = values.indexOf(main);
      const lines = bbs.map(([b]) => {
        const vs = D.sens_select.rows[b].slice(pi * 4, pi * 4 + 4);
        return { vals: vs, mainIdx: [mainIdx] };
      });
      panels.push({ name, values, lines });
    });
    ["rc", "rm", "rs"].forEach((p) => {
      const rows = D.sens_loss.filter((r) => r.param === p);
      const lines = bbs.map((_, j) => ({ vals: rows.map((r) => r.vals[j]), mainIdx: rows.map((r, i) => (r.shaded[j] ? i : -1)).filter((i) => i >= 0) }));
      panels.push({ name: "lambda_" + p, values: rows.map((r) => r.value), lines });
    });
    const label = {
      K: "Anchors K", q: "Quantile q", s0: "Stability s₀", zeta: "Fraction ζ",
      lambda_rc: "Weight λ_rc", lambda_rm: "Weight λ_rm", lambda_rs: "Weight λ_rs",
    };
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px 18px";
    const lo = -3.5, hi = 0.5;
    panels.forEach((p) => {
      const W = 240, Hh = 170, L = 34, R = 10, T = 26, B = 26;
      const n = p.values.length;
      const x = (i) => L + (n === 1 ? 0.5 : i / (n - 1)) * (W - L - R);
      const y = (v) => T + (hi - v) / (hi - lo) * (Hh - T - B);
      const svg = svgRoot(W, Hh, `Sensitivity to ${label[p.name]}`);
      el("text", { x: 0, y: 14, style: "font-size:12.5px;font-weight:700;fill:var(--ink)", text: label[p.name] }, svg);
      [0, -1, -2, -3].forEach((t) => {
        el("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), style: `stroke:${t === 0 ? "var(--line-2)" : "var(--line)"};stroke-width:1` }, svg);
        el("text", { x: L - 6, y: y(t) + 4, "text-anchor": "end", style: "font-size:10px;fill:var(--muted)", text: t === 0 ? "0" : "−" + Math.abs(t) }, svg);
      });
      p.values.forEach((v, i) => el("text", { x: x(i), y: Hh - 8, "text-anchor": "middle", style: "font-size:10.5px;fill:var(--ink-2)", text: v }, svg));
      p.lines.forEach((ln, j) => {
        const base = ln.vals[ln.mainIdx[0]];
        const d = ln.vals.map((v) => v - base);
        const pts = d.map((v, i) => `${x(i)},${y(v)}`).join(" ");
        el("polyline", { points: pts, style: `fill:none;stroke:${bbs[j][1]};stroke-width:2;stroke-linejoin:round;stroke-linecap:round` }, svg);
        d.forEach((v, i) => {
          const isMain = ln.mainIdx.includes(i);
          const c = el("circle", { cx: x(i), cy: y(v), r: isMain ? 5 : 3.5, style: `fill:${isMain ? "var(--surface)" : bbs[j][1]};stroke:${isMain ? bbs[j][1] : "var(--surface)"};stroke-width:2` }, svg);
          hover(c, `<b>${bbs[j][0]} · ${label[p.name]} = ${p.values[i]}</b><br>Dice <span class="tv">${fmt(ln.vals[i])}</span> (${sgn(v)} vs main)${isMain ? "<br>main setting" : ""}`);
        });
      });
      const wrap = document.createElement("div");
      wrap.appendChild(svg);
      grid.appendChild(wrap);
    });
    host.appendChild(grid);
  })();

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
        h += `<td class="${i && i % 2 === 0 ? "sep" : ""}"><div style="display:flex;align-items:center;gap:8px;justify-content:flex-end"><span style="display:block;height:6px;border-radius:3px;width:${(pct * 0.42).toFixed(1)}px;background:${ours ? "var(--accent)" : "var(--gray-1)"}"></span>${v.toFixed(2)}</div></td>`;
      });
      h += "</tr>";
    });
    h += "</tbody></table></div><p class=\"tbl-foot\">Training time per iteration (s) and peak GPU memory (GB) on MM-WHS MR→CT.</p>";
    $("#cost").innerHTML = h;
  })();
})();
