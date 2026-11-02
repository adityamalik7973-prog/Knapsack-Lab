/* 0/1 Knapsack Visualizer - Stages 1-4: input, fill animation, backtracking, greedy comparison */

const $ = (id) => document.getElementById(id);
const MAX_ITEMS = 10;
const MAX_CAP = 30;

let items = []; // { name, weight, value }

const color = (i) => `hsl(${(i * 57 + 20) % 360} 55% 40%)`;

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const PRESETS = {
  basic: { cap: 7, items: [["Item 1", 1, 1], ["Item 2", 3, 4], ["Item 3", 4, 5], ["Item 4", 5, 7]] },
  greedy: { cap: 5, items: [["A", 1, 6], ["B", 2, 10], ["C", 3, 12]] },
  memo: { cap: 10, items: [["A", 2, 3], ["B", 2, 4], ["C", 3, 5], ["D", 3, 6], ["E", 4, 7]] }
};

/* ---------- Input handling ---------- */

function loadItems(list) {
  items = list.map(([name, weight, value]) => ({ name, weight, value }));
  renderItems();
}

function renderItems() {
  const tbody = $("items-table").querySelector("tbody");
  tbody.innerHTML = "";
  items.forEach((it, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td><span class="dot" style="background:${color(i)}"></span>${i + 1}</td>
       <td><input type="text" value="${esc(it.name)}" data-i="${i}" data-f="name"></td>
       <td><input type="number" min="1" value="${it.weight}" data-i="${i}" data-f="weight"></td>
       <td><input type="number" min="0" value="${it.value}" data-i="${i}" data-f="value"></td>
       <td><button type="button" data-remove="${i}">Remove</button></td>`;
    tbody.appendChild(tr);
  });
}

$("items-table").addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.f === undefined) return;
  const i = Number(t.dataset.i);
  items[i][t.dataset.f] = t.dataset.f === "name" ? t.value : Number(t.value);
});

$("items-table").addEventListener("click", (e) => {
  if (e.target.dataset.remove === undefined) return;
  items.splice(Number(e.target.dataset.remove), 1);
  renderItems();
});

$("add-btn").addEventListener("click", () => {
  if (items.length >= MAX_ITEMS) return showMessage(`Maximum ${MAX_ITEMS} items.`);
  items.push({ name: `Item ${items.length + 1}`, weight: 1, value: 1 });
  renderItems();
  showMessage("");
});

$("random-btn").addEventListener("click", () => {
  const n = 4 + Math.floor(Math.random() * 3);
  const cap = 8 + Math.floor(Math.random() * 8);
  $("capacity").value = cap;
  loadItems(Array.from({ length: n }, (_, i) => [
    `Item ${i + 1}`,
    1 + Math.floor(Math.random() * 8),
    5 + Math.floor(Math.random() * 46)
  ]));
  showMessage("");
});

$("preset").addEventListener("change", (e) => {
  const p = PRESETS[e.target.value];
  if (!p) return;
  $("capacity").value = p.cap;
  loadItems(p.items);
  showMessage("");
});

function showMessage(text) {
  $("message").textContent = text;
}

/* ---------- DP algorithm ---------- */

// dp[i][w] = best value using first i items with capacity w
function buildDP(items, W) {
  const n = items.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const { weight, value } = items[i - 1];
    for (let w = 0; w <= W; w++) {
      dp[i][w] = dp[i - 1][w]; // skip item i
      if (weight <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - weight] + value); // take item i
      }
    }
  }
  return dp;
}

// Walk back from dp[n][W] to find which items were taken
function backtrack(dp, items, W) {
  const chosen = [];
  let w = W;
  for (let i = items.length; i >= 1; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      chosen.push(i - 1);
      w -= items[i - 1].weight;
    }
  }
  return chosen.reverse();
}

/* ---------- Validation and solve ---------- */

function validate(W) {
  if (!Number.isInteger(W) || W < 1 || W > MAX_CAP) return `Capacity must be a whole number from 1 to ${MAX_CAP}.`;
  if (items.length === 0) return "Add at least one item.";
  for (const it of items) {
    if (!Number.isInteger(it.weight) || it.weight < 1) return "Every weight must be a whole number of at least 1.";
    if (!Number.isInteger(it.value) || it.value < 0) return "Every value must be a whole number of at least 0.";
  }
  return "";
}

$("solve-btn").addEventListener("click", () => {
  const W = Number($("capacity").value);
  const error = validate(W);
  showMessage(error);
  if (error) return;

  stopPlay();
  const dp = buildDP(items, W);
  model = {
    dp, W,
    items: items.map((it) => ({ ...it })), // snapshot so edits don't disturb the animation
    chosen: backtrack(dp, items, W),
    steps: buildSteps(dp, items, W),
    back: buildBack(dp, items, W)
  };
  pos = 0;
  bpos = 0;
  $("table-panel").hidden = false;
  render();
  Methods.setup(model);
});

/* ---------- Stage 2: animation state ---------- */

let model = null; // { dp, W, items, chosen, steps }
let pos = 0;      // number of steps applied so far (0..steps.length)
let timer = null;
let bpos = 0;     // backtracking steps shown so far (0..n)
let btimer = null;

// One step = filling one cell dp[i][w], in row-by-row order
function buildSteps(dp, items, W) {
  const steps = [];
  for (let i = 1; i <= items.length; i++) {
    const { weight, value } = items[i - 1];
    for (let w = 0; w <= W; w++) {
      const fits = weight <= w;
      steps.push({
        i, w, fits,
        skip: dp[i - 1][w],
        take: fits ? dp[i - 1][w - weight] + value : null,
        takeFrom: fits ? w - weight : null,
        result: dp[i][w]
      });
    }
  }
  return steps;
}

function stopPlay() {
  clearInterval(timer);
  clearInterval(btimer);
  timer = null;
  btimer = null;
}

function startPlay() {
  if (!model || timer) return;
  if (pos >= model.steps.length) pos = 0;
  const delay = 1100 - Number($("speed").value) * 100;
  timer = setInterval(() => {
    if (pos >= model.steps.length) return stopPlay(), render();
    pos++;
    render();
    if (pos >= model.steps.length) stopPlay();
  }, delay);
  render();
}

$("play-btn").addEventListener("click", startPlay);
$("pause-btn").addEventListener("click", () => { stopPlay(); render(); });
$("next-btn").addEventListener("click", () => {
  stopPlay();
  if (model && pos < model.steps.length) pos++;
  render();
});
$("prev-btn").addEventListener("click", () => {
  stopPlay();
  if (pos > 0) pos--;
  render();
});
$("reset-btn").addEventListener("click", () => { stopPlay(); pos = 0; render(); });
$("end-btn").addEventListener("click", () => {
  stopPlay();
  if (model) pos = model.steps.length;
  render();
});
$("speed").addEventListener("input", () => {
  if (timer) { stopPlay(); startPlay(); } // restart with the new speed
});

/* ---------- Stage 3: backtracking ---------- */

// Walk from dp[n][W] up to row 0; one step per item row
function buildBack(dp, items, W) {
  const steps = [];
  let w = W;
  for (let i = items.length; i >= 1; i--) {
    const taken = dp[i][w] !== dp[i - 1][w];
    steps.push({ i, w, here: dp[i][w], above: dp[i - 1][w], taken, newW: taken ? w - items[i - 1].weight : w });
    if (taken) w -= items[i - 1].weight;
  }
  return { steps, finalW: w };
}

function startBackAuto() {
  if (!model || btimer) return;
  const total = model.back.steps.length;
  if (bpos >= total) bpos = 0;
  btimer = setInterval(() => {
    bpos++;
    if (bpos >= total) stopPlay();
    render();
  }, 1100 - Number($("speed").value) * 100);
  render();
}

$("bstep-btn").addEventListener("click", () => {
  stopPlay();
  if (model && bpos < model.back.steps.length) bpos++;
  render();
});
$("bauto-btn").addEventListener("click", startBackAuto);
$("bpause-btn").addEventListener("click", () => { stopPlay(); render(); });
$("breset-btn").addEventListener("click", () => { stopPlay(); bpos = 0; render(); });

/* ---------- Stage 3: greedy comparison ---------- */

// Greedy by value/weight ratio (highest first), take an item if it still fits
function runGreedy(its, W) {
  const order = its
    .map((it, idx) => ({ ...it, idx, ratio: it.value / it.weight }))
    .sort((a, b) => b.ratio - a.ratio || a.idx - b.idx);
  let wt = 0, val = 0;
  const rows = order.map((it) => {
    const take = wt + it.weight <= W;
    if (take) { wt += it.weight; val += it.value; }
    return { ...it, take, wt, val };
  });
  return { rows, wt, val };
}

function renderGreedy(its, W, dpValue) {
  const g = runGreedy(its, W);
  let html = "<thead><tr><th>Item</th><th>Weight</th><th>Value</th><th>Value / weight</th><th>Decision</th><th>Total weight</th><th>Total value</th></tr></thead><tbody>";
  g.rows.forEach((r) => {
    html += `<tr><td>${esc(r.name)}</td><td>${r.weight}</td><td>${r.value}</td><td>${r.ratio.toFixed(2)}</td>` +
            `<td>${r.take ? "Taken" : "Skipped (does not fit)"}</td><td>${r.wt}</td><td>${r.val}</td></tr>`;
  });
  html += "</tbody>";
  $("greedy-table").innerHTML = html;
  $("greedy-verdict").innerHTML = g.val < dpValue
    ? `<strong>Greedy gets ${g.val}, but DP gets ${dpValue}.</strong> Greedy is worse by ${dpValue - g.val} on this input, so the greedy choice is not safe for 0/1 knapsack.`
    : `<strong>Greedy and DP both get ${dpValue}</strong> on this input. Try the "Greedy fails example" preset to see greedy lose.`;
}

/* ---------- Rendering ---------- */

function render() {
  if (!model) return;
  const { dp, W, items: its, chosen, steps, back } = model;
  const n = its.length;
  const done = pos === steps.length;
  if (!done) bpos = 0;
  const bs = back.steps;
  const bcur = bpos > 0 ? bs[bpos - 1] : null;
  const cur = pos > 0 && !bcur ? steps[pos - 1] : null; // fill highlights pause while backtracking

  const path = new Set();
  for (let k = 0; k < bpos; k++) path.add(`${bs[k].i},${bs[k].w}`);
  if (bpos === bs.length) path.add(`0,${back.finalW}`);

  // DP table: cells appear as their step is reached
  let html = "<thead><tr><th>i \\ w</th>";
  for (let w = 0; w <= W; w++) html += `<th>${w}</th>`;
  html += "</tr></thead><tbody>";
  for (let i = 0; i <= n; i++) {
    const label = i === 0 ? "0 (no items)" : `${i} (${esc(its[i - 1].name)}, w=${its[i - 1].weight}, v=${its[i - 1].value})`;
    html += `<tr><th class="rowhead">${label}</th>`;
    for (let w = 0; w <= W; w++) {
      const filled = i === 0 || (i - 1) * (W + 1) + w < pos;
      const classes = [];
      if (cur && cur.i === i && cur.w === w) classes.push("current");
      if (cur && i === cur.i - 1 && (w === cur.w || (cur.fits && w === cur.takeFrom))) classes.push("reads");
      if (bcur && bcur.i === i && bcur.w === w) classes.push("bcurrent");
      if (bcur && i === bcur.i - 1 && w === bcur.w) classes.push("reads");
      if (path.has(`${i},${w}`)) classes.push("path");
      if (done && i === n && w === W) classes.push("answer");
      html += `<td${classes.length ? ` class="${classes.join(" ")}"` : ""}>${filled ? dp[i][w] : ""}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody>";
  $("dp-table").innerHTML = html;

  // Fill explanation line
  let text;
  if (pos === 0) {
    text = "Row 0 is all zeros (no items). Press Play or Step forward to fill the table.";
  } else if (done && bcur) {
    text = "Table complete. See the backtracking panel below.";
  } else {
    const c = steps[pos - 1];
    const it = its[c.i - 1];
    const head = `Item ${c.i} (${it.name}, w=${it.weight}, v=${it.value}), capacity ${c.w}: `;
    if (!c.fits) {
      text = head + `weight ${it.weight} > ${c.w}, so it cannot fit. Copy dp[${c.i - 1}][${c.w}] = ${c.skip}.`;
    } else {
      text = head + `fits. max(skip = dp[${c.i - 1}][${c.w}] = ${c.skip}, ` +
        `take = dp[${c.i - 1}][${c.takeFrom}] + ${it.value} = ${c.take - it.value} + ${it.value} = ${c.take}) = ${c.result} (${c.take > c.skip ? "take it" : "skip it"}).`;
    }
  }
  $("explain").textContent = text;
  $("step-count").textContent = `Step ${pos} of ${steps.length}`;

  $("prev-btn").disabled = pos === 0;
  $("reset-btn").disabled = pos === 0;
  $("next-btn").disabled = done;
  $("end-btn").disabled = done;
  $("play-btn").disabled = !!timer || !!btimer;
  $("pause-btn").disabled = !timer;

  // Backtracking panel
  let btext;
  if (!bcur) {
    btext = `Start at the answer cell dp[${n}][${W}] = ${dp[n][W]}. Press Step or Auto to trace which items were taken.`;
  } else {
    const it = its[bcur.i - 1];
    btext = `At dp[${bcur.i}][${bcur.w}] = ${bcur.here}. The cell above, dp[${bcur.i - 1}][${bcur.w}], is ${bcur.above}. ` +
      (bcur.taken
        ? `They differ, so item ${bcur.i} (${it.name}) was taken. New capacity = ${bcur.w} - ${it.weight} = ${bcur.newW}.`
        : `They are equal, so item ${bcur.i} (${it.name}) was not taken. Capacity stays ${bcur.w}.`);
    if (bpos === bs.length) btext += ` Reached row 0, backtracking is complete.`;
  }
  $("back-explain").textContent = btext;
  const takenNames = bs.slice(0, bpos).filter((x) => x.taken).map((x) => `${its[x.i - 1].name} (w=${its[x.i - 1].weight}, v=${its[x.i - 1].value})`);
  $("back-taken").textContent = `Taken so far: ${takenNames.length ? takenNames.join(", ") : "none"}`;
  $("bstep-btn").disabled = bpos >= bs.length;
  $("bauto-btn").disabled = !!btimer;
  $("bpause-btn").disabled = !btimer;
  $("breset-btn").disabled = bpos === 0;
  $("back-panel").hidden = !done;

  // Result and greedy comparison appear once the table is complete
  if (done) {
    renderResult(dp, chosen, W, its);
    renderGreedy(its, W, dp[n][W]);
  } else {
    $("result-panel").hidden = true;
  }
  $("greedy-panel").hidden = !done;
}

function renderResult(dp, chosen, W, its) {
  const n = its.length;
  const totalWeight = chosen.reduce((s, i) => s + its[i].weight, 0);
  const names = chosen.length ? chosen.map((i) => `${esc(its[i].name)} (w=${its[i].weight}, v=${its[i].value})`).join(", ") : "none";

  $("summary").innerHTML =
    `<li><strong>Maximum value:</strong> ${dp[n][W]}</li>
     <li><strong>Weight used:</strong> ${totalWeight} of ${W}</li>
     <li><strong>Items selected:</strong> ${names}</li>`;
  const segs = chosen.map((i) =>
    `<span class="seg" style="width:${its[i].weight / W * 100}%;background:${color(i)}" title="${esc(its[i].name)}">${esc(its[i].name)} (${its[i].weight})</span>`).join("");
  $("bag").innerHTML = `<div class="bagbar">${segs}</div><p class="note">Bag capacity ${W}: used ${totalWeight}, free ${W - totalWeight}.</p>`;
  $("complexity").textContent =
    `Time and space: O(nW) = ${n} x ${W} = ${n * W} cells computed (table is ${n + 1} x ${W + 1}).`;
  $("result-panel").hidden = false;
}

/* ---------- Start ---------- */
$("preset").value = "basic";
loadItems(PRESETS.basic.items);
