import { useState, useEffect, useCallback, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update, remove } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAjdy2nE1KHKcKNZCVqBAkMywM4KzrvfvA",
  authDomain: "stock-sim-edc4f.firebaseapp.com",
  databaseURL: "https://stock-sim-edc4f-default-rtdb.firebaseio.com",
  projectId: "stock-sim-edc4f",
  storageBucket: "stock-sim-edc4f.firebasestorage.app",
  messagingSenderId: "247760779706",
  appId: "1:247760779706:web:f9f389a195fe4aff1b8583"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

const fmt$ = (n) => n == null ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n) => n == null ? "—" : `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}%`;
const uid = () => Math.random().toString(36).slice(2, 9);
const BUDGET = 10000;
const SIM_START_DATE = "2026-05-19"; // any holding before this date is considered exploited (sim started May 20)

// Get the most recent portfolio value from history that is before today
function getPrevDayValue(history, today) {
  if (!history || !history.length) return null;
  const prev = history.filter(h => h.date < today).sort((a, b) => b.date.localeCompare(a.date));
  return prev.length ? prev[0].value : null;
}
const ALERT_THRESHOLD = 5; // % move triggers badge

// ── Arcade Mode Constants ────────────────────────────────────────────────────
const ARCADE_BUDGET = 10000;
const ARCADE_SESSION_MINUTES = 10;
const ARCADE_TICK_MS = 8000; // price update every 8 seconds

// Stock personality map — controls simulation behavior
// unknown tickers get "volatile" by default with a warning
const STOCK_PERSONALITIES = {
  // Stable blue chips
  AAPL:"stable", MSFT:"stable", GOOGL:"stable", AMZN:"stable", JNJ:"stable",
  WMT:"stable", BRK:"stable", V:"stable", MA:"stable", JPM:"stable",
  PG:"stable", KO:"stable", PEP:"stable", MCD:"stable", UNH:"stable",
  // Trending growth
  NVDA:"trending", META:"trending", TSLA:"trending", AVGO:"trending",
  LLY:"trending", NFLX:"trending", ORCL:"trending", CRM:"trending",
  // Volatile tech/speculative
  AMD:"volatile", PLTR:"volatile", SHOP:"volatile", SNOW:"volatile",
  RBLX:"volatile", SPOT:"volatile", UBER:"volatile", COIN:"volatile",
  MSTR:"volatile", ARKK:"volatile",
  // Crash-prone penny/meme
  AMC:"crash", GME:"crash", BBBY:"crash", MWC:"crash", RANI:"crash",
  MULN:"crash", SPCE:"crash",
  // Rocket (mostly flat, rare huge spikes)
  GOVX:"rocket", NVAX:"rocket", SAVA:"rocket", MARA:"rocket", RIOT:"rocket",
};

// AI Challenger roster — player picks 3 of 8
const AI_CHALLENGER_ROSTER = [
  {
    id: "mr-booker",
    portrait: "/portraits/mr-booker.webp",
    name: "Mr. Booker", emoji: "🏫",
    quote: "Risk? I don't have money to throw around.",
    description: "Ultra-conservative. Teachers on a budget don't gamble.",
    picks: [
      { ticker: "WMT", spent: 2500 },
      { ticker: "JNJ", spent: 2500 },
      { ticker: "KO", spent: 2500 },
      { ticker: "PG", spent: 2500 },
    ]
  },
  {
    id: "shkreli",
    portrait: "/portraits/shkreli.webp",
    name: "Martin Shkreli", emoji: "💊",
    quote: "I'm not actually that bad of a guy... okay maybe a little.",
    description: "High risk, morally questionable, occasionally genius.",
    picks: [
      { ticker: "MSTR", spent: 2500 },
      { ticker: "COIN", spent: 2500 },
      { ticker: "AMC", spent: 2500 },
      { ticker: "RBLX", spent: 2500 },
    ]
  },
  {
    id: "barbara",
    portrait: "/portraits/barbara.webp",
    name: "Barbara Corcoran", emoji: "🦈",
    quote: "The best time to invest was yesterday. The second best time is now.",
    description: "Gut-instinct bets on brands people believe in.",
    picks: [
      { ticker: "MCD", spent: 2500 },
      { ticker: "SBUX", spent: 2500 },
      { ticker: "DIS", spent: 2500 },
      { ticker: "NKE", spent: 2500 },
    ]
  },
  {
    id: "claude",
    portrait: "/portraits/claude.webp",
    name: "Claude A.", emoji: "🤖",
    quote: "I ran the numbers. Then I ran them again.",
    description: "AI-forward with defensive hedging. Methodical.",
    picks: [
      { ticker: "NVDA", spent: 2000 },
      { ticker: "JPM", spent: 2000 },
      { ticker: "WMT", spent: 2000 },
      { ticker: "LLY", spent: 2000 },
      { ticker: "NEE", spent: 2000 },
    ]
  },
  {
    id: "cramer",
    portrait: "/portraits/cramer.webp",
    name: "Jim Cramer", emoji: "📰",
    quote: "BUY BUY BUY! ...sell.",
    description: "Loudly confident, historically wrong.",
    picks: [
      { ticker: "NFLX", spent: 2500 },
      { ticker: "META", spent: 2500 },
      { ticker: "TSLA", spent: 2500 },
      { ticker: "AMD", spent: 2500 },
    ]
  },
  {
    id: "buffett-jr",
    portrait: "/portraits/buffett-jr.webp",
    name: "Warren Buffett Jr.", emoji: "🐢",
    quote: "The stock market is a device for transferring money from the impatient to the patient.",
    description: "Value investing. Wrong format, right mindset.",
    picks: [
      { ticker: "BRK-B", spent: 2500 },
      { ticker: "AAPL", spent: 2500 },
      { ticker: "BAC", spent: 2500 },
      { ticker: "AXP", spent: 2500 },
    ]
  },
  {
    id: "mrbeast",
    portrait: "/portraits/mrbeast.webp",
    name: "MrBeast", emoji: "👾",
    quote: "If I invested in boring stocks I couldn't afford to bury people in chocolate.",
    description: "Reinvest everything. Bet on growth at all costs.",
    picks: [
      { ticker: "GOOGL", spent: 2500 },
      { ticker: "META", spent: 2500 },
      { ticker: "AMZN", spent: 2500 },
      { ticker: "NFLX", spent: 2500 },
    ]
  },
  {
    id: "bronny",
    portrait: "/portraits/bronny.webp",
    name: "Bronny James", emoji: "🏀",
    quote: "Legacy is built in the long game.",
    description: "Safe, brand-name picks. Doesn't need the money anyway.",
    picks: [
      { ticker: "NKE", spent: 2500 },
      { ticker: "DIS", spent: 2500 },
      { ticker: "AAPL", spent: 2500 },
      { ticker: "JPM", spent: 2500 },
    ]
  },
  {
    id: "mr-walsh",
    name: "Mr. Walsh", emoji: "💻",
    portrait: "/portraits/mrwalsh.webp",
    quote: "Booker told me to play it safe. I don't listen to Booker.",
    description: "The evil Booker. Actually reads earnings reports.",
    picks: [
      { ticker: "SNDK", spent: 2000 },
      { ticker: "GE", spent: 2000 },
      { ticker: "APLD", spent: 2000 },
      { ticker: "AAPL", spent: 2000 },
      { ticker: "NFLX", spent: 2000 },
    ]
  },
];

// Event flavor text templates — {company} and {pct} filled in at runtime
const EVENT_TEMPLATES = {
  spike: [
    "📰 BREAKING: {company} surges {pct}% after CEO tweets a single rocket emoji.",
    "📰 BREAKING: {company} up {pct}% after analyst upgrades to 'send it'.",
    "📰 BREAKING: {company} jumps {pct}% — sources say the office got a ping pong table.",
    "📰 BREAKING: {company} soars {pct}% after being mentioned in a TikTok.",
    "📰 BREAKING: {company} up {pct}% after rumor that Elon Musk looked at it.",
    "📰 BREAKING: {company} climbs {pct}% following partnership with a company nobody has heard of.",
    "📰 BREAKING: {company} up {pct}% — Jim Cramer said to sell, so everyone bought.",
  ],
  crash: [
    "📰 BREAKING: {company} crashes {pct}% after CEO caught using Comic Sans in a presentation.",
    "📰 BREAKING: {company} down {pct}% after analyst discovers headquarters is a WeWork.",
    "📰 BREAKING: {company} drops {pct}% after earnings call held entirely in Roblox.",
    "📰 BREAKING: {company} falls {pct}% — intern accidentally sent 'reply all' to 50,000 people.",
    "📰 BREAKING: {company} slides {pct}% after CFO listed 'vibes' as an asset on the balance sheet.",
    "📰 BREAKING: {company} down {pct}% after Jim Cramer said to buy.",
    "📰 BREAKING: {company} crashes {pct}% following news that the CEO prefers Bing.",
  ],
};

// Price simulation engine — returns new price based on personality
function simulatePrice(currentPrice, personality, tick) {
  const rand = () => (Math.random() - 0.5) * 2; // -1 to 1
  const p = personality || "volatile";
  let changePct = 0;

  if (p === "stable") {
    changePct = rand() * 0.008; // ±0.8% max
  } else if (p === "volatile") {
    changePct = rand() * 0.03; // ±3% max
  } else if (p === "trending") {
    changePct = rand() * 0.015 + 0.002; // slight upward drift
  } else if (p === "crash") {
    // mostly flat, occasional big drop
    const roll = Math.random();
    if (roll > 0.97) changePct = -(Math.random() * 0.15 + 0.05); // 5-20% crash
    else changePct = rand() * 0.02;
  } else if (p === "rocket") {
    // mostly flat, occasional big spike
    const roll = Math.random();
    if (roll > 0.97) changePct = Math.random() * 0.20 + 0.05; // 5-25% spike
    else changePct = rand() * 0.01;
  }

  const newPrice = currentPrice * (1 + changePct);
  return { newPrice: Math.max(0.01, newPrice), changePct };
}

// Returns true if market is currently open (9:30am-4:00pm ET, weekdays)
function isMarketOpen() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 570 && mins < 960; // 9:30am to 4:00pm
}
const TEACHER_PIN_HASH = "555e1980f5d793081110be32ab6bc31928eebaf008d1273f189c0ed29e50f2a4"; // sha256 of teacher PIN
const hashPin = async (pin) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
};


async function fetchStockPrice(ticker) {
  try {
    const res = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker })
    });
    const data = await res.json();
    if (data.currentPrice) {
      return { ticker, currentPrice: data.currentPrice, previousClose: data.previousClose, companyName: data.companyName || ticker, error: null };
    }
  } catch (e) {}
  return { ticker, currentPrice: null, previousClose: null, companyName: ticker, error: 'Failed to fetch' };
}

async function fetchStockPriceOnDate(ticker, dateStr) {
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr >= today) {
    const r = await fetchStockPrice(ticker);
    return { ticker, closePrice: r.currentPrice, actualDate: today, companyName: r.companyName, error: r.error };
  }
  try {
    const res = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, date: dateStr })
    });
    const data = await res.json();
    if (data.closePrice) {
      return { ticker, closePrice: data.closePrice, actualDate: data.actualDate || dateStr, companyName: data.companyName || ticker, error: null };
    }
  } catch (e) {}
  return { ticker, closePrice: null, actualDate: dateStr, companyName: ticker, error: 'Failed to fetch historical price' };
}

function Sparkline({ data, color = "#FFD966", height = 36, width = 100 }) {
  if (!data || data.length < 2) return <svg width={width} height={height}><line x1="0" y1={height/2} x2={width} y2={height/2} stroke={color} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.4"/></svg>;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  const areaBottom = `${width},${height} 0,${height}`;
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={`sg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={`${pts} ${areaBottom}`} fill={`url(#sg-${color.replace("#","")})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

function BarChart({ holdings, prices }) {
  if (!holdings?.length) return null;
  const bars = holdings.map(h => {
    const p = prices[h.ticker];
    const current = p?.currentPrice;
    if (!h.purchasePrice || !h.spent) return { ...h, current, pnl: null, pct: null };
    const derivedShares = h.spent / h.purchasePrice;
    const pnl = current != null ? (current - h.purchasePrice) * derivedShares : null;
    const pct = current != null ? ((current - h.purchasePrice) / h.purchasePrice) * 100 : null;
    return { ...h, current, pnl, pct };
  }).filter(b => b.pct != null);
  if (!bars.length) return <div style={{ color: "#8899bb", fontSize: 13 }}>Awaiting price data…</div>;
  const max = Math.max(...bars.map(b => Math.abs(b.pct)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
      {bars.map(b => (
        <div key={b.ticker} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 54, fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#e0e8ff", letterSpacing: 1 }}>{b.ticker}</div>
          <div style={{ flex: 1, height: 22, background: "#0d1f3c", borderRadius: 4, overflow: "hidden", position: "relative" }}>
            <div style={{ position: "absolute", left: b.pct >= 0 ? "50%" : `${50 - (Math.abs(b.pct) / max) * 50}%`, width: `${(Math.abs(b.pct) / max) * 50}%`, height: "100%", background: b.pct >= 0 ? "#22c55e" : "#ef4444", borderRadius: b.pct >= 0 ? "0 3px 3px 0" : "3px 0 0 3px", transition: "width 0.6s ease" }}/>
            <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#ffffff20" }}/>
          </div>
          <div style={{ width: 68, textAlign: "right", fontSize: 12, fontWeight: 700, color: b.pct >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(b.pct)}</div>
          <div style={{ width: 76, textAlign: "right", fontSize: 12, color: b.pnl >= 0 ? "#22c55e" : "#ef4444" }}>{b.pnl >= 0 ? "+" : ""}{fmt$(b.pnl)}</div>
        </div>
      ))}
    </div>
  );
}

function ErrorToast({ message, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 5000); return () => clearTimeout(t); }, []);
  return (
    <div style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", background: "#3a0f0f", border: "1px solid #ef4444", borderRadius: 10, padding: "14px 22px", color: "#fca5a5", fontSize: 14, fontWeight: 600, zIndex: 2000, display: "flex", alignItems: "center", gap: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", maxWidth: 460, textAlign: "center" }}>
      <span style={{ fontSize: 20 }}>⚠️</span>
      <span style={{ flex: 1 }}>{message}</span>
      <button onClick={onClose} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 18, marginLeft: 4, lineHeight: 1 }}>✕</button>
    </div>
  );
}

function ManageHoldingsModal({ student, onSave, onClose, onError, fetchPrice, prices, teacherMode }) {
  const [rows, setRows] = useState(
    student.holdings.length
      ? student.holdings.map(h => ({
          ...h,
          spentStr: String(h.spent || 0),
          purchasePrice: h.purchasePrice ?? null,
          shares: h.shares ?? null,
        }))
      : [{ id: uid(), ticker: "", date: new Date().toISOString().slice(0,10), spentStr: "", spent: 0, purchasePrice: null, shares: null }]
  );
  const [fetching, setFetching] = useState(false);
  const [fetchStatus, setFetchStatus] = useState({});

  const [soldProceeds, setSoldProceeds] = useState(0); // tracks cash from selling at market value
  const [sellAmounts, setSellAmounts] = useState({}); // { holdingId: amountStr } for partial sells
  const [addingTo, setAddingTo] = useState({}); // { ticker: amountStr } for adding to existing holding

  const lockedSpent = rows.filter(h => h.purchasePrice != null && h.purchasePrice > 0).reduce((s, h) => s + (h.spent || 0), 0);
  const newSpent = rows.filter(h => !(h.purchasePrice != null && h.purchasePrice > 0)).reduce((s, h) => s + (parseFloat(h.spentStr) || 0), 0);
  const totalSpent = lockedSpent + newSpent;
  // Available cash = original cashBalance + proceeds from sells - new purchases
  const originalCash = student.cashBalance != null ? student.cashBalance : BUDGET - student.holdings.reduce((s, h) => s + (h.spent || 0), 0);
  const availableCash = originalCash + soldProceeds - newSpent;
  const overBudget = availableCash < 0;
  const totalPortfolio = lockedSpent + (originalCash + soldProceeds);
  const pctUsed = Math.min((lockedSpent / BUDGET) * 100, 100);
  const cashLeft = availableCash;
  const today = new Date().toISOString().slice(0, 10);

  const addRow = () => { if (rows.length < 10) setRows(prev => [...prev, { id: uid(), ticker: "", date: today, spentStr: "", spent: 0, purchasePrice: null, shares: null }]); };

  const removeRow = (id) => {
    const h = rows.find(r => r.id === id);
    if (h && h.purchasePrice && h.purchasePrice > 0 && h.spent) {
      const currentPrice = prices[h.ticker]?.currentPrice;
      const derivedShares = h.spent / h.purchasePrice;
      const marketValue = currentPrice ? currentPrice * derivedShares : h.spent;
      setSoldProceeds(prev => prev + marketValue);
    }
    setRows(prev => prev.filter(r => r.id !== id));
    setSellAmounts(prev => { const n = {...prev}; delete n[id]; return n; });
  };

  const partialSell = (id) => {
    const h = rows.find(r => r.id === id);
    if (!h) return;
    const sellAmt = parseFloat(sellAmounts[id] || 0);
    if (!sellAmt || sellAmt <= 0 || sellAmt > h.spent) return;
    const currentPrice = prices[h.ticker]?.currentPrice || h.purchasePrice;
    const derivedShares = h.spent / h.purchasePrice;
    const sharesToSell = derivedShares * (sellAmt / h.spent);
    const proceeds = sharesToSell * currentPrice;
    setSoldProceeds(prev => prev + proceeds);
    const remainingSpent = h.spent - sellAmt;
    if (remainingSpent < 0.01) {
      setRows(prev => prev.filter(r => r.id !== id));
    } else {
      setRows(prev => prev.map(r => r.id !== id ? r : {
        ...r,
        spent: remainingSpent,
        spentStr: remainingSpent.toFixed(2),
        shares: derivedShares - sharesToSell,
      }));
    }
    setSellAmounts(prev => { const n = {...prev}; delete n[id]; return n; });
  };

  const addToHolding = (ticker) => {
    const addAmt = parseFloat(addingTo[ticker] || 0);
    if (!addAmt || addAmt <= 0) return;
    // Create a new unlocked row for the same ticker at today's price
    setRows(prev => [...prev, { id: uid(), ticker, date: today, spentStr: String(addAmt), spent: addAmt, purchasePrice: null, shares: null }]);
    setAddingTo(prev => { const n = {...prev}; delete n[ticker]; return n; });
  };
  const updateRow = (id, field, val) => setRows(prev => prev.map(h => {
    if (h.id !== id) return h;
    if (field === "spentStr") return { ...h, spentStr: val, spent: parseFloat(val) || 0 };
    // invalidate purchasePrice if ticker or date changes
    if (field === "ticker") return { ...h, ticker: val.toUpperCase(), purchasePrice: null, shares: null };
    if (field === "date") return { ...h, date: val, purchasePrice: null, shares: null };
    return { ...h, [field]: val };
  }));

  const handleSave = async () => {
    const valid = rows.filter(h => h.ticker.trim() && parseFloat(h.spentStr) > 0);
    if (availableCash < 0) {
      onError(`You've exceeded your pocket cash! You need ${fmt$(Math.abs(availableCash))} more to complete these purchases.`);
      return;
    }
    // Hard server-side date check — rejects any date before today unless teacher mode
    if (!teacherMode) {
      const todayCheck = new Date().toISOString().slice(0, 10);
      const badDates = rows.filter(h => !(h.purchasePrice != null && h.purchasePrice > 0) && h.date && h.date < todayCheck);
      if (badDates.length) {
        onError("Invalid purchase date — you can only buy stocks at today's price.");
        return;
      }
    }
    if (!valid.length) { onClose(); return; }
    setFetching(true);
    const resolved = await Promise.all(valid.map(async h => {
      // skip re-fetch if price already locked and ticker/date unchanged
      if (h.purchasePrice != null && h.purchasePrice > 0) return { ...h, spent: h.spent }; // locked
      const ticker = h.ticker.trim().toUpperCase();
      const spent = parseFloat(h.spentStr);
      setFetchStatus(prev => ({ ...prev, [h.id]: `Looking up ${ticker} on ${h.date < today ? h.date : "today"}…` }));
      const p = await fetchStockPriceOnDate(ticker, h.date);
      setFetchStatus(prev => ({ ...prev, [h.id]: null }));
      const pp = p?.closePrice || null;
      const actualDate = p?.actualDate || h.date;
      const companyName = p?.companyName || ticker;
      // also update the global prices cache if it's a current-price fetch
      if (h.date >= today && pp) fetchPrice(ticker);
      return { ...h, ticker, spent, purchasePrice: pp, shares: pp ? spent / pp : null, date: actualDate, _companyName: companyName };
    }));
    setFetching(false);
    const totalLockedSpent = resolved.reduce((s, h) => s + (h.spent || 0), 0);
    // newCashBalance = original cash + sell proceeds - new purchases
    const newCashBalance = originalCash + soldProceeds - newSpent;
    onSave(resolved, newCashBalance);
    onClose();
  };

  const iStyle = { background: "#0d1f3c", border: "1px solid #2a3f6b", borderRadius: 6, color: "#e0e8ff", padding: "8px 10px", fontSize: 13, outline: "none", boxSizing: "border-box", width: "100%" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: "#0f2347", border: "1px solid #2a3f6b", borderRadius: 12, padding: 28, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, color: "#FFD966", fontSize: 16, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: 2 }}>MANAGE HOLDINGS — {student.name}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8899bb", cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5 }}>
            <span style={{ color: "#8899bb" }}>AVAILABLE CASH</span>
            <span style={{ fontWeight: 700, color: overBudget ? "#ef4444" : cashLeft <= 500 ? "#f59e0b" : "#22c55e" }}>
              {fmt$(cashLeft)} available {soldProceeds > 0 ? `(includes ${fmt$(soldProceeds)} from sales)` : ""}
            </span>
          </div>
          <div style={{ height: 6, background: "#0d1f3c", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pctUsed}%`, background: overBudget ? "#ef4444" : pctUsed > 90 ? "#f59e0b" : "#22c55e", borderRadius: 4, transition: "width 0.3s ease" }}/>
          </div>
        </div>

        {/* ── Locked (existing) holdings ── */}
        {rows.filter(h => h.purchasePrice != null && h.purchasePrice > 0).length > 0 && (
          <>
            <div style={{ fontSize: 10, color: "#445577", letterSpacing: 1, marginBottom: 8 }}>CURRENT HOLDINGS — locked in</div>
            {rows.filter(h => h.purchasePrice != null && h.purchasePrice > 0).map(h => {
              const currentPrice = prices[h.ticker]?.currentPrice;
              const derivedShares = h.spent / h.purchasePrice;
              const currentValue = currentPrice ? currentPrice * derivedShares : h.spent;
              const pnl = currentValue - h.spent;
              const sellAmt = sellAmounts[h.id] || "";
              const addAmt = addingTo[h.ticker] || "";
              const maxSell = h.spent;
              return (
                <div key={h.id} style={{ marginBottom: 10, background: "#0a1a38", border: "1px solid #1e3560", borderRadius: 8, padding: "10px 12px" }}>
                  {/* Main row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontFamily: "monospace", fontWeight: 700, color: "#FFD966", fontSize: 14, width: 70 }}>{h.ticker}</div>
                    <div style={{ flex: 1, fontSize: 12, color: "#8899bb" }}>
                      {fmt$(h.spent)} · {derivedShares.toFixed(4)} shares · now {fmt$(currentValue)}
                      <span style={{ marginLeft: 6, color: pnl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{pnl >= 0 ? "+" : ""}{fmt$(pnl)}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "#22c55e", background: "#0d2a1a", border: "1px solid #22c55e33", borderRadius: 4, padding: "2px 7px" }}>🔒</div>
                  </div>
                  {/* Sell partial row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px solid #0d1f3c" }}>
                    <span style={{ fontSize: 11, color: "#6677aa", width: 60, flexShrink: 0 }}>Sell $</span>
                    <input type="number" min="0" max={maxSell} value={sellAmt}
                      onChange={e => setSellAmounts(prev => ({ ...prev, [h.id]: e.target.value }))}
                      placeholder={`0 – ${fmt$(maxSell)}`}
                      style={{ ...iStyle, flex: 1, padding: "4px 8px", fontSize: 11 }}/>
                    <button onClick={() => setSellAmounts(prev => ({ ...prev, [h.id]: String(maxSell) }))}
                      style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 5, color: "#8899bb", cursor: "pointer", padding: "4px 8px", fontSize: 10 }}>All</button>
                    <button onClick={() => partialSell(h.id)} disabled={!sellAmt || parseFloat(sellAmt) <= 0}
                      style={{ background: parseFloat(sellAmt) > 0 ? "#3a0f0f" : "#1a1a2a", border: `1px solid ${parseFloat(sellAmt) > 0 ? "#ef4444" : "#2a2a3a"}`, borderRadius: 5, color: parseFloat(sellAmt) > 0 ? "#ef4444" : "#445577", cursor: parseFloat(sellAmt) > 0 ? "pointer" : "default", padding: "4px 10px", fontSize: 11, fontWeight: 600 }}>
                      Sell
                    </button>
                  </div>
                  {/* Add to holding row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: "#6677aa", width: 60, flexShrink: 0 }}>Buy more $</span>
                    <input type="number" min="0" value={addAmt}
                      onChange={e => setAddingTo(prev => ({ ...prev, [h.ticker]: e.target.value }))}
                      placeholder="Amount ($)"
                      style={{ ...iStyle, flex: 1, padding: "4px 8px", fontSize: 11 }}/>
                    <button onClick={() => addToHolding(h.ticker)} disabled={!addAmt || parseFloat(addAmt) <= 0}
                      style={{ background: parseFloat(addAmt) > 0 ? "#14532d" : "#1a1a2a", border: `1px solid ${parseFloat(addAmt) > 0 ? "#22c55e" : "#2a2a3a"}`, borderRadius: 5, color: parseFloat(addAmt) > 0 ? "#22c55e" : "#445577", cursor: parseFloat(addAmt) > 0 ? "pointer" : "default", padding: "4px 10px", fontSize: 11, fontWeight: 600 }}>
                      Buy
                    </button>
                  </div>
                </div>
              );
            })}
            <div style={{ height: 1, background: "#1e3560", margin: "12px 0" }}/>
          </>
        )}

        {/* ── New (editable) holdings ── */}
        {rows.filter(h => !(h.purchasePrice != null && h.purchasePrice > 0)).length > 0 && (
          <>
            <div style={{ fontSize: 10, color: "#445577", letterSpacing: 1, marginBottom: 8 }}>
              {rows.some(h => h.purchasePrice != null && h.purchasePrice > 0) ? "NEW PURCHASES" : "STOCK PURCHASES"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "90px 130px 1fr 32px", gap: 8, marginBottom: 6, padding: "0 2px" }}>
              {["TICKER", "PURCHASE DATE", "$ INVESTED", ""].map(h => (
                <div key={h} style={{ fontSize: 10, color: "#334466", letterSpacing: 1 }}>{h}</div>
              ))}
            </div>
            {rows.filter(h => !(h.purchasePrice != null && h.purchasePrice > 0)).map(h => {
              const isPast = teacherMode && h.date && h.date < today;
              const status = fetchStatus[h.id];
              return (
                <div key={h.id} style={{ marginBottom: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "90px 130px 1fr 32px", gap: 8, alignItems: "center" }}>
                    <input value={h.ticker} onChange={e => updateRow(h.id, "ticker", e.target.value)} placeholder="AAPL" style={{ ...iStyle, fontFamily: "monospace", textTransform: "uppercase" }}/>
                    {teacherMode ? (
                      <input type="date" value={h.date}
                        onChange={e => updateRow(h.id, "date", e.target.value)}
                        style={{ ...iStyle, borderColor: isPast ? "#f59e0b66" : "#2a3f6b" }}/>
                    ) : (
                      <input type="date" value={today} readOnly
                        style={{ ...iStyle, borderColor: "#2a3f6b", opacity: 0.6, cursor: "not-allowed" }}/>
                    )}
                    <input type="number" min="0" value={h.spentStr} onChange={e => updateRow(h.id, "spentStr", e.target.value)} placeholder="Amount ($)" style={{ ...iStyle, borderColor: overBudget ? "#ef444466" : "#2a3f6b" }}/>
                    <button onClick={() => removeRow(h.id)} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 6, color: "#ef4444", cursor: "pointer", fontSize: 14, height: 36, width: 32 }}>✕</button>
                  </div>
                  {(isPast || status) && (
                    <div style={{ paddingLeft: 2, marginTop: 4 }}>
                      {status
                        ? <span style={{ fontSize: 11, color: "#f59e0b", fontStyle: "italic" }}>⟳ {status}</span>
                        : <span style={{ fontSize: 11, color: "#f59e0b" }}>📅 Historical price will be fetched for {h.date}</span>
                      }
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {rows.length < 10 && (
          <button onClick={addRow} style={{ background: "none", border: "1px dashed #2a3f6b", borderRadius: 6, color: "#8899bb", cursor: "pointer", padding: "7px 0", width: "100%", fontSize: 12, marginBottom: 4 }}>
            + Add Stock
          </button>
        )}

        {overBudget && (
          <div style={{ background: "#3a0f0f", border: "1px solid #ef4444", borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 12, marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <span>⚠️</span>
            <span>You've exceeded your pocket cash by <strong>{fmt$(Math.abs(availableCash))}</strong>. Reduce new purchases or sell a holding to free up cash.</span>
          </div>
        )}

        <p style={{ fontSize: 11, color: "#5566aa", margin: "12px 0 16px", fontStyle: "italic" }}>
          Share counts are calculated from live prices at save time.
        </p>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: "#8899bb", cursor: "pointer", padding: "9px 20px", fontSize: 13 }}>Cancel</button>
          <button onClick={handleSave} disabled={overBudget || fetching}
            style={{ background: overBudget || fetching ? "#2a3a5a" : "#FFD966", border: "none", borderRadius: 8, color: overBudget || fetching ? "#5566aa" : "#0d1f3c", cursor: overBudget || fetching ? "default" : "pointer", padding: "9px 22px", fontSize: 13, fontWeight: 700 }}>
            {fetching ? "Fetching prices…" : rows.some(h => h.date < today && !h.purchasePrice) ? "Fetch Historical & Save" : "Save Holdings"}
          </button>
        </div>
      </div>
    </div>
  );
}




// ── Arcade Event Toast ────────────────────────────────────────────────────────
// ── Arcade Event Toast ────────────────────────────────────────────────────────
function ArcadeEventToast({ events, onDismiss }) {
  if (!events.length) return null;
  const latest = events[events.length - 1];
  return (
    <div onClick={onDismiss} style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: "#1a0a2e", border: "1px solid #7c3aed", borderRadius: 10, padding: "12px 20px", color: "#e0e8ff", fontSize: 13, zIndex: 1000, maxWidth: 520, textAlign: "center", boxShadow: "0 8px 32px rgba(124,58,237,0.3)", cursor: "pointer" }}>
      {latest.text}
      <span style={{ marginLeft: 8, fontSize: 10, color: "#5544aa" }}>tap to dismiss</span>
    </div>
  );
}

// ── Arcade Student Card ───────────────────────────────────────────────────────
function ArcadeStudentCard({ name, emoji, portrait, description, picks, prices, budget, cashBalance, isPlayer, onClick }) {
  const stockValue = picks.reduce((s, p) => {
    const price = prices[p.ticker]?.price;
    if (!price || !p.purchasePrice || !p.spent) return s + p.spent;
    return s + price * (p.spent / p.purchasePrice);
  }, 0);
  const portfolioValue = stockValue + (cashBalance || 0);
  const pnl = portfolioValue - budget;
  const pct = (pnl / budget) * 100;
  const isPos = pct >= 0;
  const todayPnL = picks.reduce((s, p) => {
    const priceData = prices[p.ticker];
    if (!priceData?.price || !p.purchasePrice || !p.spent) return s;
    return s + (priceData.price - p.purchasePrice) * (p.spent / p.purchasePrice);
  }, 0);
  const spark = [budget, budget * (1 + pct * 0.3 / 100), budget + todayPnL * 0.5, portfolioValue];

  return (
    <div onClick={onClick}
      style={{ background: isPlayer ? "#1a0a2e" : "#0f2347", border: `1px solid ${isPlayer ? "#7c3aed" : "#1e3560"}`, borderRadius: 12, padding: "16px 18px", cursor: onClick ? "pointer" : "default", transition: "all 0.2s", position: "relative", overflow: "hidden" }}
      onMouseEnter={e => { if (onClick) { e.currentTarget.style.borderColor = "#a78bfa"; e.currentTarget.style.transform = "translateY(-2px)"; }}}
      onMouseLeave={e => { if (onClick) { e.currentTarget.style.borderColor = isPlayer ? "#7c3aed" : "#1e3560"; e.currentTarget.style.transform = "translateY(0)"; }}}>
      <div style={{ position: "absolute", top: 0, right: 0, width: 3, height: "100%", background: isPos ? "#22c55e" : "#ef4444", borderRadius: "0 12px 12px 0" }}/>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          {portrait ? (
            <img src={portrait} alt={name}
              onError={e => { e.currentTarget.style.display="none"; }}
              style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", flexShrink: 0, border: "1px solid #1e3560" }}/>
          ) : emoji ? (
            <span style={{ fontSize: 22, flexShrink: 0 }}>{emoji}</span>
          ) : null}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: isPlayer ? "#a78bfa" : "#e0e8ff" }}>{name}</span>
              {isPlayer && <span style={{ fontSize: 9, color: "#7c3aed", background: "#2a1a4e", border: "1px solid #7c3aed44", borderRadius: 3, padding: "1px 5px" }}>YOU</span>}
            </div>
            <div style={{ fontSize: 11, color: "#5566aa", marginTop: 1 }}>{picks.length} stock{picks.length !== 1 ? "s" : ""}{description ? ` · ${description}` : ""}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: isPos ? "#22c55e" : "#ef4444" }}>{fmtPct(pct)}</div>
          <div style={{ fontSize: 11, color: "#5566aa" }}>{isPos ? "+" : ""}{fmt$(pnl)}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 12, color: "#8899bb" }}>Value: <span style={{ color: "#FFD966", fontWeight: 600 }}>{fmt$(portfolioValue)}</span></div>
          <div style={{ fontSize: 11, color: isPos ? "#22c55e" : "#ef4444", marginTop: 2 }}>Today: {isPos ? "+" : ""}{fmt$(pnl)}</div>
        </div>
        <Sparkline data={spark} color={isPos ? "#22c55e" : "#ef4444"} width={90} height={32}/>
      </div>
      {isPlayer && onClick && (
        <div style={{ borderTop: "1px solid #2a1a4e", paddingTop: 8, marginTop: 8 }}>
          <button onClick={e => { e.stopPropagation(); onClick(); }}
            style={{ background: "#2a1a4e", border: "1px solid #7c3aed55", borderRadius: 6, color: "#a78bfa", cursor: "pointer", padding: "5px 14px", fontSize: 11, fontWeight: 600, width: "100%" }}>
            ✏️ Manage Holdings
          </button>
        </div>
      )}
    </div>
  );
}

// ── Arcade Manage Holdings Modal ──────────────────────────────────────────────
function ArcadeManageModal({ portfolio, prices, onSave, onClose }) {
  // Track which original picks are still held (not sold)
  const [keptTickers, setKeptTickers] = useState(
    new Set(portfolio.picks.map(p => p.ticker))
  );
  const [newRows, setNewRows] = useState([]);

  const keptPicks = portfolio.picks.filter(p => keptTickers.has(p.ticker));
  const newSpent = newRows.reduce((s, r) => s + (parseFloat(r.spentStr) || 0), 0);

  // Cash from sells: for each original pick that was sold, credit its current market value
  const soldProceeds = portfolio.picks
    .filter(p => !keptTickers.has(p.ticker))
    .reduce((s, p) => {
      const price = prices[p.ticker]?.price || p.purchasePrice;
      return s + price * (p.spent / p.purchasePrice);
    }, 0);

  // Available cash = original cash + sell proceeds - new purchases
  const availableCash = portfolio.cashBalance + soldProceeds - newSpent;
  const overBudget = availableCash < 0;

  const addNewRow = () => { if (newRows.length < 5) setNewRows(p => [...p, { id: uid(), ticker: "", spentStr: "", personality: "volatile" }]); };
  const removeNew = (id) => setNewRows(p => p.filter(r => r.id !== id));
  const updateNew = (id, field, val) => setNewRows(p => p.map(r => r.id === id ? { ...r, [field]: field === "ticker" ? val.toUpperCase() : val } : r));

  const sellLocked = (ticker) => {
    setKeptTickers(prev => { const next = new Set(prev); next.delete(ticker); return next; });
  };

  const handleSave = () => {
    if (overBudget) return;
    const validNew = newRows.filter(r => r.ticker.trim() && parseFloat(r.spentStr) > 0);
    const newPicks = validNew.map(r => {
      const ticker = r.ticker.trim().toUpperCase();
      const spent = parseFloat(r.spentStr);
      const price = prices[ticker]?.price || 10;
      return { ticker, spent, purchasePrice: price, shares: spent / price, personality: STOCK_PERSONALITIES[ticker] || "volatile" };
    });
    // Final cash = original cash + sell proceeds - new purchases (single clean calculation)
    const finalCash = portfolio.cashBalance + soldProceeds - newSpent;
    onSave({ picks: [...keptPicks, ...newPicks], cashBalance: finalCash });
    onClose();
  };

  const iStyle = { background: "#0d1f3c", border: "1px solid #2a3f6b", borderRadius: 6, color: "#e0e8ff", padding: "8px 10px", fontSize: 13, outline: "none", boxSizing: "border-box", width: "100%" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }}>
      <div style={{ background: "#0f1a2e", border: "2px solid #7c3aed", borderRadius: 12, padding: 24, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(124,58,237,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 2, color: "#a78bfa" }}>⏸ MANAGE HOLDINGS — PRICES FROZEN</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8899bb", cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>

        {/* Available cash */}
        <div style={{ background: "#0a1a38", border: "1px solid #1e3560", borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#6677aa" }}>AVAILABLE CASH</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: overBudget ? "#ef4444" : availableCash < 500 ? "#f59e0b" : "#22c55e" }}>{fmt$(availableCash)}</span>
        </div>

        {/* Locked holdings */}
        {keptPicks.length > 0 && (
          <>
            <div style={{ fontSize: 10, color: "#445577", letterSpacing: 1, marginBottom: 8 }}>CURRENT HOLDINGS</div>
            {keptPicks.map(h => {
              const price = prices[h.ticker]?.price || h.purchasePrice;
              const currentValue = price * (h.spent / h.purchasePrice);
              const pnl = currentValue - h.spent;
              return (
                <div key={h.ticker} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, background: "#0a1a38", border: "1px solid #1e3560", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontFamily: "monospace", fontWeight: 700, color: "#FFD966", width: 60 }}>{h.ticker}</div>
                  <div style={{ flex: 1, fontSize: 12, color: "#8899bb" }}>
                    {fmt$(h.spent)} → {fmt$(currentValue)}
                    <span style={{ marginLeft: 6, color: pnl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{pnl >= 0 ? "+" : ""}{fmt$(pnl)}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#22c55e", background: "#0d2a1a", border: "1px solid #22c55e33", borderRadius: 4, padding: "2px 6px" }}>🔒</div>
                  <button onClick={() => sellLocked(h.ticker)}
                    style={{ background: "none", border: "1px solid #3a1a1a", borderRadius: 6, color: "#ef4444", cursor: "pointer", padding: "4px 10px", fontSize: 11, fontWeight: 600 }}>
                    Sell
                  </button>
                </div>
              );
            })}
            <div style={{ height: 1, background: "#1e3560", margin: "12px 0" }}/>
          </>
        )}

        {/* New purchases */}
        <div style={{ fontSize: 10, color: "#445577", letterSpacing: 1, marginBottom: 8 }}>BUY NEW STOCKS</div>
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 28px", gap: 8, marginBottom: 6 }}>
          {["TICKER", "$ TO INVEST", ""].map(h => <div key={h} style={{ fontSize: 10, color: "#334466" }}>{h}</div>)}
        </div>
        {newRows.map(r => (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "90px 1fr 28px", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <input value={r.ticker} onChange={e => updateNew(r.id, "ticker", e.target.value)} placeholder="AAPL"
              style={{ ...iStyle, fontFamily: "monospace", textTransform: "uppercase" }}/>
            <input type="number" min="0" value={r.spentStr} onChange={e => updateNew(r.id, "spentStr", e.target.value)} placeholder="Amount ($)"
              style={{ ...iStyle, borderColor: overBudget ? "#ef444466" : "#2a3f6b" }}/>
            <button onClick={() => removeNew(r.id)} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 6, color: "#ef4444", cursor: "pointer", fontSize: 13, height: 34, width: 28 }}>✕</button>
          </div>
        ))}
        <button onClick={addNewRow} style={{ background: "none", border: "1px dashed #7c3aed55", borderRadius: 6, color: "#7c3aed", cursor: "pointer", padding: "7px 0", width: "100%", fontSize: 12, marginBottom: 12 }}>
          + Add Stock
        </button>

        {overBudget && (
          <div style={{ background: "#3a0f0f", border: "1px solid #ef4444", borderRadius: 6, padding: "8px 12px", color: "#fca5a5", fontSize: 12, marginBottom: 12 }}>
            ⚠️ Not enough cash — reduce purchases or sell a holding first.
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: "#8899bb", cursor: "pointer", padding: "9px 20px", fontSize: 13 }}>Cancel</button>
          <button onClick={handleSave} disabled={overBudget}
            style={{ background: overBudget ? "#2a2040" : "#7c3aed", border: "none", borderRadius: 8, color: overBudget ? "#5566aa" : "#fff", cursor: overBudget ? "default" : "pointer", padding: "9px 22px", fontSize: 13, fontWeight: 700 }}>
            ▶ Resume &amp; Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Arcade Session ─────────────────────────────────────────────────────────────
function ArcadeSession({ portfolio: initialPortfolio, prices: initialPrices, setPrices, challengers: initialChallengers, events, setEvents, timeLeft, setTimeLeft, tickRef, timerRef, onStop }) {
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [portfolio, setPortfolio] = useState(initialPortfolio);
  const [prices, setPricesLocal] = useState(initialPrices);
  const [challengers, setChallengers] = useState(initialChallengers);
  const [frozenPrices, setFrozenPrices] = useState(null); // prices frozen when modal opens
  const [playerName] = useState(() => "Player " + Math.floor(Math.random() * 900 + 100));

  const uniqueTickers = [...new Set([
    ...(portfolio?.picks || []).map(p => p.ticker),
    ...challengers.flatMap(c => c.picks.map(p => p.ticker))
  ])];

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;
  const timeColor = timeLeft < 60 ? "#ef4444" : timeLeft < 180 ? "#f59e0b" : "#22c55e";

  const openManage = () => {
    setFrozenPrices({ ...prices }); // freeze prices at this moment
    setPaused(true);
    setShowManage(true);
  };

  const closeManage = (updatedPortfolio) => {
    if (updatedPortfolio) setPortfolio(updatedPortfolio);
    setFrozenPrices(null);
    setPaused(false);
    setShowManage(false);
  };

  const activePrices = frozenPrices || prices;

  const runTick = useCallback(() => {
    setPricesLocal(prev => {
      const next = { ...prev };
      const newEvents = [];
      uniqueTickers.forEach(ticker => {
        const current = prev[ticker];
        if (!current) return;
        const personality = STOCK_PERSONALITIES[ticker] || "volatile";
        const { newPrice, changePct } = simulatePrice(current.price, personality);
        next[ticker] = { ...current, prevPrice: current.price, price: newPrice };
        if (Math.abs(changePct) > 0.08) {
          const type = changePct > 0 ? "spike" : "crash";
          const templates = EVENT_TEMPLATES[type];
          const template = templates[Math.floor(Math.random() * templates.length)];
          const text = template
            .replace("{company}", current.companyName || ticker)
            .replace("{pct}", (Math.abs(changePct) * 100).toFixed(1) + "%");
          newEvents.push({ id: uid(), text, ticker, type });
        }
      });
      if (newEvents.length) setEvents(prev => [...prev.slice(-4), ...newEvents].slice(-5));
      return next;
    });
    // Update challenger holdings too (AI picks use same price engine)
    setChallengers(prev => prev.map(c => ({ ...c })));
  }, [uniqueTickers]);

  const startSim = () => {
    setStarted(true);
    tickRef.current = setInterval(() => {
      if (!paused) runTick();
    }, 4000); // 4 second ticks
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(tickRef.current);
          clearInterval(timerRef.current);
          setEnded(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Sync local prices back to parent
  useEffect(() => { setPrices(prices); }, [prices]);

  const calcValue = (picks, cash) => {
    const stockVal = picks.reduce((s, p) => {
      const price = activePrices[p.ticker]?.price;
      if (!price || !p.purchasePrice || !p.spent) return s + p.spent;
      return s + price * (p.spent / p.purchasePrice);
    }, 0);
    return stockVal + (cash || 0);
  };

  const playerValue = portfolio ? calcValue(portfolio.picks, portfolio.cashBalance) : ARCADE_BUDGET;
  const challengerValues = challengers.map(c => ({ ...c, value: calcValue(c.picks, 0) }));

  const allPlayers = [
    { name: playerName, value: playerValue, isPlayer: true },
    ...challengerValues.map(c => ({ name: `${c.emoji} ${c.name}`, value: c.value, isPlayer: false }))
  ].sort((a, b) => b.value - a.value);
  const playerRank = allPlayers.findIndex(p => p.isPlayer) + 1;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0514 0%, #0f0a1e 50%, #0a0514 100%)", fontFamily: "'DM Sans', sans-serif", color: "#e0e8ff" }}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>

      {/* Arcade header */}
      <div style={{ background: "linear-gradient(90deg, #0d0520, #1a0a35)", borderBottom: "2px solid #7c3aed", padding: "0 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ background: "#7c3aed", borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🕹️</div>
            <div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 3, color: "#a78bfa" }}>ARCADE MODE</div>
              <div style={{ fontSize: 10, color: "#5544aa", letterSpacing: 1 }}>SOLO SESSION — NOT LINKED TO CLASS</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {started && !ended && (
              <div style={{ fontFamily: "monospace", fontSize: 26, fontWeight: 700, color: timeColor, minWidth: 60, textAlign: "center" }}>{timeStr}</div>
            )}
            {paused && started && !ended && (
              <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, letterSpacing: 1 }}>⏸ PAUSED</div>
            )}
            {!started && !ended && (
              <button onClick={startSim}
                style={{ background: "#7c3aed", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", padding: "8px 22px", fontSize: 13, fontWeight: 700 }}>
                ▶ Start Session
              </button>
            )}
            <button onClick={onStop} style={{ background: "none", border: "1px solid #3a1a5a", borderRadius: 8, color: "#7c3aed", cursor: "pointer", padding: "8px 14px", fontSize: 12 }}>
              ✕ Exit
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>
        {/* Session ended */}
        {ended && (
          <div style={{ background: "#1a0a2e", border: "2px solid #7c3aed", borderRadius: 12, padding: "24px", marginBottom: 24, textAlign: "center" }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, letterSpacing: 4, color: "#a78bfa", marginBottom: 8 }}>SESSION OVER</div>
            <div style={{ fontSize: 16, color: "#e0e8ff", marginBottom: 4 }}>
              You finished <span style={{ color: "#FFD966", fontWeight: 700 }}>#{playerRank}</span> out of {allPlayers.length}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: (playerValue - ARCADE_BUDGET) >= 0 ? "#22c55e" : "#ef4444", marginBottom: 20 }}>
              {fmtPct((playerValue - ARCADE_BUDGET) / ARCADE_BUDGET * 100)} · {fmt$(playerValue - ARCADE_BUDGET)}
            </div>
            <button onClick={onStop} style={{ background: "#7c3aed", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", padding: "10px 28px", fontSize: 13, fontWeight: 700 }}>
              🔄 Play Again
            </button>
          </div>
        )}

        {/* Player cards grid — same layout as live dashboard */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14, marginBottom: 24 }}>
          {/* Player card */}
          <ArcadeStudentCard
            name={playerName}
            picks={portfolio?.picks || []}
            prices={activePrices}
            budget={ARCADE_BUDGET}
            cashBalance={portfolio?.cashBalance || 0}
            isPlayer={true}
            onClick={started && !ended ? openManage : null}
          />
          {/* AI challenger cards */}
          {challengerValues.map(c => (
            <ArcadeStudentCard
              key={c.id}
              name={c.name}
              emoji={c.emoji}
              portrait={c.portrait}
              description={c.description}
              picks={c.picks}
              prices={activePrices}
              budget={ARCADE_BUDGET}
              cashBalance={0}
              isPlayer={false}
              onClick={null}
            />
          ))}
        </div>

        {/* Auto-scrolling ticker tape */}
        {started && (
          <div style={{ background: "#0a0f1a", border: "1px solid #1a1a3a", borderRadius: 8, padding: "8px 0", marginBottom: 12, overflow: "hidden", position: "relative" }}>
            <style>{`
              @keyframes tickerScroll {
                0% { transform: translateX(0); }
                100% { transform: translateX(-50%); }
              }
              .ticker-track {
                display: flex;
                gap: 0;
                animation: tickerScroll ${Math.max(uniqueTickers.length * 3, 12)}s linear infinite;
                width: max-content;
              }
            `}</style>
            <div className="ticker-track">
              {[...uniqueTickers, ...uniqueTickers].map((ticker, i) => {
                const p = prices[ticker];
                const change = p?.prevPrice ? ((p.price - p.prevPrice) / p.prevPrice * 100) : 0;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 20px", borderRight: "1px solid #1a1a3a", flexShrink: 0 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "#a78bfa" }}>{ticker}</span>
                    <span style={{ fontSize: 11, color: "#e0e8ff" }}>{fmt$(p?.price)}</span>
                    <span style={{ fontSize: 10, color: change >= 0 ? "#22c55e" : "#ef4444" }}>{change >= 0 ? "▲" : "▼"}{Math.abs(change).toFixed(2)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Leaderboard ranking */}
        {started && (
          <div style={{ background: "#0f1a2e", border: "1px solid #1e3560", borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#5544aa", letterSpacing: 1.5, marginBottom: 10 }}>STANDINGS</div>
            <div style={{ display: "flex", gap: 0 }}>
              {allPlayers.map((p, i) => {
                const medals = ["🥇","🥈","🥉","4️⃣"];
                const pnl = p.value - ARCADE_BUDGET;
                const pct = (pnl / ARCADE_BUDGET) * 100;
                return (
                  <div key={p.name} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderLeft: i > 0 ? "1px solid #1a1a3a" : "none", background: p.isPlayer ? "#1a0a2e" : "transparent", borderRadius: i === 0 ? "6px 0 0 6px" : i === allPlayers.length - 1 ? "0 6px 6px 0" : 0 }}>
                    <span style={{ fontSize: 16 }}>{medals[i]}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: p.isPlayer ? 700 : 400, color: p.isPlayer ? "#a78bfa" : "#e0e8ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: pct >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{fmtPct(pct)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Event news banner — inline under leaderboard */}
        {events.length > 0 && started && (
          <div style={{ background: "#1a0a2e", border: "1px solid #7c3aed55", borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "#c4b5fd", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span>{events[events.length - 1].text}</span>
            <button onClick={() => setEvents(prev => prev.slice(0, -1))} style={{ background: "none", border: "none", color: "#5544aa", cursor: "pointer", fontSize: 16, flexShrink: 0 }}>✕</button>
          </div>
        )}

        {!started && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#445577" }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>Press <strong style={{ color: "#a78bfa" }}>▶ Start Session</strong> to begin the {ARCADE_SESSION_MINUTES}-minute trading session.</div>
            <div style={{ fontSize: 12 }}>Prices will update every 4 seconds. Click your card to manage holdings.</div>
          </div>
        )}
      </div>

      {showManage && (
        <ArcadeManageModal
          portfolio={portfolio}
          prices={frozenPrices}
          onSave={(updated) => closeManage(updated)}
          onClose={() => closeManage(null)}
        />
      )}


    </div>
  );
}


// ── Mode Select Modal ─────────────────────────────────────────────────────────
function ModeSelectModal({ onSelectLive, onSelectArcade }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 560, textAlign: "center" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, letterSpacing: 4, color: "#FFD966", marginBottom: 8 }}>STOCK MARKET SIM</div>
        <div style={{ fontSize: 14, color: "#5566aa", marginBottom: 40 }}>Choose your mode for this session</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Live Mode */}
          <div onClick={onSelectLive}
            style={{ background: "#0f2347", border: "2px solid #1C4587", borderRadius: 16, padding: "28px 20px", cursor: "pointer", transition: "all 0.2s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#FFD966"; e.currentTarget.style.transform = "translateY(-4px)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#1C4587"; e.currentTarget.style.transform = "translateY(0)"; }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📈</div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 3, color: "#FFD966", marginBottom: 8 }}>LIVE MARKET</div>
            <div style={{ fontSize: 13, color: "#8899bb", lineHeight: 1.6 }}>
              Connect to your class roster. Real prices, real stakes. Linked to the shared dashboard.
            </div>
            <div style={{ marginTop: 16, background: "#1C4587", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, color: "#e0e8ff" }}>
              Enter Live Mode →
            </div>
          </div>

          {/* Arcade Mode */}
          <div onClick={onSelectArcade}
            style={{ background: "#0f2347", border: "2px solid #7c3aed", borderRadius: 16, padding: "28px 20px", cursor: "pointer", transition: "all 0.2s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#FFD966"; e.currentTarget.style.transform = "translateY(-4px)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#7c3aed"; e.currentTarget.style.transform = "translateY(0)"; }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🕹️</div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 3, color: "#a78bfa", marginBottom: 8 }}>ARCADE MODE</div>
            <div style={{ fontSize: 13, color: "#8899bb", lineHeight: 1.6 }}>
              Solo session. Market always open. Compete against AI challengers. Fresh start every time.
            </div>
            <div style={{ marginTop: 16, background: "#7c3aed", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, color: "#fff" }}>
              Play Arcade →
            </div>
          </div>
        </div>

        <div style={{ marginTop: 24, fontSize: 11, color: "#334466" }}>
          Arcade mode is local only — progress is not saved to the class dashboard
        </div>
      </div>
    </div>
  );
}

// ── Arcade Stock Picker ────────────────────────────────────────────────────────
function ArcadeStockPicker({ onStart, onCancel }) {
  const [step, setStep] = useState("opponents"); // "opponents" | "stocks"
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [rows, setRows] = useState([
    { id: uid(), ticker: "", amount: "" },
    { id: uid(), ticker: "", amount: "" },
    { id: uid(), ticker: "", amount: "" },
  ]);
  const [loading, setLoading] = useState(false);
  const [warnings, setWarnings] = useState({});

  const totalSpent = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const cashLeft = ARCADE_BUDGET - totalSpent;
  const overBudget = totalSpent > ARCADE_BUDGET;
  const validRows = rows.filter(r => r.ticker.trim() && parseFloat(r.amount) > 0);
  const selectedChallengers = AI_CHALLENGER_ROSTER.filter(c => selectedIds.has(c.id));

  const toggleChallenger = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else if (next.size < 3) { next.add(id); }
      return next;
    });
  };

  const addRow = () => { if (rows.length < 8) setRows(p => [...p, { id: uid(), ticker: "", amount: "" }]); };
  const removeRow = (id) => setRows(p => p.filter(r => r.id !== id));
  const updateRow = (id, field, val) => {
    setRows(p => p.map(r => r.id === id ? { ...r, [field]: field === "ticker" ? val.toUpperCase() : val } : r));
    if (field === "ticker") {
      const t = val.toUpperCase().trim();
      setWarnings(prev => ({
        ...prev,
        [id]: t.length > 0 && !STOCK_PERSONALITIES[t] ? `${t} unknown — will simulate as volatile` : null
      }));
    }
  };

  const handleStart = async () => {
    if (!validRows.length || overBudget || selectedIds.size !== 3) return;
    setLoading(true);
    const allTickers = [...new Set([
      ...validRows.map(r => r.ticker.trim().toUpperCase()),
      ...selectedChallengers.flatMap(c => c.picks.map(p => p.ticker))
    ])];
    const priceResults = await Promise.all(allTickers.map(async t => {
      try {
        const res = await fetch('/api/proxy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: t })
        });
        const data = await res.json();
        const price = data.previousClose || data.currentPrice;
        if (!price) return { ticker: t, price: null, companyName: t, error: true };
        return { ticker: t, price, companyName: data.companyName || t, error: false };
      } catch (e) {
        return { ticker: t, price: null, companyName: t, error: true };
      }
    }));
    const failed = priceResults.filter(r => r.error);
    if (failed.length) {
      alert(`Could not fetch prices for: ${failed.map(r => r.ticker).join(", ")}. Please check these tickers and try again.`);
      setLoading(false);
      return;
    }
    const priceMap = {};
    priceResults.forEach(r => { priceMap[r.ticker] = { price: r.price, companyName: r.companyName }; });
    setLoading(false);
    onStart(
      validRows.map(r => ({
        ticker: r.ticker.trim().toUpperCase(),
        spent: parseFloat(r.amount),
        personality: STOCK_PERSONALITIES[r.ticker.trim().toUpperCase()] || "volatile",
      })),
      priceMap,
      selectedChallengers
    );
  };

  const iStyle = { background: "#0d1f3c", border: "1px solid #2a3f6b", borderRadius: 6, color: "#e0e8ff", padding: "8px 10px", fontSize: 13, outline: "none", boxSizing: "border-box", width: "100%" };
  const pctUsed = Math.min((totalSpent / ARCADE_BUDGET) * 100, 100);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16, overflowY: "auto" }}>
      <div style={{ background: "#0f2347", border: "2px solid #7c3aed", borderRadius: 16, padding: 28, width: "100%", maxWidth: step === "opponents" ? 680 : 520, boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <span style={{ fontSize: 24 }}>🕹️</span>
          <div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 3, color: "#a78bfa" }}>ARCADE MODE</div>
            <div style={{ fontSize: 12, color: "#5566aa" }}>{step === "opponents" ? "Step 1 of 2 — Choose your 3 opponents" : "Step 2 of 2 — Pick your stocks"}</div>
          </div>
        </div>

        {/* Step indicator */}
        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          {["opponents","stocks"].map((s, i) => (
            <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: step === s || (i === 0 && step === "stocks") ? "#7c3aed" : "#1e3560" }}/>
          ))}
        </div>

        {/* ── STEP 1: Opponent selection ── */}
        {step === "opponents" && (
          <>
            <div style={{ fontSize: 12, color: "#5566aa", marginBottom: 16 }}>
              Select exactly 3 opponents. Each has a distinct strategy — choose wisely.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
              {AI_CHALLENGER_ROSTER.map(c => {
                const selected = selectedIds.has(c.id);
                const disabled = !selected && selectedIds.size >= 3;
                return (
                  <div key={c.id} onClick={() => !disabled && toggleChallenger(c.id)}
                    style={{ background: selected ? "#1a0a3a" : "#0a1628", border: `2px solid ${selected ? "#7c3aed" : disabled ? "#1a1a2a" : "#1e3560"}`, borderRadius: 10, padding: "12px 14px", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1, transition: "all 0.15s" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      {c.portrait ? (
                        <img src={c.portrait} alt={c.name}
                          onError={e => { e.currentTarget.style.display="none"; }}
                          style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}/>
                      ) : (
                        <span style={{ fontSize: 22, flexShrink: 0 }}>{c.emoji}</span>
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: selected ? "#a78bfa" : "#e0e8ff" }}>{c.name}</div>
                          {selected && <span style={{ fontSize: 10, color: "#7c3aed", background: "#2a1a4e", border: "1px solid #7c3aed55", borderRadius: 3, padding: "1px 6px" }}>✓ SELECTED</span>}
                        </div>
                        <div style={{ fontSize: 11, color: "#5566aa", marginTop: 2, fontStyle: "italic" }}>"{c.quote}"</div>
                        <div style={{ fontSize: 10, color: "#445577", marginTop: 4 }}>{c.picks.map(p => p.ticker).join(" · ")}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={onCancel} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: "#8899bb", cursor: "pointer", padding: "11px 20px", fontSize: 13 }}>← Back</button>
              <button onClick={() => setStep("stocks")} disabled={selectedIds.size !== 3}
                style={{ flex: 1, background: selectedIds.size === 3 ? "#7c3aed" : "#2a2040", border: "none", borderRadius: 8, color: selectedIds.size === 3 ? "#fff" : "#5566aa", cursor: selectedIds.size === 3 ? "pointer" : "default", padding: "11px 0", fontSize: 13, fontWeight: 700 }}>
                {selectedIds.size === 3 ? "Next: Pick Your Stocks →" : `Select ${3 - selectedIds.size} more opponent${3 - selectedIds.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </>
        )}

        {/* ── STEP 2: Stock picker ── */}
        {step === "stocks" && (
          <>
            {/* Selected opponents preview */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {selectedChallengers.map(c => (
                <div key={c.id} style={{ flex: 1, background: "#0a1628", border: "1px solid #1e3560", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                  {c.portrait ? (
                    <img src={c.portrait} alt={c.name} style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", margin: "0 auto 4px", display: "block" }}/>
                  ) : (
                    <div style={{ fontSize: 16 }}>{c.emoji}</div>
                  )}
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#e0e8ff" }}>{c.name}</div>
                </div>
              ))}
            </div>

            {/* Budget bar */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5 }}>
                <span style={{ color: "#8899bb" }}>BUDGET</span>
                <span style={{ fontWeight: 700, color: overBudget ? "#ef4444" : cashLeft < 500 ? "#f59e0b" : "#22c55e" }}>{fmt$(cashLeft)} remaining</span>
              </div>
              <div style={{ height: 6, background: "#0d1f3c", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pctUsed}%`, background: overBudget ? "#ef4444" : pctUsed > 90 ? "#f59e0b" : "#7c3aed", borderRadius: 4, transition: "width 0.3s ease" }}/>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 28px", gap: 8, marginBottom: 6 }}>
              {["TICKER", "$ TO INVEST", ""].map(h => <div key={h} style={{ fontSize: 10, color: "#445577", letterSpacing: 1 }}>{h}</div>)}
            </div>
            {rows.map(r => (
              <div key={r.id} style={{ marginBottom: warnings[r.id] ? 4 : 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 28px", gap: 8, alignItems: "center" }}>
                  <input value={r.ticker} onChange={e => updateRow(r.id, "ticker", e.target.value)} placeholder="AAPL"
                    style={{ ...iStyle, fontFamily: "monospace", textTransform: "uppercase" }}/>
                  <input type="number" min="0" value={r.amount} onChange={e => updateRow(r.id, "amount", e.target.value)} placeholder="Amount ($)" style={iStyle}/>
                  <button onClick={() => removeRow(r.id)} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 6, color: "#ef4444", cursor: "pointer", fontSize: 13, height: 34, width: 28 }}>✕</button>
                </div>
                {warnings[r.id] && <div style={{ fontSize: 10, color: "#f59e0b", padding: "3px 4px" }}>⚠️ {warnings[r.id]}</div>}
              </div>
            ))}
            {rows.length < 8 && (
              <button onClick={addRow} style={{ background: "none", border: "1px dashed #2a3f6b", borderRadius: 6, color: "#8899bb", cursor: "pointer", padding: "7px 0", width: "100%", fontSize: 12, marginBottom: 8 }}>+ Add Stock</button>
            )}
            {overBudget && (
              <div style={{ background: "#3a0f0f", border: "1px solid #ef4444", borderRadius: 6, padding: "8px 12px", color: "#fca5a5", fontSize: 12, marginBottom: 12 }}>
                ⚠️ Over budget by {fmt$(totalSpent - ARCADE_BUDGET)}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button onClick={() => setStep("opponents")} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: "#8899bb", cursor: "pointer", padding: "11px 20px", fontSize: 13 }}>← Back</button>
              <button onClick={handleStart} disabled={!validRows.length || overBudget || loading}
                style={{ flex: 1, background: (!validRows.length || overBudget || loading) ? "#2a2040" : "#7c3aed", border: "none", borderRadius: 8, color: (!validRows.length || overBudget || loading) ? "#5566aa" : "#fff", cursor: (!validRows.length || overBudget || loading) ? "default" : "pointer", padding: "11px 0", fontSize: 13, fontWeight: 700 }}>
                {loading ? "⟳ Fetching starting prices…" : "🚀 Start Session"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Bulk Add Modal ────────────────────────────────────────────────────────────
function BulkAddModal({ classes, onAdd, onClose }) {
  const [text, setText] = useState("");
  const [cls, setCls] = useState(classes[0] || "");
  const [newClass, setNewClass] = useState("");
  const [preview, setPreview] = useState([]);

  const parse = (raw) => {
    return raw.split("\n")
      .map(l => l.replace(/^[\d]+[.)\s]+/, "").trim())
      .filter(l => l.length > 1);
  };

  useEffect(() => { setPreview(parse(text)); }, [text]);

  const handleSubmit = () => {
    const className = (cls === "" || !classes.length) ? newClass.trim() : cls;
    if (!className || !preview.length) return;
    preview.forEach(name => {
      onAdd({ id: uid(), name, className, budget: BUDGET, holdings: [], notes: "", pinHash: null, cashBalance: BUDGET });
    });
    onClose();
  };

  const iStyle = { background: "#0d1f3c", border: "1px solid #2a3f6b", borderRadius: 6, color: "#e0e8ff", padding: "8px 12px", fontSize: 13, width: "100%", outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: "#0f2347", border: "1px solid #2a3f6b", borderRadius: 12, padding: 28, width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, color: "#FFD966", fontSize: 16, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: 2 }}>BULK ADD STUDENTS</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8899bb", cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: "#8899bb", display: "block", marginBottom: 4 }}>CLASS / PERIOD</label>
          {classes.length > 0 && (
            <select value={cls} onChange={e => setCls(e.target.value)} style={{ ...iStyle, marginBottom: cls === "" ? 8 : 0 }}>
              {classes.map(c => <option key={c}>{c}</option>)}
              <option value="">+ New class…</option>
            </select>
          )}
          {(cls === "" || !classes.length) && (
            <input value={newClass} onChange={e => setNewClass(e.target.value)} placeholder="e.g. Period 3" style={iStyle}/>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: "#8899bb", display: "block", marginBottom: 4 }}>PASTE STUDENT NAMES — one per line</label>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={"Jane Smith\nJohn Doe\nAlex Johnson"}
            rows={8}
            style={{ ...iStyle, resize: "vertical", lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" }}
          />
        </div>

        {preview.length > 0 && (
          <div style={{ background: "#0d1f3c", border: "1px solid #2a3f6b", borderRadius: 8, padding: "12px 14px", marginBottom: 16, maxHeight: 180, overflowY: "auto" }}>
            <div style={{ fontSize: 10, color: "#445577", letterSpacing: 1, marginBottom: 8 }}>PREVIEW — {preview.length} student{preview.length !== 1 ? "s" : ""}</div>
            {preview.map((name, i) => (
              <div key={i} style={{ fontSize: 13, color: "#c0cfea", padding: "3px 0", borderBottom: i < preview.length - 1 ? "1px solid #1a2d52" : "none" }}>
                {name}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: "#8899bb", cursor: "pointer", padding: "9px 20px", fontSize: 13 }}>Cancel</button>
          <button onClick={handleSubmit} disabled={!preview.length}
            style={{ background: preview.length ? "#FFD966" : "#2a3a5a", border: "none", borderRadius: 8, color: preview.length ? "#0d1f3c" : "#5566aa", cursor: preview.length ? "pointer" : "default", padding: "9px 20px", fontSize: 13, fontWeight: 700 }}>
            Add {preview.length > 0 ? preview.length : ""} Student{preview.length !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddStudentModal({ classes, onAdd, onClose }) {
  const [name, setName] = useState("");
  const [cls, setCls] = useState(classes[0] || "");
  const [newClass, setNewClass] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [pinError, setPinError] = useState("");

  const handleSubmit = async () => {
    if (!name.trim()) return;
    const className = (cls === "" || !classes.length) ? newClass.trim() : cls;
    if (!className) return;
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { setPinError("PIN must be exactly 4 digits."); return; }
    if (pin !== pin2) { setPinError("PINs do not match."); return; }
    const pinHash = await hashPin(pin);
    onAdd({ id: uid(), name: name.trim(), className, budget: BUDGET, holdings: [], notes: "", pinHash, cashBalance: BUDGET });
    onClose();
  };

  const iStyle = { background: "#0d1f3c", border: "1px solid #2a3f6b", borderRadius: 6, color: "#e0e8ff", padding: "8px 12px", fontSize: 13, width: "100%", outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: "#0f2347", border: "1px solid #2a3f6b", borderRadius: 12, padding: 28, width: "100%", maxWidth: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, color: "#FFD966", fontSize: 16, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: 2 }}>ADD STUDENT</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8899bb", cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: "#8899bb", display: "block", marginBottom: 4 }}>STUDENT NAME</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="First Last" style={iStyle} onKeyDown={e => e.key === "Enter" && handleSubmit()}/>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 11, color: "#8899bb", display: "block", marginBottom: 4 }}>CLASS / PERIOD</label>
          {classes.length > 0 && (
            <select value={cls} onChange={e => setCls(e.target.value)} style={{ ...iStyle, marginBottom: cls === "" ? 8 : 0 }}>
              {classes.map(c => <option key={c}>{c}</option>)}
              <option value="">+ New class…</option>
            </select>
          )}
          {(cls === "" || !classes.length) && (
            <input value={newClass} onChange={e => setNewClass(e.target.value)} placeholder="e.g. Period 2" style={iStyle}/>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: "#8899bb", display: "block", marginBottom: 4 }}>STUDENT PIN (4 digits)</label>
            <input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g,"")); setPinError(""); }} placeholder="••••" style={iStyle}/>
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#8899bb", display: "block", marginBottom: 4 }}>CONFIRM PIN</label>
            <input type="password" inputMode="numeric" maxLength={4} value={pin2} onChange={e => { setPin2(e.target.value.replace(/\D/g,"")); setPinError(""); }} placeholder="••••" style={iStyle}/>
          </div>
        </div>
        {pinError && <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 10 }}>{pinError}</div>}

        <p style={{ fontSize: 11, color: "#5566aa", margin: "0 0 18px", fontStyle: "italic" }}>
          Students use this PIN to access their portfolio. The teacher PIN always works.
        </p>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: "#8899bb", cursor: "pointer", padding: "9px 20px", fontSize: 13 }}>Cancel</button>
          <button onClick={handleSubmit} style={{ background: "#FFD966", border: "none", borderRadius: 8, color: "#0d1f3c", cursor: "pointer", padding: "9px 20px", fontSize: 13, fontWeight: 700 }}>Add Student</button>
        </div>
      </div>
    </div>
  );
}



// ── Sector map (common tickers → sector, fallback to "Other") ─────────────────
const SECTOR_MAP = {
  // Technology
  AAPL:"Technology", MSFT:"Technology", NVDA:"Technology", GOOGL:"Technology",
  GOOG:"Technology", META:"Technology", AMZN:"Technology", TSLA:"Technology",
  AMD:"Technology", INTC:"Technology", QCOM:"Technology", AVGO:"Technology",
  CRM:"Technology", ORCL:"Technology", IBM:"Technology", ADBE:"Technology",
  SNOW:"Technology", PLTR:"Technology", UBER:"Technology", LYFT:"Technology",
  SHOP:"Technology", SPOT:"Technology", PINS:"Technology", SNAP:"Technology",
  TWTR:"Technology", RBLX:"Technology", U:"Technology", ABNB:"Technology",
  // Finance
  JPM:"Finance", BAC:"Finance", WFC:"Finance", GS:"Finance", MS:"Finance",
  C:"Finance", AXP:"Finance", V:"Finance", MA:"Finance", PYPL:"Finance",
  BLK:"Finance", SCHW:"Finance", COF:"Finance", USB:"Finance", PNC:"Finance",
  // Healthcare
  JNJ:"Healthcare", PFE:"Healthcare", MRK:"Healthcare", UNH:"Healthcare",
  ABBV:"Healthcare", LLY:"Healthcare", TMO:"Healthcare", ABT:"Healthcare",
  BMY:"Healthcare", AMGN:"Healthcare", GILD:"Healthcare", CVS:"Healthcare",
  // Energy
  XOM:"Energy", CVX:"Energy", COP:"Energy", SLB:"Energy", EOG:"Energy",
  MPC:"Energy", PSX:"Energy", VLO:"Energy", OXY:"Energy", HAL:"Energy",
  // Consumer
  WMT:"Consumer", HD:"Consumer", MCD:"Consumer", SBUX:"Consumer", NKE:"Consumer",
  TGT:"Consumer", LOW:"Consumer", COST:"Consumer", DIS:"Consumer", NFLX:"Consumer",
  CMCSA:"Consumer", F:"Consumer", GM:"Consumer", TSCO:"Consumer",
  // Industrials
  BA:"Industrials", CAT:"Industrials", GE:"Industrials", HON:"Industrials",
  UPS:"Industrials", RTX:"Industrials", LMT:"Industrials", DE:"Industrials",
  MMM:"Industrials", FDX:"Industrials",
  // Real Estate
  AMT:"Real Estate", PLD:"Real Estate", EQIX:"Real Estate", CCI:"Real Estate",
  // Utilities
  NEE:"Utilities", DUK:"Utilities", SO:"Utilities", D:"Utilities",
  // Materials
  LIN:"Materials", APD:"Materials", ECL:"Materials", NEM:"Materials",
  // Crypto-adjacent
  COIN:"Crypto", MSTR:"Crypto", RIOT:"Crypto", MARA:"Crypto",
};

const SECTOR_COLORS = {
  Technology:"#6366f1", Finance:"#22c55e", Healthcare:"#f59e0b",
  Energy:"#ef4444", Consumer:"#ec4899", Industrials:"#14b8a6",
  "Real Estate":"#a78bfa", Utilities:"#fb923c", Materials:"#84cc16",
  Crypto:"#fbbf24", Other:"#6677aa",
};

function calcDiversityScore(holdings) {
  if (!holdings.length) return { score: 0, sectors: {}, label: "None", color: "#445577" };
  const sectorSpend = {};
  holdings.forEach(h => {
    const sector = SECTOR_MAP[h.ticker] || "Other";
    sectorSpend[sector] = (sectorSpend[sector] || 0) + h.spent;
  });
  const total = Object.values(sectorSpend).reduce((a, b) => a + b, 0);
  const n = Object.keys(sectorSpend).length;
  // Herfindahl-Hirschman Index (lower = more diverse)
  const hhi = Object.values(sectorSpend).reduce((sum, v) => sum + Math.pow(v / total, 2), 0);
  // Normalize to 0-100 (100 = perfectly even across all sectors)
  const maxHHI = 1; // one sector
  const minHHI = 1 / n;
  const raw = n === 1 ? 0 : ((maxHHI - hhi) / (maxHHI - minHHI)) * 100;
  const score = Math.round(Math.min(raw * 1.1, 100)); // slight boost for readability
  const label = score >= 75 ? "Excellent" : score >= 50 ? "Good" : score >= 25 ? "Fair" : "Concentrated";
  const color = score >= 75 ? "#22c55e" : score >= 50 ? "#84cc16" : score >= 25 ? "#f59e0b" : "#ef4444";
  return { score, sectors: sectorSpend, label, color, total };
}

function DiversityPanel({ holdings }) {
  const { score, sectors, label, color, total } = calcDiversityScore(holdings);
  if (!holdings.length) return null;

  const sectorEntries = Object.entries(sectors).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 12, padding: "20px" }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, color: "#FFD966", letterSpacing: 2, marginBottom: 16 }}>Portfolio Diversity</div>

      {/* Score ring area */}
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", marginBottom: 16 }}>
        <div style={{ textAlign: "center", flexShrink: 0 }}>
          <div style={{ fontSize: 42, fontWeight: 700, color, lineHeight: 1 }}>{score}</div>
          <div style={{ fontSize: 11, color, fontWeight: 600, marginTop: 2 }}>{label}</div>
          <div style={{ fontSize: 10, color: "#445577", marginTop: 1 }}>/ 100</div>
        </div>

        {/* Sector breakdown bars */}
        <div style={{ flex: 1 }}>
          {sectorEntries.map(([sector, spent]) => {
            const pct = total ? (spent / total) * 100 : 0;
            const sColor = SECTOR_COLORS[sector] || SECTOR_COLORS.Other;
            return (
              <div key={sector} style={{ marginBottom: 7 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                  <span style={{ color: "#c0cfea" }}>{sector}</span>
                  <span style={{ color: "#6677aa" }}>{pct.toFixed(1)}% · {fmt$(spent)}</span>
                </div>
                <div style={{ height: 6, background: "#0d1f3c", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: sColor, borderRadius: 3, transition: "width 0.5s ease" }}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sector dots legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
        {sectorEntries.map(([sector]) => (
          <span key={sector} style={{ fontSize: 10, color: "#6677aa", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: SECTOR_COLORS[sector] || SECTOR_COLORS.Other, display: "inline-block" }}/>
            {sector}
          </span>
        ))}
      </div>

      {score < 50 && (
        <div style={{ marginTop: 12, fontSize: 11, color: "#f59e0b", background: "#2a1f0a", border: "1px solid #f59e0b33", borderRadius: 6, padding: "8px 12px" }}>
          💡 This portfolio is concentrated in {sectorEntries[0]?.[0]}. Spreading across more sectors reduces risk.
        </div>
      )}
    </div>
  );
}

// ── Portfolio History Chart ───────────────────────────────────────────────────
function PortfolioHistoryChart({ history }) {
  if (!history || history.length < 2) return (
    <div style={{ padding: "20px", textAlign: "center", color: "#445577", fontSize: 13 }}>
      Portfolio history builds up over time as you refresh prices each session.
    </div>
  );

  const values = history.map(h => h.value);
  const dates = history.map(h => h.date);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 580, H = 120, PAD = { t: 10, r: 10, b: 28, l: 60 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;

  const toX = (i) => PAD.l + (i / (values.length - 1)) * chartW;
  const toY = (v) => PAD.t + chartH - ((v - min) / range) * chartH;

  const pts = values.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
  const area = `${toX(0)},${PAD.t + chartH} ${pts} ${toX(values.length - 1)},${PAD.t + chartH}`;

  const isPos = values[values.length - 1] >= values[0];
  const lineColor = isPos ? "#22c55e" : "#ef4444";

  // y-axis labels
  const yTicks = [min, min + range * 0.5, max];

  // x-axis: show first, middle, last dates
  const xLabels = [0, Math.floor((values.length - 1) / 2), values.length - 1].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="phg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.2"/>
          <stop offset="100%" stopColor={lineColor} stopOpacity="0"/>
        </linearGradient>
      </defs>
      {/* Grid lines */}
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={toY(v)} x2={W - PAD.r} y2={toY(v)} stroke="#1e3560" strokeWidth="1" strokeDasharray="3 3"/>
          <text x={PAD.l - 6} y={toY(v) + 4} textAnchor="end" fontSize="10" fill="#445577">
            ${Math.round(v).toLocaleString()}
          </text>
        </g>
      ))}
      {/* Area fill */}
      <polygon points={area} fill="url(#phg)"/>
      {/* Line */}
      <polyline points={pts} fill="none" stroke={lineColor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
      {/* Data point dots */}
      {values.map((v, i) => (
        <circle key={i} cx={toX(i)} cy={toY(v)} r="3" fill={lineColor} opacity="0.8"/>
      ))}
      {/* X labels */}
      {xLabels.map(i => (
        <text key={i} x={toX(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="#445577">
          {dates[i]}
        </text>
      ))}
    </svg>
  );
}


// ── What-If Simulator ─────────────────────────────────────────────────────────
function WhatIfSimulator({ student, prices, fetchPrice }) {
  const [rows, setRows] = useState([{ id: uid(), ticker: "", amount: "" }]);
  const [simPrices, setSimPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [simDate, setSimDate] = useState(new Date().toISOString().slice(0, 10));

  const today = new Date().toISOString().slice(0, 10);
  const isHistorical = simDate < today;

  const addRow = () => { if (rows.length < 5) setRows(p => [...p, { id: uid(), ticker: "", amount: "" }]); };
  const removeRow = (id) => setRows(p => p.filter(r => r.id !== id));
  const updateRow = (id, field, val) => setRows(p => p.map(r => r.id === id ? { ...r, [field]: field === "ticker" ? val.toUpperCase() : val } : r));

  const validRows = rows.filter(r => r.ticker.trim() && parseFloat(r.amount) > 0);
  const simTotal = validRows.reduce((s, r) => s + parseFloat(r.amount), 0);
  const overBudget = simTotal > BUDGET;

  const runSim = async () => {
    if (!validRows.length) return;
    setLoading(true);
    setRan(false);
    const results = await Promise.all(validRows.map(async r => {
      const ticker = r.ticker.trim().toUpperCase();
      if (isHistorical) {
        // fetch historical price for the chosen date
        const p = await fetchStockPriceOnDate(ticker, simDate);
        const currentP = prices[ticker]?.currentPrice || null;
        return { ticker, buyPrice: p?.closePrice || null, currentPrice: currentP, companyName: p?.companyName || ticker };
      } else {
        const cached = prices[ticker];
        if (cached?.currentPrice) return { ticker, buyPrice: cached.currentPrice, currentPrice: cached.currentPrice, companyName: cached.companyName };
        const p = await fetchPrice(ticker);
        return { ticker, buyPrice: p?.currentPrice || null, currentPrice: p?.currentPrice || null, companyName: p?.companyName || ticker };
      }
    }));
    const map = {};
    results.forEach(r => { map[r.ticker] = r; });
    setSimPrices(map);
    setLoading(false);
    setRan(true);
  };

  // Current portfolio stats
  const realInvested = student.holdings.reduce((s, h) => s + h.spent, 0);
  const realCurrent = student.holdings.reduce((s, h) => {
    const p = prices[h.ticker]?.currentPrice;
    return s + (p != null && h.shares != null ? p * h.shares : h.spent);
  }, 0);
  const realPct = realInvested > 0 ? ((realCurrent - realInvested) / realInvested) * 100 : 0;

  // Hypothetical stats
  const simInvested = validRows.reduce((s, r) => s + parseFloat(r.amount), 0);
  const simCurrent = ran ? validRows.reduce((s, r) => {
    const ticker = r.ticker.trim().toUpperCase();
    const price = simPrices[ticker]?.currentPrice;
    const spent = parseFloat(r.amount);
    if (!price) return s + spent;
    const shares = spent / price; // using current price as "buy price" for sim
    return s + shares * price; // same as spent since we bought at current — show P&L as 0 for identical price
  }, 0) : 0;

  // For what-if, we compare: if you had bought these instead, what would your P&L be TODAY
  // We use previousClose as the "buy price" and currentPrice as now, simulating a 1-day hold
  const simResults = ran ? validRows.map(r => {
    const ticker = r.ticker.trim().toUpperCase();
    const p = simPrices[ticker];
    const spent = parseFloat(r.amount);
    if (!p?.buyPrice) return { ticker, spent, pnl: null, pct: null };
    const buyPrice = p.buyPrice;
    const nowPrice = isHistorical ? (p.currentPrice || buyPrice) : buyPrice;
    const shares = spent / buyPrice;
    const nowVal = shares * nowPrice;
    const pnl = nowVal - spent;
    const pct = (pnl / spent) * 100;
    return { ticker, spent, shares, buyPrice, nowPrice, nowVal, pnl, pct, companyName: p.companyName };
  }) : [];

  const simTotalPnL = simResults.reduce((s, r) => s + (r.pnl || 0), 0);
  const simTotalPct = simInvested > 0 ? (simTotalPnL / simInvested) * 100 : 0;

  const iStyle = { background: "#0d1f3c", border: "1px solid #2a3f6b", borderRadius: 6, color: "#e0e8ff", padding: "7px 10px", fontSize: 13, outline: "none", boxSizing: "border-box", width: "100%" };

  return (
    <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 12, padding: "20px" }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, color: "#FFD966", letterSpacing: 2, marginBottom: 6 }}>What-If Simulator</div>
      <div style={{ fontSize: 12, color: "#445577", marginBottom: 16 }}>
        Hypothetically test alternative investments without affecting this student's real portfolio.
      </div>

      {/* Date picker */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#6677aa", letterSpacing: 1, whiteSpace: "nowrap" }}>PURCHASE DATE</div>
        <input type="date" value={simDate} max={today} onChange={e => { setSimDate(e.target.value); setRan(false); }}
          style={{ ...iStyle, width: "auto", borderColor: isHistorical ? "#f59e0b66" : "#2a3f6b" }}/>
        {isHistorical && (
          <span style={{ fontSize: 11, color: "#f59e0b" }}>📅 Will fetch historical prices for {simDate}</span>
        )}
      </div>

      {/* Input rows */}
      <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 28px", gap: 8, marginBottom: 6, padding: "0 2px" }}>
        {["TICKER", "$ TO INVEST", ""].map(h => <div key={h} style={{ fontSize: 10, color: "#445577", letterSpacing: 1 }}>{h}</div>)}
      </div>
      {rows.map(r => (
        <div key={r.id} style={{ display: "grid", gridTemplateColumns: "100px 1fr 28px", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <input value={r.ticker} onChange={e => updateRow(r.id, "ticker", e.target.value)} placeholder="AAPL" style={{ ...iStyle, fontFamily: "monospace", textTransform: "uppercase" }}/>
          <input type="number" min="0" max={BUDGET} value={r.amount} onChange={e => updateRow(r.id, "amount", e.target.value)} placeholder="Amount ($)" style={iStyle}/>
          <button onClick={() => removeRow(r.id)} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 6, color: "#ef4444", cursor: "pointer", fontSize: 13, height: 34, width: 28 }}>✕</button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: ran ? 20 : 0 }}>
        {rows.length < 5 && (
          <button onClick={addRow} style={{ background: "none", border: "1px dashed #2a3f6b", borderRadius: 6, color: "#8899bb", cursor: "pointer", padding: "6px 14px", fontSize: 12, flex: 1 }}>+ Add Stock</button>
        )}
        <button onClick={runSim} disabled={!validRows.length || loading || overBudget}
          style={{ background: (!validRows.length || loading || overBudget) ? "#2a3a5a" : "#1C4587", border: "1px solid #2a4a8a", borderRadius: 6, color: (!validRows.length || overBudget) ? "#5566aa" : "#e0e8ff", cursor: (!validRows.length || loading || overBudget) ? "default" : "pointer", padding: "6px 18px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
          {loading ? "⟳ Running…" : "▶ Run Simulation"}
        </button>
      </div>

      {/* Results */}
      {ran && simResults.length > 0 && (
        <>
          {/* Comparison bar */}
          <div style={{ background: "#0a1a38", border: "1px solid #1e3560", borderRadius: 8, padding: "14px 16px", marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: "#445577", letterSpacing: 1, marginBottom: 4 }}>REAL PORTFOLIO (TODAY)</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: realPct >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(realPct)}</div>
                <div style={{ fontSize: 11, color: "#6677aa" }}>{fmt$(realCurrent - realInvested)} on {fmt$(realInvested)}</div>
              </div>
              <div style={{ borderLeft: "1px solid #1e3560", paddingLeft: 12 }}>
                <div style={{ fontSize: 10, color: "#445577", letterSpacing: 1, marginBottom: 4 }}>{isHistorical ? `HYPOTHETICAL (SINCE ${simDate})` : "HYPOTHETICAL (TODAY)"}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: simTotalPct >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(simTotalPct)}</div>
                <div style={{ fontSize: 11, color: "#6677aa" }}>{simTotalPnL >= 0 ? "+" : ""}{fmt$(simTotalPnL)} on {fmt$(simInvested)}</div>
              </div>
            </div>
            <div style={{ marginTop: 10, padding: "8px 10px", background: simTotalPct > realPct ? "#0d2a1a" : "#2a0d0d", borderRadius: 6, fontSize: 12, color: simTotalPct > realPct ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
              {simTotalPct > realPct
                ? `📈 Hypothetical outperforms by ${(simTotalPct - realPct).toFixed(2)}% today`
                : simTotalPct < realPct
                ? `📉 Real portfolio outperforms by ${(realPct - simTotalPct).toFixed(2)}% today`
                : `↔ Identical performance today`}
            </div>
          </div>

          {/* Per-stock sim results */}
          <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 80px 80px 80px", gap: 8, padding: "0 4px", marginBottom: 6 }}>
            {["Ticker","Company","Invested","Value","P&L"].map(h => (
              <div key={h} style={{ fontSize: 10, color: "#445577", textTransform: "uppercase", letterSpacing: 1 }}>{h}</div>
            ))}
          </div>
          {simResults.map(r => (
            <div key={r.ticker} style={{ display: "grid", gridTemplateColumns: "70px 1fr 80px 80px 80px", gap: 8, padding: "9px 4px", borderTop: "1px solid #1a2d52", alignItems: "center" }}>
              <div style={{ fontFamily: "monospace", fontWeight: 700, color: "#FFD966", fontSize: 13 }}>{r.ticker}</div>
              <div style={{ fontSize: 12, color: "#aabbd0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.companyName || "—"}</div>
              <div style={{ fontSize: 12, color: "#c0cfea" }}>{fmt$(r.spent)}</div>
              <div style={{ fontSize: 12, color: "#c0cfea" }}>{r.nowVal != null ? fmt$(r.nowVal) : "—"}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: r.pnl == null ? "#445577" : r.pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                {r.pnl == null ? "—" : (r.pnl >= 0 ? "+" : "") + fmt$(r.pnl)}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 10, color: "#445577", marginTop: 10, fontStyle: "italic" }}>
            {isHistorical ? `Historical simulation: bought at ${simDate} prices, valued at today's prices.` : "Simulation uses current price as buy price and compares to today's value."}
          </div>
        </>
      )}
    </div>
  );
}


// ── Set / Change PIN Panel ────────────────────────────────────────────────────
function SetPinPanel({ student, onUpdatePin }) {
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const handleSet = async () => {
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { setErr("PIN must be exactly 4 digits."); return; }
    if (pin !== pin2) { setErr("PINs do not match."); return; }
    const pinHash = await hashPin(pin);
    onUpdatePin(student.id, pinHash);
    setPin(""); setPin2(""); setErr("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const iStyle = { background: "#0d1f3c", border: "1px solid #2a3f6b", borderRadius: 6, color: "#e0e8ff", padding: "8px 12px", fontSize: 14, outline: "none", boxSizing: "border-box", width: "100%", letterSpacing: 6, textAlign: "center" };

  return (
    <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 12, padding: "20px", marginTop: 16 }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, color: "#FFD966", letterSpacing: 2, marginBottom: 4 }}>
        {student.pinHash ? "Change PIN" : "Set Student PIN"}
      </div>
      <div style={{ fontSize: 12, color: "#445577", marginBottom: 14 }}>
        {student.pinHash ? "Enter a new 4-digit PIN to replace the current one." : "No PIN is set. Set one so this student can access their own portfolio."}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "0 0 140px" }}>
          <label style={{ fontSize: 10, color: "#5566aa", display: "block", marginBottom: 4, letterSpacing: 1 }}>NEW PIN</label>
          <input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g,"")); setErr(""); }} placeholder="••••" style={iStyle}/>
        </div>
        <div style={{ flex: "0 0 140px" }}>
          <label style={{ fontSize: 10, color: "#5566aa", display: "block", marginBottom: 4, letterSpacing: 1 }}>CONFIRM</label>
          <input type="password" inputMode="numeric" maxLength={4} value={pin2} onChange={e => { setPin2(e.target.value.replace(/\D/g,"")); setErr(""); }} placeholder="••••" style={iStyle}/>
        </div>
        <button onClick={handleSet} disabled={pin.length < 4}
          style={{ background: saved ? "#14532d" : pin.length >= 4 ? "#FFD966" : "#2a3a5a", border: "none", borderRadius: 8, color: saved ? "#22c55e" : pin.length >= 4 ? "#0d1f3c" : "#5566aa", cursor: pin.length >= 4 ? "pointer" : "default", padding: "8px 18px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
          {saved ? "✓ Saved" : student.pinHash ? "Update PIN" : "Set PIN"}
        </button>
      </div>
      {err && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 8 }}>{err}</div>}
    </div>
  );
}

function StudentDetail({ student, prices, onBack, onDelete, onUpdateHoldings, onUpdateNotes, onUpdatePin, onUpdateClass, onResetStudent, onError, fetchPrice, teacherMode }) {
  const [showManage, setShowManage] = useState(false);

  // Scroll to top when detail view opens
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const [notes, setNotes] = useState(student.notes || "");
  const [notesSaved, setNotesSaved] = useState(false);
  const [editingClass, setEditingClass] = useState(false);
  const [classInput, setClassInput] = useState(student.className);

  const handleSaveClass = () => {
    if (classInput.trim() && classInput.trim() !== student.className) {
      onUpdateClass(student.id, classInput.trim());
    }
    setEditingClass(false);
  };

  const handleSaveNotes = () => {
    onUpdateNotes(student.id, notes);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  };
  const totalInvested = student.holdings.reduce((s, h) => s + h.spent, 0);
  const cashLeft = student.cashBalance != null ? student.cashBalance : BUDGET - totalInvested;
  // Single-pass calculation to ensure all values use identical price snapshots
  const today = new Date().toISOString().slice(0, 10);
  const holdingStats = student.holdings.map(h => {
    const priceData = prices[h.ticker];
    const currentPrice = priceData?.currentPrice ?? null;
    const derivedShares = (h.purchasePrice && h.spent) ? h.spent / h.purchasePrice : 0;
    const currentValue = (currentPrice != null) ? currentPrice * derivedShares : h.spent;
    return { currentValue };
  });
  const stockValue = holdingStats.reduce((s, h) => s + h.currentValue, 0);
  const portfolioValue = stockValue + cashLeft;
  const totalPnL = portfolioValue - BUDGET;
  const totalPct = (totalPnL / BUDGET) * 100;
  const totalCurrent = stockValue;

  // Today's change — use previous day's history snapshot as baseline if available
  const todayStr = new Date().toISOString().slice(0, 10);
  const prevDayValue = getPrevDayValue(student.history, todayStr);
  const todayPnL = prevDayValue != null
    ? portfolioValue - prevDayValue
    : student.holdings.reduce((s, h) => {
        const p = prices[h.ticker];
        if (!p?.currentPrice || !p?.previousClose || !h.purchasePrice || !h.spent) return s;
        const derivedShares = h.spent / h.purchasePrice;
        const baseline = isMarketOpen() && h.date !== todayStr ? p.previousClose : h.purchasePrice;
        return s + (p.currentPrice - baseline) * derivedShares;
      }, 0);
  const todayPct = (todayPnL / BUDGET) * 100;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a1628 0%, #0f2040 50%, #0a1628 100%)", padding: "24px 20px", fontFamily: "'DM Sans', sans-serif", color: "#e0e8ff" }}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
          <button onClick={onBack} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: "#8899bb", cursor: "pointer", padding: "8px 14px", fontSize: 13 }}>← Back</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, letterSpacing: 3, color: "#e0e8ff" }}>{student.name}</div>
            {editingClass ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                <input
                  value={classInput}
                  onChange={e => setClassInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSaveClass(); if (e.key === "Escape") setEditingClass(false); }}
                  autoFocus
                  style={{ background: "#0d1f3c", border: "1px solid #2a4a8a", borderRadius: 5, color: "#e0e8ff", padding: "3px 8px", fontSize: 12, outline: "none", width: 140 }}
                />
                <button onClick={handleSaveClass} style={{ background: "#22c55e", border: "none", borderRadius: 5, color: "#0d1f3c", cursor: "pointer", padding: "3px 10px", fontSize: 11, fontWeight: 700 }}>Save</button>
                <button onClick={() => setEditingClass(false)} style={{ background: "none", border: "none", color: "#8899bb", cursor: "pointer", fontSize: 13 }}>✕</button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <span style={{ fontSize: 12, color: "#8899bb" }}>{student.className}</span>
                <button onClick={() => { setClassInput(student.className); setEditingClass(true); }} style={{ background: "none", border: "none", color: "#445577", cursor: "pointer", fontSize: 11, padding: 0 }} title="Edit class">✎</button>
              </div>
            )}
          </div>
          <button onClick={() => setShowManage(true)} style={{ background: "#1C4587", border: "1px solid #2a4a8a", borderRadius: 8, color: "#e0e8ff", cursor: "pointer", padding: "8px 16px", fontSize: 13, fontWeight: 600 }}>
            ✏️ Manage Holdings
          </button>
          {teacherMode && (
            <button onClick={() => onResetStudent(student.id)}
              title="Reset student to $10,000 with no holdings"
              style={{ background: "#2a0a0a", border: "1px solid #ef444455", borderRadius: 8, color: "#ef4444", cursor: "pointer", padding: "8px 14px", fontSize: 12, fontWeight: 600 }}>
              🔄 Reset
            </button>
          )}
          <button onClick={() => onDelete(student.id)} style={{ background: "none", border: "1px solid #3a1a1a", borderRadius: 8, color: "#ef4444", cursor: "pointer", padding: "8px 14px", fontSize: 12 }}>Remove</button>
        </div>

        <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6677aa", marginBottom: 6 }}>
            <span>BUDGET — {fmt$(totalInvested)} invested · {fmt$(cashLeft)} cash</span>
            <span style={{ color: totalPnL >= 0 ? "#22c55e" : "#ef4444" }}>{totalPnL >= 0 ? "+" : ""}{fmt$(totalPnL)} total P&L</span>
          </div>
          <div style={{ height: 5, background: "#0d1f3c", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min((totalInvested / BUDGET) * 100, 100)}%`, background: "#1C4587", borderRadius: 4, transition: "width 0.4s ease" }}/>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Portfolio Value", value: fmt$(portfolioValue), sub: `${fmt$(cashLeft)} cash` },
            { label: "Total P&L", value: fmtPct(totalPct), sub: (totalPnL >= 0 ? "+" : "") + fmt$(totalPnL), color: totalPnL >= 0 ? "#22c55e" : "#ef4444" },
            { label: isMarketOpen() ? "Today's Change" : "Since Purchase", value: fmtPct(todayPct), sub: (todayPnL >= 0 ? "+" : "") + fmt$(todayPnL), color: todayPnL >= 0 ? "#22c55e" : "#ef4444" }
          ].map(c => (
            <div key={c.label} style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, color: "#6677aa", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: c.color || "#FFD966" }}>{c.value}</div>
              <div style={{ fontSize: 11, color: "#6677aa", marginTop: 2 }}>{c.sub}</div>
            </div>
          ))}
        </div>

        {student.holdings.length === 0 ? (
          <div style={{ background: "#0f2347", border: "1px dashed #2a3f6b", borderRadius: 12, padding: "48px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
            <div style={{ color: "#445577", fontSize: 14, marginBottom: 18 }}>No stock purchases yet.</div>
            <button onClick={() => setShowManage(true)} style={{ background: "#FFD966", border: "none", borderRadius: 8, color: "#0d1f3c", cursor: "pointer", padding: "10px 22px", fontSize: 13, fontWeight: 700 }}>
              + Add Stock Purchases
            </button>
          </div>
        ) : (
          <>
            <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 12, padding: "20px 20px 16px" }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, color: "#FFD966", letterSpacing: 2, marginBottom: 16 }}>Performance by Stock</div>
              <BarChart holdings={student.holdings} prices={prices}/>
            </div>
            <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 12, padding: "20px", marginTop: 16 }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, color: "#FFD966", letterSpacing: 2, marginBottom: 16 }}>Holdings Detail</div>
              <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 70px 90px 80px 80px 80px", gap: 8, marginBottom: 8, padding: "0 4px" }}>
                {["Ticker","Company","Shares","Date","Buy Price","Now","P&L"].map(h => (
                  <div key={h} style={{ fontSize: 10, color: "#445577", textTransform: "uppercase", letterSpacing: 1 }}>{h}</div>
                ))}
              </div>
              {student.holdings.map(h => {
                const p = prices[h.ticker];
                const cur = p?.currentPrice;
                const derivedShares = h.purchasePrice && h.spent ? h.spent / h.purchasePrice : h.shares;
                const pnl = cur != null && derivedShares != null ? (cur - h.purchasePrice) * derivedShares : null;
                return (
                  <div key={h.id} style={{ display: "grid", gridTemplateColumns: "70px 1fr 70px 90px 80px 80px 80px", gap: 8, padding: "10px 4px", borderTop: "1px solid #1a2d52", alignItems: "center" }}>
                    <div style={{ fontFamily: "monospace", fontWeight: 700, color: "#FFD966", fontSize: 13 }}>{h.ticker}</div>
                    <div style={{ fontSize: 12, color: "#aabbd0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p?.companyName || h._companyName || "—"}</div>
                    <div style={{ fontSize: 12, color: "#c0cfea" }}>{derivedShares != null ? derivedShares.toFixed(3) : "—"}</div>
                    <div style={{ fontSize: 11, color: "#6677aa" }}>{h.date || "—"}</div>
                    <div style={{ fontSize: 12, color: "#c0cfea" }}>{fmt$(h.purchasePrice)}</div>
                    <div style={{ fontSize: 12, color: "#c0cfea" }}>{fmt$(cur)}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: pnl == null ? "#6677aa" : pnl >= 0 ? "#22c55e" : "#ef4444" }}>{pnl == null ? "—" : (pnl >= 0 ? "+" : "") + fmt$(pnl)}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      {/* Lower panels layout */}

      {/* Row 1: Portfolio History (left) + Portfolio Diversity (right) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16, alignItems: "stretch" }}>
        {/* History — stretches to match Diversity height */}
        <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 12, padding: "20px", display: "flex", flexDirection: "column" }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, color: "#FFD966", letterSpacing: 2, marginBottom: 14, flexShrink: 0 }}>Portfolio History</div>
          {(student.history?.length >= 1) ? (
            <div style={{ flex: 1, overflowY: "auto", minHeight: 120 }}>
              <PortfolioHistoryChart history={student.history}/>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#445577", fontSize: 13, textAlign: "center", minHeight: 80 }}>
              History builds up as prices are refreshed each session.
            </div>
          )}
        </div>
        {/* Diversity — natural height, drives the row height */}
        {student.holdings.length > 0 ? (
          <DiversityPanel holdings={student.holdings}/>
        ) : (
          <div style={{ background: "#0f2347", border: "1px dashed #1e3560", borderRadius: 12, padding: "20px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", color: "#445577", fontSize: 13 }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, color: "#FFD966", letterSpacing: 2, marginBottom: 8 }}>Portfolio Diversity</div>
            Add holdings to see diversity score.
          </div>
        )}
      </div>

      {/*     {/* Row 2: What-If Simulator (left) + Teacher Notes (right) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16, alignItems: "stretch" }}>
        {/* WhatIf — natural height, drives the row */}
        <WhatIfSimulator student={student} prices={prices} fetchPrice={fetchPrice}/>
        {/* Notes — stretches to match WhatIf height */}
        <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 12, padding: "20px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexShrink: 0 }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, color: "#FFD966", letterSpacing: 2 }}>Teacher Notes</div>
            <button onClick={handleSaveNotes}
              style={{ background: notesSaved ? "#14532d" : "#1a2d52", border: `1px solid ${notesSaved ? "#22c55e" : "#2a3f6b"}`, borderRadius: 6, color: notesSaved ? "#22c55e" : "#8899bb", cursor: "pointer", padding: "4px 14px", fontSize: 11, fontWeight: 600, transition: "all 0.2s" }}>
              {notesSaved ? "✓ Saved" : "Save Notes"}
            </button>
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Add grading notes, observations, or feedback for this student…"
            style={{ flex: 1, width: "100%", background: "#0d1f3c", border: "1px solid #2a3f6b", borderRadius: 6, color: "#e0e8ff", padding: "10px 12px", fontSize: 13, outline: "none", resize: "none", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.6 }}
          />
        </div>
      </div>

      {/* Row 3: Set/Change PIN — centered */}
      <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 560 }}>
          <SetPinPanel student={student} onUpdatePin={onUpdatePin}/>
        </div>
      </div>



      {showManage && (
        <ManageHoldingsModal student={student} prices={prices} teacherMode={teacherMode} onSave={(h, cash) => onUpdateHoldings(student.id, h, cash)} onClose={() => setShowManage(false)} onError={onError} fetchPrice={fetchPrice}/>
      )}
    </div>
  );
}



// ── PIN Entry Modal ───────────────────────────────────────────────────────────
function PinModal({ studentName, onSuccess, onCancel, pinError: externalError }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const inputRef = useRef();

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);

  const handleSubmit = async () => {
    if (!pin) return;
    setChecking(true);
    setError("");
    const h = await hashPin(pin);
    setChecking(false);
    onSuccess(h); // App validates against teacher hash and student hash
  };

  const digits = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }}>
      <div style={{ background: "#0f2347", border: "1px solid #2a3f6b", borderRadius: 16, padding: "32px 28px", width: "100%", maxWidth: 320, boxShadow: "0 20px 60px rgba(0,0,0,0.7)", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 3, color: "#e0e8ff", marginBottom: 4 }}>{studentName}</div>
        <div style={{ fontSize: 12, color: "#5566aa", marginBottom: 24 }}>Enter your PIN to continue</div>

        {/* PIN display */}
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 20 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ width: 16, height: 16, borderRadius: "50%", background: pin.length > i ? "#FFD966" : "#1a2d52", border: "2px solid " + (pin.length > i ? "#FFD966" : "#2a3f6b"), transition: "all 0.15s" }}/>
          ))}
        </div>

        {(error || externalError) && <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 12, background: "#3a0f0f", border: "1px solid #ef444433", borderRadius: 6, padding: "6px 12px" }}>{error || externalError}</div>}

        {/* Numpad */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 20 }}>
          {digits.map((d, i) => (
            <button key={i} onClick={() => {
              if (d === "") return;
              if (d === "⌫") { setPin(p => p.slice(0,-1)); setError(""); return; }
              if (pin.length >= 5) return;
              const next = pin + d;
              setPin(next);
            }}
              style={{ background: d === "" ? "transparent" : "#0d1f3c", border: d === "" ? "none" : "1px solid #2a3f6b", borderRadius: 10, color: d === "⌫" ? "#8899bb" : "#e0e8ff", cursor: d === "" ? "default" : "pointer", padding: "14px 0", fontSize: d === "⌫" ? 18 : 20, fontWeight: 600, transition: "background 0.1s" }}
              onMouseEnter={e => { if (d) e.currentTarget.style.background = d === "" ? "transparent" : "#1a2d52"; }}
              onMouseLeave={e => { if (d) e.currentTarget.style.background = d === "" ? "transparent" : "#0d1f3c"; }}
            >{d}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{ flex: 1, background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: "#8899bb", cursor: "pointer", padding: "11px 0", fontSize: 13 }}>Cancel</button>
          <button onClick={handleSubmit} disabled={pin.length < 4 || checking}
            style={{ flex: 2, background: pin.length >= 4 ? "#FFD966" : "#2a3a5a", border: "none", borderRadius: 8, color: pin.length >= 4 ? "#0d1f3c" : "#5566aa", cursor: pin.length >= 4 ? "pointer" : "default", padding: "11px 0", fontSize: 13, fontWeight: 700 }}>
            {checking ? "Checking…" : "Unlock"}
          </button>
        </div>

        <div style={{ marginTop: 14, fontSize: 11, color: "#334466" }}>Students: 4-digit PIN · Teachers: 5-digit PIN</div>
      </div>
    </div>
  );
}

// ── Confirm Delete Modal ──────────────────────────────────────────────────────
function ConfirmModal({ name, onConfirm, onCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }}>
      <div style={{ background: "#0f2347", border: "1px solid #3a1a1a", borderRadius: 12, padding: 28, width: "100%", maxWidth: 380, boxShadow: "0 20px 60px rgba(0,0,0,0.6)", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🗑️</div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 2, color: "#e0e8ff", marginBottom: 8 }}>REMOVE STUDENT?</div>
        <div style={{ fontSize: 14, color: "#8899bb", marginBottom: 24 }}>
          This will permanently remove <span style={{ color: "#FFD966", fontWeight: 700 }}>{name}</span> and all their holdings. This cannot be undone.
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={onCancel} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: "#8899bb", cursor: "pointer", padding: "10px 24px", fontSize: 13 }}>Cancel</button>
          <button onClick={onConfirm} style={{ background: "#ef4444", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", padding: "10px 24px", fontSize: 13, fontWeight: 700 }}>Remove</button>
        </div>
      </div>
    </div>
  );
}

// ── CSV Export helper ─────────────────────────────────────────────────────────
function exportCSV(students, prices) {
  const rows = [["Class", "Student", "Ticker", "Company", "Purchase Date", "$ Invested", "Purchase Price", "Shares", "Current Price", "Current Value", "P&L ($)", "P&L (%)", "Teacher Notes"]];
  students.forEach(s => {
    if (!s.holdings.length) {
      rows.push([s.className, s.name, "", "", "", "", "", "", "", "", "", "", s.notes || ""]);
      return;
    }
    s.holdings.forEach(h => {
      const p = prices[h.ticker];
      const cur = p?.currentPrice ?? "";
      const curVal = cur !== "" && h.shares != null ? (cur * h.shares).toFixed(2) : "";
      const pnlD = cur !== "" && h.purchasePrice != null && h.shares != null ? ((cur - h.purchasePrice) * h.shares).toFixed(2) : "";
      const pnlP = cur !== "" && h.purchasePrice != null ? (((cur - h.purchasePrice) / h.purchasePrice) * 100).toFixed(2) : "";
      rows.push([
        s.className, s.name, h.ticker,
        p?.companyName || h._companyName || "",
        h.date || "",
        h.spent.toFixed(2),
        h.purchasePrice != null ? h.purchasePrice.toFixed(4) : "",
        h.shares != null ? h.shares.toFixed(4) : "",
        cur !== "" ? Number(cur).toFixed(2) : "",
        curVal, pnlD, pnlP
      ]);
    });
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `stock-roster-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ── Leaderboard View ──────────────────────────────────────────────────────────
function Leaderboard({ students, prices, onSelectStudent }) {
  const ranked = students.map(s => {
    const totalInvested = s.holdings.reduce((sum, h) => sum + h.spent, 0);
    const cashLeft = s.cashBalance != null ? s.cashBalance : BUDGET - totalInvested;
    const stockValue = s.holdings.reduce((sum, h) => {
      const p = prices[h.ticker]?.currentPrice;
      if (p == null || !h.purchasePrice || !h.spent) return sum + h.spent;
      return sum + p * (h.spent / h.purchasePrice);
    }, 0);
    const portfolioValue = stockValue + cashLeft;
    const pnl = portfolioValue - BUDGET;
    const pct = (pnl / BUDGET) * 100;
    const todayStrLB = new Date().toISOString().slice(0, 10);
    const cashLB = s.cashBalance != null ? s.cashBalance : BUDGET - s.holdings.reduce((a,h) => a+h.spent, 0);
    const stockValLB = s.holdings.reduce((sum, h) => {
      const p = prices[h.ticker]?.currentPrice;
      if (!p || !h.purchasePrice || !h.spent) return sum + h.spent;
      return sum + p * (h.spent / h.purchasePrice);
    }, 0);
    const portValLB = stockValLB + cashLB;
    const prevDayLB = getPrevDayValue(s.history, todayStrLB);
    const todayPnL = prevDayLB != null
      ? portValLB - prevDayLB
      : s.holdings.reduce((sum, h) => {
          const p = prices[h.ticker];
          if (!p?.currentPrice || !h.purchasePrice || !h.spent) return sum;
          const derivedShares = h.spent / h.purchasePrice;
          const baseline = isMarketOpen() && h.date !== todayStrLB ? p.previousClose : h.purchasePrice;
          if (baseline == null) return sum;
          return sum + (p.currentPrice - baseline) * derivedShares;
        }, 0);
    const hasData = s.holdings.some(h => prices[h.ticker]?.currentPrice);
    const totalCurrent = portfolioValue;
    return { ...s, totalInvested, totalCurrent, pnl, pct, todayPnL, hasData };
  }).sort((a, b) => b.pct - a.pct);

  const medals = ["🥇", "🥈", "🥉"];
  const maxAbsPct = Math.max(...ranked.filter(s => s.pct != null).map(s => Math.abs(s.pct)), 1);

  return (
    <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 12, overflow: "hidden" }}>
      {/* Podium top 3 */}
      {ranked.filter(s => s.pct != null).length >= 2 && (
        <div style={{ padding: "24px 24px 0", borderBottom: "1px solid #1a2d52", marginBottom: 0 }}>
          <div style={{ fontSize: 11, color: "#6677aa", letterSpacing: 1.5, marginBottom: 16 }}>TOP PERFORMERS</div>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", justifyContent: "center", paddingBottom: 0 }}>
            {[1, 0, 2].map(idx => {
              const s = ranked[idx];
              if (!s || s.pct == null) return <div key={idx} style={{ flex: 1 }}/>;
              const rankHeights = [130, 100, 80]; // 1st=tallest, 2nd=medium, 3rd=shortest
              const h = rankHeights[idx];
              return (
                <div key={s.id} onClick={() => onSelectStudent(s.id)}
                  style={{ flex: 1, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{ fontSize: idx === 0 ? 28 : 20 }}>{medals[idx]}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#e0e8ff", textAlign: "center", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: "#6677aa" }}>{s.className}</div>
                  <div style={{ fontSize: idx === 0 ? 20 : 16, fontWeight: 700, color: s.pct >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(s.pct)}</div>
                  <div style={{ width: "100%", height: h, background: s.pct >= 0 ? "#14532d" : "#3a0f0f", borderRadius: "6px 6px 0 0", display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${s.pct >= 0 ? "#22c55e44" : "#ef444444"}`, borderBottom: "none" }}>
                    <div style={{ fontSize: 11, color: s.pct >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{idx === 0 ? "1st" : idx === 1 ? "2nd" : "3rd"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Full ranked list */}
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 90px 100px 100px 90px", gap: 8, padding: "10px 20px", borderBottom: "1px solid #1a2d52" }}>
          {["#", "Student", "Class", "Portfolio", "Total P&L", "Today"].map(h => (
            <div key={h} style={{ fontSize: 10, color: "#445577", textTransform: "uppercase", letterSpacing: 1 }}>{h}</div>
          ))}
        </div>
        {ranked.map((s, i) => {
          const isPos = (s.pct ?? 0) >= 0;
          const todayPos = s.todayPnL >= 0;
          const barW = s.pct != null ? (Math.abs(s.pct) / maxAbsPct) * 100 : 0;
          return (
            <div key={s.id} onClick={() => onSelectStudent(s.id)}
              style={{ display: "grid", gridTemplateColumns: "36px 1fr 90px 100px 100px 90px", gap: 8, padding: "12px 20px", borderBottom: "1px solid #0d1f3c", cursor: "pointer", transition: "background 0.15s", alignItems: "center" }}
              onMouseEnter={e => e.currentTarget.style.background = "#1a2d52"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: i < 3 ? ["#FFD966","#c0cfea","#cd7f32"][i] : "#445577" }}>
                {i < 3 ? medals[i] : `#${i + 1}`}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#e0e8ff" }}>{s.name}</div>
                <div style={{ position: "relative", height: 4, background: "#0d1f3c", borderRadius: 2, marginTop: 4, width: "80%" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${barW}%`, background: isPos ? "#22c55e" : "#ef4444", borderRadius: 2, transition: "width 0.5s ease" }}/>
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#6677aa" }}>{s.className}</div>
              <div style={{ fontSize: 12, color: "#FFD966", fontWeight: 600 }}>{s.hasData ? fmt$(s.totalCurrent) : "—"}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: s.pct == null ? "#445577" : isPos ? "#22c55e" : "#ef4444" }}>
                {s.pct == null ? "—" : fmtPct(s.pct)}
              </div>
              <div style={{ fontSize: 12, color: s.todayPnL === 0 ? "#445577" : todayPos ? "#22c55e" : "#ef4444" }}>
                {s.hasData ? (todayPos ? "+" : "") + fmt$(s.todayPnL) : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── Class Summary Bar ─────────────────────────────────────────────────────────
function ClassSummaryBar({ students, prices }) {
  const withHoldings = students.filter(s => s.holdings.length > 0);
  if (!withHoldings.length) return null;

  // Per-student portfolio values using consistent BUDGET basis
  const studentPortfolios = withHoldings.map(s => {
    const inv = s.holdings.reduce((a, h) => a + h.spent, 0);
    const cash = s.cashBalance != null ? s.cashBalance : BUDGET - inv;
    const stockVal = s.holdings.reduce((a, h) => {
      const p = prices[h.ticker]?.currentPrice;
      if (p == null || !h.purchasePrice || !h.spent) return a + h.spent;
      return a + p * (h.spent / h.purchasePrice);
    }, 0);
    const portfolioVal = stockVal + cash;
    const pct = (portfolioVal - BUDGET) / BUDGET * 100;
    return { portfolioVal, pct };
  });

  // Total class value = sum of all portfolio values
  const totalClassValue = studentPortfolios.reduce((s, p) => s + p.portfolioVal, 0);

  // Class portfolio return = (total value - total starting budget) / total starting budget
  const totalStartingBudget = withHoldings.length * BUDGET;
  const classPortfolioPct = (totalClassValue - totalStartingBudget) / totalStartingBudget * 100;

  // Avg student return = simple average of each student's individual P&L%
  const avgStudentPct = studentPortfolios.reduce((s, p) => s + p.pct, 0) / studentPortfolios.length;

  const stats = [
    { label: "Students Invested", value: `${withHoldings.length} / ${students.length}`, color: "#FFD966" },
    { label: "Total Class Value", value: fmt$(totalClassValue), color: "#e0e8ff" },
    { label: "Avg Student Return", value: fmtPct(avgStudentPct), sub: "simple avg across all students", color: avgStudentPct >= 0 ? "#22c55e" : "#ef4444" },
    { label: "Class Portfolio Return", value: fmtPct(classPortfolioPct), sub: "all budgets pooled together", color: classPortfolioPct >= 0 ? "#22c55e" : "#ef4444" },
  ];

  return (
    <div style={{ background: "#0a1a38", border: "1px solid #1e3560", borderRadius: 10, padding: "12px 20px", marginBottom: 24, display: "flex", gap: 0, flexWrap: "wrap" }}>
      {stats.map((s, i) => (
        <div key={i} style={{ flex: "1 1 140px", padding: "6px 16px", borderLeft: i > 0 ? "1px solid #1e3560" : "none" }}>
          <div style={{ fontSize: 10, color: "#445577", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>{s.label}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: s.color, whiteSpace: "nowrap" }}>{s.value}</div>
          {s.sub && <div style={{ fontSize: 10, color: "#445577", marginTop: 1 }}>{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}


// ── Market Status Banner ──────────────────────────────────────────────────────
function MarketStatusBanner() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const getStatus = () => {
      const now = new Date();
      const day = now.getDay(); // 0=Sun, 6=Sat
      if (day === 0 || day === 6) { setStatus("closed"); return; }

      // Convert to ET (UTC-4 EDT / UTC-5 EST)
      // Use Intl to get ET time accurately
      const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
      const et = new Date(etStr);
      const h = et.getHours();
      const m = et.getMinutes();
      const mins = h * 60 + m;

      if (mins >= 240 && mins < 570) setStatus("premarket");       // 4:00am - 9:30am
      else if (mins >= 570 && mins < 960) setStatus("open");        // 9:30am - 4:00pm
      else if (mins >= 960 && mins < 1200) setStatus("afterhours"); // 4:00pm - 8:00pm
      else setStatus("closed");
    };

    getStatus();
    const interval = setInterval(getStatus, 60000); // update every minute
    return () => clearInterval(interval);
  }, []);

  if (!status) return null;

  const config = {
    premarket:   { label: "PRE-MARKET",   color: "#FFD966", bg: "#2a2200", border: "#FFD96655", dot: "#FFD966" },
    open:        { label: "MARKET OPEN",  color: "#22c55e", bg: "#0d2a1a", border: "#22c55e55", dot: "#22c55e" },
    afterhours:  { label: "AFTER HOURS",  color: "#a78bfa", bg: "#1a0f2e", border: "#a78bfa55", dot: "#a78bfa" },
    closed:      { label: "MARKET CLOSED", color: "#ef4444", bg: "#2a0a0a", border: "#ef444455", dot: "#ef4444" },
  }[status];

  if (!config) return null;

  return (
    <div style={{ background: config.bg, borderBottom: `1px solid ${config.border}`, padding: "6px 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: config.dot, display: "inline-block", boxShadow: `0 0 6px ${config.dot}` }}/>
      <span style={{ fontSize: 11, fontWeight: 700, color: config.color, letterSpacing: 2 }}>{config.label}</span>
    </div>
  );
}

// ── Daily Highlights Banner ───────────────────────────────────────────────────
function DailyHighlights({ students, prices }) {
  // student-level today P&L
  const studentStats = students
    .map(s => {
      const todayStrDH = new Date().toISOString().slice(0, 10);
      const cashDH = s.cashBalance != null ? s.cashBalance : BUDGET - s.holdings.reduce((a,h) => a+h.spent, 0);
      const stockValDH = s.holdings.reduce((sum, h) => {
        const p = prices[h.ticker]?.currentPrice;
        if (!p || !h.purchasePrice || !h.spent) return sum + h.spent;
        return sum + p * (h.spent / h.purchasePrice);
      }, 0);
      const portValDH = stockValDH + cashDH;
      const prevDayDH = getPrevDayValue(s.history, todayStrDH);
      const todayPnL = prevDayDH != null
        ? portValDH - prevDayDH
        : s.holdings.reduce((sum, h) => {
            const p = prices[h.ticker];
            if (!p?.currentPrice || !h.purchasePrice || !h.spent) return sum;
            const derivedShares = h.spent / h.purchasePrice;
            const baseline = isMarketOpen() && h.date !== todayStrDH ? p.previousClose : h.purchasePrice;
            if (baseline == null) return sum;
            return sum + (p.currentPrice - baseline) * derivedShares;
          }, 0);
      const hasData = s.holdings.some(h => prices[h.ticker]?.currentPrice);
      return { id: s.id, name: s.name, todayPnL, hasData };
    })
    .filter(s => s.hasData);

  // ticker stats based on average student P&L % for that ticker (not raw market move)
  const tickerMap = {};
  const todayStrTickers = new Date().toISOString().slice(0, 10);
  students.forEach(s => s.holdings.forEach(h => {
    const p = prices[h.ticker];
    if (!p?.currentPrice || !h.purchasePrice || !h.spent) return;
    const marketOpenTickers = isMarketOpen();
    const baseline = marketOpenTickers ? (h.date !== todayStrTickers ? p.previousClose : h.purchasePrice) : h.purchasePrice;
    if (baseline == null) return;
    const pct = ((p.currentPrice - baseline) / baseline) * 100;
    if (!tickerMap[h.ticker]) {
      tickerMap[h.ticker] = { ticker: h.ticker, companyName: p.companyName || h.ticker, pctSum: 0, count: 0 };
    }
    tickerMap[h.ticker].pctSum += pct;
    tickerMap[h.ticker].count += 1;
  }));
  const tickerStats = Object.values(tickerMap)
    .filter(t => t.count > 0)
    .map(t => ({
      ticker: t.ticker,
      companyName: t.companyName,
      pct: t.pctSum / t.count,
    }));

  if (!studentStats.length && !tickerStats.length) return null;

  const topStudent = studentStats.length ? studentStats.reduce((a, b) => a.todayPnL > b.todayPnL ? a : b) : null;
  const botStudent = studentStats.length ? studentStats.reduce((a, b) => a.todayPnL < b.todayPnL ? a : b) : null;
  const topTicker = tickerStats.length ? tickerStats.reduce((a, b) => a.pct > b.pct ? a : b) : null;
  const botTicker = tickerStats.length ? tickerStats.reduce((a, b) => a.pct < b.pct ? a : b) : null;

  const tiles = [
    topStudent && {
      icon: "🏆", label: "TODAY'S TOP GAINER", name: topStudent.name,
      value: topStudent.todayPnL >= 0 ? `+${fmt$(topStudent.todayPnL)}` : fmt$(topStudent.todayPnL),
      color: "#22c55e", border: "#14532d"
    },
    botStudent && topStudent?.id !== botStudent?.id && {
      icon: "📉", label: "TODAY'S BIGGEST LOSS", name: botStudent.name,
      value: botStudent.todayPnL >= 0 ? `+${fmt$(botStudent.todayPnL)}` : fmt$(botStudent.todayPnL),
      color: "#ef4444", border: "#3a0f0f"
    },
    tickerStats.length > 0 && topTicker && {
      icon: "🚀", label: "HOTTEST STOCK TODAY", name: topTicker.ticker,
      sub: topTicker.companyName !== topTicker.ticker ? topTicker.companyName : null,
      value: fmtPct(topTicker.pct), color: "#22c55e", border: "#14532d"
    },
    tickerStats.length > 1 && botTicker && topTicker?.ticker !== botTicker?.ticker && {
      icon: "🧊", label: "COLDEST STOCK TODAY", name: botTicker.ticker,
      sub: botTicker.companyName !== botTicker.ticker ? botTicker.companyName : null,
      value: fmtPct(botTicker.pct), color: "#ef4444", border: "#3a0f0f"
    },
  ].filter(Boolean);

  if (!tiles.length) return null;

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: 3, color: "#8899bb" }}>TODAY'S HIGHLIGHTS</div>
        <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, #2a3f6b, transparent)" }}/>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${tiles.length}, 1fr)`, gap: 12 }}>
        {tiles.map((t, i) => (
          <div key={i} style={{ background: "#0f2347", border: `1px solid ${t.border}`, borderRadius: 12, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: t.color, opacity: 0.6 }}/>
            <div style={{ fontSize: 10, color: "#5566aa", letterSpacing: 1.5, marginBottom: 8 }}>{t.label}</div>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 20, marginBottom: 2 }}>{t.icon}</div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 1, color: "#e0e8ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</div>
                {t.sub && <div style={{ fontSize: 11, color: "#5566aa", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.sub}</div>}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: t.color, whiteSpace: "nowrap", flexShrink: 0 }}>{t.value}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StudentCard({ student, prices, onClick, onManage, isUnlocked }) {
  const totalInvested = student.holdings.reduce((s, h) => s + h.spent, 0);
  const cashLeft = student.cashBalance != null ? student.cashBalance : BUDGET - totalInvested;
  const stockValue = student.holdings.reduce((s, h) => {
    const p = prices[h.ticker]?.currentPrice;
    if (p == null || !h.purchasePrice || !h.spent) return s + h.spent;
    return s + p * (h.spent / h.purchasePrice);
  }, 0);
  const portfolioValue = stockValue + cashLeft; // total portfolio including cash
  const pnl = portfolioValue - BUDGET;          // gain/loss vs starting budget
  const pct = (pnl / BUDGET) * 100;
  const todayStrCard = new Date().toISOString().slice(0, 10);
  const prevDayValueCard = getPrevDayValue(student.history, todayStrCard);
  const todayPnL = prevDayValueCard != null
    ? portfolioValue - prevDayValueCard
    : student.holdings.reduce((s, h) => {
        const p = prices[h.ticker];
        if (!p?.currentPrice || !h.purchasePrice || !h.spent) return s;
        const derivedShares = h.spent / h.purchasePrice;
        const baseline = isMarketOpen() && h.date !== todayStrCard ? p.previousClose : h.purchasePrice;
        if (baseline == null) return s;
        return s + (p.currentPrice - baseline) * derivedShares;
      }, 0);
  const todayPct = (todayPnL / BUDGET) * 100;
  const hasHoldings = student.holdings.length > 0;
  const isPos = pct >= 0;
  const todayPos = todayPnL >= 0;
  const spark = hasHoldings ? [BUDGET, BUDGET * (1 + (pct * 0.3 / 100)), BUDGET + todayPnL * 0.5, portfolioValue] : [];

  return (
    <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 12, overflow: "hidden", transition: "all 0.2s", position: "relative" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "#FFD966"; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e3560"; e.currentTarget.style.transform = "translateY(0)"; }}>
      <div style={{ position: "absolute", top: 0, right: 0, width: 3, height: "100%", background: !hasHoldings ? "#2a3f6b" : isPos ? "#22c55e" : "#ef4444" }}/>

      <div onClick={onClick} style={{ padding: "16px 18px 12px", cursor: "pointer" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#e0e8ff" }}>{student.name}</div>
              {student.notes && <span title="Has teacher notes" style={{ width: 7, height: 7, borderRadius: "50%", background: "#FFD966", flexShrink: 0, display: "inline-block" }}/>}
              {!student.pinHash && <span title="No PIN set — teacher PIN required" style={{ fontSize: 9, color: "#ef4444", background: "#3a0f0f", border: "1px solid #ef444444", borderRadius: 3, padding: "1px 4px", letterSpacing: 0.5 }}>NO PIN</span>}
              {isUnlocked && <span title="Unlocked this session" style={{ fontSize: 9, color: "#22c55e", background: "#0d2a1a", border: "1px solid #22c55e44", borderRadius: 3, padding: "1px 4px", letterSpacing: 0.5 }}>🔓</span>}
            </div>
            <div style={{ fontSize: 11, color: "#5566aa", marginTop: 1 }}>
              {hasHoldings ? (
                <>
                  {student.holdings.length} stock{student.holdings.length !== 1 ? "s" : ""}
                  {student.holdings.length > 1 && (() => {
                    const { score, color, label } = calcDiversityScore(student.holdings);
                    return (
                      <span style={{ marginLeft: 6, background: color + "22", border: `1px solid ${color}44`, borderRadius: 4, padding: "1px 5px", fontSize: 9, fontWeight: 700, color, letterSpacing: 0.5 }}>
                        {label[0].toUpperCase()}{score}
                      </span>
                    );
                  })()}
                </>
              ) : "No holdings yet"}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            {hasHoldings ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: isPos ? "#22c55e" : "#ef4444" }}>{fmtPct(pct)}</div>
                <div style={{ fontSize: 11, color: "#5566aa" }}>{isPos ? "+" : ""}{fmt$(pnl)}</div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: "#f59e0b", fontStyle: "italic" }}>{fmt$(cashLeft)} unallocated</div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            {hasHoldings ? (
              <>
                <div style={{ fontSize: 12, color: "#8899bb" }}>Value: <span style={{ color: "#FFD966", fontWeight: 600 }}>{fmt$(portfolioValue)}</span></div>
                <div style={{ fontSize: 11, color: todayPos ? "#22c55e" : "#ef4444", marginTop: 2 }}>Today: {fmtPct(todayPct)}</div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: "#445577", fontStyle: "italic" }}>Budget: {fmt$(BUDGET)}</div>
            )}
          </div>
          <Sparkline data={spark} color={hasHoldings ? (isPos ? "#22c55e" : "#ef4444") : "#2a3f6b"} width={90} height={32}/>
        </div>
      </div>

      {/* Alert badges for big movers */}
      {hasHoldings && (() => {
        const alerts = student.holdings.map(h => {
          const p = prices[h.ticker];
          if (!p?.currentPrice || !p?.previousClose) return null;
          const pct = ((p.currentPrice - p.previousClose) / p.previousClose) * 100;
          if (Math.abs(pct) < ALERT_THRESHOLD) return null;
          return { ticker: h.ticker, pct };
        }).filter(Boolean);
        if (!alerts.length) return null;
        return (
          <div style={{ padding: "0 18px 8px", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {alerts.map(a => (
              <span key={a.ticker} style={{
                background: a.pct >= 0 ? "#14532d" : "#3a0f0f",
                border: `1px solid ${a.pct >= 0 ? "#22c55e55" : "#ef444455"}`,
                borderRadius: 4, padding: "2px 7px", fontSize: 10, fontWeight: 700,
                color: a.pct >= 0 ? "#22c55e" : "#ef4444", letterSpacing: 0.5
              }}>
                {a.pct >= 0 ? "▲" : "▼"} {a.ticker} {Math.abs(a.pct).toFixed(1)}%
              </span>
            ))}
          </div>
        );
      })()}

      <div style={{ borderTop: "1px solid #1a2d52", padding: "8px 18px", display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={e => { e.stopPropagation(); onManage(); }}
          style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 6, color: "#8899bb", cursor: "pointer", padding: "5px 14px", fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>
          ✏️ {hasHoldings ? "Edit Holdings" : "Add Holdings"}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  // ── App mode ──────────────────────────────────────────────────────────────
  const [appMode, setAppMode] = useState("select"); // "select" | "live" | "arcade-pick" | "arcade"

  // ── Arcade state ───────────────────────────────────────────────────────────
  const [arcadePortfolio, setArcadePortfolio] = useState(null);
  const [arcadePrices, setArcadePrices] = useState({});
  const [arcadeChallengers, setArcadeChallengers] = useState([]);
  const [arcadeEvents, setArcadeEvents] = useState([]);
  const [arcadeTimeLeft, setArcadeTimeLeft] = useState(ARCADE_SESSION_MINUTES * 60);
  const arcadeTickRef = useRef(null);
  const arcadeTimerRef = useRef(null);

  // ── Live state ─────────────────────────────────────────────────────────────
  const [students, setStudents] = useState([]);
  const [prices, setPrices] = useState({});

// Sync students from Firebase on mount
useEffect(() => {
  const studentsRef = ref(db, 'students');
  const unsub = onValue(studentsRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      setStudents(Object.values(data));
    } else {
      setStudents([]);
    }
  });
  return () => unsub();
}, []);
  const [detail, setDetail] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [manageId, setManageId] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [view, setView] = useState("dashboard"); // "dashboard" | "leaderboard"
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [sortBy, setSortBy] = useState("default"); // "default"|"pct_desc"|"pct_asc"|"name"|"today"
  const [pinPrompt, setPinPrompt] = useState(null); // { studentId, mode: "detail"|"manage" }
  const [pinError, setPinErrorState] = useState("");
  const [teacherMode, setTeacherMode] = useState(false);
  const [teacherModePrompt, setTeacherModePrompt] = useState(false);
  const [unlockedStudents, setUnlockedStudents] = useState(new Set()); // studentIds unlocked this session
  const fileRef = useRef();

  // Validate PIN for teacher mode activation
  const handleTeacherModePin = async (hash) => {
    if (hash === TEACHER_PIN_HASH) {
      setTeacherMode(true);
      setTeacherModePrompt(false);
      setPinErrorState("");
    } else {
      setPinErrorState("Incorrect PIN. Try again.");
    }
  };

  // Validate a submitted PIN hash against a student
  const handlePinSubmit = async (hash) => {
    const { studentId, mode } = pinPrompt;
    const student = students.find(s => s.id === studentId);
    const isTeacher = hash === TEACHER_PIN_HASH;
    const isStudent = student?.pinHash && hash === student.pinHash;
    if (isTeacher || isStudent) {
      setPinPrompt(null);
      setPinErrorState("");
      // Unlock this student for the rest of the session
      setUnlockedStudents(prev => new Set([...prev, studentId]));
      if (mode === "detail") setDetail(studentId);
      else setManageId(studentId);
    } else {
      setPinErrorState("Incorrect PIN. Try again.");
    }
  };

  const requestAccess = (studentId, mode) => {
    if (teacherMode || unlockedStudents.has(studentId)) {
      // Skip PIN — teacher mode active or student already unlocked this session
      if (mode === "detail") setDetail(studentId);
      else setManageId(studentId);
      return;
    }
    setPinErrorState("");
    setPinPrompt({ studentId, mode });
  };

  const allTickers = [...new Set(students.flatMap(s => (s.holdings || []).map(h => h.ticker)))];
  const fetchPrice = useCallback(async (ticker) => {
    const result = await fetchStockPrice(ticker);
    if (!result.error) setPrices(prev => ({ ...prev, [ticker]: result }));
    return result;
  }, []);

  const refreshPrices = useCallback(async (tickers) => {
    if (!tickers.length) return;
    setRefreshing(true);
    const results = await Promise.all(tickers.map(t => fetchStockPrice(t)));
    setPrices(prev => {
      const next = { ...prev };
      results.forEach(r => { if (!r.error) next[r.ticker] = r; });
      return next;
    });
    // snapshot portfolio history for each student and write to Firebase
    const today = new Date().toISOString().slice(0, 10);
    students.forEach(s => {
      const totalInvested = s.holdings.reduce((a, h) => a + h.spent, 0);
      if (!totalInvested) return;
      const cash = s.cashBalance != null ? s.cashBalance : BUDGET - totalInvested;
      const stockVal = s.holdings.reduce((a, h) => {
        const p = results.find(r => r.ticker === h.ticker);
        const price = p?.currentPrice;
        if (!price || !h.purchasePrice || !h.spent) return a + h.spent;
        return a + price * (h.spent / h.purchasePrice);
      }, 0);
      const portfolioValue = stockVal + cash;
      const history = s.history || [];
      const lastEntry = history[history.length - 1];
      const newHistory = lastEntry?.date === today
        ? [...history.slice(0, -1), { date: today, value: portfolioValue }]
        : [...history, { date: today, value: portfolioValue }];
      // Only write history to Firebase — never touch holdings during a price refresh
      update(ref(db, `students/${s.id}`), { history: newHistory });
    });
    setLastRefresh(new Date());
    setRefreshing(false);
  }, []);

  useEffect(() => {
  const studentsRef = ref(db, 'students');
  const unsub = onValue(studentsRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      const loaded = Object.values(data).map(s => ({
        ...s,
        holdings: s.holdings || [],
        history: s.history || [],
        notes: s.notes || "",
        cashBalance: s.cashBalance != null ? s.cashBalance : BUDGET - (s.holdings || []).reduce((a, h) => a + (h.spent || 0), 0),
      }));
      setStudents(loaded);
    } else {
      setStudents([]);
    }
  });
  return () => unsub();
}, []);
  const classes = [...new Set(students.map(s => s.className))];

  const handleAddStudent = (student) => {
    set(ref(db, `students/${student.id}`), student);
  };

  // ── Arcade handlers ────────────────────────────────────────────────────────
  const startArcade = (picks, priceMap, selectedChallengers) => {
    const initPrices = {};
    Object.entries(priceMap).forEach(([ticker, data]) => {
      initPrices[ticker] = { price: data.price, prevPrice: data.price, companyName: data.companyName };
    });
    setArcadePrices(initPrices);
    setArcadePortfolio({
      picks: picks.map(p => ({
        ...p,
        purchasePrice: priceMap[p.ticker]?.price || 10,
        shares: p.spent / (priceMap[p.ticker]?.price || 10),
      })),
      cashBalance: ARCADE_BUDGET - picks.reduce((s, p) => s + p.spent, 0),
    });
    setArcadeChallengers(selectedChallengers.map(c => ({
      ...c,
      picks: c.picks.map(p => ({
        ...p,
        purchasePrice: priceMap[p.ticker]?.price || 10,
        shares: p.spent / (priceMap[p.ticker]?.price || 10),
        personality: STOCK_PERSONALITIES[p.ticker] || "stable",
      }))
    })));
    setArcadeTimeLeft(ARCADE_SESSION_MINUTES * 60);
    setArcadeEvents([]);
    setAppMode("arcade");
  };

  const stopArcade = () => {
    clearInterval(arcadeTickRef.current);
    clearInterval(arcadeTimerRef.current);
    setAppMode("select");
    setArcadePortfolio(null);
    setArcadePrices({});
    setArcadeChallengers([]);
    setArcadeEvents([]);
  };

  const handleUpdateNotes = (studentId, notes) => {
    update(ref(db, `students/${studentId}`), { notes });
  };

  const handleUpdatePin = (studentId, pinHash) => {
    update(ref(db, `students/${studentId}`), { pinHash });
  };

  const handleUpdateClass = (studentId, className) => {
    update(ref(db, `students/${studentId}`), { className });
  };

  const handleResetStudent = (studentId) => {
    const student = students.find(s => s.id === studentId);
    if (!student) return;
    if (!window.confirm(`Reset ${student.name} to $10,000 with no holdings? This cannot be undone.`)) return;
    update(ref(db, `students/${studentId}`), { holdings: [], cashBalance: BUDGET });
  };

  const handleFixBalance = (studentId) => {
    const student = students.find(s => s.id === studentId);
    if (!student) return;
    const correctBalance = BUDGET - (student.holdings || []).reduce((s, h) => s + (h.spent || 0), 0);
    update(ref(db, `students/${studentId}`), { cashBalance: correctBalance });
  };

  const handleFixAllBalances = async () => {
    const today = new Date().toISOString().slice(0, 10);

    // Detect corrupted students — total spent > BUDGET or pre-SIM_START_DATE holdings
    const corrupted = [];
    const needsDateFix = [];
    students.forEach(s => {
      const totalSpent = (s.holdings || []).reduce((sum, h) => sum + (h.spent || 0), 0);
      const hasOldDate = (s.holdings || []).some(h => h.date && h.date < SIM_START_DATE);
      // Corrupted if: spent > budget, cashBalance impossible, or purchasePrice is historical (pre-SIM_START_DATE holding date)
      const stockValue = (s.holdings || []).reduce((sum, h) => {
        return sum + (h.purchasePrice ? h.spent : 0);
      }, 0);
      const cashCorrupt = s.cashBalance != null && s.cashBalance > stockValue + BUDGET;
      const hasCorruptPrice = (s.holdings || []).some(h => h.date && h.date < SIM_START_DATE);
      if (totalSpent > BUDGET * 1.1 || cashCorrupt || hasCorruptPrice) corrupted.push(s);
      else if (hasOldDate) needsDateFix.push(s); // this branch now unreachable but kept for safety
      else if (hasOldDate) needsDateFix.push(s);
    });

    // Build confirm message
    let msg = "";
    if (corrupted.length) msg += "⚠️ " + corrupted.length + " student" + (corrupted.length > 1 ? "s" : "") + " with corrupted data (spent > $10,000):\n" + corrupted.map(s => "  • " + s.name).join("\n") + "\nThese will be RESET to $10,000 with no holdings.\n\n";
    if (needsDateFix.length) msg += "📅 " + needsDateFix.length + " student" + (needsDateFix.length > 1 ? "s" : "") + " with historical purchase dates:\n" + needsDateFix.map(s => "  • " + s.name).join("\n") + "\nThese will have purchase prices updated to today's price.\n\n";
    const clean = students.length - corrupted.length - needsDateFix.length;
    msg += "✓ " + clean + " student" + (clean !== 1 ? "s" : "") + " with clean data — cash balances will be recalculated.\n\nProceed?";

    if (!window.confirm(msg)) return;

    // Process corrupted — reset entirely
    for (const s of corrupted) {
      update(ref(db, `students/${s.id}`), { holdings: [], cashBalance: BUDGET });
      await new Promise(r => setTimeout(r, 100));
    }

    // Process date fixes — re-fetch today's price for old-dated holdings
    for (const s of needsDateFix) {
      let holdings = [...(s.holdings || [])];
      const exploited = holdings.filter(h => h.date && h.date < SIM_START_DATE);
      const tickers = [...new Set(exploited.map(h => h.ticker))];
      const priceMap = {};
      await Promise.all(tickers.map(async t => {
        try {
          const res = await fetch('/api/proxy', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker: t })
          });
          const data = await res.json();
          const price = data.currentPrice || data.previousClose;
          if (price) priceMap[t] = price;
        } catch(e) {}
      }));
      holdings = holdings.map(h => {
        if (!h.date || h.date >= SIM_START_DATE) return h;
        const newPrice = priceMap[h.ticker];
        if (!newPrice) return h; // skip if price fetch failed
        return { ...h, purchasePrice: newPrice, shares: h.spent / newPrice, date: SIM_START_DATE };
      });
      const correctBalance = BUDGET - holdings.reduce((sum, h) => sum + (h.spent || 0), 0);
      update(ref(db, `students/${s.id}`), { holdings, cashBalance: correctBalance });
      await new Promise(r => setTimeout(r, 150));
    }

    // Process clean students — just recalculate cash balance
    const cleanStudents = students.filter(s => !corrupted.includes(s) && !needsDateFix.includes(s));
    for (const s of cleanStudents) {
      const correctBalance = BUDGET - (s.holdings || []).reduce((sum, h) => sum + (h.spent || 0), 0);
      update(ref(db, `students/${s.id}`), { cashBalance: correctBalance });
      await new Promise(r => setTimeout(r, 50));
    }

    alert("✓ Fix All complete.");
  };

  const handleUpdateHoldings = (studentId, holdings, cashBalance) => {
    const updateData = { holdings };
    if (cashBalance !== undefined) updateData.cashBalance = cashBalance;
    update(ref(db, `students/${studentId}`), updateData);
    const tickers = holdings.map(h => h.ticker).filter(Boolean);
    if (tickers.length) refreshPrices(tickers);
  };

  const handleDelete = (id) => { setConfirmDeleteId(id); };
  const confirmDelete = () => {
    remove(ref(db, `students/${confirmDeleteId}`));
    setDetail(null);
    setConfirmDeleteId(null);
  };

  const handleSave = () => {
    const blob = new Blob([JSON.stringify({ students }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "stock-roster.json"; a.click();
  };
  const handleLoad = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const { students: loaded } = JSON.parse(ev.target.result);
        loaded.forEach(s => set(ref(db, `students/${s.id}`), s));
        const tickers = [...new Set(loaded.flatMap(s => s.holdings.map(h => h.ticker)))];
        if (tickers.length) refreshPrices(tickers);
      } catch { setErrorMsg("Failed to load file — invalid format."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── Mode gates ────────────────────────────────────────────────────────────
  if (appMode === "select") return (
    <ModeSelectModal
      onSelectLive={() => setAppMode("live")}
      onSelectArcade={() => setAppMode("arcade-pick")}
    />
  );

  if (appMode === "arcade-pick") return (
    <ArcadeStockPicker
      onStart={startArcade}
      onCancel={() => setAppMode("select")}
    />
  );

  if (appMode === "arcade") return (
    <ArcadeSession
      portfolio={arcadePortfolio}
      prices={arcadePrices}
      setPrices={setArcadePrices}
      challengers={arcadeChallengers}
      setChallengers={setArcadeChallengers}
      events={arcadeEvents}
      setEvents={setArcadeEvents}
      timeLeft={arcadeTimeLeft}
      setTimeLeft={setArcadeTimeLeft}
      tickRef={arcadeTickRef}
      timerRef={arcadeTimerRef}
      onStop={stopArcade}
    />
  );

  const detailStudent = detail ? students.find(s => s.id === detail) : null;
  const manageStudent = manageId ? students.find(s => s.id === manageId) : null;

  if (detailStudent) return (
    <>
      {teacherMode && (
        <div style={{ background: "#0d2a1a", borderBottom: "1px solid #22c55e44", padding: "6px 24px", textAlign: "center", fontSize: 11, color: "#22c55e", fontWeight: 700, letterSpacing: 1 }}>
          🔑 TEACHER MODE ACTIVE — PIN BYPASS ENABLED
        </div>
      )}
      <StudentDetail student={detailStudent} prices={prices} onBack={() => setDetail(null)} onDelete={handleDelete} onUpdateHoldings={handleUpdateHoldings} onUpdateNotes={handleUpdateNotes} onUpdatePin={handleUpdatePin} onUpdateClass={handleUpdateClass} onResetStudent={handleResetStudent} onError={setErrorMsg} fetchPrice={fetchPrice} teacherMode={teacherMode}/>
      {errorMsg && <ErrorToast message={errorMsg} onClose={() => setErrorMsg(null)}/>}
      {confirmDeleteId && (
        <ConfirmModal
          name={students.find(s => s.id === confirmDeleteId)?.name || "this student"}
          onConfirm={confirmDelete}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
      {pinPrompt && (() => {
        const s = students.find(st => st.id === pinPrompt.studentId);
        return (
          <PinModal
            studentName={s?.name || "Student"}
            pinError={pinError}
            onSuccess={handlePinSubmit}
            onCancel={() => { setPinPrompt(null); setPinErrorState(""); }}
          />
        );
      })()}
    </>
  );

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a1628 0%, #0f2040 50%, #0a1628 100%)", fontFamily: "'DM Sans', sans-serif", color: "#e0e8ff" }}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>

      <div style={{ background: "linear-gradient(90deg, #0d1f3c, #1C4587)", borderBottom: "2px solid #FFD966", padding: "0 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ background: "#FFD966", borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📈</div>
            <div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 3, color: "#FFD966" }}>STOCK MARKET SIM</div>
              <div style={{ fontSize: 10, color: "#8899bb", letterSpacing: 1 }}>STUDENT INVESTMENT DASHBOARD</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {lastRefresh && <div style={{ fontSize: 11, color: "#5566aa" }}>Updated {lastRefresh.toLocaleTimeString()}</div>}
            {/* View toggle */}
            <div style={{ display: "flex", background: "#0d1f3c", border: "1px solid #2a3f6b", borderRadius: 8, overflow: "hidden" }}>
              {[["dashboard","📊 Dashboard"],["leaderboard","🏆 Leaderboard"]].map(([v, label]) => (
                <button key={v} onClick={() => setView(v)}
                  style={{ background: view === v ? "#1C4587" : "transparent", border: "none", color: view === v ? "#e0e8ff" : "#5566aa", cursor: "pointer", padding: "7px 14px", fontSize: 12, fontWeight: view === v ? 700 : 400, transition: "all 0.15s" }}>
                  {label}
                </button>
              ))}
            </div>
            {/* Teacher Mode Toggle */}
            {teacherMode ? (
              <button onClick={() => setTeacherMode(false)}
                style={{ background: "#14532d", border: "1px solid #22c55e88", borderRadius: 8, color: "#22c55e", cursor: "pointer", padding: "7px 14px", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block", boxShadow: "0 0 6px #22c55e" }}/>
                Teacher Mode ON
              </button>
            ) : (
              <button onClick={() => { setPinErrorState(""); setTeacherModePrompt(true); }}
                style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: "#8899bb", cursor: "pointer", padding: "7px 14px", fontSize: 12 }}>
                🔑 Teacher Mode
              </button>
            )}
            <button onClick={() => refreshPrices(allTickers)} disabled={refreshing || !allTickers.length}
              style={{ background: refreshing ? "#1a2d52" : "#1C4587", border: "1px solid #2a4a8a", borderRadius: 8, color: refreshing ? "#5566aa" : "#e0e8ff", cursor: refreshing ? "default" : "pointer", padding: "7px 14px", fontSize: 12 }}>
              {refreshing ? "⟳ Updating…" : "⟳ Refresh"}
            </button>
            <button onClick={handleFixAllBalances} disabled={!students.length} title="Recalculate cash balance for ALL students"
              style={{ background: "#1a2d52", border: "1px solid #f59e0b55", borderRadius: 8, color: students.length ? "#f59e0b" : "#445577", cursor: students.length ? "pointer" : "default", padding: "7px 14px", fontSize: 12, fontWeight: 600 }}>
              ⚖️ Fix All
            </button>
            {teacherMode && <>
              <button onClick={() => exportCSV(students, prices)} disabled={!students.length}
                style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: students.length ? "#8899bb" : "#2a3f6b", cursor: students.length ? "pointer" : "default", padding: "7px 14px", fontSize: 12 }}>📤 Export CSV</button>
              <button onClick={handleSave} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: "#8899bb", cursor: "pointer", padding: "7px 14px", fontSize: 12 }}>💾 Save</button>
              <button onClick={() => fileRef.current.click()} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: "#8899bb", cursor: "pointer", padding: "7px 14px", fontSize: 12 }}>📂 Load</button>
              <input ref={fileRef} type="file" accept=".json" onChange={handleLoad} style={{ display: "none" }}/>
            </>}
            <div style={{ display: "flex", background: "#FFD966", borderRadius: 8, overflow: "hidden" }}>
              <button onClick={() => setShowAdd(true)} style={{ background: "transparent", border: "none", borderRight: "1px solid rgba(0,0,0,0.15)", color: "#0d1f3c", cursor: "pointer", padding: "7px 14px", fontSize: 12, fontWeight: 700 }}>
                + Add Student
              </button>
              <button onClick={() => setShowBulkAdd(true)} title="Bulk add from list" style={{ background: "transparent", border: "none", color: "#0d1f3c", cursor: "pointer", padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>
                ⊞
              </button>
            </div>
          </div>
        </div>
      </div>
      <MarketStatusBanner/>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
        {!students.length ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#445577" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 3, color: "#2a3f6b", marginBottom: 8 }}>NO STUDENTS YET</div>
            <div style={{ fontSize: 14, marginBottom: 24 }}>Add your roster first, then assign stock purchases as students make their picks.</div>
            <button onClick={() => setShowAdd(true)} style={{ background: "#FFD966", border: "none", borderRadius: 10, color: "#0d1f3c", cursor: "pointer", padding: "12px 28px", fontSize: 14, fontWeight: 700 }}>Add First Student</button>
          </div>
        ) : view === "leaderboard" ? (
          <Leaderboard students={students} prices={prices} onSelectStudent={(id) => requestAccess(id, "detail")}/>
        ) : (
          (() => {
            const sortStudents = (arr) => {
              const withStats = arr.map(s => {
                const inv = s.holdings.reduce((a, h) => a + h.spent, 0);
                const cash = s.cashBalance != null ? s.cashBalance : BUDGET - inv;
                const stockVal = s.holdings.reduce((a, h) => {
                  const p = prices[h.ticker]?.currentPrice;
                  if (p == null || !h.purchasePrice || !h.spent) return a + h.spent;
                  return a + p * (h.spent / h.purchasePrice);
                }, 0);
                const cur = stockVal + cash;
                const pct = ((cur - BUDGET) / BUDGET) * 100;
                const today = s.holdings.reduce((a, h) => {
                  const p = prices[h.ticker];
                  if (!p?.currentPrice || !h.purchasePrice || !h.spent) return a;
                  return a + (p.currentPrice - h.purchasePrice) * (h.spent / h.purchasePrice);
                }, 0);
                return { ...s, _pct: pct, _today: today };
              });
              if (sortBy === "pct_desc") return [...withStats].sort((a, b) => (b._pct ?? -Infinity) - (a._pct ?? -Infinity));
              if (sortBy === "pct_asc") return [...withStats].sort((a, b) => (a._pct ?? Infinity) - (b._pct ?? Infinity));
              if (sortBy === "name") return [...withStats].sort((a, b) => a.name.localeCompare(b.name));
              if (sortBy === "today") return [...withStats].sort((a, b) => b._today - a._today);
              return withStats;
            };

            const sortLabels = [["default","Default"],["pct_desc","Best Return"],["pct_asc","Worst Return"],["today","Today's Gain"],["name","Name A–Z"]];

            return (
              <>
              <ClassSummaryBar students={students} prices={prices}/>
              <DailyHighlights students={students} prices={prices}/>

              {/* Sort toolbar */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "#445577", letterSpacing: 1 }}>SORT:</span>
                {sortLabels.map(([val, label]) => (
                  <button key={val} onClick={() => setSortBy(val)}
                    style={{ background: sortBy === val ? "#1C4587" : "#0d1f3c", border: `1px solid ${sortBy === val ? "#2a4a8a" : "#2a3f6b"}`, borderRadius: 6, color: sortBy === val ? "#e0e8ff" : "#5566aa", cursor: "pointer", padding: "4px 12px", fontSize: 11, fontWeight: sortBy === val ? 700 : 400 }}>
                    {label}
                  </button>
                ))}
              </div>

              {classes.map(cls => {
                const clsStudents = sortStudents(students.filter(s => s.className === cls));
                return (
                  <div key={cls} style={{ marginBottom: 36 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 3, color: "#FFD966" }}>{cls}</div>
                      <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, #2a3f6b, transparent)" }}/>
                      <div style={{ fontSize: 11, color: "#445577" }}>{clsStudents.length} students</div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
                      {clsStudents.map(s => (
                        <StudentCard key={s.id} student={s} prices={prices} onClick={() => requestAccess(s.id, "detail")} onManage={() => requestAccess(s.id, "manage")} isUnlocked={teacherMode || unlockedStudents.has(s.id)}/>
                      ))}
                    </div>
                  </div>
                );
              })}
              </>
            );
          })()
        )}
      </div>

      {showAdd && <AddStudentModal classes={classes} onAdd={handleAddStudent} onClose={() => setShowAdd(false)}/>}
      {showBulkAdd && <BulkAddModal classes={classes} onAdd={handleAddStudent} onClose={() => setShowBulkAdd(false)}/>}

      {manageStudent && (
        <ManageHoldingsModal
          student={manageStudent}
          prices={prices}
          teacherMode={teacherMode}
          onSave={(h, cash) => { handleUpdateHoldings(manageStudent.id, h, cash); setManageId(null); }}
          onClose={() => setManageId(null)}
          onError={setErrorMsg}
          fetchPrice={fetchPrice}
        />
      )}

      {errorMsg && <ErrorToast message={errorMsg} onClose={() => setErrorMsg(null)}/>}
      {confirmDeleteId && (
        <ConfirmModal
          name={students.find(s => s.id === confirmDeleteId)?.name || "this student"}
          onConfirm={confirmDelete}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
      {pinPrompt && (() => {
        const s = students.find(st => st.id === pinPrompt.studentId);
        return (
          <PinModal
            studentName={s?.name || "Student"}
            pinError={pinError}
            onSuccess={handlePinSubmit}
            onCancel={() => { setPinPrompt(null); setPinErrorState(""); }}
          />
        );
      })()}
      {teacherModePrompt && (
        <PinModal
          studentName="Teacher Access"
          pinError={pinError}
          onSuccess={handleTeacherModePin}
          onCancel={() => { setTeacherModePrompt(false); setPinErrorState(""); }}
        />
      )}
    </div>
  );
}
