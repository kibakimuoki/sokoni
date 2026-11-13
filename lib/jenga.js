// Equity Bank — Jenga / Finserve API (docs: developer.jengahq.io). Built from the official documentation:
//   • M-Pesa PIN prompt with REAL-TIME settlement into your Equity account, confirmed by a callback to a secret address
//   • a second opinion on any payment (transaction details), and payouts to M-Pesa wallets (opt-in)
// Every request carries a Bearer token AND a signature: the request's key fields joined in a documented order, signed with YOUR private key
// (SHA-256 with RSA, Base64). The matching public key is uploaded once to the Jenga console. Zero dependencies.
const crypto = require("crypto"); const { hmac } = require("./auth");
const env = () => (process.env.JENGA_ENV === "production" ? "production" : "sandbox");
const base = () => (env() === "production" ? "https://api.finserve.africa" : "https://uat.finserve.africa");
const privateKey = () => String(process.env.JENGA_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
const isConfigured = () => !!(process.env.JENGA_MERCHANT_CODE && process.env.JENGA_CONSUMER_SECRET && process.env.JENGA_API_KEY && process.env.JENGA_ACCOUNT_NUMBER && privateKey());
// Equity's documented limits for ONE transfer to an M-Pesa wallet (their errors 105111 / 105112); PesaLink to a bank account has its own, higher ceiling.
const MOBILE_MIN = 100, MOBILE_MAX = 140000, PESALINK_MAX = () => Number(process.env.JENGA_PESALINK_MAX || 999999);
const acct = () => String(process.env.JENGA_ACCOUNT_NUMBER || "").trim();
// Safety breaker: if Equity keeps rejecting us for a SYSTEMIC reason (bad signature, credentials), stop sending for 30 minutes instead of failing every order; money stays safely held and is retried.
const breaker = { fails: 0, until: 0, reason: "" }, SYSTEMIC = /signature|not authorized|credentials|api key|consumer secret|merchant code|public key|hasn't switched/i;
const noteResult = (ok, msg) => { if (ok) { breaker.fails = 0; return; } if (SYSTEMIC.test(String(msg))) { breaker.fails++; if (breaker.fails >= 3) { breaker.until = Date.now() + 30 * 60000; breaker.reason = String(msg).slice(0, 220); breaker.fails = 0; } } };
const paused = () => (Date.now() < breaker.until ? { reason: breaker.reason, until: new Date(breaker.until).toISOString() } : null);
const resetBreaker = () => { breaker.fails = 0; breaker.until = 0; breaker.reason = ""; };
// Paying people out is automatic in PRODUCTION (set JENGA_PAYOUTS=0 to stop it) and OFF in the sandbox (Equity only lets you test M-Pesa payouts live; set JENGA_PAYOUTS=1 to try anyway).
const payoutsOn = () => isConfigured() && !paused() && (process.env.JENGA_PAYOUTS === "1" || (env() === "production" && process.env.JENGA_PAYOUTS !== "0"));
const accountName = () => process.env.JENGA_ACCOUNT_NAME || "Sokoni";
// Bank-transfer details for buyers are derived from your Equity account, so the account number is the ONLY thing to plug in.
const wireAccount = () => ({ accountName: accountName(), bankName: "Equity Bank (Kenya) Limited", accountNumber: acct(), swift: "EQBLKENA", bankCode: "68", routing: "", bankAddress: process.env.WIRE_BANK_ADDRESS || "", instructions: process.env.WIRE_INSTRUCTIONS || "" });
const ymd = (daysBack = 0) => new Date(Date.now() + 3 * 3600e3 - daysBack * 86400e3).toISOString().slice(0, 10); // Kenya date
const msisdn = (p) => { let d = String(p || "").replace(/\D/g, ""); if (d.startsWith("0")) d = "254" + d.slice(1); else if (d.length === 9 && /^[17]/.test(d)) d = "254" + d; return d; };
const money = (n) => Number(n).toFixed(2);
function sign(text) { const k = privateKey(); if (!k) throw new Error("No signing key yet — generate one in Operations → Payment setup → Equity Bank."); return crypto.createSign("RSA-SHA256").update(String(text)).sign(k, "base64"); }
function generateKeys() { const { publicKey, privateKey: pk } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } }); return { publicKey, privateKey: pk }; }
function publicKeyOf(pem) { return crypto.createPublicKey(pem || privateKey()).export({ type: "spki", format: "pem" }); }
// a short payment reference (the prompt API allows 6 letters/digits) that has never been used before
function newRef(used) { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; for (let i = 0; i < 50; i++) { let r = ""; for (let j = 0; j < 6; j++) r += A[crypto.randomInt(A.length)]; if (!used(r)) return r; } throw new Error("Couldn't make a unique payment reference."); }
// plain-language version of Equity's error codes
function friendly(d, status) {
  const code = String((d && (d.code != null ? d.code : d.error_code)) || ""), msg = String((d && (d.message || d.error || d.error_description)) || "");
  if (code === "106401" || code === "401101" || /not authorized to access/i.test(msg)) return `Equity hasn't switched this service on for your merchant account yet (${msg || code}). Ask Finserve support (support@finserve.africa) to activate the PIN prompt for that mobile network on your merchant code.`;
  if (/^9001(00|01|02)$/.test(code) || /signature/i.test(msg)) return "Equity rejected the request signature. Upload the public key shown in Operations → Payment setup → Equity Bank to the Jenga console (API Keys), then try again.";
  if (status === 401 || /credentials|api key|consumer secret|merchant code/i.test(msg)) return "Equity rejected the merchant code, consumer secret or API key" + (msg ? ` (${msg})` : "") + ".";
  if (code === "400101") return "That payment reference was already used — please try again.";
  return msg || `Equity returned an error (HTTP ${status}).`;
}
let cache = null;
async function token(force) {
  const key = [env(), process.env.JENGA_MERCHANT_CODE, process.env.JENGA_API_KEY].join("|"); if (!force && cache && cache.key === key && cache.exp > Date.now()) return cache.v;
  const r = await fetch(base() + "/authentication/api/v3/authenticate/merchant", { method: "POST", headers: { "Content-Type": "application/json", "Api-Key": process.env.JENGA_API_KEY || "" }, body: JSON.stringify({ merchantCode: process.env.JENGA_MERCHANT_CODE, consumerSecret: process.env.JENGA_CONSUMER_SECRET }) });
  const d = await r.json().catch(() => ({})), t = d.accessToken || d.access_token; if (!r.ok || !t) throw new Error(friendly(d, r.status));
  const ttl = Number(d.expiresIn || d.expires_in); cache = { key, v: t, exp: Date.now() + Math.min(isFinite(ttl) && ttl > 0 ? ttl * 1000 : 600000, 600000) - 30000 }; return t;
}
async function call(method, path, { body, signature } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await token(attempt > 0), r = await fetch(base() + path, { method, headers: { Authorization: "Bearer " + t, "Content-Type": "application/json", ...(signature ? { Signature: signature } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({})); if (r.status === 401 && attempt === 0) continue; return { r, d };
  }
}
// ---- M-Pesa PIN prompt, money settled straight into your Equity account ----
async function stkPush({ ref, amount, phone, callbackUrl, telco = "Safaricom" }) {
  const acc = process.env.JENGA_ACCOUNT_NUMBER, amt = money(amount), body = { merchant: { accountNumber: acc, countryCode: "KE", name: accountName() }, payment: { ref, amount: amt, currency: "KES", telco, mobileNumber: phone, date: ymd(), callBackUrl: callbackUrl, pushType: "STK" } };
  const { r, d } = await call("POST", "/v3-apis/payment-api/v3.0/stkussdpush/initiate", { body, signature: sign(acc + ref + phone + telco + amt + "KES") });
  if (r.ok && d.status === true) return { ok: true, reference: d.reference || ref, message: d.message || "" }; throw new Error(friendly(d, r.status));
}
// a second opinion on a payment: state 2 = success, 1 = failed, -1 = still waiting for the callback
async function transactionDetails(ref) {
  const { r, d } = await call("GET", "/v3-apis/transaction-api/v3.0/transactions/details/" + encodeURIComponent(ref), { signature: sign(ref) });
  if (r.ok && d.status === true && d.data) return { ok: true, state: Number(d.data.stateCode), amount: Number(d.data.amount), reference: d.data.transactionReference }; return { ok: false, notFound: String(d.code) === "111102", error: friendly(d, r.status) };
}
// ---- payouts to M-Pesa wallets (OFF unless JENGA_PAYOUTS=1) ----
async function sendMobile({ reference, amount, phone, name, description, callbackUrl }) {
  const acc = process.env.JENGA_ACCOUNT_NUMBER, amt = money(amount), body = { source: { countryCode: "KE", name: accountName(), accountNumber: acc }, destination: { type: "mobile", countryCode: "KE", name: name || "Sokoni user", mobileNumber: phone, walletName: "Mpesa" }, transfer: { type: "MobileWallet", amount: amt, currencyCode: "KES", reference, date: ymd(), description: description || "Sokoni payout", callbackUrl } };
  const { r, d } = await call("POST", "/v3-apis/transaction-api/v3.0/remittance/sendmobile", { body, signature: sign(amt + "KES" + reference + acc) });
  if (r.ok && d.status === true) { noteResult(true); balCache = null; return { ok: true, transactionId: d.transactionId || reference }; } const msg = friendly(d, r.status); noteResult(false, msg); throw new Error(msg);
}
// ---- payouts to a BANK account in Kenya over PesaLink (instant; the answer comes back immediately) ----
async function sendPesalink({ reference, amount, name, bankCode, accountNumber, description }) {
  const acc = acct(), amt = money(amount), body = { source: { countryCode: "KE", name: accountName(), accountNumber: acc }, destination: { type: "bank", countryCode: "KE", name: String(name || "Sokoni user").slice(0, 60), bankCode: String(bankCode), accountNumber: String(accountNumber) }, transfer: { type: "PesaLink", amount: amt, currencyCode: "KES", reference, date: ymd(), description: String(description || "Sokoni payout").slice(0, 60) } };
  const { r, d } = await call("POST", "/v3-apis/transaction-api/v3.0/remittance/pesalinkacc", { body, signature: sign(amt + "KES" + reference + body.destination.name + acc) });
  if (r.ok && d.status === true) { noteResult(true); balCache = null; return { ok: true, transactionId: (d.data && d.data.transactionId) || reference, done: String((d.data && d.data.status) || "").toUpperCase() === "SUCCESS" }; } const msg = friendly(d, r.status); noteResult(false, msg); throw new Error(msg);
}
// ---- your account, read-only: the balance (so we never promise a payout the account can't cover) and the statement (so bank transfers confirm themselves) ----
let balCache = null;
async function balance(force) {
  if (!force && balCache && Date.now() - balCache.at < 45000) return balCache.v; const acc = acct(); if (!acc) return { ok: false, error: "No Equity account number yet." };
  const { r, d } = await call("GET", `/v3-apis/account-api/v3.0/accounts/balances/KE/${encodeURIComponent(acc)}`, { signature: sign("KE" + acc) }); let v;
  if (r.ok && d.status === true && d.data) { const bs = d.data.balances || [], pick = (t) => { const x = bs.find((y) => String(y.type).toLowerCase() === t); return x ? Number(String(x.amount).replace(/,/g, "")) : NaN; }, av = pick("available"), cu = pick("current"); v = { ok: true, currency: d.data.currency || "KES", available: isFinite(av) ? av : cu, current: cu }; } else v = { ok: false, error: friendly(d, r.status) };
  balCache = { at: Date.now(), v }; return v;
}
async function ensureFunds(amount) { const b = await balance().catch(() => null); if (b && b.ok && isFinite(b.available) && b.available < Number(amount) + Number(process.env.JENGA_FLOAT_BUFFER || 0)) throw new Error(`Insufficient funds in the Equity account (available ${b.currency} ${b.available.toFixed(2)}).`); }
const normTxn = (t) => ({ id: [t.transactionId, t.reference, t.serial].map((x) => String(x == null ? "" : x)).join("|"), reference: String(t.reference || ""), description: String(t.description || ""), amount: Number(String(t.amount).replace(/,/g, "")), type: String(t.type || "").toLowerCase() === "credit" ? "credit" : "debit", at: String(t.postedDateTime || t.date || "") });
async function fullStatement({ from, to, limit = 300 }) {
  const acc = acct(), body = { countryCode: "KE", accountNumber: acc, fromDate: from, toDate: to, limit };
  const { r, d } = await call("POST", "/v3-apis/account-api/v3.0/accounts/fullStatement", { body, signature: sign(acc + "KE" + to) });
  if (r.ok && d.status === true && d.data) return { ok: true, currency: d.data.currency || "KES", balance: Number(d.data.balance), transactions: (d.data.transactions || []).map(normTxn) }; return { ok: false, error: friendly(d, r.status) };
}
// ---- what Equity posts back ----
// STK callback codes: 0 pending · 1 failed · 2 paid, awaiting third-party settlement · 3 PAID AND CREDITED · 4 paid but not yet credited to you · 5/6 cancelled · 7 rejected
function parseStk(b) { b = b || {}; const ref = String(b.transactionReference || "").trim(); if (!ref) return null; return { ref, code: Number(b.code), ok: b.status !== false, telcoRef: String(b.telcoReference || ""), phone: String(b.mobileNumber || ""), amount: Number(b.requestAmount != null ? b.requestAmount : b.debitedAmount), message: String(b.message || "") }; }
function parsePayout(b) { b = b || {}; const d = b.data || {}, ref = String(b.transactionReference || d.Reference || d.ThirdPartyTranID || "").trim(); if (!ref) return null; const ok = b.status !== false && String(b.code) === "0" && (d.ResponseCode == null || String(d.ResponseCode) === "0"); return { ref, ok, message: String(d.ResponseDescription || b.message || "") }; }
// logging in needs only the three credentials — NOT the account number — so you can prove them the day Equity sends them, before the account exists
async function testLogin() {
  const need = [["JENGA_MERCHANT_CODE", "merchant code"], ["JENGA_CONSUMER_SECRET", "consumer secret"], ["JENGA_API_KEY", "API key"]].filter(([k]) => !process.env[k]).map((x) => x[1]); if (need.length) return { ok: false, error: "Still needs: " + need.join(", ") + "." };
  await token(true); return { ok: true, detail: `Equity accepted your merchant code, consumer secret and API key (${env() === "production" ? "live" : "sandbox"}).` };
}
async function testConnection() {
  const need = [["JENGA_MERCHANT_CODE", "merchant code"], ["JENGA_CONSUMER_SECRET", "consumer secret"], ["JENGA_API_KEY", "API key"], ["JENGA_ACCOUNT_NUMBER", "Equity account number to credit"]].filter(([k]) => !process.env[k]).map((x) => x[1]); if (!privateKey()) need.push("signing key (press “Generate signing keys”)");
  if (need.length) return { ok: false, error: "Not set up — still needs: " + need.join(", ") + "." };
  await token(true); let fp = ""; try { fp = crypto.createHash("sha256").update(publicKeyOf()).digest("hex").slice(0, 12); } catch (e) { return { ok: false, error: "The signing key isn't a valid private key." }; }
  return { ok: true, detail: `Equity accepted your merchant code, consumer secret and API key (${env() === "production" ? "live" : "sandbox"}). Your signing key fingerprint is ${fp} — the matching public key must be uploaded in the Jenga console.` };
}
// callback addresses carry a secret (Equity's callbacks aren't signed), so only Equity — who is given the address — can reach them
const urls = () => { const b = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""), t = hmac("jenga|" + (process.env.PUBLIC_BASE_URL || "")).slice(0, 24); return { token: t, stk: `${b}/api/webhooks/jenga/${t}/stk`, payout: `${b}/api/webhooks/jenga/${t}/payout` }; };
module.exports = { urls, isConfigured, payoutsOn, env, base, sign, generateKeys, publicKeyOf, newRef, msisdn, stkPush, transactionDetails, sendMobile, sendPesalink, balance, ensureFunds, fullStatement, parseStk, parsePayout, testConnection, testLogin, friendly, accountName, wireAccount, acct, ymd, paused, resetBreaker, MOBILE_MIN, MOBILE_MAX, PESALINK_MAX };
