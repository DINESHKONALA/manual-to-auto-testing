"""
Flight Test Portal — Manual to Auto Bridge
Flask + Gemini AI + SQLite database
Model: gemini-2.5-flash with smart rate-limit handling
"""
import json, re, os, time, sqlite3
from datetime import datetime
import requests
from flask import Flask, render_template, request, jsonify, g

app = Flask(__name__)

# ── Config ──────────────────────────────────────────────────────────────────
GEMINI_API_KEY   = os.environ.get("GEMINI_API_KEY", "YOUR_GEMINI_API_KEY_HERE")

# Primary model + fallback chain
PRIMARY_MODEL    = "gemini-2.5-flash-preview-05-20"
GEMINI_MODELS    = [
    "gemini-2.5-flash-preview-05-20",   # latest 2.5-flash (correct API name)
    "gemini-2.0-flash",                 # fallback 1
    "gemini-1.5-flash",                 # fallback 2
]

# Free tier: 10 RPM on 2.5-flash  →  wait 15s between the 3 sequential calls
INTER_CALL_DELAY = 15    # seconds between Gherkin → StepDefs → TestData
MAX_RETRIES      = 5     # per model
DB_PATH          = os.path.join(os.path.dirname(__file__), "testbridge.db")


def gemini_url(model: str) -> str:
    return (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={GEMINI_API_KEY}"
    )


# ── Database ─────────────────────────────────────────────────────────────────
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(e=None):
    db = g.pop("db", None)
    if db: db.close()

def init_db():
    with sqlite3.connect(DB_PATH) as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS history (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at    TEXT NOT NULL,
                test_case     TEXT NOT NULL,
                framework     TEXT NOT NULL,
                scenarios     INTEGER DEFAULT 0,
                data_count    INTEGER DEFAULT 0,
                code_lines    INTEGER DEFAULT 0,
                gherkin       TEXT,
                step_defs     TEXT,
                test_data     TEXT,
                errors        TEXT
            )
        """)
        db.commit()


# ── Prompt builders ───────────────────────────────────────────────────────────
def build_gherkin_prompt(test_case: str, framework: str) -> str:
    return f"""You are a senior QA automation architect for flight booking apps.
Convert this plain-English test case into a professional Gherkin (.feature) file.

TEST CASE: "{test_case}"
FRAMEWORK: {framework}

Rules:
1. Feature block with a clear description.
2. Tags: @regression @smoke @payment @booking @negative as relevant.
3. Background for common preconditions (open browser, navigate to site).
4. Scenario Outline with Examples table when multiple data rows make sense.
5. Atomic steps matching real flight booking UI actions.
6. Use <angle_bracket_placeholders> in Scenario Outline steps.
7. Add 1-2 edge-case Scenarios (network error, session timeout, etc).
8. Return ONLY the raw .feature file content — no markdown fences, no explanation.""".strip()


def build_stepdefs_prompt(test_case: str, framework: str, gherkin: str) -> str:
    lang = {
        "Cucumber/Python"  : "Python + Selenium WebDriver + behave (@given/@when/@then decorators)",
        "Cucumber/Java"    : "Java + Selenium WebDriver + JUnit5 + Cucumber annotations",
        "Appium/Java"      : "Java + Appium + MobileBy locators + AppiumDriver",
        "Playwright/Python": "Python + Playwright sync_api + pytest-bdd",
    }.get(framework, "Python + Selenium WebDriver + behave")

    return f"""You are a senior QA automation engineer.
Generate complete step definition code for the Gherkin feature file below.

FRAMEWORK: {lang}
TEST CASE: "{test_case}"

GHERKIN:
{gherkin}

Rules:
1. Import all required libraries at the top.
2. Implement EVERY step — no pass placeholders, no TODO comments.
3. Realistic locators: By.ID, By.CSS_SELECTOR, By.XPATH.
4. Add WebDriverWait with expected_conditions for all interactions.
5. Include browser setup and teardown hooks/fixtures.
6. Inline comments explaining each step.
7. Return ONLY the raw source code — no markdown fences, no explanation.""".strip()


def build_testdata_prompt(test_case: str, count: int) -> str:
    return f"""You are a synthetic test-data generator for a flight booking application.
TEST CASE: "{test_case}"
Generate exactly {count} realistic, non-clashing test datasets.
Return ONLY a valid JSON array — no markdown fences, no explanation, no extra text.

Each object must follow this exact schema:
{{
  "dataset_id"  : "DS_001",
  "description" : "one-line purpose of this dataset",
  "passenger": {{
    "name": "Full Name", "email": "user@example.com",
    "phone": "+91-9XXXXXXXXX", "dob": "YYYY-MM-DD", "nationality": "Indian"
  }},
  "payment": {{
    "card_number": "4111111111111111", "expiry": "MM/YY", "cvv": "123",
    "card_type": "Visa", "name_on_card": "Full Name", "is_expired": false
  }},
  "booking": {{
    "pnr": "ABC123", "origin": "BOM", "destination": "DEL",
    "flight_no": "AI302", "travel_class": "Economy",
    "travel_date": "2025-08-15", "passengers": 1, "trip_type": "one-way"
  }},
  "promo": {{"code": "SAVE20", "discount_pct": 20, "valid": true}},
  "expected_outcome": "Short description of expected result"
}}

Data rules:
- Valid Visa test card: 4111111111111111 with future expiry.
- Valid Mastercard test: 5500005555555559 with future expiry.
- Expired card: use past expiry like 11/22 and set is_expired=true.
- Invalid CVV example: wrong digit count.
- PNR: exactly 6 uppercase alphanumeric characters.
- Flight carriers: AI, 6E, SG, UK, QP. Airports: BOM DEL BLR HYD MAA CCU AMD.
- Mix trip_type (one-way / round-trip) across datasets.
- Each dataset should clearly represent: positive flow, negative flow, or edge case.
Return ONLY the JSON array, nothing else.""".strip()


# ── Gemini call: retry + exponential backoff + model fallback ─────────────────
def call_gemini(prompt: str, temperature: float = 0.4) -> str:
    """
    Retry strategy per model:
      attempt 0 → wait 15s on 429
      attempt 1 → wait 30s
      attempt 2 → wait 60s
      attempt 3 → wait 90s
      attempt 4 → give up on this model, try next

    Between models: wait 20s before switching.
    """
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature"    : temperature,
            "maxOutputTokens": 4096,
        },
    }

    last_error = None

    for model in GEMINI_MODELS:
        url = gemini_url(model)
        print(f"\n[Gemini] Trying model: {model}")

        for attempt in range(MAX_RETRIES):
            try:
                resp = requests.post(url, json=payload, timeout=180)

                if resp.status_code == 429:
                    # Respect Retry-After header if present, else use back-off table
                    retry_after = int(resp.headers.get("Retry-After", 0))
                    backoff_table = [15, 30, 60, 90, 120]
                    wait = max(retry_after, backoff_table[min(attempt, len(backoff_table)-1)])
                    print(f"  [429] attempt {attempt+1}/{MAX_RETRIES} — sleeping {wait}s …")
                    time.sleep(wait)
                    last_error = f"429 on {model}"
                    continue

                # Any other HTTP error: log and break to next model
                if resp.status_code != 200:
                    last_error = f"HTTP {resp.status_code} on {model}"
                    print(f"  [ERR] {last_error}")
                    break

                data = resp.json()
                candidates = data.get("candidates", [])
                if not candidates:
                    raise ValueError(f"Empty candidates from {model}: {str(data)[:200]}")

                parts = candidates[0].get("content", {}).get("parts", [])
                text  = "".join(p.get("text", "") for p in parts).strip()
                print(f"  [OK] {model} on attempt {attempt+1} — {len(text)} chars")
                return text

            except requests.exceptions.Timeout:
                last_error = f"Timeout on {model}"
                print(f"  [TIMEOUT] attempt {attempt+1}")
                time.sleep(10)

            except requests.exceptions.HTTPError as e:
                last_error = str(e)
                print(f"  [HTTP ERR] {e}")
                break

            except Exception as e:
                last_error = str(e)
                wait = 10 * (attempt + 1)
                print(f"  [ERR] {e} — retry in {wait}s")
                time.sleep(wait)

        # Exhausted retries on this model — pause before trying the next one
        print(f"  [SWITCH] Moving to next model after 20s …")
        time.sleep(20)

    raise RuntimeError(f"All models exhausted. Last error: {last_error}")


def safe_json(raw: str):
    """Strip markdown fences then parse JSON."""
    cleaned = re.sub(r"^```[a-z]*\n?", "", raw.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\n?```$", "", cleaned.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Last resort: find the JSON array inside the text
        match = re.search(r"\[[\s\S]*\]", cleaned)
        if match:
            return json.loads(match.group())
        raise


# ── Flask routes ──────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/generate", methods=["POST"])
def generate():
    body       = request.get_json(force=True)
    test_case  = body.get("test_case", "").strip()
    framework  = body.get("framework", "Cucumber/Python")
    data_count = int(body.get("data_count", 3))

    if not test_case:
        return jsonify({"error": "test_case is required"}), 400

    result = {"gherkin": "", "step_definitions": "", "test_data": [], "errors": []}

    # ── Step 1: Gherkin ──────────────────────────────────────────────────────
    try:
        print("\n══ STEP 1: Gherkin generation ══")
        result["gherkin"] = call_gemini(
            build_gherkin_prompt(test_case, framework), temperature=0.3
        )
        print(f"  Gherkin: {len(result['gherkin'])} chars")
    except Exception as e:
        result["errors"].append(f"Gherkin failed: {e}")
        print(f"  Gherkin FAILED: {e}")

    # ── Mandatory pause to respect free-tier RPM ─────────────────────────────
    print(f"\n  Waiting {INTER_CALL_DELAY}s before next call …")
    time.sleep(INTER_CALL_DELAY)

    # ── Step 2: Step definitions ─────────────────────────────────────────────
    try:
        print("\n══ STEP 2: Step definitions ══")
        result["step_definitions"] = call_gemini(
            build_stepdefs_prompt(test_case, framework, result["gherkin"]),
            temperature=0.2,
        )
        print(f"  StepDefs: {len(result['step_definitions'])} chars")
    except Exception as e:
        result["errors"].append(f"Step defs failed: {e}")
        print(f"  StepDefs FAILED: {e}")

    print(f"\n  Waiting {INTER_CALL_DELAY}s before next call …")
    time.sleep(INTER_CALL_DELAY)

    # ── Step 3: Synthetic test data ──────────────────────────────────────────
    try:
        print("\n══ STEP 3: Test data synthesis ══")
        raw = call_gemini(
            build_testdata_prompt(test_case, data_count), temperature=0.7
        )
        result["test_data"] = safe_json(raw)
        print(f"  Test data: {len(result['test_data'])} datasets")
    except Exception as e:
        result["errors"].append(f"Test data failed: {e}")
        result["test_data"] = []
        print(f"  TestData FAILED: {e}")

    # ── Persist to SQLite ────────────────────────────────────────────────────
    try:
        scenarios  = len(re.findall(r"^\s*Scenario", result["gherkin"], re.M))
        code_lines = len(result["step_definitions"].splitlines())
        db = get_db()
        db.execute(
            """INSERT INTO history
               (created_at, test_case, framework, scenarios, data_count,
                code_lines, gherkin, step_defs, test_data, errors)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                test_case, framework, scenarios,
                len(result["test_data"]), code_lines,
                result["gherkin"], result["step_definitions"],
                json.dumps(result["test_data"]),
                json.dumps(result["errors"]),
            ),
        )
        db.commit()
        print("\n  [DB] Saved to history ✓")
    except Exception as e:
        print(f"\n  [DB] Save error: {e}")

    return jsonify(result)


@app.route("/history", methods=["GET"])
def get_history():
    try:
        rows = get_db().execute(
            "SELECT id,created_at,test_case,framework,scenarios,"
            "data_count,code_lines FROM history ORDER BY id DESC LIMIT 100"
        ).fetchall()
        return jsonify([dict(r) for r in rows])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/history/<int:hid>", methods=["GET"])
def get_history_item(hid):
    try:
        row = get_db().execute(
            "SELECT * FROM history WHERE id=?", (hid,)
        ).fetchone()
        if not row:
            return jsonify({"error": "not found"}), 404
        d = dict(row)
        d["test_data"] = json.loads(d["test_data"] or "[]")
        d["errors"]    = json.loads(d["errors"]    or "[]")
        return jsonify(d)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/history/<int:hid>", methods=["DELETE"])
def delete_history_item(hid):
    try:
        get_db().execute("DELETE FROM history WHERE id=?", (hid,))
        get_db().commit()
        return jsonify({"deleted": hid})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/history", methods=["DELETE"])
def clear_history():
    try:
        get_db().execute("DELETE FROM history")
        get_db().commit()
        return jsonify({"cleared": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/health")
def health():
    return jsonify({
        "status" : "ok",
        "model"  : PRIMARY_MODEL,
        "models" : GEMINI_MODELS,
        "db"     : DB_PATH,
        "delays" : {
            "inter_call_seconds"   : INTER_CALL_DELAY,
            "backoff_schedule_sec" : [15, 30, 60, 90, 120],
        },
    })


# ── Startup ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    print("=" * 60)
    print("  Flight Test Portal — Manual to Auto Bridge")
    print(f"  Primary model : {PRIMARY_MODEL}")
    print(f"  Fallback chain: {' → '.join(GEMINI_MODELS[1:])}")
    print(f"  Inter-call gap: {INTER_CALL_DELAY}s")
    print(f"  DB            : {DB_PATH}")
    print("  URL           : http://localhost:5000")
    print("=" * 60)
    if GEMINI_API_KEY == "YOUR_GEMINI_API_KEY_HERE":
        print("\n  ⚠  Set GEMINI_API_KEY env variable before running!\n")
    app.run(debug=True, port=5000)
