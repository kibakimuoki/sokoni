// Payments router. Buyers choose a METHOD (M-Pesa · Card · International payment · Crypto); Sokoni picks the provider.
// Provider names are never shown in the UI. Every provider confirms payment by signed webhook (and a reconciliation poll),
// so funds become "held" automatically — no human approves a normal successful payment.
//   mpesa          Safaricom Daraja STK push (Kenya/KES)
//   flutterwave    hosted checkout: cards, mobile money (M-Pesa, MTN, Airtel…), bank transfer, USSD — 30+ African countries
//   stripe         hosted checkout: cards + local methods enabled on your account (+ stablecoin checkout if you turn it on there)
//   nowpayments    crypto / stablecoin invoice (no chargebacks — payments are final)
//   bank_wire      international bank transfer (wire / ACH) into YOUR bank/Wise/Payoneer account: buyer gets details + a unique reference; arrival is confirmed
//                  by a signed notification (/api/webhooks/wire) or by an admin in the console. Funds are "held" only once it arrives.
//   paystack       M-Pesa / Airtel Money PIN prompts into your Paystack balance (held there with manual payouts), and Transfers out to M-Pesa (Kenya)
//   fincra         M-Pesa / Airtel Money / Equitel PIN prompts into your Fincra wallet, and M-Pesa payouts out of it (Kenya)
//   test           local sandbox, only when DEV_PAYMENTS=1
const crypto = require("crypto");
const mpesa = require("./mpesa");
const fx = require("./fx");
const countries = require("./countries");
const coverage = require("./coverage"); const jenga = require("./jenga"); const networks = require("./networks"); const fincra = require("./fincra"); const paystack = require("./paystack");
const chargeOf = (o) => (o.total != null ? o.total : o.amount); // produce + delivery fee
const BASE = () => (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const list = (v, d) => String(v || d || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const explicitWire = () => !!(process.env.WIRE_ACCOUNT_NAME && process.env.WIRE_BANK_NAME && process.env.WIRE_ACCOUNT_NUMBER && (process.env.WIRE_SWIFT || process.env.WIRE_ROUTING));
const equityWire = () => !explicitWire() && !!(process.env.JENGA_ACCOUNT_NUMBER && !process.env.WIRE_ACCOUNT_NUMBER);
const wireIsEquity = () => jenga.isConfigured() && (equityWire() || (!!process.env.WIRE_ACCOUNT_NUMBER && process.env.WIRE_ACCOUNT_NUMBER === process.env.JENGA_ACCOUNT_NUMBER)); // can the Equity statement see these transfers arrive?
const cfg = {
  flutterwave: () => !!(process.env.FLW_SECRET_KEY && process.env.FLW_SECRET_HASH && BASE()),
  stripe: () => !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && BASE()),
  nowpayments: () => !!(process.env.NOWPAYMENTS_API_KEY && process.env.NOWPAYMENTS_IPN_SECRET && BASE()),
  mpesa: () => mpesa.isConfigured(),
  jenga: () => jenga.isConfigured() && !!BASE(), // Equity Bank: M-Pesa prompt settled into your Equity account
  fincra: () => fincra.isConfigured(), // Fincra: PIN prompts into your Fincra wallet
  paystack: () => paystack.isConfigured(), // Paystack: PIN prompts into your Paystack balance
  paypal: () => !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET && BASE()),
  // bank transfers: explicit WIRE_* details win; otherwise they are derived from your Equity account — the account number is the only thing to plug in
  wire: () => explicitWire() || equityWire(),
  // the fake sandbox only works while PUBLIC_BASE_URL is empty/localhost, so it can never be left on by accident once you deploy publicly
  test: () => process.env.DEV_PAYMENTS === "1" && (!BASE() || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE())),
};
const FLW_CURRENCIES = () => list(process.env.FLW_CURRENCIES, "NGN,GHS,KES,UGX,TZS,RWF,ZAR,XOF,XAF,ZMW,MWK,EGP,USD,EUR,GBP");
const METHODS = { wire: { icon: "🏦", label: "Bank transfer (wire / ACH)", hidden: true }, mpesa: { icon: "🇰🇪", label: "M-Pesa & mobile money" }, momo: { icon: "📱", label: "Mobile money" }, card: { icon: "💳", label: "Card" }, paypal: { icon: "🅿️", label: "PayPal" }, international: { icon: "🌍", label: "International payment" }, crypto: { icon: "🪙", label: "Crypto (USDC)" }, test: { icon: "🧪", label: "Test payment (sandbox)" } };
const PAYPAL_CURRENCIES = () => list(process.env.PAYPAL_CURRENCIES, "AUD,BRL,CAD,CHF,CNY,CZK,DKK,EUR,GBP,HKD,HUF,ILS,JPY,MXN,MYR,NOK,NZD,PHP,PLN,SEK,SGD,THB,TWD,USD");
function stripeOk(cur) { const sc = list(process.env.STRIPE_CURRENCIES); return cfg.stripe() && (!sc.length || sc.includes(cur)); }
// Which provider carries each buyer-facing method. The order's own currency no longer blocks a method: if the provider can't take it,
// quote() converts to a currency it can (the buyer's own, else USD) and the exact amount is shown to the buyer before they pay.
// who sends the M-Pesa prompt: MPESA_PROVIDER=jenga|daraja|flutterwave picks one; otherwise Equity (Jenga) first, then your own Safaricom Paybill, then Flutterwave
// "Pay from the M-Pesa menu" (Paybill) alongside the PIN prompt. With Equity it uses Equity's shared Paybill (247247) and YOUR account number as the account number;
// a payment is then recognised from Equity's own statement (the M-Pesa code or the payer's phone), because that Paybill can't carry an order reference.
const equityPaybill = () => String(process.env.EQUITY_PAYBILL || "247247").trim();
// Pay Bill from the M-Pesa menu works as soon as your Equity ACCOUNT NUMBER is known (money simply lands in your account). With the Equity API connected it confirms by itself;
// before that (auto:false) a person confirms it with one click in Operations → Payment setup → Equity.
const equityAccount = () => !!String(process.env.JENGA_ACCOUNT_NUMBER || "").trim();
// WHO BUYERS SEE. While Paystack is connected the default is "paystack": buyers see Paystack's options (M-Pesa, Airtel Money, card) and crypto (USDC) — Equity's Pay Bill and bank transfer
// appear as soon as Equity's CODES are entered (an account number alone is not enough). PAYMENT_SHOW=all shows everything that is connected. This is enforced here, in the routing,
// so a hidden provider cannot be used even by someone who crafts a request by hand.
const showMode = () => { const v = String(process.env.PAYMENT_SHOW || "").toLowerCase(); return v === "all" || v === "paystack" ? v : cfg.paystack() ? "paystack" : "all"; };
const allowedProvider = (pv) => showMode() === "all" || pv === "paystack" || pv === "nowpayments" || pv === "test" || ((pv === "jenga" || pv === "bank_wire") && jenga.isConfigured());
// HOW LONG SELLERS WAIT. Paystack moves a buyer's payment into your balance about 2 days after they pay, and a seller can only be paid from money that has arrived.
// This is the number sellers, riders and buyers are TOLD (PAYOUT_WAIT_DAYS overrides it; instant providers say 0).
const payoutWaitDays = () => { const v = String(process.env.PAYOUT_WAIT_DAYS == null ? "" : process.env.PAYOUT_WAIT_DAYS).trim(); if (v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0) return Math.floor(Number(v)); return mpesaProvider() === "paystack" ? 2 : 0; };
function manualKind() { if (showMode() === "paystack") return jenga.isConfigured() && equityAccount() ? "equity" : null; if (mpesaProvider() === "jenga") return "equity"; if (cfg.mpesa()) return "daraja"; return equityAccount() ? "equity" : null; }
function mpesaProvider() { const ok = { paystack: cfg.paystack(), jenga: cfg.jenga(), fincra: cfg.fincra(), daraja: cfg.mpesa(), flutterwave: cfg.flutterwave() }, name = { paystack: "paystack", jenga: "jenga", fincra: "fincra", daraja: "mpesa", flutterwave: "flutterwave" }, pref = String(process.env.MPESA_PROVIDER || "").toLowerCase(); if (pref && ok[pref]) return name[pref]; return ok.paystack ? "paystack" : ok.jenga ? "jenga" : ok.fincra ? "fincra" : ok.daraja ? "mpesa" : ok.flutterwave ? "flutterwave" : null; } // (Paystack first: it is the provider Sokoni is built around; MPESA_PROVIDER picks another)
function routeFor(method, ctx) { const pv = routeForRaw(method, ctx); return pv && allowedProvider(pv) ? pv : null; }
function routeForRaw(method, { buyerCountry }) {
  switch (method) {
    case "mpesa": return buyerCountry === "KE" ? mpesaProvider() : null;
    case "card": return cfg.paystack() ? "paystack" : cfg.stripe() ? "stripe" : cfg.flutterwave() ? "flutterwave" : null;
    case "momo": return buyerCountry !== "KE" && coverage.isMobileMoney(buyerCountry) && cfg.flutterwave() ? "flutterwave" : null; // MTN / Airtel / Orange / Vodacom… through the hosted page
    case "paypal": return cfg.paypal() ? "paypal" : null;
    case "international": return cfg.flutterwave() ? "flutterwave" : cfg.stripe() ? "stripe" : null;
    case "crypto": return cfg.nowpayments() ? "nowpayments" : null;
    case "wire": return cfg.wire() ? "bank_wire" : null;
    case "test": return cfg.test() ? "test" : null;
    default: return null;
  }
}
// M-Pesa is for Kenya, Mobile money for the other mobile-money countries; the other methods are offered everywhere
const applicable = (m, ctx) => (m === "mpesa" ? ctx.buyerCountry === "KE" : m === "momo" ? ctx.buyerCountry !== "KE" && coverage.isMobileMoney(ctx.buyerCountry) : true);
// ----- charging in a currency the method supports -----
const supportedFor = (provider, method) => (provider === "flutterwave" ? (method === "mpesa" ? ["KES"] : FLW_CURRENCIES()) : provider === "paypal" ? PAYPAL_CURRENCIES() : provider === "mpesa" || provider === "jenga" || provider === "fincra" || provider === "paystack" ? ["KES"] : provider === "nowpayments" ? ["USD"] : provider === "stripe" ? (list(process.env.STRIPE_CURRENCIES).length ? list(process.env.STRIPE_CURRENCIES) : null) : null);
const fxMargin = () => 1 + Math.max(0, Number(process.env.FX_MARGIN_PERCENT == null || process.env.FX_MARGIN_PERCENT === "" ? 2 : process.env.FX_MARGIN_PERCENT)) / 100; // buffer so exchange-rate drift never leaves you short of what you owe sellers
// The payment provider's own charge (1.5% on M-Pesa and Airtel Money in Kenya, 2.9% on local cards) can be added to what the buyer pays, so the order's money reaches us in full:
// the buyer is asked for  total / (1 − fee%)  — rounded UP (to a whole shilling for mobile money) — and the provider takes its percentage of that bigger amount. The extra is shown to the buyer as "payment fee".
const passFeeMode = () => { const v = String(process.env.PAYSTACK_PASS_FEE || "mobile").toLowerCase(); return ["off", "mobile", "all"].includes(v) ? v : "mobile"; };
const feePctFor = (method) => (method === "mpesa" ? Number(process.env.PAYSTACK_FEE_MOBILE_PCT || 1.5) : method === "card" ? Number(process.env.PAYSTACK_FEE_CARD_PCT || 2.9) : 0);
function withProcessingFee(q, method) {
  const mode = passFeeMode(), pct = feePctFor(method); if (mode === "off" || !(pct > 0 && pct < 50) || (method === "card" && mode !== "all") || (method !== "mpesa" && method !== "card")) return q;
  const net = q.amount, gross = method === "mpesa" ? Math.ceil(net / (1 - pct / 100)) : Math.ceil((net / (1 - pct / 100)) * 100) / 100;
  return { ...q, amount: gross, fee: Math.round((gross - net) * 100) / 100, feePct: pct };
}
function quoteSync(provider, method, order, buyerCurrency) { const q = quoteSyncBase(provider, method, order, buyerCurrency); return q && provider === "paystack" ? withProcessingFee(q, method) : q; }
function quoteSyncBase(provider, method, order, buyerCurrency) {
  const cur = order.currency, base = chargeOf(order), bc = String(buyerCurrency || "").toUpperCase(), sup = method === "momo" ? (FLW_CURRENCIES().includes(bc) ? [bc] : []) : supportedFor(provider, method); // mobile money is always charged in the buyer's own currency
  if (!sup || sup.includes(cur)) return { currency: cur, amount: base, rate: 1, converted: false };
  const target = [buyerCurrency && String(buyerCurrency).toUpperCase(), "USD", "EUR"].find((c) => c && sup.includes(c)); if (!target) return null;
  const rate = fx.rateSync(cur, target); if (!rate) return null;
  return { currency: target, amount: countries.roundMoney(base * rate * fxMargin(), target), rate, converted: true };
}
async function quote(provider, method, order, buyerCurrency) { try { await fx.getRates(); } catch (e) { /* use whatever is cached */ } return quoteSync(provider, method, order, buyerCurrency); }
const due = (o) => ({ currency: o.chargeCurrency || o.currency, amount: o.chargeAmount != null ? o.chargeAmount : chargeOf(o) }); // exactly what the buyer was asked to pay
const optionsFor = (ctx) => Object.keys(METHODS).filter((m) => !METHODS[m].hidden && applicable(m, ctx) && routeFor(m, ctx)).map((id) => ({ id, ...METHODS[id], available: true }));
// Every method buyers should know about; the ones with no connected provider are returned with available:false so the UI can show them greyed-out.
// The company's payment policy: M-Pesa (Paybill) for buyers in Kenya, USDC for everyone else and for Kenyan amounts above M-Pesa's per-transaction limit.
// Card / PayPal / mobile money / bank transfer stay in the code but only appear if you connect them later.
// the agreed lineup — M-Pesa, bank transfer, USDC — is always shown (greyed until it is set up)
const core = () => (showMode() === "paystack" ? ["mpesa", "test"] : ["mpesa", "international", "crypto", "test"]), mpesaMax = () => (mpesaProvider() === "paystack" ? paystack.MPESA_MAX() : Number(process.env.MPESA_MAX_KES || 250000));
const allOptions = (ctx) => { const chg = (m) => { const pv = routeFor(m, ctx) || (m === "mpesa" && manualKind() === "equity" ? "jenga" : null); return pv && ctx.order ? quoteSync(pv, m, ctx.order, ctx.buyerCurrency) : null; };
  return Object.keys(METHODS).filter((m) => !METHODS[m].hidden && (m !== "test" || cfg.test()) && applicable(m, ctx) && (core().includes(m) || !!(m === "international" ? routeFor("international", ctx) || routeFor("wire", ctx) : routeFor(m, ctx)))).map((id) => {
    if (id === "mpesa") { const charge = chg(id), over = !!(charge && charge.amount > mpesaMax()), promptApi = !!routeFor(id, ctx) && !over, manualApi = !!manualKind() && !over;
      // what each network can do: a PIN prompt through the API (Safaricom is always possible; the others only through Equity and only when switched on) and/or Pay Bill by hand
      const nets = networks.NETWORKS.map((n) => ({ id: n.id, name: n.name, prompt: promptApi && networks.promptOn(n.id, mpesaProvider()) && (n.id === "mpesa" || mpesaProvider() === "jenga" || (mpesaProvider() === "fincra" && !!fincra.OPERATORS[n.id]) || (mpesaProvider() === "paystack" && !!paystack.OPERATORS[n.id])), paybill: manualApi && networks.paybillOn(n.id) && (n.id === "mpesa" || manualKind() === "equity") }));
      const prompt = nets[0].prompt, manual = nets.some((n) => n.paybill); return { id, ...METHODS[id], available: nets.some((n) => n.prompt || n.paybill), prompt, auto: manualKind() === "daraja" || jenga.isConfigured(), networks: nets, charge, limit: over ? mpesaMax() : null, manual, paybill: manualKind() === "equity" ? equityPaybill() : manualKind() === "daraja" ? process.env.MPESA_SHORTCODE : null }; }
    if (id !== "international") return { id, ...METHODS[id], available: !!routeFor(id, ctx), charge: chg(id) };
    // "International payment" can mean a secure card/local-methods page and/or a bank transfer (wire / ACH): the buyer picks when both exist
    const subs = [{ id: "international", icon: "🌐", label: "Secure payment page", hint: "Cards and local payment methods", available: !!routeFor("international", ctx), charge: chg("international") }, { id: "wire", icon: "🏦", label: "Bank transfer", hint: "Pay from your bank or M-Pesa — held safely once it arrives", available: !!routeFor("wire", ctx) }].filter((x) => x.available);
    const bankOnly = subs.length === 0 || (subs.length === 1 && subs[0].id === "wire"); // no card page connected: call it what it is — a bank transfer
    return { id, ...METHODS[id], ...(bankOnly ? { icon: "🏦", label: ctx.buyerCountry === "KE" ? "Bank transfer" : "International bank transfer" } : {}), available: subs.length > 0, subs };
  }); };
// ----- international bank transfer (wire / ACH) -----
const wireDetails = () => equityWire() ? jenga.wireAccount() : ({ accountName: process.env.WIRE_ACCOUNT_NAME || "", bankName: process.env.WIRE_BANK_NAME || "", accountNumber: process.env.WIRE_ACCOUNT_NUMBER || "", swift: process.env.WIRE_SWIFT || "", routing: process.env.WIRE_ROUTING || "", bankAddress: process.env.WIRE_BANK_ADDRESS || "", instructions: process.env.WIRE_INSTRUCTIONS || "" });
const wireExpiryDays = () => Number(process.env.WIRE_EXPIRY_DAYS || 7);
async function wireQuote(order) { // a locked amount in a currency the account can receive, plus a unique reference the buyer must include
  const cur = list(process.env.WIRE_CURRENCIES, equityWire() ? "KES" : "USD"), charge = chargeOf(order); let currency = order.currency, amount = charge;
  if (!cur.includes(order.currency)) { currency = cur[0]; const rate = await fx.rate(order.currency, currency); if (!rate) throw new Error("Bank transfer is temporarily unavailable (no exchange rate). Please choose another payment method."); amount = Math.round(charge * rate * 100) / 100; }
  return { reference: "SOK" + crypto.randomBytes(4).toString("hex").toUpperCase(), currency, amount, local: order.buyerCountry === "KE" && currency === "KES", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + wireExpiryDays() * 86400e3).toISOString() };
}
// does a notification of arrival match the quote? (banks often deduct intermediary fees, so a small shortfall is tolerated)
function wireMatches(wire, { amount, currency }) { const tol = Number(process.env.WIRE_TOLERANCE_PERCENT || 2) / 100, got = Number(amount); if (!wire || !(got > 0)) return { ok: false, error: "Amount missing." };
  if (String(currency || wire.currency).toUpperCase() !== wire.currency) return { ok: false, error: `Currency mismatch: expected ${wire.currency}.` };
  return got >= wire.amount * (1 - tol) ? { ok: true } : { ok: false, error: `Short by ${(wire.amount - got).toFixed(2)} ${wire.currency} (expected ${wire.amount.toFixed(2)}). Ask the buyer to send the difference or refund them.` }; }
function verifyWireSignature(raw, header) { const secret = process.env.WIRE_WEBHOOK_SECRET; if (!secret || !header) return false; const exp = crypto.createHmac("sha256", secret).update(raw).digest("hex"), got = String(header).trim().replace(/^sha256=/, ""); return got.length === exp.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(exp)); }

// ----- Stripe -----
const ZERO = new Set("BIF CLP DJF GNF JPY KMF KRW MGA PYG RWF VND VUV XAF XOF XPF".split(" ")), THREE = new Set("BHD JOD KWD OMR TND".split(" "));
function minorUnits(a, c) { if (ZERO.has(c)) return Math.round(a); if (THREE.has(c)) return Math.round(a * 100) * 10; return Math.round(a * 100); } // ISK/UGX/HUF/TWD are two-decimal for charges
const sform = async (path, f, method = "POST") => { const r = await fetch("https://api.stripe.com/v1/" + path, { method, headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" }, body: method === "GET" ? undefined : f.toString() }); return { r, d: await r.json() }; };
async function stripeCheckout(order, buyer, quote) {
  const f = new URLSearchParams(), u = BASE();
  f.set("mode", "payment"); f.set("success_url", `${u}/?order=${order.id}&paid=1`); f.set("cancel_url", `${u}/?order=${order.id}&cancelled=1`); f.set("client_reference_id", order.id); f.set("metadata[order_id]", order.id); f.set("payment_intent_data[metadata][order_id]", order.id);
  f.set("line_items[0][quantity]", "1"); f.set("line_items[0][price_data][currency]", quote.currency.toLowerCase()); f.set("line_items[0][price_data][unit_amount]", String(minorUnits(quote.amount, quote.currency))); f.set("line_items[0][price_data][product_data][name]", `Sokoni order ${order.id.slice(0, 8)} — ${order.crop}`);
  if (buyer.email) f.set("customer_email", buyer.email);
  const { r, d } = await sform("checkout/sessions", f); if (!r.ok || !d.url) throw new Error((d.error && d.error.message) || "The payment couldn't be started."); return { url: d.url, ref: d.id };
}
function verifyStripeSignature(raw, header, secret, tol = 300) {
  if (!header || !secret) return false; const parts = Object.fromEntries(String(header).split(",").map((p) => p.split("=")).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = String(header).split(",").filter((p) => p.trim().startsWith("v1=")).map((p) => p.trim().slice(3)); if (!parts.t || !sigs.length || Math.abs(Date.now() / 1000 - Number(parts.t)) > tol) return false;
  const exp = crypto.createHmac("sha256", secret).update(`${parts.t}.${raw}`).digest("hex"); return sigs.some((s) => s.length === exp.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(exp)));
}
// ----- Flutterwave -----
async function flutterwaveCheckout(order, buyer, method, quote) {
  if (!buyer.email) { const e = new Error("Add your email address under Account to continue with this payment."); e.code = "EMAIL_REQUIRED"; throw e; }
  const txRef = "SOK-" + order.id; const body = { tx_ref: txRef, amount: quote.amount, currency: quote.currency, redirect_url: `${BASE()}/?order=${order.id}&paid=1`, customer: { email: buyer.email, name: buyer.name, phonenumber: buyer.phone }, customizations: { title: "Sokoni", description: `Order ${order.id.slice(0, 8)} — ${order.crop}` }, meta: { order_id: order.id } };
  if (method === "mpesa") body.payment_options = "mpesa"; if (method === "card") body.payment_options = "card";
  const r = await fetch("https://api.flutterwave.com/v3/payments", { method: "POST", headers: { Authorization: "Bearer " + process.env.FLW_SECRET_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json(); if (!r.ok || !d.data || !d.data.link) throw new Error(d.message || "The payment couldn't be started."); return { url: d.data.link, ref: txRef };
}
const flw = async (path, o = {}) => { const r = await fetch("https://api.flutterwave.com/v3/" + path, { ...o, headers: { Authorization: "Bearer " + process.env.FLW_SECRET_KEY, "Content-Type": "application/json" } }); return { r, d: await r.json().catch(() => ({})) }; };
async function flutterwaveVerify(txId) { const { r, d } = await flw(`transactions/${encodeURIComponent(txId)}/verify`); return r.ok && d.data ? d.data : null; }
async function flutterwaveVerifyByRef(ref) { const { r, d } = await flw(`transactions/verify_by_reference?tx_ref=${encodeURIComponent(ref)}`); return r.ok && d.data ? d.data : null; }
// ----- PayPal: PayPal balance + cards from buyers in the USA, Europe, Brazil and ~200 markets -----
const PPBASE = () => (process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"); let ppTok = null;
async function ppToken() {
  if (ppTok && ppTok.env === PPBASE() && ppTok.exp > Date.now() + 5000) return ppTok.t;
  const r = await fetch(PPBASE() + "/v1/oauth2/token", { method: "POST", headers: { Authorization: "Basic " + Buffer.from(process.env.PAYPAL_CLIENT_ID + ":" + process.env.PAYPAL_CLIENT_SECRET).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const d = await r.json().catch(() => ({})); if (!r.ok || !d.access_token) throw new Error(d.error_description || "PayPal rejected the credentials."); ppTok = { t: d.access_token, exp: Date.now() + Number(d.expires_in || 300) * 1000, env: PPBASE() }; return ppTok.t;
}
async function pp(path, { method = "GET", body, reqId } = {}) { const t = await ppToken(); const r = await fetch(PPBASE() + path, { method, headers: { Authorization: "Bearer " + t, "Content-Type": "application/json", ...(reqId ? { "PayPal-Request-Id": reqId } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { r, d: await r.json().catch(() => ({})) }; }
const ppAmount = (a, c) => (["JPY", "HUF", "TWD"].includes(c) ? String(Math.round(a)) : Number(a).toFixed(2));
async function paypalCheckout(order, quote) {
  const u = BASE();
  const { r, d } = await pp("/v2/checkout/orders", { method: "POST", reqId: `sok-${order.id}-${quote.currency}-${quote.amount}`, body: { intent: "CAPTURE", purchase_units: [{ reference_id: order.id, custom_id: order.id, description: `Sokoni order ${order.id.slice(0, 8)}`, amount: { currency_code: quote.currency, value: ppAmount(quote.amount, quote.currency) } }],
    payment_source: { paypal: { experience_context: { brand_name: "Sokoni", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED", return_url: `${u}/api/paypal/return?order=${order.id}`, cancel_url: `${u}/?order=${order.id}&cancelled=1` } } } } });
  const link = (d.links || []).find((l) => l.rel === "payer-action" || l.rel === "approve"); if (!r.ok || !link) throw new Error((d.details && d.details[0] && d.details[0].description) || d.message || "The PayPal payment couldn't be started."); return { url: link.href, ref: d.id };
}
// Looks the order up at PayPal (never trusts a browser redirect or a webhook body) and captures it if the buyer approved but it isn't captured yet.
async function paypalSync(ppOrderId) {
  const enc = encodeURIComponent(ppOrderId); let { r, d } = await pp("/v2/checkout/orders/" + enc); if (!r.ok) return null;
  if (d.status === "APPROVED") { const c = await pp(`/v2/checkout/orders/${enc}/capture`, { method: "POST", body: {}, reqId: "cap-" + ppOrderId }); if (c.r.ok || (c.d.details || []).some((x) => x.issue === "ORDER_ALREADY_CAPTURED")) ({ r, d } = await pp("/v2/checkout/orders/" + enc)); }
  const pu = (d.purchase_units || [])[0] || {}, cap = ((pu.payments || {}).captures || [])[0];
  return { status: d.status, paid: d.status === "COMPLETED" && !!cap && cap.status === "COMPLETED", amount: cap ? Number(cap.amount.value) : null, currency: cap ? cap.amount.currency_code : null, id: cap ? cap.id : null, ourId: pu.custom_id || pu.reference_id || null };
}
async function verifyPaypalWebhook(headers, event) { // optional extra layer: PayPal checks its own signature (needs PAYPAL_WEBHOOK_ID)
  if (!process.env.PAYPAL_WEBHOOK_ID) return true;
  const { r, d } = await pp("/v1/notifications/verify-webhook-signature", { method: "POST", body: { auth_algo: headers["paypal-auth-algo"], cert_url: headers["paypal-cert-url"], transmission_id: headers["paypal-transmission-id"], transmission_sig: headers["paypal-transmission-sig"], transmission_time: headers["paypal-transmission-time"], webhook_id: process.env.PAYPAL_WEBHOOK_ID, webhook_event: event } }); return r.ok && d.verification_status === "SUCCESS";
}
// ----- NOWPayments (crypto) -----
const sortKeys = (o) => (Array.isArray(o) ? o.map(sortKeys) : o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o);
// ----- crypto (NOWPayments): sandbox, small-shortfall tolerance, which USDC networks are switched on -----
const NP = () => (process.env.NOWPAYMENTS_SANDBOX === "1" ? "https://api-sandbox.nowpayments.io/v1" : "https://api.nowpayments.io/v1"); // NOWPAYMENTS_SANDBOX=1 → practice mode with a sandbox key, no real coins
const STABLE = /^(usdc|usdt|dai|busd|tusd|pyusd|fdusd|usde)/i, cryptoMinUsd = () => Number(process.env.CRYPTO_MIN_USD || 2);
// Exchanges often take their withdrawal fee out of what arrives, so a few cents short is accepted (the smaller of CRYPTO_SHORT_TOLERANCE_USD, default $1, and CRYPTO_SHORT_TOLERANCE_PCT, default 2%, of the price)
const cryptoTolerance = (dueUsd) => Math.min(Number(process.env.CRYPTO_SHORT_TOLERANCE_USD || 1), (Number(process.env.CRYPTO_SHORT_TOLERANCE_PCT || 2) / 100) * Number(dueUsd));
function cryptoPaidUsd(b) { const paid = Number(b.actually_paid), req = Number(b.pay_amount), price = Number(b.price_amount); if (!(paid >= 0) || !(price > 0)) return null; if (STABLE.test(String(b.pay_currency || ""))) return Math.round(paid * 100) / 100; return req > 0 ? Math.round((paid / req) * price * 100) / 100 : null; }
async function cryptoPaymentById(pid) { // ask NOWPayments directly about one payment (needs only your API key) — used when a notification never arrived
  const r = await fetch(NP() + "/payment/" + encodeURIComponent(pid), { headers: { "x-api-key": process.env.NOWPAYMENTS_API_KEY } }), d = await r.json().catch(() => ({})); return r.ok && d && d.payment_id ? d : null;
}
async function cryptoCoins() { // which coins YOU switched on (falls back to every coin NOWPayments supports)
  const h = { "x-api-key": process.env.NOWPAYMENTS_API_KEY }; let r = await fetch(NP() + "/merchant/coins", { headers: h }), d = await r.json().catch(() => ({})), coins = Array.isArray(d.selectedCurrencies) ? d.selectedCurrencies : null, source = "enabled";
  if (!r.ok || !coins) { r = await fetch(NP() + "/currencies", { headers: h }); d = await r.json().catch(() => ({})); if (!r.ok) return { ok: false, error: d.message || "NOWPayments rejected the API key." }; coins = d.currencies || []; source = "all"; }
  coins = coins.map((x) => String(x).toLowerCase()); return { ok: true, coins, usdc: coins.filter((x) => x.startsWith("usdc")), source };
}
function verifyNowSignature(body, sig) { if (!sig || !process.env.NOWPAYMENTS_IPN_SECRET) return false; const exp = crypto.createHmac("sha512", process.env.NOWPAYMENTS_IPN_SECRET).update(JSON.stringify(sortKeys(body))).digest("hex"); return sig.length === exp.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp)); }
async function cryptoInvoice(order, quote) {
  const usd = quote.amount; // already converted to USD (with the currency buffer) by quote()
  if (usd < cryptoMinUsd()) throw new Error(`Crypto payments need at least USD ${cryptoMinUsd()} (this order is about USD ${usd.toFixed(2)}) — please choose another payment method.`);
  const r = await fetch(NP() + "/invoice", { method: "POST", headers: { "x-api-key": process.env.NOWPAYMENTS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ price_amount: usd, price_currency: "usd", ...(process.env.CRYPTO_PAY_CURRENCY ? { pay_currency: process.env.CRYPTO_PAY_CURRENCY } : {}), order_id: order.id, order_description: `Sokoni order ${order.id.slice(0, 8)}`, ipn_callback_url: `${BASE()}/api/webhooks/crypto`, success_url: `${BASE()}/?order=${order.id}&paid=1`, cancel_url: `${BASE()}/?order=${order.id}&cancelled=1` }) });
  const d = await r.json(); if (!r.ok || !d.invoice_url) throw new Error(d.message || "The crypto payment couldn't be started."); return { url: d.invoice_url, ref: String(d.id), usd };
}
async function paystackCheckout(order, buyer, quote) { // Paystack's own card page; the money lands in your Paystack balance like an M-Pesa payment
  if (!buyer.email) { const e = new Error("Add your email address under Account to continue with this payment."); e.code = "EMAIL_REQUIRED"; throw e; }
  const ref = paystack.newRef(); const r = await paystack.initialize({ ref, amount: quote.amount, email: buyer.email, callbackUrl: `${BASE()}/?order=${order.id}&paid=1`, orderId: order.id, name: buyer.name }); return { url: r.url, ref, accessCode: r.accessCode };
}
async function createCheckout(provider, order, buyer, method, quote) {
  quote = quote || { currency: order.currency, amount: chargeOf(order) };
  if (provider === "paystack") return paystackCheckout(order, buyer, quote);
  if (provider === "stripe") return stripeCheckout(order, buyer, quote); if (provider === "flutterwave") return flutterwaveCheckout(order, buyer, method, quote); if (provider === "nowpayments") return cryptoInvoice(order, quote); if (provider === "paypal") return paypalCheckout(order, quote);
  throw new Error("Unsupported payment route.");
}
// ----- poll a pending payment (catches missed webhooks) → { paid, amount, currency } | null -----
async function pollStatus(order) {
  try {
    if (order.paymentProvider === "stripe" && order.providerRef) { const { r, d } = await sform("checkout/sessions/" + encodeURIComponent(order.providerRef), null, "GET"); return r.ok ? { paid: d.payment_status === "paid", minor: d.amount_total, currency: String(d.currency || "").toUpperCase(), id: d.payment_intent || d.id } : null; }
    if (order.paymentProvider === "paypal" && order.providerRef) { const v = await paypalSync(order.providerRef); return v ? { paid: v.paid, amount: v.amount, currency: v.currency, id: v.id } : null; }
    if (order.paymentProvider === "paystack" && order.providerRef) { const v = await paystack.verifyCharge(order.providerRef); return v ? { paid: v.paid, failed: v.failed, amount: v.amount, currency: v.currency, id: v.id } : null; }
    if (order.paymentProvider === "fincra" && order.providerRef) { const v = await fincra.verifyCharge(order.providerRef); return v ? { paid: v.paid, failed: v.failed, amount: v.amount, currency: v.currency, id: v.id } : null; }
    if (order.paymentProvider === "flutterwave" && order.providerRef) { const v = await flutterwaveVerifyByRef(order.providerRef); return v ? { paid: v.status === "successful", amount: Number(v.amount), currency: v.currency, id: String(v.id) } : null; }
  } catch (e) { /* offline */ } return null;
}
// ----- refunds (Stripe & Flutterwave automatic; M-Pesa / crypto need a manual refund) -----
// Automatic refunds for Equity-collected money: back to the M-Pesa number that paid (or, for a KES bank transfer, the buyer's registered M-Pesa number).
// An admin only DECIDES a dispute; the money then moves by itself. Crypto and foreign transfers can't be reversed here — those come back as { automatic:false, reason } for a person.
async function refund(order, ctx = {}) {
  if (order.paymentProvider === "jenga" || (order.paymentProvider === "bank_wire" && due(order).currency === "KES")) {
    const dd = due(order), phone = order.jengaPhone || ctx.phone;
    if (!jenga.payoutsOn()) return { ref: null, automatic: false, reason: "Equity payouts aren't switched on, so this refund must be sent by hand." };
    if (!phone) return { ref: null, automatic: false, reason: "There is no M-Pesa number to send the refund to." };
    if (dd.amount < jenga.MOBILE_MIN || dd.amount > jenga.MOBILE_MAX) return { ref: null, automatic: false, reason: `Equity can only send KES ${jenga.MOBILE_MIN}–${jenga.MOBILE_MAX.toLocaleString("en-US")} to an M-Pesa wallet; send this refund by hand.` };
    const ref = ("SOKR" + order.id).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 24); await jenga.ensureFunds(dd.amount);
    await jenga.sendMobile({ reference: ref, amount: dd.amount, phone: jenga.msisdn(phone), name: order.buyerName, description: "Sokoni refund", callbackUrl: jenga.urls().payout }); return { ref, automatic: true, pending: true };
  }
  if (order.paymentProvider === "paystack" && order.paymentMethod === "card") { // a card payment goes back to the CARD through Paystack's refund API — never to a phone; the answer arrives on Paystack's refund notification
    if (!order.providerRef) return { ref: null, automatic: false, reason: "This card payment has no Paystack reference, so it must be refunded from your Paystack dashboard." };
    const r = await paystack.refundCard({ ref: order.providerRef, amount: due(order).amount }); return r.done ? { ref: r.ref, automatic: true } : { ref: r.ref, automatic: true, pending: true };
  }
  if (order.paymentProvider === "paystack") { // Paystack refunds M-Pesa payments only by e-mail, so we send the money back to the M-Pesa number that PAID with a transfer; the answer arrives on Paystack's transfer notification (or our sweep)
    const dd = due(order), phone = order.paystackPhone || ctx.phone;
    if (!paystack.payoutsOn()) return { ref: null, automatic: false, reason: "Paystack payouts aren't switched on, so this refund must be sent by hand." };
    if (!phone) return { ref: null, automatic: false, reason: "There is no M-Pesa number to send the refund to." };
    if (dd.amount < paystack.MOBILE_MIN() || dd.amount > paystack.MOBILE_MAX()) return { ref: null, automatic: false, reason: `Paystack can only send KES ${paystack.MOBILE_MIN()}–${paystack.MOBILE_MAX().toLocaleString("en-US")} to an M-Pesa wallet; send this refund by hand.` };
    const r = await paystack.sendMobile({ ref: "sokrf-" + order.id, amount: dd.amount, phone, name: order.buyerName, narration: "Sokoni refund" }); return r.done ? { ref: r.ref, automatic: true } : { ref: r.ref, automatic: true, pending: true };
  }
  if (order.paymentProvider === "fincra") { // back to the M-Pesa number that paid; the answer arrives on Fincra's payout notification (or our sweep)
    const dd = due(order), phone = order.fincraPhone || ctx.phone;
    if (!fincra.payoutsOn()) return { ref: null, automatic: false, reason: "Fincra payouts aren't switched on, so this refund must be sent by hand." };
    if (!phone) return { ref: null, automatic: false, reason: "There is no M-Pesa number to send the refund to." };
    if (dd.amount < fincra.MOBILE_MIN() || dd.amount > fincra.MOBILE_MAX()) return { ref: null, automatic: false, reason: `Fincra can only send KES ${fincra.MOBILE_MIN()}–${fincra.MOBILE_MAX().toLocaleString("en-US")} to an M-Pesa wallet; send this refund by hand.` };
    const r = await fincra.sendMobile({ ref: "SOKRF-" + order.id, amount: dd.amount, phone, name: order.buyerName, narration: "Sokoni refund" }); return r.done ? { ref: r.ref, automatic: true } : { ref: r.ref, automatic: true, pending: true };
  }
  if (order.paymentProvider === "stripe" && order.providerPaymentId) { const f = new URLSearchParams(); const id = String(order.providerPaymentId); f.set(id.startsWith("pi_") ? "payment_intent" : "charge", id); const { r, d } = await sform("refunds", f); if (!r.ok) throw new Error((d.error && d.error.message) || "Refund failed"); return { ref: d.id, automatic: true }; }
  if (order.paymentProvider === "flutterwave" && order.providerPaymentId) { const { r, d } = await flw(`transactions/${encodeURIComponent(order.providerPaymentId)}/refund`, { method: "POST", body: JSON.stringify({ amount: due(order).amount }) }); if (!r.ok) throw new Error(d.message || "Refund failed"); return { ref: String((d.data && d.data.id) || ""), automatic: true }; }
  if (order.paymentProvider === "paypal" && order.providerPaymentId) { const { r, d } = await pp(`/v2/payments/captures/${encodeURIComponent(order.providerPaymentId)}/refund`, { method: "POST", body: {}, reqId: "refund-" + order.id }); if (!r.ok) throw new Error((d.details && d.details[0] && d.details[0].description) || d.message || "Refund failed"); return { ref: d.id, automatic: true }; }
  if (order.paymentProvider === "test") return { ref: "test-refund", automatic: true };
  if (order.paymentProvider === "nowpayments") return { ref: null, automatic: false, reason: "Crypto payments can't be reversed from here: send the USDC back from your NOWPayments or wallet balance to the address the buyer paid from." };
  return { ref: null, automatic: false };
}
// Read-only credential checks used by the Operations console ("Test connection"). Nothing is charged or sent.
async function testConnection(provider) {
  try {
    if (provider === "flutterwave") { if (!cfg.flutterwave()) return { ok: false, error: "Not set up — needs FLW_SECRET_KEY, FLW_SECRET_HASH and a public PUBLIC_BASE_URL." }; const { r, d } = await flw("balances"); if (!r.ok) return { ok: false, error: d.message || "Flutterwave rejected the key (HTTP " + r.status + ")." };
      const bal = (d.data || []).filter((b) => Number(b.available_balance) > 0 || ["KES", "UGX", "TZS", "USD", "NGN", "GHS"].includes(b.currency)).slice(0, 6).map((b) => `${b.currency} ${Number(b.available_balance).toLocaleString("en", { maximumFractionDigits: 2 })}`).join(" · "); return { ok: true, detail: "Key accepted. Available balance (what payouts are sent from): " + (bal || "none yet") }; }
    if (provider === "stripe") { if (!cfg.stripe()) return { ok: false, error: "Not set up — needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and a public PUBLIC_BASE_URL." }; const { r, d } = await sform("balance", null, "GET"); if (!r.ok) return { ok: false, error: (d.error && d.error.message) || "Stripe rejected the key." };
      return { ok: true, detail: "Key accepted. Available: " + ((d.available || []).map((b) => `${String(b.currency).toUpperCase()} ${(b.amount / 100).toFixed(2)}`).join(" · ") || "none yet") }; }
    if (provider === "nowpayments") { if (!cfg.nowpayments()) return { ok: false, error: "Not set up — needs NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET and a public PUBLIC_BASE_URL." };
      const st = await fetch(NP() + "/status").catch(() => null); if (!st || !st.ok) return { ok: false, error: "NOWPayments isn't reachable right now — try again in a minute." };
      const cn = await cryptoCoins(); if (!cn.ok) return { ok: false, error: cn.error }; const pinned = String(process.env.CRYPTO_PAY_CURRENCY || ""), mode = process.env.NOWPAYMENTS_SANDBOX === "1" ? "sandbox — practice coins" : "live";
      const usdcTxt = cn.source === "enabled" ? (cn.usdc.length ? `USDC networks you have enabled: ${cn.usdc.join(", ")}.` : "⚠ USDC is NOT enabled on your NOWPayments account — switch it on in NOWPayments → Settings → Payments → Coins, otherwise buyers can only pay with other coins.") : `${cn.coins.length} coins exist; I couldn't read which ones you enabled — check that USDC is switched on in NOWPayments → Settings → Payments → Coins.`;
      return { ok: true, detail: `Key accepted (${mode}). ${usdcTxt}${pinned ? ` Buyers are pinned to ${pinned}.` : ""}`, usdc: cn.usdc, coins: cn.coins.length }; }
    if (provider === "wire") { const need = [["WIRE_ACCOUNT_NAME", "account holder name"], ["WIRE_BANK_NAME", "bank name"], ["WIRE_ACCOUNT_NUMBER", "account number / IBAN"]].filter(([k]) => !process.env[k]).map((x) => x[1]); if (!process.env.WIRE_SWIFT && !process.env.WIRE_ROUTING) need.push("SWIFT/BIC or ACH routing number"); return need.length ? { ok: false, error: "Not complete — still needs: " + need.join(", ") + "." } : { ok: true, detail: `Bank details are complete (${list(process.env.WIRE_CURRENCIES, "USD").join(", ")}). Buyers will be shown these details with a unique reference. ` + (process.env.WIRE_WEBHOOK_SECRET ? "Automatic arrival notifications are enabled." : "No arrival-notification secret set — you will confirm arrivals in the console.") }; }
    if (provider === "paypal") { if (!cfg.paypal()) return { ok: false, error: "Not set up — needs a PayPal client ID, client secret and a public PUBLIC_BASE_URL." }; await ppToken(); return { ok: true, detail: `PayPal accepted the credentials (${process.env.PAYPAL_ENV === "live" ? "live" : "sandbox"}).` + (process.env.PAYPAL_WEBHOOK_ID ? " Webhook signature checking is on." : " Tip: add the webhook ID to also verify webhook signatures.") }; }
    if (provider === "mpesa") { if (!cfg.mpesa()) return { ok: false, error: "Not set up — needs MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY and MPESA_CALLBACK_BASE_URL." }; const r = await mpesa.checkCredentials(); return { ok: true, detail: `Safaricom accepted the credentials (${r.env}).` + (mpesa.isPayoutConfigured() ? " Payouts (B2C) are configured." : " Payouts (B2C) are not configured.") }; }
    if (provider === "paystack") return await paystack.testConnection();
    if (provider === "fincra") return await fincra.testConnection();
    if (provider === "jenga") return await jenga.testConnection();
    return { ok: false, error: "Unknown provider." };
  } catch (e) { return { ok: false, error: e.message || "Connection failed." }; }
}
module.exports = { cryptoPaymentById, equityPaybill, manualKind, NP, STABLE, cryptoMinUsd, cryptoTolerance, cryptoPaidUsd, cryptoCoins, equityWire, wireIsEquity, mpesaProvider, mpesaMax, core, showMode, payoutWaitDays, quote, quoteSync, due, paypalSync, verifyPaypalWebhook, PAYPAL_CURRENCIES, wireDetails, wireQuote, wireMatches, verifyWireSignature, wireExpiryDays, testConnection, chargeOf, METHODS, optionsFor, allOptions, routeFor, cfg, createCheckout, pollStatus, refund, minorUnits, verifyStripeSignature, verifyNowSignature, flutterwaveVerify, FLW_CURRENCIES };
