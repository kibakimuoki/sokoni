// Indicative FX rates for DISPLAY ONLY (never used to settle money). Source: open.er-api.com (free, needs attribution).
// If the fetch fails, the app falls back to the last cached rates, or shows original currencies only.
const fs = require("fs");
const path = require("path");
const CACHE = path.join(process.env.SOKONI_DATA_DIR || path.join(__dirname, "..", "data"), "fx-cache.json");
let mem = null;
function loadCache() { try { return JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch { return null; } }
async function refresh() {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch("https://open.er-api.com/v6/latest/USD", { signal: ctrl.signal }); clearTimeout(t);
    const d = await r.json();
    if (d && d.result === "success" && d.rates) {
      mem = { base: "USD", rates: d.rates, updatedAt: new Date().toISOString() };
      try { fs.writeFileSync(CACHE, JSON.stringify(mem)); } catch (e) { /* ignore */ }
      return mem;
    }
  } catch (e) { /* offline */ }
  return null;
}
async function getRates() {
  if (!mem) mem = loadCache();
  const stale = !mem || Date.now() - new Date(mem.updatedAt).getTime() > 6 * 3600e3;
  if (stale) { const r = await refresh(); if (r) return r; }
  return mem;
}
async function rate(from, to) {
  if (from === to) return 1;
  const d = await getRates();
  if (!d || !d.rates[from] || !d.rates[to]) return null;
  return d.rates[to] / d.rates[from];
}
function rateSync(from, to) { if (from === to) return 1; const d = mem || loadCache(); if (!d || !d.rates[from] || !d.rates[to]) return null; return d.rates[to] / d.rates[from]; }
module.exports = { getRates, rate, rateSync };
