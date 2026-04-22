# AI Sector Paper Trading Simulator

Real Yahoo Finance data · 8 strategies · Claude-style AI signals · Excel export

---

## Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Run the server

```bash
python app.py
```

### 3. Open in browser

```
http://localhost:5000
```

---

## Project Structure

```
ai_trader/
├── app.py                  # Flask backend — data fetching, indicators, simulation engine
├── requirements.txt        # Python dependencies
├── README.md
├── templates/
│   └── index.html          # Single-page app HTML
└── static/
    ├── css/
    │   └── main.css        # All styles (light + dark mode)
    └── js/
        └── main.js         # Frontend logic, chart rendering, export
```

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Serves the web UI |
| GET | `/api/sectors` | Returns full sector/stock universe |
| POST | `/api/simulate` | Runs simulation with real yfinance data |
| GET | `/api/quote/<ticker>` | Live quote + indicators for one ticker |
| POST | `/api/export` | Returns formatted .xlsx trade report |

### POST /api/simulate

**Request body:**
```json
{
  "capital": 10000,
  "strategy": "ai_hybrid",
  "months": 3,
  "risk": "med",
  "sectors": ["semis", "cloud_ai", "ai_software"]
}
```

**Strategies:** `ai_hybrid`, `momentum`, `mean_rev`, `breakout`, `trend_follow`, `sentiment`

**Risk:** `low` (5% stop-loss), `med` (10%), `high` (20%)

**Sectors:** `semis`, `cloud_ai`, `ai_software`, `robotics`, `ev_auto`, `biotech_ai`

---

## Technical Indicators (computed in `compute_indicators()`)

| Indicator | Parameters | Signal |
|-----------|-----------|--------|
| RSI | 14-period | >70 overbought, <30 oversold |
| MACD | 12, 26, 9 | Signal line crossover |
| Bollinger Bands | 20-period, 2σ | Band touch = reversal signal |
| Moving Averages | MA20, MA50 | Golden/death cross |
| Volume Ratio | 20-period avg | >2x = breakout confirmation |

---

## Extending the App

### Add a new strategy

In `app.py`, write a new signal function:

```python
def signal_myStrategy(ind: dict) -> dict:
    score = 0
    reasons = []
    # Use ind["rsi"], ind["macd"], ind["bb_pct"], ind["vol_ratio"], etc.
    if ind["rsi"] < 35 and ind["vol_ratio"] > 1.8:
        score += 4
        reasons.append("RSI oversold + volume surge")
    return {"score": score, "reasons": reasons, "max": 5}
```

Then register it:
```python
STRATEGY_SIGNALS["myStrategy"] = signal_myStrategy
```

Add the option to the HTML `<select id="strategy">` and the `STRAT_DESCS` object in `main.js`.

### Add real sentiment analysis

Replace the stub in `signal_sentiment()`:

```python
# Using FinBERT or any NLP API:
from transformers import pipeline
nlp = pipeline("sentiment-analysis", model="ProsusAI/finbert")
result = nlp(news_headline)[0]
sentiment_score = result["score"] if result["label"] == "positive" else 1 - result["score"]
```

### Add new sectors / stocks

Edit the `SECTORS` dict at the top of `app.py`:

```python
SECTORS["my_sector"] = {
    "name": "My New Sector",
    "color": "#123456",
    "stocks": ["TICK1", "TICK2", "TICK3"]
}
```

### Persist simulation results

Replace the in-memory flow with SQLite:

```python
import sqlite3
# See TODO comments in app.py for suggested schema
```

### Schedule automated daily runs

```python
from apscheduler.schedulers.background import BackgroundScheduler
scheduler = BackgroundScheduler()
scheduler.add_job(daily_sim_job, 'cron', hour=16, minute=30)
scheduler.start()
```

---

## Disclaimer

This is a paper trading simulator for educational purposes only.
Historical simulation performance does not predict future results.
This is not financial advice.
