# Flight Test Portal — Manual → Auto Bridge

AI-powered QA tool that converts plain-English test cases into
Gherkin BDD feature files, step definitions, and synthetic test data.

**Tech Stack**: Flask · Python · Gemini 2.0 Flash · Selenium/Appium/Playwright

---

## Quick Start

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Set your Gemini API key
```bash
# Option A — environment variable (recommended)
export GEMINI_API_KEY="your_key_here"

# Option B — .env file
cp .env.example .env
# edit .env and paste your key
```

Get a free Gemini API key at: https://aistudio.google.com/app/apikey

### 3. Run the server
```bash
python app.py
```

Open http://localhost:5000 in your browser.

---

## Usage

1. Type a plain-English test case, e.g.:
   > "User buys a ticket with an expired card and a promo code"

2. Select your automation framework (Cucumber/Python, Cucumber/Java, Appium, Playwright).

3. Choose how many synthetic datasets to generate (2, 3, or 5).

4. Click **Generate Script + Data**.

### Output tabs
| Tab | Content |
|-----|---------|
| Feature File | `.feature` Gherkin BDD script with tags, Background, Scenario Outline, Examples table |
| Step Definitions | Python/Java step def code with Selenium/Appium locators and waits |
| Test Data | Synthetic passenger, payment, booking, and promo datasets |

---

## Project Structure

```
flight_test_portal/
├── app.py                  # Flask app + Gemini AI integration
├── requirements.txt
├── .env.example
├── templates/
│   └── index.html          # Main portal UI
└── static/
    ├── style.css           # Dark theme stylesheet
    └── app.js              # Frontend logic + syntax highlighting
```

---

## API Endpoint

### POST /generate
```json
{
  "test_case":  "User buys ticket with expired card and promo code",
  "framework":  "Cucumber/Python",
  "data_count": 3
}
```

Response:
```json
{
  "gherkin":           "Feature: ...",
  "step_definitions":  "from behave import ...",
  "test_data":         [...],
  "errors":            []
}
```
