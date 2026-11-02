/* Stage 4/5: landing interactions, tabs, and the animated solving methods
   (brute-force decision tree, memoization grid, space-optimized 1D, race + chart).
   Uses globals from app.js: $, esc, color, model, stopPlay, render */

const Methods = (() => {
  const players = {};
  const data = {};
  let active = "tab";
  const TREE_MAX_N = 5; // largest n for which the decision tree is drawn

  /* ---------- generic step player (Reset/Back/Play/Pause/Next/End) ---------- */

  function mount(id, onChange) {
    const box = $(id + "-controls");
    box.innerHTML =
      `<button data-a="reset">Reset</button><button data-a="back">Step back</button>
       <button data-a="play" class="primary">Play</button><button data-a="pause">Pause</button>
       <button data-a="next">Step forward</button><button data-a="end">Skip to end</button>
       <span class="note"></span>`;
    const q = (a) => box.querySelector(`[data-a="${a}"]`);
    const p = { pos: 0, total: 0, timer: null };
    const stop = () => { clearInterval(p.timer); p.timer = null; };
    const draw = () => {
      q("reset").disabled = q("back").disabled = p.pos === 0;
      q("next").disabled = q("end").disabled = p.pos >= p.total;
      q("play").disabled = !!p.timer || p.total === 0;
      q("pause").disabled = !p.timer;
      box.querySelector(".note").textContent = p.total ? `Step ${p.pos} of ${p.total}` : "";
      onChange(p.pos);
    };
    const go = (n) => { p.pos = Math.max(0, Math.min(p.total, n)); draw(); };
    box.addEventListener("click", (e) => {
      const a = e.target.dataset.a;
      if (!a) return;
      if (a === "play") {
        if (p.pos >= p.total) p.pos = 0;
        stop();
        p.timer = setInterval(() => {
          p.pos++;
          if (p.pos >= p.total) stop();
          draw();
        }, 1100 - Number($("speed").value) * 100);
        draw();
        return;
      }
      stop();
      if (a === "reset") go(0);
      else if (a === "back") go(p.pos - 1);
      else if (a === "next") go(p.pos + 1);
      else if (a === "end") go(p.total);
      else draw();
    });
    p.reset = (total) => { stop(); p.total = total; p.pos = 0; draw(); };
    p.stop = stop;
    p.refresh = draw;
    return p;
  }

  /* ---------- shared recursion helpers ---------- */

  // Calls made by the plain recursion f(i, w) (cheap, no log)
  function countCalls(its, W) {
    let c = 0;
    (function f(i, w) {
      c++;
      if (i === 0) return;
      f(i - 1, w);
      if (its[i - 1].weight <= w) f(i - 1, w - its[i - 1].weight);
    })(its.length, W);
    return c;
  }

  // Memoized recursion, recording events for the animation
  function traceMemo(its, W) {
    const ev = [], cache = new Map();
    let calls = 0;
    function f(i, w) {
      calls++;
      if (i === 0) { ev.push({ t: "base", i, w, val: 0 }); return 0; }
      const key = i + "," + w;
      if (cache.has(key)) { ev.push({ t: "hit", i, w, val: cache.get(key) }); return cache.get(key); }
      const it = its[i - 1];
      ev.push({ t: "call", i, w, big: it.weight > w });
      const best = it.weight > w ? f(i - 1, w) : Math.max(f(i - 1, w), it.value + f(i - 1, w - it.weight));
      cache.set(key, best);
      ev.push({ t: "ret", i, w, val: best });
      return best;
    }
    const result = f(its.length, W);
    return { ev, calls, result, cells: cache.size };
  }

  const itemLabel = (it) => `${it.name} (w=${it.weight}, v=${it.value})`;

  /* ---------- brute force: animated decision tree ---------- */

  // Nodes in depth-first (preorder) order. Node = state of f(i, w) plus value collected so far.
  function buildTree(its, W) {
    const nodes = [];
    const add = (o) => { o.id = nodes.length; o.kids = []; nodes.push(o); return o; };
    function go(i, w, val, parent, kind) {
      const nd = add({ i, w, val, parent, kind, ghost: false });
      if (i > 0) {
        const it = its[i - 1];
        nd.kids.push(go(i - 1, w, val, nd.id, "skip").id);
        if (it.weight <= w) nd.kids.push(go(i - 1, w - it.weight, val + it.value, nd.id, "take").id);
        else nd.kids.push(add({ i: i - 1, w: w - it.weight, val: val + it.value, parent: nd.id, kind: "take", ghost: true }).id);
      }
      return nd;
    }
    go(its.length, W, 0, -1, "root");

    const GX = 40, GY = 58, LEFT = 150, TOP = 36;
    let leaf = 0;
    (function lay(id) {
      const nd = nodes[id];
      if (!nd.kids.length) nd.x = LEFT + leaf++ * GX;
      else { nd.kids.forEach(lay); nd.x = (nodes[nd.kids[0]].x + nodes[nd.kids[nd.kids.length - 1]].x) / 2; }
      nd.y = TOP + (its.length - nd.i) * GY;
    })(0);

    let best = -1, bestId = -1;
    const bestAt = nodes.map((nd) => {
      if (!nd.ghost && nd.i === 0 && nd.val > best) { best = nd.val; bestId = nd.id; }
      return best;
    });
    return { nodes, best, bestId, bestAt, calls: nodes.filter((x) => !x.ghost).length,
             width: LEFT + leaf * GX + 20, height: TOP + its.length * GY + 30 };
  }

  const pathTo = (d, nd) => {
    const out = [];
    for (let c = nd; c; c = c.parent >= 0 ? d.nodes[c.parent] : null) out.unshift(c);
    return out;
  };

  function drawBrute(pos) {
    if (!model) return;
    const its = model.items, n = its.length, W = model.W, d = data.brute;
    const tree = $("brute-tree");
    if (!d) {
      tree.innerHTML = ""; $("brute-chips").innerHTML = ""; $("brute-bag").innerHTML = "";
      $("brute-explain").textContent = `With ${n} items the tree is too big to draw. Use ${TREE_MAX_N} or fewer items to watch it grow.`;
      $("brute-stats").innerHTML = data.bruteCalls === null
        ? `<strong>Brute force skipped:</strong> n = ${n} means up to 2<sup>${n}</sup> bags.`
        : `<strong>Calls the recursion would make:</strong> ${data.bruteCalls.toLocaleString()} (up to 2<sup>${n}</sup> bags). The DP table needs only ${n * (W + 1)} cells.`;
      return;
    }

    const cur = pos > 0 ? d.nodes[pos - 1] : null;
    const finished = pos === d.nodes.length;
    const path = cur ? pathTo(d, cur) : [];
    const onPath = new Set(path.map((x) => x.id));
    const win = new Set(finished ? pathTo(d, d.nodes[d.bestId]).map((x) => x.id) : []);

    // SVG tree: only nodes visited so far are drawn
    let svg = `<svg viewBox="0 0 ${d.width} ${d.height}" width="${d.width}" height="${d.height}" role="img" aria-label="Decision tree of take or skip choices">`;
    for (let r = 0; r <= n; r++) {
      svg += `<text class="rowlab" x="8" y="${36 + r * 58 + 4}">${r < n ? `Item ${n - r}: ${esc(its[n - r - 1].name)}` : "Bag complete"}</text>`;
    }
    const seen = d.nodes.slice(0, pos);
    seen.forEach((nd) => {
      if (nd.parent < 0) return;
      const par = d.nodes[nd.parent];
      const cls = ["edge", nd.kind, onPath.has(nd.id) ? "path" : "", win.has(nd.id) ? "win" : ""].join(" ");
      svg += `<line class="${cls}" x1="${par.x}" y1="${par.y}" x2="${nd.x}" y2="${nd.y}"/>`;
    });
    seen.forEach((nd) => {
      const cls = ["tn", nd.ghost ? "ghost" : "", cur && nd.id === cur.id ? "cur" : onPath.has(nd.id) ? "onpath" : "", win.has(nd.id) ? "win" : ""].join(" ");
      const tip = nd.ghost ? `Too heavy: the bag would weigh ${W - nd.w} but holds only ${W}` : `Bag weight ${W - nd.w} of ${W}, value ${nd.val}`;
      svg += `<g class="${cls}"><title>${tip}</title><circle cx="${nd.x}" cy="${nd.y}" r="14"/><text x="${nd.x}" y="${nd.y + 4}" text-anchor="middle">${nd.ghost ? "&#10007;" : nd.val}</text></g>`;
    });
    tree.innerHTML = svg + "</svg>";

    // item chips: status of every item along the current path
    const status = {};
    path.forEach((nd) => { if (nd.parent >= 0) status[d.nodes[nd.parent].i] = nd.ghost ? "heavy" : nd.kind === "take" ? "taken" : "skip"; });
    const words = { taken: "in the bag", skip: "left out", heavy: "too heavy", open: "undecided" };
    $("brute-chips").innerHTML = its.map((it, k) => {
      const s = status[k + 1] || "open";
      return `<span class="ichip ${s}" style="--c:${color(k)}">${esc(it.name)} w${it.weight} v${it.value}<em>${words[s]}</em></span>`;
    }).join("");

    // bag meter for the current partial bag (a ghost node is not a real bag, so show its parent's)
    const real = cur && cur.ghost ? d.nodes[cur.parent] : cur;
    const takenIdx = real ? pathTo(d, real).filter((x) => x.kind === "take").map((x) => d.nodes[x.parent].i - 1) : [];
    const segs = takenIdx.map((k) => `<span class="seg" style="width:${its[k].weight / W * 100}%;background:${color(k)}">${esc(its[k].name)}</span>`).join("");
    $("brute-bag").innerHTML = `<div class="bagbar">${segs}</div><p class="note">Bag: weight ${real ? W - real.w : 0} of ${W}, value ${real ? real.val : 0}</p>`;

    // plain-English caption
    let t;
    if (!cur) t = "Start with an empty bag. For every item we will try both options: skip it or take it. Press Play.";
    else if (cur.parent < 0) t = `Empty bag. First decision: item ${n} (${its[n - 1].name}). Skip it, or take it?`;
    else {
      const it = its[d.nodes[cur.parent].i - 1];
      if (cur.ghost) t = `Try taking ${it.name} (w=${it.weight}): the bag would weigh ${W - cur.w} but only holds ${W}. Too heavy, so this branch is cut off and we backtrack.`;
      else if (cur.kind === "skip") t = `Skip ${it.name}. The bag stays at weight ${W - cur.w}, value ${cur.val}.`;
      else t = `Take ${it.name} (w=${it.weight}, v=${it.value}). The bag now weighs ${W - cur.w} and is worth ${cur.val}.`;
      if (cur.i === 0 && !cur.ghost) {
        const isNew = cur.val === d.bestAt[pos - 1] && (pos < 2 || cur.val > d.bestAt[pos - 2]);
        t += ` Every item is decided, so this bag is worth ${cur.val}. ` + (isNew ? "New best bag!" : `Best so far: ${d.bestAt[pos - 1]}.`);
      }
    }
    $("brute-explain").textContent = t;
    const calls = seen.filter((x) => !x.ghost).length;
    $("brute-stats").innerHTML = `<strong>Calls so far:</strong> ${calls} of ${d.calls} &nbsp;|&nbsp; <strong>Best bag so far:</strong> ${Math.max(0, d.bestAt[pos - 1] ?? 0)}` +
      (finished ? `<br><strong>Answer: ${d.best}.</strong> The winning path is highlighted in orange. Brute force made ${d.calls} calls; the DP table needs only ${n * (W + 1)} cells, and the gap explodes as n grows (see the Race tab).` : "");
  }

  /* ---------- memoization: solving grid with a call trail ---------- */

  function drawMemo(pos) {
    if (!model || !data.memo) return;
    const its = model.items, n = its.length, W = model.W, d = data.memo;
    const shown = d.ev.slice(0, pos);
    const cur = shown[shown.length - 1];
    const finished = pos === d.ev.length;

    const stack = [], filled = new Map();
    let calls = 0, hits = 0;
    shown.forEach((e) => {
      if (e.t !== "ret") calls++;
      if (e.t === "hit") hits++;
      if (e.t === "call") stack.push(e);
      if (e.t === "ret") { stack.pop(); filled.set(`${e.i},${e.w}`, e.val); }
      if (e.t === "base") filled.set(`0,${e.w}`, 0);
    });
    const onStack = new Set(stack.map((e) => `${e.i},${e.w}`));

    let html = "<thead><tr><th>i \\ w</th>";
    for (let w = 0; w <= W; w++) html += `<th>${w}</th>`;
    html += "</tr></thead><tbody>";
    for (let i = 0; i <= n; i++) {
      html += `<tr><th class="rowhead">${i === 0 ? "0 (no items)" : `${i} (${esc(its[i - 1].name)})`}</th>`;
      for (let w = 0; w <= W; w++) {
        const k = `${i},${w}`;
        let cls = "", txt = filled.has(k) ? filled.get(k) : "";
        if (onStack.has(k)) { cls = "onstack"; if (txt === "") txt = "?"; }
        else if (finished && txt === "") { cls = "untouched"; txt = "-"; }
        if (cur && cur.i === i && cur.w === w) { cls = cur.t === "hit" ? "hit" : "current"; txt = cur.t === "call" ? "?" : cur.val; }
        html += `<td${cls ? ` class="${cls}"` : ""}>${txt}</td>`;
      }
      html += "</tr>";
    }
    $("memo-table").innerHTML = html + "</tbody>";

    $("memo-crumbs").innerHTML = stack.length
      ? stack.map((e, k) => `<span class="crumb${k === stack.length - 1 ? " last" : ""}">dp[${e.i}][${e.w}]</span>`).join('<span class="arrow">&rarr;</span>')
      : '<span class="note">(no question waiting)</span>';

    let t;
    if (!cur) t = `We want dp[${n}][${W}]. Instead of filling every cell, ask only for what is needed, and remember every answer. Press Play.`;
    else {
      const it = cur.i > 0 ? its[cur.i - 1] : null;
      if (cur.t === "call") t = `Need dp[${cur.i}][${cur.w}]. ` + (cur.big
        ? `${it.name} is too heavy for capacity ${cur.w}, so ask the smaller question dp[${cur.i - 1}][${cur.w}].`
        : `${it.name} fits, so compare leaving it out, dp[${cur.i - 1}][${cur.w}], with taking it, ${it.value} + dp[${cur.i - 1}][${cur.w - it.weight}].`);
      else if (cur.t === "hit") t = `Already solved dp[${cur.i}][${cur.w}] = ${cur.val} earlier. Reuse it instantly, no new work!`;
      else if (cur.t === "base") t = `dp[0][${cur.w}] = 0: with no items there is nothing to gain.`;
      else t = `Solved dp[${cur.i}][${cur.w}] = ${cur.val}. Saved in the cache for later.`;
    }
    $("memo-explain").textContent = t;

    let s = `<strong>Calls so far:</strong> ${calls} of ${d.calls} &nbsp;|&nbsp; <strong>Answers reused from cache:</strong> ${hits}`;
    if (finished) {
      s += ` &nbsp;|&nbsp; <strong>Answer:</strong> ${d.result}<br>Plain recursion would make ${data.bruteCalls === null ? "an enormous number of" : data.bruteCalls.toLocaleString()} calls; memoization made ${d.calls}. Only ${d.cells} of the ${n * (W + 1)} table cells were ever needed.`;
      if (data.bruteCalls === d.calls) s += `<br>No sub-problem repeated on this input, so the cache saved nothing. Try the "Repeated sub-problems" preset.`;
    }
    $("memo-stats").innerHTML = s;
  }

  /* ---------- space-optimized 1D array ---------- */

  function build1D() {
    const its = model.items, W = model.W;
    const forward = $("oned-dir").value === "fwd";
    const arr = new Array(W + 1).fill(0);
    const steps = [];
    its.forEach((it, k) => {
      if (it.weight > W) { steps.push({ k, none: true, snap: arr.slice() }); return; }
      const ws = [];
      for (let w = it.weight; w <= W; w++) ws.push(w);
      if (!forward) ws.reverse();
      ws.forEach((w) => {
        const before = arr[w], from = w - it.weight, cand = arr[from] + it.value;
        arr[w] = Math.max(before, cand);
        steps.push({ k, w, from, before, cand, now: arr[w], reused: forward && from >= it.weight, snap: arr.slice() });
      });
    });
    data.oned = { steps, final: arr[W] };
    players.oned.reset(steps.length);
  }

  function draw1D(pos) {
    if (!model || !data.oned) return;
    const { steps, final } = data.oned;
    const its = model.items, W = model.W;
    const cur = pos > 0 ? steps[pos - 1] : null;
    const snap = cur ? cur.snap : new Array(W + 1).fill(0);
    const touched = new Set();
    if (cur) steps.slice(0, pos).forEach((s) => { if (s.k === cur.k && !s.none) touched.add(s.w); });

    $("oned-items").innerHTML = its.map((it, k) => {
      const s = !cur ? "open" : k === cur.k ? (pos === steps.length ? "done" : "now") : k < cur.k ? "done" : "open";
      return `<span class="ichip ${s}" style="--c:${color(k)}">${esc(it.name)} w${it.weight} v${it.value}</span>`;
    }).join("");

    let head = '<tr><th class="rowhead">capacity w</th>', row = '<tr><th class="rowhead">dp[w]</th>';
    for (let w = 0; w <= W; w++) {
      let cls = "";
      if (cur && !cur.none && cur.w === w) cls = "current";
      else if (cur && !cur.none && cur.from === w) cls = "reads";
      else if (touched.has(w)) cls = "touched";
      head += `<th>${w}</th>`;
      row += `<td${cls ? ` class="${cls}"` : ""}>${snap[w]}</td>`;
    }
    $("oned-array").innerHTML = head + "</tr>" + row + "</tr>";

    let text;
    if (!cur) text = "One array, W+1 cells, all zero: with no items every capacity is worth 0. Each item sweeps across it once.";
    else {
      const it = its[cur.k];
      if (cur.none) text = `${it.name} weighs ${it.weight}, more than the capacity ${W}, so it never fits. Array unchanged.`;
      else {
        text = `${itemLabel(it)} at w=${cur.w}: keep ${cur.before}, or take ${it.name} and add its ${it.value} to dp[${cur.from}] = ${cur.cand - it.value} for ${cur.cand}. Best is ${cur.now}.`;
        if (cur.reused) text += ` Warning: dp[${cur.from}] was already updated for this same item, so it is being counted twice!`;
      }
    }
    $("oned-explain").textContent = text;

    const correct = model.dp[its.length][W];
    $("oned-verdict").innerHTML = pos === steps.length
      ? (final === correct
          ? `<strong>Final answer dp[${W}] = ${final}</strong>, matching the table method. Space used: ${W + 1} cells instead of ${(its.length + 1) * (W + 1)}.${$("oned-dir").value === "fwd" ? " Forward happened to match here; the 'Greedy fails' preset shows it going wrong." : ""}`
          : `<strong>Final answer dp[${W}] = ${final}, but the correct answer is ${correct}.</strong> Looping forward lets an item be reused, which solves the unbounded knapsack instead.`)
      : "";
  }

  /* ---------- race: real runs of all four methods + growth chart ---------- */

  const timeIt = (fn, reps) => {
    const t0 = performance.now();
    let r;
    for (let k = 0; k < reps; k++) r = fn();
    return { r, ms: (performance.now() - t0) / reps };
  };

  function runners(its, W) {
    const n = its.length;
    return {
      brute: () => {
        let ops = 0;
        const f = (i, w) => { ops++; if (i === 0) return 0; const it = its[i - 1]; const a = f(i - 1, w); return it.weight <= w ? Math.max(a, it.value + f(i - 1, w - it.weight)) : a; };
        return { answer: f(n, W), ops, mem: n };
      },
      memo: () => {
        const c = new Map(); let ops = 0;
        const f = (i, w) => {
          ops++; if (i === 0) return 0;
          const k = i * 1000 + w; if (c.has(k)) return c.get(k);
          const it = its[i - 1];
          const v = it.weight <= w ? Math.max(f(i - 1, w), it.value + f(i - 1, w - it.weight)) : f(i - 1, w);
          c.set(k, v); return v;
        };
        return { answer: f(n, W), ops, mem: c.size };
      },
      tab: () => {
        const dp = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(0));
        let ops = 0;
        for (let i = 1; i <= n; i++) for (let w = 0; w <= W; w++) {
          ops++; const it = its[i - 1];
          dp[i][w] = it.weight <= w ? Math.max(dp[i - 1][w], dp[i - 1][w - it.weight] + it.value) : dp[i - 1][w];
        }
        return { answer: dp[n][W], ops, mem: (n + 1) * (W + 1) };
      },
      oned: () => {
        const a = new Array(W + 1).fill(0); let ops = 0;
        its.forEach((it) => { for (let w = W; w >= it.weight; w--) { ops++; a[w] = Math.max(a[w], a[w - it.weight] + it.value); } });
        return { answer: a[W], ops, mem: W + 1 };
      }
    };
  }

  function drawRace() {
    if (!model) return;
    const its = model.items, W = model.W, n = its.length;
    const run = runners(its, W);
    const rows = [["Brute force", "brute", 1], ["Memoization", "memo", 30], ["Tabulation", "tab", 30], ["Space-optimized", "oned", 30]];
    const res = rows.map(([name, key, reps]) => {
      if (key === "brute" && n > 20) return { name, skipped: true };
      const t = timeIt(run[key], reps);
      return { name, ...t.r, ms: t.ms };
    });
    const maxOps = Math.max(...res.filter((r) => !r.skipped).map((r) => r.ops));
    const ms = (v) => (v < 0.001 ? "<0.001" : v.toFixed(3));
    let html = "<thead><tr><th>Method</th><th>Answer</th><th>Operations</th><th>Memory (cells)</th><th>Time (ms)</th><th>Operations (log scale)</th></tr></thead><tbody>";
    res.forEach((r, k) => {
      if (r.skipped) { html += `<tr><th class="rowhead">${r.name}</th><td colspan="5">skipped: n = ${n} is too large (2<sup>${n}</sup> bags)</td></tr>`; return; }
      const width = (Math.log10(r.ops + 1) / Math.log10(maxOps + 1)) * 100;
      html += `<tr class="${k === 0 ? "slow" : ""}"><th class="rowhead">${r.name}</th><td>${r.answer}</td><td>${r.ops.toLocaleString()}</td><td>${r.mem.toLocaleString()}</td><td>${ms(r.ms)}</td>` +
              `<td><div class="rbar"><span data-w="${width.toFixed(1)}"></span></div></td></tr>`;
    });
    $("race-table").innerHTML = html + "</tbody>";
    requestAnimationFrame(() => requestAnimationFrame(() =>
      $("race-table").querySelectorAll("[data-w]").forEach((s) => { s.style.width = s.dataset.w + "%"; })));

    const b = res[0], t = res[2], o = res[3];
    $("race-note").innerHTML = b.skipped
      ? `All DP methods agree on ${t.answer}. Brute force was skipped because it would try up to 2<sup>${n}</sup> bags.`
      : `All four agree on <strong>${t.answer}</strong>. Brute force needed ${b.ops.toLocaleString()} operations; tabulation needed ${t.ops.toLocaleString()}. ` +
        `The space-optimized version does the same work as tabulation but stores ${o.mem} cells instead of ${t.mem}. Memoization only solves what it needs, using ${res[1].ops} calls.`;
    drawChart(W, n);
  }

  function drawChart(W, n) {
    const NMAX = 24, w = 640, h = 300, l = 60, r = 20, t = 16, b = 44, maxE = 8;
    const X = (k) => l + ((k - 1) / (NMAX - 1)) * (w - l - r);
    const Y = (v) => t + (1 - Math.log10(Math.max(v, 1)) / maxE) * (h - t - b);
    const labels = ["1", "10", "100", "1K", "10K", "100K", "1M", "10M", "100M"];
    let svg = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Operations versus number of items, log scale">`;
    for (let e = 0; e <= maxE; e++) {
      svg += `<line class="grid-line" x1="${l}" x2="${w - r}" y1="${Y(10 ** e)}" y2="${Y(10 ** e)}"/><text x="${l - 6}" y="${Y(10 ** e) + 4}" text-anchor="end">${labels[e]}</text>`;
    }
    for (let k = 2; k <= NMAX; k += 2) svg += `<text x="${X(k)}" y="${h - b + 16}" text-anchor="middle">${k}</text>`;
    svg += `<text x="${(l + w - r) / 2}" y="${h - 6}" text-anchor="middle">number of items (n)</text>`;
    const pts = (fn) => Array.from({ length: NMAX }, (_, i) => `${X(i + 1)},${Y(fn(i + 1))}`).join(" ");
    svg += `<polyline class="s-brute" points="${pts((k) => 2 ** (k + 1) - 1)}"/><polyline class="s-dp" points="${pts((k) => k * (W + 1))}"/>`;
    if (n <= NMAX) {
      svg += `<line x1="${X(n)}" x2="${X(n)}" y1="${t}" y2="${h - b}" stroke="currentColor" stroke-dasharray="4 4" opacity="0.5"/><text x="${X(n) + 4}" y="${t + 12}">your n = ${n}</text>`;
    }
    svg += `<text x="${w - r - 150}" y="${Y(20)}" style="fill:var(--accent2);font-weight:700">brute force: 2^n</text><text x="${w - r - 150}" y="${Y(6)}" style="fill:var(--accent);font-weight:700">DP: n x W</text></svg>`;
    $("race-chart").innerHTML = svg;
    $("chart-note").textContent = `Operations needed as the number of items grows (capacity W = ${W}). The vertical axis is logarithmic: each gridline is 10 times higher than the one below.`;
  }

  /* ---------- tabs, landing buttons, setup ---------- */

  function stopAll() {
    stopPlay();
    Object.values(players).forEach((p) => p.stop());
  }

  function showView(v) {
    stopAll();
    active = v;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    document.querySelectorAll(".view").forEach((el) => { el.hidden = el.id !== "view-" + v; });
    Object.values(players).forEach((p) => p.refresh());
    if (model) {
      render();
      if (v === "race") drawRace();
    }
  }

  function setup(m) {
    const its = m.items, W = m.W, n = its.length;
    stopAll();
    $("views").hidden = false;
    $("views-hint").hidden = true;
    data.bruteCalls = n <= 20 ? countCalls(its, W) : null;
    data.brute = n <= TREE_MAX_N ? buildTree(its, W) : null;
    data.memo = traceMemo(its, W);
    players.brute.reset(data.brute ? data.brute.nodes.length : 0);
    players.memo.reset(data.memo.ev.length);
    build1D();
    showView(active);
  }

  players.brute = mount("brute", drawBrute);
  players.memo = mount("memo", drawMemo);
  players.oned = mount("oned", draw1D);

  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  $("oned-dir").addEventListener("change", () => { if (model) build1D(); });
  $("start-btn").addEventListener("click", () => $("solver").scrollIntoView());

  return { setup, showView };
})();

// "Try it" buttons on the landing page: jump to the solver and open that method
document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => {
  Methods.showView(b.dataset.go);
  $("solver").scrollIntoView();
}));
