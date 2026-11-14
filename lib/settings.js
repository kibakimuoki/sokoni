// Payment credentials & bank details entered in Operations → Payment setup. Secrets are encrypted at rest (AES-256-GCM, key derived from SERVER_SECRET),
// are never sent back to the browser (only a masked preview) and are applied to the running server immediately. Values saved here override the same
// variable set in the host environment; "Clear" in the console falls back to the environment again.
const crypto = require("crypto"); const store = require("./store");
const F = (group, key, label, o = {}) => ({ group, key, label, secret: false, ...o });
const FIELDS = [
  F("ai", "ANTHROPIC_API_KEY", "AI key", { secret: true, hint: "Powers the quality reports, the price guide, delivery weight estimates and translations. Create it in your AI provider's console and set a spending limit on it." }), F("ai", "ANTHROPIC_MODEL", "AI model (leave empty to use the default)"), F("ai", "ANTHROPIC_WORKSPACE_ID", "Workspace ID (optional)", { hint: "Normally NOT needed: the key already belongs to its workspace. Fill this in only if your AI provider's console or support says the API needs it, then press Test connection." }),
  F("jenga", "JENGA_ENV", "Environment", { options: ["sandbox", "production"], labels: ["Sandbox — testing only", "Production — real money"] }),
  F("jenga", "JENGA_MERCHANT_CODE", "Merchant code"), F("jenga", "JENGA_CONSUMER_SECRET", "Consumer secret", { secret: true }), F("jenga", "JENGA_API_KEY", "API key", { secret: true }),
  F("jenga", "PAYBILL_NETWORKS", "Networks that can pay by Pay Bill", { hint: "Comma-separated: mpesa, airtel, equitel, tkash. Default: mpesa, airtel, equitel. T-Kash is off until Equity confirms it." }), F("jenga", "PROMPT_NETWORKS", "Networks that can get a PIN prompt", { hint: "Comma-separated. Default: mpesa. Add equitel once Finserve has authorised it for you; add airtel or tkash only if Finserve confirms they support a prompt." }), F("jenga", "JENGA_ACCOUNT_NUMBER", "Your Equity account number (customers' money is credited here)"), F("jenga", "JENGA_ACCOUNT_NAME", "Business name shown to the payer"),
  F("jenga", "JENGA_PRIVATE_KEY", "Signing key (private half)", { secret: true, multiline: true, max: 4000, hint: "Press “Generate signing keys” below instead of typing this. It is stored encrypted and never shown again." }),
  F("jenga", "JENGA_PAYOUTS", "Pay sellers and riders out through Equity", { options: ["0", "1"], labels: ["Off (default)", "On — only after a small live test"] }),
  F("jenga", "MPESA_PROVIDER", "Which service sends the M-Pesa prompt (optional)", { options: ["jenga", "daraja", "flutterwave"], labels: ["Equity Bank (Jenga)", "Your own Safaricom Paybill (Daraja)", "Flutterwave"] }),
  F("paystack", "PAYSTACK_SECRET_KEY", "Secret key", { secret: true, hint: "Paystack dashboard → Settings → API Keys & Webhooks. It starts sk_test_ (testing) or sk_live_ (real money). Start with the TEST key." }),
  F("paystack", "PAYMENT_SHOW", "Payment options buyers see", { options: ["paystack", "all"], labels: ["Paystack + crypto (Equity appears once its codes are added)", "Everything that is connected"], hint: "While Paystack is connected, buyers see Paystack's options — M-Pesa, Airtel Money and card — plus crypto (USDC). Equity's Pay Bill and bank transfer appear as soon as you enter Equity's codes. Choose “Everything that is connected” to also show PayPal, Stripe, Flutterwave and any other provider you have set up." }),
  F("paystack", "PAYOUT_WAIT_DAYS", "Days sellers wait for a payout (what they are told)", { hint: "Paystack moves a buyer's payment into your balance about 2 days after they pay, and sellers can only be paid from money that has arrived. This is the number sellers, riders and buyers are shown. Leave it empty for 2 while Paystack is connected (0 for providers that settle instantly). If you keep a float in your balance, set it lower." }),  F("paystack", "PAYSTACK_PASS_FEE", "Payment fee", { options: ["mobile", "all", "off"], labels: ["Add the provider's fee to M-Pesa and Airtel Money payments (recommended)", "Add it to card payments too", "Don't add it — Sokoni pays it"], hint: "Paystack takes 1.5% of every M-Pesa or Airtel Money payment and 2.9% (local) or 3.8% (international) of a card payment. Added to the buyer's payment, the order's money reaches you in full and the buyer sees a clear 'payment fee' line. Cards are priced at the local rate, so an international card still costs you about 0.9% extra." }),
  F("paystack", "PAYSTACK_PAYOUTS", "Automatic payouts to M-Pesa", { options: ["0", "1"], labels: ["Off — I pay sellers and riders by hand", "On — pay them automatically"], hint: "With a test key payouts are on by themselves. With a LIVE key leave this Off until you have done one small real payout, then switch it On." }),
  F("social", "GOOGLE_CLIENT_ID", "Google client ID", { hint: "Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application). Add this address under “Authorised redirect URIs”: your site address + /api/auth/google/callback  (for example https://www.sokony.com/api/auth/google/callback)." }),
  F("social", "GOOGLE_CLIENT_SECRET", "Google client secret", { secret: true }),
  F("social", "FACEBOOK_APP_ID", "Facebook app ID", { hint: "developers.facebook.com → My Apps → Create app → add “Facebook Login”. Add this under “Valid OAuth Redirect URIs”: your site address + /api/auth/facebook/callback  (for example https://www.sokony.com/api/auth/facebook/callback). Switch the app to Live when you are ready." }),
  F("social", "FACEBOOK_APP_SECRET", "Facebook app secret", { secret: true }),
  F("fincra", "FINCRA_ENV", "Environment", { options: ["sandbox", "live"], labels: ["Sandbox — testing only", "Live — real money"] }),
  F("fincra", "FINCRA_BUSINESS_ID", "Business ID", { hint: "Fincra dashboard → My Profile → Business ID." }),
  F("fincra", "FINCRA_API_KEY", "Secret API key", { secret: true, hint: "Fincra dashboard → Settings → API. Sandbox and live keys are different — use the sandbox ones first." }),
  F("fincra", "FINCRA_WEBHOOK_SECRET", "Webhook secret key", { secret: true, hint: "Fincra dashboard → Settings → API → webhook secret key. Sokoni uses it to check that every notification really comes from Fincra." }),
  F("fincra", "FINCRA_PAYOUTS", "Automatic payouts to M-Pesa", { options: ["0", "1"], labels: ["Off — I pay sellers and riders by hand", "On — pay them automatically"], hint: "In the sandbox payouts are on by themselves. With real money leave this Off until you have done one small real payout, then switch it On." }),
  F("fincra", "FINCRA_SENDER_NAME", "Sender name on payouts (optional)", { hint: "Only if Fincra's sandbox asks for a sender name on local payouts." }),
  F("sms", "SMS_PROVIDER", "SMS provider", { options: ["africastalking", "twilio"], labels: ["Africa's Talking (best for Kenya & Africa)", "Twilio (global)"] }),
  F("sms", "AT_USERNAME", "Africa's Talking username"), F("sms", "AT_API_KEY", "Africa's Talking API key", { secret: true }), F("sms", "AT_SENDER_ID", "Sender ID (optional, needs approval)"), F("sms", "AT_SANDBOX", "Use the Africa's Talking sandbox", { options: ["0", "1"], labels: ["No — real SMS", "Yes — testing only"] }),
  F("sms", "TWILIO_ACCOUNT_SID", "Twilio account SID"), F("sms", "TWILIO_AUTH_TOKEN", "Twilio auth token", { secret: true }), F("sms", "TWILIO_FROM", "Twilio sending number / sender ID"),
  F("email", "EMAIL_PROVIDER", "Email provider", { options: ["resend", "sendgrid"], labels: ["Resend", "SendGrid"] }),
  F("email", "RESEND_API_KEY", "Resend API key", { secret: true }), F("email", "SENDGRID_API_KEY", "SendGrid API key", { secret: true }),
  F("email", "EMAIL_FROM", "Send from", { hint: "e.g. Sokoni <no-reply@your-domain.example> — the domain must be verified with your email provider." }),
  F("flutterwave", "FLW_SECRET_KEY", "Secret key", { secret: true, hint: "Flutterwave → Settings → API keys. Test keys contain “TEST”." }),
  F("flutterwave", "FLW_SECRET_HASH", "Webhook secret hash", { secret: true, generate: true, hint: "Make up a long random value (use Generate) and enter the SAME value in Flutterwave → Settings → Webhooks." }),
  F("flutterwave", "FLW_CURRENCIES", "Currencies enabled on your account (optional)", { hint: "Comma separated, e.g. KES,USD,UGX. Leave empty for the usual African list + USD, EUR, GBP." }),
  F("mpesa", "MPESA_ENV", "Environment", { options: ["sandbox", "production"] }),
  F("mpesa", "MPESA_CONSUMER_KEY", "Consumer key", { secret: true }), F("mpesa", "MPESA_CONSUMER_SECRET", "Consumer secret", { secret: true }),
  F("mpesa", "MPESA_SHORTCODE", "Shortcode (Paybill, or head-office/store number for a Till)"), F("mpesa", "MPESA_PASSKEY", "Lipa na M-Pesa passkey", { secret: true }),
  F("mpesa", "MPESA_CALLBACK_BASE_URL", "Public https address for callbacks", { hint: "e.g. https://your-domain.example (no trailing slash)", https: true }),
  F("mpesa", "MPESA_TRANSACTION_TYPE", "Account type", { options: ["CustomerPayBillOnline", "CustomerBuyGoodsOnline"], labels: ["Paybill", "Till (Buy Goods)"] }),
  F("mpesa", "MPESA_TILL_NUMBER", "Till number (only for Till)"), F("mpesa", "MPESA_INITIATOR_NAME", "B2C initiator name (for payouts)"), F("mpesa", "MPESA_INITIATOR_PASSWORD", "B2C initiator password (for payouts)", { secret: true }),
  F("crypto", "CRYPTO_PAY_CURRENCY", "Pin the coin (optional)", { hint: "Leave empty and choose USDC networks in your NOWPayments dashboard (Settings → Payments → Coins). Or enter a NOWPayments code, e.g. usdcsol, to pin it here." }),
  F("crypto", "NOWPAYMENTS_API_KEY", "API key", { secret: true }), F("crypto", "NOWPAYMENTS_IPN_SECRET", "IPN secret key", { secret: true }),
  F("wire", "WIRE_ACCOUNT_NAME", "Account holder name"), F("wire", "WIRE_BANK_NAME", "Bank name"), F("wire", "WIRE_ACCOUNT_NUMBER", "Account number / IBAN"),
  F("wire", "WIRE_SWIFT", "SWIFT / BIC (for wires)"), F("wire", "WIRE_ROUTING", "ACH routing number (US, if you have a US account)"), F("wire", "WIRE_BANK_ADDRESS", "Bank address (optional)"),
  F("wire", "WIRE_CURRENCIES", "Currencies you can receive", { hint: "Comma separated, e.g. USD or USD,EUR,GBP. Orders in other currencies are converted to the first one." }),
  F("wire", "WIRE_INSTRUCTIONS", "Extra instructions shown to the buyer (optional)", { multiline: true, max: 600 }),
  F("wire", "WIRE_WEBHOOK_SECRET", "Arrival-notification secret (optional)", { secret: true, generate: true, hint: "Lets Wise/your bank automation confirm arrivals automatically by calling /api/webhooks/wire with this secret. Without it you confirm arrivals in the console." }),
  F("wire", "WIRE_TOLERANCE_PERCENT", "Accept transfers up to this % short (bank fees)", { hint: "Default 2" }),
  F("paypal", "PAYPAL_ENV", "Environment", { options: ["sandbox", "live"] }), F("paypal", "PAYPAL_CLIENT_ID", "Client ID", { secret: true, hint: "developer.paypal.com → Apps & Credentials. Use the Sandbox tab first, then the Live tab." }), F("paypal", "PAYPAL_CLIENT_SECRET", "Client secret", { secret: true }),
  F("paypal", "PAYPAL_WEBHOOK_ID", "Webhook ID (optional, recommended)", { hint: "After you add the webhook URL in PayPal, paste its ID here so webhook signatures are checked too." }),
  F("stripe", "STRIPE_SECRET_KEY", "Secret key", { secret: true }), F("stripe", "STRIPE_WEBHOOK_SECRET", "Webhook signing secret", { secret: true }),
];
const BY = Object.fromEntries(FIELDS.map((f) => [f.key, f])), applied = {}, realEnv = {}; // realEnv remembers what the host environment had, so "Clear" can fall back
const aesKey = () => { if (!process.env.SERVER_SECRET) return null; return crypto.scryptSync(process.env.SERVER_SECRET, "sokoni-settings-v1", 32); };
function enc(text) { const k = aesKey(); if (!k) throw new Error("Set SERVER_SECRET in your host settings first — it is used to encrypt saved keys."); const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", k, iv), ct = Buffer.concat([c.update(text, "utf8"), c.final()]); return "enc:v1:" + [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(":"); }
function dec(v) { if (!String(v).startsWith("enc:v1:")) return String(v); const k = aesKey(); if (!k) return null; try { const [iv, tag, ct] = v.slice(7).split(":").map((x) => Buffer.from(x, "base64")), d = crypto.createDecipheriv("aes-256-gcm", k, iv); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]).toString("utf8"); } catch (e) { return null; } }
const doc = () => (store.readAll("settings")[0] || { id: "payments", values: {} });
function applyAll() { // call at start-up and after every save
  const vals = doc().values || {}; for (const f of FIELDS) { if (!(f.key in realEnv)) realEnv[f.key] = process.env[f.key]; const raw = vals[f.key]; const v = raw == null ? null : dec(raw);
    if (v) { process.env[f.key] = v; applied[f.key] = true; } else { if (applied[f.key]) { if (realEnv[f.key] === undefined) delete process.env[f.key]; else process.env[f.key] = realEnv[f.key]; delete applied[f.key]; } } }
}
function view() {
  const vals = doc().values || {}, canEncrypt = !!aesKey();
  return { canEncrypt, fields: FIELDS.map((f) => { const raw = vals[f.key], saved = raw != null, v = saved ? dec(raw) : null, env = !saved && realEnv[f.key] !== undefined ? realEnv[f.key] : (!saved ? process.env[f.key] : undefined), has = !!(v || env), shown = v || env || "";
    return { group: f.group, key: f.key, label: f.label, secret: f.secret, hint: f.hint || "", options: f.options || null, labels: f.labels || null, multiline: !!f.multiline, generate: !!f.generate, set: has, source: saved ? "saved in the console" : env ? "host environment" : null, unreadable: saved && v == null,
      value: f.secret ? "" : shown, preview: f.secret && has ? "••••" + String(shown).slice(-4) : "" }; }) };
}
async function save(values = {}, clear = []) {
  const errors = [], upd = {};
  for (const [k, v0] of Object.entries(values)) { const f = BY[k]; if (!f) { errors.push("Unknown setting " + k); continue; } const v = String(v0 == null ? "" : v0).trim(); if (!v) continue; if (v.length > (f.max || 300)) { errors.push(f.label + " is too long."); continue; }
    if (f.options && !f.options.includes(v)) { errors.push(f.label + ": choose one of the listed options."); continue; } if (f.https && !/^https:\/\/[^\s]+$/.test(v)) { errors.push(f.label + " must start with https://"); continue; }
    if (k === "WIRE_CURRENCIES" || k === "FLW_CURRENCIES") { if (!/^[A-Za-z]{3}(\s*,\s*[A-Za-z]{3})*$/.test(v)) { errors.push(f.label + ": use 3-letter currency codes separated by commas."); continue; } }
    if (k === "WIRE_TOLERANCE_PERCENT" && !(Number(v) >= 0 && Number(v) <= 10)) { errors.push(f.label + " must be between 0 and 10."); continue; }
    try { upd[k] = f.secret ? enc(v) : v; } catch (e) { errors.push(e.message); } }
  for (const k of clear) if (!BY[k]) errors.push("Unknown setting " + k);
  if (errors.length) return { ok: false, errors };
  await store.mutate("settings", (all) => { const cur = all[0] || { id: "payments", values: {} }, vals = { ...cur.values, ...upd }; for (const k of clear) delete vals[k]; return [{ ...cur, values: vals, updatedAt: new Date().toISOString() }]; });
  applyAll(); return { ok: true };
}
module.exports = { FIELDS, applyAll, view, save };
