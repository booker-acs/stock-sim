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
const ALERT_THRESHOLD = 5; // % move triggers badge
const TEACHER_PIN_HASH = "f823fed903848e7a12e6e04eca7a1a57e56a39a668f4911d48ef6386015646ed"; // sha256 of teacher PIN
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
    const pnl = current != null ? (current - h.purchasePrice) * h.shares : null;
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

function ManageHoldingsModal({ student, onSave, onClose, onError, fetchPrice }) {
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

  const lockedSpent = rows.filter(h => h.purchasePrice != null && h.purchasePrice > 0).reduce((s, h) => s + (h.spent || 0), 0);
  const newSpent = rows.filter(h => !(h.purchasePrice != null && h.purchasePrice > 0)).reduce((s, h) => s + (parseFloat(h.spentStr) || 0), 0);
  const totalSpent = lockedSpent + newSpent;
  const cashLeft = BUDGET - totalSpent;
  const overBudget = totalSpent > BUDGET;
  const pctUsed = Math.min((totalSpent / BUDGET) * 100, 100);
  const today = new Date().toISOString().slice(0, 10);

  const addRow = () => { if (rows.length < 10) setRows(prev => [...prev, { id: uid(), ticker: "", date: today, spentStr: "", spent: 0, purchasePrice: null, shares: null }]); };
  const removeRow = (id) => setRows(prev => prev.filter(h => h.id !== id));
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
    const total = valid.reduce((s, h) => s + parseFloat(h.spentStr), 0);
    if (total > BUDGET) {
      onError(`You've exceeded your pocket cash! Total $${total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} exceeds the $10,000 budget by ${fmt$(total - BUDGET)}. Please reduce your investments.`);
      return;
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
    const newCashBalance = BUDGET - totalLockedSpent;
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
            <span style={{ color: "#8899bb" }}>BUDGET USED</span>
            <span style={{ fontWeight: 700, color: overBudget ? "#ef4444" : cashLeft <= 500 ? "#f59e0b" : "#22c55e" }}>
              {fmt$(totalSpent)} / {fmt$(BUDGET)} &nbsp;·&nbsp; {fmt$(cashLeft)} remaining
            </span>
          </div>
          <div style={{ height: 6, background: "#0d1f3c", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pctUsed}%`, background: overBudget ? "#ef4444" : pctUsed > 90 ? "#f59e0b" : "#22c55e", borderRadius: 4, transition: "width 0.3s ease" }}/>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "90px 130px 1fr 32px", gap: 8, marginBottom: 6, padding: "0 2px" }}>
          {["TICKER", "PURCHASE DATE", "$ INVESTED", ""].map(h => (
            <div key={h} style={{ fontSize: 10, color: "#445577", letterSpacing: 1 }}>{h}</div>
          ))}
        </div>

        {rows.map(h => {
          const isPast = h.date && h.date < today;
          const isLocked = h.purchasePrice != null;
          const status = fetchStatus[h.id];
          return (
            <div key={h.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "90px 130px 1fr 32px", gap: 8, alignItems: "center" }}>
                <input value={h.ticker} onChange={e => updateRow(h.id, "ticker", e.target.value)} placeholder="AAPL" style={{ ...iStyle, fontFamily: "monospace", textTransform: "uppercase" }}/>
                <div style={{ position: "relative" }}>
                  <input type="date" value={h.date} onChange={e => updateRow(h.id, "date", e.target.value)} style={{ ...iStyle, borderColor: isPast ? "#f59e0b66" : "#2a3f6b" }}/>
                </div>
                <input type="number" min="0" value={h.spentStr} onChange={e => updateRow(h.id, "spentStr", e.target.value)} placeholder="Amount ($)" style={{ ...iStyle, borderColor: overBudget ? "#ef444466" : "#2a3f6b" }}/>
                <button onClick={() => removeRow(h.id)} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 6, color: "#ef4444", cursor: "pointer", fontSize: 14, height: 36, width: 32 }}>✕</button>
              </div>
              {(isPast || isLocked || status) && (
                <div style={{ paddingLeft: 2, marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                  {status ? (
                    <span style={{ fontSize: 11, color: "#f59e0b", fontStyle: "italic" }}>⟳ {status}</span>
                  ) : isLocked ? (
                    <span style={{ fontSize: 11, color: "#22c55e" }}>✓ Locked at {fmt$(h.purchasePrice)} ({h.date})</span>
                  ) : isPast ? (
                    <span style={{ fontSize: 11, color: "#f59e0b" }}>📅 Historical price will be fetched for {h.date}</span>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}

        {rows.length < 10 && (
          <button onClick={addRow} style={{ background: "none", border: "1px dashed #2a3f6b", borderRadius: 6, color: "#8899bb", cursor: "pointer", padding: "7px 0", width: "100%", fontSize: 12, marginBottom: 4 }}>
            + Add Stock
          </button>
        )}

        {overBudget && (
          <div style={{ background: "#3a0f0f", border: "1px solid #ef4444", borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 12, marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <span>⚠️</span>
            <span>Exceeds $10,000 budget by <strong>{fmt$(totalSpent - BUDGET)}</strong>. You've exceeded your pocket cash — reduce investments to save.</span>
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
    <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 12, padding: "20px", marginTop: 16 }}>
      <div style={{ fontSize: 11, color: "#6677aa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 16 }}>Portfolio Diversity</div>

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

  const today = new Date().toISOString().slice(0, 10);

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
      // use cached price if available, otherwise fetch
      const cached = prices[ticker];
      if (cached?.currentPrice) return { ticker, currentPrice: cached.currentPrice, companyName: cached.companyName };
      const p = await fetchPrice(ticker);
      return { ticker, currentPrice: p?.currentPrice || null, companyName: p?.companyName || ticker };
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
    if (!p?.currentPrice) return { ticker, spent, pnl: null, pct: null };
    // Use previousClose from global prices if available, else currentPrice (no change)
    const prevClose = prices[ticker]?.previousClose || p.currentPrice;
    const shares = spent / prevClose;
    const nowVal = shares * p.currentPrice;
    const pnl = nowVal - spent;
    const pct = (pnl / spent) * 100;
    return { ticker, spent, shares, buyPrice: prevClose, nowPrice: p.currentPrice, nowVal, pnl, pct, companyName: p.companyName };
  }) : [];

  const simTotalPnL = simResults.reduce((s, r) => s + (r.pnl || 0), 0);
  const simTotalPct = simInvested > 0 ? (simTotalPnL / simInvested) * 100 : 0;

  const iStyle = { background: "#0d1f3c", border: "1px solid #2a3f6b", borderRadius: 6, color: "#e0e8ff", padding: "7px 10px", fontSize: 13, outline: "none", boxSizing: "border-box", width: "100%" };

  return (
    <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 12, padding: "20px", marginTop: 16 }}>
      <div style={{ fontSize: 11, color: "#6677aa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>What-If Simulator</div>
      <div style={{ fontSize: 12, color: "#445577", marginBottom: 16 }}>
        Hypothetically test alternative investments without affecting this student's real portfolio.
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
                <div style={{ fontSize: 10, color: "#445577", letterSpacing: 1, marginBottom: 4 }}>HYPOTHETICAL (TODAY)</div>
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
            Simulation uses yesterday's close as buy price and today's price as current value.
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
      <div style={{ fontSize: 11, color: "#6677aa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>
        {student.pinHash ? "Change PIN" : "Set Student PIN"}
      </div>
      <div style={{ fontSize: 12, color: "#445577", marginBottom: 14 }}>
        {student.pinHash ? "Enter a new 4-digit PIN to replace the current one." : "No PIN is set. Set one so this student can access their own portfolio."}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "flex-end" }}>
        <div>
          <label style={{ fontSize: 10, color: "#5566aa", display: "block", marginBottom: 4, letterSpacing: 1 }}>NEW PIN</label>
          <input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g,"")); setErr(""); }} placeholder="••••" style={iStyle}/>
        </div>
        <div>
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

function StudentDetail({ student, prices, onBack, onDelete, onUpdateHoldings, onUpdateNotes, onUpdatePin, onFixBalance, onError, fetchPrice }) {
  const [showManage, setShowManage] = useState(false);
  const [notes, setNotes] = useState(student.notes || "");
  const [notesSaved, setNotesSaved] = useState(false);

  const handleSaveNotes = () => {
    onUpdateNotes(student.id, notes);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  };
  const totalInvested = student.holdings.reduce((s, h) => s + h.spent, 0);
  const cashLeft = student.cashBalance != null ? student.cashBalance : BUDGET - totalInvested;
  const totalCurrent = student.holdings.reduce((s, h) => {
    const p = prices[h.ticker]?.currentPrice;
    return s + (p != null && h.shares != null ? p * h.shares : h.spent);
  }, 0);
  const totalPnL = totalCurrent - totalInvested;
  const totalPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
  const todayPnL = student.holdings.reduce((s, h) => {
    const p = prices[h.ticker];
    if (!p?.currentPrice || !p?.previousClose || !h.shares) return s;
    return s + (p.currentPrice - p.previousClose) * h.shares;
  }, 0);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a1628 0%, #0f2040 50%, #0a1628 100%)", padding: "24px 20px", fontFamily: "'DM Sans', sans-serif", color: "#e0e8ff" }}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
          <button onClick={onBack} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: "#8899bb", cursor: "pointer", padding: "8px 14px", fontSize: 13 }}>← Back</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, letterSpacing: 3, color: "#e0e8ff" }}>{student.name}</div>
            <div style={{ fontSize: 12, color: "#8899bb" }}>{student.className}</div>
          </div>
          <button onClick={() => setShowManage(true)} style={{ background: "#1C4587", border: "1px solid #2a4a8a", borderRadius: 8, color: "#e0e8ff", cursor: "pointer", padding: "8px 16px", fontSize: 13, fontWeight: 600 }}>
            ✏️ Manage Holdings
          </button>
          <button onClick={() => onFixBalance(student.id)} title="Recalculate cash balance from current holdings" style={{ background: "#1a2d52", border: "1px solid #f59e0b55", borderRadius: 8, color: "#f59e0b", cursor: "pointer", padding: "8px 14px", fontSize: 12, fontWeight: 600 }}>
            ⚖️ Fix Balance
          </button>
          <button onClick={() => onDelete(student.id)} style={{ background: "none", border: "1px solid #3a1a1a", borderRadius: 8, color: "#ef4444", cursor: "pointer", padding: "8px 14px", fontSize: 12 }}>Remove</button>
        </div>

        <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6677aa", marginBottom: 6 }}>
            <span>BUDGET — {fmt$(totalInvested)} invested</span>
            <span style={{ color: cashLeft > 500 ? "#f59e0b" : "#22c55e" }}>{fmt$(cashLeft)} unallocated</span>
          </div>
          <div style={{ height: 5, background: "#0d1f3c", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min((totalInvested / BUDGET) * 100, 100)}%`, background: "#1C4587", borderRadius: 4, transition: "width 0.4s ease" }}/>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Portfolio Value", value: fmt$(totalCurrent + cashLeft), sub: `${fmt$(cashLeft)} cash` },
            { label: "Total P&L", value: fmtPct(totalPct), sub: fmt$(totalPnL), color: totalPnL >= 0 ? "#22c55e" : "#ef4444" },
            { label: "Today's Change", value: todayPnL >= 0 ? `+${fmt$(todayPnL)}` : fmt$(todayPnL), sub: "vs prev close", color: todayPnL >= 0 ? "#22c55e" : "#ef4444" }
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
              <div style={{ fontSize: 11, color: "#6677aa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 16 }}>Performance by Stock</div>
              <BarChart holdings={student.holdings} prices={prices}/>
            </div>
            <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 12, padding: "20px", marginTop: 16 }}>
              <div style={{ fontSize: 11, color: "#6677aa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 16 }}>Holdings Detail</div>
              <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 70px 90px 80px 80px 80px", gap: 8, marginBottom: 8, padding: "0 4px" }}>
                {["Ticker","Company","Shares","Date","Buy Price","Now","P&L"].map(h => (
                  <div key={h} style={{ fontSize: 10, color: "#445577", textTransform: "uppercase", letterSpacing: 1 }}>{h}</div>
                ))}
              </div>
              {student.holdings.map(h => {
                const p = prices[h.ticker];
                const cur = p?.currentPrice;
                const pnl = cur != null && h.shares != null ? (cur - h.purchasePrice) * h.shares : null;
                return (
                  <div key={h.id} style={{ display: "grid", gridTemplateColumns: "70px 1fr 70px 90px 80px 80px 80px", gap: 8, padding: "10px 4px", borderTop: "1px solid #1a2d52", alignItems: "center" }}>
                    <div style={{ fontFamily: "monospace", fontWeight: 700, color: "#FFD966", fontSize: 13 }}>{h.ticker}</div>
                    <div style={{ fontSize: 12, color: "#aabbd0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p?.companyName || h._companyName || "—"}</div>
                    <div style={{ fontSize: 12, color: "#c0cfea" }}>{h.shares != null ? h.shares.toFixed(3) : "—"}</div>
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
      {/* Portfolio history chart */}
      {(student.history?.length >= 1) && (
        <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 12, padding: "20px", marginTop: 16 }}>
          <div style={{ fontSize: 11, color: "#6677aa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 14 }}>Portfolio History</div>
          <PortfolioHistoryChart history={student.history}/>
        </div>
      )}

      {/* Diversity + What-If */}
      {student.holdings.length > 0 && (
        <DiversityPanel holdings={student.holdings}/>
      )}
      <WhatIfSimulator student={student} prices={prices} fetchPrice={fetchPrice}/>

      {/* Notes section */}
      <div style={{ background: "#0f2347", border: "1px solid #1e3560", borderRadius: 12, padding: "20px", marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "#6677aa", textTransform: "uppercase", letterSpacing: 1.5 }}>Teacher Notes</div>
          <button onClick={handleSaveNotes}
            style={{ background: notesSaved ? "#14532d" : "#1a2d52", border: `1px solid ${notesSaved ? "#22c55e" : "#2a3f6b"}`, borderRadius: 6, color: notesSaved ? "#22c55e" : "#8899bb", cursor: "pointer", padding: "4px 14px", fontSize: 11, fontWeight: 600, transition: "all 0.2s" }}>
            {notesSaved ? "✓ Saved" : "Save Notes"}
          </button>
        </div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Add grading notes, observations, or feedback for this student…"
          rows={4}
          style={{ width: "100%", background: "#0d1f3c", border: "1px solid #2a3f6b", borderRadius: 6, color: "#e0e8ff", padding: "10px 12px", fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.6 }}
        />
      </div>

      {/* Set / Change PIN panel */}
      <SetPinPanel student={student} onUpdatePin={onUpdatePin}/>

      {showManage && (
        <ManageHoldingsModal student={student} onSave={(h, cash) => onUpdateHoldings(student.id, h, cash)} onClose={() => setShowManage(false)} onError={onError} fetchPrice={fetchPrice}/>
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
          {[0,1,2,3,4].map(i => (
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
    const totalCurrent = s.holdings.reduce((sum, h) => {
      const p = prices[h.ticker]?.currentPrice;
      return sum + (p != null && h.shares != null ? p * h.shares : h.spent);
    }, 0);
    const pnl = totalCurrent - totalInvested;
    const pct = totalInvested > 0 ? (pnl / totalInvested) * 100 : null;
    const todayPnL = s.holdings.reduce((sum, h) => {
      const p = prices[h.ticker];
      if (!p?.currentPrice || !p?.previousClose || !h.shares) return sum;
      return sum + (p.currentPrice - p.previousClose) * h.shares;
    }, 0);
    const hasData = s.holdings.some(h => prices[h.ticker]?.currentPrice);
    return { ...s, totalInvested, totalCurrent, pnl, pct, todayPnL, hasData };
  }).sort((a, b) => {
    if (a.pct == null && b.pct == null) return 0;
    if (a.pct == null) return 1;
    if (b.pct == null) return -1;
    return b.pct - a.pct;
  });

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
              const heights = [100, 130, 80];
              const h = heights[idx];
              return (
                <div key={s.id} onClick={() => onSelectStudent(s.id)}
                  style={{ flex: 1, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{ fontSize: idx === 0 ? 28 : 20 }}>{medals[idx]}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#e0e8ff", textAlign: "center", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: "#6677aa" }}>{s.className}</div>
                  <div style={{ fontSize: idx === 0 ? 20 : 16, fontWeight: 700, color: s.pct >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(s.pct)}</div>
                  <div style={{ width: "100%", height: h, background: s.pct >= 0 ? "#14532d" : "#3a0f0f", borderRadius: "6px 6px 0 0", display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${s.pct >= 0 ? "#22c55e44" : "#ef444444"}`, borderBottom: "none" }}>
                    <div style={{ fontSize: 11, color: s.pct >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{idx + 1 === 1 ? "2nd" : idx + 1 === 2 ? "1st" : "3rd"}</div>
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

  const totalInvested = withHoldings.reduce((sum, s) => sum + s.holdings.reduce((a, h) => a + h.spent, 0), 0);
  const totalCurrent = withHoldings.reduce((sum, s) =>
    sum + s.holdings.reduce((a, h) => {
      const p = prices[h.ticker]?.currentPrice;
      return a + (p != null && h.shares != null ? p * h.shares : h.spent);
    }, 0), 0);
  const totalPnL = totalCurrent - totalInvested;
  const avgPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

  const ranked = withHoldings.map(s => {
    const inv = s.holdings.reduce((a, h) => a + h.spent, 0);
    const cur = s.holdings.reduce((a, h) => {
      const p = prices[h.ticker]?.currentPrice;
      return a + (p != null && h.shares != null ? p * h.shares : h.spent);
    }, 0);
    const pct = inv > 0 ? ((cur - inv) / inv) * 100 : null;
    return { ...s, pct };
  }).filter(s => s.pct != null).sort((a, b) => b.pct - a.pct);

  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const studentsWithData = ranked.length;

  const stats = [
    { label: "Students Invested", value: `${studentsWithData} / ${students.length}`, color: "#FFD966" },
    { label: "Total Class Invested", value: fmt$(totalInvested), color: "#e0e8ff" },
    { label: "Total Class Value", value: fmt$(totalCurrent), color: "#e0e8ff" },
    { label: "Avg Return", value: fmtPct(avgPct), color: avgPct >= 0 ? "#22c55e" : "#ef4444" },
    best && { label: "Class Leader", value: best.name, sub: fmtPct(best.pct), color: "#22c55e" },
    worst && best?.id !== worst?.id && { label: "Trailing", value: worst.name, sub: fmtPct(worst.pct), color: "#ef4444" },
  ].filter(Boolean);

  return (
    <div style={{ background: "#0a1a38", border: "1px solid #1e3560", borderRadius: 10, padding: "12px 20px", marginBottom: 24, display: "flex", gap: 0, flexWrap: "wrap" }}>
      {stats.map((s, i) => (
        <div key={i} style={{ flex: "1 1 120px", padding: "6px 16px", borderLeft: i > 0 ? "1px solid #1e3560" : "none" }}>
          <div style={{ fontSize: 10, color: "#445577", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>{s.label}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: s.color, whiteSpace: "nowrap" }}>{s.value}</div>
          {s.sub && <div style={{ fontSize: 11, color: s.color, opacity: 0.8 }}>{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Daily Highlights Banner ───────────────────────────────────────────────────
function DailyHighlights({ students, prices }) {
  // student-level today P&L
  const studentStats = students
    .map(s => {
      const todayPnL = s.holdings.reduce((sum, h) => {
        const p = prices[h.ticker];
        if (!p?.currentPrice || !p?.previousClose || !h.shares) return sum;
        return sum + (p.currentPrice - p.previousClose) * h.shares;
      }, 0);
      const hasData = s.holdings.some(h => prices[h.ticker]?.previousClose);
      return { id: s.id, name: s.name, todayPnL, hasData };
    })
    .filter(s => s.hasData);

  // unique tickers with today % change
  const tickerStats = [];
  const seen = new Set();
  students.forEach(s => s.holdings.forEach(h => {
    if (seen.has(h.ticker)) return;
    const p = prices[h.ticker];
    if (!p?.currentPrice || !p?.previousClose) return;
    seen.add(h.ticker);
    const pct = ((p.currentPrice - p.previousClose) / p.previousClose) * 100;
    tickerStats.push({ ticker: h.ticker, companyName: p.companyName || h.ticker, pct });
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
    topTicker && {
      icon: "🚀", label: "HOTTEST STOCK TODAY", name: topTicker.ticker,
      sub: topTicker.companyName !== topTicker.ticker ? topTicker.companyName : null,
      value: fmtPct(topTicker.pct), color: "#22c55e", border: "#14532d"
    },
    botTicker && topTicker?.ticker !== botTicker?.ticker && {
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

function StudentCard({ student, prices, onClick, onManage }) {
  const totalInvested = student.holdings.reduce((s, h) => s + h.spent, 0);
  const cashLeft = student.cashBalance != null ? student.cashBalance : BUDGET - totalInvested;
  const currentVals = student.holdings.map(h => {
    const p = prices[h.ticker]?.currentPrice;
    return p != null && h.shares != null ? p * h.shares : h.spent;
  });
  const totalCurrent = currentVals.reduce((a, b) => a + b, 0);
  const pnl = totalCurrent - totalInvested;
  const pct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;
  const todayPnL = student.holdings.reduce((s, h) => {
    const p = prices[h.ticker];
    if (!p?.currentPrice || !p?.previousClose || !h.shares) return s;
    return s + (p.currentPrice - p.previousClose) * h.shares;
  }, 0);
  const hasHoldings = student.holdings.length > 0;
  const isPos = pct >= 0;
  const todayPos = todayPnL >= 0;
  const spark = hasHoldings ? [totalInvested, totalInvested * (1 + (pct * 0.3 / 100)), totalInvested + todayPnL * 0.5, totalCurrent] : [];

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
                <div style={{ fontSize: 12, color: "#8899bb" }}>Value: <span style={{ color: "#FFD966", fontWeight: 600 }}>{fmt$(totalCurrent)}</span></div>
                <div style={{ fontSize: 11, color: todayPos ? "#22c55e" : "#ef4444", marginTop: 2 }}>Today: {todayPos ? "+" : ""}{fmt$(todayPnL)}</div>
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
 const [students, setStudents] = useState([]);

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
  const [prices, setPrices] = useState({});
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
  const fileRef = useRef();

  // Validate a submitted PIN hash against a student
  const handlePinSubmit = async (hash) => {
    const { studentId, mode } = pinPrompt;
    const student = students.find(s => s.id === studentId);
    const isTeacher = hash === TEACHER_PIN_HASH;
    const isStudent = student?.pinHash && hash === student.pinHash;
    if (isTeacher || isStudent) {
      setPinPrompt(null);
      setPinErrorState("");
      if (mode === "detail") setDetail(studentId);
      else setManageId(studentId);
    } else {
      setPinErrorState("Incorrect PIN. Try again.");
      // We surface this back through the modal via re-render with error
    }
  };

  const requestAccess = (studentId, mode) => {
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
    setStudents(prev => prev.map(s => ({
      ...s,
      holdings: s.holdings.map(h => {
        if (h.purchasePrice != null) return h;
        const p = results.find(r => r.ticker === h.ticker);
        if (!p?.currentPrice) return h;
        return { ...h, purchasePrice: p.currentPrice, shares: h.spent / p.currentPrice };
      })
    })));
    // snapshot portfolio history for each student
    const today = new Date().toISOString().slice(0, 10);
    setStudents(prev => prev.map(s => {
      const totalInvested = s.holdings.reduce((a, h) => a + h.spent, 0);
      const totalCurrent = s.holdings.reduce((a, h) => {
        const p = results.find(r => r.ticker === h.ticker);
        const price = p?.currentPrice;
        return a + (price != null && h.shares != null ? price * h.shares : h.spent);
      }, 0);
      if (!totalInvested) return s;
      const history = s.history || [];
      const lastEntry = history[history.length - 1];
      // only add one snapshot per day
      if (lastEntry?.date === today) {
        return { ...s, history: [...history.slice(0, -1), { date: today, value: totalCurrent }] };
      }
      return { ...s, history: [...history, { date: today, value: totalCurrent }] };
    }));
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

  const handleUpdateNotes = (studentId, notes) => {
  update(ref(db, `students/${studentId}`), { notes });
};

  const handleUpdatePin = (studentId, pinHash) => {
    update(ref(db, `students/${studentId}`), { pinHash });
  };

  const handleFixBalance = (studentId) => {
    const student = students.find(s => s.id === studentId);
    if (!student) return;
    const correctBalance = BUDGET - (student.holdings || []).reduce((s, h) => s + (h.spent || 0), 0);
    update(ref(db, `students/${studentId}`), { cashBalance: correctBalance });
  };

  const handleFixAllBalances = () => {
    students.forEach(s => {
      const correctBalance = BUDGET - (s.holdings || []).reduce((sum, h) => sum + (h.spent || 0), 0);
      update(ref(db, `students/${s.id}`), { cashBalance: correctBalance });
    });
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

  const detailStudent = detail ? students.find(s => s.id === detail) : null;
  const manageStudent = manageId ? students.find(s => s.id === manageId) : null;

  if (detailStudent) return (
    <>
      <StudentDetail student={detailStudent} prices={prices} onBack={() => setDetail(null)} onDelete={handleDelete} onUpdateHoldings={handleUpdateHoldings} onUpdateNotes={handleUpdateNotes} onUpdatePin={handleUpdatePin} onFixBalance={handleFixBalance} onError={setErrorMsg} fetchPrice={fetchPrice}/>
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
            <button onClick={() => refreshPrices(allTickers)} disabled={refreshing || !allTickers.length}
              style={{ background: refreshing ? "#1a2d52" : "#1C4587", border: "1px solid #2a4a8a", borderRadius: 8, color: refreshing ? "#5566aa" : "#e0e8ff", cursor: refreshing ? "default" : "pointer", padding: "7px 14px", fontSize: 12 }}>
              {refreshing ? "⟳ Updating…" : "⟳ Refresh"}
            </button>
            <button onClick={handleFixAllBalances} disabled={!students.length} title="Recalculate cash balance for ALL students"
              style={{ background: "#1a2d52", border: "1px solid #f59e0b55", borderRadius: 8, color: students.length ? "#f59e0b" : "#445577", cursor: students.length ? "pointer" : "default", padding: "7px 14px", fontSize: 12, fontWeight: 600 }}>
              ⚖️ Fix All
            </button>
            <button onClick={() => exportCSV(students, prices)} disabled={!students.length}
              style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: students.length ? "#8899bb" : "#2a3f6b", cursor: students.length ? "pointer" : "default", padding: "7px 14px", fontSize: 12 }}>📤 Export CSV</button>
            <button onClick={handleSave} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: "#8899bb", cursor: "pointer", padding: "7px 14px", fontSize: 12 }}>💾 Save</button>
            <button onClick={() => fileRef.current.click()} style={{ background: "#1a2d52", border: "1px solid #2a3f6b", borderRadius: 8, color: "#8899bb", cursor: "pointer", padding: "7px 14px", fontSize: 12 }}>📂 Load</button>
            <input ref={fileRef} type="file" accept=".json" onChange={handleLoad} style={{ display: "none" }}/>
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
                const cur = s.holdings.reduce((a, h) => {
                  const p = prices[h.ticker]?.currentPrice;
                  return a + (p != null && h.shares != null ? p * h.shares : h.spent);
                }, 0);
                const pct = inv > 0 ? ((cur - inv) / inv) * 100 : null;
                const today = s.holdings.reduce((a, h) => {
                  const p = prices[h.ticker];
                  if (!p?.currentPrice || !p?.previousClose || !h.shares) return a;
                  return a + (p.currentPrice - p.previousClose) * h.shares;
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
                        <StudentCard key={s.id} student={s} prices={prices} onClick={() => requestAccess(s.id, "detail")} onManage={() => requestAccess(s.id, "manage")}/>
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
    </div>
  );
}
