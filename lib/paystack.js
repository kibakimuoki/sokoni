// Paystack (Kenya). Sends M-Pesa / Airtel Money PIN prompts whose money lands in YOUR Paystack balance (switch the account to "manual payouts" so it stays
// there), then pays sellers, riders and refunds out of that balance with Transfers once Sokoni says "release".
// Built from Paystack's own documentation. Nothing here can lose money by guessing: a payout is never sent twice (see sendMobile), a notification is
// never trusted on its own (the server always asks Paystack for its own record first), and a payout waits instead of failing when the balance is short.
const crypto = require("crypto");
const env = (k) => String(process.env[k] || "").trim();
const key = () => env("PAYSTACK_SECRET_KEY");
const isLive = () => /^sk_live_/.test(key());
const publicBase = () => String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const isConfigured = () => /^sk_(test|live)_[A-Za-z0-9]+$/.test(key()) && !!publicBase();
// Automatic payouts: ON by themselves with test keys; with LIVE keys they stay OFF until you set PAYSTACK_PAYOUTS to 1 after one small real payout.
const payoutsOn = () => isConfigured() && (env("PAYSTACK_PAYOUTS") === "1" || (env("PAYSTACK_PAYOUTS") === "" && !isLive()));
const OPERATORS = { mpesa: "mpesa", airtel: "atl" }; // Paystack's codes for the Kenyan networks it can prompt (Equitel and T-Kash are not offered)
const MPESA_MAX = () => Number(env("PAYSTACK_MPESA_MAX") || 150000); // Safaricom's limit for one M-Pesa payment
const MOBILE_MIN = () => Number(env("PAYSTACK_MOBILE_MIN") || 10), MOBILE_MAX = () => Number(env("PAYSTACK_MOBILE_MAX") || 250000); // one payout to an M-Pesa wallet
const urls = () => ({ webhook: publicBase() + "/api/webhooks/paystack" });
const msisdn = (p) => { let d = String(p || "").replace(/\D/g, ""); if (d.startsWith("0")) d = "254" + d.slice(1); else if (d.length === 9 && /^[17]/.test(d)) d = "254" + d; return d; };
const cents = (n) => Math.round(Number(n) * 100); // Paystack amounts are in the smallest unit
const plain = (h) => String(h || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
// Transfer references must be lowercase letters, digits, dash or underscore, 16–50 characters: one stable form for every reference we send.
const norm = (ref) => { let r = String(ref).toLowerCase().replace(/[^a-z0-9_-]/g, "-"); if (r.length < 16) r = (r + "-sokoni-payout").slice(0, 50); return r.slice(0, 44); };

function newRef(taken) { const A = "abcdefghjkmnpqrstuvwxyz23456789"; for (let n = 0; n < 20; n++) { const ref = "sok-" + Array.from(crypto.randomBytes(12), (b) => A[b % A.length]).join(""); if (!taken || !taken(ref)) return ref; } throw new Error("Couldn't make a unique payment reference."); }

async function call(method, path, body) {
  let r;
  try { r = await fetch("https://api.paystack.co" + path, { method, headers: { Authorization: "Bearer " + key(), "Content-Type": "application/json", Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) }); }
  catch (e) { const err = new Error("Couldn't reach Paystack (" + (e && e.name === "TimeoutError" ? "no answer within 20 seconds" : (e && e.message) || "network error") + ")."); err.network = true; throw err; }
  return { r, d: await r.json().catch(() => ({})) };
}
function explain(r, d) { // Paystack's own words, turned into something a person can act on
  const msg = String((d && d.message) || "").slice(0, 220);
  if (/balance.*(not enough|insufficient)|not enough|insufficient/i.test(msg)) return "There is not enough money in your Paystack balance for this payout yet (collected money settles into the balance first, usually after 2 days).";
  if (r.status === 401 || /invalid key|invalid authorization/i.test(msg)) return "Paystack rejected the secret key" + (msg ? " (" + msg + ")" : "") + ". Copy it again from Paystack → Settings → API Keys & Webhooks — test and live keys are different.";
  if (/third party payouts|transfers? (is|are) not (enabled|available)/i.test(msg)) return "Paystack hasn't switched on Transfers for this account yet (" + msg + "). Ask Paystack support to enable Transfers.";
  if (r.status === 403 || /ip.*(whitelist|not allowed)/i.test(msg)) return "Paystack refused this request: check that this server's IP address is on your IP whitelist (Settings → API Keys & Webhooks).";
  return msg || "Paystack answered HTTP " + r.status + ".";
}

// ---- collections: a PIN prompt to the buyer's phone ----
async function charge({ ref, amount, phone, provider, email }) {
  const { r, d } = await call("POST", "/charge", { email, amount: cents(amount), currency: "KES", reference: ref, mobile_money: { phone: "+" + msisdn(phone), provider }, metadata: { source: "sokoni" } });
  if (!r.ok || d.status === false) throw new Error(explain(r, d));
  const x = d.data || {}, st = String(x.status || "").toLowerCase();
  if (st === "failed") throw new Error(plain(x.message || x.display_text || d.message) || "The payment could not be started.");
  const prompt = ["pay_offline", "pending", "ongoing", "success"].includes(st); // any other status asks the buyer for an extra step (a code) that Sokoni doesn't handle
  return { status: st, otp: !prompt, message: plain(x.display_text || d.message) };
}
// Paystack's own record of a payment, by OUR reference → { paid, failed, amount, currency, id } | null (not found)
async function verifyCharge(ref) {
  const { r, d } = await call("GET", "/transaction/verify/" + encodeURIComponent(ref));
  if (r.status === 404) return null; if (!r.ok) throw new Error(explain(r, d)); const x = d.data; if (!x || typeof x !== "object") return null; const st = String(x.status || "").toLowerCase();
  return { status: st, paid: st === "success", failed: st === "failed" || st === "reversed", amount: Number(x.amount) / 100, currency: String(x.currency || "").toUpperCase(), id: x.id != null ? String(x.id) : null };
}

// ---- cards: the buyer is sent to Paystack's own page (cards only); the confirmation is checked exactly like an M-Pesa one ----
async function initialize({ ref, amount, email, callbackUrl, orderId, name }) {
  const { r, d } = await call("POST", "/transaction/initialize", { email, amount: cents(amount), currency: "KES", reference: ref, callback_url: callbackUrl, channels: ["card"], metadata: { source: "sokoni", order_id: orderId, name } });
  if (!r.ok || d.status === false || !d.data || !d.data.authorization_url) throw new Error(explain(r, d));
  return { url: d.data.authorization_url, ref, accessCode: d.data.access_code || null };
}
// Card refunds go through Paystack's refund API (M-Pesa payments cannot be refunded that way — those go back by transfer). Asking twice is harmless.
async function refundCard({ ref, amount }) {
  const { r, d } = await call("POST", "/refund", { transaction: ref, amount: cents(amount), currency: "KES", merchant_note: "Sokoni refund" });
  if (!r.ok || d.status === false) { if (/already|fully (refunded|reversed)|in progress|exists/i.test(String((d && d.message) || ""))) return { ref, done: false }; throw new Error(explain(r, d)); }
  const s = String((d.data && d.data.status) || "pending").toLowerCase(); if (s === "failed") throw new Error("Paystack could not start this refund."); return { ref, done: s === "processed" };
}

// ---- payouts: Transfers out of the balance to an M-Pesa wallet ----
async function balance() { const { r, d } = await call("GET", "/balance"); if (!r.ok) throw new Error(explain(r, d)); const o = {}; for (const b of d.data || []) o[String(b.currency).toUpperCase()] = Number(b.balance); return o; }
let telco = null; const recipients = new Map();
async function mpesaCode() { if (telco) return telco; const { r, d } = await call("GET", "/bank?currency=KES&type=mobile_money&perPage=100"); if (!r.ok) throw new Error(explain(r, d)); const x = (d.data || []).find((b) => /m-?pesa/i.test(b.name || "")); if (!x) throw new Error("Paystack didn't list M-Pesa as a payout destination for this account."); return (telco = x.code); }
async function recipientFor(phone, name) {
  const to = "0" + msisdn(phone).slice(3), hit = recipients.get(to); if (hit) return hit;
  const { r, d } = await call("POST", "/transferrecipient", { type: "mobile_money", name: String(name || "Sokoni user").slice(0, 80), account_number: to, bank_code: await mpesaCode(), currency: "KES" });
  if (!r.ok || d.status === false || !d.data || !d.data.recipient_code) throw new Error(explain(r, d)); recipients.set(to, d.data.recipient_code); return d.data.recipient_code;
}
// Paystack's rules: a reference is used once. A transfer whose status is explicitly "failed" or "reversed" may be retried under a NEW reference.
async function transferStatus(ref) { // → { status, reason } | null when Paystack has no transfer with this reference
  const { r, d } = await call("GET", "/transfer/verify/" + encodeURIComponent(ref));
  if (r.status === 404 || /not found/i.test(String((d && d.message) || ""))) return null; if (!r.ok) throw new Error(explain(r, d)); const x = d.data; if (!x || !x.status) return null;
  return { status: String(x.status).toLowerCase(), reason: x.reason || (Array.isArray(x.failures) && x.failures[0] && x.failures[0].message) || null };
}
async function sendOne(cref, { amount, phone, name, narration }) {
  const code = await recipientFor(phone, name), bal = await balance().catch(() => null); // a short balance WAITS (collected money settles first) instead of failing
  if (bal && bal.KES != null && bal.KES < cents(amount)) throw new Error("There is not enough money in your Paystack balance for this payout yet (collected money settles into the balance first, usually after 2 days).");
  const { r, d } = await call("POST", "/transfer", { source: "balance", amount: cents(amount), reference: cref, recipient: code, reason: String(narration || "Sokoni payout").slice(0, 100), currency: "KES" });
  if (!r.ok || d.status === false) {
    if (/reference.*(already|exist|used|duplicate)|duplicate/i.test(String((d && d.message) || ""))) { const st = await transferStatus(cref); if (st && st.status === "success") return { ref: cref, done: true }; if (st && !["failed", "reversed", "otp"].includes(st.status)) return { ref: cref, done: false }; }
    throw new Error(explain(r, d));
  }
  const s = String((d.data && d.data.status) || "pending").toLowerCase();
  if (s === "otp") throw new Error("Paystack is waiting for a one-time code on this payout. Switch off “Confirm transfers before sending” in your Paystack dashboard (Settings → Preferences) so payouts can run automatically.");
  if (s === "failed") throw new Error("Paystack could not send this payout.");
  return { ref: cref, done: s === "success" };
}
// → { ref, done }. SAFE TO CALL AGAIN after a crash or a timeout: it first asks Paystack whether this reference already exists, so the same money is never sent twice.
async function sendMobile({ ref, amount, phone, name, narration }) {
  if (!/^254\d{9}$/.test(msisdn(phone))) throw new Error("That isn't a valid Kenyan mobile number.");
  const base = norm(ref);
  for (let i = 0; i < 6; i++) {
    const cref = i === 0 ? base : `${base}-r${i}`, st = await transferStatus(cref);
    if (!st) return await sendOne(cref, { amount, phone, name, narration });
    if (st.status === "success") return { ref: cref, done: true };
    if (["failed", "reversed", "otp"].includes(st.status)) continue; // never went anywhere (or came back): a NEW reference is safe
    return { ref: cref, done: false }; // accepted and still going: never send a second one
  }
  throw new Error("Paystack has failed this payout 6 times — a person needs to look at it in your Paystack dashboard.");
}

// ---- notifications: Paystack signs the raw body with HMAC-SHA512, keyed with your SECRET key, in the header "x-paystack-signature" ----
function verifySignature(raw, header) {
  const secret = key(); if (!secret || !header) return false; const given = Buffer.from(String(header).trim().toLowerCase()), cands = [String(raw)];
  try { cands.push(JSON.stringify(JSON.parse(raw))); } catch (e) { /* not JSON: only the raw text can match */ } // some of Paystack's own examples sign JSON.stringify(body)
  for (const c of cands) { const want = Buffer.from(crypto.createHmac("sha512", secret).update(c).digest("hex")); if (want.length === given.length && crypto.timingSafeEqual(want, given)) return true; }
  return false;
}
function parseEvent(b) {
  if (!b || typeof b !== "object") return null; const ev = String(b.event || ""), d = b.data || {};
  if (ev === "charge.success" || ev === "charge.failed") return d.reference ? { kind: "charge", event: ev, ref: String(d.reference), id: d.id != null ? String(d.id) : null } : null;
  if (/^refund\.(processed|failed)$/.test(ev)) { const t = d.transaction_reference || (d.transaction && d.transaction.reference) || d.reference; return t ? { kind: "refund", event: ev, ref: String(t), reason: d.reason || d.customer_note || null } : null; }
  if (/^transfer\.(success|failed|reversed)$/.test(ev)) return d.reference ? { kind: "transfer", event: ev, ref: String(d.reference), reason: d.reason || null } : null;
  return null;
}

// "Test connection": asking for the balance proves the key; the answer also shows what is in the balance.
async function testConnection() {
  if (!isConfigured()) return { ok: false, error: "Not set up — needs the Paystack secret key (it starts sk_test_ or sk_live_) and a public PUBLIC_BASE_URL." };
  let res; try { res = await call("GET", "/balance"); } catch (e) { return { ok: false, error: e.message }; } const { r, d } = res; if (!r.ok) return { ok: false, error: explain(r, d) };
  const kes = (d.data || []).find((b) => String(b.currency).toUpperCase() === "KES");
  return { ok: true, detail: `Paystack accepted the key (${isLive() ? "LIVE — real money" : "TEST — testing only"}). KES balance: ${kes ? (Number(kes.balance) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 }) : "none yet"}. Buyers can be sent M-Pesa and Airtel Money PIN prompts; payouts go to M-Pesa wallets (${payoutsOn() ? "ON" : "OFF — switch PAYSTACK_PAYOUTS on after a small real test"}). Also check in Paystack: Preferences → turn off “Confirm transfers before sending” (otherwise payouts wait for a code), Settings → Payout schedule = manual (so money stays in your balance until Sokoni releases it), this server's IP is whitelisted, and the webhook address below is saved.` };
}

module.exports = { initialize, refundCard, isConfigured, isLive, payoutsOn, OPERATORS, MPESA_MAX, MOBILE_MIN, MOBILE_MAX, urls, msisdn, newRef, charge, verifyCharge, transferStatus, sendMobile, verifySignature, parseEvent, testConnection, balance, explain, norm };
