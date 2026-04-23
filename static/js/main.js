/* ── AI Sector Trading Simulator — Frontend JS ── */

const STRAT_DESCS = {
  ai_hybrid:    "AI Hybrid combines Claude-style multi-factor signals: RSI, MACD, Bollinger Bands, volume ratio, and MA crossover. Trades when 3+ signals align. Medium-frequency: 8–15 trades/month.",
  momentum:     "Momentum tracks RSI(14) divergence and MACD signal-line crossovers. Buys positive momentum, sells when signals reverse. High-frequency: 12–18 trades/month.",
  mean_rev:     "Mean Reversion fades extremes using Bollinger Bands (20,2). Buys oversold dips below lower band, sells overbought spikes above upper band. Medium: 8–12 trades/month.",
  breakout:     "Breakout detects volume surges (2× average) coinciding with price clearing recent highs. Strong conviction trades held until momentum fades. Low: 6–10 trades/month.",
  trend_follow: "Trend Following uses 20/50-day MA crossovers. Golden cross triggers buy; death cross triggers sell. Rides longer trends with wider stops. Low: 4–8 trades/month.",
  sentiment:    "Sentiment + Technicals combines NLP sentiment scores with RSI confirmation. Only enters when both agree. Plug your own NLP into signal_sentiment() in app.py. Medium: 6–12 trades/month.",
};

let selectedSectors = new Set(["semis", "cloud_ai", "ai_software"]);
let selectedNewsSectors = new Set(["semis", "cloud_ai", "ai_software"]);
let lastResult = null;
let lastStrategy = "ai_hybrid";
let lastSectors = [];
let charts = {};

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  const res = await fetch("/api/sectors");
  const sectors = await res.json();

  const grid = document.getElementById("sector-grid");
  Object.entries(sectors).forEach(([id, sec]) => {
    const pill = document.createElement("div");
    pill.className = "sector-pill" + (selectedSectors.has(id) ? " on" : "");
    pill.id = "sp-" + id;
    pill.innerHTML = `<span class="sp-name">${sec.name}</span><span class="sp-tickers">${sec.stocks.slice(0,4).join(" · ")}</span>`;
    pill.onclick = () => toggleSector(id);
    grid.appendChild(pill);
  });

  // Build news sector picker
  const newsGrid = document.getElementById("news-sector-grid");
  if (newsGrid) {
    Object.entries(sectors).forEach(([id, sec]) => {
      const pill = document.createElement("div");
      pill.className = "sector-pill" + (selectedNewsSectors.has(id) ? " on" : "");
      pill.id = "nsp-" + id;
      pill.innerHTML = `<span class="sp-name">${sec.name}</span><span class="sp-tickers">${sec.stocks.slice(0,4).join(" · ")}</span>`;
      pill.onclick = () => toggleNewsSector(id);
      newsGrid.appendChild(pill);
    });
  }

  updateStratDesc();
  document.getElementById("strategy").addEventListener("change", updateStratDesc);

  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
      link.classList.add("active");
      // Scroll to the clicked section
      const pane = document.getElementById("tab-" + link.dataset.tab);
      if (pane) pane.scrollIntoView({ behavior: "smooth", block: "start" });
      if (link.dataset.tab === "portfolio") loadPortfolio();
      if (link.dataset.tab === "tradelog")  loadTradeLog();
    });
  });

  // Portfolio inner tabs
  document.querySelectorAll(".ptab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".ptab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".ptab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("ptab-" + btn.dataset.ptab).classList.add("active");
    });
  });

  document.querySelectorAll(".itab").forEach(btn => {
    btn.addEventListener("click", () => switchItab(btn.dataset.itab));
  });

  document.getElementById("btn-run").onclick = runSimulation;
  document.getElementById("btn-export").onclick = exportExcel;

  // Always load portfolio data on page load (data lives in DB, survives refresh)
  loadPortfolio();
  // Pre-load all sectors for the Stock Picker
  loadAllSectors();
}

function toggleSector(id) {
  if (selectedSectors.has(id)) {
    if (selectedSectors.size <= 1) return;
    selectedSectors.delete(id);
    document.getElementById("sp-" + id).classList.remove("on");
  } else {
    if (selectedSectors.size >= 4) {
      const first = [...selectedSectors][0];
      selectedSectors.delete(first);
      document.getElementById("sp-" + first).classList.remove("on");
    }
    selectedSectors.add(id);
    document.getElementById("sp-" + id).classList.add("on");
  }
}

function toggleNewsSector(id) {
  if (selectedNewsSectors.has(id)) {
    if (selectedNewsSectors.size <= 1) return;
    selectedNewsSectors.delete(id);
    document.getElementById("nsp-" + id).classList.remove("on");
  } else {
    if (selectedNewsSectors.size >= 4) {
      const first = [...selectedNewsSectors][0];
      selectedNewsSectors.delete(first);
      document.getElementById("nsp-" + first).classList.remove("on");
    }
    selectedNewsSectors.add(id);
    document.getElementById("nsp-" + id).classList.add("on");
  }
}

function updateStratDesc() {
  const s = document.getElementById("strategy").value;
  document.getElementById("strat-desc").textContent = STRAT_DESCS[s] || "";
}

function switchItab(name) {
  document.querySelectorAll(".itab").forEach((b, i) => {
    b.classList.toggle("active", ["positions","trades","chart","signals"][i] === name);
  });
  document.querySelectorAll(".itab-pane").forEach(p => p.classList.remove("active"));
  document.getElementById("itab-" + name).classList.add("active");
}

// ── Simulation ────────────────────────────────────────────────────────────

async function runSimulation() {
  const btn = document.getElementById("btn-run");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Fetching real data from Yahoo Finance...';
  document.getElementById("ai-panel").innerHTML = '<span class="spinner"></span> Fetching price history, computing indicators, and replaying historical prices...';

  const capital = parseFloat(document.getElementById("capital").value) || 10000;
  const strategy = document.getElementById("strategy").value;
  const months = parseInt(document.getElementById("duration").value);
  const risk = document.getElementById("risk").value;
  const sectors = [...selectedSectors];

  lastStrategy = strategy;
  lastSectors = sectors;

  try {
    const res = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capital, strategy, months, risk, sectors })
    });
    const data = await res.json();

    if (data.error) {
      document.getElementById("ai-panel").innerHTML = `<strong style="color:var(--red)">Error:</strong> ${data.error}`;
      btn.disabled = false;
      btn.textContent = "Run simulation with real data";
      return;
    }

    lastResult = data;
    renderResults(data, capital, strategy, months);
    document.getElementById("btn-export").disabled = false;
  } catch (err) {
    document.getElementById("ai-panel").innerHTML = `<strong style="color:var(--red)">Network error:</strong> ${err.message}. Is the Flask server running?`;
  }

  btn.disabled = false;
  btn.textContent = "Re-run simulation";
}

// ── Render ────────────────────────────────────────────────────────────────

function f2(n) { return parseFloat(n.toFixed(2)); }
function fUSD(n) { return (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fPct(n) { return (n >= 0 ? "+" : "") + f2(n) + "%"; }

function renderResults(r, capital, strategy, months) {
  document.getElementById("m-val").textContent = fUSD(r.final_val);
  const rv = document.getElementById("m-ret");
  rv.textContent = fPct(r.return);
  rv.className = "metric-val " + (r.return >= 0 ? "up" : "down");
  document.getElementById("m-sharpe").textContent = f2(r.sharpe);
  document.getElementById("m-win").textContent = r.win_rate + "%";
  document.getElementById("m-dd").textContent = "-" + f2(r.max_drawdown) + "%";

  const stratLabel = document.getElementById("strategy").options[document.getElementById("strategy").selectedIndex].text;
  const sectorNames = lastSectors.join(", ");
  const gain = r.return >= 0;
  document.getElementById("ai-panel").innerHTML =
    `<strong>Real data simulation complete — ${stratLabel}:</strong> Over <strong>${months} month${months > 1 ? "s" : ""}</strong>, portfolio ${gain ? "gained" : "lost"} <strong style="color:var(--${gain ? "green" : "red"})">${fPct(r.return)}</strong> (${fUSD(r.return_dollar)}). Sharpe: <strong>${f2(r.sharpe)}</strong> · Max drawdown: <strong>-${f2(r.max_drawdown)}%</strong> · <strong>${r.total_trades}</strong> trades · <strong>${r.win_rate}%</strong> win rate on ${r.closed_trades} closed positions.`;

  renderPositions(r.positions);
  renderTrades(r.trades);
  renderCharts(r, capital);
  renderSignals(r.signal_snapshots);
}

function renderPositions(positions) {
  const tbody = document.getElementById("pos-body");
  if (!positions || !positions.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-msg">All positions closed</td></tr>';
    return;
  }
  tbody.innerHTML = positions.map(p => {
    const pnl = (p.current - p.entry) * p.shares;
    const pct = (p.current - p.entry) / p.entry * 100;
    const color = pnl >= 0 ? "var(--green)" : "var(--red)";
    return `<tr>
      <td style="font-weight:700;font-family:var(--font-mono)">${p.ticker}</td>
      <td style="color:var(--text-muted)">${p.name || ""}</td>
      <td style="color:var(--text-muted)">${p.sector || ""}</td>
      <td>${p.shares}</td>
      <td>$${f2(p.entry)}</td>
      <td>$${f2(p.current)}</td>
      <td style="color:${color};font-weight:600">${fUSD(pnl)}</td>
      <td style="color:${color}">${fPct(pct)}</td>
    </tr>`;
  }).join("");
}

function renderTrades(trades) {
  const tbody = document.getElementById("trade-body");
  if (!trades || !trades.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">No trades</td></tr>';
    return;
  }
  tbody.innerHTML = [...trades].reverse().map(t => {
    const pnlStr = t.action === "SELL"
      ? `<span style="color:${t.pnl >= 0 ? "var(--green)" : "var(--red)"};font-weight:600">${fUSD(t.pnl)}</span>`
      : `<span style="color:var(--text-faint)">—</span>`;
    return `<tr>
      <td>${t.day}</td>
      <td><span class="badge ${t.action === "BUY" ? "b-buy" : "b-sell"}">${t.action}</span></td>
      <td style="font-weight:700;font-family:var(--font-mono)">${t.ticker}</td>
      <td style="color:var(--text-muted)">${t.name || ""}</td>
      <td style="color:var(--text-muted)">${t.sector || ""}</td>
      <td>$${f2(t.price)}</td>
      <td>${t.shares}</td>
      <td>${pnlStr}</td>
      <td style="color:var(--text-muted);font-size:11px">${t.signal}</td>
    </tr>`;
  }).join("");
}

function renderCharts(r, capital) {
  const isDark = matchMedia("(prefers-color-scheme:dark)").matches;
  const gridColor = isDark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.05)";
  const tickColor = isDark ? "#666" : "#999";

  if (charts.eq) charts.eq.destroy();
  if (charts.pnl) charts.pnl.destroy();

  const lineColor = r.return >= 0 ? "#1D9E75" : "#E24B4A";
  const eqLabels = r.equity_curve.map((_, i) => i % 10 === 0 ? `Day ${i}` : "");

  charts.eq = new Chart(document.getElementById("eq-chart"), {
    type: "line",
    data: {
      labels: eqLabels,
      datasets: [{
        data: r.equity_curve,
        borderColor: lineColor,
        borderWidth: 1.5,
        fill: true,
        backgroundColor: lineColor + "18",
        pointRadius: 0,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor } },
        y: { ticks: { callback: v => "$" + Math.round(v / 1000) + "k", color: tickColor, font: { size: 10 } }, grid: { color: gridColor } }
      }
    }
  });

  const buckets = new Array(24).fill(0);
  const min = Math.min(...r.daily_pnl), max = Math.max(...r.daily_pnl);
  const range = max - min || 1;
  r.daily_pnl.forEach(v => { const i = Math.min(23, Math.floor((v - min) / range * 24)); buckets[i]++; });

  charts.pnl = new Chart(document.getElementById("pnl-chart"), {
    type: "bar",
    data: {
      labels: buckets.map((_, i) => fUSD(min + i / 24 * range).replace(".00", "")),
      datasets: [{
        data: buckets,
        backgroundColor: buckets.map((_, i) => i < 12 ? "#F09595" : "#5DCAA5"),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor } }
      }
    }
  });
}

function renderSignals(snapshots) {
  const grid = document.getElementById("signal-grid");
  if (!snapshots || !Object.keys(snapshots).length) {
    grid.innerHTML = '<p style="color:var(--text-faint);padding:12px 0">No open position signals</p>';
    return;
  }

  const SIGNAL_MAP = [
    { key: "rsi", label: "RSI", max: 100 },
    { key: "bb_pct", label: "BB %", max: 100 },
    { key: "vol_ratio", label: "Vol ratio", max: 5 },
    { key: "ma_cross", label: "MA cross %", max: 10, offset: 5 },
  ];

  grid.innerHTML = Object.entries(snapshots).map(([ticker, sig]) => {
    const bars = SIGNAL_MAP.map(s => {
      const raw = sig[s.key] ?? 50;
      const pct = s.offset
        ? Math.min(100, Math.max(0, (raw + s.offset) / (s.max) * 100))
        : Math.min(100, Math.max(0, raw / s.max * 100));
      const barColor = pct > 65 ? "#1D9E75" : pct < 35 ? "#E24B4A" : "#185FA5";
      return `<div class="sig-row">
        <span class="sig-name">${s.label}</span>
        <div class="sig-bar-bg"><div class="sig-bar-fill" style="width:${pct.toFixed(1)}%;background:${barColor}"></div></div>
        <span class="sig-val">${typeof raw === 'number' ? raw.toFixed(1) : raw}</span>
      </div>`;
    }).join("");

    return `<div class="sig-card">
      <div class="sig-ticker">${ticker}</div>
      ${bars}
    </div>`;
  }).join("");
}

// ── Export ────────────────────────────────────────────────────────────────

async function exportExcel() {
  if (!lastResult) return;
  const btn = document.getElementById("btn-export");
  btn.disabled = true;
  btn.textContent = "Generating...";

  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: lastResult, strategy: lastStrategy, sectors: lastSectors })
    });

    if (!res.ok) throw new Error("Export failed");

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai_trading_${new Date().toISOString().slice(0,10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("Export error: " + err.message);
  }

  btn.disabled = false;
  btn.textContent = "Export Excel";
}

// ── Screener ──────────────────────────────────────────────────────────────

async function screenTicker() {
  const ticker = document.getElementById("screen-ticker").value.trim().toUpperCase();
  if (!ticker) return;

  const resultDiv = document.getElementById("screener-result");
  resultDiv.style.display = "block";
  resultDiv.innerHTML = '<span class="spinner"></span> Fetching live data...';

  try {
    const res = await fetch("/api/quote/" + ticker);
    const d = await res.json();

    if (d.error) { resultDiv.innerHTML = `<span style="color:var(--red)">${d.error}</span>`; return; }

    const rsiColor = d.rsi > 70 ? "var(--red)" : d.rsi < 30 ? "var(--green)" : "var(--text)";
    const bbColor = d.bb_pct > 0.8 ? "var(--red)" : d.bb_pct < 0.2 ? "var(--green)" : "var(--text)";

    resultDiv.innerHTML = `
      <div style="margin-bottom:12px">
        <span style="font-size:18px;font-weight:700;font-family:var(--font-mono)">${d.ticker}</span>
        <span style="color:var(--text-muted);margin-left:8px">${d.name}</span>
        <span style="font-size:20px;font-weight:700;margin-left:16px">$${d.price.toFixed(2)}</span>
      </div>
      <div class="screener-result-card">
        <div class="sq-metric"><div class="sq-label">RSI (14)</div><div class="sq-val" style="color:${rsiColor}">${d.rsi}</div></div>
        <div class="sq-metric"><div class="sq-label">MACD histogram</div><div class="sq-val" style="color:${d.macd_hist>0?'var(--green)':'var(--red)'}">${d.macd_hist.toFixed(4)}</div></div>
        <div class="sq-metric"><div class="sq-label">BB position</div><div class="sq-val" style="color:${bbColor}">${(d.bb_pct*100).toFixed(1)}%</div></div>
        <div class="sq-metric"><div class="sq-label">Volume ratio</div><div class="sq-val" style="color:${d.vol_ratio>2?'var(--green)':'var(--text)'}">${d.vol_ratio}x</div></div>
        <div class="sq-metric"><div class="sq-label">MA 20</div><div class="sq-val">$${d.ma20}</div></div>
        <div class="sq-metric"><div class="sq-label">MA 50</div><div class="sq-val">$${d.ma50}</div></div>
      </div>
    `;
  } catch (err) {
    resultDiv.innerHTML = `<span style="color:var(--red)">Error: ${err.message}</span>`;
  }
}

document.addEventListener("DOMContentLoaded", init);

// ── Market News ─────────────────────────────────────────────────────────────

async function fetchMarketNews() {
  const btn = document.getElementById("btn-fetch-news");
  const status = document.getElementById("news-status");
  const resultsEl = document.getElementById("news-results");

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Fetching headlines & analyzing...';
  status.innerHTML = '<span class="spinner"></span> Fetching Yahoo Finance RSS headlines and running GPT-4o-mini analysis…';
  resultsEl.style.display = "none";

  const sectors = [...selectedNewsSectors];

  try {
    const res = await fetch("/api/news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectors })
    });
    const data = await res.json();

    if (data.error) {
      status.innerHTML = `<strong style="color:var(--red)">Error:</strong> ${escHtml(data.error)}`;
      btn.disabled = false;
      btn.textContent = "Fetch News & AI Research";
      return;
    }

    const ts = new Date(data.cached_at).toLocaleTimeString();
    status.innerHTML =
      `✅ Analysis complete at <strong>${ts}</strong> — <strong>${data.headlines_fetched}</strong> headlines across <strong>${data.tickers_analyzed}</strong> tickers. ` +
      `Sentiment scores stored — run the <strong>Sentiment + Technicals</strong> strategy to use them.`;

    renderNewsResults(data);
  } catch (err) {
    status.innerHTML = `<strong style="color:var(--red)">Network error:</strong> ${escHtml(err.message)}. Is the Flask server running?`;
  }

  btn.disabled = false;
  btn.textContent = "Refresh News & AI Research";
}

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function renderNewsResults(data) {
  const analysis = data.analysis;
  const news = data.news;

  // Market themes
  const themesEl = document.getElementById("news-themes");
  const themes = analysis.market_themes || [];
  themesEl.innerHTML = themes.map(t => `<span class="theme-chip">${escHtml(t)}</span>`).join("");

  // Sector summaries
  const sectorsEl = document.getElementById("news-sectors");
  const summaries = analysis.sector_summaries || [];
  sectorsEl.innerHTML = summaries.map(s => {
    const outlookClass = s.outlook === "bullish" ? "badge-bull" : s.outlook === "bearish" ? "badge-bear" : "badge-neut";
    return `<div class="news-card">
      <div class="news-card-header">
        <span class="news-card-title">${escHtml(s.sector)}</span>
        <span class="sentiment-badge ${outlookClass}">${escHtml(s.outlook)}</span>
      </div>
      <p class="news-card-summary">${escHtml(s.summary)}</p>
    </div>`;
  }).join("");

  // Per-ticker sentiment
  const tickersEl = document.getElementById("news-tickers");
  const tickers = analysis.tickers || [];
  if (!tickers.length) {
    tickersEl.innerHTML = '<p style="color:var(--text-faint)">No per-ticker data returned.</p>';
  } else {
    tickersEl.innerHTML = tickers.map(item => {
      const score = parseFloat(item.score) || 0.5;
      const pct = Math.round(score * 100);
      const barColor = score > 0.65 ? "var(--green)" : score < 0.35 ? "var(--red)" : "var(--blue)";
      const badgeClass = score > 0.65 ? "badge-bull" : score < 0.35 ? "badge-bear" : "badge-neut";
      const headlines = news[item.ticker] || [];
      const headlineHtml = headlines.map(h =>
        `<li class="news-headline-item">${escHtml(h.title)}<span class="news-pub-date">${escHtml(h.pubDate.slice(0,16))}</span></li>`
      ).join("");
      return `<div class="ticker-news-row">
        <div class="ticker-news-header">
          <span class="ticker-news-symbol">${escHtml(item.ticker)}</span>
          <span class="sentiment-badge ${badgeClass}">${score.toFixed(2)}</span>
          <div class="score-bar-wrap"><div class="score-bar" style="width:${pct}%;background:${barColor}"></div></div>
        </div>
        <p class="ticker-news-reasoning">${escHtml(item.reasoning || "")}</p>
        ${headlineHtml ? `<ul class="news-headlines-list">${headlineHtml}</ul>` : ""}
      </div>`;
    }).join("");
  }

  document.getElementById("news-results").style.display = "block";
}

// ── Portfolio Tab ─────────────────────────────────────────────────────────────

let portEqChart = null;

async function loadPortfolio() {
  const statusEl = document.getElementById("port-status");
  statusEl.innerHTML = '<span class="spinner"></span> Loading&hellip;';

  try {
    const [portRes, histRes] = await Promise.all([
      fetch("/api/portfolio"),
      fetch("/api/history"),
    ]);
    const port = await portRes.json();
    const hist = await histRes.json();

    if (port.error) { statusEl.innerHTML = `<span style="color:var(--red)">${escHtml(port.error)}</span>`; return; }

    // Metrics
    const retGain = port.return_pct >= 0;
    document.getElementById("pm-val").textContent  = fUSD(port.total_value);
    const pmRet = document.getElementById("pm-ret");
    pmRet.textContent = fPct(port.return_pct);
    pmRet.className   = "metric-val " + (retGain ? "up" : "down");
    document.getElementById("pm-cash").textContent = fUSD(port.cash);
    document.getElementById("pm-win").textContent  = hist.win_rate + "%";
    const pmPnl = document.getElementById("pm-pnl");
    pmPnl.textContent = fUSD(hist.total_pnl);
    pmPnl.className   = "metric-val " + (hist.total_pnl >= 0 ? "up" : "down");

    const ts = new Date().toLocaleTimeString();
    const startedAt = port.started_at ? ` &middot; Started: <strong>${escHtml(port.started_at)}</strong>` : "";
    statusEl.innerHTML =
      `&#x1F4CA; <strong>Portfolio value: ${fUSD(port.total_value)}</strong>  Return: ` +
      `<strong style="color:var(--${retGain ? "green" : "red"})">${fPct(port.return_pct)} (${fUSD(port.return_dollar)})</strong>` +
      `  Initial capital: <strong>${fUSD(port.initial)}</strong>${startedAt}  &middot; Updated: ${ts}`;

    // Positions table
    renderPortPositions(port.positions);

    // Trade history table
    renderPortHistory(hist.trades);

    // Equity curve
    renderPortEquity(port.daily_runs, port.initial);

  } catch (err) {
    statusEl.innerHTML = `<strong style="color:var(--red)">Error:</strong> ${escHtml(err.message)}`;
  }
}

function renderPortPositions(positions) {
  const tbody = document.getElementById("port-pos-body");
  if (!positions || !positions.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-msg">No open positions yet.</td></tr>';
    return;
  }
  tbody.innerHTML = positions.map(p => {
    const color = p.pnl >= 0 ? "var(--green)" : "var(--red)";
    return `<tr>
      <td style="font-weight:700;font-family:var(--font-mono)">${p.ticker}</td>
      <td style="color:var(--text-muted)">${escHtml(p.name)}</td>
      <td style="color:var(--text-muted)">${escHtml(p.sector)}</td>
      <td>${p.shares}</td>
      <td>$${f2(p.entry)}</td>
      <td>$${f2(p.current)}</td>
      <td style="font-weight:600">$${f2(p.market_value)}</td>
      <td style="color:${color};font-weight:600">${fUSD(p.pnl)}</td>
      <td style="color:${color}">${fPct(p.pct)}</td>
      <td style="color:var(--text-faint);font-size:11px">${escHtml(p.date_opened)}</td>
    </tr>`;
  }).join("");
}

function renderPortHistory(trades) {
  const tbody = document.getElementById("port-hist-body");
  if (!trades || !trades.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">No trades yet.</td></tr>';
    return;
  }
  tbody.innerHTML = trades.map(t => {
    const pnlStr = t.action === "SELL"
      ? `<span style="color:${t.pnl >= 0 ? "var(--green)" : "var(--red)"};font-weight:600">${fUSD(t.pnl)}</span>`
      : `<span style="color:var(--text-faint)">—</span>`;
    return `<tr>
      <td style="font-size:11px;color:var(--text-muted)">${escHtml(t.date)}</td>
      <td><span class="badge ${t.action === "BUY" ? "b-buy" : "b-sell"}">${t.action}</span></td>
      <td style="font-weight:700;font-family:var(--font-mono)">${escHtml(t.ticker)}</td>
      <td style="color:var(--text-muted)">${escHtml(t.name || "")}</td>
      <td style="color:var(--text-muted)">${escHtml(t.sector || "")}</td>
      <td>$${f2(t.price)}</td>
      <td>${t.shares}</td>
      <td>${pnlStr}</td>
      <td style="color:var(--text-muted);font-size:11px">${escHtml(t.signal || "")}</td>
    </tr>`;
  }).join("");
}

function renderPortEquity(runs, initial) {
  if (portEqChart) { portEqChart.destroy(); portEqChart = null; }
  const canvas = document.getElementById("port-eq-chart");
  if (!runs || !runs.length) {
    canvas.parentElement.innerHTML = '<p style="color:var(--text-faint);padding:20px">No daily snapshots yet. Run the auto-trader once to see the equity curve.</p>';
    return;
  }
  const isDark  = matchMedia("(prefers-color-scheme:dark)").matches;
  const gridCol = isDark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.05)";
  const tickCol = isDark ? "#666" : "#999";
  const lastVal = runs[runs.length - 1].portfolio_value;
  const lineCol = lastVal >= initial ? "#1D9E75" : "#E24B4A";

  portEqChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: runs.map(r => r.date),
      datasets: [
        {
          label: "Portfolio Value",
          data: runs.map(r => r.portfolio_value),
          borderColor: lineCol,
          borderWidth: 2,
          fill: true,
          backgroundColor: lineCol + "18",
          pointRadius: runs.length < 30 ? 3 : 0,
          tension: 0.3,
        },
        {
          label: "Initial Capital",
          data: runs.map(() => initial),
          borderColor: "rgba(100,100,100,.4)",
          borderWidth: 1,
          borderDash: [4, 4],
          fill: false,
          pointRadius: 0,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: tickCol, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => fUSD(ctx.parsed.y) } }
      },
      scales: {
        x: { ticks: { color: tickCol, font: { size: 10 }, maxTicksLimit: 10 }, grid: { color: gridCol } },
        y: { ticks: { callback: v => "$" + Math.round(v / 1000) + "k", color: tickCol, font: { size: 10 } }, grid: { color: gridCol } }
      }
    }
  });
}

async function runNow() {
  const btn = document.getElementById("btn-run-now");
  const statusEl = document.getElementById("port-status");
  btn.disabled = true;
  btn.textContent = "Running\u2026";
  statusEl.innerHTML = '<span class="spinner"></span> Fetching data and running autonomous paper-trade \u2014 please wait\u2026';

  try {
    const res = await fetch("/api/run-now", { method: "POST" });
    const data = await res.json();
    if (data.error) {
      statusEl.innerHTML = `<strong style="color:var(--red)">Error:</strong> ${escHtml(data.error)}`;
    } else {
      await loadPortfolio();
    }
  } catch (err) {
    statusEl.innerHTML = `<strong style="color:var(--red)">Error:</strong> ${escHtml(err.message)}`;
  }

  btn.disabled = false;
  btn.textContent = "Run Now";
}

// ── AI Stock Picker ──────────────────────────────────────────────────────────

const pickerSectors = new Set();
let allSectorsData = {};

async function loadAllSectors() {
  try {
    const res = await fetch("/api/all-sectors");
    allSectorsData = await res.json();

    const grid = document.getElementById("picker-sector-grid");
    if (!grid) return;
    grid.innerHTML = "";

    Object.entries(allSectorsData).forEach(([id, sec]) => {
      // Default: pre-select the original 6 AI sectors
      const defaultOn = ["semis","cloud_ai","ai_software","robotics","ev_auto","biotech_ai"].includes(id);
      if (defaultOn) pickerSectors.add(id);

      const pill = document.createElement("div");
      pill.className = "sector-pill" + (defaultOn ? " on" : "");
      pill.id = "psp-" + id;
      pill.style.setProperty("--pill-color", sec.color);
      pill.innerHTML = `<span class="sp-name">${sec.name}</span><span class="sp-tickers">${sec.stocks.slice(0,4).join(" · ")}</span>`;
      pill.onclick = () => togglePickerSector(id);
      grid.appendChild(pill);
    });
  } catch (e) {
    console.warn("loadAllSectors failed:", e);
  }
}

function togglePickerSector(id) {
  if (pickerSectors.has(id)) {
    pickerSectors.delete(id);
    document.getElementById("psp-" + id)?.classList.remove("on");
  } else {
    pickerSectors.add(id);
    document.getElementById("psp-" + id)?.classList.add("on");
  }
}

function selectAllPickerSectors() {
  Object.keys(allSectorsData).forEach(id => {
    pickerSectors.add(id);
    document.getElementById("psp-" + id)?.classList.add("on");
  });
}

function clearPickerSectors() {
  pickerSectors.clear();
  document.querySelectorAll("[id^='psp-']").forEach(el => el.classList.remove("on"));
}

async function runPicker() {
  const btn       = document.getElementById("btn-pick");
  const statusEl  = document.getElementById("picker-status");
  const resultsEl = document.getElementById("picker-results");

  if (pickerSectors.size === 0) {
    alert("Please select at least one industry sector.");
    return;
  }

  const lookback   = parseInt(document.getElementById("picker-lookback").value, 10);
  const horizon    = parseInt(document.getElementById("picker-horizon").value,   10);
  const targetPct  = parseFloat(document.getElementById("picker-target").value);
  const nStocks    = parseInt(document.getElementById("picker-n").value,          10);

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Analyzing&hellip;';
  statusEl.style.display = "block";
  statusEl.innerHTML = `<span class="spinner"></span> Fetching ${lookback}-month data for ${pickerSectors.size} sector(s) and scoring stocks &mdash; this may take 10&ndash;30 seconds&hellip;`;
  resultsEl.style.display = "none";

  try {
    const res = await fetch("/api/pick-stocks", {
      method:  "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        sectors:    [...pickerSectors],
        lookback,
        horizon,
        target_pct: targetPct,
        n_stocks:   nStocks,
      })
    });
    const data = await res.json();

    if (data.error) {
      statusEl.innerHTML = `<strong style="color:var(--red)">Error:</strong> ${escHtml(data.error)}`;
      return;
    }

    statusEl.style.display = "none";
    renderPickResults(data);
    resultsEl.style.display = "block";
  } catch (err) {
    statusEl.innerHTML = `<strong style="color:var(--red)">Error:</strong> ${escHtml(err.message)}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Find Stocks";
  }
}

function renderPickResults(data) {
  const picks = data.picks || [];

  document.getElementById("pk-screened").textContent  = data.total_screened ?? "—";
  document.getElementById("pk-qualified").textContent = data.total_qualified ?? "—";

  if (picks.length > 0) {
    const avgRet = picks.reduce((s, p) => s + p.predicted_return, 0) / picks.length;
    document.getElementById("pk-avg-ret").textContent = `${avgRet.toFixed(1)}%`;
    document.getElementById("pk-top").textContent     = picks[0].ticker;
  } else {
    document.getElementById("pk-avg-ret").textContent = "—";
    document.getElementById("pk-top").textContent     = "None";
  }

  const tbody = document.getElementById("picker-body");
  if (picks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" class="empty-msg">No stocks met the criteria. Try lowering the target return or selecting more sectors.</td></tr>`;
    return;
  }

  tbody.innerHTML = picks.map((p, i) => {
    const retCls = p.predicted_return >= data.target_pct * 1.5 ? "ret-high"
                 : p.predicted_return >= data.target_pct       ? "ret-ok"
                 : "ret-low";
    const signals = [
      p.macd_bull  ? "MACD\u2191" : "",
      p.trend_bull ? "MA\u2191"   : "",
      p.vol_conf   ? "Vol\u2191"  : "",
    ].filter(Boolean).join(" ");

    const confBar = `<div class="conf-wrap"><div class="conf-bar"><div class="conf-fill" style="width:${p.confidence}%;background:${confColor(p.confidence)}"></div></div><span class="conf-label">${p.confidence}%</span></div>`;
    const rsiCls  = p.rsi >= 70 ? "rsi-hot" : p.rsi <= 35 ? "rsi-cold" : "rsi-ok";

    return `<tr>
      <td>${i + 1}</td>
      <td><strong>${escHtml(p.ticker)}</strong></td>
      <td class="name-cell">${escHtml(p.name)}</td>
      <td>${escHtml(p.sector)}</td>
      <td>$${p.price.toFixed(2)}</td>
      <td class="${p.r1m  >= 0 ? "val-pos" : "val-neg"}">${p.r1m  >= 0 ? "+" : ""}${p.r1m.toFixed(1)}%</td>
      <td class="${p.r3m  >= 0 ? "val-pos" : "val-neg"}">${p.r3m  >= 0 ? "+" : ""}${p.r3m.toFixed(1)}%</td>
      <td class="${p.r6m  >= 0 ? "val-pos" : "val-neg"}">${p.r6m  >= 0 ? "+" : ""}${p.r6m.toFixed(1)}%</td>
      <td class="${rsiCls}">${p.rsi}</td>
      <td>${p.sharpe.toFixed(2)}</td>
      <td>${p.composite_score.toFixed(1)}</td>
      <td class="${retCls}"><strong>${p.predicted_return >= 0 ? "+" : ""}${p.predicted_return.toFixed(1)}%</strong><br><small>in ${data.horizon_months}mo</small></td>
      <td>${confBar}</td>
      <td class="signals-cell">${signals || "—"}</td>
    </tr>`;
  }).join("");
}

function confColor(pct) {
  if (pct >= 70) return "#22c55e";
  if (pct >= 45) return "#f59e0b";
  return "#ef4444";
}

// ── Auto-Trade Log ───────────────────────────────────────────────────────────

async function loadTradeLog() {
  try {
    const res  = await fetch("/api/trade-log");
    const data = await res.json();
    renderRunsSummary(data.daily_runs || []);
    renderTradesTable(data.trades     || []);
  } catch (err) {
    document.getElementById("tl-runs-body").innerHTML =
      `<tr><td colspan="7" class="empty-msg" style="color:var(--red)">Error: ${escHtml(err.message)}</td></tr>`;
  }
}

function renderRunsSummary(runs) {
  const tbody = document.getElementById("tl-runs-body");
  if (!runs.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-msg">No run records yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = runs.map(r => {
    const retCls = r.return_pct >= 0 ? "val-pos" : "val-neg";
    const retStr = (r.return_pct >= 0 ? "+" : "") + (r.return_pct * 100).toFixed(3) + "%";
    const time   = r.created_at ? r.created_at.slice(11, 19) + " UTC" : "—";
    // Summarise notes: strip repeated "No trades;" junk, keep trade descriptions
    const notes  = (r.notes || "")
      .split(";")
      .map(s => s.trim())
      .filter(Boolean)
      .join(" | ") || "—";
    return `<tr>
      <td>${r.date}</td>
      <td>$${r.portfolio_value.toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
      <td>$${r.cash.toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
      <td class="${retCls}">${retStr}</td>
      <td>${r.trades_count}</td>
      <td>${time}</td>
      <td style="font-size:12px;color:var(--text-muted);max-width:340px;word-break:break-word">${escHtml(notes)}</td>
    </tr>`;
  }).join("");
}

function renderTradesTable(trades) {
  const tbody = document.getElementById("tl-trades-body");
  if (!trades.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty-msg">No trades executed yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = trades.map(t => {
    const isBuy   = t.action === "BUY";
    const actCls  = isBuy ? "val-pos" : "val-neg";
    const value   = (t.price * t.shares).toFixed(2);
    const pnlStr  = t.pnl !== 0
      ? `<span class="${t.pnl >= 0 ? "val-pos" : "val-neg"}">${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}</span>`
      : `<span style="color:var(--text-faint)">—</span>`;
    const time    = t.time ? t.time.slice(11, 16) + " UTC" : "";
    return `<tr>
      <td>${t.date}<br><small style="color:var(--text-muted)">${time}</small></td>
      <td class="${actCls}"><strong>${t.action}</strong></td>
      <td><strong>${escHtml(t.ticker)}</strong></td>
      <td class="name-cell">${escHtml(t.name)}</td>
      <td style="font-size:12px">${escHtml(t.sector)}</td>
      <td>$${t.price.toFixed(2)}</td>
      <td>${t.shares}</td>
      <td>$${value}</td>
      <td>${pnlStr}</td>
      <td style="font-size:12px">${escHtml(t.strategy)}</td>
      <td style="font-size:11px;color:var(--text-muted);max-width:260px;word-break:break-word">${escHtml(t.signal)}</td>
    </tr>`;
  }).join("");
}
