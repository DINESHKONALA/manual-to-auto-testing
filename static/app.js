/* ── Flight Test Portal — Frontend JS ─────────── */

const EXAMPLES = {
  "Expired card + promo code":
    "User buys a ticket with an expired card and a promo code",
  "Guest round-trip with infant passenger":
    "Guest user books a round-trip flight from Mumbai to Delhi with an infant passenger and requests a window seat upgrade",
  "Cancel booking within 24h for refund":
    "Logged-in user cancels a confirmed booking within 24 hours of purchase and requests a full refund to the original payment method",
  "Corporate traveler applies FFP miles":
    "Corporate traveler logs in and applies frequent flyer miles as partial payment with the remainder charged to a corporate card",
  "Seat upgrade with partial payment failure":
    "User attempts to upgrade from Economy to Business class but the upgrade payment fails due to insufficient card limit",
};

function setExample(el) {
  const full = EXAMPLES[el.textContent.trim()];
  if (full) document.getElementById("testInput").value = full;
}

function setStatus(state, label) {
  const pill = document.getElementById("statusPill");
  const txt  = document.getElementById("statusText");
  pill.className = "status-pill " + state;
  txt.textContent = label;
}

function setPipelineVisible(show) {
  document.getElementById("pipeline").style.display = show ? "flex" : "none";
}

function setPipeStep(id, state) {
  const el = document.getElementById("pipe-" + id);
  if (el) el.className = "pipe-step " + state;
}

function showError(msg) {
  const box = document.getElementById("errorBox");
  box.style.display = "flex";
  box.innerHTML = `<i class="ti ti-alert-circle"></i><span>${msg}</span>`;
}

function hideError() {
  document.getElementById("errorBox").style.display = "none";
}

function switchTab(name, el) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-pane").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  document.getElementById("tab-" + name).classList.add("active");
}

async function copyCode(id) {
  const text = document.getElementById(id).innerText;
  await navigator.clipboard.writeText(text).catch(() => {});
  // brief feedback
  const btn = document.querySelector(`[onclick="copyCode('${id}')"]`);
  if (btn) {
    btn.innerHTML = '<i class="ti ti-check"></i> Copied!';
    setTimeout(() => { btn.innerHTML = '<i class="ti ti-copy"></i> Copy'; }, 1800);
  }
}

/* ── Syntax highlighters ──────────────────────── */

function highlightGherkin(raw) {
  const esc = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return esc
    .replace(/^(Feature:|Background:|Rule:)/gm,
      m => `<span class="kw-feature">${m}</span>`)
    .replace(/^(Scenario:|Scenario Outline:|Examples:)/gm,
      m => `<span class="kw-scenario">${m}</span>`)
    .replace(/^(\s*)(Given |When |Then |And |But )(.*)$/gm,
      (_, sp, kw, rest) => `${sp}<span class="kw-step">${kw}</span>${rest}`)
    .replace(/(#[^\n]*)/g,
      m => `<span class="kw-comment">${m}</span>`)
    .replace(/(@\w[\w-]*)/g,
      m => `<span class="kw-tag">${m}</span>`)
    .replace(/"([^"]*)"/g,
      (_, v) => `"<span class="kw-string">${v}</span>"`)
    .replace(/(&lt;[^&]*&gt;)/g,
      m => `<span class="kw-string">${m}</span>`)
    .replace(/(\|[^\n]+)/g,
      m => `<span class="kw-table">${m}</span>`);
}

function highlightPython(raw) {
  const esc = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const keywords = /\b(import|from|def|class|return|if|else|elif|for|while|in|not|and|or|True|False|None|try|except|finally|with|as|pass|raise|assert|yield|lambda)\b/g;

  return esc
    .replace(/(#[^\n]*)/g,
      m => `<span class="py-comment">${m}</span>`)
    .replace(/(@[\w.]+)/g,
      m => `<span class="py-decorator">${m}</span>`)
    .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
      m => `<span class="py-string">${m}</span>`)
    .replace(keywords,
      m => `<span class="py-keyword">${m}</span>`)
    .replace(/\b(\d+(?:\.\d+)?)\b/g,
      m => `<span class="py-number">${m}</span>`);
}

/* ── Render test data cards ───────────────────── */

function renderDataCards(datasets) {
  const container = document.getElementById("dataCards");
  container.innerHTML = "";

  datasets.forEach((ds, idx) => {
    const isExpired = ds.payment?.is_expired;
    const isPromoValid = ds.promo?.valid;
    const outcomeClass = isExpired ? "fail" : "pass";
    const outcomeLabel = isExpired ? "Negative flow" : "Positive flow";

    const section = document.createElement("div");
    section.innerHTML = `
      <div class="ds-header">
        <span class="ds-id-badge"><i class="ti ti-database"></i>${ds.dataset_id || "DS_00" + (idx+1)}</span>
        <span class="ds-desc">${ds.description || ""}</span>
        <span class="ds-outcome ${outcomeClass}">${outcomeLabel}</span>
      </div>
      <div class="data-grid">
        ${dataCard("ti-user", "Passenger", ds.passenger || {})}
        ${dataCard("ti-credit-card", "Payment", ds.payment || {})}
        ${dataCard("ti-plane", "Booking", ds.booking || {})}
        ${dataCard("ti-tag", "Promo &amp; Outcome", {
            ...ds.promo,
            expected: ds.expected_outcome
          })}
      </div>
    `;

    container.appendChild(section);

    if (idx < datasets.length - 1) {
      const hr = document.createElement("hr");
      hr.className = "ds-divider";
      container.appendChild(hr);
    }
  });
}

function dataCard(icon, title, obj) {
  const rows = Object.entries(obj)
    .map(([k, v]) => {
      const isExpiredVal = k === "expiry" && typeof v === "string" && isExpiredDate(v);
      const cls = isExpiredVal ? "expired" : (k === "pnr" || k === "code" ? "valid" : "");
      return `<div class="data-row">
        <span class="data-key">${k.replace(/_/g, " ")}</span>
        <span class="data-val ${cls}">${v}</span>
      </div>`;
    }).join("");

  return `<div class="data-card">
    <div class="data-card-title"><i class="ti ${icon}"></i>${title}</div>
    ${rows || '<div class="data-row"><span class="data-key">—</span><span class="data-val">N/A</span></div>'}
  </div>`;
}

function isExpiredDate(mmyy) {
  const [m, y] = mmyy.split("/").map(Number);
  if (!m || !y) return false;
  const now = new Date();
  const exp = new Date(2000 + y, m - 1, 1);
  return exp < now;
}

/* ── Metrics row ──────────────────────────────── */

function renderMetrics(gherkin, stepDefs, datasets) {
  const scenarioCount = (gherkin.match(/^Scenario/gm) || []).length;
  const stepCount = (gherkin.match(/^\s*(Given|When|Then|And|But)\s/gm) || []).length;
  const lineCount = stepDefs.split("\n").length;

  const row = document.getElementById("metricsRow");
  row.innerHTML = [
    { val: scenarioCount || "—", lbl: "Scenarios" },
    { val: stepCount || "—",     lbl: "BDD Steps" },
    { val: datasets.length,      lbl: "Datasets" },
    { val: lineCount,            lbl: "Code lines" },
  ].map(m => `
    <div class="metric-card">
      <div class="metric-val">${m.val}</div>
      <div class="metric-lbl">${m.lbl}</div>
    </div>
  `).join("");
}

/* ── Main generate function ───────────────────── */

async function generate() {
  const testCase  = document.getElementById("testInput").value.trim();
  const framework = document.getElementById("framework").value;
  const dataCount = document.getElementById("dataCount").value;

  if (!testCase) {
    showError("Please enter a test case description.");
    return;
  }

  hideError();

  const btn = document.getElementById("genBtn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Generating…';

  setStatus("running", "Generating…");
  setPipelineVisible(true);

  ["nlp", "gherkin", "steps", "data"].forEach(id => setPipeStep(id, ""));
  setPipeStep("nlp", "active");

  // hide old output
  document.getElementById("emptyState").style.display = "none";
  const outContent = document.getElementById("outputContent");
  outContent.classList.remove("visible");

  try {
    const res = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        test_case : testCase,
        framework : framework,
        data_count: parseInt(dataCount),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data.errors && data.errors.length) {
      showError(data.errors.join(" | "));
    }

    setPipeStep("nlp",    "done");
    setPipeStep("gherkin","active");

    // Render gherkin
    const gEl = document.getElementById("gherkinCode");
    gEl.innerHTML = highlightGherkin(data.gherkin || "# No output generated");

    setPipeStep("gherkin","done");
    setPipeStep("steps",  "active");

    // Render step defs
    const sEl = document.getElementById("stepdefsCode");
    sEl.innerHTML = highlightPython(data.step_definitions || "# No output generated");

    setPipeStep("steps", "done");
    setPipeStep("data",  "active");

    // Render test data
    renderDataCards(data.test_data || []);
    renderMetrics(data.gherkin || "", data.step_definitions || "", data.test_data || []);

    setPipeStep("data", "done");

    outContent.classList.add("visible");
    setStatus("done", "Complete");

    // Switch to gherkin tab by default
    switchTab("gherkin", document.querySelector(".tab"));

  } catch (err) {
    showError("Generation failed: " + err.message);
    setStatus("error", "Error");
    document.getElementById("emptyState").style.display = "flex";
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-wand"></i><span>Regenerate</span><i class="ti ti-refresh"></i>';
}
