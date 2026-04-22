"""
AI Sector Paper Trading Simulator
Flask backend with real Yahoo Finance data via yfinance
"""

from flask import Flask, render_template, jsonify, request, send_file
from flask_cors import CORS
import yfinance as yf
import pandas as pd
import numpy as np
import json
import os
from datetime import datetime, timedelta
import io
import xml.etree.ElementTree as ET
import urllib.request
import urllib.error
import ssl
import certifi
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

# ── Sentiment Cache ─────────────────────────────────────────────────────────
# Maps ticker -> {score: float 0-1, reasoning: str, updated_at: str}
sentiment_cache: dict = {}

# ── Stock Universe ──────────────────────────────────────────────────────────

SECTORS = {
    "semis": {
        "name": "Semiconductors",
        "color": "#185FA5",
        "stocks": ["NVDA", "AMD", "AVGO", "QCOM", "MRVL", "TSM", "INTC", "AMAT"]
    },
    "cloud_ai": {
        "name": "Cloud & AI Infrastructure",
        "color": "#0F6E56",
        "stocks": ["MSFT", "GOOGL", "AMZN", "META", "ORCL", "IBM", "SNOW", "NET"]
    },
    "ai_software": {
        "name": "AI Software",
        "color": "#534AB7",
        "stocks": ["CRM", "PLTR", "AI", "PATH", "BBAI", "SOUN", "AMBA", "CIEN"]
    },
    "robotics": {
        "name": "Robotics & Automation",
        "color": "#993C1D",
        "stocks": ["ISRG", "ROK", "ABB", "FANUY", "IRBT", "BRKS", "ONTO", "ACMR"]
    },
    "ev_auto": {
        "name": "EV & Autonomous",
        "color": "#BA7517",
        "stocks": ["TSLA", "RIVN", "LCID", "MBLY", "LAZR", "MOBILEYE", "NKLA", "FSR"]
    },
    "biotech_ai": {
        "name": "AI Biotech",
        "color": "#993556",
        "stocks": ["ILMN", "RXRX", "SDGR", "BEAM", "CRSP", "EDIT", "NTLA", "PACB"]
    }
}

# ── Market Data ─────────────────────────────────────────────────────────────

def fetch_stock_data(tickers: list, period: str = "6mo") -> dict:
    """Fetch OHLCV data for a list of tickers from Yahoo Finance."""
    data = {}
    valid_tickers = []
    
    for ticker in tickers:
        try:
            t = yf.Ticker(ticker)
            hist = t.history(period=period)
            if not hist.empty and len(hist) > 20:
                data[ticker] = {
                    "history": hist,
                    "info": t.info
                }
                valid_tickers.append(ticker)
        except Exception as e:
            print(f"Failed to fetch {ticker}: {e}")
    
    return data, valid_tickers


def compute_indicators(hist: pd.DataFrame) -> dict:
    """Compute RSI, MACD, Bollinger Bands, and volume signals."""
    close = hist["Close"]
    volume = hist["Volume"]

    # RSI(14)
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))

    # MACD
    ema12 = close.ewm(span=12).mean()
    ema26 = close.ewm(span=26).mean()
    macd = ema12 - ema26
    signal_line = macd.ewm(span=9).mean()
    macd_hist = macd - signal_line

    # Bollinger Bands (20, 2)
    ma20 = close.rolling(20).mean()
    std20 = close.rolling(20).std()
    bb_upper = ma20 + 2 * std20
    bb_lower = ma20 - 2 * std20
    bb_pct = (close - bb_lower) / (bb_upper - bb_lower)  # 0=lower band, 1=upper band

    # Moving averages
    ma50 = close.rolling(50).mean()
    ma20_val = ma20.iloc[-1] if len(ma20.dropna()) > 0 else close.iloc[-1]
    ma50_val = ma50.iloc[-1] if len(ma50.dropna()) > 0 else close.iloc[-1]

    # Volume ratio
    vol_avg = volume.rolling(20).mean()
    vol_ratio = volume / vol_avg

    latest = {
        "close": float(close.iloc[-1]),
        "rsi": float(rsi.iloc[-1]) if not np.isnan(rsi.iloc[-1]) else 50.0,
        "macd": float(macd.iloc[-1]) if not np.isnan(macd.iloc[-1]) else 0.0,
        "macd_signal": float(signal_line.iloc[-1]) if not np.isnan(signal_line.iloc[-1]) else 0.0,
        "macd_hist": float(macd_hist.iloc[-1]) if not np.isnan(macd_hist.iloc[-1]) else 0.0,
        "bb_pct": float(bb_pct.iloc[-1]) if not np.isnan(bb_pct.iloc[-1]) else 0.5,
        "bb_upper": float(bb_upper.iloc[-1]) if not np.isnan(bb_upper.iloc[-1]) else float(close.iloc[-1]),
        "bb_lower": float(bb_lower.iloc[-1]) if not np.isnan(bb_lower.iloc[-1]) else float(close.iloc[-1]),
        "ma20": float(ma20_val),
        "ma50": float(ma50_val),
        "vol_ratio": float(vol_ratio.iloc[-1]) if not np.isnan(vol_ratio.iloc[-1]) else 1.0,
        "price_history": close.tolist(),
        "volume_history": volume.tolist(),
        "dates": [str(d.date()) if hasattr(d, 'date') else str(d) for d in hist.index],
    }
    return latest


# ── Strategy Signal Generators ───────────────────────────────────────────────

def signal_momentum(ind: dict) -> dict:
    """RSI + MACD momentum strategy."""
    score = 0
    reasons = []
    rsi = ind["rsi"]
    if rsi > 55:
        score += 2
        reasons.append(f"RSI bullish ({rsi:.0f})")
    elif rsi < 45:
        score -= 2
        reasons.append(f"RSI bearish ({rsi:.0f})")
    if ind["macd"] > ind["macd_signal"]:
        score += 2
        reasons.append("MACD above signal")
    elif ind["macd"] < ind["macd_signal"]:
        score -= 2
        reasons.append("MACD below signal")
    if ind["macd_hist"] > 0:
        score += 1
        reasons.append("MACD histogram +")
    return {"score": score, "reasons": reasons, "max": 5}


def signal_mean_reversion(ind: dict) -> dict:
    """Bollinger Band mean reversion."""
    score = 0
    reasons = []
    bb = ind["bb_pct"]
    rsi = ind["rsi"]
    if bb < 0.1:
        score += 3
        reasons.append(f"BB lower band touch ({bb:.2f})")
    elif bb > 0.9:
        score -= 3
        reasons.append(f"BB upper band touch ({bb:.2f})")
    if rsi < 30:
        score += 2
        reasons.append(f"RSI oversold ({rsi:.0f})")
    elif rsi > 70:
        score -= 2
        reasons.append(f"RSI overbought ({rsi:.0f})")
    return {"score": score, "reasons": reasons, "max": 5}


def signal_breakout(ind: dict) -> dict:
    """Volume breakout detection."""
    score = 0
    reasons = []
    if ind["vol_ratio"] > 2.0:
        score += 3
        reasons.append(f"Volume surge {ind['vol_ratio']:.1f}x avg")
    elif ind["vol_ratio"] > 1.5:
        score += 1
        reasons.append(f"Volume elevated {ind['vol_ratio']:.1f}x avg")
    close = ind["close"]
    if close > ind["ma20"] * 1.02:
        score += 2
        reasons.append("Price above MA20 breakout")
    return {"score": score, "reasons": reasons, "max": 5}


def signal_trend_follow(ind: dict) -> dict:
    """MA crossover trend following."""
    score = 0
    reasons = []
    if ind["ma20"] > ind["ma50"]:
        score += 3
        reasons.append("Golden cross (MA20 > MA50)")
    else:
        score -= 3
        reasons.append("Death cross (MA20 < MA50)")
    if ind["close"] > ind["ma20"]:
        score += 2
        reasons.append("Price above MA20")
    else:
        score -= 2
        reasons.append("Price below MA20")
    return {"score": score, "reasons": reasons, "max": 5}


def signal_ai_hybrid(ind: dict) -> dict:
    """Combined multi-signal AI hybrid."""
    m = signal_momentum(ind)
    mr = signal_mean_reversion(ind)
    b = signal_breakout(ind)
    tf = signal_trend_follow(ind)
    combined = m["score"] + mr["score"] * 0.5 + b["score"] * 0.7 + tf["score"] * 0.8
    reasons = m["reasons"] + b["reasons"][:1] + tf["reasons"][:1]
    return {"score": combined, "reasons": reasons, "max": 5}


def signal_sector_rotation(ind: dict, sector_strength: float) -> dict:
    """Sector momentum rotation."""
    score = sector_strength * 5
    reasons = [f"Sector strength score {sector_strength:.2f}"]
    if ind["close"] > ind["ma20"]:
        score += 1
        reasons.append("Above MA20")
    return {"score": score, "reasons": reasons, "max": 6}


def signal_sentiment(ind: dict) -> dict:
    """Sentiment + technical combo. Uses cached AI sentiment when available."""
    ticker = ind.get("ticker")
    cached = sentiment_cache.get(ticker) if ticker else None

    if cached:
        sentiment_score = cached["score"]
        sentiment_label = cached.get("reasoning", "")[:60]
    else:
        sentiment_score = np.random.normal(0.55, 0.2)  # fallback until news fetched
        sentiment_label = f"random ({sentiment_score:.2f})"

    score = 0
    reasons = []
    if sentiment_score > 0.65:
        score += 2
        reasons.append(f"AI: Bullish sentiment ({sentiment_score:.2f}) — {sentiment_label}")
    elif sentiment_score < 0.35:
        score -= 2
        reasons.append(f"AI: Bearish sentiment ({sentiment_score:.2f}) — {sentiment_label}")
    else:
        reasons.append(f"AI: Neutral sentiment ({sentiment_score:.2f})")

    tech = signal_momentum(ind)
    score += tech["score"] * 0.5
    reasons += tech["reasons"][:1]
    return {"score": score, "reasons": reasons, "max": 4}


STRATEGY_SIGNALS = {
    "momentum": signal_momentum,
    "mean_rev": signal_mean_reversion,
    "breakout": signal_breakout,
    "trend_follow": signal_trend_follow,
    "ai_hybrid": signal_ai_hybrid,
    "sentiment": signal_sentiment,
}


# ── Simulation Engine ────────────────────────────────────────────────────────

def run_simulation(
    capital: float,
    strategy: str,
    months: int,
    risk: str,
    sector_ids: list,
    stock_data: dict
) -> dict:
    """
    Core simulation engine.
    Uses real historical price paths from Yahoo Finance.
    Replays prices day by day and applies strategy signals.
    """
    stop_loss = {"low": 0.05, "med": 0.10, "high": 0.20}[risk]
    take_profit = stop_loss * 2.5
    trade_freq = {
        "momentum": 12, "mean_rev": 9, "ai_hybrid": 11,
        "breakout": 7, "pairs": 13, "sector_rot": 6,
        "trend_follow": 5, "sentiment": 9
    }.get(strategy, 9)

    # Collect tickers for selected sectors
    tickers = []
    for sid in sector_ids:
        if sid in SECTORS:
            tickers.extend(SECTORS[sid]["stocks"])

    # Filter to tickers we actually have data for
    available = [t for t in tickers if t in stock_data]
    if not available:
        return {"error": "No valid stock data fetched"}

    # Build price series: align all tickers to common dates
    price_series = {}
    for t in available:
        hist = stock_data[t]["history"]
        price_series[t] = hist["Close"].values.tolist()

    min_len = min(len(v) for v in price_series.values())
    trading_days = min(months * 21, min_len - 1)

    positions = {}
    cash = capital
    trades = []
    equity_curve = [capital]
    per_stock_alloc = capital * 0.85 / len(available)

    # Open initial positions
    for t in available[:min(8, len(available))]:
        price = price_series[t][0]
        shares = int(per_stock_alloc / price)
        if shares > 0 and cash >= shares * price:
            positions[t] = {
                "ticker": t,
                "name": stock_data[t].get("info", {}).get("shortName", t),
                "sector": next((SECTORS[s]["name"] for s in sector_ids if t in SECTORS.get(s, {}).get("stocks", [])), "AI"),
                "shares": shares,
                "entry": price,
                "current": price,
                "high_water": price,
                "day_opened": 0
            }
            cash -= shares * price

    # Replay price history day by day
    for day in range(1, trading_days + 1):
        # Update prices and check stops
        for t in list(positions.keys()):
            if day < len(price_series[t]):
                new_price = price_series[t][day]
                positions[t]["current"] = new_price
                p = positions[t]

                if new_price > p["high_water"]:
                    p["high_water"] = new_price

                pct_change = (new_price - p["entry"]) / p["entry"]
                hit_stop = pct_change <= -stop_loss
                hit_tp = pct_change >= take_profit

                if hit_stop or hit_tp:
                    pnl = (new_price - p["entry"]) * p["shares"]
                    trades.append({
                        "day": day,
                        "action": "SELL",
                        "ticker": t,
                        "name": p["name"],
                        "sector": p["sector"],
                        "price": round(new_price, 2),
                        "shares": p["shares"],
                        "pnl": round(pnl, 2),
                        "signal": "Take profit" if hit_tp else "Stop-loss hit",
                        "strategy": strategy
                    })
                    cash += new_price * p["shares"]
                    del positions[t]

        # Generate trade signals
        if day % max(1, round(21 / trade_freq)) == 0:
            # Score available stocks
            scored = []
            for t in available:
                if t not in positions and day < len(price_series[t]) - 5:
                    window = min(60, day)
                    if window < 20:
                        continue
                    prices = price_series[t][max(0, day-window):day]
                    volumes = stock_data[t]["history"]["Volume"].values.tolist()
                    vols_window = volumes[max(0, day-window):day]

                    hist_slice = pd.DataFrame({
                        "Close": prices,
                        "Volume": vols_window[:len(prices)]
                    })
                    ind = compute_indicators(hist_slice)
                    ind["ticker"] = t

                    if strategy in STRATEGY_SIGNALS:
                        sig = STRATEGY_SIGNALS[strategy](ind)
                    else:
                        sig = signal_ai_hybrid(ind)

                    if sig["score"] > 1.5:
                        scored.append((t, sig, price_series[t][day]))

            scored.sort(key=lambda x: -x[1]["score"])

            # Buy top candidates
            for t, sig, price in scored[:2]:
                if cash < 500:
                    break
                shares = int(min(cash * 0.4, per_stock_alloc * 1.2) / price)
                if shares > 0:
                    positions[t] = {
                        "ticker": t,
                        "name": stock_data[t].get("info", {}).get("shortName", t),
                        "sector": next((SECTORS[s]["name"] for s in sector_ids if t in SECTORS.get(s, {}).get("stocks", [])), "AI"),
                        "shares": shares,
                        "entry": price,
                        "current": price,
                        "high_water": price,
                        "day_opened": day
                    }
                    cash -= shares * price
                    trades.append({
                        "day": day,
                        "action": "BUY",
                        "ticker": t,
                        "name": positions[t]["name"],
                        "sector": positions[t]["sector"],
                        "price": round(price, 2),
                        "shares": shares,
                        "pnl": 0,
                        "signal": "; ".join(sig["reasons"][:2]),
                        "strategy": strategy
                    })

        # Equity snapshot
        port_val = cash + sum(p["shares"] * p["current"] for p in positions.values())
        equity_curve.append(port_val)

    # Final portfolio value
    final_val = cash + sum(p["shares"] * p["current"] for p in positions.values())
    ret = (final_val - capital) / capital

    # Performance metrics
    sells = [t for t in trades if t["action"] == "SELL"]
    wins = [t for t in sells if t["pnl"] > 0]
    daily_rets = [(equity_curve[i] - equity_curve[i-1]) / equity_curve[i-1]
                  for i in range(1, len(equity_curve)) if equity_curve[i-1] > 0]
    avg_r = np.mean(daily_rets) if daily_rets else 0
    std_r = np.std(daily_rets) if daily_rets else 1e-9
    sharpe = (avg_r / std_r) * np.sqrt(252) if std_r > 0 else 0
    peak = capital
    max_dd = 0
    for v in equity_curve:
        if v > peak:
            peak = v
        dd = (peak - v) / peak
        if dd > max_dd:
            max_dd = dd

    # Indicator snapshots for signal heatmap
    signal_snapshots = {}
    for t in list(positions.keys())[:10]:
        window = min(60, trading_days)
        prices = price_series[t][max(0, trading_days-window):trading_days]
        volumes = stock_data[t]["history"]["Volume"].values.tolist()
        vols_w = volumes[max(0, trading_days-window):trading_days]
        hist_slice = pd.DataFrame({"Close": prices, "Volume": vols_w[:len(prices)]})
        ind = compute_indicators(hist_slice)
        signal_snapshots[t] = {
            "rsi": round(ind["rsi"], 1),
            "macd_hist": round(ind["macd_hist"], 4),
            "bb_pct": round(ind["bb_pct"] * 100, 1),
            "vol_ratio": round(ind["vol_ratio"], 2),
            "ma_cross": round((ind["ma20"] - ind["ma50"]) / ind["ma50"] * 100, 2) if ind["ma50"] > 0 else 0,
        }

    return {
        "final_val": round(final_val, 2),
        "capital": capital,
        "return": round(ret * 100, 2),
        "return_dollar": round(final_val - capital, 2),
        "sharpe": round(sharpe, 2),
        "win_rate": round(len(wins) / max(1, len(sells)) * 100, 1),
        "max_drawdown": round(max_dd * 100, 2),
        "total_trades": len(trades),
        "closed_trades": len(sells),
        "winning_trades": len(wins),
        "trades": trades,
        "positions": list(positions.values()),
        "equity_curve": [round(v, 2) for v in equity_curve],
        "daily_pnl": [round(equity_curve[i] - equity_curve[i-1], 2) for i in range(1, len(equity_curve))],
        "signal_snapshots": signal_snapshots,
        "trading_days": trading_days,
    }


# ── News & AI Research ──────────────────────────────────────────────────────

YAHOO_RSS_URL = "https://feeds.finance.yahoo.com/rss/2.0/headline?s={ticker}&region=US&lang=en-US"
RSS_NAMESPACE = "{http://www.w3.org/2005/Atom}"


def fetch_yahoo_rss(tickers: list, max_per_ticker: int = 5) -> dict:
    """Fetch latest news headlines from Yahoo Finance RSS for each ticker."""
    headlines = {}
    ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    for ticker in tickers:
        try:
            url = YAHOO_RSS_URL.format(ticker=ticker)
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=8, context=ssl_ctx) as resp:
                xml_data = resp.read()
            root = ET.fromstring(xml_data)
            channel = root.find("channel")
            if channel is None:
                continue
            items = channel.findall("item")[:max_per_ticker]
            ticker_headlines = []
            for item in items:
                title_el = item.find("title")
                pub_el = item.find("pubDate")
                if title_el is not None and title_el.text:
                    ticker_headlines.append({
                        "title": title_el.text.strip(),
                        "pubDate": pub_el.text.strip() if pub_el is not None else ""
                    })
            if ticker_headlines:
                headlines[ticker] = ticker_headlines
        except Exception as e:
            print(f"RSS fetch failed for {ticker}: {e}")
    return headlines


def analyze_with_openai(headlines_by_ticker: dict, sector_ids: list) -> dict:
    """Send headlines to OpenAI GPT and get structured sentiment analysis."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is not set")

    try:
        from openai import OpenAI
    except ImportError:
        raise ImportError("openai package not installed — run: pip install openai>=1.0.0")

    client = OpenAI(api_key=api_key)

    sector_names = [SECTORS[s]["name"] for s in sector_ids if s in SECTORS]

    # Build compact headline text
    headline_lines = []
    for ticker, items in headlines_by_ticker.items():
        for h in items:
            headline_lines.append(f"{ticker}: {h['title']}")

    headline_text = "\n".join(headline_lines) if headline_lines else "No headlines available."

    prompt = f"""You are a financial analyst specializing in AI and technology stocks.

Analyze the following recent news headlines for stocks in these sectors: {', '.join(sector_names)}.

Headlines:
{headline_text}

Return ONLY a valid JSON object with this exact structure:
{{
  "tickers": [
    {{"ticker": "NVDA", "score": 0.75, "reasoning": "brief one-sentence reason"}}
  ],
  "sector_summaries": [
    {{"sector": "Semiconductors", "outlook": "bullish", "summary": "one or two sentence summary"}}
  ],
  "market_themes": ["theme 1", "theme 2", "theme 3"]
}}

Rules:
- score is a float from 0.0 (very bearish) to 1.0 (very bullish), 0.5 = neutral
- Only include tickers that appear in the headlines
- outlook must be exactly: "bullish", "neutral", or "bearish"
- Return 2-4 market themes
- No markdown, no extra keys, no explanation outside the JSON"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=1200,
    )

    raw = response.choices[0].message.content.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        if raw.endswith("```"):
            raw = raw[:-3]

    analysis = json.loads(raw)

    # Validate minimal structure
    if "tickers" not in analysis or "sector_summaries" not in analysis:
        raise ValueError("Unexpected response structure from OpenAI")

    return analysis


@app.route("/api/news", methods=["POST"])
def api_news():
    """Fetch Yahoo Finance RSS headlines and analyze with OpenAI."""
    body = request.json or {}
    sector_ids = body.get("sectors", list(SECTORS.keys()))

    # Collect tickers from requested sectors
    tickers = []
    for sid in sector_ids:
        if sid in SECTORS:
            tickers.extend(SECTORS[sid]["stocks"])
    tickers = list(dict.fromkeys(tickers))  # deduplicate

    # 1. Fetch RSS headlines
    try:
        headlines = fetch_yahoo_rss(tickers)
    except Exception as e:
        return jsonify({"error": f"RSS fetch failed: {str(e)}"}), 500

    if not headlines:
        return jsonify({"error": "No headlines found for the selected sectors"}), 404

    # 2. Analyze with OpenAI
    try:
        analysis = analyze_with_openai(headlines, sector_ids)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"AI analysis failed: {str(e)}"}), 500

    # 3. Update sentiment cache
    now_str = datetime.now().isoformat()
    for item in analysis.get("tickers", []):
        ticker = item.get("ticker")
        if ticker:
            sentiment_cache[ticker] = {
                "score": float(item.get("score", 0.5)),
                "reasoning": item.get("reasoning", ""),
                "updated_at": now_str,
            }

    return jsonify({
        "news": headlines,
        "analysis": analysis,
        "cached_at": now_str,
        "tickers_analyzed": len(analysis.get("tickers", [])),
        "headlines_fetched": sum(len(v) for v in headlines.values()),
    })


# ── Excel Export ─────────────────────────────────────────────────────────────

def generate_excel(result: dict, strategy: str, sector_ids: list) -> bytes:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    hdr_fill = PatternFill("solid", start_color="0C447C")
    hdr_font = Font(bold=True, color="FFFFFF", size=10)
    body_font = Font(size=10)
    buy_fill = PatternFill("solid", start_color="E1F5EE")
    sell_fill = PatternFill("solid", start_color="FCEBEB")
    border = Border(bottom=Side(style="thin", color="DDDDDD"))

    def style_header(ws, row=1):
        for cell in ws[row]:
            cell.fill = hdr_fill
            cell.font = hdr_font

    def set_widths(ws, widths):
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w

    # Sheet 1: Summary
    ws = wb.active
    ws.title = "Summary"
    ws["A1"] = "AI Sector Paper Trading — Simulation Report"
    ws["A1"].font = Font(bold=True, size=14, color="0C447C")
    ws.merge_cells("A1:D1")
    ws["A2"] = f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}   Strategy: {strategy}   Capital: ${result['capital']:,.0f}"
    ws["A2"].font = Font(size=10, color="888888")
    ws.merge_cells("A2:D2")
    ws.append([])
    ws.append(["Metric", "Value"])
    style_header(ws, 4)
    for row in [
        ("Starting capital", f"${result['capital']:,.2f}"),
        ("Final portfolio value", f"${result['final_val']:,.2f}"),
        ("Total return", f"{result['return']:+.2f}%"),
        ("Total P&L", f"${result['return_dollar']:+,.2f}"),
        ("Sharpe ratio", result["sharpe"]),
        ("Win rate", f"{result['win_rate']:.1f}%"),
        ("Max drawdown", f"-{result['max_drawdown']:.2f}%"),
        ("Total trades", result["total_trades"]),
        ("Closed trades", result["closed_trades"]),
        ("Winning trades", result["winning_trades"]),
    ]:
        ws.append(list(row))
        for c in ws[ws.max_row]:
            c.font = body_font
            c.border = border
    set_widths(ws, [28, 20])

    # Sheet 2: Trade Log
    ws2 = wb.create_sheet("Trade Log")
    ws2.append(["Day", "Action", "Ticker", "Company", "Sector", "Price ($)", "Shares", "P&L ($)", "Signal", "Strategy"])
    style_header(ws2)
    for t in result["trades"]:
        row = [t["day"], t["action"], t["ticker"], t["name"], t["sector"],
               t["price"], t["shares"],
               t["pnl"] if t["action"] == "SELL" else "",
               t["signal"], t["strategy"]]
        ws2.append(row)
        fill = sell_fill if t["action"] == "SELL" else buy_fill
        for c in ws2[ws2.max_row]:
            c.fill = fill
            c.font = body_font
    set_widths(ws2, [6, 8, 8, 20, 22, 12, 8, 12, 32, 16])

    # Sheet 3: Equity Curve
    ws3 = wb.create_sheet("Equity Curve")
    ws3.append(["Day", "Portfolio Value ($)", "Daily P&L ($)", "Cumulative Return (%)"])
    style_header(ws3)
    capital = result["capital"]
    for i, v in enumerate(result["equity_curve"]):
        dpnl = result["daily_pnl"][i-1] if i > 0 else 0
        ret_pct = (v - capital) / capital * 100
        ws3.append([i, round(v, 2), round(dpnl, 2), round(ret_pct, 4)])
        for c in ws3[ws3.max_row]:
            c.font = body_font
    set_widths(ws3, [8, 22, 16, 22])

    # Sheet 4: Open Positions
    ws4 = wb.create_sheet("Open Positions")
    ws4.append(["Ticker", "Company", "Sector", "Shares", "Entry ($)", "Current ($)", "Unrealized P&L ($)", "Return (%)"])
    style_header(ws4)
    for p in result["positions"]:
        pnl = (p["current"] - p["entry"]) * p["shares"]
        ret_pct = (p["current"] - p["entry"]) / p["entry"] * 100 if p["entry"] > 0 else 0
        ws4.append([p["ticker"], p.get("name", ""), p.get("sector", ""),
                    p["shares"], round(p["entry"], 2), round(p["current"], 2),
                    round(pnl, 2), round(ret_pct, 2)])
        for c in ws4[ws4.max_row]:
            c.font = body_font
    set_widths(ws4, [8, 20, 22, 8, 12, 12, 20, 12])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html", sectors=SECTORS)


@app.route("/api/sectors")
def api_sectors():
    return jsonify(SECTORS)


@app.route("/api/simulate", methods=["POST"])
def api_simulate():
    body = request.json
    capital = float(body.get("capital", 10000))
    strategy = body.get("strategy", "ai_hybrid")
    months = int(body.get("months", 3))
    risk = body.get("risk", "med")
    sector_ids = body.get("sectors", ["semis", "cloud_ai"])

    # Collect tickers
    tickers = []
    for sid in sector_ids:
        if sid in SECTORS:
            tickers.extend(SECTORS[sid]["stocks"])
    tickers = list(dict.fromkeys(tickers))  # deduplicate, preserve order

    # Fetch real data
    stock_data, valid = fetch_stock_data(tickers, period=f"{max(months*2, 3)}mo")

    if not valid:
        return jsonify({"error": "Could not fetch any stock data. Check your internet connection."}), 500

    result = run_simulation(capital, strategy, months, risk, sector_ids, stock_data)

    if "error" in result:
        return jsonify(result), 500

    return jsonify(result)


@app.route("/api/quote/<ticker>")
def api_quote(ticker):
    """Get latest quote + indicators for a single ticker."""
    try:
        t = yf.Ticker(ticker.upper())
        hist = t.history(period="3mo")
        if hist.empty:
            return jsonify({"error": "No data"}), 404
        ind = compute_indicators(hist)
        info = t.info
        return jsonify({
            "ticker": ticker.upper(),
            "name": info.get("shortName", ticker),
            "price": ind["close"],
            "rsi": round(ind["rsi"], 1),
            "macd_hist": round(ind["macd_hist"], 4),
            "bb_pct": round(ind["bb_pct"], 3),
            "vol_ratio": round(ind["vol_ratio"], 2),
            "ma20": round(ind["ma20"], 2),
            "ma50": round(ind["ma50"], 2),
            "price_history": ind["price_history"][-60:],
            "dates": ind["dates"][-60:],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/export", methods=["POST"])
def api_export():
    body = request.json
    result = body.get("result")
    strategy = body.get("strategy", "ai_hybrid")
    sectors = body.get("sectors", [])

    if not result:
        return jsonify({"error": "No result data"}), 400

    xlsx_bytes = generate_excel(result, strategy, sectors)
    return send_file(
        io.BytesIO(xlsx_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=f"ai_trading_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    )


if __name__ == "__main__":
    print("=" * 60)
    print("  AI Sector Paper Trading Simulator")
    print("  http://localhost:8080")
    print("=" * 60)
    app.run(debug=True, port=8080)
