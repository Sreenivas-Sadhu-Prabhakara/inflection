/* ============================================================
   inflection — client-side macroeconomics sensei.
   No network. No dependencies. State in localStorage.
   Corpus is hand-authored; the daily pick is date-seeded.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- tiny helpers ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmt(n, dp) {
    if (dp == null) dp = 2;
    return Number(n).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function fmt0(n) { return Math.round(n).toLocaleString("en-IN"); }
  function pct(n, dp) { return fmt(n, dp == null ? 1 : dp) + "%"; }

  var STORE = "inflection:v1";

  /* ---------- storage ---------- */
  var state = { learned: {}, streak: 0, lastVisit: null, lastIndex: 0 };
  var storageOk = true;
  function loadState() {
    try {
      var raw = localStorage.getItem(STORE);
      if (raw) { var p = JSON.parse(raw); if (p && typeof p === "object") state = Object.assign(state, p); }
      if (!state.learned) state.learned = {};
    } catch (e) { storageOk = false; }
  }
  function saveState() {
    if (!storageOk) return;
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { storageOk = false; }
  }

  /* ---------- date-seed (local calendar day) ---------- */
  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  // deterministic hash of a string -> 32-bit uint
  function seedHash(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ============================================================
     CHART PRIMITIVE — a tiny hand-rolled SVG line plotter.
     No libraries. Draws axes/gridlines + one or more series.
     ============================================================ */
  function Chart(opts) {
    // opts: { xLabel, yLabel, xFmt, yFmt }
    var NS = "http://www.w3.org/2000/svg";
    var W = 640, H = 320, padL = 54, padR = 16, padT = 16, padB = 34;
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("class", "model__chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("preserveAspectRatio", "none");

    function make(tag, attrs) {
      var e = document.createElementNS(NS, tag);
      for (var k in attrs) e.setAttribute(k, attrs[k]);
      return e;
    }
    var plotW = W - padL - padR, plotH = H - padT - padB;

    this.el = svg;
    var self = this;
    // draw(series[], domain) where series = {points:[[x,y]...], color, dashed, dot}
    this.draw = function (series, dom, labelText) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      var x0 = dom.x0, x1 = dom.x1, y0 = dom.y0, y1 = dom.y1;
      if (x1 === x0) x1 = x0 + 1;
      if (y1 === y0) y1 = y0 + 1;
      function sx(x) { return padL + (x - x0) / (x1 - x0) * plotW; }
      function sy(y) { return padT + plotH - (y - y0) / (y1 - y0) * plotH; }

      // gridlines
      var g = make("g", {});
      var i, gx, gy, xt, yt;
      var xticks = 5, yticks = 4;
      for (i = 0; i <= yticks; i++) {
        yt = y0 + (y1 - y0) * i / yticks;
        gy = sy(yt);
        g.appendChild(make("line", { x1: padL, y1: gy, x2: W - padR, y2: gy, stroke: "var(--grid)", "stroke-width": 1 }));
        var lbl = make("text", { x: padL - 8, y: gy + 4, "text-anchor": "end", fill: "var(--mute)", "font-size": 12, "font-family": "var(--mono)" });
        lbl.textContent = opts.yFmt ? opts.yFmt(yt) : Math.round(yt);
        g.appendChild(lbl);
      }
      for (i = 0; i <= xticks; i++) {
        xt = x0 + (x1 - x0) * i / xticks;
        gx = sx(xt);
        g.appendChild(make("line", { x1: gx, y1: padT, x2: gx, y2: padT + plotH, stroke: "var(--grid)", "stroke-width": 1 }));
        var xl = make("text", { x: gx, y: H - 12, "text-anchor": "middle", fill: "var(--mute)", "font-size": 12, "font-family": "var(--mono)" });
        xl.textContent = opts.xFmt ? opts.xFmt(xt) : Math.round(xt);
        g.appendChild(xl);
      }
      // axis labels
      if (opts.xLabel) {
        var axl = make("text", { x: padL + plotW / 2, y: H - 1, "text-anchor": "middle", fill: "var(--mute)", "font-size": 11 });
        axl.textContent = opts.xLabel; g.appendChild(axl);
      }
      if (opts.yLabel) {
        var ayl = make("text", { x: 12, y: padT + plotH / 2, "text-anchor": "middle", fill: "var(--mute)", "font-size": 11, transform: "rotate(-90 12 " + (padT + plotH / 2) + ")" });
        ayl.textContent = opts.yLabel; g.appendChild(ayl);
      }
      svg.appendChild(g);

      // series
      series.forEach(function (s) {
        if (!s.points || !s.points.length) return;
        var d = "";
        s.points.forEach(function (p, idx) {
          var X = sx(p[0]), Y = sy(p[1]);
          d += (idx === 0 ? "M" : "L") + X.toFixed(1) + " " + Y.toFixed(1) + " ";
        });
        var attrs = { d: d, fill: "none", stroke: s.color, "stroke-width": s.width || 2.4, "stroke-linejoin": "round", "stroke-linecap": "round" };
        if (s.dashed) attrs["stroke-dasharray"] = "6 5";
        svg.appendChild(make("path", attrs));
        if (s.dot) {
          var last = s.points[s.points.length - 1];
          svg.appendChild(make("circle", { cx: sx(last[0]), cy: sy(last[1]), r: 4.5, fill: s.color }));
        }
        if (s.marker) {
          s.points.forEach(function (p) {
            svg.appendChild(make("circle", { cx: sx(p[0]), cy: sy(p[1]), r: 3.5, fill: s.color }));
          });
        }
      });
      if (labelText) svg.setAttribute("aria-label", labelText);
      else svg.setAttribute("aria-label", "Line chart");
      self.sx = sx; self.sy = sy; self._svg = svg; self._make = make;
    };
    // helper to add a vertical reference line after draw
    this.vline = function (x, color, label) {
      if (!self.sx) return;
      var X = self.sx(x);
      svg.appendChild(make("line", { x1: X, y1: padT, x2: X, y2: padT + plotH, stroke: color, "stroke-width": 1.5, "stroke-dasharray": "4 4" }));
    };
    this.point = function (x, y, color) {
      if (!self.sx) return;
      svg.appendChild(make("circle", { cx: self.sx(x), cy: self.sy(y), r: 5, fill: color, stroke: "var(--ink)", "stroke-width": 1.5 }));
    };
  }

  /* ============================================================
     SLIDER + READOUT scaffolding for models
     ============================================================ */
  function slider(cfg) {
    // cfg: { id, label, min, max, step, value, fmt }
    var wrap = el("div", "ctrl");
    var top = el("div", "ctrl__top");
    var lab = el("label"); lab.setAttribute("for", cfg.id); lab.textContent = cfg.label;
    var val = el("span", "ctrl__val");
    top.appendChild(lab); top.appendChild(val);
    var input = el("input");
    input.type = "range"; input.id = cfg.id;
    input.min = cfg.min; input.max = cfg.max; input.step = cfg.step; input.value = cfg.value;
    input.setAttribute("aria-label", cfg.label);
    function show() { val.textContent = cfg.fmt ? cfg.fmt(parseFloat(input.value)) : input.value; }
    show();
    wrap.appendChild(top); wrap.appendChild(input);
    return { wrap: wrap, input: input, show: show, get: function () { return parseFloat(input.value); } };
  }

  function statBox(k, cls) {
    var s = el("div", "stat");
    s.appendChild(el("div", "stat__k", k));
    var v = el("div", "stat__v " + (cls || "stat__v--paper"));
    s.appendChild(v);
    var note = el("div", "stat__note");
    s.appendChild(note);
    return { el: s, v: v, note: note };
  }

  function legend(items) {
    var wrap = el("div", "legend");
    items.forEach(function (it) {
      var i = el("span", "legend__item");
      var sw = el("span", "legend__swatch " + it.cls);
      i.appendChild(sw); i.appendChild(document.createTextNode(it.text));
      wrap.appendChild(i);
    });
    return wrap;
  }

  /* ============================================================
     MODEL BUILDERS — each returns a DOM node with an interactive
     widget. All math is vanilla and matches the worked examples.
     Signature: build(host) appends controls + chart + readouts.
     ============================================================ */
  var MODELS = {};

  /* --- Purchasing-power eroder --- */
  MODELS.purchasingPower = function () {
    var chart = new Chart({ xLabel: "years", yLabel: "value of ₹100", xFmt: function (x) { return Math.round(x); }, yFmt: function (y) { return "₹" + Math.round(y); } });
    var sInfl = slider({ id: "pp-infl", label: "Inflation rate / year", min: 0, max: 15, step: 0.5, value: 6, fmt: function (v) { return pct(v); } });
    var sYr = slider({ id: "pp-yr", label: "Years", min: 1, max: 40, step: 1, value: 10, fmt: function (v) { return v + " yr"; } });
    var stValue = statBox("₹100 later is worth", "stat__v--rose");
    var stLoss = statBox("Purchasing power lost", "stat__v--rose");
    var stPrice = statBox("A ₹100 basket then costs", "stat__v--amber");

    function render() {
      var i = sInfl.get() / 100, n = Math.round(sYr.get());
      var pts = [], pricePts = [];
      for (var t = 0; t <= n; t++) {
        pts.push([t, 100 / Math.pow(1 + i, t)]);
        pricePts.push([t, 100 * Math.pow(1 + i, t)]);
      }
      var worth = 100 / Math.pow(1 + i, n);
      var price = 100 * Math.pow(1 + i, n);
      chart.draw([
        { points: pts, color: "var(--rose)", dot: true }
      ], { x0: 0, x1: n, y0: 0, y1: 100 }, "Real value of ₹100 eroding over " + n + " years at " + pct(sInfl.get()) + " inflation.");
      stValue.v.textContent = "₹" + fmt(worth); stValue.note.textContent = "in today's money";
      stLoss.v.textContent = fmt(100 - worth) + "%"; stLoss.note.textContent = "gone to inflation";
      stPrice.v.textContent = "₹" + fmt(price); stPrice.note.textContent = "nominal price then";
      sInfl.show(); sYr.show();
    }
    return assemble(chart, [sInfl, sYr], [stValue, stLoss, stPrice],
      legend([{ cls: "legend__swatch--rose", text: "real value of ₹100 (decays)" }]), render);
  };

  /* --- Compound growth / real return --- */
  MODELS.realReturn = function () {
    var chart = new Chart({ xLabel: "years", yLabel: "balance (₹)", xFmt: function (x) { return Math.round(x); }, yFmt: function (y) { return "₹" + fmt0(y / 1000) + "k"; } });
    var sP = slider({ id: "rr-p", label: "Principal", min: 10000, max: 1000000, step: 10000, value: 100000, fmt: function (v) { return "₹" + fmt0(v); } });
    var sNom = slider({ id: "rr-nom", label: "Nominal return / yr", min: 0, max: 20, step: 0.5, value: 12, fmt: function (v) { return pct(v); } });
    var sInf = slider({ id: "rr-inf", label: "Inflation / yr", min: 0, max: 15, step: 0.5, value: 6, fmt: function (v) { return pct(v); } });
    var sYr = slider({ id: "rr-yr", label: "Years", min: 1, max: 40, step: 1, value: 20, fmt: function (v) { return v + " yr"; } });
    var stNom = statBox("Nominal balance", "stat__v--amber");
    var stReal = statBox("Real (today's ₹) balance", "stat__v--teal");
    var stRate = statBox("Real return / yr", "stat__v--teal");

    function render() {
      var P = sP.get(), rn = sNom.get() / 100, ri = sInf.get() / 100, n = Math.round(sYr.get());
      var real = (1 + rn) / (1 + ri) - 1;
      var nomPts = [], realPts = [], maxY = P;
      for (var t = 0; t <= n; t++) {
        var nv = P * Math.pow(1 + rn, t);
        var rv = nv / Math.pow(1 + ri, t);
        nomPts.push([t, nv]); realPts.push([t, rv]);
        if (nv > maxY) maxY = nv;
      }
      chart.draw([
        { points: nomPts, color: "var(--amber)", dot: true },
        { points: realPts, color: "var(--teal)", dashed: true, dot: true }
      ], { x0: 0, x1: n, y0: 0, y1: maxY }, "Nominal vs inflation-adjusted balance over " + n + " years.");
      var endNom = P * Math.pow(1 + rn, n);
      stNom.v.textContent = "₹" + fmt0(endNom); stNom.note.textContent = "sticker value";
      stReal.v.textContent = "₹" + fmt0(endNom / Math.pow(1 + ri, n)); stReal.note.textContent = "purchasing power";
      stRate.v.textContent = pct(real * 100, 2); stRate.note.textContent = "(1+nom)/(1+infl)−1";
      sP.show(); sNom.show(); sInf.show(); sYr.show();
    }
    return assemble(chart, [sP, sNom, sInf, sYr], [stNom, stReal, stRate],
      legend([{ cls: "legend__swatch--amber", text: "nominal" }, { cls: "legend__swatch--teal", text: "real (inflation-adjusted)" }]), render);
  };

  /* --- Rule of 70 --- */
  MODELS.ruleOf70 = function () {
    var chart = new Chart({ xLabel: "growth rate %", yLabel: "years to double", xFmt: function (x) { return Math.round(x); }, yFmt: function (y) { return Math.round(y); } });
    var sR = slider({ id: "r70-r", label: "Growth rate / year", min: 0.5, max: 15, step: 0.5, value: 7, fmt: function (v) { return pct(v); } });
    var stExact = statBox("Exact doubling time", "stat__v--teal");
    var st70 = statBox("Rule of 70 estimate", "stat__v--amber");
    var st72 = statBox("Rule of 72 estimate", "stat__v--amber");

    function render() {
      var r = sR.get() / 100;
      var exact = Math.log(2) / Math.log(1 + r);
      var pts = [], ptsExact = [];
      for (var x = 0.5; x <= 15.01; x += 0.25) {
        pts.push([x, 70 / x]);
        ptsExact.push([x, Math.log(2) / Math.log(1 + x / 100)]);
      }
      chart.draw([
        { points: ptsExact, color: "var(--teal)" },
        { points: pts, color: "var(--amber)", dashed: true }
      ], { x0: 0.5, x1: 15, y0: 0, y1: 80 }, "Doubling time vs growth rate: exact curve and the 70/r rule.");
      chart.point(sR.get(), exact, "var(--teal)");
      stExact.v.textContent = fmt(exact) + " yr"; stExact.note.textContent = "ln(2)/ln(1+r)";
      st70.v.textContent = fmt(70 / sR.get()) + " yr"; st70.note.textContent = "70 ÷ " + fmt(sR.get(), 1);
      st72.v.textContent = fmt(72 / sR.get()) + " yr"; st72.note.textContent = "72 ÷ " + fmt(sR.get(), 1);
      sR.show();
    }
    return assemble(chart, [sR], [stExact, st70, st72],
      legend([{ cls: "legend__swatch--teal", text: "exact ln(2)/ln(1+r)" }, { cls: "legend__swatch--amber", text: "rule of 70 (70/r)" }]), render);
  };

  /* --- Loan amortization (EMI) --- */
  MODELS.amortize = function () {
    var chart = new Chart({ xLabel: "year", yLabel: "balance (₹)", xFmt: function (x) { return Math.round(x); }, yFmt: function (y) { return "₹" + fmt0(y / 100000) + "L"; } });
    var sP = slider({ id: "am-p", label: "Loan amount", min: 100000, max: 5000000, step: 100000, value: 1000000, fmt: function (v) { return "₹" + fmt0(v); } });
    var sR = slider({ id: "am-r", label: "Annual interest rate", min: 4, max: 18, step: 0.25, value: 9, fmt: function (v) { return pct(v, 2); } });
    var sN = slider({ id: "am-n", label: "Tenure (years)", min: 1, max: 30, step: 1, value: 20, fmt: function (v) { return v + " yr"; } });
    var stEmi = statBox("Monthly payment (EMI)", "stat__v--amber");
    var stTot = statBox("Total paid", "stat__v--paper");
    var stInt = statBox("Total interest", "stat__v--rose");

    function render() {
      var P = sP.get(), r = sR.get() / 100 / 12, N = Math.round(sN.get()) * 12;
      var emi = r === 0 ? P / N : P * r / (1 - Math.pow(1 + r, -N));
      // balance curve (yearly)
      var pts = [[0, P]], bal = P;
      for (var m = 1; m <= N; m++) {
        bal = bal * (1 + r) - emi;
        if (bal < 0) bal = 0;
        if (m % 12 === 0) pts.push([m / 12, bal]);
      }
      chart.draw([{ points: pts, color: "var(--amber)", dot: true }],
        { x0: 0, x1: Math.round(sN.get()), y0: 0, y1: P }, "Outstanding loan balance falling over the tenure.");
      var total = emi * N;
      stEmi.v.textContent = "₹" + fmt0(emi); stEmi.note.textContent = "P·r / (1−(1+r)⁻ⁿ)";
      stTot.v.textContent = "₹" + fmt0(total); stTot.note.textContent = N + " payments";
      stInt.v.textContent = "₹" + fmt0(total - P); stInt.note.textContent = fmt((total - P) / P * 100, 0) + "% of principal";
      sP.show(); sR.show(); sN.show();
    }
    return assemble(chart, [sP, sR, sN], [stEmi, stTot, stInt],
      legend([{ cls: "legend__swatch--amber", text: "balance owed" }]), render);
  };

  /* --- Bond price vs yield --- */
  MODELS.bondPrice = function () {
    var chart = new Chart({ xLabel: "market yield %", yLabel: "price (₹)", xFmt: function (x) { return Math.round(x); }, yFmt: function (y) { return "₹" + fmt0(y); } });
    var sC = slider({ id: "bp-c", label: "Coupon rate", min: 0, max: 12, step: 0.5, value: 5, fmt: function (v) { return pct(v); } });
    var sY = slider({ id: "bp-y", label: "Market yield", min: 1, max: 12, step: 0.25, value: 7, fmt: function (v) { return pct(v, 2); } });
    var sN = slider({ id: "bp-n", label: "Years to maturity", min: 1, max: 30, step: 1, value: 5, fmt: function (v) { return v + " yr"; } });
    var stPrice = statBox("Bond price (face ₹1,000)", "stat__v--amber");
    var stVs = statBox("Trades at", "stat__v--teal");
    var stCap = statBox("Cap. gain/loss vs par", "stat__v--rose");

    function price(F, c, y, n) {
      var C = F * c, p = 0;
      for (var t = 1; t <= n; t++) p += C / Math.pow(1 + y, t);
      return p + F / Math.pow(1 + y, n);
    }
    function render() {
      var c = sC.get() / 100, y = sY.get() / 100, n = Math.round(sN.get()), F = 1000;
      var pts = [];
      for (var yy = 1; yy <= 12.01; yy += 0.25) pts.push([yy, price(F, c, yy / 100, n)]);
      chart.draw([{ points: pts, color: "var(--amber)" }],
        { x0: 1, x1: 12, y0: Math.min.apply(null, pts.map(function (p) { return p[1]; })) * 0.98, y1: Math.max.apply(null, pts.map(function (p) { return p[1]; })) * 1.02 },
        "Bond price falls as market yield rises — an inverse curve.");
      var pr = price(F, c, y, n);
      chart.point(sY.get(), pr, "var(--teal)");
      stPrice.v.textContent = "₹" + fmt0(pr); stPrice.note.textContent = "sum of discounted cash flows";
      var rel = pr > F + 0.5 ? "a premium" : (pr < F - 0.5 ? "a discount" : "par");
      stVs.v.textContent = rel; stVs.note.textContent = "yield " + (y > c ? ">" : y < c ? "<" : "=") + " coupon";
      stCap.v.textContent = (pr >= F ? "+" : "−") + "₹" + fmt0(Math.abs(pr - F)); stCap.note.textContent = "vs ₹1,000 face";
      sC.show(); sY.show(); sN.show();
    }
    return assemble(chart, [sC, sY, sN], [stPrice, stVs, stCap],
      legend([{ cls: "legend__swatch--amber", text: "price vs yield" }, { cls: "legend__swatch--dot legend__swatch--teal", text: "your yield" }]), render);
  };

  /* --- Money multiplier --- */
  MODELS.moneyMultiplier = function () {
    var chart = new Chart({ xLabel: "reserve ratio %", yLabel: "money multiplier", xFmt: function (x) { return Math.round(x); }, yFmt: function (y) { return Math.round(y); } });
    var sRR = slider({ id: "mm-rr", label: "Reserve ratio", min: 2, max: 50, step: 1, value: 10, fmt: function (v) { return pct(v, 0); } });
    var sB = slider({ id: "mm-b", label: "Fresh reserves injected", min: 100, max: 100000, step: 100, value: 1000, fmt: function (v) { return "₹" + fmt0(v); } });
    var stMult = statBox("Money multiplier", "stat__v--amber");
    var stMax = statBox("Max deposits created", "stat__v--teal");
    var stNew = statBox("New money on top", "stat__v--teal");

    function render() {
      var rr = sRR.get() / 100, B = sB.get();
      var mult = 1 / rr;
      var pts = [];
      for (var x = 2; x <= 50.01; x += 1) pts.push([x, 1 / (x / 100)]);
      chart.draw([{ points: pts, color: "var(--amber)" }],
        { x0: 2, x1: 50, y0: 0, y1: 50 }, "Money multiplier = 1 / reserve ratio, a steep hyperbola at low ratios.");
      chart.point(sRR.get(), mult, "var(--teal)");
      stMult.v.textContent = fmt(mult) + "×"; stMult.note.textContent = "1 ÷ " + fmt(rr, 2);
      stMax.v.textContent = "₹" + fmt0(B * mult); stMax.note.textContent = "from ₹" + fmt0(B) + " base";
      stNew.v.textContent = "₹" + fmt0(B * mult - B); stNew.note.textContent = "beyond the original";
      sRR.show(); sB.show();
    }
    return assemble(chart, [sRR, sB], [stMult, stMax, stNew],
      legend([{ cls: "legend__swatch--amber", text: "1 / reserve ratio" }]), render);
  };

  /* --- Supply & demand equilibrium --- */
  MODELS.supplyDemand = function () {
    var chart = new Chart({ xLabel: "quantity", yLabel: "price (₹)", xFmt: function (x) { return Math.round(x); }, yFmt: function (y) { return "₹" + Math.round(y); } });
    var sShift = slider({ id: "sd-d", label: "Demand shift (a tastes/income shock)", min: -40, max: 40, step: 2, value: 0, fmt: function (v) { return (v > 0 ? "+" : "") + v; } });
    var sSup = slider({ id: "sd-s", label: "Supply shift (a cost/harvest shock)", min: -40, max: 40, step: 2, value: 0, fmt: function (v) { return (v > 0 ? "+" : "") + v; } });
    var stP = statBox("Equilibrium price", "stat__v--amber");
    var stQ = statBox("Equilibrium quantity", "stat__v--teal");
    var stMove = statBox("vs baseline (₹24, 52)", "stat__v--paper");

    function render() {
      // Baseline: Qd = 100 - 2P ; Qs = -20 + 3P  -> P*=24, Q*=52
      var dShift = sShift.get(), sShiftV = sSup.get();
      // demand intercept moves by dShift ; supply intercept moves by sShiftV (positive = more supply)
      // Qd = (100+dShift) - 2P ; Qs = (-20 + sShiftV) + 3P
      // eq: (100+dShift) - 2P = (-20+sShiftV) + 3P -> 120 + dShift - sShiftV = 5P
      var Pe = (120 + dShift - sShiftV) / 5;
      var Qe = (100 + dShift) - 2 * Pe;
      // draw curves in P-Q space with Q on x, P on y
      var dPts = [], sPts = [];
      for (var P = 0; P <= 60; P += 2) {
        var qd = (100 + dShift) - 2 * P;
        var qs = (-20 + sShiftV) + 3 * P;
        if (qd >= 0 && qd <= 120) dPts.push([qd, P]);
        if (qs >= 0 && qs <= 120) sPts.push([qs, P]);
      }
      chart.draw([
        { points: dPts, color: "var(--teal)" },
        { points: sPts, color: "var(--amber)" }
      ], { x0: 0, x1: 120, y0: 0, y1: 60 }, "Supply and demand lines crossing at the market-clearing price and quantity.");
      if (Qe >= 0 && Pe >= 0) chart.point(Qe, Pe, "var(--rose)");
      stP.v.textContent = "₹" + fmt(Pe); stP.note.textContent = "where the lines cross";
      stQ.v.textContent = fmt(Qe, 0); stQ.note.textContent = "units traded";
      var dp = Pe - 24, dq = Qe - 52;
      stMove.v.textContent = (dp >= 0 ? "+" : "−") + "₹" + fmt(Math.abs(dp), 1) + " / " + (dq >= 0 ? "+" : "−") + fmt(Math.abs(dq), 0);
      stMove.note.textContent = "price / quantity move";
      sShift.show(); sSup.show();
    }
    return assemble(chart, [sShift, sSup], [stP, stQ, stMove],
      legend([{ cls: "legend__swatch--teal", text: "demand" }, { cls: "legend__swatch--amber", text: "supply" }, { cls: "legend__swatch--dot", text: "equilibrium" }]), render, "equilibrium");
  };

  /* --- Phillips curve tradeoff --- */
  MODELS.phillips = function () {
    var chart = new Chart({ xLabel: "unemployment %", yLabel: "inflation %", xFmt: function (x) { return Math.round(x); }, yFmt: function (y) { return Math.round(y); } });
    var sU = slider({ id: "ph-u", label: "Unemployment rate", min: 3, max: 12, step: 0.25, value: 6, fmt: function (v) { return pct(v, 2); } });
    var stInf = statBox("Implied inflation", "stat__v--amber");
    var stTrade = statBox("Move down 1pt unemployment", "stat__v--teal");
    var stNote = statBox("Along this curve", "stat__v--paper");

    // simple short-run Phillips: pi = 10 - 1.2*(u - 4)  (illustrative)
    function inflAt(u) { return 10 - 1.2 * (u - 4); }
    function render() {
      var u = sU.get();
      var pts = [];
      for (var uu = 3; uu <= 12.01; uu += 0.25) pts.push([uu, inflAt(uu)]);
      chart.draw([{ points: pts, color: "var(--amber)" }],
        { x0: 3, x1: 12, y0: -2, y1: 12 }, "The short-run Phillips curve: lower unemployment pairs with higher inflation.");
      chart.point(u, inflAt(u), "var(--teal)");
      stInf.v.textContent = pct(inflAt(u), 1); stInf.note.textContent = "at " + pct(u, 2) + " unemployment";
      stTrade.v.textContent = "+1.2 pt"; stTrade.note.textContent = "more inflation (this curve)";
      stNote.v.textContent = "trade-off"; stNote.note.textContent = "short-run only";
      sU.show();
    }
    return assemble(chart, [sU], [stInf, stTrade, stNote],
      legend([{ cls: "legend__swatch--amber", text: "short-run Phillips curve" }, { cls: "legend__swatch--dot legend__swatch--teal", text: "your point" }]), render);
  };

  /* --- Generic assembler: chart + controls + readouts + optional formula label --- */
  function assemble(chart, sliders, stats, legendEl, render, keyword) {
    var host = el("div", "model");
    host.appendChild(chart.el);
    var controls = el("div", "model__controls");
    sliders.forEach(function (s) {
      s.input.addEventListener("input", render);
      controls.appendChild(s.wrap);
    });
    host.appendChild(controls);
    var readout = el("div", "readout");
    stats.forEach(function (st) { readout.appendChild(st.el); });
    host.appendChild(readout);
    if (legendEl) host.appendChild(legendEl);
    // defer first render until in DOM so CSS vars resolve on the SVG
    setTimeout(render, 0);
    render();
    return host;
  }

  /* ============================================================
     THE CORPUS — hand-authored. Macro & money at the centre,
     with adjacent micro / game-theory / behavioural gems.
     Each: { id, title, area, topic, big, formula, worked[],
             why, model, challengeQ, challengeA }
     worked rows: [key, value] ; last row is the "out" result.
     ============================================================ */
  var CORPUS = [
    /* ---------- INFLATION & PURCHASING POWER ---------- */
    {
      id: "inflation-basics", title: "What inflation actually is", area: "Inflation", topic: "prices",
      big: "Inflation is a sustained rise in the general price level — it is money losing purchasing power, not any single item getting dearer.",
      formula: "inflation rate = (CPIₜ − CPIₜ₋₁) / CPIₜ₋₁",
      worked: [["CPI last year", "150"], ["CPI this year", "159"], ["change", "159 − 150 = 9"], ["inflation", "9 / 150 = 6.0%"]],
      why: "India's central bank, the RBI, targets CPI inflation of 4% (±2%). When your groceries, rent and fuel all creep up together year after year, that is inflation — and it quietly taxes every rupee you hold in cash.",
      model: "purchasingPower",
      challengeQ: "If CPI rises from 200 to 214 in a year, what is the inflation rate?",
      challengeA: "(214 − 200) / 200 = 14 / 200 = 7.0%. Prices rose 7% on average that year."
    },
    {
      id: "purchasing-power", title: "Purchasing power erosion", area: "Money", topic: "purchasing power",
      big: "A fixed amount of cash buys less each year that prices rise. At 6% inflation, ₹100 today is worth about ₹55.84 in ten years.",
      formula: "real value = amount / (1 + inflation)ⁿ",
      worked: [["today", "₹100"], ["inflation", "6% / year"], ["years", "10"], ["divisor", "1.06¹⁰ = 1.7908"], ["real value", "100 / 1.7908 = ₹55.84"]],
      why: "This is why money 'under the mattress' is not safe money — it is guaranteed to lose value. It is the single most important reason ordinary savers are pushed to invest at all.",
      model: "purchasingPower",
      challengeQ: "At 8% inflation, roughly what is ₹1,000 worth in real terms after 5 years?",
      challengeA: "1000 / 1.08⁵ = 1000 / 1.4693 ≈ ₹680.58 — you have lost about ₹319 of purchasing power in five years."
    },
    {
      id: "real-vs-nominal", title: "Real vs nominal", area: "Money", topic: "real vs nominal",
      big: "A nominal figure is the sticker number; a real figure strips out inflation to show true purchasing power. Confusing the two is the most common money mistake.",
      formula: "real growth ≈ (1 + nominal) / (1 + inflation) − 1",
      worked: [["nominal raise", "10%"], ["inflation", "6%"], ["ratio", "1.10 / 1.06 = 1.0377"], ["real raise", "≈ 3.77%"]],
      why: "A '10% raise' in a 6% inflation year is really only about 3.8% more purchasing power. Wages, returns, and GDP are all quoted both ways — always ask which one you're being shown.",
      model: "realReturn",
      challengeQ: "Your salary rises 5% but inflation is 7%. Did your real income rise or fall?",
      challengeA: "It fell. Real change ≈ (1.05/1.07) − 1 ≈ −1.87%. Despite a bigger number on your payslip, you can buy about 1.9% less."
    },
    {
      id: "real-return", title: "Real return on savings", area: "Money", topic: "real vs nominal",
      big: "What your money truly earns is the return after inflation. A 12% nominal return in 6% inflation is only about 5.66% real.",
      formula: "real return = (1 + nominal) / (1 + inflation) − 1",
      worked: [["nominal return", "12%"], ["inflation", "6%"], ["ratio", "1.12 / 1.06 = 1.0566"], ["real return", "≈ 5.66%"]],
      why: "A fixed deposit at 6% during 6% inflation earns you roughly 0% in real terms — and after tax, less than zero. Judging any investment by its nominal rate alone flatters it.",
      model: "realReturn",
      challengeQ: "A bond pays 8% while inflation runs at 8%. What is your real return, before tax?",
      challengeA: "(1.08 / 1.08) − 1 = 0%. Your money grows in number but buys exactly the same basket — you have merely stood still."
    },
    {
      id: "hyperinflation", title: "Hyperinflation", area: "Inflation", topic: "money",
      big: "Hyperinflation is inflation so fast that money becomes almost worthless — often defined as over 50% per month. It destroys savings and the willingness to hold money at all.",
      formula: "50%/month → (1.5)¹² ≈ 129× prices per year",
      worked: [["monthly inflation", "50%"], ["one year", "1.5¹²"], ["price multiple", "≈ 129×"], ["a ₹100 loaf", "becomes ≈ ₹12,975"]],
      why: "Weimar Germany, Zimbabwe and Venezuela all saw people paid twice a day and spending instantly. It is usually caused by governments printing money to cover deficits — a cautionary tale about the money supply.",
      model: "purchasingPower",
      challengeQ: "At 20% inflation per month, roughly how much do prices multiply over a year?",
      challengeA: "1.20¹² ≈ 8.9×. A basket that cost ₹100 in January costs about ₹890 by December — savings held in cash are gutted."
    },
    {
      id: "deflation", title: "Why deflation is dangerous", area: "Inflation", topic: "prices",
      big: "Deflation is falling prices. It sounds nice, but it makes people delay spending, raises the real burden of debt, and can trap an economy in a downward spiral.",
      formula: "real debt burden rises when prices fall",
      worked: [["loan", "₹100"], ["prices fall", "10%"], ["your income (falls too)", "−10%"], ["real burden", "the ₹100 now costs more effort to repay"]],
      why: "Japan spent much of the 1990s–2010s fighting deflation. If everyone expects things to be cheaper next month, they postpone purchases, demand sinks, and firms cut wages — which cuts demand further.",
      model: "purchasingPower",
      challengeQ: "Why might a central bank fear 0% inflation more than 3%?",
      challengeA: "At 0% there is no buffer against tipping into deflation, and it leaves no room to engineer a negative real interest rate to stimulate a slump. A small positive target keeps a safety margin."
    },
    {
      id: "cost-vs-demand-pull", title: "Demand-pull vs cost-push", area: "Inflation", topic: "causes",
      big: "Demand-pull inflation is 'too much money chasing too few goods'; cost-push inflation comes from rising input costs like oil or wages. The cure differs by cause.",
      formula: "demand-pull: AD ↑ · cost-push: input costs ↑",
      worked: [["oil price", "+50%"], ["transport, plastics, fertiliser", "all rise"], ["type", "cost-push"], ["fix", "hard — hiking rates cools demand but not oil"]],
      why: "A 2022-style oil shock is cost-push: raising interest rates does little to the oil price and can needlessly crush jobs. A boom from cheap credit is demand-pull, where rate hikes work well. Naming the cause matters.",
      model: "phillips",
      challengeQ: "A festival season sees demand surge and prices jump. Which type is this, and does a rate hike help?",
      challengeA: "Demand-pull. Higher rates cool borrowing and spending, easing the demand that is pulling prices up — so yes, monetary tightening is the right tool here."
    },

    /* ---------- INTEREST RATES & CENTRAL BANKING ---------- */
    {
      id: "policy-rate", title: "The policy rate", area: "Central Banking", topic: "interest rates",
      big: "The policy rate (India's repo rate) is the interest a central bank charges banks. It is the master dial that ripples out to every loan, deposit and bond in the economy.",
      formula: "repo ↑ → borrowing costlier → demand & inflation cool",
      worked: [["repo rate", "6.5%"], ["banks borrow at", "≈ 6.5%"], ["they lend to you at", "6.5% + spread ≈ 9%"], ["effect of a hike", "loans dearer, saving more rewarding"]],
      why: "When the RBI moves the repo rate, your home-loan EMI, your FD rate and the return on government bonds all shift. It is the most-watched number in macroeconomics because it steers inflation and growth together.",
      model: "amortize",
      challengeQ: "If the central bank cuts the policy rate, what happens to borrowing and spending, all else equal?",
      challengeA: "Borrowing gets cheaper, so households and firms borrow and spend more, lifting demand (and usually inflation and growth). Cutting is the classic tool to fight a slowdown."
    },
    {
      id: "rule-of-70", title: "The rule of 70", area: "Growth", topic: "compounding",
      big: "Divide 70 by a growth rate to estimate how many years it takes to double. It's a fast mental shortcut for compounding — of savings, prices, or GDP.",
      formula: "doubling time ≈ 70 / rate    (exact: ln 2 / ln(1+r))",
      worked: [["growth", "7% / year"], ["rule of 70", "70 / 7 = 10 years"], ["rule of 72", "72 / 7 ≈ 10.29 years"], ["exact", "ln2 / ln1.07 = 10.24 years"]],
      why: "It works for anything that compounds. At 7% inflation, prices double in a decade. At 3.5% GDP growth, the economy doubles in ~20 years. It turns abstract percentages into gut-level time.",
      model: "ruleOf70",
      challengeQ: "At 5% annual growth, roughly how long until an amount doubles?",
      challengeA: "70 / 5 = 14 years (the exact figure is ln2/ln1.05 ≈ 14.21 years, so the rule is close). The rule of 72 gives 72/5 = 14.4 years."
    },
    {
      id: "compound-interest", title: "Compound interest", area: "Money", topic: "compounding",
      big: "Compounding is earning returns on your past returns. Over long horizons it dominates everything — it is the engine behind both wealth and debt.",
      formula: "A = P (1 + r)ⁿ",
      worked: [["principal P", "₹10,000"], ["rate r", "7% / year"], ["years n", "10"], ["1.07¹⁰", "1.9672"], ["amount A", "₹19,671.51"]],
      why: "₹10,000 at 7% nearly doubles in a decade without you adding a rupee. The same force works against you on credit-card debt at 36% a year, which doubles in about two years. Time is the key ingredient.",
      model: "realReturn",
      challengeQ: "What does ₹50,000 grow to at 8% compounded annually for 9 years?",
      challengeA: "50000 × 1.08⁹ = 50000 × 1.9990 ≈ ₹99,950 — very nearly a double, matching the rule of 70 (70/8 ≈ 8.75 years to double)."
    },
    {
      id: "amortization", title: "How a loan EMI is built", area: "Money", topic: "interest rates",
      big: "An EMI is a level payment that covers interest plus a slice of principal. Early payments are mostly interest; only later do you dent the balance.",
      formula: "EMI = P · r / (1 − (1 + r)⁻ⁿ)    (r = monthly rate)",
      worked: [["loan P", "₹10,00,000"], ["rate", "9%/yr → 0.75%/mo"], ["months n", "240"], ["EMI", "₹8,997"], ["total interest", "≈ ₹11,59,342"]],
      why: "On a 20-year home loan at 9%, you repay more in interest than you borrowed. Understanding amortization shows why prepaying early — when the balance is largest — saves the most interest.",
      model: "amortize",
      challengeQ: "Two loans are identical but one is 15 years and one 25 years. Which has the lower EMI, and which costs more in total?",
      challengeA: "The 25-year loan has the lower monthly EMI (payments are spread thinner) but costs far more in total interest, because you owe the balance for a decade longer."
    },
    {
      id: "bond-price-yield", title: "Bond prices move inverse to yields", area: "Markets", topic: "interest rates",
      big: "When market interest rates rise, the price of existing bonds falls — because their fixed coupons look worse next to new, higher-paying bonds.",
      formula: "price = Σ coupon/(1+y)ᵗ + face/(1+y)ⁿ",
      worked: [["face", "₹1,000"], ["coupon", "5% (₹50/yr, 5 yr)"], ["if yield = 5%", "price ₹1,000 (par)"], ["if yield = 7%", "price ₹918"], ["if yield = 3%", "price ₹1,092"]],
      why: "This is why a central-bank rate hike can dent bond and debt-fund portfolios: the fixed income they hold is repriced downward. Long-dated bonds swing the most for a given yield change.",
      model: "bondPrice",
      challengeQ: "Interest rates in the market fall sharply. What happens to the price of a bond you already own?",
      challengeA: "Its price rises. Your bond's fixed coupon is now more attractive than newly issued bonds paying less, so buyers bid its price up above face value (a premium)."
    },
    {
      id: "yield-curve", title: "The yield curve", area: "Markets", topic: "interest rates",
      big: "The yield curve plots interest rates against how long you lend. Normally it slopes up; when it inverts (short rates above long), a recession has often followed.",
      formula: "slope = long-term yield − short-term yield",
      worked: [["2-year yield", "7.2%"], ["10-year yield", "7.0%"], ["slope", "7.0 − 7.2 = −0.2%"], ["shape", "inverted (a warning sign)"]],
      why: "An inverted curve means markets expect rate cuts ahead — usually because they foresee a slowdown. In the US it has preceded most recessions, which is why economists watch the 10-year-minus-2-year spread closely.",
      model: "bondPrice",
      challengeQ: "Why does an upward-sloping yield curve feel 'normal'?",
      challengeA: "Lending for longer ties up your money and carries more inflation and default risk, so lenders normally demand a higher yield for longer maturities — an upward slope."
    },
    {
      id: "real-interest-rate", title: "The real interest rate", area: "Central Banking", topic: "interest rates",
      big: "The real interest rate is the nominal rate minus inflation. It, not the headline rate, determines whether saving or borrowing actually pays.",
      formula: "real rate ≈ nominal rate − inflation (Fisher)",
      worked: [["nominal rate", "8%"], ["inflation", "6%"], ["real rate", "≈ 2%"], ["exact", "1.08/1.06 − 1 = 1.89%"]],
      why: "A 'high' 10% loan in 9% inflation is cheap in real terms; a 'low' 4% loan in 1% inflation is dearer. Central banks often try to set a negative real rate to stimulate a weak economy.",
      model: "realReturn",
      challengeQ: "Nominal rates are 5% and inflation is 2%. Is the real rate higher or lower than when rates are 9% and inflation is 8%?",
      challengeA: "Higher. 5% − 2% = 3% real, versus 9% − 8% = 1% real. The lower nominal rate actually carries the higher real cost of borrowing."
    },
    {
      id: "central-bank-role", title: "What a central bank does", area: "Central Banking", topic: "institutions",
      big: "A central bank manages the money supply and interest rates to keep inflation stable, and acts as lender of last resort to banks in a panic.",
      formula: "mandate: price stability (+ growth, financial stability)",
      worked: [["tool 1", "policy (repo) rate"], ["tool 2", "reserve requirements"], ["tool 3", "open-market bond operations"], ["goal", "inflation ≈ 4% target"]],
      why: "The RBI, the US Fed and the ECB are politically independent by design, so that the temptation to print money before elections doesn't wreck long-run price stability. Their credibility itself anchors expectations.",
      model: "moneyMultiplier",
      challengeQ: "Why is central-bank independence considered important for controlling inflation?",
      challengeA: "An independent central bank can raise rates or curb money growth even when it's politically unpopular. That credibility keeps inflation expectations anchored, which itself helps keep actual inflation low."
    },
    {
      id: "open-market-operations", title: "Open-market operations", area: "Central Banking", topic: "money supply",
      big: "A central bank changes the money supply by buying or selling government bonds. Buying injects cash into banks; selling drains it.",
      formula: "buy bonds → reserves ↑ → money supply ↑",
      worked: [["RBI buys bonds", "₹10,000 cr"], ["bank reserves", "+₹10,000 cr"], ["with 10% reserve ratio", "×10 multiplier"], ["potential money", "up to ₹1,00,000 cr"]],
      why: "This is the day-to-day plumbing of monetary policy. Quantitative easing (QE) after 2008 and 2020 was open-market buying on a massive scale, flooding banks with reserves to push rates down.",
      model: "moneyMultiplier",
      challengeQ: "To fight inflation, should a central bank buy or sell bonds in the open market?",
      challengeA: "Sell. Selling bonds pulls cash out of the banking system, shrinking reserves and the money supply, which raises rates and cools demand — the opposite of stimulus."
    },

    /* ---------- MONEY SUPPLY ---------- */
    {
      id: "money-multiplier", title: "The money multiplier", area: "Money", topic: "money supply",
      big: "Banks lend out most of each deposit, which becomes someone else's deposit, and so on. A ₹1,000 injection can balloon the money supply many times over.",
      formula: "max money = fresh reserves × (1 / reserve ratio)",
      worked: [["fresh reserves", "₹1,000"], ["reserve ratio", "10%"], ["multiplier", "1 / 0.10 = 10"], ["max new deposits", "₹1,000 × 10 = ₹10,000"]],
      why: "Most money in a modern economy is not printed notes — it is bank-deposit money created by lending. This is why the reserve ratio and bank lending appetite matter as much as the printing press.",
      model: "moneyMultiplier",
      challengeQ: "If the reserve ratio is 20%, what is the money multiplier, and what can ₹1,000 of reserves become?",
      challengeA: "Multiplier = 1 / 0.20 = 5. So ₹1,000 in fresh reserves can support up to ₹1,000 × 5 = ₹5,000 of deposits — half the expansion of a 10% ratio."
    },
    {
      id: "money-definitions", title: "M0, M1, M3 — kinds of money", area: "Money", topic: "money supply",
      big: "Money supply is measured in layers: M0 is cash and central-bank reserves; broader measures like M1 and M3 add deposits of increasing 'stickiness'.",
      formula: "M0 ⊂ M1 ⊂ M3 (narrow → broad)",
      worked: [["M0", "notes, coins, bank reserves"], ["M1", "M0 + demand deposits"], ["M3", "M1 + time deposits"], ["broad money", "M3 in India"]],
      why: "When people say 'the central bank prints money', they usually mean M0. But most spending power lives in M3, created by bank lending. Watching which layer grows tells you where the money is being made.",
      model: "moneyMultiplier",
      challengeQ: "A central bank creates reserves (M0) but banks don't lend. What happens to broad money?",
      challengeA: "Broad money barely grows. Without lending, the multiplier doesn't work — reserves just sit at the central bank. This is why QE sometimes fails to lift inflation as much as expected."
    },
    {
      id: "quantity-theory", title: "The quantity theory of money", area: "Money", topic: "money supply",
      big: "MV = PY: the money supply times how fast it circulates equals the price level times real output. Long-run, more money mostly means higher prices.",
      formula: "M · V = P · Y",
      worked: [["money M", "₹50"], ["velocity V", "4"], ["MV", "₹200"], ["= nominal GDP PY", "₹200"], ["if V, Y fixed and M doubles", "P doubles"]],
      why: "This is the theoretical backbone of 'inflation is always and everywhere a monetary phenomenon'. In practice velocity isn't constant, but over long spans, countries that expand money fastest do see the highest inflation.",
      model: "purchasingPower",
      challengeQ: "If money supply grows 10%, real output grows 3%, and velocity is stable, what's the rough inflation?",
      challengeA: "MV = PY, so %ΔP ≈ %ΔM + %ΔV − %ΔY ≈ 10% + 0% − 3% = about 7% inflation."
    },
    {
      id: "velocity", title: "Velocity of money", area: "Money", topic: "money supply",
      big: "Velocity is how many times a unit of money is spent in a period. When confidence falls, people hoard, velocity drops, and spending sags even if money supply is high.",
      formula: "V = nominal GDP / money supply = PY / M",
      worked: [["nominal GDP", "₹200"], ["money supply M", "₹50"], ["velocity V", "200 / 50 = 4"], ["meaning", "each rupee is spent 4× a year"]],
      why: "After 2008 and 2020, central banks flooded the system with money but inflation stayed low for years — because velocity collapsed as households and banks hoarded cash. Money only inflates prices when it moves.",
      model: "moneyMultiplier",
      challengeQ: "Money supply is ₹80 and nominal GDP is ₹240. What is velocity?",
      challengeA: "V = PY / M = 240 / 80 = 3. Each rupee changes hands three times a year on average to produce that output."
    },

    /* ---------- GDP & GROWTH ---------- */
    {
      id: "gdp-expenditure", title: "GDP = C + I + G + NX", area: "Growth", topic: "GDP",
      big: "Gross domestic product is the total value of everything an economy produces, most easily counted as spending: consumption, investment, government, and net exports.",
      formula: "GDP = C + I + G + (X − M)",
      worked: [["consumption C", "60"], ["investment I", "15"], ["government G", "20"], ["net exports X−M", "8 − 13 = −5"], ["GDP", "60+15+20−5 = 90"]],
      why: "This identity tells you where growth comes from. India's growth leans heavily on consumption (C) and investment (I); an export slump (lower X) or an import surge (higher M) both drag GDP down through NX.",
      model: "supplyDemand",
      challengeQ: "If C = 70, I = 20, G = 25, exports = 15 and imports = 10, what is GDP?",
      challengeA: "GDP = 70 + 20 + 25 + (15 − 10) = 70 + 20 + 25 + 5 = 140."
    },
    {
      id: "real-vs-nominal-gdp", title: "Real vs nominal GDP", area: "Growth", topic: "GDP",
      big: "Nominal GDP is measured at current prices, so it rises with inflation. Real GDP holds prices fixed, isolating true growth in output.",
      formula: "real GDP = nominal GDP / (price index / 100)",
      worked: [["nominal GDP", "₹110"], ["GDP deflator", "105"], ["real GDP", "110 / 1.05 = ₹104.76"], ["real growth", "≈ 4.8% not 10%"]],
      why: "A country can post big 'nominal growth' that is mostly inflation. When you read that GDP grew, always check it's the real figure — otherwise a burst of inflation masquerades as prosperity.",
      model: "realReturn",
      challengeQ: "Nominal GDP rises 8% but the deflator rises 5%. What is real growth?",
      challengeA: "Real growth ≈ 8% − 5% = about 3% (exactly (1.08/1.05) − 1 ≈ 2.86%). Most of the headline number was just higher prices."
    },
    {
      id: "gdp-growth-compounding", title: "Why small growth gaps matter", area: "Growth", topic: "GDP",
      big: "A one-point difference in growth compounds into vast gaps over a generation. 6% versus 4% growth means doubling in ~12 years instead of ~18.",
      formula: "doubling time ≈ 70 / growth rate",
      worked: [["economy at 6%", "doubles in 70/6 ≈ 11.7 yr"], ["economy at 4%", "doubles in 70/4 = 17.5 yr"], ["over 35 years", "6%: ~7.7× · 4%: ~4×"], ["gap", "nearly double the size"]],
      why: "This is why policymakers obsess over a single percentage point of GDP growth. Sustained higher growth is how countries like South Korea went from poorer than India to rich within two generations.",
      model: "ruleOf70",
      challengeQ: "Country A grows 7%/yr, Country B grows 2%/yr. Roughly how much faster does A double?",
      challengeA: "A doubles in ~70/7 = 10 years; B in ~70/2 = 35 years. A doubles about 3.5 times faster — a chasm opens within one lifetime."
    },
    {
      id: "gdp-per-capita", title: "GDP per capita", area: "Growth", topic: "GDP",
      big: "GDP per capita divides output by population — a rough gauge of average living standards. A big economy can still be poor per person.",
      formula: "GDP per capita = GDP / population",
      worked: [["GDP", "$3.5 trillion"], ["population", "1.4 billion"], ["per capita", "≈ $2,500"], ["comparison", "large total, modest per person"]],
      why: "India has one of the world's largest total GDPs yet a modest GDP per capita, because output is spread over 1.4 billion people. Whether growth outpaces population growth decides if people actually feel richer.",
      model: "ruleOf70",
      challengeQ: "GDP grows 6% but population grows 6% too. Does GDP per capita rise?",
      challengeA: "No — it's flat. Per-capita income only rises when output grows faster than population. This is why demographic and growth trends must be read together."
    },
    {
      id: "cagr", title: "CAGR — smoothing growth", area: "Growth", topic: "compounding",
      big: "The compound annual growth rate is the single steady rate that would take you from a start value to an end value. It smooths out lumpy year-to-year swings.",
      formula: "CAGR = (end / start)^(1/n) − 1",
      worked: [["start", "₹100"], ["end", "₹200"], ["years n", "10"], ["ratio^(1/n)", "2^0.1 = 1.0718"], ["CAGR", "≈ 7.18%"]],
      why: "CAGR lets you compare investments or economies on equal footing regardless of volatility. 'Doubled in 10 years' sounds impressive but is just a 7.2% CAGR — reframing it keeps you honest.",
      model: "ruleOf70",
      challengeQ: "An investment grows from ₹100 to ₹400 over 20 years. What's the CAGR?",
      challengeA: "(400/100)^(1/20) − 1 = 4^0.05 − 1 ≈ 1.0718 − 1 = about 7.18% — the same rate as doubling in 10 years, because 4× in 20 years is two doublings."
    },

    /* ---------- UNEMPLOYMENT & PHILLIPS ---------- */
    {
      id: "unemployment-rate", title: "The unemployment rate", area: "Labour", topic: "unemployment",
      big: "The unemployment rate is the share of the labour force actively looking for work but without a job — not the share of the whole population.",
      formula: "rate = unemployed / labour force",
      worked: [["employed", "45"], ["unemployed", "5"], ["labour force", "45 + 5 = 50"], ["rate", "5 / 50 = 10%"]],
      why: "People who stop looking drop out of the labour force, so a falling rate can hide 'discouraged workers'. That is why economists also watch the labour-force participation rate alongside it.",
      model: "phillips",
      challengeQ: "A town has 90 employed and 10 unemployed job-seekers; 100 others aren't looking. What's the unemployment rate?",
      challengeA: "Only job-seekers count in the labour force: 10 / (90 + 10) = 10 / 100 = 10%. The 100 not looking are outside the labour force entirely."
    },
    {
      id: "phillips-curve", title: "The Phillips curve trade-off", area: "Labour", topic: "unemployment",
      big: "In the short run, lower unemployment tends to come with higher inflation, and vice-versa. Policymakers can, for a while, trade one against the other.",
      formula: "π ≈ expected π − b·(u − uₙ)",
      worked: [["unemployment falls", "6% → 5%"], ["labour gets scarce", "wages ↑"], ["inflation", "rises"], ["trade-off", "along the short-run curve"]],
      why: "This tension is at the heart of every central-bank decision: cool inflation and you risk job losses; chase full employment and you risk overheating prices. The RBI and Fed live on this curve.",
      model: "phillips",
      challengeQ: "The economy is running hot with very low unemployment. What does the Phillips curve predict for inflation?",
      challengeA: "Rising inflation. With few idle workers, firms bid up wages to hire, and those costs feed into prices — the classic overheating end of the short-run Phillips curve."
    },
    {
      id: "natural-rate", title: "The natural rate of unemployment", area: "Labour", topic: "unemployment",
      big: "Some unemployment is normal even in a healthy economy — people between jobs (frictional) or mismatched to openings (structural). Pushing below it stokes inflation.",
      formula: "natural rate = frictional + structural",
      worked: [["frictional", "between jobs"], ["structural", "skills mismatch"], ["cyclical", "from downturns (removable)"], ["natural rate", "frictional + structural only"]],
      why: "This is why 0% unemployment is neither possible nor desirable. In the long run, the Phillips curve is vertical at the natural rate — trying to push below it just accelerates inflation without lasting job gains.",
      model: "phillips",
      challengeQ: "Why can't sound policy drive unemployment to zero?",
      challengeA: "Some unemployment is frictional (people switching jobs) and structural (skills don't match openings). These persist even in booms, so the achievable floor — the natural rate — is well above zero."
    },
    {
      id: "okuns-law", title: "Okun's law", area: "Labour", topic: "unemployment",
      big: "Okun's law is a rough rule that each extra point of unemployment above normal costs roughly two points of lost GDP. Jobs and output move together.",
      formula: "%ΔGDP gap ≈ −2 × Δ(unemployment)",
      worked: [["unemployment rises", "+1 point"], ["Okun coefficient", "≈ 2"], ["output loss", "≈ 2% of GDP"], ["so a slump", "hits jobs and output together"]],
      why: "It gives a back-of-envelope link between the human cost (jobs) and the economic cost (output) of a recession. The exact coefficient varies by country, but the co-movement is robust.",
      model: "phillips",
      challengeQ: "Using Okun's rule of thumb, if unemployment jumps 2 points, roughly how much output is lost?",
      challengeA: "About 2 × 2 = 4% of GDP. A recession that adds two points of joblessness typically shaves several percent off national output."
    },

    /* ---------- BUSINESS CYCLES & POLICY ---------- */
    {
      id: "business-cycle", title: "The business cycle", area: "Cycles", topic: "growth",
      big: "Economies don't grow in a straight line — they move through expansion, peak, contraction (recession) and trough, then recover. A recession is commonly two quarters of falling real GDP.",
      formula: "recession ≈ 2 quarters of falling real GDP",
      worked: [["Q1", "GDP +0.5%"], ["Q2", "GDP −0.3%"], ["Q3", "GDP −0.4%"], ["Q2–Q3", "recession (2 down quarters)"]],
      why: "Knowing where you are in the cycle shapes everything: near a peak, central banks tighten to prevent overheating; near a trough, they cut rates and governments spend to pull the economy back up.",
      model: "phillips",
      challengeQ: "Real GDP falls for two consecutive quarters. What phase is this, and how might a central bank respond?",
      challengeA: "A recession (contraction). A central bank typically responds by cutting the policy rate to make borrowing cheaper and revive demand, often alongside government fiscal support."
    },
    {
      id: "fiscal-vs-monetary", title: "Fiscal vs monetary policy", area: "Policy", topic: "stabilisation",
      big: "Monetary policy is the central bank moving interest rates and money; fiscal policy is the government changing spending and taxes. Both steer demand, by different levers.",
      formula: "monetary: rates & money · fiscal: spending & taxes",
      worked: [["slump: monetary", "cut rates, ease money"], ["slump: fiscal", "spend more, cut taxes"], ["boom: monetary", "raise rates"], ["boom: fiscal", "cut spending, raise taxes"]],
      why: "In a deep slump (like 2020), rates are already near zero, so monetary policy runs out of room and fiscal policy — stimulus cheques, public works — does the heavy lifting. They work best in concert.",
      model: "supplyDemand",
      challengeQ: "Rates are already at 0% but the economy is still weak. Which lever is left?",
      challengeA: "Fiscal policy. With monetary policy hitting the zero lower bound, the government can still boost demand directly through higher spending or tax cuts (deficit-financed stimulus)."
    },
    {
      id: "fiscal-multiplier", title: "The fiscal multiplier", area: "Policy", topic: "stabilisation",
      big: "A rupee of government spending can raise GDP by more than a rupee, because the recipient spends part of it, the next person spends part of that, and so on.",
      formula: "multiplier = 1 / (1 − MPC)",
      worked: [["marginal propensity to consume", "0.8"], ["1 − MPC", "0.2"], ["multiplier", "1 / 0.2 = 5"], ["₹100 spend → GDP", "up to ₹500"]],
      why: "The multiplier is bigger when people spend (rather than save) each extra rupee, which is why stimulus is aimed at lower-income households who spend most of it. In a boom the multiplier is smaller.",
      model: "moneyMultiplier",
      challengeQ: "If households spend 75% of extra income (MPC = 0.75), what is the simple fiscal multiplier?",
      challengeA: "1 / (1 − 0.75) = 1 / 0.25 = 4. Each ₹1 of government spending can raise GDP by up to ₹4 through successive rounds of re-spending."
    },
    {
      id: "crowding-out", title: "Crowding out", area: "Policy", topic: "stabilisation",
      big: "When a government borrows heavily, it can push up interest rates and 'crowd out' private investment — blunting the boost from its own spending.",
      formula: "gov borrowing ↑ → rates ↑ → private investment ↓",
      worked: [["gov deficit", "large"], ["bond issuance", "↑"], ["interest rates", "↑"], ["private investment", "↓ (partly offsets stimulus)"]],
      why: "It is a key argument against endless deficit spending. The effect is weak in a slump (idle savings, low rates) but strong when the economy is near full capacity — timing matters enormously.",
      model: "bondPrice",
      challengeQ: "Why is crowding out weaker during a deep recession?",
      challengeA: "In a slump there's slack: idle savings and weak private demand for loans keep rates low, so government borrowing doesn't push rates up much or displace much private investment."
    },
    {
      id: "public-debt", title: "Public debt and debt-to-GDP", area: "Policy", topic: "public debt",
      big: "What matters isn't the raw size of government debt but its ratio to GDP — and whether the economy grows faster than the interest on that debt.",
      formula: "debt/GDP falls if growth rate > interest rate (g > r)",
      worked: [["debt", "₹100"], ["GDP", "₹100 (ratio 100%)"], ["growth", "6%"], ["interest on debt", "4%"], ["since g > r", "ratio drifts down over time"]],
      why: "A country can 'grow out of' its debt if nominal growth exceeds its borrowing cost, which is why inflation and growth quietly erode debt burdens. When r exceeds g, debt snowballs and demands hard choices.",
      model: "ruleOf70",
      challengeQ: "An economy grows 3% while paying 7% interest on its debt. Which way does debt/GDP tend to move?",
      challengeA: "Upward. Because the interest rate (7%) exceeds growth (3%), debt compounds faster than the economy, so the debt-to-GDP ratio tends to snowball unless the government runs a surplus."
    },

    /* ---------- EXCHANGE RATES & TRADE ---------- */
    {
      id: "exchange-rates", title: "Exchange rates", area: "Trade", topic: "exchange rates",
      big: "An exchange rate is the price of one currency in another. When the rupee 'weakens', it takes more rupees to buy a dollar — making imports dearer and exports cheaper.",
      formula: "weaker ₹ → imports dearer, exports cheaper",
      worked: [["before", "₹80 = $1"], ["after (weaker ₹)", "₹85 = $1"], ["a $100 import", "₹8,000 → ₹8,500"], ["effect", "imported goods cost more"]],
      why: "A weaker rupee raises the price of crude oil, electronics and foreign travel for Indians, feeding inflation, while helping exporters and IT services earn more per dollar. The rate is a constant tug-of-war.",
      model: "supplyDemand",
      challengeQ: "The rupee moves from ₹80/$ to ₹75/$. Has it strengthened or weakened, and who benefits?",
      challengeA: "It has strengthened (fewer rupees per dollar). Importers and travellers benefit from cheaper foreign goods; exporters earn fewer rupees per dollar of sales, so they're worse off."
    },
    {
      id: "ppp", title: "Purchasing power parity", area: "Trade", topic: "exchange rates",
      big: "PPP says that, in the long run, exchange rates should adjust so a basket of goods costs the same everywhere. The Big Mac index is the fun version.",
      formula: "PPP rate = price at home / price abroad",
      worked: [["burger in India", "₹200"], ["burger in US", "$5"], ["PPP rate", "200 / 5 = ₹40 per $"], ["if market rate is ₹83", "₹ looks 'undervalued' vs PPP"]],
      why: "PPP is why comparing incomes at market exchange rates overstates the gap between rich and poor countries — a rupee buys far more in India than a dollar buys in the US. GDP is often quoted 'at PPP' for fairer comparison.",
      model: "supplyDemand",
      challengeQ: "If the same basket costs ₹4,000 in India and $100 in the US, what is the PPP exchange rate?",
      challengeA: "PPP rate = 4000 / 100 = ₹40 per dollar. If the market rate is higher (say ₹83), the rupee is 'undervalued' relative to PPP, meaning goods are cheaper in India."
    },
    {
      id: "balance-of-payments", title: "Current account & trade balance", area: "Trade", topic: "external",
      big: "The current account tracks a country's trade in goods, services and income with the world. A deficit means it's importing more value than it exports — and borrowing the difference.",
      formula: "current account ≈ exports − imports + net income",
      worked: [["exports", "300"], ["imports", "350"], ["trade balance", "−50 (deficit)"], ["+ remittances", "+40"], ["current account", "−10"]],
      why: "India runs a goods-trade deficit (it imports lots of oil) but is cushioned by huge software-service exports and remittances from workers abroad. A persistent deficit must be financed by foreign capital inflows.",
      model: "supplyDemand",
      challengeQ: "A country imports ₹200 of goods, exports ₹150, and receives ₹80 in remittances. What's its current account, roughly?",
      challengeA: "Trade balance = 150 − 200 = −50; add remittances +80 → current account ≈ +30 (a surplus). Remittances can flip a goods deficit into an overall surplus."
    },
    {
      id: "comparative-advantage", title: "Comparative advantage", area: "Trade", topic: "gains from trade",
      big: "Two parties both gain from trade if each specialises in what it gives up least to produce — even if one is better at everything. It's the deepest idea in trade.",
      formula: "specialise where opportunity cost is lowest",
      worked: [["India: 1 cloth costs", "0.5 wheat"], ["US: 1 cloth costs", "2 wheat"], ["India's opp. cost lower", "for cloth"], ["so India exports cloth", "both end up richer"]],
      why: "Comparative advantage explains why global trade makes both sides better off, not just the 'stronger' economy. It's why an IT-services India and an agriculture-rich partner can both gain by trading.",
      model: "supplyDemand",
      challengeQ: "Country A is better than B at making both cars and shirts. Can they still gain from trade?",
      challengeA: "Yes. What matters is relative (opportunity) cost, not absolute skill. If A gives up fewer cars per shirt than B, they should specialise by comparative advantage and trade — both gain."
    },

    /* ---------- MICRO / GAME THEORY / BEHAVIOURAL GEMS ---------- */
    {
      id: "supply-demand", title: "Supply, demand & equilibrium", area: "Markets", topic: "prices",
      big: "Price settles where the quantity buyers want equals the quantity sellers offer. Shift either curve and both the price and quantity move.",
      formula: "equilibrium: quantity demanded = quantity supplied",
      worked: [["demand", "Qd = 100 − 2P"], ["supply", "Qs = −20 + 3P"], ["set equal", "100 − 2P = −20 + 3P"], ["solve", "120 = 5P → P = ₹24, Q = 52"]],
      why: "This is the workhorse of microeconomics and the logic behind every price you see. A supply shock (bad harvest) or a demand shock (a fad) moves the crossing point in predictable directions.",
      model: "supplyDemand",
      challengeQ: "Demand rises (buyers want more at every price). What happens to equilibrium price and quantity?",
      challengeA: "Both rise. The demand curve shifts out, so it crosses the supply curve at a higher price and a higher quantity — try the +demand shift in the model above."
    },
    {
      id: "price-elasticity", title: "Price elasticity of demand", area: "Markets", topic: "elasticity",
      big: "Elasticity measures how sensitive quantity is to price. If a 10% price cut lifts sales more than 10%, demand is elastic and cutting price raises revenue.",
      formula: "elasticity = %Δ quantity / %Δ price",
      worked: [["price", "−10%"], ["quantity", "+25%"], ["elasticity", "25 / 10 = 2.5"], ["|E| > 1", "elastic → revenue rises"]],
      why: "It's why petrol can be taxed heavily (inelastic — people still buy it) while cinema tickets get discounted (elastic — cheaper seats fill the hall and lift revenue). Pricing strategy lives on elasticity.",
      model: "supplyDemand",
      challengeQ: "A 20% price rise cuts sales by only 5%. Is demand elastic or inelastic, and does revenue rise?",
      challengeA: "Elasticity = 5/20 = 0.25, which is inelastic (|E| < 1). Since quantity barely falls, total revenue rises when price goes up — typical of essentials."
    },
    {
      id: "opportunity-cost", title: "Opportunity cost", area: "Micro", topic: "choice",
      big: "The true cost of any choice is the best alternative you gave up. Money spent is only part of it — time and forgone options count too.",
      formula: "opportunity cost = value of next-best forgone option",
      worked: [["study cost", "₹0 tuition"], ["forgone job", "₹3,00,000 salary"], ["true cost of a year", "≈ ₹3,00,000"], ["lesson", "'free' is rarely free"]],
      why: "It reframes every decision. A 'free' extra degree can cost a year's salary; keeping savings in cash costs the return you could have earned. Good economic thinking always asks 'compared to what?'.",
      model: "realReturn",
      challengeQ: "You keep ₹1,00,000 in a 0% account while inflation is 6%. What's the opportunity cost after a year?",
      challengeA: "You forgo both a safe return and lose purchasing power. If a 6% deposit was available, the opportunity cost is roughly ₹6,000 of interest, plus your cash also lost ~6% of its real value."
    },
    {
      id: "diminishing-returns", title: "Diminishing marginal utility", area: "Behavioural", topic: "value",
      big: "Each extra unit of something usually gives you less added satisfaction than the last. The first glass of water in a desert is priceless; the tenth, not so much.",
      formula: "marginal utility declines as quantity rises",
      worked: [["1st slice of pizza", "utility 10"], ["2nd slice", "utility 7"], ["3rd slice", "utility 3"], ["4th slice", "utility 0 (full!)"]],
      why: "This explains why we diversify spending rather than pour everything into one good, and it underpins the case for redistribution: an extra ₹1,000 means far more to a poor household than to a rich one.",
      model: "purchasingPower",
      challengeQ: "Why does the 'diamond–water paradox' (water is vital yet cheap, diamonds useless yet dear) make sense here?",
      challengeA: "Price reflects marginal, not total, utility. Water is abundant, so its marginal unit is worth little; diamonds are scarce, so each marginal one is highly valued — despite water's greater total usefulness."
    },
    {
      id: "prisoners-dilemma", title: "The prisoner's dilemma", area: "Game Theory", topic: "cooperation",
      big: "Two players acting in pure self-interest can both end up worse off than if they'd cooperated. Rational individual choices can produce a collectively bad outcome.",
      formula: "each defects → both worse than mutual cooperation",
      worked: [["both stay silent", "1 year each (best joint)"], ["both confess", "5 years each"], ["one confesses", "0 for them, 10 for the other"], ["dominant move", "confess → both get 5"]],
      why: "It models arms races, price wars, over-fishing and climate inaction: everyone would gain from cooperating, yet each has an incentive to defect. It's why enforceable agreements and trust are economically valuable.",
      model: "phillips",
      challengeQ: "Two firms would both profit by keeping prices high, but each is tempted to undercut. What usually happens?",
      challengeA: "Both cut prices (defect), ending in a price war that leaves both worse off than if they'd cooperated — the classic prisoner's-dilemma outcome, which is why cartels are unstable without enforcement."
    },
    {
      id: "nash-equilibrium", title: "Nash equilibrium", area: "Game Theory", topic: "strategy",
      big: "A Nash equilibrium is a situation where no player can do better by changing their move alone, given what everyone else is doing. It's where strategies settle.",
      formula: "no player gains by unilaterally deviating",
      worked: [["you drive on left", "others drive left"], ["switch alone?", "crash — worse"], ["so nobody switches", "stable"], ["equilibrium", "everyone drives the same side"]],
      why: "It's the backbone of modern economics and won John Nash the Nobel. It explains stable conventions (which side of the road), standards, and why bad equilibria (everyone distrusting) can persist even when a better one exists.",
      model: "supplyDemand",
      challengeQ: "In the prisoner's dilemma, is 'both confess' a Nash equilibrium?",
      challengeA: "Yes. Given the other confesses, switching to silence gets you 10 years instead of 5 — worse. Neither gains by deviating alone, so mutual confession is the (unfortunate) Nash equilibrium."
    },
    {
      id: "tragedy-commons", title: "The tragedy of the commons", area: "Micro", topic: "externalities",
      big: "A shared, unowned resource tends to get overused, because each user gets the full benefit of taking more while the cost is spread across everyone.",
      formula: "private benefit > private cost → overuse",
      worked: [["shared pasture", "100 cows sustainable"], ["each herder adds cows", "gains full milk"], ["cost (overgrazing)", "shared by all"], ["result", "pasture collapses"]],
      why: "It explains overfishing, groundwater depletion in Indian farming, traffic and pollution. The fixes — property rights, quotas, or taxes on use — are central to environmental economics.",
      model: "supplyDemand",
      challengeQ: "Why do fish stocks collapse even when everyone knows overfishing is bad?",
      challengeA: "Each boat gets the full catch it takes, but the cost of depletion is shared by all fishers. So individually rational overfishing adds up to collective ruin — unless quotas or rights internalise the cost."
    },
    {
      id: "externalities", title: "Externalities", area: "Micro", topic: "externalities",
      big: "An externality is a cost or benefit that falls on someone not party to a transaction — like pollution (negative) or a neighbour's flowers (positive). Markets misprice them.",
      formula: "social cost = private cost + external cost",
      worked: [["factory's private cost", "₹100/unit"], ["pollution cost to others", "₹30/unit"], ["true social cost", "₹130/unit"], ["fix", "a ₹30 tax aligns them"]],
      why: "Because polluters don't pay the full social cost, they produce too much — the case for carbon taxes and congestion charges. Getting the price to reflect the true cost is how economists tackle pollution.",
      model: "supplyDemand",
      challengeQ: "A factory pollutes but pays nothing for it. Does it produce too much or too little from society's view?",
      challengeA: "Too much. It ignores the external cost, so its private cost is below the true social cost, and it overproduces. A tax equal to the external cost restores the socially efficient output."
    },
    {
      id: "loss-aversion", title: "Loss aversion", area: "Behavioural", topic: "biases",
      big: "People feel the pain of a loss about twice as strongly as the pleasure of an equal gain. We are not the cool calculators classical theory assumes.",
      formula: "pain of −₹100 ≈ 2 × joy of +₹100",
      worked: [["gain ₹1,000", "happiness +1 unit"], ["lose ₹1,000", "pain −2 units"], ["net of both", "feels like a loss"], ["so we", "avoid risks irrationally"]],
      why: "Loss aversion (from Kahneman & Tversky) explains why investors hold losing stocks too long, why 'don't lose your streak' motivates, and why a ₹50 discount framed as 'avoid a ₹50 surcharge' sells better.",
      model: "purchasingPower",
      challengeQ: "Why might someone refuse a coin-flip that pays +₹150 on heads but −₹100 on tails, despite the positive expected value?",
      challengeA: "The expected value is +₹25, yet loss aversion makes the possible −₹100 loss loom roughly twice as large as the +₹150 gain, so it feels unattractive. Emotionally, the downside dominates."
    },
    {
      id: "sunk-cost", title: "The sunk-cost fallacy", area: "Behavioural", topic: "biases",
      big: "Money or time already spent and unrecoverable should not influence future decisions — yet it constantly does. 'I've come this far' is a trap.",
      formula: "decide on future costs & benefits only",
      worked: [["spent on a project", "₹5,00,000 (sunk)"], ["cost to finish", "₹2,00,000 more"], ["value if finished", "₹1,00,000"], ["rational call", "stop — the ₹5L is gone"]],
      why: "It keeps people in bad investments, doomed projects and even unhappy commitments because they 'don't want to waste' what's already spent. Good decisions ignore the past and weigh only what's still to come.",
      model: "amortize",
      challengeQ: "You've paid ₹1,000 for a concert ticket but now feel ill and would enjoy staying home more. What should you do?",
      challengeA: "Stay home. The ₹1,000 is sunk either way — it's gone whether you attend or not. The only question is which option you'd enjoy more from now on, and that's resting."
    },
    {
      id: "marginal-thinking", title: "Thinking at the margin", area: "Micro", topic: "choice",
      big: "Good decisions compare the extra benefit of one more unit with its extra cost — not the totals. Rational actors keep going until marginal benefit equals marginal cost.",
      formula: "act while marginal benefit > marginal cost",
      worked: [["4th coffee: benefit", "₹40 of enjoyment"], ["its cost", "₹50"], ["MB < MC", "skip the 4th"], ["rule", "stop where MB = MC"]],
      why: "Firms set output, workers choose extra hours, and you decide 'one more' of anything by the margin. Averages mislead; the next unit is what actually drives the choice.",
      model: "supplyDemand",
      challengeQ: "A factory's average cost is ₹80/unit, but the next unit costs ₹95 to make and sells for ₹90. Should it make it?",
      challengeA: "No. Ignore the average — at the margin, that extra unit costs ₹95 but earns only ₹90, a ₹5 loss. Produce only while marginal revenue exceeds marginal cost."
    },
    {
      id: "gresham-law", title: "Gresham's law", area: "Money", topic: "money",
      big: "'Bad money drives out good.' When two moneys circulate at the same face value, people spend the weaker one and hoard the stronger — so the good money disappears from use.",
      formula: "overvalued money circulates, undervalued is hoarded",
      worked: [["old coin", "pure silver"], ["new coin", "half silver, same face value"], ["people spend", "the debased coin"], ["they hoard", "the silver one"]],
      why: "It's why debased coins historically pushed pure ones out of circulation, and a lens on why people hold appreciating assets and spend depreciating cash. It also explains reluctance to spend 'good' collectible currency.",
      model: "purchasingPower",
      challengeQ: "Two ₹10 coins circulate: one is collectible silver, one ordinary. Which do people spend?",
      challengeA: "The ordinary one. They hoard the more valuable silver coin and pass on the plain one — 'bad money drives out good.' The good coin vanishes from everyday circulation."
    },
    {
      id: "seigniorage", title: "Seigniorage — profit from printing", area: "Money", topic: "money supply",
      big: "Seigniorage is the profit a government makes by creating money that costs far less to produce than its face value. Overdone, it becomes an inflation tax.",
      formula: "seigniorage = face value − cost to produce",
      worked: [["a ₹500 note costs", "≈ ₹4 to print"], ["seigniorage", "₹500 − ₹4 = ₹496"], ["if overused", "money supply ↑ → inflation"], ["inflation is", "a tax on cash holders"]],
      why: "A little seigniorage is a normal revenue source; a lot is how governments 'monetise' deficits and trigger inflation. The inflation it causes is effectively a hidden tax on everyone holding the currency.",
      model: "purchasingPower",
      challengeQ: "Why is high seigniorage sometimes called an 'inflation tax'?",
      challengeA: "Printing lots of money raises the money supply and hence prices. That inflation erodes the value of the cash everyone already holds — transferring purchasing power to the government, like a tax."
    },
    {
      id: "liquidity-trap", title: "The liquidity trap", area: "Central Banking", topic: "interest rates",
      big: "When interest rates are near zero and people hoard cash rather than spend or invest, cutting rates further stops working. Monetary policy loses traction.",
      formula: "rates ≈ 0 and demand still weak → policy stuck",
      worked: [["policy rate", "≈ 0%"], ["cut further?", "little effect"], ["people hoard cash", "velocity falls"], ["remedy", "fiscal stimulus instead"]],
      why: "Japan after the 1990s and the world after 2008 hit this wall. It's the strongest argument for fiscal policy to take over when monetary policy is 'pushing on a string' at the zero lower bound.",
      model: "moneyMultiplier",
      challengeQ: "Rates are at zero and the central bank cuts to −0.1% with little effect. What kind of situation is this?",
      challengeA: "A liquidity trap. Near the zero lower bound, extra monetary easing barely lifts spending because people just hold the cash, so fiscal policy becomes the more effective lever."
    },
    {
      id: "taylor-rule", title: "The Taylor rule", area: "Central Banking", topic: "interest rates",
      big: "The Taylor rule is a simple formula suggesting where a central bank should set its rate: raise it when inflation is above target or the economy runs hot.",
      formula: "rate = neutral + 0.5(π − π*) + 0.5(output gap)",
      worked: [["neutral rate", "2%"], ["inflation gap (π−π*)", "+2%"], ["output gap", "+1%"], ["suggested rate", "2 + 0.5·2 + 0.5·1 = 3.5%"]],
      why: "It's a benchmark for judging whether policy is too loose or too tight. When actual rates sit far below the Taylor-rule level, critics warn the central bank is fuelling inflation; it disciplines the debate.",
      model: "phillips",
      challengeQ: "Inflation is 3% above target and output is 2% above potential; neutral rate is 2%. What does a 0.5/0.5 Taylor rule suggest?",
      challengeA: "rate = 2 + 0.5(3) + 0.5(2) = 2 + 1.5 + 1.0 = 4.5%. The rule says tighten well above neutral because both inflation and output are running hot."
    },
    {
      id: "gini", title: "The Gini coefficient", area: "Growth", topic: "inequality",
      big: "The Gini coefficient measures income inequality on a 0-to-1 scale: 0 is perfect equality (everyone identical), 1 is one person having everything.",
      formula: "Gini = area between equality line & Lorenz curve × 2",
      worked: [["perfect equality", "Gini = 0"], ["typical country", "Gini ≈ 0.3–0.5"], ["very unequal", "Gini > 0.5"], ["India", "≈ 0.35 (income, varies)"]],
      why: "It's the standard yardstick for comparing inequality across countries and time. Growth that lifts GDP but also pushes the Gini up can leave most people feeling left behind despite the good headline numbers.",
      model: "ruleOf70",
      challengeQ: "Country X has a Gini of 0.25 and country Y has 0.55. Which has more equally shared income?",
      challengeA: "Country X. A lower Gini means income is spread more evenly (0 is perfect equality), so X is markedly more equal than Y, whose 0.55 signals high concentration at the top."
    },
    {
      id: "creative-destruction", title: "Creative destruction", area: "Growth", topic: "innovation",
      big: "Schumpeter's idea that growth comes from new technologies destroying old industries. Progress is disruptive by nature — jobs and firms die so better ones can be born.",
      formula: "innovation → old industries fall, new rise",
      worked: [["horse carriages", "→ replaced by cars"], ["film cameras", "→ replaced by digital"], ["digital cameras", "→ replaced by phones"], ["net effect", "higher productivity over time"]],
      why: "It explains why blocking disruption to save old jobs can freeze living standards, and why economies that let firms fail and reallocate often grow fastest. The gains are diffuse; the pain is concentrated — hence the politics.",
      model: "ruleOf70",
      challengeQ: "Why can protecting a declining industry's jobs slow long-run growth?",
      challengeA: "It locks labour and capital into low-productivity uses and blocks the reallocation to more productive new industries. Short-run job protection can cost long-run growth and higher living standards."
    },
    {
      id: "network-effects", title: "Network effects", area: "Markets", topic: "value",
      big: "Some goods get more valuable the more people use them. One telephone is useless; a billion is indispensable. This drives winner-take-most markets.",
      formula: "value rises with the number of users",
      worked: [["1 user", "value ≈ 0"], ["Metcalfe (rough)", "value ∝ n²"], ["10 users", "≈ 100 units"], ["100 users", "≈ 10,000 units"]],
      why: "Network effects explain why messaging apps, payment systems (UPI) and marketplaces tend toward a few dominant players. They create powerful moats — and thorny questions about monopoly and competition policy.",
      model: "ruleOf70",
      challengeQ: "Why is it hard for a new social network to unseat an established one, even if it's better?",
      challengeA: "The incumbent's value comes largely from its users being there. A better app with few users offers little value, so people won't switch — the network effect itself is the barrier."
    },
    {
      id: "moral-hazard", title: "Moral hazard", area: "Markets", topic: "information",
      big: "When people are shielded from the consequences of their risks, they take more of them. Insurance and bailouts can quietly encourage the very behaviour they cover.",
      formula: "protection from downside → riskier behaviour",
      worked: [["fully insured car", "driven less carefully"], ["bailed-out bank", "takes bigger bets"], ["shared downside", "individual takes more risk"], ["fix", "deductibles, 'skin in the game'"]],
      why: "The 2008 crisis is the textbook case: banks that expected rescue took reckless risks. Deductibles, co-pays and 'skin in the game' rules exist precisely to keep some downside with the risk-taker.",
      model: "phillips",
      challengeQ: "Why do insurers use deductibles (a portion you pay yourself)?",
      challengeA: "To curb moral hazard. If you bear part of every loss, you stay careful — a fully covered person has weaker incentives to avoid the risk. The deductible keeps 'skin in the game'."
    },
    {
      id: "adverse-selection", title: "Adverse selection", area: "Markets", topic: "information",
      big: "When one side knows more than the other, the market can fill with 'lemons'. In insurance, the sickest are keenest to buy — pushing prices up and the healthy out.",
      formula: "hidden info before the deal → bad types dominate",
      worked: [["used-car buyer", "can't spot lemons"], ["offers average price", "for the mix"], ["good-car sellers", "walk away"], ["market", "fills with lemons"]],
      why: "Akerlof's 'market for lemons' won a Nobel and explains why insurers demand medical checks and warranties exist. Left unchecked, hidden information can unravel a market entirely.",
      model: "supplyDemand",
      challengeQ: "Why might a health insurer that can't screen applicants end up with mostly high-risk customers?",
      challengeA: "The sickest value coverage most and buy eagerly; the healthy find it overpriced and skip it. So the pool skews high-risk, premiums rise, and it worsens — classic adverse selection."
    },
    {
      id: "time-value-money", title: "The time value of money", area: "Money", topic: "compounding",
      big: "A rupee today is worth more than a rupee tomorrow, because today's rupee can be invested to grow. Discounting future cash back to today is the core of all finance.",
      formula: "present value = future value / (1 + r)ⁿ",
      worked: [["future amount", "₹1,000 in 5 yr"], ["discount rate", "8%"], ["1.08⁵", "1.4693"], ["present value", "1000 / 1.4693 = ₹680.58"]],
      why: "It's why a lottery 'worth ₹1 crore over 20 years' is worth far less today, and how loans, bonds and pensions are all priced. Once you can discount, you can compare any two cash flows across time.",
      model: "realReturn",
      challengeQ: "What is ₹5,000 to be received in 3 years worth today at a 10% discount rate?",
      challengeA: "PV = 5000 / 1.10³ = 5000 / 1.331 ≈ ₹3,756.57. Because you could invest a smaller sum today at 10% to reach ₹5,000 in three years."
    },
    {
      id: "inflation-expectations", title: "Inflation expectations", area: "Inflation", topic: "expectations",
      big: "What people expect inflation to be helps cause the actual inflation. If everyone expects 8%, they demand 8% raises and set 8% price hikes — making it self-fulfilling.",
      formula: "expected inflation feeds into wages & prices",
      worked: [["workers expect", "8% inflation"], ["they demand", "8% wage rises"], ["firms pass on", "higher costs as prices"], ["result", "≈ 8% inflation, as expected"]],
      why: "This is why central banks guard their credibility so fiercely — 'anchoring' expectations near the target is half the battle. Once expectations un-anchor upward, inflation becomes far harder and costlier to wring out.",
      model: "phillips",
      challengeQ: "Why does a credible central bank find it cheaper to keep inflation low?",
      challengeA: "If people trust it to hit its target, they set wages and prices around that low number, so it comes true with little pain. Lost credibility forces a costly, job-destroying squeeze to reset expectations."
    },
    {
      id: "stagflation", title: "Stagflation", area: "Cycles", topic: "growth",
      big: "Stagflation is the nasty combination of stagnant growth (high unemployment) and high inflation at the same time — which the simple Phillips trade-off says shouldn't happen.",
      formula: "high inflation + high unemployment together",
      worked: [["1970s oil shocks", "supply shrank"], ["prices", "↑ (inflation)"], ["output & jobs", "↓ (stagnation)"], ["policy", "no easy fix"]],
      why: "The 1970s oil crises produced stagflation and broke naive Keynesian confidence, because fighting inflation (raise rates) worsens unemployment and vice-versa. Supply shocks, not demand, are the usual culprit.",
      model: "phillips",
      challengeQ: "Why is stagflation so hard for a central bank to fight?",
      challengeA: "Its two tools conflict: raising rates to curb inflation deepens unemployment, while cutting rates to save jobs worsens inflation. With a supply shock, there's no demand-side move that fixes both at once."
    },
    {
      id: "automatic-stabilisers", title: "Automatic stabilisers", area: "Policy", topic: "stabilisation",
      big: "Some parts of the budget cushion the economy on their own: in a slump, taxes fall and unemployment benefits rise without any new law being passed.",
      formula: "downturn → taxes ↓, transfers ↑ → demand cushioned",
      worked: [["recession hits", "incomes fall"], ["income tax paid", "falls automatically"], ["jobless benefits", "rise automatically"], ["net effect", "demand supported"]],
      why: "They act faster than any new stimulus bill because they need no debate — a built-in shock absorber. Countries with stronger social safety nets tend to have milder recessions for this reason.",
      model: "supplyDemand",
      challengeQ: "Name one way the government's budget supports demand in a recession without any new legislation.",
      challengeA: "Progressive taxes automatically collect less as incomes fall, and unemployment benefits automatically pay out more as jobs are lost — both prop up spending power without a new law."
    },
    {
      id: "j-curve", title: "The J-curve of devaluation", area: "Trade", topic: "exchange rates",
      big: "After a currency weakens, the trade balance often worsens before it improves — because import bills rise instantly while export volumes take time to grow.",
      formula: "short run: trade balance ↓, then ↑ (a 'J')",
      worked: [["₹ weakens", "imports cost more now"], ["export volumes", "grow only slowly"], ["short-run balance", "worsens"], ["later", "exports rise → improves"]],
      why: "It warns policymakers not to panic when a devaluation seems to backfire at first. The pain is front-loaded; the gains from cheaper exports and dearer imports arrive with a lag, tracing a J shape over time.",
      model: "supplyDemand",
      challengeQ: "Right after a currency devalues, why might the trade deficit temporarily widen?",
      challengeA: "Existing import contracts and inelastic short-run demand mean the import bill jumps immediately in local currency, while it takes time for exports to ramp up — so the balance dips before it recovers (the J-curve)."
    },
    {
      id: "laffer-curve", title: "The Laffer curve", area: "Policy", topic: "taxation",
      big: "Tax revenue is zero at both 0% and 100% tax rates, so somewhere in between lies a revenue-maximising rate. Beyond it, higher rates can actually collect less.",
      formula: "revenue = rate × taxable base (base shrinks as rate ↑)",
      worked: [["rate 0%", "revenue ₹0"], ["rate 100%", "nobody works → ₹0"], ["moderate rate", "revenue peaks somewhere"], ["past the peak", "raising rate lowers revenue"]],
      why: "It's a caution that very high rates can backfire by discouraging work or driving activity underground — but it's often abused, since no one knows exactly where the peak is, and most economies sit below it.",
      model: "supplyDemand",
      challengeQ: "According to the Laffer curve, does cutting taxes always raise revenue?",
      challengeA: "No. Only if you start above the revenue-maximising rate. If you're already below the peak, cutting rates simply lowers revenue. The curve says there's a peak, not that lower is always better."
    },
    {
      id: "base-effect", title: "The base effect in inflation", area: "Inflation", topic: "prices",
      big: "A high or low comparison point last year can make this year's inflation rate look dramatic even if current prices are calm. It's about the base, not today.",
      formula: "inflation compares to a base a year ago",
      worked: [["last year price spike", "high base"], ["this year prices", "flat"], ["headline inflation", "looks low (base effect)"], ["reality", "prices simply stopped rising"]],
      why: "It's why a single month's inflation figure can mislead. When fuel prices crashed a year ago, the next year's inflation looks high off that low base — even if nothing dramatic is happening right now.",
      model: "purchasingPower",
      challengeQ: "Prices were unusually low last year, then normal this year. What does that do to the reported inflation rate?",
      challengeA: "It inflates it. Comparing normal prices against an unusually low base makes the year-on-year rate look high, even though nothing alarming is happening in the present — a base effect."
    },
    {
      id: "wealth-vs-income", title: "Wealth vs income", area: "Money", topic: "personal finance",
      big: "Income is the flow of money you earn over time; wealth is the stock you've accumulated. A high earner who spends it all can have less wealth than a frugal modest earner.",
      formula: "wealth = accumulated (income − spending), compounded",
      worked: [["income", "₹1,00,000/mo (a flow)"], ["saved", "₹20,000/mo"], ["over years, invested", "becomes a stock"], ["wealth", "the compounded stock"]],
      why: "Confusing the two is common: 'rich' salaries don't automatically build wealth. What you keep and let compound — not what you earn — determines long-run financial security. It links directly to real return and compounding.",
      model: "realReturn",
      challengeQ: "Two people earn the same salary; one saves 20% and invests it, the other saves nothing. After 20 years, who is wealthier and why?",
      challengeA: "The saver, by a wide margin. Wealth is the accumulated, compounded stock of what you keep. Equal income but a positive savings rate, compounded over 20 years, builds substantial wealth versus zero."
    }
  ];

  /* ============================================================
     RENDER a concept card
     ============================================================ */
  var current = 0; // index into CORPUS

  function areas() {
    var seen = {}, list = [];
    CORPUS.forEach(function (c) { if (!seen[c.area]) { seen[c.area] = 0; list.push(c.area); } seen[c.area]++; });
    return { list: list, counts: seen };
  }

  function renderConcept(idx) {
    current = ((idx % CORPUS.length) + CORPUS.length) % CORPUS.length;
    var c = CORPUS[current];
    var card = $("#conceptCard");
    card.innerHTML = "";

    /* head */
    var head = el("div", "concept__head");
    var tags = el("div", "concept__tags");
    tags.appendChild(el("span", "tag tag--area", c.area));
    tags.appendChild(el("span", "tag", c.topic));
    head.appendChild(tags);
    head.appendChild(el("h3", "concept__title", c.title));
    head.appendChild(el("p", "concept__big", c.big));
    card.appendChild(head);

    /* body */
    var body = el("div", "concept__body");

    // model block
    var mBlock = el("div", "block");
    mBlock.appendChild(el("div", "block__label", "Play with it"));
    if (c.formula) {
      var f = el("div", "formula", c.formula);
      mBlock.appendChild(f);
      f.style.marginBottom = "12px";
    }
    var builder = MODELS[c.model] || MODELS.purchasingPower;
    mBlock.appendChild(builder());
    body.appendChild(mBlock);

    // worked example
    var wBlock = el("div", "block");
    wBlock.appendChild(el("div", "block__label", "Worked example"));
    var worked = el("div", "worked");
    c.worked.forEach(function (row, i) {
      var isOut = i === c.worked.length - 1;
      var r = el("div", "worked__row" + (isOut ? " worked__row--out" : ""));
      r.appendChild(el("span", "k", row[0]));
      r.appendChild(el("span", "v", row[1]));
      worked.appendChild(r);
    });
    wBlock.appendChild(worked);
    body.appendChild(wBlock);

    // why it matters
    var yBlock = el("div", "block");
    yBlock.appendChild(el("div", "block__label", "Why it matters"));
    yBlock.appendChild(el("p", "block__text", c.why));
    body.appendChild(yBlock);

    // challenge
    var chBlock = el("div", "block");
    chBlock.appendChild(el("div", "block__label", "Your turn"));
    var challenge = el("div", "challenge");
    challenge.appendChild(el("p", "challenge__q", c.challengeQ));
    var btn = el("button", "challenge__reveal", "Reveal answer");
    btn.type = "button";
    var ans = el("p", "challenge__answer", c.challengeA);
    ans.hidden = true;
    btn.addEventListener("click", function () {
      ans.hidden = !ans.hidden;
      btn.textContent = ans.hidden ? "Reveal answer" : "Hide answer";
    });
    challenge.appendChild(btn);
    challenge.appendChild(ans);
    chBlock.appendChild(challenge);
    body.appendChild(chBlock);

    card.appendChild(body);

    /* foot — mark learned */
    var foot = el("div", "concept__foot");
    var lt = el("label", "learn-toggle");
    var cb = el("input"); cb.type = "checkbox"; cb.checked = !!state.learned[c.id];
    cb.setAttribute("aria-label", "Mark “" + c.title + "” as learned");
    var box = el("span", "learn-toggle__box");
    var ltl = el("span", "learn-toggle__label", state.learned[c.id] ? "Learned" : "Mark as learned");
    cb.addEventListener("change", function () {
      if (cb.checked) state.learned[c.id] = true; else delete state.learned[c.id];
      ltl.textContent = cb.checked ? "Learned" : "Mark as learned";
      saveState();
      syncLibrary();
    });
    lt.appendChild(cb); lt.appendChild(box); lt.appendChild(ltl);
    foot.appendChild(lt);
    foot.appendChild(el("span", "concept__id", "#" + c.id));
    card.appendChild(foot);

    state.lastIndex = current;
    saveState();
    syncLibrary();
  }

  /* ============================================================
     LIBRARY grid + filters
     ============================================================ */
  var activeFilter = "All";
  var todayIndex = 0;

  function renderFilters() {
    var host = $("#filters");
    host.innerHTML = "";
    var a = areas();
    var all = [["All", CORPUS.length]].concat(a.list.map(function (x) { return [x, a.counts[x]]; }));
    all.forEach(function (pair) {
      var b = el("button", "filter");
      b.type = "button";
      b.setAttribute("aria-pressed", pair[0] === activeFilter ? "true" : "false");
      b.appendChild(document.createTextNode(pair[0]));
      b.appendChild(el("span", "filter__n", "(" + pair[1] + ")"));
      b.addEventListener("click", function () {
        activeFilter = pair[0];
        renderFilters();
        renderGrid();
      });
      host.appendChild(b);
    });
  }

  function renderGrid() {
    var grid = $("#conceptGrid");
    grid.innerHTML = "";
    CORPUS.forEach(function (c, i) {
      if (activeFilter !== "All" && c.area !== activeFilter) return;
      var card = el("button", "card");
      card.type = "button";
      card.dataset.id = c.id;
      if (state.learned[c.id]) card.classList.add("is-learned");
      if (i === todayIndex) card.classList.add("is-today");
      card.appendChild(el("span", "card__flag", "Today"));
      var done = el("span", "card__done"); done.setAttribute("aria-hidden", "true");
      card.appendChild(done);
      card.appendChild(el("span", "card__area", c.area));
      card.appendChild(el("span", "card__title", c.title));
      card.appendChild(el("span", "card__big", c.big));
      card.setAttribute("aria-label", c.title + (state.learned[c.id] ? " (learned)" : ""));
      card.addEventListener("click", function () {
        renderConcept(i);
        $("#today").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      grid.appendChild(card);
    });
    var learnedCount = Object.keys(state.learned).length;
    $("#libMeta").textContent = CORPUS.length + " concepts · " + learnedCount + " learned";
  }

  function syncLibrary() {
    $$(".card").forEach(function (card) {
      var id = card.dataset.id;
      card.classList.toggle("is-learned", !!state.learned[id]);
    });
    var learnedCount = Object.keys(state.learned).length;
    var meta = $("#libMeta");
    if (meta) meta.textContent = CORPUS.length + " concepts · " + learnedCount + " learned";
  }

  /* ============================================================
     STREAK — increment once per new calendar day visited
     ============================================================ */
  function updateStreak() {
    var today = dayKey();
    if (state.lastVisit === today) { /* already counted */ }
    else {
      var y = new Date(); y.setDate(y.getDate() - 1);
      var yesterday = dayKey(y);
      if (state.lastVisit === yesterday) state.streak = (state.streak || 0) + 1;
      else state.streak = 1;
      state.lastVisit = today;
      saveState();
    }
    $("#streakCount").textContent = state.streak || 1;
  }

  /* ============================================================
     TODAY's date-seeded pick
     ============================================================ */
  function pickToday() {
    var seed = seedHash(dayKey());
    return seed % CORPUS.length;
  }

  function setTodayLabel() {
    var d = new Date();
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    $("#todayDate").textContent = d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  }

  /* ============================================================
     MASTHEAD plotted-curve signature (grid + a plotted line)
     ============================================================ */
  function renderMasthead() {
    var g = $(".plot__grid");
    var curve = $(".plot__curve");
    var dot = $(".plot__dot");
    if (!g) return;
    var W = 1440, H = 360, NS = "http://www.w3.org/2000/svg";
    var i, x, y;
    // gridlines
    for (i = 0; i <= 12; i++) {
      x = (W / 12) * i;
      var vl = document.createElementNS(NS, "line");
      vl.setAttribute("x1", x); vl.setAttribute("y1", 0); vl.setAttribute("x2", x); vl.setAttribute("y2", H);
      g.appendChild(vl);
    }
    for (i = 0; i <= 6; i++) {
      y = (H / 6) * i;
      var hl = document.createElementNS(NS, "line");
      hl.setAttribute("x1", 0); hl.setAttribute("y1", y); hl.setAttribute("x2", W); hl.setAttribute("y2", y);
      g.appendChild(hl);
    }
    // a gently rising, wobbling plotted curve (an "inflection" of trend)
    var d = "", lastX = 0, lastY = 0;
    for (x = 0; x <= W; x += 12) {
      var t = x / W;
      // rising trend with an inflection dip near the middle
      y = H * (0.78 - 0.5 * t) + Math.sin(t * 7) * 18 + Math.sin(t * 2.3) * 26;
      d += (x === 0 ? "M" : "L") + x + " " + y.toFixed(1) + " ";
      lastX = x; lastY = y;
    }
    curve.setAttribute("d", d);
    // mark the inflection point (~40% across)
    var ix = W * 0.4, it = 0.4;
    var iy = H * (0.78 - 0.5 * it) + Math.sin(it * 7) * 18 + Math.sin(it * 2.3) * 26;
    dot.setAttribute("cx", ix); dot.setAttribute("cy", iy.toFixed(1));
  }

  /* ============================================================
     WIRE UP
     ============================================================ */
  function init() {
    loadState();
    // storage test
    try { localStorage.setItem("inflection:test", "1"); localStorage.removeItem("inflection:test"); }
    catch (e) { storageOk = false; }

    renderMasthead();
    setTodayLabel();
    updateStreak();

    todayIndex = pickToday();
    renderFilters();
    renderGrid();
    renderConcept(todayIndex);

    $("#prevBtn").addEventListener("click", function () { renderConcept(current - 1); });
    $("#nextBtn").addEventListener("click", function () { renderConcept(current + 1); });
    $("#todayBtn").addEventListener("click", function () {
      renderConcept(todayIndex);
      $("#today").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("#shuffleBtn").addEventListener("click", function () {
      var r = current;
      if (CORPUS.length > 1) { while (r === current) r = Math.floor(Math.random() * CORPUS.length); }
      renderConcept(r);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__inflection = Object.assign(window.__inflection || {}, {
    Chart: Chart, slider: slider, statBox: statBox, legend: legend, MODELS: MODELS, CORPUS: CORPUS
  });
})();




