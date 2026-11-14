// Fincra (Kenya). Sends M-Pesa / Airtel Money / Equitel PIN prompts whose money lands in YOUR Fincra wallet, and pays M-Pesa wallets out of it.
// Built from Fincra's public documentation (docs.fincra.com). The few things the documents did not make certain are listed under
// "Check these in the Fincra sandbox" in PAYMENTS-SETUP.md — nothing here is a guess that could lose money: payouts are never sent twice
// (see sendMobile), and a notification is never trusted on its own (the server always asks Fincra for its own record first).
const crypto = require("crypto");
const env = (k) => String(process.env[k] || "").trim();
const isLive = () => /^(live|production)$/i.test(env("FINCRA_ENV"));
const base = () => (isLive() ? "https://api.fincra.com" : "https://sandboxapi.fincra.com");
const publicBase = () => String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const isConfigured = () => !!(env("FINCRA_API_KEY") && env("FINCRA_BUSINESS_ID") && env("FINCRA_WEBHOOK_SECRET") && publicBase());
// Automatic payouts: ON by themselves in the sandbox; with real money they stay OFF until you switch FINCRA_PAYOUTS on after a small real test.
const payoutsOn = () => isConfigured() && (env("FINCRA_PAYOUTS") === "1" || (env("FINCRA_PAYOUTS") === "" && !isLive()));
const OPERATORS = { mpesa: "SAFARICOM", airtel: "AIRTEL", equitel: "EQUITEL" }; // the networks Fincra can send a PIN prompt to in Kenya (T-Kash is not offered)
const MOBILE_MIN = () => Number(env("FINCRA_MOBILE_MIN") || 10), MOBILE_MAX = () => Number(env("FINCRA_MOBILE_MAX") || 250000);
const urls = () => ({ webhook: publicBase() + "/api/webhooks/fincra" });
const msisdn = (p) => { let d = String(p || "").replace(/\D/g, ""); if (d.startsWith("0")) d = "254" + d.slice(1); else if (d.length === 9 && /^[17]/.test(d)) d = "254" + d; return d; };
const plain = (h) => String(h || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

function newRef(taken) { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; for (let n = 0; n < 20; n++) { const ref = "SOKF-" + Array.from(crypto.randomBytes(10), (b) => A[b % A.length]).join(""); if (!taken || !taken(ref)) return ref; } throw new Error("Couldn't make a unique payment reference."); }

async function call(method, path, body) {
  let r;
  try { r = await fetch(base() + path, { method, headers: { "api-key": env("FINCRA_API_KEY"), "x-business-id": env("FINCRA_BUSINESS_ID"), "Content-Type": "application/json", Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) }); }
  catch (e) { const err = new Error("Couldn't reach Fincra (" + (e && e.name === "TimeoutError" ? "no answer within 20 seconds" : (e && e.message) || "network error") + ")."); err.network = true; throw err; }
  return { r, d: await r.json().catch(() => ({})) };
}
// Fincra's own words, turned into something a person can act on.
function explain(r, d) {
  const msg = String((d && (d.message || d.error || (d.errors && JSON.stringify(d.errors)))) || "").slice(0, 220), code = String((d && (d.errorType || d.error_type || d.code)) || "");
  if (/NO_ENOUGH_MONEY|enough money/i.test(code + " " + msg)) return "There is not enough money in your Fincra wallet for this payout yet (collected money settles first).";
  if (r.status === 401 || (r.status < 500 && r.status !== 404 && /invalid authentication|no api key|api key/i.test(msg))) return "Fincra rejected the API key or Business ID" + (msg ? " (" + msg + ")" : "") + ". Copy them again from Fincra → Settings → API — sandbox and live keys are different.";
  if (r.status === 403) return "Fincra refused this request. Check the API key and Business ID, and that this server's IP address is whitelisted in Fincra → Settings → API.";
  if (/business/i.test(msg) && /required|must/i.test(msg)) return "Fincra says the Business ID is missing or wrong: " + msg;
  return msg || "Fincra answered HTTP " + r.status + ".";
}

// ---- collections: a PIN prompt to the buyer's phone ----
async function charge({ ref, amount, phone, operator, name, email }) {
  const { r, d } = await call("POST", "/checkout/charges", { type: "mobile_money", amount: Number(amount), reference: ref, currency: "KES", customer: { name: String(name || "Sokoni buyer").slice(0, 80), email }, phone: "+" + msisdn(phone), operator, description: "Sokoni order", settlementDestination: "wallet", webhookUrl: urls().webhook });
  if (!r.ok || d.status === false || d.success === false) throw new Error(explain(r, d));
  const x = d.data || {}, mode = String(x.auth_model || (x.authorization && x.authorization.mode) || "").toUpperCase();
  return { id: x.id != null ? String(x.id) : null, status: String(x.status || "pending").toLowerCase(), otp: mode === "OTP", message: plain(x.message) };
}
// Fincra's own record of a charge, by OUR reference → { paid, failed, amount, currency, id } | null (not found)
async function verifyCharge(ref) {
  const { r, d } = await call("GET", "/checkout/charges/merchant-reference/" + encodeURIComponent(ref));
  if (r.status === 404) return null; if (!r.ok) throw new Error(explain(r, d)); const x = d.data; if (!x || typeof x !== "object") return null; const st = String(x.status || "").toLowerCase();
  return { status: st, paid: /^(success|successful|completed)$/.test(st), failed: /^(failed|declined|expired|cancelled|canceled)$/.test(st), amount: Number(x.amount), currency: String(x.currency || "").toUpperCase(), id: x.id != null ? String(x.id) : null };
}

// ---- payouts to M-Pesa wallets ----
// Fincra's rules: a customer reference may never be reused; only a payout whose status is EXPLICITLY "failed" may be retried; any other status means "still going / done".
async function payoutStatus(cref) { // → { status, reason } | null when Fincra has no payout with this reference
  const { r, d } = await call("GET", "/disbursements/payouts/customer-reference/" + encodeURIComponent(cref));
  if (r.status === 404 || /RESOURCE_NOT_FOUND|not found/i.test(String((d && (d.errorType || d.message)) || ""))) return null;
  if (!r.ok) throw new Error(explain(r, d)); const x = d.data || d; if (!x || !x.status) return null;
  return { status: String(x.status).toLowerCase(), reason: x.reason || x.message || null };
}
async function sendOne(cref, { amount, to, name, narration }) {
  const parts = String(name || "Sokoni user").trim().split(/\s+/), first = parts[0].slice(0, 40), last = (parts.slice(1).join(" ") || first).slice(0, 60), amt = String(Number(Number(amount).toFixed(2)));
  const { r, d } = await call("POST", "/disbursements/payouts", { business: env("FINCRA_BUSINESS_ID"), sourceCurrency: "KES", destinationCurrency: "KES", amount: amt, description: String(narration || "Sokoni payout").slice(0, 100), paymentDestination: "mobile_money_wallet", customerReference: cref,
    beneficiary: { firstName: first, lastName: last, accountHolderName: (first + " " + last).slice(0, 100), country: "KE", phone: to, mobileMoneyCode: "SAFARICOM", accountNumber: to, type: "individual" }, ...(env("FINCRA_SENDER_NAME") ? { sender: { name: env("FINCRA_SENDER_NAME") } } : {}) });
  if (!r.ok || d.success === false) {
    if (/DUPLICATE_CUSTOMER_REFERENCE/i.test(String((d && (d.errorType || d.message)) || ""))) { const st = await payoutStatus(cref); if (st && st.status === "successful") return { ref: cref, done: true }; if (st && st.status !== "failed") return { ref: cref, done: false }; }
    throw new Error(explain(r, d));
  }
  const s = String((d.data && d.data.status) || "processing").toLowerCase(); if (s === "failed") throw new Error("Fincra could not send this payout" + ((d.data && d.data.reason) ? ": " + d.data.reason : "") + ".");
  return { ref: cref, done: s === "successful" };
}
// → { ref, done }. SAFE TO CALL AGAIN after a crash or a timeout: it first asks Fincra whether this reference already exists, so the same money is never sent twice.
async function sendMobile({ ref, amount, phone, name, narration }) {
  const to = msisdn(phone); if (!/^254\d{9}$/.test(to)) throw new Error("That isn't a valid Kenyan mobile number.");
  for (let i = 0; i < 6; i++) {
    const cref = i === 0 ? ref : `${ref}-r${i}`, st = await payoutStatus(cref);
    if (!st) return await sendOne(cref, { amount, to, name, narration });
    if (st.status === "successful") return { ref: cref, done: true };
    if (st.status === "failed") continue; // only an explicit "failed" may be retried — with a NEW reference
    return { ref: cref, done: false }; // accepted and still going: never send a second one
  }
  throw new Error("Fincra has failed this payout 6 times — a person needs to look at it in your Fincra dashboard.");
}

// ---- notifications: Fincra signs every one with an HMAC-SHA512 of the body, keyed with your webhook secret, in the header "signature" ----
function verifySignature(raw, header) {
  const secret = env("FINCRA_WEBHOOK_SECRET"); if (!secret || !header) return false; const given = Buffer.from(String(header).trim().toLowerCase()), cands = [String(raw)];
  try { cands.push(JSON.stringify(JSON.parse(raw))); } catch (e) { /* not JSON: only the raw text can match */ } // Fincra's own examples sign JSON.stringify(payload), so accept that form too
  for (const c of cands) { const want = Buffer.from(crypto.createHmac("sha512", secret).update(c).digest("hex")); if (want.length === given.length && crypto.timingSafeEqual(want, given)) return true; }
  return false;
}
function parseEvent(b) {
  if (!b || typeof b !== "object") return null; const ev = String(b.event || ""), d = b.data || {};
  if (/^charge\./.test(ev)) return d.reference ? { kind: "charge", event: ev, ref: String(d.reference), id: d.id != null ? String(d.id) : null } : null;
  if (/^payout\./.test(ev)) return d.customerReference ? { kind: "payout", event: ev, ref: String(d.customerReference), reason: d.reason || null } : null;
  return null;
}

// "Test connection": a harmless look-up. A wrong key or Business ID is refused (401/403); a right one answers "not found" for a reference that doesn't exist.
async function testConnection() {
  if (!isConfigured()) return { ok: false, error: "Not set up — needs FINCRA_API_KEY, FINCRA_BUSINESS_ID, FINCRA_WEBHOOK_SECRET and a public PUBLIC_BASE_URL." };
  let res; try { res = await call("GET", "/disbursements/payouts/customer-reference/SOKONI-CONNECTION-TEST"); } catch (e) { return { ok: false, error: e.message }; }
  const { r, d } = res; if (r.status === 401 || r.status === 403 || (r.status >= 400 && r.status !== 404 && !/not found/i.test(String((d && (d.errorType || d.message)) || "")))) return { ok: false, error: explain(r, d) };
  return { ok: true, detail: `Fincra accepted the key and Business ID (${isLive() ? "live — real money" : "sandbox — testing only"}). Buyers can be sent M-Pesa, Airtel Money and Equitel PIN prompts; payouts go to M-Pesa wallets (${payoutsOn() ? "ON" : "OFF — switch FINCRA_PAYOUTS on after a small real test"}). Also check: this server's IP address is whitelisted in Fincra, and the webhook address below is registered.` };
}

module.exports = { isConfigured, isLive, payoutsOn, OPERATORS, MOBILE_MIN, MOBILE_MAX, urls, msisdn, newRef, charge, verifyCharge, payoutStatus, sendMobile, verifySignature, parseEvent, testConnection, explain };
