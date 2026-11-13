// Reads bank text — lines pasted from a statement, or one forwarded bank alert (SMS / email) — and works out which waiting bank-transfer orders it pays.
// It only POINTS at an order (our reference SOKxxxxxxxx, or the M-Pesa code the buyer typed when they pressed "I've sent it"); the amount must also match,
// and the actual holding of the order goes through the same checked path as every other arrival (server.js confirmWire).
const REF = /\bSOK[0-9A-F]{8}\b/gi;                     // the reference Sokoni gave the buyer
const CODE = /\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{10}\b/g; // an M-Pesa style code: 10 letters/digits, at least one of each
const CREDIT = /\b(credited|credit|cr|deposit(?:ed)?|received|rec'd|inward)\b/i, DEBIT = /\b(debited|debit|dr|withdraw(?:n|al)?|charge[sd]?|fee|outward)\b/i;
const AMOUNT = /(?<![\w.,])(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\w,]*\d)/g;
// Amounts, minus the numbers that are NOT the payment: running balances, masked account numbers, dates and times (a balance must never be read as the amount paid).
const clean = (s) => String(s).replace(/\b(bal(?:ance)?|avail(?:able)?|ledger|limit)\b[^0-9\n]{0,15}[\d,]+(?:\.\d+)?/gi, " ").replace(/\d*\*+\d*/g, " ").replace(/\b\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}\b/g, " ").replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ");
const amounts = (s) => [...clean(s).matchAll(AMOUNT)].map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => n > 0 && n < 1e10);
const refsOf = (s) => ({ sok: [...new Set((String(s).match(REF) || []).map((x) => x.toUpperCase()))], codes: [...new Set((String(s).toUpperCase().match(CODE) || []))] });
// → [{ raw, amounts, sok, codes, credit, debit }]  (one per line; if no line carries an amount but the whole text does, the whole text is one entry — an alert split over lines)
function parse(text, { single = false } = {}) { // single: the text is ONE message (a forwarded alert), even if it wraps over several lines
  const t = String(text || "").slice(0, 200000), lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), mk = (raw) => ({ raw: raw.slice(0, 300), amounts: amounts(raw), ...refsOf(raw), credit: CREDIT.test(raw), debit: DEBIT.test(raw) });
  if (single) { const one = mk(lines.join(" ")); return one.amounts.length && (one.sok.length || one.codes.length) ? [one] : []; }
  let out = lines.map(mk).filter((e) => e.amounts.length && (e.sok.length || e.codes.length || e.credit));
  if (!out.length) { const one = mk(lines.join(" ")); if (one.amounts.length && (one.sok.length || one.codes.length)) out = [one]; }
  return out;
}
// orders: the waiting bank-transfer orders. wireMatches(wire, {amount, currency}) → { ok, error }. Returns one result per entry.
function match(entries, orders, wireMatches, { requireCredit = false, cap = Infinity } = {}) {
  const results = [], claimed = new Set();
  for (const e of entries) {
    const r = { raw: e.raw, status: "no_match", orderId: null, reason: "" };
    if (e.debit && !e.credit) { r.reason = "looks like money going out, ignored"; results.push(r); continue; }
    if (requireCredit && !e.credit) { r.reason = "doesn't say money was received, ignored"; results.push(r); continue; }
    const cands = orders.filter((o) => e.sok.includes(o.wire.reference) || (o.codes || []).some((c) => e.codes.includes(c)));
    if (!cands.length) { r.reason = "no waiting order has this reference or M-Pesa code"; results.push(r); continue; }
    if (cands.length > 1) { r.status = "ambiguous"; r.reason = "more than one waiting order fits — confirm by hand"; results.push(r); continue; }
    const o = cands[0]; r.orderId = o.id;
    if (claimed.has(o.id)) { r.status = "duplicate"; r.reason = "same order already matched by an earlier line"; results.push(r); continue; }
    const hit = e.amounts.map((a) => ({ a, m: wireMatches(o.wire, { amount: a, currency: o.wire.currency }) })).find((x) => x.m.ok && x.a <= o.wire.amount * 1.05 + 1); // enough, and not wildly more (that is a different payment — a person looks)
    if (!hit) { r.status = "needs_review"; r.reason = `the amount doesn't match what was expected (${o.wire.currency} ${o.wire.amount})`; results.push(r); continue; }
    if (hit.a > cap) { r.status = "needs_review"; r.reason = `above the automatic limit (${cap}) — confirm by hand`; results.push(r); continue; }
    claimed.add(o.id); r.status = "confirm"; r.amount = hit.a; results.push(r);
  }
  return results;
}
module.exports = { parse, match, refsOf, amounts };
