/* HRX Loom capability demo - frontend.
   No external libraries and no CDN: this has to render in a meeting room with
   no network. The strip chart is hand-rolled SVG.

   Rendering rule that matters: a missing number renders as an em-dash, never as
   0 and never as 1.0. "No evidence" and "parity with llama.cpp" are different
   claims and the UI must not conflate them. */

const SKILLS = [
  ["loom",          "choose the workflow, apply shared operating rules"],
  ["loom-setup",    "install Loom, fetch catalog models, manage GPU/NPU servers"],
  ["loom-demo-ui",  "browser playground for chat, audio, images, embeddings"],
  ["loom-port-llm", "turn a GGUF into a runnable Loom package"],
  ["loom-roofline", "estimate the limit, choose targets and a budget"],
  ["loom-optimize", "improve speed while checking correctness"],
  ["loom-benchmark","validate, measure against llama.cpp, generate reports"],
  ["loom-improve",  "improve and evaluate the skills themselves"],
  ["loom-org",      "port, publish and maintain a collection on Hugging Face"],
];

let CATALOG = null;
let STATUS = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* em-dash for anything absent - see rendering rule above. */
const fmt = (v, digits = 2, suffix = "") =>
  (v === null || v === undefined || Number.isNaN(v)) ? "—" : v.toFixed(digits) + suffix;

const gb = (bytes) =>
  (bytes === null || bytes === undefined) ? "—" : (bytes / 1e9).toFixed(1) + " GB";

const num = (v) =>
  (v === null || v === undefined) ? "—" : v.toLocaleString();

/* Workloads with a published speedup. A geomean over fewer than all of them
   is not comparable with a full one, so partial rows are listed but not ranked. */
const coverage = (m) =>
  CATALOG.workloads.filter((w) => m.metrics[w].speedup !== null && m.metrics[w].speedup !== undefined).length;
const isFull = (m) => m.geomean_speedup !== null && coverage(m) === CATALOG.workloads.length;

/* Same rule as Python's statistics.median, so chart and tiles agree. */
function median(sorted) {
  const n = sorted.length, h = Math.floor(n / 2);
  return n % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
}

/* ---------------- tabs ---------------- */
$$(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.remove("is-active"));
    $$(".screen").forEach((x) => x.classList.remove("is-active"));
    t.classList.add("is-active");
    $("#screen-" + t.dataset.screen).classList.add("is-active");
    // The strip chart sizes to its container, which is zero-width while the
    // screen is display:none - so draw it only once the screen is visible.
    if (t.dataset.screen === "evidence") { drawStrip(); sizeBoard(); }
  });
});

/* ---------------- boot ---------------- */
async function boot() {
  try {
    const [cRes, sRes] = await Promise.all([
      fetch("/api/catalog"),
      fetch("/api/status"),
    ]);
    CATALOG = await cRes.json();
    STATUS = await sRes.json();
  } catch (e) {
    $("#provText").textContent = "Could not reach the demo backend: " + e.message;
    return;
  }

  if (CATALOG.error) {
    $("#provText").textContent = CATALOG.error;
    return;
  }

  renderProvenance();
  renderSkills();
  renderDescriptor();
  renderStats();
  renderBoard();
  renderGates();
  drawStrip();

  $("#footMeta").textContent =
    `catalog published ${CATALOG.generated} · ${CATALOG.model_count} models · ` +
    `llama.cpp ROCm baseline`;
}

/* ---------------- provenance bar ---------------- */
/* The URL is resolved by the backend, so a loopback address means "this box",
   not the viewer's machine. Say so, or a LAN viewer reads 127.0.0.1 as theirs. */
function serverLabel(url) {
  try {
    const u = new URL(url);
    if (["127.0.0.1", "localhost", "[::1]", "::1"].includes(u.hostname))
      return `loom-serve on the demo host (:${u.port || (u.protocol === "https:" ? 443 : 80)})`;
  } catch (e) { /* not a URL, e.g. the standalone placeholder */ }
  return url;
}

function renderProvenance() {
  const bar = $("#provenanceBar");
  const live = STATUS.mode === "live";
  bar.classList.toggle("is-live", live);
  $("#provMode").textContent = live ? "live" : "replay";

  if (live) {
    $("#provText").innerHTML =
      `Connected to <code title="${STATUS.loom_serve_url}">${serverLabel(STATUS.loom_serve_url)}</code> hosting ` +
      `<b>${(STATUS.server_models || []).join(", ") || "—"}</b>. ` +
      `Measurements you trigger are real readings from the demo host; ` +
      `catalog figures remain published AMD data.`;
    $("#liveBadge").textContent = "live";
    $("#liveBadge").classList.add("live");
    $("#probeBtn").disabled = false;
    $("#livePanelLede").innerHTML =
      `<code title="${STATUS.loom_serve_url}">${serverLabel(STATUS.loom_serve_url)}</code> is answering. ` +
      `Running a measurement sends real requests and reports what that machine did.`;
    if (STATUS.last_probe && STATUS.last_probe.mode === "live")
      renderProbe(STATUS.last_probe, "Last measurement on the demo host, before this page loaded.");
    else
      $("#liveResult").innerHTML =
        `<p class="live-empty">Results appear here after a run: requests, failures, wall time, ` +
        `latency p50/p99 and output rate.</p>`;
  } else {
    $("#provText").innerHTML =
      `No <code>loom-serve</code> on <code title="${STATUS.loom_serve_url}">${serverLabel(STATUS.loom_serve_url)}</code>` +
      (STATUS.reason ? ` (${STATUS.reason})` : "") +
      `. Every figure shown is <b>published loom-fun data</b> from ` +
      `${CATALOG.generated} — nothing here was measured on this machine.`;
  }
}

/* ---------------- 01 descriptor ---------------- */
function renderDescriptor() {
  const sel = $("#descSelect");
  CATALOG.models.forEach((m, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = m.name;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => paintDescriptor(CATALOG.models[sel.value]));
  paintDescriptor(CATALOG.models[0]);
}

function paintDescriptor(m) {
  $("#descModelName").textContent = m.name;
  const s = m.serve, c = m.source_checkpoint;
  const rows = [
    ["device", s.device || "—"],
    ["memory_bytes", s.memory_bytes ? `${num(s.memory_bytes)}  (${gb(s.memory_bytes)})` : "—"],
    ["context_tokens", num(s.context_tokens)],
    ["rows", num(s.rows)],
    ["max_tokens", num(s.max_tokens)],
    ["source GGUF", c.repo ? `${c.repo}` : "—"],
    ["quantization", c.quant || "—"],
    ["weights on disk", gb(c.size)],
    ["speculative drafter", m.has_drafter ? "yes" : "no"],
    ["vision projector", m.has_projector ? "yes" : "no"],
    ["endpoint", m.service.endpoint || "—"],
  ];
  $("#descTable").innerHTML = rows
    .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
    .join("");
}

/* ---------------- 02 skills ---------------- */
function renderSkills() {
  $("#skillList").innerHTML = SKILLS
    .map(([n, d]) => `<li><b>${n}</b><span>${d}</span></li>`)
    .join("");
}

/* ---------------- 03 stats ---------------- */
function renderStats() {
  const dec = CATALOG.spread.decode;
  const p32 = CATALOG.spread.prefill_32k;
  const full = CATALOG.models.filter(isFull);
  const partial = CATALOG.models.length - full.length;
  const nW = CATALOG.workloads.length;
  const anySlow = CATALOG.models.filter((m) => m.regressions.length > 0).length;

  const stats = [
    [CATALOG.model_count, "models ported<br>18 architectures"],
    ["3–4", "days for the first 50 ports<br><a href=\"https://www.phoronix.com/news/AMD-HRX-Loom-Experiment\" target=\"_blank\" rel=\"noopener\">as reported</a>, not measured here"],
    [p32 ? fmt(p32.median, 2, "×") : "—", "median prefill @32k<br>vs llama.cpp ROCm"],
    [dec ? fmt(dec.median, 2, "×") : "—", "median decode<br>vs llama.cpp ROCm"],
    [anySlow, "ports with ≥1 workload<br>still slower than llama.cpp"],
  ];
  $("#statRow").innerHTML = stats
    .map(([v, l]) => `<div class="stat"><div class="stat-v">${v}</div><div class="stat-l">${l}</div></div>`)
    .join("");

  $("#evidenceLede").innerHTML =
    `Published results from the loom-fun catalog (${CATALOG.generated}), measured on Strix Halo ` +
    `against llama.cpp ROCm. ${full.length} of ${CATALOG.model_count} ports have results for all ` +
    `${nW} workloads` +
    (partial ? `; the other ${partial} ${partial === 1 ? "is" : "are"} listed unranked with their coverage` : "") +
    `. Speedups above 1.0 favour Loom; below 1.0 llama.cpp is still faster — ` +
    `<b>both directions are shown</b>, because a benchmark page with no losses is not evidence.`;
}

/* ---------------- 03 strip chart ---------------- */
function drawStrip() {
  if (!CATALOG) return;
  const host = $("#stripChart");
  // Fit the container (minus its padding) so the whole 0.5-3.5x range is visible on a phone.
  const cs = getComputedStyle(host);
  const inner = (host.clientWidth || 892) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const W = Math.max(inner, 300);
  const narrow = W < 560;
  const rows = CATALOG.workloads;
  const rowH = 34, padT = 24, padB = 30, padL = narrow ? 84 : 96, padR = narrow ? 14 : 24;
  const H = padT + rows.length * rowH + padB;
  const plotW = W - padL - padR;

  // Log scale centred on parity. Clamp the domain so one outlier cannot
  // squash everything else into the middle.
  const LO = Math.log(0.5), HI = Math.log(3.5);
  const x = (v) => {
    const t = (Math.log(Math.max(0.5, Math.min(3.5, v))) - LO) / (HI - LO);
    return padL + t * plotW;
  };

  let svg = `<svg class="${narrow ? "narrow" : ""}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Speedup by workload">`;
  // Region where llama.cpp is faster.
  svg += `<rect class="band" x="${padL}" y="${padT - 8}" width="${x(1) - padL}" height="${rows.length * rowH + 8}"/>`;

  (narrow ? [0.5, 1, 2, 3] : [0.5, 0.75, 1, 1.5, 2, 3]).forEach((t) => {
    const px = x(t);
    svg += `<line class="${t === 1 ? "ax-par" : "ax-line"}" x1="${px}" y1="${padT - 8}" x2="${px}" y2="${padT + rows.length * rowH}"/>`;
    svg += `<text class="ax-txt" x="${px}" y="${H - 12}" text-anchor="middle">${t}×</text>`;
  });

  rows.forEach((w, i) => {
    const y = padT + i * rowH + rowH / 2;
    svg += `<text class="row-lbl" x="${padL - 10}" y="${y + 4}" text-anchor="end">${CATALOG.workload_labels[w]}</text>`;

    const vals = [];
    CATALOG.models.forEach((m) => {
      const sp = m.metrics[w].speedup;
      if (sp === null || sp === undefined) return;   // absent stays absent
      vals.push(sp);
      const slow = sp < 1.0;
      const jitter = ((m.name.length * 7 + i * 13) % 11) - 5;   // deterministic
      svg += `<circle class="dot${slow ? " slow" : ""}" cx="${x(sp).toFixed(1)}" cy="${(y + jitter * 0.9).toFixed(1)}" r="3.4"><title>${m.name} — ${sp}×</title></circle>`;
    });

    if (vals.length) {
      vals.sort((a, b) => a - b);
      const med = median(vals);
      svg += `<line class="med-tick" x1="${x(med).toFixed(1)}" y1="${y - 13}" x2="${x(med).toFixed(1)}" y2="${y + 13}"><title>median ${fmt(med, 2, "×")} (n=${vals.length})</title></line>`;
    }
  });

  svg += `</svg>`;
  host.innerHTML = svg;
}

window.addEventListener("resize", () => {
  if ($("#screen-evidence").classList.contains("is-active")) { drawStrip(); sizeBoard(); }
});

/* ---------------- 03 leaderboard ---------------- */
function renderBoard() {
  const head = `<tr><th class="rk">#</th><th>model</th><th style="text-align:right">geomean</th>` +
               `<th style="text-align:right">p32k</th><th style="text-align:right">decode</th>` +
               `<th style="text-align:right" title="workloads where llama.cpp ROCm is still faster">slower</th>` +
               `<th>evidence</th></tr>`;

  // Full-coverage rows keep the catalog's order and get a rank; partial rows follow, unranked.
  const ordered = CATALOG.models.filter(isFull).concat(CATALOG.models.filter((m) => !isFull(m)));
  let rank = 0;
  const nW = CATALOG.workloads.length;
  const rows = ordered.map((m) => {
    const full = isFull(m);
    const cov = coverage(m);
    const geo = full ? m.geomean_speedup : null;
    const p32 = m.metrics.prefill_32k.speedup;
    const dec = m.metrics.decode.speedup;
    const ev = m.evidence.url
      ? `<a href="${m.evidence.url}" target="_blank" rel="noopener">run ↗</a>`
      : "—";
    return `<tr>
      <td class="rk">${full ? ++rank : "—"}</td>
      <td class="nm">${m.name}${full ? "" : ` <span class="cov" title="results for ${cov} of ${nW} workloads; not ranked">${cov}/${nW}</span>`}</td>
      <td class="sp${geo !== null && geo < 1 ? " slow" : ""}">${fmt(geo, 2, "×")}</td>
      <td class="sp${p32 !== null && p32 < 1 ? " slow" : ""}">${fmt(p32, 2, "×")}</td>
      <td class="sp${dec !== null && dec < 1 ? " slow" : ""}">${fmt(dec, 2, "×")}</td>
      <td class="rg" title="${m.regressions.join(", ")}">${m.regressions.length || ""}</td>
      <td class="ev">${ev}</td>
    </tr>`;
  }).join("");

  $("#board").innerHTML = head + rows;
  sizeBoard();
}

/* Show whole rows only, and say that the table scrolls. Runs when the
   Evidence screen is visible, because hidden rows measure as zero height. */
function sizeBoard() {
  const wrap = $("#boardWrap");
  const trs = $$("#board tr");
  if (!wrap || trs.length < 2 || !trs[1].offsetHeight) return;
  const VISIBLE = 11;
  const headH = trs[0].offsetHeight, rowH = trs[1].offsetHeight;
  const body = trs.length - 1;
  wrap.style.maxHeight = body > VISIBLE ? `${headH + rowH * VISIBLE}px` : "";
  const update = () => {
    const atEnd = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 2;
    wrap.classList.toggle("has-more", body > VISIBLE && !atEnd);
  };
  wrap.onscroll = update;
  update();
  $("#boardHint").textContent = body > VISIBLE ? `${body} rows · scroll for more` : "";
}

/* ---------------- 04 gates ---------------- */
function renderGates() {
  const names = Object.keys(CATALOG.gate_labels);
  const counts = {};
  names.forEach((g) => (counts[g] = { pass: 0, "n/a": 0, unknown: 0, fail: 0, total: 0 }));

  CATALOG.models.forEach((m) => {
    Object.entries(m.gates.status || {}).forEach(([g, s]) => {
      if (!counts[g]) counts[g] = { pass: 0, "n/a": 0, unknown: 0, fail: 0, total: 0 };
      counts[g][s] = (counts[g][s] || 0) + 1;
      counts[g].total += 1;
    });
  });

  // Bars are scaled to the whole catalog: a gate recorded for 2 models must not
  // look like a full pass. Gates with no pass/fail/unknown anywhere are omitted.
  const N = CATALOG.model_count;
  const ran = (c) => c.pass + c.unknown + (c.fail || 0);
  const omitted = names.filter((g) => ran(counts[g]) === 0).map((g) => CATALOG.gate_labels[g]);
  $("#gateGrid").innerHTML = names
    .filter((g) => ran(counts[g]) > 0)
    .map((g) => {
      const c = counts[g], t = N;
      const notRun = Math.max(0, N - c.total);
      const pc = (n) => ((n / t) * 100).toFixed(1) + "%";
      return `<div class="gate">
        <div class="gate-nm">${CATALOG.gate_labels[g]}</div>
        <div class="gate-bar">
          <i class="g-pass" style="width:${pc(c.pass)}"></i>
          <i class="g-unk"  style="width:${pc(c.unknown + (c.fail || 0))}"></i>
          <i class="g-na"   style="width:${pc(c["n/a"])}"></i>
        </div>
        <div class="gate-ct">${c.pass} pass${c["n/a"] ? ` · ${c["n/a"]} n/a` : ""}${c.unknown ? ` · ${c.unknown} unknown` : ""}${c.fail ? ` · ${c.fail} fail` : ""}${notRun ? ` · ${notRun} not run` : ""}</div>
      </div>`;
    }).join("");

  const t = CATALOG.gate_tally;
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  $("#gateMeta").textContent = `${CATALOG.model_count} models · ${total} gate results`;
  $("#gateTally").innerHTML =
    `Across the catalog: <b>${t.pass || 0} pass</b>, ${t["n/a"] || 0} not applicable, ` +
    `${t.unknown || 0} unknown, <b>${t.fail || 0} fail</b>. ` +
    `"Not applicable" dominates where a model has no vision, no drafter or no thinking mode — ` +
    `it is not a silent failure, but it is also not evidence of correctness for a feature the ` +
    `model does not have. Bars are out of all ${N} models; "not run" means no result was published.` +
    (omitted.length ? ` Omitted (no model has a pass, fail or unknown result): ${omitted.join(", ")}.` : "");
}

/* ---------------- live probe ---------------- */
$("#probeBtn").addEventListener("click", async () => {
  const btn = $("#probeBtn");
  const out = $("#liveResult");
  btn.disabled = true;
  btn.textContent = "measuring…";
  out.innerHTML = `<p class="panel-lede" style="margin:0">Sending requests…</p>`;

  try {
    const r = await fetch("/api/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        concurrency: +$("#pConc").value,
        prompt_tokens: +$("#pPrompt").value,
        max_tokens: +$("#pMax").value,
      }),
    });
    const d = await r.json();

    if (d.mode !== "live") {
      out.innerHTML = `<p class="live-err">${d.error ? d.error : `Server not reachable${d.reason ? ` (${d.reason})` : ""}. ` +
                      `Nothing measured — staying in replay.`}</p>`;
    } else {
      renderProbe(d, "Measured on the demo host just now.");
    }
  } catch (e) {
    out.innerHTML = `<p class="live-err">${e.message}</p>`;
  } finally {
    btn.disabled = STATUS.mode !== "live";
    btn.textContent = "run measurement";
  }
});

function renderProbe(d, when) {
      $("#liveResult").innerHTML = `<table>
        <tr><td>model</td><td>${d.model}</td></tr>
        <tr><td>requests (concurrency)</td><td>${d.requests} (${d.concurrency} / cap ${d.max_workers})</td></tr>
        <tr><td>failed</td><td>${d.failed}</td></tr>
        <tr><td>wall time</td><td>${fmt(d.wall_seconds, 2, " s")}</td></tr>
        <tr><td>latency p50</td><td>${fmt(d.latency_p50, 3, " s")}</td></tr>
        <tr><td>latency p99</td><td>${fmt(d.latency_p99, 3, " s")}</td></tr>
        <tr><td>mean output rate</td><td>${d.mean_output_tok_s === null ? "—" : d.mean_output_tok_s + " tok/s"}</td></tr>
        <tr><td>aggregate output rate</td><td>${d.aggregate_output_tok_s === null ? "—" : d.aggregate_output_tok_s + " tok/s"}</td></tr>
      </table>
      <p class="caveat" style="margin-left:0;margin-right:0">${when} ${d.measurement_note || ""}</p>`;
}

boot();
