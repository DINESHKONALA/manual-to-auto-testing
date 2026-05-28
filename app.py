"""
Flight Test Portal - Manual to Auto Bridge
Flask + Gemini AI backend  (with 429 retry + backoff)
"""

import json
import re
import os
import time
import requests
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# ─────────────────────────────────────────────
#  Gemini config
# ─────────────────────────────────────────────
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "YOUR_GEMINI_API_KEY_HERE")

# Fallback model chain — tried in order on 429
GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash"
    
]

# Pause between the 3 sequential AI calls (avoids burst rate-limit)
INTER_CALL_DELAY = 5   # seconds


def gemini_url(model: str) -> str:
    return (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={GEMINI_API_KEY}"
    )


# ─────────────────────────────────────────────
#  Prompt builders
# ─────────────────────────────────────────────

def build_gherkin_prompt(test_case: str, framework: str) -> str:
    return f"""
You are a senior QA automation architect specialising in flight booking apps.

Convert the following plain-English test case into a professional Gherkin (.feature) file.

TEST CASE: "{test_case}"
FRAMEWORK : {framework}

Rules:
1. Start with a Feature block and a short description.
2. Add relevant tags: @regression, @smoke, @payment, @booking, @negative, etc.
3. Use Scenario Outline with an Examples table when multiple data rows make sense.
4. Use Background for common preconditions (open browser, navigate to site).
5. Steps must be atomic and match real UI actions for a flight booking portal.
6. Use <angle_bracket_placeholders> in Scenario Outline steps.
7. Add one or two edge-case Scenarios (e.g. network error, session timeout).
8. Return ONLY the raw .feature file content — no markdown fences, no explanation.
""".strip()


def build_stepdefs_prompt(test_case: str, framework: str, gherkin: str) -> str:
    lang_hint = {
        "Cucumber/Java"    : "Java + Selenium WebDriver, JUnit5, @Given/@When/@Then from io.cucumber.java.en",
        "Cucumber/Python"  : "Python + Selenium WebDriver, behave library, @given/@when/@then decorators",
        "Appium/Java"      : "Java + Appium, MobileBy locators, AppiumDriver, @Given/@When/@Then",
        "Playwright/Python": "Python + Playwright (sync_api), @given/@when/@then from pytest-bdd",
    }.get(framework, "Python + Selenium WebDriver, behave")

    return f"""
You are a senior QA automation engineer.

Given the Gherkin feature file below, generate complete step definition code.

FRAMEWORK : {lang_hint}
TEST CASE : "{test_case}"

GHERKIN:
{gherkin}

Rules:
1. Import all required libraries at the top.
2. Implement EVERY step that appears in the feature file — no placeholders like "pass".
3. Use realistic locators: By.ID, By.CSS_SELECTOR, By.XPATH.
4. Add explicit waits (WebDriverWait / expected_conditions).
5. Include a @fixture / hooks section for browser setup and teardown.
6. Add inline comments explaining each step.
7. Return ONLY the raw source code — no markdown fences, no explanation.
""".strip()


def build_testdata_prompt(test_case: str, count: int) -> str:
    return f"""
You are a synthetic test-data generator for a flight booking application.

TEST CASE: "{test_case}"
DATASETS REQUIRED: {count}

Generate {count} realistic, non-clashing test datasets. Return ONLY a JSON array — no markdown, no explanation.

Each object MUST follow this exact schema:
{{
  "dataset_id"  : "DS_001",
  "description" : "one-line purpose",
  "passenger"   : {{
    "name"        : "Full Name",
    "email"       : "user@example.com",
    "phone"       : "+91-XXXXXXXXXX",
    "dob"         : "YYYY-MM-DD",
    "nationality" : "Indian"
  }},
  "payment"     : {{
    "card_number" : "4111111111111111",
    "expiry"      : "MM/YY",
    "cvv"         : "123",
    "card_type"   : "Visa / Mastercard / Amex",
    "name_on_card": "Full Name",
    "is_expired"  : false
  }},
  "booking"     : {{
    "pnr"         : "ABC123",
    "origin"      : "BOM",
    "destination" : "DEL",
    "flight_no"   : "AI302",
    "travel_class": "Economy",
    "travel_date" : "YYYY-MM-DD",
    "passengers"  : 1,
    "trip_type"   : "one-way"
  }},
  "promo"       : {{
    "code"        : "SAVE20",
    "discount_pct": 20,
    "valid"       : true
  }},
  "expected_outcome": "short description of expected result"
}}

Important:
- Visa test card: 4111111111111111 (valid), expiry future date.
- Mastercard test: 5500005555555559 (valid), expiry future date.
- Expired card: past expiry like 11/22 and is_expired=true.
- PNR: 6 alphanumeric uppercase chars.
- Flight numbers: Indian carriers AI, 6E, SG, UK, QP.
- Airports: real IATA codes BOM, DEL, BLR, HYD, MAA, CCU, AMD.
- Vary trip_type across datasets.
- Dataset descriptions must clearly state positive / negative / edge-case intent.
Return ONLY the JSON array.
""".strip()


# ─────────────────────────────────────────────
#  Gemini call  — retry with exponential backoff
#  and model fallback chain on 429
# ─────────────────────────────────────────────

def call_gemini(prompt: str, temperature: float = 0.4,
                max_retries: int = 4) -> str:
    """
    Call Gemini with:
      - Exponential backoff on 429 (1s → 2s → 4s → 8s)
      - Model fallback: gemini-2.5-flash → 2.0-flash
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

        for attempt in range(max_retries):
            try:
                resp = requests.post(url, json=payload, timeout=120)

                # Rate limit — wait then retry (same model first, then next)
                if resp.status_code == 429:
                    retry_after = int(resp.headers.get("Retry-After", 0))
                    wait = max(retry_after, 2 ** attempt)   # at least back-off
                    print(f"[429] {model} attempt {attempt+1}/{max_retries} "
                          f"— waiting {wait}s …")
                    time.sleep(wait)
                    last_error = f"429 on {model}"
                    continue   # retry same model

                # Other HTTP errors — don't retry, try next model
                if resp.status_code != 200:
                    resp.raise_for_status()

                data       = resp.json()
                candidates = data.get("candidates", [])
                if not candidates:
                    raise ValueError(
                        f"No candidates. Response: {json.dumps(data)[:300]}"
                    )

                parts = candidates[0].get("content", {}).get("parts", [])
                text  = "".join(p.get("text", "") for p in parts).strip()
                print(f"[OK] {model} (attempt {attempt+1})")
                return text

            except requests.exceptions.HTTPError as e:
                last_error = str(e)
                print(f"[HTTP error] {model}: {e}")
                break   # move to next model

            except Exception as e:
                last_error = str(e)
                wait = 2 ** attempt
                print(f"[error] {model} attempt {attempt+1}: {e} — retry in {wait}s")
                time.sleep(wait)

        # After exhausting retries on this model, add a gap then try next
        time.sleep(3)

    raise RuntimeError(
        f"All Gemini models exhausted. Last error: {last_error}"
    )


def safe_parse_json(raw: str):
    """Strip markdown fences and parse JSON."""
    cleaned = re.sub(r"^```[a-z]*\n?", "", raw.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\n?```$", "", cleaned.strip())
    return json.loads(cleaned)


# ─────────────────────────────────────────────
#  Routes
# ─────────────────────────────────────────────

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

    results = {"gherkin": "", "step_definitions": "", "test_data": [], "errors": []}

    # ── 1. Gherkin ────────────────────────────
    try:
        print("[STEP 1] Generating Gherkin …")
        results["gherkin"] = call_gemini(
            build_gherkin_prompt(test_case, framework), temperature=0.3
        )
        print(f"[STEP 1] Done ({len(results['gherkin'])} chars)")
    except Exception as e:
        results["errors"].append(f"Gherkin generation failed: {e}")
        print(f"[STEP 1] FAILED: {e}")

    time.sleep(INTER_CALL_DELAY)   # ← rate-limit breathing room

    # ── 2. Step definitions ───────────────────
    try:
        print("[STEP 2] Generating step definitions …")
        results["step_definitions"] = call_gemini(
            build_stepdefs_prompt(test_case, framework, results["gherkin"]),
            temperature=0.2,
        )
        print(f"[STEP 2] Done ({len(results['step_definitions'])} chars)")
    except Exception as e:
        results["errors"].append(f"Step definitions generation failed: {e}")
        print(f"[STEP 2] FAILED: {e}")

    time.sleep(INTER_CALL_DELAY)   # ← rate-limit breathing room

    # ── 3. Test data ──────────────────────────
    try:
        print("[STEP 3] Generating test data …")
        raw_data = call_gemini(
            build_testdata_prompt(test_case, data_count), temperature=0.7
        )
        results["test_data"] = safe_parse_json(raw_data)
        print(f"[STEP 3] Done ({len(results['test_data'])} datasets)")
    except Exception as e:
        results["errors"].append(f"Test data generation failed: {e}")
        results["test_data"] = []
        print(f"[STEP 3] FAILED: {e}")

    return jsonify(results)


@app.route("/health")
def health():
    return jsonify({"status": "ok", "models": GEMINI_MODELS})


if __name__ == "__main__":
    print("=" * 60)
    print("  Flight Test Portal — Manual to Auto Bridge")
    print(f"  Models : {' → '.join(GEMINI_MODELS)}")
    print("  URL    : http://localhost:5000")
    print("=" * 60)
    if GEMINI_API_KEY == "YOUR_GEMINI_API_KEY_HERE":
        print("\n  ⚠  Set GEMINI_API_KEY env variable before running!\n")
    app.run(debug=True, port=5000)




