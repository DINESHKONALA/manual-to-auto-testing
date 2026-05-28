/* ═══════════════════════════════════════════════
   TestBridge — app.js
   All fixes: output rendering, nav pages,
   SQLite history, CSV export, settings
═══════════════════════════════════════════════ */

const EXAMPLES = {
  "Expired card + promo code":
    "User buys a ticket with an expired card and a promo code",
  "Guest round-trip with infant passenger":
    "Guest user books a round-trip flight Mumbai to Delhi with an infant and requests a window seat upgrade",
  "Cancel booking within 24h for refund":
    "Logged-in user cancels a confirmed booking within 24 hours and requests a full refund to original payment",
  "Corporate traveler applies FFP miles":
    "Corporate traveler applies frequent flyer miles as partial payment with remainder on a corporate card",
  "Seat upgrade with partial payment failure":
    "User attempts to upgrade Economy to Business but payment fails due to insufficient card limit",
};

let currentResult  = null;
let currentTestCase = "";
let currentFramework = "";

/* ── Page navigation ─────────────────────────── */
function showPage(name, linkEl) {
  document.querySelectorAll(".page").forEach(p => p.style.display = "none");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

  const pg = document.getElementById("pg-" + name);
  if (pg) pg.style.display = "flex";
  if (linkEl) linkEl.classList.add("active");

  const T = {
    generator: ["Manual <span class='arrow'>→</span> Automation Bridge",
                "Convert plain-English test cases into BDD scripts &amp; synthetic data"],
    history  : ["Generation History","All previously generated test artifacts"],
    settings : ["Settings","Configure models, defaults and storage"],
    docs     : ["Documentation","API reference, pipeline overview and setup guide"],
  };
  document.getElementById("pageTitle").innerHTML = T[name][0];
  document.getElementById("pageSub").innerHTML   = T[name][1];

  if (name === "history")  loadHistoryPage();
  if (name === "settings") loadSettingsPage();
}

/* ── Example chips ───────────────────────────── */
function buildChips() {
  const c = document.getElementById("exampleChips");
  Object.keys(EXAMPLES).forEach(label => {
    const el = document.createElement("div");
    el.className = "chip";
    el.textContent = label;
    el.onclick = () => { document.getElementById("testInput").value = EXAMPLES[label]; };
    c.appendChild(el);
  });
}

/* ── Status pill ─────────────────────────────── */
function setStatus(state, label) {
  const pill = document.getElementById("statusPill");
  pill.className = "pill " + state;
  document.getElementById("statusTxt").textContent = label;
}

/* ── Pipeline ────────────────────────────────── */
function pipeVisible(show) {
  document.getElementById("pipeline").style.display = show ? "flex" : "none";
}
function pipeStep(id, state) {
  const el = document.getElementById("ps-" + id);
  if (el) el.className = "ps " + state;
}

/* ── Error ───────────────────────────────────── */
function showErr(msg) {
  const b = document.getElementById("errBox");
  b.style.display = "flex";
  b.innerHTML = `<i class="ti ti-alert-circle"></i><span>${msg}</span>`;
}
function hideErr() { document.getElementById("errBox").style.display = "none"; }

/* ── Output tab switching ────────────────────── */
function switchTab(name, el) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-pane").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  document.getElementById("tab-" + name).classList.add("active");
  document.getElementById("csvBtn").style.display = (name === "testdata") ? "inline-flex" : "none";
}

/* ── Copy ────────────────────────────────────── */
async function copyEl(id) {
  try { await navigator.clipboard.writeText(document.getElementById(id).innerText); } catch(e){}
  const btn = document.querySelector(`[onclick="copyEl('${id}')"]`);
  if (btn) { const o = btn.innerHTML; btn.innerHTML = '<i class="ti ti-check"></i> Copied!'; setTimeout(()=>btn.innerHTML=o,1800); }
}

/* ── Syntax highlight — Gherkin ──────────────── */
function hlGherkin(raw) {
  if (!raw) return "";
  const e = raw.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return e
    .replace(/^(Feature:|Background:|Rule:)/gm,
      m=>`<span class="kw-feature">${m}</span>`)
    .replace(/^(\s*)(Scenario Outline:|Scenario:|Examples:)/gm,
      (_,sp,kw)=>`${sp}<span class="kw-scenario">${kw}</span>`)
    .replace(/^(\s*)(Given |When |Then |And |But )(.*)$/gm,
      (_,sp,kw,rest)=>`${sp}<span class="kw-step">${kw}</span>${rest}`)
    .replace(/(#[^\n]*)/g,
      m=>`<span class="kw-comment">${m}</span>`)
    .replace(/(@[\w][\w-]*)/g,
      m=>`<span class="kw-tag">${m}</span>`)
    .replace(/"([^"]*)"/g,
      (_,v)=>`"<span class="kw-string">${v}</span>"`)
    .replace(/(&lt;[^&]*&gt;)/g,
      m=>`<span class="kw-string">${m}</span>`)
    .replace(/(\|[^\n]+)/g,
      m=>`<span class="kw-table">${m}</span>`);
}

/* ── Syntax highlight — Python ───────────────── */
function hlPython(raw) {
  if (!raw) return "";
  const e = raw.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const KW = /\b(import|from|def|class|return|if|else|elif|for|while|in|not|and|or|True|False|None|try|except|finally|with|as|pass|raise|assert|yield|lambda|self)\b/g;
  return e
    .replace(/(#[^\n]*)/g, m=>`<span class="py-cmt">${m}</span>`)
    .replace(/(@[\w.]+)/g, m=>`<span class="py-dec">${m}</span>`)
    .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
      m=>`<span class="py-str">${m}</span>`)
    .replace(KW, m=>`<span class="py-kw">${m}</span>`)
    .replace(/\b(\d+(?:\.\d+)?)\b/g, m=>`<span class="py-num">${m}</span>`);
}

/* ── Metrics ─────────────────────────────────── */
function renderMetrics(gherkin, stepDefs, datasets) {
  const sc = (gherkin.match(/^\s*Scenario/gm)||[]).length;
  const st = (gherkin.match(/^\s*(Given|When|Then|And|But)\s/gm)||[]).length;
  const ln = stepDefs ? stepDefs.split("\n").length : 0;
  document.getElementById("metricsRow").innerHTML = [
    {v:sc||"—",  l:"Scenarios"},
    {v:st||"—",  l:"BDD Steps"},
    {v:datasets.length, l:"Datasets"},
    {v:ln,       l:"Code Lines"},
  ].map(m=>`<div class="mc"><div class="mv">${m.v}</div><div class="ml">${m.l}</div></div>`).join("");
}

/* ── Data cards ──────────────────────────────── */
function isExpired(mmyy) {
  if (!mmyy||!mmyy.includes("/")) return false;
  const [m,y]=mmyy.split("/").map(Number);
  return new Date(2000+y,m-1,1)<new Date();
}
function dataCard(icon, title, obj) {
  const rows = Object.entries(obj).map(([k,v])=>{
    const exp = k==="expiry"&&isExpired(String(v));
    const cls = exp?"expired":(k==="pnr"||k==="code")?"valid":"";
    return `<div class="dr"><span class="dk">${k.replace(/_/g," ")}</span><span class="dv ${cls}">${v}</span></div>`;
  }).join("");
  return `<div class="dc"><div class="dc-title"><i class="ti ${icon}"></i>${title}</div>${rows||'<div class="dr"><span class="dk">—</span><span class="dv">N/A</span></div>'}</div>`;
}
function renderDataCards(datasets) {
  const c = document.getElementById("dataCards");
  c.innerHTML = "";
  if (!datasets||!datasets.length) {
    c.innerHTML='<p style="color:var(--text3);font-size:13px;padding:16px;">No test data generated.</p>';return;
  }
  datasets.forEach((ds,i)=>{
    const exp = ds.payment?.is_expired;
    const sec = document.createElement("div");
    sec.style.padding = "14px";
    sec.innerHTML=`
      <div class="ds-hdr">
        <span class="ds-badge"><i class="ti ti-database"></i>${ds.dataset_id||"DS_00"+(i+1)}</span>
        <span class="ds-desc">${ds.description||""}</span>
        <span class="ds-flow ${exp?"fail":"pass"}">${exp?"Negative":"Positive"} flow</span>
      </div>
      <div class="data-grid">
        ${dataCard("ti-user",        "Passenger", ds.passenger||{})}
        ${dataCard("ti-credit-card", "Payment",   ds.payment||{})}
        ${dataCard("ti-plane",       "Booking",   ds.booking||{})}
        ${dataCard("ti-tag",         "Promo",     {...(ds.promo||{}),expected:ds.expected_outcome})}
      </div>`;
    c.appendChild(sec);
    if (i<datasets.length-1){const hr=document.createElement("hr");hr.className="ds-divider";c.appendChild(hr);}
  });
}

/* ── Render all outputs ──────────────────────── */
function renderOutputs(data) {
  document.getElementById("emptyState").style.display = "none";

  const wrap = document.getElementById("outWrap");
  wrap.style.display = "flex";     // ← THE key fix: was controlled by duplicate attr in old HTML

  document.getElementById("gherkinCode").innerHTML  = hlGherkin(data.gherkin||"# No output");
  document.getElementById("stepdefsCode").innerHTML = hlPython(data.step_definitions||"# No output");
  renderDataCards(data.test_data||[]);
  renderMetrics(data.gherkin||"", data.step_definitions||"", data.test_data||[]);

  // Reset tabs to first
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  document.querySelectorAll(".tab-pane").forEach(t=>t.classList.remove("active"));
  document.querySelector(".tab").classList.add("active");
  document.getElementById("tab-gherkin").classList.add("active");
  document.getElementById("csvBtn").style.display = "none";
}

/* ── CSV ─────────────────────────────────────── */
function toCSV(datasets, testCase, framework) {
  const H = ["dataset_id","description","test_case","framework",
    "passenger_name","email","phone","dob","nationality",
    "card_number","expiry","cvv","card_type","name_on_card","is_expired",
    "pnr","origin","destination","flight_no","travel_class","travel_date","passengers","trip_type",
    "promo_code","discount_pct","promo_valid","expected_outcome"];
  const q = v=>`"${String(v??"").replace(/"/g,'""')}"`;
  const rows = datasets.map(d=>[
    d.dataset_id,d.description,testCase,framework,
    d.passenger?.name,d.passenger?.email,d.passenger?.phone,d.passenger?.dob,d.passenger?.nationality,
    d.payment?.card_number,d.payment?.expiry,d.payment?.cvv,d.payment?.card_type,d.payment?.name_on_card,d.payment?.is_expired,
    d.booking?.pnr,d.booking?.origin,d.booking?.destination,d.booking?.flight_no,
    d.booking?.travel_class,d.booking?.travel_date,d.booking?.passengers,d.booking?.trip_type,
    d.promo?.code,d.promo?.discount_pct,d.promo?.valid,d.expected_outcome
  ].map(q).join(","));
  return [H.map(q).join(","),...rows].join("\n");
}
function triggerCSVDownload(csv, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
function downloadCSV() {
  if (!currentResult?.test_data?.length){alert("No test data to export.");return;}
  triggerCSVDownload(toCSV(currentResult.test_data,currentTestCase,currentFramework),
    `testbridge_${Date.now()}.csv`);
}

/* ── History page (calls SQLite via Flask) ───── */
async function loadHistoryPage() {
  const list = document.getElementById("historyList");
  list.innerHTML = '<p style="color:var(--text3);padding:20px;">Loading…</p>';
  try {
    const rows = await fetch("/history").then(r=>r.json());
    renderHistoryList(rows);
    // update settings db count too
    const cnt = document.getElementById("dbCount");
    if (cnt) cnt.textContent = rows.length;
  } catch(e) {
    list.innerHTML = `<p style="color:var(--red);padding:20px;">Error loading history: ${e.message}</p>`;
  }
}

function renderHistoryList(rows) {
  const list = document.getElementById("historyList");
  if (!rows.length) {
    list.innerHTML=`<div class="no-hist"><i class="ti ti-inbox"></i><p>No history yet.</p><span>Generate some test cases first.</span></div>`;
    return;
  }
  list.innerHTML = rows.map(h=>`
    <div class="hcard">
      <div class="hcard-top">
        <span class="h-num">#${h.id}</span>
        <span class="h-date">${h.created_at}</span>
        <span class="h-fw">${h.framework}</span>
        <div class="hcard-actions">
          <button class="icon-btn" onclick="restoreHistoryItem(${h.id})" title="Load into Generator"><i class="ti ti-arrow-back-up"></i></button>
          <button class="icon-btn" onclick="exportHistoryCSV(${h.id})" title="Export CSV"><i class="ti ti-file-spreadsheet"></i></button>
          <button class="icon-btn danger" onclick="deleteHistoryItem(${h.id})" title="Delete"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      <div class="hcard-body">${h.test_case}</div>
      <div class="hcard-meta">
        <span><i class="ti ti-file-text"></i> ${h.scenarios} scenarios</span>
        <span><i class="ti ti-database"></i> ${h.data_count} datasets</span>
        <span><i class="ti ti-code"></i> ${h.code_lines} lines</span>
      </div>
    </div>`).join("");
}

async function restoreHistoryItem(id) {
  try {
    const h = await fetch(`/history/${id}`).then(r=>r.json());
    document.getElementById("testInput").value = h.test_case;
    document.getElementById("framework").value = h.framework;
    currentResult   = {gherkin:h.gherkin,step_definitions:h.step_defs,test_data:h.test_data,errors:h.errors};
    currentTestCase  = h.test_case;
    currentFramework = h.framework;
    renderOutputs(currentResult);
    showPage("generator", document.querySelector('[data-page="generator"]'));
  } catch(e) { alert("Failed to load: " + e.message); }
}

async function exportHistoryCSV(id) {
  try {
    const h = await fetch(`/history/${id}`).then(r=>r.json());
    if (!h.test_data?.length){alert("No test data in this record.");return;}
    triggerCSVDownload(toCSV(h.test_data,h.test_case,h.framework),`testbridge_history_${id}.csv`);
  } catch(e) { alert("Export failed: " + e.message); }
}

async function deleteHistoryItem(id) {
  if (!confirm("Delete this record?")) return;
  await fetch(`/history/${id}`,{method:"DELETE"});
  loadHistoryPage();
}

async function clearAllHistory() {
  if (!confirm("Clear ALL history from database? This cannot be undone.")) return;
  await fetch("/history",{method:"DELETE"});
  loadHistoryPage();
  loadSettingsPage();
}

async function exportAllCSV() {
  try {
    const rows = await fetch("/history").then(r=>r.json());
    if (!rows.length){alert("No history to export.");return;}
    // fetch all full records
    const full = await Promise.all(rows.map(r=>fetch(`/history/${r.id}`).then(x=>x.json())));
    const all  = full.flatMap(h=>(h.test_data||[]).map(d=>({...d,_tc:h.test_case,_fw:h.framework})));
    if (!all.length){alert("No test data found.");return;}
    triggerCSVDownload(toCSV(all.map(({_tc,_fw,...r})=>r),"All","Mixed"),"testbridge_all_history.csv");
  } catch(e) { alert("Export failed: " + e.message); }
}

/* ── Settings page ───────────────────────────── */
function getSetting(key, def) {
  try { return JSON.parse(localStorage.getItem("tb_"+key)) ?? def; } catch(e){return def;}
}
function saveSetting(key, val) {
  localStorage.setItem("tb_"+key, JSON.stringify(val));
}
async function loadSettingsPage() {
  const fw = document.getElementById("defFw");
  const dc = document.getElementById("defDc");
  const as = document.getElementById("autoSave");
  if (fw) fw.value = getSetting("defFw","Cucumber/Python");
  if (dc) dc.value = getSetting("defDc","3");
  if (as) as.checked = getSetting("autoSave",true);
  try {
    const rows = await fetch("/history").then(r=>r.json());
    const el = document.getElementById("dbCount");
    if (el) el.textContent = rows.length;
  } catch(e){}
}

/* ── Main generate ───────────────────────────── */
async function generate() {
  const testCase  = document.getElementById("testInput").value.trim();
  const framework = document.getElementById("framework").value;
  const dataCount = document.getElementById("dataCount").value;
  if (!testCase){showErr("Please enter a test case description.");return;}

  hideErr();
  const btn = document.getElementById("genBtn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Generating…';
  setStatus("running","Generating…");
  startTimer("Generating");
  pipeVisible(true);
  ["nlp","gherkin","steps","data"].forEach(id=>pipeStep(id,""));
  pipeStep("nlp","active");

  // hide output panel while working
  document.getElementById("emptyState").style.display = "none";
  document.getElementById("outWrap").style.display    = "none";

  try {
    const res = await fetch("/generate",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({test_case:testCase,framework,data_count:parseInt(dataCount)})
    });
    if (!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.error||`HTTP ${res.status}`);}
    const data = await res.json();

    stopTimer();
    if (data.errors?.length) showErr(data.errors.join(" | "));

    // animate pipeline
    pipeStep("nlp","done");   pipeStep("gherkin","active"); await sleep(300);
    pipeStep("gherkin","done");pipeStep("steps","active");   await sleep(300);
    pipeStep("steps","done"); pipeStep("data","active");     await sleep(300);
    pipeStep("data","done");

    currentResult    = data;
    currentTestCase  = testCase;
    currentFramework = framework;
    renderOutputs(data);
    setStatus("done","Complete ✓");

  } catch(err) {
    stopTimer();
    showErr("Generation failed: "+err.message);
    setStatus("error","Error");
    document.getElementById("emptyState").style.display = "flex";
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-wand"></i><span>Regenerate</span><i class="ti ti-refresh"></i>';
}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

/* ── Init ────────────────────────────────────── */
document.addEventListener("DOMContentLoaded",()=>{
  buildChips();
  // apply saved defaults
  const fw = getSetting("defFw",null);
  const dc = getSetting("defDc",null);
  if (fw) document.getElementById("framework").value  = fw;
  if (dc) document.getElementById("dataCount").value  = dc;
  showPage("generator", document.querySelector('[data-page="generator"]'));
});


/* ── Live countdown timer shown during generation ── */
let _timerInterval = null;

function startTimer(label) {
  let secs = 0;
  clearInterval(_timerInterval);
  _timerInterval = setInterval(() => {
    secs++;
    const m = String(Math.floor(secs/60)).padStart(2,"0");
    const s = String(secs % 60).padStart(2,"0");
    document.getElementById("statusTxt").textContent = `${label} ${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(_timerInterval);
  _timerInterval = null;
}
