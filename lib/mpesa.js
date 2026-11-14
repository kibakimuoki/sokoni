// M-Pesa Daraja API integration (Safaricom). Docs: https://developer.safaricom.co.ke/APIs
// Needs: Daraja account, shortcode, env vars below, and a PUBLIC HTTPS callback URL.
// NOT tested against Safaricom's live API (no internet where this was built) — test in sandbox first.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// read at call time, so switching sandbox → production in Operations → Payment setup takes effect immediately (no restart)
const env = () => process.env.MPESA_ENV || "sandbox";
const baseUrl = () => (env() === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke");

function isConfigured() {
  return Boolean(process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET && process.env.MPESA_SHORTCODE && process.env.MPESA_PASSKEY && process.env.MPESA_CALLBACK_BASE_URL);
}
function isPayoutConfigured() {
  return Boolean(isConfigured() && process.env.MPESA_INITIATOR_NAME && process.env.MPESA_INITIATOR_PASSWORD && process.env.MPESA_CERT_PATH);
}
function assertConfigured() {
  if (!isConfigured()) {
    const err = new Error("M-Pesa isn't configured on this server yet — see README.md.");
    err.code = "MPESA_NOT_CONFIGURED";
    throw err;
  }
}
function normalizeMsisdn(phone) {
  let p = String(phone).replace(/\s+/g, "").replace(/^\+/, "");
  if (p.startsWith("0")) p = "254" + p.slice(1);
  if (p.startsWith("7") || p.startsWith("1")) p = "254" + p;
  return p;
}
function timestampNow() {
  const d = new Date(); const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear().toString() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

let cachedToken = null;
async function getAccessToken() {
  assertConfigured();
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) return cachedToken.token;
  const creds = Buffer.from(process.env.MPESA_CONSUMER_KEY + ":" + process.env.MPESA_CONSUMER_SECRET).toString("base64");
  const res = await fetch(baseUrl() + "/oauth/v1/generate?grant_type=client_credentials", { headers: { Authorization: "Basic " + creds } });
  if (!res.ok) throw new Error("Failed to authenticate with M-Pesa (check consumer key/secret).");
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3599) * 1000 };
  return cachedToken.token;
}

async function stkPush({ phone, amount, accountReference, transactionDesc }) {
  assertConfigured();
  const token = await getAccessToken();
  const shortcode = process.env.MPESA_SHORTCODE, passkey = process.env.MPESA_PASSKEY, buyGoods = process.env.MPESA_TRANSACTION_TYPE === "CustomerBuyGoodsOnline"; // Paybill (default) vs Till / Buy Goods
  const timestamp = timestampNow();
  const password = Buffer.from(shortcode + passkey + timestamp).toString("base64");
  const msisdn = normalizeMsisdn(phone);
  const res = await fetch(baseUrl() + "/mpesa/stkpush/v1/processrequest", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      BusinessShortCode: shortcode, Password: password, Timestamp: timestamp,
      TransactionType: buyGoods ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline", Amount: Math.round(amount),
      PartyA: msisdn, PartyB: buyGoods ? (process.env.MPESA_TILL_NUMBER || shortcode) : shortcode, PhoneNumber: msisdn,
      CallBackURL: process.env.MPESA_CALLBACK_BASE_URL.replace(/\/$/, "") + "/api/mpesa/stk-callback",
      AccountReference: String(accountReference).slice(0, 12),
      TransactionDesc: String(transactionDesc || "Sokoni order").slice(0, 13),
    }),
  });
  const data = await res.json();
  if (data.ResponseCode !== "0") throw new Error(data.errorMessage || data.ResponseDescription || "M-Pesa declined the payment request.");
  return { checkoutRequestId: data.CheckoutRequestID, merchantRequestId: data.MerchantRequestID };
}

function parseStkCallback(body) {
  const cb = body && body.Body && body.Body.stkCallback;
  if (!cb) return null;
  const result = { checkoutRequestId: cb.CheckoutRequestID, merchantRequestId: cb.MerchantRequestID, resultCode: cb.ResultCode, resultDesc: cb.ResultDesc, success: cb.ResultCode === 0 };
  if (result.success && cb.CallbackMetadata) {
    for (const item of cb.CallbackMetadata.Item || []) {
      if (item.Name === "Amount") result.amount = item.Value;
      if (item.Name === "MpesaReceiptNumber") result.mpesaReceiptNumber = item.Value;
      if (item.Name === "PhoneNumber") result.phoneNumber = item.Value;
      if (item.Name === "TransactionDate") result.transactionDate = item.Value;
    }
  }
  return result;
}

function generateSecurityCredential() {
  const certPath = process.env.MPESA_CERT_PATH;
  if (!certPath || !fs.existsSync(certPath)) throw new Error("MPESA_CERT_PATH must point at Safaricom's public certificate file — see README.md.");
  const cert = fs.readFileSync(path.resolve(certPath), "utf8");
  return crypto.publicEncrypt({ key: cert, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(process.env.MPESA_INITIATOR_PASSWORD, "utf8")).toString("base64");
}

async function b2cPayout({ phone, amount, remarks, occasion }) {
  if (!isPayoutConfigured()) {
    const err = new Error("Payouts aren't fully configured yet — see README.md.");
    err.code = "MPESA_PAYOUT_NOT_CONFIGURED";
    throw err;
  }
  const token = await getAccessToken();
  const securityCredential = generateSecurityCredential();
  const shortcode = process.env.MPESA_B2C_SHORTCODE || process.env.MPESA_SHORTCODE;
  const base = process.env.MPESA_CALLBACK_BASE_URL.replace(/\/$/, "");
  const res = await fetch(baseUrl() + "/mpesa/b2c/v1/paymentrequest", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      InitiatorName: process.env.MPESA_INITIATOR_NAME, SecurityCredential: securityCredential,
      CommandID: "BusinessPayment", Amount: Math.round(amount), PartyA: shortcode, PartyB: normalizeMsisdn(phone),
      Remarks: String(remarks || "Sokoni payout").slice(0, 100),
      QueueTimeOutURL: base + "/api/mpesa/b2c-timeout", ResultURL: base + "/api/mpesa/b2c-callback",
      Occasion: String(occasion || "").slice(0, 100),
    }),
  });
  const data = await res.json();
  if (data.ResponseCode && data.ResponseCode !== "0") throw new Error(data.errorMessage || data.ResponseDescription || "M-Pesa declined the payout request.");
  return { conversationId: data.ConversationID };
}

async function checkCredentials() { await getAccessToken(); return { ok: true, env: env() }; }

// ---- Paybill, the customer pays by themselves (C2B): the confirmation Safaricom sends us is the ONLY thing that proves a payment ----
async function registerC2B({ confirmationUrl, validationUrl }) {
  assertConfigured(); const token = await getAccessToken(), v = process.env.MPESA_C2B_VERSION || "v2";
  const r = await fetch(`${baseUrl()}/mpesa/c2b/${v}/registerurl`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ShortCode: process.env.MPESA_SHORTCODE, ResponseType: "Completed", ConfirmationURL: confirmationUrl, ValidationURL: validationUrl }) });
  const d = await r.json().catch(() => ({})); const ok = r.ok && String(d.ResponseCode) === "0"; return { ok, detail: ok ? d.ResponseDescription || "Registered" : d.errorMessage || d.ResponseDescription || "Safaricom refused the registration" };
}
async function simulateC2B({ amount, billRef }) { // sandbox only: pretend a customer paid at the Paybill
  if (env() === "production") throw new Error("Simulation only works in the sandbox."); assertConfigured(); const token = await getAccessToken();
  const r = await fetch(`${baseUrl()}/mpesa/c2b/v1/simulate`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ShortCode: process.env.MPESA_SHORTCODE, CommandID: "CustomerPayBillOnline", Amount: Math.round(Number(amount)), Msisdn: "254708374149", BillRefNumber: String(billRef) }) });
  const d = await r.json().catch(() => ({})); return { ok: r.ok && String(d.ResponseCode) === "0", detail: d.ResponseDescription || d.errorMessage || "" };
}
function parseC2B(b) { b = b || {}; return { transId: String(b.TransID || "").trim().toUpperCase(), amount: Number(b.TransAmount), billRef: String(b.BillRefNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, ""), msisdn: String(b.MSISDN || ""), shortCode: String(b.BusinessShortCode || ""), time: String(b.TransTime || ""), name: [b.FirstName, b.LastName].filter(Boolean).join(" ") }; }
// Safaricom sends the payer's number masked, hashed (v2) or plain — compare whichever form we got
function msisdnMatches(rec, phone) {
  const p = normalizeMsisdn(phone), r = String(rec || ""); if (!r || !p) return false;
  if (/^[a-f0-9]{64}$/i.test(r)) return crypto.createHash("sha256").update(p).digest("hex") === r.toLowerCase();
  const d = r.replace(/[^0-9*]/g, ""); if (!d || d.length !== p.length) return false; for (let i = 0; i < p.length; i++) if (d[i] !== "*" && d[i] !== p[i]) return false; return true;
}
module.exports = { registerC2B, simulateC2B, parseC2B, msisdnMatches, checkCredentials, isConfigured, isPayoutConfigured, stkPush, parseStkCallback, b2cPayout, normalizeMsisdn };
