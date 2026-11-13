// Sokoni backend (global). Zero npm dependencies — run with `node server.js`. See README.md.
require("./lib/env");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const store = require("./lib/store");
const { hashPassword, verifyPassword, signToken, verifyToken, hmac } = require("./lib/auth");
const mpesa = require("./lib/mpesa");
const vision = require("./lib/vision");
const { haversineKm } = require("./lib/geo");
const geo = require("./lib/countries"), delivery = require("./lib/delivery"), economics = require("./lib/economics"), dataset = require("./lib/dataset"), webpush = require("./lib/webpush"), analytics = require("./lib/analytics"), networks = require("./lib/networks"), build = require("./lib/build");
const pushTo = (userId, p) => { try { if (userId) webpush.notify(userId, p).catch(() => {}); } catch (e) { /* a notification must never break the action that caused it */ } }; // fire-and-forget
const catalog = require("./lib/catalog");
const fx = require("./lib/fx");
const payments = require("./lib/payments");
const i18n = require("./lib/i18n");
const langs = require("./lib/languages");
const trust = require("./lib/trust");
const payouts = require("./lib/payouts");
const places = require("./lib/places");
const ai = require("./lib/ai");
const dial = require("./lib/dialcodes");
const passwordPolicy = require("./lib/password");
const notify = require("./lib/notify");
const otp = require("./lib/otp");
const bankmatch = require("./lib/bankmatch");
const jenga = require("./lib/jenga"); const fincra = require("./lib/fincra"); const paystack = require("./lib/paystack");
const backup = require("./lib/backup");
const settings = require("./lib/settings"); settings.applyAll(); // keys saved in Operations → Payment setup (decrypted into the environment)
const bankDir = require("./lib/banks");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOADS_DIR = path.join(process.env.SOKONI_DATA_DIR || path.join(__dirname, "data"), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COMMISSION = Number(process.env.PLATFORM_COMMISSION_PERCENT || 7); // 7% gross ≈ 5% NET after typical provider, payout and coin costs (see PRICING.md; Operations → Economics shows the real figure)
const AUTO_RELEASE_DAYS = Number(process.env.AUTO_RELEASE_DAYS || 3);
const RIDER_RADIUS_KM = Number(process.env.RIDER_MATCH_RADIUS_KM || 20);
const RIDER_BASE_USD = Number(process.env.RIDER_BASE_FEE_USD || 0.8);
const RIDER_PER_KM_USD = Number(process.env.RIDER_PER_KM_USD || 0.2);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
// Trade is open to every country by default. Operators can list ISO codes they are legally unable to serve (e.g. sanctions).
const coverage = require("./lib/coverage");
const BLOCKED = coverage.blockedSet(); // BLOCKED_COUNTRIES + the four comprehensively sanctioned countries (turn the defaults off with SANCTIONS_DEFAULTS=off, only on legal advice)
const BLOCKED_MSG = "Sokoni can't serve this country at the moment.";
const VEHICLES = ["Bicycle", "Motorbike (boda)", "Tuk-tuk", "Car / van", "Pickup truck"];
// Payment states in which both parties are committed (funds are held) and contact details may be shared.
const HELD = ["escrowed", "payout_pending", "payout_initiated", "paid_out", "payout_failed"];
const SELF_PICKUP_DAYS = Number(process.env.SELF_PICKUP_RELEASE_DAYS || 7);
const code6 = () => String(crypto.randomInt(100000, 1000000));
const evt = (provider, type, orderId, status, detail) => store.mutate("provider_events", (all) => [...all.slice(-1999), { id: crypto.randomUUID(), at: new Date().toISOString(), provider, type, orderId: orderId || null, status, detail: String(detail || "").slice(0, 300) }]);

// ---------- helpers ----------
const sendJSON = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
function readBody(req, maxBytes = 1e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > maxBytes) { reject(new Error("Body too large")); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => { const raw = Buffer.concat(chunks).toString("utf8").trim(); if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}
function readRaw(req, max = 1e6) { return new Promise((resolve, reject) => { const c = []; let n = 0; req.on("data", (d) => { n += d.length; if (n > max) { reject(new Error("Body too large")); req.destroy(); return; } c.push(d); }); req.on("end", () => resolve(Buffer.concat(c))); req.on("error", reject); }); }
const clean = (s, max = 500) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const cleanPhone = (p) => clean(p, 30).replace(/[\s()-]/g, "");
const validPhone = (p) => /^\+?[0-9]{7,16}$/.test(p);
const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
// Keeps contact details out of public text and pre-payment chat (best effort — people can still try to evade it).
function maskContacts(text) { // contact details are never shared on Sokoni, so this applies to every message and note
  return String(text || "")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[contact hidden]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[contact hidden]")
    .replace(/\b(whats\s?app|telegram|signal|viber|wechat|imo)\b/gi, "[contact hidden]");
}
const sessionsFrom = new Map(); for (const u of store.readAll("users")) if (u.sessionsFrom) sessionsFrom.set(u.id, u.sessionsFrom); // password changed at this time → older sessions are void
function getAuthUser(req) {
  const h = req.headers["authorization"] || "";
  const p = verifyToken(h.startsWith("Bearer ") ? h.slice(7) : null);
  if (p && (Number(p.iat) || 0) < (sessionsFrom.get(p.sub) || 0)) return null;
  return p ? { id: p.sub, name: p.name, isRider: !!p.isRider, isCarrier: !!p.isCarrier } : null;
}
function requireAuth(req, res) { const u = getAuthUser(req); if (!u) { sendJSON(res, 401, { error: "Please sign in." }); return null; } return u; }
function requireRider(req, res) { const u = requireAuth(req, res); if (!u) return null; if (!u.isRider) { sendJSON(res, 403, { error: "This action is for registered local delivery riders only." }); return null; } return u; }
function requireCarrier(req, res) { const u = requireAuth(req, res); if (!u) return null; if (!u.isCarrier) { sendJSON(res, 403, { error: "This action is for registered freight carriers only." }); return null; } return u; }
// ---- keeping the admin console private ----
// The sign-in PAGE is just a file; what protects the console is the admin password, which every admin request must carry. On top of that:
//  · a wrong password is limited: ADMIN_MAX_FAILS (8) wrong guesses from one address block that address for ADMIN_LOCK_MINUTES (15). Asking with NO password never counts.
//  · ADMIN_PATH=/some-secret-name.html moves the page there (and /admin.html then says "Not found").
//  · ADMIN_ALLOWED_IPS=1.2.3.4,5.6.7.8 makes the page AND every admin request answer "Not found" to everyone else.
//  · behind a proxy such as Cloudflare, set TRUST_PROXY=1 so the real visitor address is used; otherwise forwarded headers are ignored (they can be faked).
// Which address is "the visitor"? Only trust a header your own proxy sets: TRUST_PROXY=1 behind Caddy / nginx (the LAST address in X-Forwarded-For, added by your proxy),
// TRUST_PROXY=cloudflare behind Cloudflare ONLY (it uses CF-Connecting-IP, which anyone can fake if traffic can reach your server without going through Cloudflare).
const adminKey = (req) => { const tp = String(process.env.TRUST_PROXY || ""), xff = String(req.headers["x-forwarded-for"] || "").split(",").map((x) => x.trim()).filter(Boolean);
  const ip = tp === "cloudflare" ? String(req.headers["cf-connecting-ip"] || "").trim() || xff[xff.length - 1] : tp === "1" ? xff[xff.length - 1] : ""; return String(ip || req.socket.remoteAddress || "").replace(/^::ffff:/, ""); };
const adminIpOk = (req) => { const list = String(process.env.ADMIN_ALLOWED_IPS || "").split(/[\s,;]+/).filter(Boolean).map((x) => x.replace(/^::ffff:/, "")); return !list.length || list.includes(adminKey(req)); };
const adminSecretPath = () => { const x = String(process.env.ADMIN_PATH || "").trim(); return /^\/[A-Za-z0-9._-]{6,60}$/.test(x) && x !== "/admin.html" ? x : null; };
const ADMIN_PATH_EXAMPLE = "/ops-k3x9q2m.html"; // the example printed in the documentation: anyone who has read it knows it, so it must not be used
function adminPathStatus() { // what the ADMIN_PATH setting is actually doing
  const raw = String(process.env.ADMIN_PATH || "").trim(); if (!raw) return { state: "default", message: "The admin page is at /admin.html, which anyone can open (it still needs your admin password)." };
  const ok = adminSecretPath(); if (!ok) return { state: "invalid", message: `ADMIN_PATH “${raw}” was IGNORED — it must start with / and be 6–60 letters, digits, dots or dashes (like /ops-5f3a9c1d2b7e4f60.html). /admin.html is still public.` };
  if (ok === ADMIN_PATH_EXAMPLE) return { state: "example", path: ok, message: `ADMIN_PATH is the example from the documentation, which anyone who has read it knows. Make your own: node -e "console.log('ADMIN_PATH=/ops-' + require('crypto').randomBytes(8).toString('hex') + '.html')"` };
  return { state: "secret", path: ok, message: `The admin console is at ${ok}; /admin.html now says “Not found”.` };
}
const adminFails = new Map();
function requireAdmin(req, res) {
  if (!ADMIN_TOKEN) { sendJSON(res, 503, { error: "Admin is disabled: set the ADMIN_TOKEN environment variable." }); return false; }
  if (!adminIpOk(req)) { sendJSON(res, 404, { error: "Not found" }); return false; }
  const key = adminKey(req), now = Date.now(), f = adminFails.get(key); if (f && f.until > now) { sendJSON(res, 429, { error: `Too many wrong passwords. Try again in ${Math.ceil((f.until - now) / 60000)} minute(s).` }); return false; }
  const given = Buffer.from(String(req.headers["x-admin-token"] || "")); const want = Buffer.from(ADMIN_TOKEN);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    // (a lock that has run out starts the count again)
    if (given.length) { const n = (f && !(f.until > 0 && f.until <= now) ? f.n : 0) + 1, max = Number(process.env.ADMIN_MAX_FAILS) || 8, mins = Number(process.env.ADMIN_LOCK_MINUTES) || 15; if (adminFails.size > 5000) adminFails.clear(); adminFails.set(key, n >= max ? { n: 0, until: now + mins * 60000 } : { n, until: 0 }); if (n >= max) console.error(`⚠ ${max} wrong admin passwords from ${key} — that address is blocked for ${mins} minutes.`); }
    sendJSON(res, 401, { error: "Invalid admin token." }); return false;
  }
  adminFails.delete(key); return true;
}
const stripD = (d) => { const v = { ...d }; delete v.riderPhone; delete v.offeredTo; delete v.declinedBy; delete v.riderPayoutError; delete v.riderConversationId; return v; };
const userById = (uid) => store.readAll("users").find((u) => u.id === uid);
const PRIVATE_DIR = path.join(process.env.SOKONI_DATA_DIR || path.join(__dirname, "data"), "private"); fs.mkdirSync(PRIVATE_DIR, { recursive: true });
const DOC_TYPES = new Set(["registration", "tax", "id", "other"]);
const displayName = (u) => (u && u.kind === "company" && u.company && u.company.legalName) || (u && u.name) || "";
const verifiedOf = (u) => !!(u && u.kind === "company" && u.company && u.company.verification && u.company.verification.status === "verified");
const partyOf = (u) => (u ? { kind: u.kind || "individual", name: displayName(u), verified: verifiedOf(u), businessType: u.kind === "company" && u.company ? u.company.businessType : null, country: u.country } : null);
const companyView = (u) => { const c = u.company; return c ? { legalName: c.legalName, businessType: c.businessType, regNumber: c.regNumber || "", taxId: c.taxId || "", verification: c.verification || { status: "none" }, docs: (c.docs || []).map((d) => ({ id: d.id, type: d.type, filename: d.filename, uploadedAt: d.uploadedAt })) } : null; };
// who may see / order a listing: everyone, any company, or verified companies only
const AUDIENCES = ["everyone", "companies", "verified_companies"];
const canSee = (l, vu) => { const a = l.audience || "everyone"; return a === "everyone" || (a === "companies" && !!vu && vu.kind === "company") || (a === "verified_companies" && verifiedOf(vu)); };
const publicUser = (u) => ({ id: u.id, kind: u.kind || "individual", company: companyView(u), name: u.name, phone: u.phone, email: u.email || "", country: u.country, isRider: !!u.isRider, isCarrier: !!u.isCarrier, vehicleType: u.vehicleType || null, plateNumber: u.plateNumber || null, companyName: u.companyName || null, modes: u.modes || [], servedCountries: u.servedCountries || [], servesAll: !!u.servesAll, payout: maskPayout(u.payout), emailVerified: !!u.emailVerified, phoneVerified: !!u.phoneVerified, vehicle: u.isRider ? vehicleView(u) : null });
async function patchOrder(oid, patch) { let out = null; const real = Object.keys(patch || {}).length > 0; await store.mutate("orders", (all) => all.map((o) => { if (o.id !== oid) return o; out = { ...o, ...patch, ...(real ? { updatedAt: now() } : {}) }; return out; })); if (out) await ledgerSyncOrder(out).catch((e) => console.error("ledger:", e.message)); return out; }
// "Seen" tracking for the Orders badge: an order is NEW to you until you open it; any later change makes it new again
async function markSeen(uid, oid) { const at = now(); await store.mutate("order_views", (all) => all.some((v) => v.userId === uid && v.orderId === oid) ? all.map((v) => (v.userId === uid && v.orderId === oid ? { ...v, at } : v)) : [...all, { userId: uid, orderId: oid, at }]); }
async function orderSeen(req, res, m) { const p = partyOrder(req, res, m[1]); if (!p) return; await markSeen(p.u.id, p.o.id); sendJSON(res, 200, { ok: true }); }

const mk = (v, keep = 3) => { const s = String(v || ""); return s.length <= keep ? "•".repeat(s.length) : "•".repeat(Math.min(6, s.length - keep)) + s.slice(-keep); };
function maskPayout(p) { // what the browser may see: enough to recognise the method, never the full number/address
  if (!p || !p.type) return null; const base = { type: p.type, set: true };
  if (p.type === "mpesa") return { ...base, summary: `${String(p.phone).slice(0, 4)}${mk(p.phone)}` };
  if (p.type === "mobile_money") return { ...base, network: p.network, country: p.country, summary: `${p.network} ${String(p.phone).slice(0, 4)}${mk(p.phone)}` };
  if (p.type === "bank") return { ...base, country: p.country, bankName: p.bankName, summary: `${p.bankName} · ${mk(p.accountNumber, 4)}` };
  if (p.type === "swift") return { ...base, country: p.country, bankName: p.bankName, currency: p.currency, summary: `${p.bankName} · SWIFT ${p.swift} · ${mk(p.accountNumber, 4)}` };
  if (p.type === "crypto") return { ...base, network: p.network, summary: `${p.network} · ${String(p.address).slice(0, 4)}…${String(p.address).slice(-4)}` };
  return { ...base, summary: p.type };
}
function cleanPayout(q) {
  if (!q || !q.type) return { payout: null }; const cc = clean(q.country, 2).toUpperCase(), nm = clean(q.accountName, 120), acct = clean(q.accountNumber, 40).replace(/\s/g, "");
  if (q.type === "mpesa") { const ph = cleanPhone(q.phone); return validPhone(ph) ? { payout: { type: "mpesa", phone: ph } } : { error: "Enter a valid M-Pesa phone number in international format." }; }
  if (q.type === "mobile_money") { const ph = cleanPhone(q.phone), net = clean(q.network, 60); return net && validPhone(ph) ? { payout: { type: "mobile_money", country: cc, network: net, phone: ph, accountName: nm } } : { error: "Enter the mobile-money network and phone number." }; }
  if (q.type === "bank") { if (!geo.COUNTRY_CODES.has(cc) || !clean(q.bankName, 120) || acct.length < 4 || !nm) return { error: "Enter the country, bank, account number and account name." }; return { payout: { type: "bank", country: cc, bankName: clean(q.bankName, 120), bankCode: clean(q.bankCode, 60), accountNumber: acct, accountName: nm } }; }
  if (q.type === "swift") { const sw = clean(q.swift, 11).toUpperCase(); if (!geo.COUNTRY_CODES.has(cc) || !clean(q.bankName, 120) || !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(sw) || acct.length < 5 || !nm) return { error: "Enter the bank, SWIFT/BIC code (8 or 11 characters), IBAN or account number, and account name." }; return { payout: { type: "swift", country: cc, bankName: clean(q.bankName, 120), swift: sw, accountNumber: acct, accountName: nm, currency: clean(q.currency, 3).toUpperCase() } }; }
  if (q.type === "crypto") { const addr = clean(q.address, 120); if (!clean(q.network, 30) || addr.length < 20) return { error: "Enter the network (e.g. USDT-TRC20) and a valid wallet address." }; return { payout: { type: "crypto", network: clean(q.network, 30), address: addr, memo: clean(q.memo, 60) } }; }
  return { error: "Unsupported payout method." };
}
// ---------- auth & account ----------
const attempts = new Map(); // in-memory throttle buckets
const waitMinutes = (key, max, windowMs) => { const t = Date.now(), a = (attempts.get(key) || []).filter((x) => t - x < windowMs); attempts.set(key, a); if (attempts.size > 20000) attempts.clear(); return a.length >= max ? Math.max(1, Math.ceil((windowMs - (t - a[0])) / 60000)) : 0; };
const noteAttempt = (key) => { const a = attempts.get(key) || []; a.push(Date.now()); attempts.set(key, a); };
// ---------- accounts: sign-up verifies BOTH email and phone; every login needs a second factor (code by SMS, or email) ----------
// Sign-in codes (SMS + email) switch themselves ON — automatically — once BOTH an SMS provider and an email provider are connected AND you have sent yourself a successful test through each
// (Payment setup → "Send a test"). The test is a safety catch: a mistyped key would otherwise switch codes on, none would arrive, and every user would be locked out.
// Until then a password is the only check. VERIFY_CODES=1 forces codes on (e.g. with DEV_OTP for local testing); VERIFY_CODES=0 forces them off.
const codesMode = () => { const v = String(process.env.VERIFY_CODES || "").trim().toLowerCase(); return ["1", "on", "true"].includes(v) ? "on" : ["0", "off", "false"].includes(v) ? "off" : "auto"; };
const commsProvider = (ch) => (ch === "sms" ? notify.smsProvider() : notify.emailProvider()), commsVerified = (ch) => { const p = commsProvider(ch); return !!p && store.readAll("comms_ok").some((x) => x.channel === ch && x.provider === p); };
const markCommsOk = (ch) => store.mutate("comms_ok", (all) => [...all.filter((x) => x.channel !== ch), { channel: ch, provider: commsProvider(ch), at: new Date().toISOString() }]);
const codesOn = () => { const m = codesMode(); return m === "on" || (m === "auto" && commsVerified("sms") && commsVerified("email")); };
const OTP_MIN = 10, PENDING_MIN = 20, MAX_CODE_TRIES = 5, resendGapMs = () => Number(process.env.OTP_RESEND_GAP_SECONDS == null || process.env.OTP_RESEND_GAP_SECONDS === "" ? 30 : process.env.OTP_RESEND_GAP_SECONDS) * 1000, MAX_RESENDS = 4;
const emailOk = (e) => e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const plateKey = (p) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const vehicleVerified = (u) => !!(u && u.vehicle && u.vehicle.verification && u.vehicle.verification.status === "verified");
const vehicleView = (u) => (u && u.vehicle ? { type: u.vehicle.type, plate: u.vehicle.plate, makeModel: u.vehicle.makeModel, verification: { status: u.vehicle.verification.status, note: u.vehicle.verification.note || "" } } : null);
// send one code; hourly caps per destination protect your SMS bill and stop people being spammed
async function sendCode(channel, to, code, why) {
  const key = "otp:" + channel + ":" + to, w = waitMinutes(key, 6, 3600e3); if (w) return { ok: false, error: `Too many codes were sent to this ${channel === "sms" ? "number" : "address"}. Try again in ${w} minute(s).`, limited: true }; noteAttempt(key);
  if (channel === "sms") return notify.sendSms(to, notify.codeSms(code)); const m = notify.codeEmail(code, why); return notify.sendEmail(to, m.subject, m.text);
}
const sendFailure = (r, channel) => { if (r.limited) return r.error; if (!r.provider) { console.error(`No ${channel} provider connected — nobody can receive codes. Set one up in Operations → Payment setup.`); return "We can't send verification messages right now. Please contact support."; } return `We couldn't send the ${channel === "sms" ? "SMS" : "email"} (${r.error}). Check it and try again.`; };
const devCodes = (rs, codes) => { const o = {}; if (rs.sms && rs.sms.provider === "console") o.sms = codes.sms; if (rs.email && rs.email.provider === "console") o.email = codes.email; return Object.keys(o).length ? o : undefined; };
async function prunePending() {
  const old = store.readAll("pending_signups").filter((p) => p.expiresAt < Date.now()); if (!old.length) return;
  for (const p of old) { try { fs.unlinkSync(path.join(PRIVATE_DIR, `veh-pending-${p.id}.jpg`)); } catch (e) { /* gone */ } }
  await store.mutate("pending_signups", (all) => all.filter((p) => p.expiresAt >= Date.now())); await store.mutate("mfa_challenges", (all) => all.filter((c) => c.expiresAt >= Date.now()));
}
async function signup(req, res) {
  const ipk = "s:" + clientIp(req); { const w = waitMinutes(ipk, Number(process.env.SIGNUP_PER_HOUR || 60), 3600e3); if (w) return sendJSON(res, 429, { error: `Too many sign-ups from this connection. Try again in ${w} minute(s).` }); } noteAttempt(ipk);
  const b = await readBody(req, 4e6); await prunePending();
  const name = clean(b.name, 120), password = typeof b.password === "string" ? b.password : "", country = clean(b.country, 2).toUpperCase();
  const accountType = ["trader", "rider", "carrier"].includes(b.accountType) ? b.accountType : "trader";
  if (!name) return sendJSON(res, 400, { error: "Please enter your name." });
  if (!geo.COUNTRY_CODES.has(country)) return sendJSON(res, 400, { error: "Please choose your country." });
  if (BLOCKED.has(country)) return sendJSON(res, 403, { error: BLOCKED_MSG });
  const phone = dial.normalizePhone(b.phone, country); if (!dial.validE164(phone)) return sendJSON(res, 400, { error: "Please enter a valid phone number, e.g. +254 712 345 678." });
  const email = clean(b.email, 120).toLowerCase(); if (!emailOk(email)) return sendJSON(res, 400, { error: "Please enter a valid email address — we send a verification code to it." });
  const pw = passwordPolicy.problems(password, [name, email.split("@")[0], phone]); if (pw.length) return sendJSON(res, 400, { error: "Your password isn't strong enough: " + pw.join("; ") + ".", problems: pw });
  const user = { id: id(), name, phone, email, country, passwordHash: hashPassword(password), isRider: false, isCarrier: false, kind: "individual", emailVerified: false, phoneVerified: false };
  if (accountType === "trader" && b.kind === "company") { const c = b.company || {}, legalName = clean(c.legalName, 120), bt = clean(c.businessType, 30);
    if (!legalName) return sendJSON(res, 400, { error: "Please enter your company or cooperative name." }); if (!catalog.BUSINESS_TYPE_IDS.has(bt)) return sendJSON(res, 400, { error: "Please choose a business type." });
    Object.assign(user, { kind: "company", company: { legalName, businessType: bt, regNumber: clean(c.regNumber, 60), taxId: clean(c.taxId, 60), verification: { status: "none" }, docs: [] } }); }
  let vehicleTmp = null, photoBuf = null;
  if (accountType === "rider") {
    const vtype = clean(b.vehicleType, 40), needPlate = vtype !== "Bicycle", plate = plateKey(b.plateNumber), make = clean(b.vehicleMake, 80);
    if (!VEHICLES.includes(vtype)) return sendJSON(res, 400, { error: "Please select a valid vehicle type." });
    if (needPlate && (plate.length < 3 || plate.length > 10)) return sendJSON(res, 400, { error: "Enter your vehicle's number plate." });
    if (make.length < 2) return sendJSON(res, 400, { error: "Enter your vehicle's make, model and colour." });
    if (b.contractAccepted !== true) return sendJSON(res, 400, { error: "You must accept the rider agreement to register as a delivery rider." });
    const ph = checkVehiclePhoto(await trust.consumeAnon(b.captureToken), b.vehiclePhoto); if (ph.error) return sendJSON(res, 400, { error: ph.error });
    photoBuf = ph.buf; vehicleTmp = { type: vtype, plate: needPlate ? plate : "", makeModel: make, photoSha: ph.hash, photoAt: new Date(ph.at).toISOString() };
    Object.assign(user, { isRider: true, vehicleType: vtype, plateNumber: needPlate ? plate : "", contractAcceptedAt: now() });
  }
  if (accountType === "carrier") {
    const modes = Array.isArray(b.modes) ? b.modes.filter((m) => catalog.MODE_IDS.has(m)) : [], servesAll = b.servesAll === true;
    const served = Array.isArray(b.servedCountries) ? b.servedCountries.map((c) => String(c).toUpperCase()).filter((c) => geo.COUNTRY_CODES.has(c)) : [];
    if (!clean(b.companyName, 120)) return sendJSON(res, 400, { error: "Please enter your company or business name." });
    if (!clean(b.licenseNumber, 60)) return sendJSON(res, 400, { error: "Enter your transport licence or registration number." });
    if (!modes.length) return sendJSON(res, 400, { error: "Select at least one transport mode you operate." });
    if (!servesAll && !served.length) return sendJSON(res, 400, { error: "Select the countries you serve (or tick 'all countries')." });
    if (b.contractAccepted !== true) return sendJSON(res, 400, { error: "You must accept the carrier agreement." });
    Object.assign(user, { isCarrier: true, companyName: clean(b.companyName, 120), licenseNumber: clean(b.licenseNumber, 60), modes, servesAll, servedCountries: served, contractAcceptedAt: now() });
  }
  if (store.readAll("users").some((u) => u.phone === phone || String(u.email || "").toLowerCase() === email)) return sendJSON(res, 409, { error: "An account with this phone number or email already exists. Try logging in instead." });
  if (!codesOn()) { user.createdAt = now(); const out = await createAccount(user, vehicleTmp, photoBuf); return sendJSON(res, 201, { token: issueToken(out), user: publicUser(out) }); } // codes switched off: phone and email are NOT verified
  const codes = { sms: otp.newCode(), email: otp.newCode() }, pid = id();
  const [rs, re] = await Promise.all([sendCode("sms", phone, codes.sms), sendCode("email", email, codes.email)]);
  if (!rs.ok || !re.ok) return sendJSON(res, rs.limited || re.limited ? 429 : 502, { error: !rs.ok ? sendFailure(rs, "sms") : sendFailure(re, "email"), code: "SEND_FAILED" });
  if (photoBuf) fs.writeFileSync(path.join(PRIVATE_DIR, `veh-pending-${pid}.jpg`), photoBuf);
  await store.mutate("pending_signups", (all) => [...all, { id: pid, createdAt: now(), expiresAt: Date.now() + PENDING_MIN * 60000, tries: 0, sends: { sms: 1, email: 1 }, lastSendAt: Date.now(), smsHash: otp.hashCode(pid, "sms", codes.sms), emailHash: otp.hashCode(pid, "email", codes.email), user, vehicleTmp }]);
  sendJSON(res, 202, { verify: true, pendingId: pid, phone: dial.maskPhone(phone), email: dial.maskEmail(email), minutes: OTP_MIN, devCodes: devCodes({ sms: rs, email: re }, codes) });
}
// the vehicle photo for riders: live-captured, fresh, never used before (see lib/trust.js)
const checkVehiclePhoto = (session, photo, ownSha) => trust.checkOnePhoto(session, photo, ownSha);
async function decideVehicle(typed, photoBuf) { // → { status: verified | pending | rejected, note, plateRead }
  const needPlate = !!typed.plate, r = await vision.readPlate({ photo: photoBuf.toString("base64") }).catch(() => null);
  if (!r) return { status: "pending", note: "Waiting for a quick review of your vehicle photo.", plateRead: "" };
  if (r.screenOrPrint) return { status: "pending", note: "The photo looks like a picture of a screen or print — a person will review it.", plateRead: r.plate };
  if (!r.vehicleVisible) return { status: "rejected", note: "We couldn't see your vehicle in the photo. Take a new photo of the whole vehicle with the plate visible.", plateRead: "" };
  if (!needPlate) return { status: "verified", note: "", plateRead: "" };
  if (!r.plateVisible || !r.plate) return { status: "rejected", note: "We couldn't read the number plate. Take a new photo, closer, with the plate in focus and well lit.", plateRead: "" };
  if (r.plate === typed.plate) return { status: "verified", note: "", plateRead: r.plate };
  return { status: "pending", note: `The plate in the photo (${r.plate}) doesn't match the one you entered — a person will review it.`, plateRead: r.plate };
}
const issueToken = (u) => signToken({ sub: u.id, name: u.name, isRider: !!u.isRider, isCarrier: !!u.isCarrier, iat: Date.now(), exp: Date.now() + TOKEN_TTL_MS });
async function createAccount(user, vt, photoBuf) { // the same steps signupVerify does, for sign-ups that need no code
  if (vt) { const dec = await decideVehicle(vt, photoBuf), file = `veh-${user.id}.jpg`; fs.writeFileSync(path.join(PRIVATE_DIR, file), photoBuf); await store.mutate("vehicle_photos", (all) => [...all, { sha: vt.photoSha, userId: user.id }]);
    user.vehicle = { type: vt.type, plate: vt.plate, makeModel: vt.makeModel, photoFile: file, photoSha: vt.photoSha, photoAt: vt.photoAt, verification: { status: dec.status, note: dec.note, plateRead: dec.plateRead, at: now() } }; }
  await store.mutate("users", (all) => [...all, user]); if (user.isRider) await store.mutate("rider_status", (all) => [...all, { riderId: user.id, online: false, lat: null, lng: null, updatedAt: null, currentDeliveryId: null }]); return user;
}
async function signupVerify(req, res) {
  const b = await readBody(req), pid = clean(b.pendingId, 60), p = store.readAll("pending_signups").find((x) => x.id === pid);
  if (!p || p.expiresAt < Date.now()) return sendJSON(res, 410, { error: "This sign-up expired. Please start again." });
  if (p.tries >= MAX_CODE_TRIES) { await store.mutate("pending_signups", (all) => all.filter((x) => x.id !== pid)); return sendJSON(res, 429, { error: "Too many wrong codes. Please start the sign-up again." }); }
  const okS = otp.matches(pid, "sms", b.smsCode, p.smsHash), okE = otp.matches(pid, "email", b.emailCode, p.emailHash);
  if (!okS || !okE) { await store.mutate("pending_signups", (all) => all.map((x) => (x.id === pid ? { ...x, tries: x.tries + 1 } : x))); return sendJSON(res, 400, { error: !okS && !okE ? "Both codes are incorrect." : !okS ? "The SMS code is incorrect." : "The email code is incorrect.", smsOk: okS, emailOk: okE, triesLeft: Math.max(0, MAX_CODE_TRIES - p.tries - 1) }); }
  const user = { ...p.user, emailVerified: true, phoneVerified: true, createdAt: now() };
  if (store.readAll("users").some((u) => u.phone === user.phone || String(u.email || "").toLowerCase() === user.email)) return sendJSON(res, 409, { error: "An account with this phone number or email already exists. Try logging in instead." });
  if (p.vehicleTmp) { const tmp = path.join(PRIVATE_DIR, `veh-pending-${pid}.jpg`), buf = fs.readFileSync(tmp), dec = await decideVehicle(p.vehicleTmp, buf), file = `veh-${user.id}.jpg`;
    fs.renameSync(tmp, path.join(PRIVATE_DIR, file)); await store.mutate("vehicle_photos", (all) => [...all, { sha: p.vehicleTmp.photoSha, userId: user.id }]);
    user.vehicle = { type: p.vehicleTmp.type, plate: p.vehicleTmp.plate, makeModel: p.vehicleTmp.makeModel, photoFile: file, photoSha: p.vehicleTmp.photoSha, photoAt: p.vehicleTmp.photoAt, verification: { status: dec.status, note: dec.note, plateRead: dec.plateRead, at: now() } }; }
  await store.mutate("users", (all) => [...all, user]); await store.mutate("pending_signups", (all) => all.filter((x) => x.id !== pid));
  if (user.isRider) await store.mutate("rider_status", (all) => [...all, { riderId: user.id, online: false, lat: null, lng: null, updatedAt: null, currentDeliveryId: null }]);
  sendJSON(res, 201, { token: issueToken(user), user: publicUser(user) });
}
async function resendCode(res, rec, channel, to, collection, why) { // shared by sign-up and login: a fresh code to one channel, rate-limited
  if (!["sms", "email"].includes(channel)) return sendJSON(res, 400, { error: "Choose SMS or email." });
  if (Date.now() - (rec.lastSendAt || 0) < resendGapMs()) return sendJSON(res, 429, { error: "Please wait a few seconds before asking for another code." });
  if ((rec.sends[channel] || 0) >= MAX_RESENDS) return sendJSON(res, 429, { error: "Too many codes requested. Please start again." });
  const code = otp.newCode(), r = await sendCode(channel, to, code, why); if (!r.ok) return sendJSON(res, r.limited ? 429 : 502, { error: sendFailure(r, channel) });
  const upd = { lastSendAt: Date.now(), expiresAt: Math.max(rec.expiresAt, Date.now() + OTP_MIN * 60000), sends: { ...rec.sends, [channel]: (rec.sends[channel] || 0) + 1 }, [channel === "sms" ? "smsHash" : "emailHash"]: otp.hashCode(rec.id, channel, code) };
  if (collection === "mfa_challenges" && !rec.enroll) upd.channel = channel; await store.mutate(collection, (all) => all.map((x) => (x.id === rec.id ? { ...x, ...upd } : x)));
  sendJSON(res, 200, { ok: true, channel, devCodes: r.provider === "console" ? { [channel]: code } : undefined });
}
async function signupResend(req, res) { const b = await readBody(req), p = store.readAll("pending_signups").find((x) => x.id === clean(b.pendingId, 60)); if (!p || p.expiresAt < Date.now()) return sendJSON(res, 410, { error: "This sign-up expired. Please start again." }); const ch = clean(b.channel, 8); await resendCode(res, p, ch, ch === "sms" ? p.user.phone : p.user.email, "pending_signups", "verification"); }
// ---------- forgotten or changed password ----------
const sessionsVoidNow = async (uid) => { const at = Date.now(); sessionsFrom.set(uid, at); await store.mutate("users", (all) => all.map((u) => (u.id === uid ? { ...u, sessionsFrom: at } : u))); };
const tellPasswordChanged = (u) => { notify.sendSms(u.phone, "Your Sokoni password was just changed. If this wasn't you, contact support now.").catch(() => {}); if (u.email) { const m = { subject: "Your Sokoni password was changed", text: "Your Sokoni password was just changed and you were signed out everywhere.\n\nIf this wasn't you, contact support immediately." }; notify.sendEmail(u.email, m.subject, m.text).catch(() => {}); } };
const NO_RESET = "Resetting a password needs sign-in codes, which are switched off right now. Please contact Sokoni support and we will reset it for you.";
async function passwordForgot(req, res) {
  if (!codesOn()) return sendJSON(res, 503, { error: NO_RESET, codesOff: true }); // same answer whether or not the account exists, so this can't be used to find out who has one
  const b = await readBody(req), idf = clean(b.identifier, 120), byEmail = idf.includes("@"), phone = byEmail ? "" : dial.normalizePhone(idf, clean(b.country, 2).toUpperCase()), key = "pf:" + (byEmail ? idf.toLowerCase() : phone), ik = "pfi:" + clientIp(req);
  const w = Math.max(waitMinutes(key, 5, 3600e3), waitMinutes(ik, 20, 3600e3)); if (w) return sendJSON(res, 429, { error: `Too many reset requests. Try again in ${w} minute(s).` }); noteAttempt(key); noteAttempt(ik);
  const rid = id(), generic = { ok: true, resetId: rid, minutes: OTP_MIN }; await prunePending(); await store.mutate("password_resets", (all) => all.filter((r) => r.expiresAt >= Date.now()));
  const user = store.readAll("users").find((u) => (byEmail ? String(u.email || "").toLowerCase() === idf.toLowerCase() : u.phone === phone));
  if (!user || !user.emailVerified || !user.phoneVerified || !user.email) return sendJSON(res, 200, generic); // nothing is sent, nothing is revealed
  const codes = { sms: otp.newCode(), email: otp.newCode() }, [rs, re] = await Promise.all([sendCode("sms", user.phone, codes.sms), sendCode("email", user.email, codes.email, "password reset")]);
  if (rs.ok && re.ok) await store.mutate("password_resets", (all) => [...all, { id: rid, userId: user.id, createdAt: now(), expiresAt: Date.now() + 15 * 60000, tries: 0, smsHash: otp.hashCode(rid, "sms", codes.sms), emailHash: otp.hashCode(rid, "email", codes.email) }]);
  sendJSON(res, 200, { ...generic, devCodes: rs.ok && re.ok ? devCodes({ sms: rs, email: re }, codes) : undefined });
}
async function passwordReset(req, res) {
  if (!codesOn()) return sendJSON(res, 503, { error: NO_RESET, codesOff: true });
  const b = await readBody(req), rid = clean(b.resetId, 60), r = store.readAll("password_resets").find((x) => x.id === rid), bad = () => sendJSON(res, 400, { error: "One or both codes are incorrect, or the request expired. Ask for new codes." });
  if (!r || r.expiresAt < Date.now()) return bad(); if (r.tries >= MAX_CODE_TRIES) { await store.mutate("password_resets", (all) => all.filter((x) => x.id !== rid)); return sendJSON(res, 429, { error: "Too many wrong codes. Ask for new codes." }); }
  if (!(otp.matches(rid, "sms", b.smsCode, r.smsHash) && otp.matches(rid, "email", b.emailCode, r.emailHash))) { await store.mutate("password_resets", (all) => all.map((x) => (x.id === rid ? { ...x, tries: x.tries + 1 } : x))); return bad(); }
  const user = userById(r.userId); if (!user) return bad(); const pw = passwordPolicy.problems(String(b.newPassword || ""), [user.name, String(user.email || "").split("@")[0], user.phone]); if (pw.length) return sendJSON(res, 400, { error: "Your new password isn't strong enough: " + pw.join("; ") + ".", problems: pw });
  await store.mutate("users", (all) => all.map((u) => (u.id === user.id ? { ...u, passwordHash: hashPassword(String(b.newPassword)) } : u))); await sessionsVoidNow(user.id); await store.mutate("password_resets", (all) => all.filter((x) => x.id !== rid)); tellPasswordChanged(user);
  sendJSON(res, 200, { ok: true });
}
async function passwordChange(req, res) { // signed in: needs the current password; every other session is signed out and you get a fresh one
  const a = requireAuth(req, res); if (!a) return; const b = await readBody(req), user = userById(a.id), k = "pc:" + a.id, w = waitMinutes(k, 8, 15 * 60000); if (w) return sendJSON(res, 429, { error: `Too many attempts. Try again in ${w} minute(s).` });
  if (!user || !verifyPassword(String(b.currentPassword || ""), user.passwordHash)) { noteAttempt(k); return sendJSON(res, 403, { error: "Your current password is incorrect." }); }
  const pw = passwordPolicy.problems(String(b.newPassword || ""), [user.name, String(user.email || "").split("@")[0], user.phone]); if (pw.length) return sendJSON(res, 400, { error: "Your new password isn't strong enough: " + pw.join("; ") + ".", problems: pw });
  if (verifyPassword(String(b.newPassword), user.passwordHash)) return sendJSON(res, 400, { error: "Choose a password you haven't used before." });
  let out = user; await store.mutate("users", (all) => all.map((u) => { if (u.id !== user.id) return u; out = { ...u, passwordHash: hashPassword(String(b.newPassword)) }; return out; })); await sessionsVoidNow(user.id); await new Promise((r) => setTimeout(r, 2)); tellPasswordChanged(user);
  sendJSON(res, 200, { token: issueToken(out), user: publicUser(out) });
}
async function login(req, res) {
  const b = await readBody(req), idf = clean(b.identifier || b.phone || b.email, 120), password = typeof b.password === "string" ? b.password : "";
  const byEmail = idf.includes("@"), phone = byEmail ? "" : dial.normalizePhone(idf, clean(b.country, 2).toUpperCase()), email = byEmail ? idf.toLowerCase() : "";
  const kp = (byEmail ? "le:" + email : "lp:" + phone), ki = "li:" + clientIp(req), wait = Math.max(waitMinutes(kp, 10, 15 * 60000), waitMinutes(ki, 40, 15 * 60000)); if (wait) return sendJSON(res, 429, { error: `Too many failed attempts. Try again in ${wait} minute(s).` });
  const user = store.readAll("users").find((u) => (byEmail ? String(u.email || "").toLowerCase() === email : u.phone === phone));
  if (!user || !verifyPassword(password, user.passwordHash)) { noteAttempt(kp); noteAttempt(ki); return sendJSON(res, 401, { error: "Phone, email or password is incorrect." }); }
  attempts.delete(kp); await prunePending();
  if (!codesOn()) return sendJSON(res, 200, { token: issueToken(user), user: publicUser(user) }); // codes switched off: password only
  const enroll = !(user.emailVerified && user.phoneVerified && user.email), cid = id(), rec = { id: cid, userId: user.id, createdAt: now(), expiresAt: Date.now() + OTP_MIN * 60000, tries: 0, enroll, channel: "sms", smsHash: null, emailHash: null, sends: { sms: 0, email: 0 }, lastSendAt: 0 };
  const masked = { sms: dial.maskPhone(user.phone), email: user.email ? dial.maskEmail(user.email) : "" };
  if (enroll && !user.email) { await store.mutate("mfa_challenges", (all) => [...all, rec]); return sendJSON(res, 200, { enroll: true, needEmail: true, mfaId: cid, masked }); } // older account: add an email first
  const codes = { sms: otp.newCode(), email: otp.newCode() }; let rs = null, re = null;
  if (enroll) { [rs, re] = await Promise.all([sendCode("sms", user.phone, codes.sms), sendCode("email", user.email, codes.email, "verification")]); if (!rs.ok || !re.ok) return sendJSON(res, 502, { error: !rs.ok ? sendFailure(rs, "sms") : sendFailure(re, "email") }); Object.assign(rec, { smsHash: otp.hashCode(cid, "sms", codes.sms), emailHash: otp.hashCode(cid, "email", codes.email), sends: { sms: 1, email: 1 }, lastSendAt: Date.now() }); }
  else { rs = await sendCode("sms", user.phone, codes.sms); if (rs.ok) Object.assign(rec, { smsHash: otp.hashCode(cid, "sms", codes.sms), sends: { sms: 1, email: 0 }, lastSendAt: Date.now() });
    else { re = await sendCode("email", user.email, codes.email, "sign-in"); if (!re.ok) return sendJSON(res, 502, { error: sendFailure(rs, "sms") }); Object.assign(rec, { channel: "email", emailHash: otp.hashCode(cid, "email", codes.email), sends: { sms: 0, email: 1 }, lastSendAt: Date.now() }); } }
  await store.mutate("mfa_challenges", (all) => [...all, rec]);
  sendJSON(res, 200, enroll ? { enroll: true, mfaId: cid, masked, devCodes: devCodes({ sms: rs, email: re }, codes) } : { mfa: true, mfaId: cid, channel: rec.channel, masked, devCodes: devCodes({ sms: rec.channel === "sms" ? rs : null, email: rec.channel === "email" ? re : null }, codes) });
}
async function loginVerify(req, res) {
  const b = await readBody(req), cid = clean(b.mfaId, 60), c = store.readAll("mfa_challenges").find((x) => x.id === cid);
  if (!c || c.expiresAt < Date.now()) return sendJSON(res, 410, { error: "This sign-in expired. Please log in again." });
  if (c.tries >= MAX_CODE_TRIES) { await store.mutate("mfa_challenges", (all) => all.filter((x) => x.id !== cid)); return sendJSON(res, 429, { error: "Too many wrong codes. Please log in again." }); }
  const user = userById(c.userId); if (!user) return sendJSON(res, 410, { error: "This sign-in expired. Please log in again." });
  const ok = c.enroll ? otp.matches(cid, "sms", b.smsCode, c.smsHash) && otp.matches(cid, "email", b.emailCode, c.emailHash) : otp.matches(cid, c.channel, b.code, c.channel === "sms" ? c.smsHash : c.emailHash);
  if (!ok) { await store.mutate("mfa_challenges", (all) => all.map((x) => (x.id === cid ? { ...x, tries: x.tries + 1 } : x))); return sendJSON(res, 400, { error: c.enroll ? "One or both codes are incorrect." : "That code is incorrect.", triesLeft: Math.max(0, MAX_CODE_TRIES - c.tries - 1) }); }
  let out = user; if (c.enroll) await store.mutate("users", (all) => all.map((u) => { if (u.id !== user.id) return u; out = { ...u, emailVerified: true, phoneVerified: true }; return out; }));
  await store.mutate("mfa_challenges", (all) => all.filter((x) => x.id !== cid)); sendJSON(res, 200, { token: issueToken(out), user: publicUser(out) });
}
async function loginResend(req, res) { const b = await readBody(req), c = store.readAll("mfa_challenges").find((x) => x.id === clean(b.mfaId, 60)); if (!c || c.expiresAt < Date.now()) return sendJSON(res, 410, { error: "This sign-in expired. Please log in again." }); const u = userById(c.userId), ch = clean(b.channel, 8); if (!u || (ch === "email" && !u.email)) return sendJSON(res, 400, { error: "No email on this account." }); await resendCode(res, c, ch, ch === "sms" ? u.phone : u.email, "mfa_challenges", "sign-in"); }
async function loginEnroll(req, res) { // older accounts without a verified email: add it, then verify both
  const b = await readBody(req), cid = clean(b.mfaId, 60), c = store.readAll("mfa_challenges").find((x) => x.id === cid); if (!c || c.expiresAt < Date.now() || !c.enroll) return sendJSON(res, 410, { error: "This sign-in expired. Please log in again." });
  const user = userById(c.userId), email = clean(b.email, 120).toLowerCase(); if (!user) return sendJSON(res, 410, { error: "This sign-in expired. Please log in again." }); if (!emailOk(email)) return sendJSON(res, 400, { error: "Please enter a valid email address." });
  if (store.readAll("users").some((u) => u.id !== user.id && String(u.email || "").toLowerCase() === email)) return sendJSON(res, 409, { error: "That email is already used by another account." });
  await store.mutate("users", (all) => all.map((u) => (u.id === user.id ? { ...u, email, emailVerified: false } : u)));
  const codes = { sms: otp.newCode(), email: otp.newCode() }, [rs, re] = await Promise.all([sendCode("sms", user.phone, codes.sms), sendCode("email", email, codes.email, "verification")]); if (!rs.ok || !re.ok) return sendJSON(res, 502, { error: !rs.ok ? sendFailure(rs, "sms") : sendFailure(re, "email") });
  await store.mutate("mfa_challenges", (all) => all.map((x) => (x.id === cid ? { ...x, smsHash: otp.hashCode(cid, "sms", codes.sms), emailHash: otp.hashCode(cid, "email", codes.email), sends: { sms: 1, email: 1 }, lastSendAt: Date.now(), expiresAt: Date.now() + OTP_MIN * 60000 } : x)));
  sendJSON(res, 200, { ok: true, masked: { sms: dial.maskPhone(user.phone), email: dial.maskEmail(email) }, devCodes: devCodes({ sms: rs, email: re }, codes) });
}
async function getMe(req, res) { const a = requireAuth(req, res); if (!a) return; const u = userById(a.id); if (!u) return sendJSON(res, 401, { error: "Please sign in." }); sendJSON(res, 200, { user: publicUser(u) }); }
async function putMe(req, res) {
  const a = requireAuth(req, res); if (!a) return;
  const b = await readBody(req); const patch = {};
  if (b.country !== undefined) { const c = clean(b.country, 2).toUpperCase(); if (!geo.COUNTRY_CODES.has(c)) return sendJSON(res, 400, { error: "Invalid country." }); patch.country = c; }
  if (b.email !== undefined) { const e = clean(b.email, 120).toLowerCase(), cur = userById(a.id); if (!emailOk(e)) return sendJSON(res, 400, { error: "Please enter a valid email address." }); if (cur && e !== String(cur.email || "").toLowerCase()) { if (store.readAll("users").some((x) => x.id !== a.id && String(x.email || "").toLowerCase() === e)) return sendJSON(res, 409, { error: "That email is already used by another account." }); patch.email = e; patch.emailVerified = false; } } // a new email must be verified again at the next login
  if (b.kind === "company" || b.company) { const u0 = userById(a.id), c = b.company || {}, prev = u0.company || {};
    const legalName = clean(c.legalName !== undefined ? c.legalName : prev.legalName, 120), bt = clean(c.businessType !== undefined ? c.businessType : prev.businessType, 30), reg = clean(c.regNumber !== undefined ? c.regNumber : prev.regNumber, 60), tax = clean(c.taxId !== undefined ? c.taxId : prev.taxId, 60);
    if (!legalName) return sendJSON(res, 400, { error: "Please enter your company or cooperative name." }); if (!catalog.BUSINESS_TYPE_IDS.has(bt)) return sendJSON(res, 400, { error: "Please choose a business type." });
    const wasVerified = prev.verification && prev.verification.status === "verified", changed = (prev.legalName || "") !== legalName || (prev.regNumber || "") !== reg || (prev.taxId || "") !== tax;
    patch.kind = "company"; patch.company = { ...prev, legalName, businessType: bt, regNumber: reg, taxId: tax, docs: prev.docs || [], verification: wasVerified && changed ? { status: "none", note: "Company details changed — please submit for verification again." } : prev.verification || { status: "none" } }; }
  if (patch.country && BLOCKED.has(patch.country)) return sendJSON(res, 403, { error: BLOCKED_MSG });
  if (b.payout !== undefined) { const me0 = userById(a.id); if (!me0 || !verifyPassword(String(b.password || ""), me0.passwordHash)) return sendJSON(res, 403, { error: "Enter your password to change payout details." }); const r = cleanPayout(b.payout); if (r.error) return sendJSON(res, 400, { error: r.error }); patch.payout = r.payout; }
  let out = null;
  await store.mutate("users", (all) => all.map((u) => { if (u.id !== a.id) return u; out = { ...u, ...patch }; return out; }));
  sendJSON(res, 200, { user: publicUser(out) }); if (patch.payout) payRiderBacklog(a.id).catch(() => {}); // a rider who just added a payout method gets any waiting fees straight away
}

// ---------- listings (live-capture trust layer) ----------
function publicListing(l, viewerId, U, B) {
  const own = l.farmerId === viewerId; const v = { ...l, hasPickupPin: l.lat != null && l.lng != null }; const t = l.trust || {};
  v.photos = (l.photos || []).map((x) => x.url); if (!v.photos.length && l.photoUrl) v.photos = [l.photoUrl];
  v.sellerRating = sellerRating(l.farmerId); v.photoUrl = v.photos[0] || null; v.aiQualityNote = (l.quality && l.quality.summary) || t.aiNote || null; v.quality = l.quality || null; v.qualityStatus = l.qualityStatus || (l.quality ? "done" : "unavailable");
  v.badges = ["live_capture", ...(t.geoMatched ? ["geo_match"] : []), ...(l.quality ? ["ai_checked"] : [])]; delete v.aiError; delete v.qualityAttempts;
  const st = trust.sellerStats(l.farmerId), su = U ? U[l.farmerId] : userById(l.farmerId); v.seller = { level: st.level, completed: st.completed, ...(partyOf(su) || { kind: "individual", name: l.farmerName, verified: false }) }; const bond = B ? B[l.farmerId] || 0 : bondOf(l.farmerId); v.seller.bonded = isBondedAmt(bond); v.seller.bondCoins = v.seller.bonded ? Math.floor(bond) : 0; v.boosted = boostedNow(l); v.audience = l.audience || "everyone";
  v.trust = own ? { level: t.level, score: t.score, flags: t.flags || [], reviewNote: l.reviewNote || null } : undefined; delete v.farmerPhone; delete v.captureMeta;
  if (!own) { delete v.lat; delete v.lng; } return v;
}
async function getListings(req, res, m, url) {
  const viewer = getAuthUser(req); const q = url.searchParams; const U = Object.fromEntries(store.readAll("users").map((x) => [x.id, x])), vu = viewer && U[viewer.id]; let ls = store.readAll("listings").filter((l) => l.status === "available" && (l.farmerId === (viewer && viewer.id) || canSee(l, vu)));
  if (q.get("country")) ls = ls.filter((l) => l.country === q.get("country"));
  const B = bondMap(), score = (l) => new Date(l.createdAt).getTime() + (isBondedAmt(B[l.farmerId] || 0) ? 3 * 86400e3 : 0) + ratingLift(l.farmerId) + (boostedNow(l) ? 1e13 : 0);
  sendJSON(res, 200, { listings: ls.sort((a, b) => score(b) - score(a)).map((l) => publicListing(l, viewer && viewer.id, U, B)) });
}
async function getListing(req, res, m) {
  const viewer = getAuthUser(req), l = store.readAll("listings").find((x) => x.id === m[1]); if (!l) return sendJSON(res, 404, { error: "Listing not found." }); const vu = viewer && userById(viewer.id);
  const mine = viewer && l.farmerId === viewer.id, party = viewer && store.readAll("orders").some((o) => o.listingId === l.id && (o.buyerId === viewer.id || o.farmerId === viewer.id));
  if (!((l.status === "available" && canSee(l, vu)) || mine || party)) return sendJSON(res, 404, { error: "Listing not found." }); sendJSON(res, 200, { listing: publicListing(l, viewer && viewer.id) });
}
async function getMyListings(req, res) { const u = requireAuth(req, res); if (!u) return; sendJSON(res, 200, { listings: store.readAll("listings").filter((l) => l.farmerId === u.id).sort(byNewest).map((l) => publicListing(l, u.id)) }); }
async function captureSession(req, res) { const u = requireAuth(req, res); if (!u) return; sendJSON(res, 200, await trust.issueSession(u.id)); }
async function createListing(req, res) {
  const a = requireAuth(req, res); if (!a) return; const me = userById(a.id); if (!me) return sendJSON(res, 401, { error: "Please sign in." });
  const b = await readBody(req, 14e6);
  const crop = clean(b.crop, 60), quantity = num(b.quantity), unit = clean(b.unit, 20), price = num(b.pricePerUnit), location = clean(b.location, 120);
  const country = clean(b.country || me.country, 2).toUpperCase(), currency = clean(b.currency || geo.currencyOf(country), 3).toUpperCase();
  if (!crop || !quantity || quantity <= 0 || !unit || !price || price <= 0 || !location) return sendJSON(res, 400, { error: "Please fill in crop, quantity, unit, price, and location." });
  const cropMeta = catalog.cropInfo(crop), isLive = !!(cropMeta && cropMeta.live), papers = clean(b.livestockDocs, 12); // living animals: the seller must say whether they have the ownership and movement papers
  const unitMeta = catalog.UNITS.find((x) => x.v === unit); if (!unitMeta) return sendJSON(res, 400, { error: "Please choose one of the listed units." });
  if (cropMeta && cropMeta.liquid && unitMeta.kind !== "volume" && !["kg", "tonne", "lb"].includes(unit)) return sendJSON(res, 400, { error: `${crop} is a liquid — sell it by the litre, jerrycan, drum or tank (or by weight).` });
  if (cropMeta && !cropMeta.liquid && unitMeta.kind === "volume") return sendJSON(res, 400, { error: `Litres, jerrycans, drums and tanks are for liquids — please choose a weight or count unit for ${crop}.` });
  if (isLive && !["have", "will_get", "not_needed"].includes(papers)) return sendJSON(res, 400, { error: "Please tell buyers whether you have the ownership and movement papers for these animals." });
  if (!geo.COUNTRY_CODES.has(country)) return sendJSON(res, 400, { error: "Invalid country of origin." });
  if (BLOCKED.has(country)) return sendJSON(res, 403, { error: BLOCKED_MSG });
  if (!geo.CURRENCY_SET.has(currency)) return sendJSON(res, 400, { error: "Invalid currency." });
  const session = await trust.consumeSession(b.captureToken, me.id); if (!session) return sendJSON(res, 400, { error: "Your camera session expired. Start the photo step again." });
  const pin = num(b.lat) != null && num(b.lng) != null ? { lat: num(b.lat), lng: num(b.lng), from: b.pinFrom === "gps" ? "gps" : "town" } : null; const stats = trust.sellerStats(me.id);
  const photosIn = Array.isArray(b.photos) ? b.photos : []; let ai = null;
  if (photosIn.length === trust.PHOTO_COUNT) ai = await vision.screenPhotos({ photos: photosIn.map((p) => String(p.data || "")), crop, unit }).catch((e) => { console.error("screen", e.message); return null; });
  const ev = await trust.evaluate({ userId: me.id, session, photos: photosIn, pin, country, deviceMeta: b.deviceMeta, ai, sellerLevel: stats.level });
  if (ev.rejections.length) return sendJSON(res, 400, { error: ev.rejections[0], rejections: ev.rejections });
  const lid = id(), photos = [];
  for (const [i, p] of ev.photos.entries()) { const fn = `${lid}-${i + 1}.jpg`; fs.writeFileSync(path.join(UPLOADS_DIR, fn), p.buf); photos.push({ url: "/uploads/" + fn, sha: p.hash, dhash: p.dh, at: new Date(p.at).toISOString(), geo: p.geo }); }
  await store.mutate("photo_index", (all) => [...all, ...photos.map((x) => ({ sha: x.sha, dhash: x.dhash, listingId: lid, sellerId: me.id }))]);
  const temperature = catalog.TEMPERATURES.some((t) => t.v === b.temperature) ? b.temperature : "ambient"; const incoterm = catalog.INCOTERM_IDS.has(b.incoterm) ? b.incoterm : "FCA";
  const listing = { id: lid, farmerId: me.id, farmerName: displayName(me), audience: AUDIENCES.includes(b.audience) ? b.audience : "everyone", crop, quantity, unit, pricePerUnit: price, currency, country, location, notes: maskContacts(clean(b.notes, 500)), lat: pin && pin.lat, lng: pin && pin.lng, pinFrom: pin && pin.from, pinAcc: num(b.pinAcc),
    unitKg: num(b.unitKg) > 0 && num(b.unitKg) <= 2000 ? Math.round(num(b.unitKg) * 100) / 100 : null, live: isLive, livestockDocs: isLive ? papers : null, photos, temperature, incoterm, minOrder: num(b.minOrder), captureMeta: { ...(b.deviceMeta || {}), sessionIssuedAt: new Date(session.issuedAt).toISOString() },
    quality: ai && ai.quality ? ai.quality : null, qualityStatus: ai && ai.quality ? "done" : vision.isConfigured() ? "pending" : "unavailable", qualityAttempts: vision.isConfigured() ? 1 : 0, lastQualityAt: now(), aiError: ai && ai.quality ? null : (vision.isConfigured() ? ai_last().error : null),
    trust: { level: ev.level, score: ev.score, flags: ev.flags, aiNote: ev.aiNote, geoMatched: ev.geoMatched, sellerLevel: stats.level },
    status: ev.level === "review" ? "pending_review" : "available", createdAt: now() };
  await store.mutate("listings", (all) => [...all, listing]); if (listing.quality) dataset.record({ listing, quality: listing.quality, model: ai_model(), source: "ai" }).catch(() => {}); if (!listing.unitKg) delivery.refineUnitWeight(listing.crop, listing.unit).catch(() => {}); /* background, invisible */ sendJSON(res, 201, { listing: publicListing(listing, me.id) });
}
async function retakePhotos(req, res, m) { // a flagged seller fixes it themselves: take 5 new live photos, same checks, no admin needed
  const a = requireAuth(req, res); if (!a) return; const me = userById(a.id); const l = me && store.readAll("listings").find((x) => x.id === m[1] && x.farmerId === me.id);
  if (!l || l.status !== "pending_review") return sendJSON(res, 400, { error: "This listing isn't waiting for new photos." }); const b = await readBody(req, 14e6);
  const session = await trust.consumeSession(b.captureToken, me.id); if (!session) return sendJSON(res, 400, { error: "Your camera session expired. Start the photo step again." });
  const photosIn = Array.isArray(b.photos) ? b.photos : [], pin = l.lat != null ? { lat: l.lat, lng: l.lng, from: l.pinFrom === "gps" ? "gps" : "town" } : null; let ai = null;
  if (photosIn.length === trust.PHOTO_COUNT) ai = await vision.screenPhotos({ photos: photosIn.map((p) => String(p.data || "")), crop: l.crop, unit: l.unit }).catch(() => null);
  const ev = await trust.evaluate({ userId: me.id, session, photos: photosIn, pin, country: l.country, deviceMeta: b.deviceMeta, ai, sellerLevel: trust.sellerStats(me.id).level, excludeListingId: l.id });
  if (ev.rejections.length) return sendJSON(res, 400, { error: ev.rejections[0], rejections: ev.rejections });
  for (const p of l.photos || []) { try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(p.url))); } catch (e) { /* gone */ } }
  const tag = Date.now().toString(36), photos = []; for (const [i, p] of ev.photos.entries()) { const fn = `${l.id}-${tag}-${i + 1}.jpg`; fs.writeFileSync(path.join(UPLOADS_DIR, fn), p.buf); photos.push({ url: "/uploads/" + fn, sha: p.hash, dhash: p.dh, at: new Date(p.at).toISOString(), geo: p.geo }); }
  await store.mutate("photo_index", (all) => [...all.filter((x) => x.listingId !== l.id), ...photos.map((x) => ({ sha: x.sha, dhash: x.dhash, listingId: l.id, sellerId: me.id }))]); let out = null;
  await store.mutate("listings", (all) => all.map((x) => { if (x.id !== l.id) return x; out = { ...x, photos, quality: ai && ai.quality ? ai.quality : null, qualityStatus: ai && ai.quality ? "done" : vision.isConfigured() ? "pending" : "unavailable", qualityAttempts: vision.isConfigured() ? 1 : 0, lastQualityAt: now(), aiError: ai && ai.quality ? null : (vision.isConfigured() ? ai_last().error : null),
    trust: { level: ev.level, score: ev.score, flags: ev.flags, aiNote: ev.aiNote, geoMatched: ev.geoMatched, sellerLevel: trust.sellerStats(me.id).level }, status: ev.level === "review" ? "pending_review" : "available" }; return out; }));
  sendJSON(res, 200, { listing: publicListing(out, me.id), live: out.status === "available" });
}
async function updateListing(req, res, m) {
  const u = requireAuth(req, res); if (!u) return; const b = await readBody(req); let out = null;
  await store.mutate("listings", (all) => all.map((l) => { if (l.id !== m[1] || l.farmerId !== u.id) return l; out = { ...l }; if ((b.status === "available" && l.status === "sold") || b.status === "sold") out.status = b.status; return out; }));
  if (!out) return sendJSON(res, 403, { error: "You can only edit your own listings." }); sendJSON(res, 200, { listing: publicListing(out, u.id) });
}
async function deleteListing(req, res, m) {
  const u = requireAuth(req, res); if (!u) return; const l = store.readAll("listings").find((x) => x.id === m[1]);
  if (!l || l.farmerId !== u.id) return sendJSON(res, 403, { error: "You can only remove your own listings." });
  await store.mutate("listings", (all) => all.filter((x) => x.id !== m[1])); sendJSON(res, 200, { ok: true });
}
const ai_last = () => ai.last, ai_model = () => ai.model();
async function rescreenListing(l) {
  const imgs = []; for (const p of l.photos || []) { try { imgs.push(fs.readFileSync(path.join(UPLOADS_DIR, path.basename(p.url))).toString("base64")); } catch (e) { /* missing file */ } }
  if (imgs.length < 1) return null; const r = await vision.screenPhotos({ photos: imgs, crop: l.crop, unit: l.unit }).catch(() => null); let out = null;
  await store.mutate("listings", (all) => all.map((x) => { if (x.id !== l.id) return x; out = { ...x, qualityAttempts: (x.qualityAttempts || 0) + 1, lastQualityAt: now() };
    if (r && r.quality) { out.quality = r.quality; out.qualityStatus = "done"; out.aiError = null; out.trust = { ...(x.trust || {}), aiNote: r.quality.summary };
      if ((r.quality.grade === "reject" || r.risk === "high" || !r.matchesCrop) && x.status === "available") { out.status = "pending_review"; out.trust.flags = [...((x.trust && x.trust.flags) || []), { id: "ai_quality_review", severity: "major", text: "Automatic quality check found a serious concern" }]; } }
    else { out.aiError = ai.last.error || "Automatic check failed"; if (x.qualityStatus === "unavailable") out.qualityStatus = "pending"; } return out; }));
  if (r && r.quality && out) dataset.record({ listing: out, quality: r.quality, model: ai_model(), source: "ai-retry" }).catch(() => {});
  return out;
}
async function listingQuality(req, res, m) {
  const u = requireAuth(req, res); if (!u) return; const l = store.readAll("listings").find((x) => x.id === m[1] && x.farmerId === u.id); if (!l) return sendJSON(res, 403, { error: "You can only edit your own listings." });
  if (!vision.isConfigured()) return sendJSON(res, 503, { error: "Automatic quality checks aren't switched on for this platform yet." });
  const out = await rescreenListing(l); if (!out) return sendJSON(res, 400, { error: "Couldn't read the photos for this listing." }); if (!out.quality) return sendJSON(res, 502, { error: "The automatic quality check couldn't run right now — we'll keep retrying automatically." }); sendJSON(res, 200, { listing: publicListing(out, u.id) });
}
async function fixLocation(req, res, m) { // one-click fix for "photos were taken far from the listed location": trust where the live photos were actually taken
  const u = requireAuth(req, res); if (!u) return; const l = store.readAll("listings").find((x) => x.id === m[1] && x.farmerId === u.id); if (!l || l.status !== "pending_review") return sendJSON(res, 400, { error: "This listing isn't waiting for a location fix." });
  const flags = (l.trust && l.trust.flags) || []; if (!flags.some((f) => f.id === "far_from_pin")) return sendJSON(res, 400, { error: "This listing wasn't flagged for its location." });
  const geos = (l.photos || []).map((p) => p.geo).filter(Boolean); if (!geos.length) return sendJSON(res, 400, { error: "These photos have no location data. Remove the listing and retake them with location switched on." });
  const lat = geos.reduce((a, g) => a + g.lat, 0) / geos.length, lng = geos.reduce((a, g) => a + g.lng, 0) / geos.length; const place = await places.reverse(lat, lng).catch(() => null);
  const country = place && geo.COUNTRY_CODES.has(place.country) ? place.country : l.country; if (BLOCKED.has(country)) return sendJSON(res, 403, { error: BLOCKED_MSG });
  const remaining = flags.filter((f) => f.id !== "far_from_pin"), major = remaining.some((f) => f.severity === "major"), score = Math.max(0, 100 - remaining.reduce((a, f) => a + (f.severity === "major" ? 30 : 8), 0)); let out = null;
  await store.mutate("listings", (all) => all.map((x) => { if (x.id !== l.id) return x; out = { ...x, lat, lng, pinFrom: "gps", country, location: (place && place.name) || `${lat.toFixed(3)}, ${lng.toFixed(3)}`, status: major ? "pending_review" : "available", trust: { ...x.trust, flags: remaining, score, level: major ? "review" : score >= 80 ? "high" : "medium", geoMatched: true } }; return out; }));
  sendJSON(res, 200, { listing: publicListing(out, u.id), live: out.status === "available" });
}
async function qualitySweep() { try { for (const l of store.readAll("listings")) if ((l.qualityStatus === "pending" || (l.qualityStatus === "unavailable" && vision.isConfigured())) && (l.qualityAttempts || 0) < 6 && Date.now() - new Date(l.lastQualityAt || 0).getTime() > 4 * 60000) await rescreenListing(l); } catch (e) { console.error("qualitySweep", e.message); } }
// ---------- places & geo hints ----------
const clientIp = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
async function placesSearch(req, res, m, url) {
  if (places.rateLimited(clientIp(req))) return sendJSON(res, 429, { error: "Too many searches — slow down." });
  const cc = clean(url.searchParams.get("country"), 2).toUpperCase(); if (!geo.COUNTRY_CODES.has(cc)) return sendJSON(res, 400, { error: "Choose a country first." });
  sendJSON(res, 200, { places: await places.search(cc, clean(url.searchParams.get("q"), 60)) });
}
async function placesReverse(req, res, m, url) {
  if (places.rateLimited(clientIp(req))) return sendJSON(res, 429, { error: "Too many searches — slow down." });
  const lat = num(url.searchParams.get("lat")), lon = num(url.searchParams.get("lon")); if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return sendJSON(res, 400, { error: "lat and lng are required." });
  sendJSON(res, 200, { place: await places.reverse(lat, lon) });
}
async function geoHint(req, res) {
  const h = req.headers; const cc = String(h["cf-ipcountry"] || h["x-vercel-ip-country"] || h["cloudfront-viewer-country"] || h["x-appengine-country"] || h["x-country-code"] || "").toUpperCase();
  sendJSON(res, 200, { country: geo.COUNTRY_CODES.has(cc) ? cc : null });
}

// ---------- orders ----------
function viewOrder(o, uid, U, views) {
  const v = { ...o }; v.unseen = !!(views && o.updatedAt && (!views[o.id] || o.updatedAt > views[o.id])); v.buyerParty = partyOf(U ? U[o.buyerId] : userById(o.buyerId)); v.sellerParty = partyOf(U ? U[o.farmerId] : userById(o.farmerId));
  ["mpesaCheckoutRequestId", "mpesaMerchantRequestId", "payoutError", "cryptoRefundDueUsd", "adminNote", "providerRef", "providerPaymentId", "payoutConversationId", "codeAttempts", "cryptoUsd", "pickupCode", "deliveryCode"].forEach((k) => delete v[k]);
  delete v.farmerPhone; delete v.buyerPhone; // contact details are never shared between users; chat happens in-app
  Object.assign(v, ratingFields(o, uid));
  if (o.buyerId === uid) { v.canEdit = editableOrder(o); v.canCancel = cancellableOrder(o); } v.canRemove = (o.status === "declined" || o.status === "cancelled") && (o.buyerId === uid || o.farmerId === uid); delete v.hiddenBy;
  v.paymentSecured = HELD.includes(o.paymentStatus); if (o.dropoff && uid !== o.buyerId) v.dropoff = { text: o.dropoff.text }; // the buyer's exact position is for the buyer and the rider only
  if (v.paymentSecured && o.farmerId === uid) v.pickupCode = o.pickupCode;   // the seller hands this to whoever collects the goods
  if (v.paymentSecured && o.buyerId === uid) v.deliveryCode = o.deliveryCode; // the buyer gives this on receiving the goods — it also accepts the delivery
  const l = store.readAll("listings").find((x) => x.id === o.listingId);
  v.localDeliveryPossible = !!(l && !o.international && l.lat != null && l.lng != null);
  if (uid === o.buyerId && o.equityPaybill && !FINAL.includes(o.paymentStatus) && o.chargeAmount) v.mpesaManual = { network: o.mobileNetwork || "mpesa", networkName: (networks.get(o.mobileNetwork || "mpesa") || {}).name, equity: true, auto: jenga.isConfigured(), paybill: o.equityPaybill.paybill, account: o.equityPaybill.account, accountName: jenga.accountName(), amount: o.chargeAmount, currency: o.chargeCurrency || "KES", paid: o.mpesaPaid || 0, remaining: Math.max(0, Math.round((o.chargeAmount - (o.mpesaPaid || 0)) * 100) / 100) };
  else if (uid === o.buyerId && o.mpesaRef && !FINAL.includes(o.paymentStatus) && o.chargeAmount) v.mpesaManual = { network: o.mobileNetwork || "mpesa", networkName: (networks.get(o.mobileNetwork || "mpesa") || {}).name, paybill: process.env.MPESA_SHORTCODE || "", account: o.mpesaRef, amount: o.chargeAmount, currency: o.chargeCurrency || "KES", paid: o.mpesaPaid || 0, remaining: Math.max(0, Math.round((o.chargeAmount - (o.mpesaPaid || 0)) * 100) / 100) };
  if (uid === o.buyerId && o.paymentProvider === "bank_wire" && o.paymentStatus === "pending" && o.wire) v.wire = { reference: o.wire.reference, currency: o.wire.currency, amount: o.wire.amount, local: !!o.wire.local, expiresAt: o.wire.expiresAt, sentAt: o.wireSentAt || null, bank: payments.wireDetails() }; else delete v.wire; delete v.wireReceived;
  v.paymentOptions = payments.allOptions({ currency: o.currency, buyerCountry: o.buyerCountry, order: o, buyerCurrency: geo.currencyOf(o.buyerCountry) });
  return v;
}
async function ordersFor(req, res, field) { const u = requireAuth(req, res); if (!u) return; try { await fx.getRates(); } catch (e) { /* cached rates are used */ } const U = Object.fromEntries(store.readAll("users").map((x) => [x.id, x])), views = Object.fromEntries(store.readAll("order_views").filter((x) => x.userId === u.id).map((x) => [x.orderId, x.at])); sendJSON(res, 200, { orders: store.readAll("orders").filter((o) => o[field] === u.id && !(o.hiddenBy || []).includes(u.id)).sort(byNewest).map((o) => viewOrder(o, u.id, U, views)) }); }
async function orderCapError(currency, total) { // optional soft-launch limit: MAX_ORDER_USD
  const cap = Number(process.env.MAX_ORDER_USD || 0); if (!(cap > 0)) return null; const r = currency === "USD" ? 1 : (await fx.rate(currency, "USD")) || (FALLBACK_USD[currency] ? 1 / FALLBACK_USD[currency] : null); if (!r) return null;
  return total * r > cap ? `During our launch, orders are limited to about USD ${cap}. Please order a smaller quantity.` : null;
}
// The price of an order: the same rules for a new order and for an edited one (a test keeps the two identical).
async function priceOrder(listing, buyer, qty, delivery) {
  const amount = geo.roundMoney(qty * listing.pricePerUnit, listing.currency), commission = geo.roundMoney(amount * COMMISSION / 100, listing.currency);
  const coinLevy = process.env.COIN_LEVY_CHARGED === "0" ? 0 : geo.roundMoney(amount * envNum("COIN_LEVY_PCT", 0.05) / 100, listing.currency);
  let dropoff = null, deliveryFee = 0, deliveryKm = null, deliveryExtra = {};
  if (delivery && delivery.mode === "rider") { const q = await quoteDelivery(listing, buyer, num(delivery.lat), num(delivery.lng), qty); if (q.error) return { error: q.error };
    dropoff = { lat: num(delivery.lat), lng: num(delivery.lng), acc: num(delivery.acc), text: clean(delivery.text, 160), note: maskContacts(clean(delivery.note, 160)) }; deliveryFee = q.fee; deliveryKm = q.km; deliveryExtra = { deliveryTotal: q.total, deliverySellerShare: q.sellerShare, deliveryWeightKg: q.weightKg, deliveryVehicle: q.vehicle }; }
  const capMsg = await orderCapError(listing.currency, geo.roundMoney(amount + deliveryFee, listing.currency)); if (capMsg) return { error: capMsg };
  return { amount, commission, sellerPayout: Math.max(0, geo.roundMoney(amount - commission - coinLevy - (deliveryExtra.deliverySellerShare || 0), listing.currency)), ...(process.env.COIN_LEVY_CHARGED === "0" ? {} : { coinLevyBuyer: coinLevy, coinLevySeller: coinLevy }),
    deliveryMode: dropoff ? "rider" : "pickup", dropoff, deliveryFee, deliveryDistanceKm: deliveryKm, deliveryTotal: null, deliverySellerShare: null, deliveryWeightKg: null, deliveryVehicle: null, ...deliveryExtra, total: geo.roundMoney(amount + deliveryFee + coinLevy, listing.currency) };
}
async function createOrder(req, res) {
  const a = requireAuth(req, res); if (!a) return; const b = await readBody(req);
  const listing = store.readAll("listings").find((l) => l.id === clean(b.listingId, 80)); const qty = num(b.quantityWanted);
  if (!listing) return sendJSON(res, 404, { error: "This listing no longer exists." });
  if (!qty || qty <= 0) return sendJSON(res, 400, { error: "Please enter a valid quantity." });
  if (listing.farmerId === a.id) return sendJSON(res, 400, { error: "You can't order your own listing." });
  if (listing.status !== "available") return sendJSON(res, 400, { error: "This listing is no longer available." });
  if (listing.minOrder && qty < listing.minOrder) return sendJSON(res, 400, { error: `Minimum order is ${listing.minOrder} ${listing.unit}.` });
  const buyer = userById(a.id), seller = userById(listing.farmerId);
  if (!buyer || !seller) return sendJSON(res, 404, { error: "Account not found." });
  if (!canSee(listing, buyer)) return sendJSON(res, 403, { error: listing.audience === "verified_companies" ? "This listing is only open to verified companies." : "This listing is only open to companies." });
  const international = listing.country !== buyer.country;
  if (BLOCKED.has(buyer.country) || BLOCKED.has(listing.country)) return sendJSON(res, 403, { error: BLOCKED_MSG });
  const amount = geo.roundMoney(qty * listing.pricePerUnit, listing.currency);
  const commission = geo.roundMoney(amount * COMMISSION / 100, listing.currency);
  const coinLevy = process.env.COIN_LEVY_CHARGED === "0" ? 0 : geo.roundMoney(amount * envNum("COIN_LEVY_PCT", 0.05) / 100, listing.currency); // the community levy: 0.05% of the goods value from EACH side, real money; half of the pool comes back as coins, half is Sokoni's
  let dropoff = null, deliveryFee = 0, deliveryKm = null, deliveryExtra = {};
  if (b.delivery && b.delivery.mode === "rider") { const q = await quoteDelivery(listing, buyer, num(b.delivery.lat), num(b.delivery.lng), qty); if (q.error) return sendJSON(res, 400, { error: q.error });
    dropoff = { lat: num(b.delivery.lat), lng: num(b.delivery.lng), acc: num(b.delivery.acc), text: clean(b.delivery.text, 160), note: maskContacts(clean(b.delivery.note, 160)) }; deliveryFee = q.fee; deliveryKm = q.km; deliveryExtra = { deliveryTotal: q.total, deliverySellerShare: q.sellerShare, deliveryWeightKg: q.weightKg, deliveryVehicle: q.vehicle }; }
  const capMsg = await orderCapError(listing.currency, geo.roundMoney(amount + deliveryFee, listing.currency)); if (capMsg) return sendJSON(res, 400, { error: capMsg });
  const order = { id: id(), listingId: listing.id, farmerId: seller.id, farmerName: displayName(seller), farmerPhone: seller.phone, farmerCountry: listing.country,
    buyerId: buyer.id, buyerName: displayName(buyer), buyerPhone: buyer.phone, poNumber: clean(b.poNumber, 60), buyerCountry: buyer.country, international,
    crop: listing.crop, unit: listing.unit, quantityWanted: qty, message: maskContacts(clean(b.message, 500)), pricePerUnit: listing.pricePerUnit,
    currency: listing.currency, amount, commission, sellerPayout: Math.max(0, geo.roundMoney(amount - commission - coinLevy - (deliveryExtra.deliverySellerShare || 0), listing.currency)), ...(process.env.COIN_LEVY_CHARGED === "0" ? {} : { coinLevyBuyer: coinLevy, coinLevySeller: coinLevy }), incoterm: listing.incoterm,
    deliveryMode: dropoff ? "rider" : "pickup", dropoff, deliveryFee, deliveryDistanceKm: deliveryKm, ...deliveryExtra, total: geo.roundMoney(amount + deliveryFee + coinLevy, listing.currency),
    status: "pending", paymentStatus: "unpaid", deliveryId: null, shipmentId: null, disputed: false, createdAt: now(), updatedAt: now() };
  await store.mutate("orders", (all) => [...all, order]); await markSeen(buyer.id, order.id); // the buyer is looking at it right now
  if (order.message) await store.mutate("messages", (all) => [...all, { id: id(), threadType: "order", threadId: order.id, senderId: buyer.id, senderName: displayName(buyer), text: order.message, createdAt: now() }]); // the buyer's note is the first message in the conversation
  pushTo(seller.id, { title: "New order request", body: `${displayName(buyer)} wants ${qty} ${(catalog.UNITS.find((x) => x.v === listing.unit) || {}).l || listing.unit} of ${listing.crop}`, url: "/?order=" + order.id, tag: "order-" + order.id });
  sendJSON(res, 201, { order: viewOrder(order, a.id) });
}
// What an order WOULD cost, worked out by the very same rules as the real order (so the review screen can never differ from the order).
async function previewOrder(req, res) {
  const a = requireAuth(req, res); if (!a) return; const b = await readBody(req), listing = store.readAll("listings").find((l) => l.id === clean(b.listingId, 80)), qty = num(b.quantityWanted);
  if (!listing) return sendJSON(res, 404, { error: "This listing no longer exists." }); if (!qty || qty <= 0) return sendJSON(res, 400, { error: "Please enter a valid quantity." });
  if (listing.farmerId === a.id) return sendJSON(res, 400, { error: "You can't order your own listing." }); if (listing.status !== "available") return sendJSON(res, 400, { error: "This listing is no longer available." });
  if (listing.minOrder && qty < listing.minOrder) return sendJSON(res, 400, { error: `Minimum order is ${listing.minOrder} ${listing.unit}.` });
  const P = await priceOrder(listing, userById(a.id), qty, b.delivery); if (P.error) return sendJSON(res, 400, { error: P.error });
  sendJSON(res, 200, { currency: listing.currency, quantity: qty, unit: listing.unit, pricePerUnit: listing.pricePerUnit, amount: P.amount, deliveryMode: P.deliveryMode, deliveryFee: P.deliveryFee, coinLevy: P.coinLevyBuyer || 0, total: P.total, deliveryText: P.dropoff ? P.dropoff.text : null });
}
// ---------- the buyer can change or cancel an order until it has been paid ----------
async function editOrder(req, res, m) {
  const a = requireAuth(req, res); if (!a) return; const b = await readBody(req), o = store.readAll("orders").find((x) => x.id === m[1]);
  if (!o || o.buyerId !== a.id) return sendJSON(res, 404, { error: "Order not found." });
  if (!editableOrder(o)) return sendJSON(res, 409, { error: o.paymentStatus === "pending" ? "Your payment is being confirmed, so the order can't be changed right now. If you didn't approve the PIN prompt, cancel the order and start again." : o.status === "declined" || o.status === "cancelled" ? "This order is closed." : "This order has been paid, so it can't be changed any more. You can message the seller about it.", code: "NOT_EDITABLE" });
  const listing = store.readAll("listings").find((l) => l.id === o.listingId); if (!listing || listing.status !== "available") return sendJSON(res, 400, { error: "This listing is no longer available." });
  const buyer = userById(a.id), qty = b.quantityWanted == null ? o.quantityWanted : num(b.quantityWanted);
  if (!qty || qty <= 0) return sendJSON(res, 400, { error: "Please enter a valid quantity." }); if (listing.minOrder && qty < listing.minOrder) return sendJSON(res, 400, { error: `Minimum order is ${listing.minOrder} ${listing.unit}.` });
  const delivery = b.delivery === undefined ? (o.deliveryMode === "rider" && o.dropoff ? { mode: "rider", lat: o.dropoff.lat, lng: o.dropoff.lng, acc: o.dropoff.acc, text: o.dropoff.text, note: o.dropoff.note } : { mode: "pickup" }) : b.delivery;
  const P = await priceOrder(listing, buyer, qty, delivery); if (P.error) return sendJSON(res, 400, { error: P.error });
  const repriced = qty !== o.quantityWanted || P.deliveryMode !== o.deliveryMode || (P.dropoff && o.dropoff && (P.dropoff.lat !== o.dropoff.lat || P.dropoff.lng !== o.dropoff.lng)), msg = b.message === undefined ? o.message : maskContacts(clean(b.message, 500)), reask = o.status === "accepted" && repriced;
  const u = await patchOrder(o.id, { ...P, quantityWanted: qty, poNumber: b.poNumber === undefined ? o.poNumber : clean(b.poNumber, 60), message: msg, editedAt: now(), ...(reask ? { status: "pending", acceptedAt: null } : {}) });
  if (b.message !== undefined && msg && msg !== o.message) await store.mutate("messages", (all) => [...all, { id: id(), threadType: "order", threadId: o.id, senderId: a.id, senderName: displayName(buyer), text: "Updated note: " + msg, createdAt: now() }]);
  await evt("order", "edited", o.id, "processed", `buyer changed the order${reask ? " — the seller must accept it again" : ""}`);
  pushTo(o.farmerId, { title: reask ? "Order changed — please review" : "Order updated", body: `${displayName(buyer)} changed their order for ${o.crop}${reask ? ". Please accept it again." : "."}`, url: "/?order=" + o.id, tag: "order-" + o.id });
  sendJSON(res, 200, { order: viewOrder(u, a.id), reaccept: !!reask });
}
async function cancelOrder(req, res, m) {
  const a = requireAuth(req, res); if (!a) return; const b = await readBody(req), o = store.readAll("orders").find((x) => x.id === m[1]);
  if (!o || o.buyerId !== a.id) return sendJSON(res, 404, { error: "Order not found." });
  if (!cancellableOrder(o)) return sendJSON(res, 409, { error: o.status === "declined" || o.status === "cancelled" ? "This order is already closed." : "This order has been paid, so it can't be cancelled here. Message the seller, or report a problem on the order if something is wrong.", code: "NOT_CANCELLABLE" });
  if (o.paymentStatus === "pending") { // a PIN prompt may still be live: wait for it to expire, then ask the provider whether it was paid — a paid order is never cancelled
    if (Date.now() - new Date(o.pendingSince || 0).getTime() < 3 * 60000) return sendJSON(res, 409, { error: "We're still waiting for your payment. If you didn't approve the PIN prompt, wait about 2 minutes and try again.", code: "PAYMENT_PENDING" });
    let r; try { r = await payments.pollStatus(o); } catch (e) { r = undefined; }
    if (r && r.paid) { await settlePayment(o, { provider: o.paymentProvider, id: r.id, note: "found while cancelling" }); return sendJSON(res, 409, { error: "Your payment had just arrived, so the order stays and your money is held safely.", code: "PAYMENT_ARRIVED" }); }
    if (r === undefined || (r === null && !["paystack", "fincra", "flutterwave", "stripe", "paypal"].includes(o.paymentProvider))) return sendJSON(res, 409, { error: "We can't check this payment automatically right now. Please try again in a few minutes, or message us.", code: "PAYMENT_UNCHECKED" });
  }
  const u = await patchOrder(o.id, { status: "cancelled", cancelledAt: now(), cancelledBy: a.id, cancelReason: clean(b.reason, 160) || null, ...(o.paymentStatus === "pending" ? { paymentStatus: "failed", paymentError: "Order cancelled" } : {}) });
  await evt("order", "cancelled", o.id, "processed", "cancelled by the buyer before payment");
  pushTo(o.farmerId, { title: "Order cancelled", body: `${o.buyerName} cancelled their order for ${o.crop}.`, url: "/?order=" + o.id, tag: "order-" + o.id });
  sendJSON(res, 200, { order: viewOrder(u, a.id) });
}
async function removeOrder(req, res, m) { // take a cancelled or declined order out of MY list (the record is kept)
  const a = requireAuth(req, res); if (!a) return; const o = store.readAll("orders").find((x) => x.id === m[1]);
  if (!o || (o.buyerId !== a.id && o.farmerId !== a.id)) return sendJSON(res, 404, { error: "Order not found." });
  if (o.status !== "declined" && o.status !== "cancelled") return sendJSON(res, 409, { error: "Only cancelled or declined orders can be removed.", code: "NOT_REMOVABLE" });
  await patchOrder(o.id, { hiddenBy: [...new Set([...(o.hiddenBy || []), a.id])] }); sendJSON(res, 200, { ok: true });
}
async function respondOrder(req, res, m) {
  const u = requireAuth(req, res); if (!u) return; const b = await readBody(req);
  if (b.status !== "accepted" && b.status !== "declined") return sendJSON(res, 400, { error: "Status must be 'accepted' or 'declined'." });
  const o = store.readAll("orders").find((x) => x.id === m[1]);
  if (!o || o.farmerId !== u.id) return sendJSON(res, 403, { error: "You can only respond to orders on your own listings." });
  if (o.status !== "pending") return sendJSON(res, 400, { error: "This order has already been answered." });
  const answered = await patchOrder(o.id, { status: b.status, ...(b.status === "accepted" ? { acceptedAt: now() } : {}) }); pushTo(o.buyerId, b.status === "accepted" ? { title: "Order accepted — pay now", body: `${o.farmerName} accepted your order for ${o.crop}. Pay to secure it.`, url: "/?order=" + o.id, tag: "order-" + o.id } : { title: "Order declined", body: `${o.farmerName} couldn't take your order for ${o.crop}.`, url: "/?order=" + o.id, tag: "order-" + o.id });
  sendJSON(res, 200, { order: viewOrder(answered, u.id) });
}

// ---------- messages: in-app chat threads (contact details are never shared and are masked in every message) ----------
function partyOrder(req, res, oid) {
  const u = requireAuth(req, res); if (!u) return null;
  const o = store.readAll("orders").find((x) => x.id === oid);
  if (!o || (o.buyerId !== u.id && o.farmerId !== u.id)) { sendJSON(res, 403, { error: "You're not part of this order." }); return null; }
  return { u, o };
}
function threadParticipants(type, tid) {
  if (type === "order") { const o = store.readAll("orders").find((x) => x.id === tid); return o ? [o.buyerId, o.farmerId] : null; }
  if (type === "delivery") { const d = store.readAll("deliveries").find((x) => x.id === tid); return d ? [d.buyerId, d.farmerId, d.riderId] : null; }
  if (type === "shipment") { const s = store.readAll("shipments").find((x) => x.id === tid); return s ? [s.buyerId, s.farmerId, s.carrierId] : null; }
  return null;
}
function threadAccess(req, res, type, tid) {
  const u = requireAuth(req, res); if (!u) return null; const who = threadParticipants(type, tid);
  if (!who || !who.includes(u.id)) { sendJSON(res, 403, { error: "You're not part of this conversation." }); return null; }
  return u;
}
async function getMessages(req, res, m) {
  const type = m[1], tid = m[2]; if (!threadAccess(req, res, type, tid)) return;
  sendJSON(res, 200, { messages: store.readAll("messages").filter((x) => x.threadType === type && x.threadId === tid).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)) });
}
async function postMessage(req, res, m) {
  const type = m[1], tid = m[2]; const u = threadAccess(req, res, type, tid); if (!u) return; const b = await readBody(req); const text = clean(b.text, 1000);
  if (!text) return sendJSON(res, 400, { error: "Message can't be empty." });
  const msg = { id: id(), threadType: type, threadId: tid, senderId: u.id, senderName: displayName(userById(u.id)) || u.name, text: maskContacts(text), createdAt: now() };
  await store.mutate("messages", (all) => [...all, msg]);
  if (type === "order") { const po = store.readAll("orders").find((x) => x.id === tid); if (po) pushTo(u.id === po.buyerId ? po.farmerId : po.buyerId, { title: "New message from " + msg.senderName, body: msg.text.slice(0, 90), url: "/?tab=messages", tag: "msg-" + tid }); }
  sendJSON(res, 201, { message: msg });
}

// ---------- inbox ----------
async function inbox(req, res) {
  const u = requireAuth(req, res); if (!u) return; const msgs = store.readAll("messages"), reads = store.readAll("thread_reads").filter((r) => r.userId === u.id); const out = [];
  const lst = store.readAll("listings"), lite = (o) => { const l = o && lst.find((x) => x.id === o.listingId); return l ? { id: l.id, crop: l.crop, photo: (l.photos && l.photos[0] && l.photos[0].url) || l.photoUrl || null, price: l.pricePerUnit, currency: l.currency, unit: l.unit, status: l.status } : null; };
  const add = (type, tid, title, sub, created, o) => { const mine = msgs.filter((m) => m.threadType === type && m.threadId === tid).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); const last = mine[mine.length - 1]; const rd = reads.find((r) => r.key === type + ":" + tid); const readAt = rd ? new Date(rd.at).getTime() : 0;
    out.push({ type, id: tid, title, subtitle: sub, orderId: o ? o.id : null, listing: lite(o), last: last ? { text: last.text, from: last.senderName, at: last.createdAt, mine: last.senderId === u.id } : null, unread: mine.filter((m) => m.senderId !== u.id && new Date(m.createdAt).getTime() > readAt).length, at: last ? last.createdAt : created }); };
  const users = store.readAll("users");
  for (const o of store.readAll("orders")) { if (o.status === "declined" || o.status === "cancelled" || (o.buyerId !== u.id && o.farmerId !== u.id)) continue; const other = o.buyerId === u.id ? o.farmerName : o.buyerName; add("order", o.id, `${o.crop} · ${other}`, "Order", o.createdAt, o); }
  for (const d of store.readAll("deliveries")) { if (![d.buyerId, d.farmerId, d.riderId].includes(u.id)) continue; const o = store.readAll("orders").find((x) => x.id === d.orderId) || {}; add("delivery", d.id, `Delivery · ${o.crop || ""}`, d.riderName ? "Rider: " + d.riderName : "Local delivery", d.createdAt, o); }
  for (const s of store.readAll("shipments")) { if (!s.carrierId || ![s.buyerId, s.farmerId, s.carrierId].includes(u.id)) continue; add("shipment", s.id, `Freight · ${s.crop}`, s.carrierName || "Carrier", s.createdAt, store.readAll("orders").find((x) => x.id === s.orderId)); }
  sendJSON(res, 200, { threads: out.sort((a, b) => new Date(b.at) - new Date(a.at)), unread: out.reduce((n, t) => n + t.unread, 0) });
}
async function markRead(req, res, m) {
  const type = m[1], tid = m[2]; const u = threadAccess(req, res, type, tid); if (!u) return; const key = type + ":" + tid;
  await store.mutate("thread_reads", (all) => all.some((r) => r.userId === u.id && r.key === key) ? all.map((r) => r.userId === u.id && r.key === key ? { ...r, at: now() } : r) : [...all, { userId: u.id, key, at: now() }]); sendJSON(res, 200, { ok: true });
}
async function payoutBanks(req, res, m, url) {
  const u = requireAuth(req, res); if (!u) return; const cc = clean(url.searchParams.get("country"), 2).toUpperCase(); let banks = await payouts.banks(cc), source = "live";
  if (!banks.length) { banks = bankDir.list(cc); source = banks.length ? "directory" : "none"; } sendJSON(res, 200, { banks, source });
}

// ---------- payments / escrow / payouts ----------
// paid → held (webhook, automatic) → buyer accepts (or delivery code / auto-release) → seller paid (automatic). Admin only settles disputes.
const UNPAID = ["unpaid", "failed"], activeOrder = (o) => o.status === "pending" || o.status === "accepted";
const editableOrder = (o) => activeOrder(o) && UNPAID.includes(o.paymentStatus), cancellableOrder = (o) => activeOrder(o) && (UNPAID.includes(o.paymentStatus) || o.paymentStatus === "pending");
const FINAL = ["escrowed", "payout_pending", "payout_initiated", "paid_out", "payout_failed", "refunding", "refunded"];
async function refundLatePayment(o, info) { // money arrived for an order the buyer had already cancelled: it goes straight back and is never kept
  const u = await patchOrder(o.id, { paymentStatus: "escrowed", escrowedAt: now(), providerPaymentId: (info && info.id) || o.providerPaymentId || null, paymentError: null, lateOnCancelled: true });
  let r; try { r = await payments.refund(u, { phone: (userById(u.buyerId) || {}).phone }); } catch (e) { r = { automatic: false, reason: e.message }; }
  const done = r.automatic && !r.pending, v = await patchOrder(u.id, { paymentStatus: done ? "refunded" : "refunding", refundRef: r.ref || null, refundedAt: done ? now() : null, refundRetry: false, refundError: r.automatic ? null : r.reason || "this payment type can't be reversed here", refundAttempts: 0, lastRefundAt: now() });
  await evt((info && info.provider) || o.paymentProvider, "late_payment_cancelled", o.id, r.automatic ? "processed" : "needs_review", r.automatic ? (done ? "a payment arrived after the buyer cancelled — refunded automatically" : "a payment arrived after the buyer cancelled — refund sent, awaiting confirmation") : "a payment arrived after the buyer cancelled — refund it by hand: " + (r.reason || "this payment type can't be reversed here"));
  pushTo(u.buyerId, { title: "Payment returned", body: `Your payment for the cancelled ${u.crop} order is being sent back to you.`, url: "/?order=" + u.id, tag: "order-" + u.id }); return v;
}
async function settlePayment(o, info) {
  if (FINAL.includes(o.paymentStatus)) return o; // idempotent: replayed webhooks do nothing
  if (o.status === "cancelled") return refundLatePayment(o, info);
  const u = await patchOrder(o.id, { paymentStatus: "escrowed", escrowedAt: now(), providerPaymentId: info.id || o.providerPaymentId || null, pickupCode: code6(), deliveryCode: code6(), codeAttempts: 0, paymentError: null });
  await evt(info.provider || o.paymentProvider, "payment_confirmed", o.id, "processed", info.note || "funds held"); if (u.deliveryMode === "rider") await createLocalDelivery(u);
  pushTo(u.farmerId, { title: "Payment received", body: `${u.buyerName}'s payment for ${u.crop} is held safely. Please get it ready.`, url: "/?order=" + u.id, tag: "order-" + u.id }); pushTo(u.buyerId, { title: "Payment secured", body: `Your payment for ${u.crop} is held safely until you receive it.`, url: "/?order=" + u.id, tag: "order-" + u.id }); return u;
}
const sellerItem = (o) => ({ id: o.id, ref: "SOKP-" + o.id, currency: o.currency, amount: geo.roundMoney(o.sellerPayout + (o.coinBonus || 0), o.currency), narration: `Sokoni payout ${o.id.slice(0, 8)}`, crop: o.crop });
// A payout can fail simply because the buyer's money has not settled into the provider balance yet (cards/M-Pesa settle after a day or so). That is not a real failure: keep retrying for 3 days.
const waitNote = () => { const d = payments.payoutWaitDays(); return d > 0 ? "Your payout is waiting for the buyer's payment to settle (about " + d + " days after they paid). It will be sent automatically." : "Your payout is being processed."; };
const LOW_FUNDS = /insufficient|not enough|enough money|low (fund|balance)|balance (is )?too low|exceeds.*balance/i, fundsWaitMs = () => Math.max(1, Number(process.env.PAYOUT_FUNDS_WAIT_HOURS) || 168) * 3600e3; // how long a payout keeps retrying while collected money settles: 7 days by default (a provider's "2 days" can mean business days, so a Thursday payment may only settle on Monday)
async function runPayout(o) {
  const seller = userById(o.farmerId); if (!seller) return;
  if (!payouts.pick(sellerItem(o), seller)) { await patchOrder(o.id, { paymentStatus: "payout_pending", payoutManual: !!seller.payout, payoutNote: payouts.why(sellerItem(o), seller), lastPayoutAt: now() }); return; }
  try {
    const r = await payouts.pay(sellerItem(o), seller);
    if (r.status === "completed") await patchOrder(o.id, { paymentStatus: "paid_out", paidOutAt: now(), payoutRoute: r.route, payoutRef: r.ref, payoutNote: null, payoutWaitingFunds: false });
    else await patchOrder(o.id, { paymentStatus: "payout_initiated", payoutRoute: r.route, payoutRef: r.ref, payoutConversationId: r.conversationId || null, payoutNote: null, payoutWaitingFunds: false, lastPayoutAt: now() });
    await evt(r.route, "payout_sent", o.id, "processed", r.status);
  } catch (e) { console.error("payout", o.id, e.message);
    if (LOW_FUNDS.test(e.message)) { await patchOrder(o.id, { paymentStatus: "payout_failed", payoutError: e.message, payoutWaitingFunds: true, payoutWaitingSince: o.payoutWaitingSince || now(), payoutNote: waitNote(), lastPayoutAt: now() }); await evt("payout", "payout_waiting_funds", o.id, "needs_review", "provider balance too low — will retry as funds settle"); return; }
    await patchOrder(o.id, { paymentStatus: "payout_failed", payoutError: e.message, payoutAttempts: (o.payoutAttempts || 0) + 1, lastPayoutAt: now() }); await evt("payout", "payout_failed", o.id, "failed", e.message); }
}
async function releaseOrder(o, how) { let u = await patchOrder(o.id, { buyerConfirmedAt: now(), releaseReason: how, paymentStatus: "payout_pending", payoutAttempts: 0 }); u = await applyCoinBonus(u); await runPayout(u); return await patchOrder(o.id, {}); }
// ============ the company's permanent record: payments in / out, earnings, receipt emails, Sokoni Coin ============
const METHOD_NAMES = { mpesa: "M-Pesa", mpesa_manual: "M-Pesa (Paybill)", crypto: "USDC (crypto)", card: "Card", paypal: "PayPal", wire: "Bank transfer", international: "Secure payment page", momo: "Mobile money", test: "Test payment" };
const methodName = (o) => METHOD_NAMES[o.paymentMethod] || METHOD_NAMES[o.paymentProvider] || o.paymentMethod || o.paymentProvider || "";
const fmtM = (a, c) => `${c} ${Number(a || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const envNum = (k, d) => { const v = process.env[k]; return v == null || v === "" || !isFinite(Number(v)) ? d : Number(v); };
const coinBalance = (uid) => Math.round(store.readAll("coin_ledger").filter((e) => e.userId === uid).reduce((n, e) => n + e.delta, 0) * 100) / 100;
// ---- Sokoni Coin as TRUST COLLATERAL (closed loop: earned only — never bought, sent to anyone, cashed out, or paid as interest) ----
// A seller can LOCK earned coins as a bond behind their word. A bonded seller ranks a little higher and wears a badge; if they lose a dispute, part of the bond is slashed:
// half is burned, half goes to the buyer as coins. Unlocking takes a cooling-off period and never completes while a dispute is open. Coins can also pay for a listing boost.
const BOND_MIN = () => envNum("BOND_MIN_COINS", 100), BOND_COOLDOWN_DAYS = () => envNum("BOND_COOLDOWN_DAYS", 14), BOND_SLASH_SHARE = () => envNum("BOND_SLASH_SHARE", 0.5), BOOST_PER_DAY = () => envNum("BOOST_COINS_PER_DAY", 20);
const bondMap = () => { const m = {}; for (const e of store.readAll("coin_ledger")) if (e.bondDelta) m[e.userId] = (m[e.userId] || 0) + e.bondDelta; return m; };
const round2 = (n) => Math.round(Number(n) * 100) / 100, bondOf = (uid) => round2(bondMap()[uid] || 0);
const unbondingOf = (uid) => round2(store.readAll("coin_unbonds").filter((x) => x.userId === uid && x.status === "waiting").reduce((n, x) => n + x.amount, 0));
const isBondedAmt = (b) => b >= BOND_MIN(), boostedNow = (l) => !!(l.boostedUntil && new Date(l.boostedUntil).getTime() > Date.now());
const coinInfo = (uid) => { const waiting = store.readAll("coin_unbonds").filter((x) => x.userId === uid && x.status === "waiting").sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt)), bonded = bondOf(uid); return { balance: coinBalance(uid), bonded, unbonding: unbondingOf(uid), isBonded: isBondedAmt(bonded), bondMin: BOND_MIN(), cooldownDays: BOND_COOLDOWN_DAYS(), slashShare: BOND_SLASH_SHARE(), boostPerDay: BOOST_PER_DAY(), nextRelease: waiting[0] ? waiting[0].releaseAt : null }; };
const toUsd = (amount, cur) => { const r = fx.rateSync(cur, "USD"); return r ? amount * r : null; };
function receiptMail(e) {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""), foot = `\n\nYour full statement: ${base || "your Sokoni account"} → Account → Payments & earnings.\nWe keep this record permanently. Questions? Reply to this email or message us in the app.`, ref = e.reference ? `\nReference: ${e.reference}` : "", ord = e.orderId ? `\nOrder: ${e.orderId.slice(0, 8)}` : "", when = `\nDate: ${new Date(e.at || Date.now()).toUTCString()}`;
  if (e.kind === "payment") return { subject: `Sokoni receipt — you paid ${fmtM(e.amount, e.currency)}`, text: `Thank you. We received your payment for ${e.crop} from ${e.other}.\n\nAmount: ${fmtM(e.amount, e.currency)}${e.charged && e.charged.currency !== e.currency ? ` (charged as ${fmtM(e.charged.amount, e.charged.currency)})` : ""}\nMethod: ${e.method}${ref}${ord}${when}\n\nYour money is held safely by Sokoni and is released to the seller only after you confirm the delivery.${foot}` };
  if (e.kind === "refund") return { subject: `Sokoni refund — ${fmtM(e.amount, e.currency)}`, text: `Your payment for ${e.crop} was refunded.\n\nAmount: ${fmtM(e.amount, e.currency)}\nMethod: ${e.method}${ref}${ord}${when}${foot}` };
  if (e.kind === "sale") return { subject: `Sokoni payout — you were paid ${fmtM(e.amount, e.currency)}`, text: `You have been paid for ${e.crop} sold to ${e.other}.\n\nSale value: ${fmtM(e.gross, e.currency)}\nSokoni fee: ${fmtM(e.commission, e.currency)}${e.coinBonus ? `\nSokoni Coin credit: +${fmtM(e.coinBonus, e.currency)}` : ""}\nYou received: ${fmtM(e.amount, e.currency)}\nPaid via: ${e.method}${ref}${ord}${when}${foot}` };
  return { subject: `Sokoni — delivery fee paid ${fmtM(e.amount, e.currency)}`, text: `Your delivery fee has been paid.\n\nAmount: ${fmtM(e.amount, e.currency)}\nPaid via: ${e.method}${ref}${ord}${when}${foot}` };
}
function emailEntry(e) { const u = userById(e.userId); if (!u || !u.email) return; const m = receiptMail(e); notify.sendEmail(u.email, m.subject, m.text).then((r) => { if (!r.ok && r.provider) console.error("receipt email:", r.error); }).catch(() => {}); } // to the address they signed up with
async function ledgerAppend(want) {
  want = want.filter(Boolean); if (!want.length) return []; let added = [];
  await store.mutate("ledger", (all) => { const have = new Set(all.map((x) => x.key)); added = want.filter((w) => !have.has(w.key)).map((w) => ({ id: id(), recordedAt: now(), ...w })); return added.length ? [...all, ...added] : all; });
  for (const e of added) emailEntry(e); return added;
}
async function ledgerSyncOrder(o) {
  const ps = o.paymentStatus, paid = !!o.escrowedAt && !["unpaid", "pending", "failed"].includes(ps), amt = o.total != null ? o.total : o.amount, m = methodName(o), want = [];
  if (paid) want.push({ key: `pay:${o.id}`, userId: o.buyerId, kind: "payment", direction: "out", amount: amt, currency: o.currency, charged: o.chargeAmount ? { amount: o.chargeAmount, currency: o.chargeCurrency } : null, method: m, reference: o.mpesaReceipt || o.providerPaymentId || o.providerRef || "", at: o.escrowedAt, orderId: o.id, crop: o.crop, other: o.farmerName });
  if (ps === "refunded") want.push({ key: `refund:${o.id}`, userId: o.buyerId, kind: "refund", direction: "in", amount: amt, currency: o.currency, method: m, reference: "", at: o.refundedAt || o.updatedAt || now(), orderId: o.id, crop: o.crop, other: o.farmerName });
  if (ps === "paid_out") want.push({ key: `sale:${o.id}`, userId: o.farmerId, kind: "sale", direction: "in", currency: o.currency, amount: geo.roundMoney(o.sellerPayout + (o.coinBonus || 0), o.currency), gross: o.amount, commission: o.commission, levy: o.coinLevySeller || 0, coinBonus: o.coinBonus || 0, method: o.payoutRoute || "payout", reference: o.payoutRef || "", at: o.paidOutAt || now(), orderId: o.id, crop: o.crop, other: o.buyerName });
  const added = await ledgerAppend(want); for (const e of added) if (e.kind === "sale") pushTo(e.userId, { title: "Payout sent", body: `${e.currency} ${e.amount} for your ${o.crop} is on its way to you.`, url: "/?tab=account", tag: "payout-" + o.id });
  if (added.some((e) => e.kind === "sale") && o.buyerId !== o.farmerId && o.paymentProvider !== "test") { // Sokoni Coin: a thank-you for a completed trade — never for trading with yourself or test payments
    // Sokoni Coin accrual: each side puts 0.05% of the trade value into a pool (0.10% in all). Half of the pool is Sokoni's, the other half is shared equally by the buyer and the seller.
    // The coins are MINTED as bookkeeping units (nobody is charged extra money). They are not transferable or cashable — see COIN.md before anyone promises more than that.
    dataset.addOutcome(o.listingId, { type: o.disputeResolution === "released" ? "dispute_seller_won" : "completed", order: o.id }).catch(() => {});
    const usd = toUsd(o.amount, o.currency), val = envNum("COIN_USD_VALUE", 0.01), pool = o.coinLevyBuyer != null || o.coinLevySeller != null ? toUsd((o.coinLevyBuyer || 0) + (o.coinLevySeller || 0), o.currency) : usd ? usd * (envNum("COIN_LEVY_PCT", 0.05) / 100) * 2 : 0, shareT = Math.min(1, Math.max(0, envNum("COIN_SOKONI_SHARE", 0.5)));
    const each = val > 0 ? Math.round(((pool * (1 - shareT)) / 2 / val) * 100) / 100 : 0, treasury = val > 0 ? Math.round(((pool * shareT) / val) * 100) / 100 : 0;
    if (each > 0 || treasury > 0) await store.mutate("coin_ledger", (all) => { const have = new Set(all.map((x) => x.key)); return [...all, ...[["s", o.farmerId, each, "completed_trade"], ["b", o.buyerId, each, "completed_trade"], ["t", "sokoni:treasury", treasury, "trade_levy"]].filter(([k, , amt]) => amt > 0 && !have.has(`coin:${k}:${o.id}`)).map(([k, uid, amt, reason]) => ({ id: id(), key: `coin:${k}:${o.id}`, userId: uid, delta: amt, reason, orderId: o.id, at: now() }))]; });
  }
}
async function ledgerSyncDelivery(d) { if (d.riderPayoutStatus === "paid" && d.feeAmount > 0 && d.riderId) (await ledgerAppend([{ key: `rider:${d.id}`, userId: d.riderId, kind: "delivery", direction: "in", amount: d.feeAmount, currency: d.feeCurrency, method: d.riderPayoutRoute || "payout", reference: d.riderPayoutRef || "", at: d.riderPaidAt || now(), orderId: d.orderId, crop: "delivery", other: d.buyerName || "" }])).forEach((e) => pushTo(e.userId, { title: "You were paid", body: `${e.currency} ${e.amount} for your delivery has been sent.`, url: "/?tab=deliver", tag: "paid-" + d.id })); }
// Sokoni Coin lowers the fee: when a seller is paid, coins cover up to half of Sokoni's commission (the company funds it). Coins can't be bought, sent or cashed out.
async function applyCoinBonus(o) {
  if (o.coinChecked) return o; const bal = coinBalance(o.farmerId), val = envNum("COIN_USD_VALUE", 0.01), r = fx.rateSync("USD", o.currency); let bonus = 0, used = 0;
  if (bal > 0 && o.commission > 0 && val > 0 && r) { const maxB = o.commission * envNum("COIN_MAX_COMMISSION_SHARE", 0.5), per = val * r; bonus = geo.roundMoney(Math.min(maxB, bal * per), o.currency); used = bonus > 0 ? Math.round((bonus / per) * 100) / 100 : 0; if (used > bal) used = bal; }
  if (used > 0) await store.mutate("coin_ledger", (all) => (all.some((x) => x.key === `coinuse:${o.id}`) ? all : [...all, { id: id(), key: `coinuse:${o.id}`, userId: o.farmerId, delta: -used, reason: "fee_credit", orderId: o.id, at: now() }]));
  return patchOrder(o.id, { coinChecked: true, coinBonus: bonus, coinsUsed: used });
}
async function getWallet(req, res) {
  const u = requireAuth(req, res); if (!u) return; const me = u.id, all = store.readAll("ledger").filter((e) => e.userId === me).sort((a, b) => new Date(b.at) - new Date(a.at)), t = {}, mo = {}, pend = {}, first = new Date(); first.setUTCDate(1); first.setUTCHours(0, 0, 0, 0);
  const add = (o, c, k, v) => { (o[c] = o[c] || { received: 0, spent: 0, refunded: 0, fees: 0, deliveries: 0 })[k] += v || 0; };
  for (const e of all) for (const [o, on] of [[t, true], [mo, new Date(e.at) >= first]]) if (on) { if (e.kind === "payment") add(o, e.currency, "spent", e.amount); else if (e.kind === "refund") add(o, e.currency, "refunded", e.amount); else if (e.kind === "sale") { add(o, e.currency, "received", e.amount); add(o, e.currency, "fees", (e.commission || 0) + (e.levy || 0)); } else if (e.kind === "delivery") { add(o, e.currency, "received", e.amount); add(o, e.currency, "deliveries", e.amount); } }
  for (const o of store.readAll("orders")) if (o.farmerId === me && ["escrowed", "payout_pending", "payout_initiated", "payout_failed"].includes(o.paymentStatus)) pend[o.currency] = (pend[o.currency] || 0) + o.sellerPayout;
  for (const d of store.readAll("deliveries")) if (d.riderId === me && ["pending", "initiated", "failed"].includes(d.riderPayoutStatus) && d.feeAmount > 0) pend[d.feeCurrency] = (pend[d.feeCurrency] || 0) + d.feeAmount;
  const coins = store.readAll("coin_ledger").filter((e) => e.userId === me).sort((a, b) => new Date(b.at) - new Date(a.at));
  sendJSON(res, 200, { entries: all.slice(0, 300).map(({ key, ...e }) => e), totals: t, month: mo, pending: pend, coin: { ...coinInfo(me), history: coins.slice(0, 20).map((e) => ({ delta: e.delta, bondDelta: e.bondDelta || 0, reason: e.reason, orderId: e.orderId, at: e.at })), levyPct: envNum("COIN_LEVY_PCT", 0.05), levyCharged: process.env.COIN_LEVY_CHARGED !== "0", earnPerThousandUsd: Math.round((1000 * (envNum("COIN_LEVY_PCT", 0.05) / 100) * (1 - Math.min(1, Math.max(0, envNum("COIN_SOKONI_SHARE", 0.5)))) / envNum("COIN_USD_VALUE", 0.01)) * 100) / 100, usdValue: envNum("COIN_USD_VALUE", 0.01), maxShare: envNum("COIN_MAX_COMMISSION_SHARE", 0.5) }, email: u2email(me) });
}
const u2email = (uid) => { const u = userById(uid); return u && u.email ? u.email : ""; };
async function walletCsv(req, res) {
  const u = requireAuth(req, res); if (!u) return; const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`, rows = store.readAll("ledger").filter((e) => e.userId === u.id).sort((a, b) => new Date(a.at) - new Date(b.at));
  const csv = ["Date,Type,Direction,Amount,Currency,Charged,Method,Reference,Order,With,Sokoni fee,Coin credit"].concat(rows.map((e) => [e.at, e.kind, e.direction, e.amount, e.currency, e.charged ? `${e.charged.amount} ${e.charged.currency}` : "", e.method, e.reference, e.orderId, e.other, e.commission || "", e.coinBonus || ""].map(q).join(","))).join("\n");
  res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="sokoni-statement.csv"' }); res.end(csv);
}
// ============ M-Pesa Paybill, the customer pays by themselves (C2B) ============
const c2bToken = () => hmac("c2b|" + (process.env.PUBLIC_BASE_URL || "")).slice(0, 24); // no "mpesa"/"safaricom" in the path: Safaricom refuses such callback URLs
const c2bBase = () => (process.env.MPESA_CALLBACK_BASE_URL || process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const c2bUrls = () => ({ confirmation: `${c2bBase()}/api/webhooks/c2b/${c2bToken()}/confirmation`, validation: `${c2bBase()}/api/webhooks/c2b/${c2bToken()}/validation` });
const codeOf = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const imgKind = (b) => (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 ? "jpg" : b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? "png" : null);
const newMpesaRef = (o) => { const all = store.readAll("orders"); let n = 8, r; do { r = "SOK" + o.id.replace(/[^a-z0-9]/gi, "").slice(0, n).toUpperCase(); n++; } while (all.some((x) => x.id !== o.id && x.mpesaRef === r) && n < 20); return r; };
const setC2B = (transId, p) => store.mutate("mpesa_payments", (all) => all.map((x) => (x.transId === transId ? { ...x, ...p } : x)));
const setClaim = (cid, p) => store.mutate("mpesa_claims", (all) => all.map((x) => (x.id === cid ? { ...x, ...p } : x)));
const transTime = (s) => { const m = String(s).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 3, +m[5], +m[6])).toISOString() : null; }; // Safaricom time is EAT (UTC+3)
async function applyC2B(rec, o, via, claim) {
  if (FINAL.includes(o.paymentStatus) || o.status !== "accepted") { await setC2B(rec.transId, { orderId: o.id, status: "orphan", via }); await evt("mpesa", "c2b_orphan", o.id, "needs_review", `${rec.transId} KES ${rec.amount} arrived but this order isn't awaiting payment — refund the buyer`); if (claim) await setClaim(claim.id, { status: "review" }); return o; }
  const due = o.chargeAmount, paid = Math.round(((o.mpesaPaid || 0) + rec.amount) * 100) / 100, codes = [...(o.mpesaCodes || []), rec.transId]; await setC2B(rec.transId, { orderId: o.id, status: "matched", via });
  let out;
  if (paid + 0.5 >= due) { const u = await patchOrder(o.id, { mpesaPaid: paid, mpesaCodes: codes, mpesaReceipt: codes.join(", "), paymentProvider: "mpesa", paymentMethod: "mpesa_manual" }); out = await settlePayment(u, { provider: "mpesa", id: codes.join(","), note: `Paybill payment ${rec.transId} (${via})` }); if (paid > due + 1) await evt("mpesa", "c2b_overpaid", o.id, "needs_review", `paid KES ${paid}, due KES ${due} — refund KES ${Math.round((paid - due) * 100) / 100}`); }
  else { out = await patchOrder(o.id, { mpesaPaid: paid, mpesaCodes: codes }); await evt("mpesa", "c2b_partial", o.id, "processed", `KES ${paid} of ${due} received`); }
  if (claim) await setClaim(claim.id, { status: "approved", approvedAt: now(), transId: rec.transId }); return out;
}
async function processC2B(t) {
  if (!t.transId || !(t.amount > 0) || store.readAll("mpesa_payments").some((x) => x.transId === t.transId)) return; // Safaricom retries callbacks: handle each payment once
  const rec = { transId: t.transId, amount: t.amount, billRef: t.billRef, msisdn: t.msisdn, name: t.name, at: transTime(t.time) || now(), receivedAt: now(), orderId: null, status: "unmatched" };
  await store.mutate("mpesa_payments", (all) => (all.some((x) => x.transId === rec.transId) ? all : [...all, rec]));
  const claim = store.readAll("mpesa_claims").find((c) => c.code === t.transId && c.status === "waiting"); let o = t.billRef ? store.readAll("orders").find((x) => x.mpesaRef === t.billRef) : null, via = o ? "reference" : null;
  if (!o && claim) { o = store.readAll("orders").find((x) => x.id === claim.orderId); via = "claim"; }
  if (!o) return evt("mpesa", "c2b_unmatched", null, "needs_review", `${t.transId} KES ${t.amount} account "${t.billRef}" — assign it to an order in Operations → Payments`);
  await applyC2B(rec, o, via, claim);
}
async function c2bValidation(req, res, m) { if (m[1] !== c2bToken()) return sendJSON(res, 403, { error: "Forbidden" }); const t = mpesa.parseC2B(await readBody(req)), o = t.billRef && store.readAll("orders").find((x) => x.mpesaRef === t.billRef); sendJSON(res, 200, o && !FINAL.includes(o.paymentStatus) ? { ResultCode: 0, ResultDesc: "Accepted" } : { ResultCode: "C2B00012", ResultDesc: "Rejected" }); } // only used if Safaricom enabled validation for your shortcode
async function c2bConfirmation(req, res, m) { if (m[1] !== c2bToken()) return sendJSON(res, 403, { error: "Forbidden" }); const body = await readBody(req); try { await processC2B(mpesa.parseC2B(body)); } catch (e) { console.error("c2b", e.message); } sendJSON(res, 200, { ResultCode: 0, ResultDesc: "Accepted" }); }
async function mpesaClaim(req, res, m) { // "I paid from my SIM toolkit" — the code (or a photo of the receipt) is only a pointer; Safaricom's own confirmation is what proves the payment
  const p = partyOrder(req, res, m[1]); if (!p) return; const { u, o } = p; if (o.buyerId !== u.id) return sendJSON(res, 403, { error: "Only the buyer can do this." });
  if ((!o.mpesaRef && !o.equityPaybill) || o.paymentStatus !== "pending") return sendJSON(res, 400, { error: "No M-Pesa payment is waiting on this order." });
  const w = waitMinutes("claim:" + u.id, 12, 3600e3); if (w) return sendJSON(res, 429, { error: `Too many attempts. Try again in ${w} minute(s).` }); noteAttempt("claim:" + u.id);
  const b = await readBody(req, 7e6), cid = id(); let code = codeOf(b.code), file = null;
  if (b.receipt && b.receipt.data) { const buf = Buffer.from(String(b.receipt.data), "base64"), kind = imgKind(buf); if (!kind || buf.length > 5e6 || buf.length < 500) return sendJSON(res, 400, { error: "Upload a photo or screenshot (JPG or PNG, up to 5 MB)." });
    file = `mpesa-receipt-${cid}.${kind}`; fs.writeFileSync(path.join(PRIVATE_DIR, file), buf); if (!code && vision.isConfigured()) { const r = await vision.readReceipt({ photo: buf.toString("base64"), mime: kind === "png" ? "image/png" : "image/jpeg" }).catch(() => null); code = codeOf(r && r.code); } }
  if (!((o.mobileNetwork || "mpesa") === "mpesa" ? /^[A-Z0-9]{10}$/ : /^[A-Z0-9]{6,24}$/).test(code)) { if (file) try { fs.unlinkSync(path.join(PRIVATE_DIR, file)); } catch (e) { /* gone */ } return sendJSON(res, 400, { error: "Enter the 10-character M-Pesa code from your confirmation message (for example SHK3L9X2PA)." }); }
  if (store.readAll("mpesa_claims").some((c) => c.code === code && c.orderId !== o.id && c.status !== "rejected")) return sendJSON(res, 409, { error: "That M-Pesa code has already been used on another order." });
  if (o.equityPaybill) { // Equity: the code is only a pointer; the proof is a credit with that code (or this buyer's phone) on Equity's own statement
    if (b.phone) { try { const ph = jenga.msisdn(clean(b.phone, 20)); if (/^254\d{9}$/.test(ph)) await patchOrder(o.id, { jengaPhone: ph }); } catch (e) { /* keep the registered number */ } }
    const claim = { id: cid, orderId: o.id, userId: u.id, code, file, equity: true, status: "waiting", createdAt: now() }; await store.mutate("mpesa_claims", (all) => [...all.filter((c) => !(c.orderId === o.id && c.code === code)), claim]);
    if (await tryEquityClaim(userOrder(o.id), claim)) return sendJSON(res, 200, { status: "approved", order: viewOrder(userOrder(o.id), u.id) });
    equitySweep().catch(() => { /* the timer will try again */ }); await evt("jenga", "paybill_claim_waiting", o.id, "processed", `${code} — looking for it on the Equity statement`);
    return sendJSON(res, 202, { status: "waiting", message: jenga.isConfigured() ? "We're looking for that payment on our bank's record — usually a minute or two. This page updates by itself." : "Thank you — we have your M-Pesa code. We confirm Pay Bill payments when we see the money in our bank account, usually within a few hours, and you'll get a message." });
  }
  const rec = store.readAll("mpesa_payments").find((x) => x.transId === code); if (rec && rec.orderId && rec.orderId !== o.id) { await evt("mpesa", "claim_conflict", o.id, "needs_review", `${code} already applied to order ${rec.orderId.slice(0, 8)}`); return sendJSON(res, 409, { error: "That payment was already applied to another order." }); }
  const claim = { id: cid, orderId: o.id, userId: u.id, code, file, status: "waiting", createdAt: now() }; await store.mutate("mpesa_claims", (all) => [...all.filter((c) => !(c.orderId === o.id && c.code === code)), claim]);
  if (!rec) { await evt("mpesa", "claim_waiting", o.id, "processed", `${code} — waiting for Safaricom's confirmation`); return sendJSON(res, 202, { status: "waiting", message: "We're waiting for M-Pesa to confirm that payment — usually a few seconds. This page updates by itself." }); }
  if (rec.orderId === o.id) return sendJSON(res, 200, { status: "approved", order: viewOrder(userOrder(o.id), u.id) });
  if (!(rec.billRef === o.mpesaRef || mpesa.msisdnMatches(rec.msisdn, (userById(u.id) || {}).phone))) { await setClaim(cid, { status: "review" }); await evt("mpesa", "claim_review", o.id, "needs_review", `${code} KES ${rec.amount} — payer and account number don't match this buyer`); return sendJSON(res, 202, { status: "review", message: "We found that payment but it doesn't match your phone number or the account number, so our team will check it (usually within a few hours)." }); }
  const out = await applyC2B(rec, o, "claim", claim), left = Math.max(0, Math.round((out.chargeAmount - (out.mpesaPaid || 0)) * 100) / 100);
  sendJSON(res, 200, { status: left > 0 && !out.escrowedAt ? "partial" : "approved", remaining: left, order: viewOrder(userOrder(o.id), u.id) });
}
const userOrder = (oid) => store.readAll("orders").find((x) => x.id === oid);
async function adminMpesa(req, res) { // unmatched payments, claims needing a person, the receipts people uploaded
  if (!requireAdmin(req, res)) return; const orders = store.readAll("orders"), brief = (o) => (o ? { id: o.id, crop: o.crop, buyer: o.buyerName, due: o.chargeAmount, paid: o.mpesaPaid || 0, status: o.paymentStatus, ref: o.mpesaRef } : null);
  sendJSON(res, 200, { urls: c2bUrls(), payments: store.readAll("mpesa_payments").filter((x) => x.status !== "matched").sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt)).slice(0, 100).map((x) => ({ ...x, msisdn: undefined, order: brief(orders.find((o) => o.id === x.orderId)) })),
    claims: store.readAll("mpesa_claims").filter((c) => ["review", "waiting"].includes(c.status)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100).map((c) => ({ id: c.id, code: c.code, status: c.status, createdAt: c.createdAt, hasReceipt: !!c.file, order: brief(orders.find((o) => o.id === c.orderId)) })) });
}
async function adminMpesaAssign(req, res, m) { if (!requireAdmin(req, res)) return; const b = await readBody(req), rec = store.readAll("mpesa_payments").find((x) => x.transId === codeOf(m[1])), o = userOrder(clean(b.orderId, 60)); if (!rec || !o) return sendJSON(res, 404, { error: "Payment or order not found." }); if (rec.status === "matched") return sendJSON(res, 409, { error: "That payment is already applied." });
  const claim = store.readAll("mpesa_claims").find((c) => c.code === rec.transId && c.orderId === o.id); await applyC2B(rec, o, "admin", claim); await evt("admin", "c2b_assigned", o.id, "processed", rec.transId); sendJSON(res, 200, { ok: true }); }
async function adminMpesaReceipt(req, res, m) { if (!requireAdmin(req, res)) return; const c = store.readAll("mpesa_claims").find((x) => x.id === m[1]); if (!c || !c.file) return sendJSON(res, 404, { error: "No receipt." }); fs.readFile(path.join(PRIVATE_DIR, path.basename(c.file)), (err, data) => { if (err) return sendJSON(res, 404, { error: "File missing." }); res.writeHead(200, { "Content-Type": c.file.endsWith("png") ? "image/png" : "image/jpeg", "Cache-Control": "private, no-store" }); res.end(data); }); }
async function adminMpesaRegister(req, res) { if (!requireAdmin(req, res)) return; if (!mpesa.isConfigured()) return sendJSON(res, 400, { error: "Set up M-Pesa (consumer key/secret, shortcode, passkey, callback address) first." }); if (!c2bBase()) return sendJSON(res, 400, { error: "Set PUBLIC_BASE_URL (your https address) first." }); const u = c2bUrls(); try { sendJSON(res, 200, { ...(await mpesa.registerC2B({ confirmationUrl: u.confirmation, validationUrl: u.validation })), urls: u }); } catch (e) { sendJSON(res, 200, { ok: false, detail: e.message, urls: u }); } }
async function adminMpesaSimulate(req, res) { if (!requireAdmin(req, res)) return; const b = await readBody(req), o = userOrder(clean(b.orderId, 60)); if (!o || !o.mpesaRef) return sendJSON(res, 400, { error: "Choose an order that has M-Pesa Paybill instructions." }); try { sendJSON(res, 200, await mpesa.simulateC2B({ amount: b.amount || o.chargeAmount, billRef: o.mpesaRef })); } catch (e) { sendJSON(res, 200, { ok: false, detail: e.message }); } }

async function payOrder(req, res, m) {
  const p = partyOrder(req, res, m[1]); if (!p) return; const { u, o } = p; const b = await readBody(req);
  if (o.buyerId !== u.id) return sendJSON(res, 403, { error: "Only the buyer can pay for this order." });
  if (o.status !== "accepted") return sendJSON(res, 400, { error: "The seller hasn't accepted this order yet." });
  if (!["unpaid", "failed", "pending"].includes(o.paymentStatus)) return sendJSON(res, 400, { error: "This order is already paid or being processed." });
  const ctx = { currency: o.currency, buyerCountry: o.buyerCountry }; const method = clean(b.method, 20); const provider = payments.routeFor(method, ctx) || (method === "mpesa" && b.manual === true && payments.manualKind() === "equity" ? "jenga" : null); // Pay Bill needs only the account number, not the API
  if (!provider) return sendJSON(res, 400, { error: payments.optionsFor(ctx).length ? "Choose an available payment method." : `No payment method is set up for ${o.currency} yet.`, code: "NO_PROVIDER" });
  const buyer = userById(o.buyerId);
  if (provider === "bank_wire") { // international bank transfer: instructions + a unique reference; the order is held only when the money has arrived
    try { const w = await payments.wireQuote(o); const upd = await patchOrder(o.id, { paymentProvider: "bank_wire", paymentMethod: "wire", paymentStatus: "pending", pendingSince: now(), providerRef: w.reference, wire: w, wireSentAt: null, paymentError: null });
      await evt("bank_wire", "wire_instructions_issued", o.id, "processed", `${w.reference} · ${w.amount} ${w.currency}`); return sendJSON(res, 200, { ok: true, wire: viewOrder(upd, u.id).wire });
    } catch (e) { return sendJSON(res, 502, { error: e.message || "Couldn't prepare the bank transfer." }); } }
  if (provider === "test") { await patchOrder(o.id, { paymentProvider: "test", paymentMethod: method }); const held = await settlePayment({ ...o, paymentProvider: "test" }, { provider: "test", id: "test-" + o.id, note: "sandbox payment" }); return sendJSON(res, 200, { ok: true, held: true, order: viewOrder(held, u.id) }); }
  // charge in a currency this method supports (the buyer's own, else USD) — the exact amount is stored and re-checked on every confirmation
  const q = await payments.quote(provider, method, o, geo.currencyOf(o.buyerCountry)); if (!q) return sendJSON(res, 400, { error: "This payment method can't take this order right now (no exchange rate available). Please choose another.", code: "NO_QUOTE" });
  if (method === "mpesa" && q.amount > payments.mpesaMax()) { const crypto2 = payments.routeFor("crypto", ctx), card2 = payments.routeFor("card", ctx), alt = crypto2 && card2 && card2 === "paystack" ? "by card or with USDC" : crypto2 ? "with USDC" : card2 ? "by card" : null; return sendJSON(res, 400, { error: `M-Pesa can't take more than KES ${payments.mpesaMax().toLocaleString("en-US")} in one payment. This order is KES ${q.amount.toLocaleString("en-US")} — ${alt ? "please pay " + alt + " instead." : "please order a smaller quantity, or split it into two orders."}`, code: "OVER_MPESA_LIMIT" }); } // (only suggests a way to pay that buyers can actually see)
  const qPatch = { chargeCurrency: q.currency, chargeAmount: method === "mpesa" && b.manual === true ? Math.ceil(q.amount) : q.amount, fxRate: q.rate, processingFee: q.fee || 0, processingFeePct: q.feePct || 0 };
  // which mobile-money network the buyer is paying with (M-Pesa unless they say otherwise). Each network only offers what is switched on for it — see lib/networks.js
  const netId = clean(b.network, 12).toLowerCase() || "mpesa", net = networks.get(netId);
  if (method === "mpesa") { if (!net) return sendJSON(res, 400, { error: "Choose M-Pesa, Airtel Money, Equitel or T-Kash." });
    if (b.manual === true && !(networks.paybillOn(netId) && (netId === "mpesa" || payments.manualKind() === "equity"))) return sendJSON(res, 400, { error: `${net.name} can't be paid by Pay Bill here yet.` });
    if (b.manual !== true && !(networks.promptOn(netId, provider) && (netId === "mpesa" || provider === "jenga" || (provider === "fincra" && !!fincra.OPERATORS[netId]) || (provider === "paystack" && !!paystack.OPERATORS[netId])))) return sendJSON(res, 400, { error: `A PIN prompt isn't available for ${net.name} yet — please pay with Pay Bill instead.` }); }
  if (method === "mpesa" && b.manual === true) { // pay yourself from the SIM toolkit: Paybill + account number; confirmed automatically when Safaricom reports the payment
    if (payments.manualKind() === "equity") { // Equity's Paybill: pay from the M-Pesa menu; we recognise the payment on Equity's own statement — no admin
      const phone = jenga.msisdn(clean(b.phone, 20) || (buyer && buyer.phone)), upd = await patchOrder(o.id, { paymentProvider: "jenga", paymentMethod: "mpesa_paybill_equity", paymentStatus: "pending", pendingSince: now(), ...qPatch, providerRef: null, equityPaybill: { paybill: payments.equityPaybill(), account: jenga.acct(), issuedAt: now() }, jengaPhone: phone, mobileNetwork: netId, mpesaPaid: o.mpesaPaid || 0, mpesaCodes: o.mpesaCodes || [], paymentError: null });
      await evt("jenga", "paybill_instructions_issued", o.id, "processed", `KES ${qPatch.chargeAmount}`); equitySweep().catch(() => {}); return sendJSON(res, 200, { ok: true, mpesaManual: viewOrder(upd, u.id).mpesaManual }); }
    if (!mpesa.isConfigured() || payments.showMode() === "paystack") return sendJSON(res, 400, { error: "Paying by Paybill isn't set up yet." }); // (in Paystack-only mode no other provider's manual route is reachable)
    const ref = o.mpesaRef || newMpesaRef(o), upd = await patchOrder(o.id, { paymentProvider: "mpesa", paymentMethod: "mpesa_manual", paymentStatus: "pending", pendingSince: now(), ...qPatch, mpesaRef: ref, mobileNetwork: "mpesa", mpesaPaid: o.mpesaPaid || 0, paymentError: null });
    await evt("mpesa", "manual_instructions_issued", o.id, "processed", `${ref} · KES ${qPatch.chargeAmount}`); return sendJSON(res, 200, { ok: true, mpesaManual: viewOrder(upd, u.id).mpesaManual }); }
  if (provider === "jenga") { // Equity Bank: the prompt goes to the buyer's phone, the money is settled straight into your Equity account, and a callback tells us
    try { const ref = jenga.newRef((x) => store.readAll("orders").some((y) => y.jengaRef === x)), amount = Math.ceil(q.amount), phone = jenga.msisdn(clean(b.phone, 20) || buyer.phone); // the prompt can go to a different line than the account phone (e.g. an Airtel SIM)
      if (!networks.kenyanMobile(phone)) return sendJSON(res, 400, { error: "Enter a valid Kenyan mobile number, like 0712 345 678 or 0733 123 456." });
      await jenga.stkPush({ ref, amount, phone, callbackUrl: jenga.urls().stk, telco: net.telco });
      await patchOrder(o.id, { paymentProvider: "jenga", paymentMethod: method, paymentStatus: "pending", pendingSince: now(), ...qPatch, chargeAmount: amount, jengaRef: ref, jengaPhone: phone, mobileNetwork: netId, equityPaybill: null });
      await evt("jenga", "stk_sent", o.id, "processed", `${ref} · KES ${amount}`); return sendJSON(res, 200, { ok: true, message: `Check your phone to complete the ${net.name} payment.` });
    } catch (e) { console.error("jenga stk", e.message); return sendJSON(res, 502, { error: e.message || "Couldn't start the M-Pesa payment." }); }
  }
  if (provider === "paystack" && method === "mpesa") { // Paystack M-Pesa / Airtel: the prompt goes to the buyer's phone, the money lands in your Paystack balance (held there by "manual payouts"), and a signed notification (double-checked with Paystack) tells us
    try { const op = paystack.OPERATORS[netId]; if (!op) return sendJSON(res, 400, { error: `A PIN prompt isn't available for ${net.name} — please choose another network.` });
      const phone = paystack.msisdn(clean(b.phone, 20) || buyer.phone); if (!networks.kenyanMobile(phone)) return sendJSON(res, 400, { error: "Enter a valid Kenyan mobile number, like 0712 345 678 or 0733 123 456." });
      const amount = Math.ceil(q.amount); if (amount > paystack.MPESA_MAX()) return sendJSON(res, 400, { error: `M-Pesa allows at most KES ${paystack.MPESA_MAX().toLocaleString("en-US")} in one payment — please pay this order another way (card or bank), or order a smaller quantity.`, code: "MPESA_LIMIT" });
      const ref = paystack.newRef((x) => store.readAll("orders").some((y) => y.providerRef === x)), host = String(process.env.PUBLIC_BASE_URL || "sokoni.app").replace(/^https?:\/\//, "").replace(/[:/].*$/, "");
      const c = await paystack.charge({ ref, amount, phone, provider: op, email: buyer.email || `buyer-${String(buyer.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}@${host}` });
      if (c.otp) return sendJSON(res, 400, { error: `${net.name} asks for an extra step through Paystack, which Sokoni doesn't support yet — please pay with M-Pesa instead.`, code: "OTP_NOT_SUPPORTED" });
      await patchOrder(o.id, { paymentProvider: "paystack", paymentMethod: method, paymentStatus: "pending", pendingSince: now(), ...qPatch, chargeAmount: amount, providerRef: ref, paystackPhone: phone, mobileNetwork: netId, equityPaybill: null, paymentError: null });
      await evt("paystack", "prompt_sent", o.id, "processed", `${ref} · KES ${amount}`); return sendJSON(res, 200, { ok: true, message: `Check your phone to complete the ${net.name} payment.` });
    } catch (e) { console.error("paystack charge", e.message); return sendJSON(res, 502, { error: e.message || "Couldn't start the M-Pesa payment." }); }
  }
  if (provider === "fincra") { // Fincra: the prompt goes to the buyer's phone, the money lands in your Fincra wallet, and a signed notification (double-checked with Fincra) tells us
    try { const op = fincra.OPERATORS[netId]; if (!op) return sendJSON(res, 400, { error: `A PIN prompt isn't available for ${net.name} — please choose another network.` });
      const phone = fincra.msisdn(clean(b.phone, 20) || buyer.phone); if (!networks.kenyanMobile(phone)) return sendJSON(res, 400, { error: "Enter a valid Kenyan mobile number, like 0712 345 678 or 0733 123 456." });
      const ref = fincra.newRef((x) => store.readAll("orders").some((y) => y.providerRef === x)), amount = Math.ceil(q.amount), host = String(process.env.PUBLIC_BASE_URL || "sokoni.app").replace(/^https?:\/\//, "").replace(/[:/].*$/, "");
      const c = await fincra.charge({ ref, amount, phone, operator: op, name: buyer.name, email: buyer.email || `buyer-${String(buyer.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}@${host}` });
      if (c.otp) return sendJSON(res, 400, { error: `${net.name} asks for a one-time code through Fincra, which Sokoni doesn't support yet — please pay with M-Pesa instead.`, code: "OTP_NOT_SUPPORTED" });
      await patchOrder(o.id, { paymentProvider: "fincra", paymentMethod: method, paymentStatus: "pending", pendingSince: now(), ...qPatch, chargeAmount: amount, providerRef: ref, fincraChargeId: c.id, fincraPhone: phone, mobileNetwork: netId, equityPaybill: null, paymentError: null });
      await evt("fincra", "prompt_sent", o.id, "processed", `${ref} · KES ${amount}`); return sendJSON(res, 200, { ok: true, message: `Check your phone to complete the ${net.name} payment.` });
    } catch (e) { console.error("fincra charge", e.message); return sendJSON(res, 502, { error: e.message || "Couldn't start the M-Pesa payment." }); }
  }
  if (provider === "mpesa") {
    try { const r = await mpesa.stkPush({ phone: buyer.phone, amount: q.amount, accountReference: o.id.slice(0, 10), transactionDesc: "Sokoni order" });
      await patchOrder(o.id, { paymentProvider: "mpesa", paymentMethod: method, paymentStatus: "pending", pendingSince: now(), ...qPatch, mpesaCheckoutRequestId: r.checkoutRequestId, mpesaMerchantRequestId: r.merchantRequestId });
      return sendJSON(res, 200, { ok: true, message: "Check your phone to complete the M-Pesa payment." });
    } catch (e) { console.error("stk", e.message); return sendJSON(res, 502, { error: e.message || "Couldn't start the M-Pesa payment." }); }
  }
  try { const c = await payments.createCheckout(provider, o, buyer, method, q);
    await patchOrder(o.id, { paymentProvider: provider, paymentMethod: method, paymentStatus: "pending", pendingSince: now(), ...qPatch, providerRef: c.ref, cryptoUsd: c.usd || null });
    sendJSON(res, 200, { ok: true, redirectUrl: c.url, ...(c.accessCode ? { inline: { provider: "paystack", accessCode: c.accessCode, reference: c.ref } } : {}) }); // (a card form that opens over the page, with the redirect kept as the fallback)
  } catch (e) { console.error("checkout", provider, e.message); sendJSON(res, e.code === "EMAIL_REQUIRED" ? 400 : 502, { error: e.message || "Couldn't start the payment." }); }
}
const findOrder = (fn) => store.readAll("orders").find(fn);
async function stripeWebhook(req, res) {
  const raw = (await readRaw(req)).toString("utf8");
  if (!payments.verifyStripeSignature(raw, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET)) { await evt("stripe", "bad_signature", null, "failed", "signature check failed"); return sendJSON(res, 400, { error: "Bad signature" }); }
  let ev; try { ev = JSON.parse(raw); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
  sendJSON(res, 200, { received: true }); const s = ev.data && ev.data.object; if (!s) return;
  const o = findOrder((x) => x.id === ((s.metadata && s.metadata.order_id) || s.client_reference_id)); if (!o || o.paymentProvider !== "stripe") return evt("stripe", ev.type, null, "ignored", "no matching order");
  if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
    if (s.payment_status !== "paid") return evt("stripe", ev.type, o.id, "ignored", "not paid yet");
    if (s.amount_total === payments.minorUnits(payments.due(o).amount, payments.due(o).currency) && String(s.currency).toUpperCase() === payments.due(o).currency) await settlePayment(o, { provider: "stripe", id: s.payment_intent || s.id });
    else await evt("stripe", ev.type, o.id, "needs_review", `amount/currency mismatch: got ${s.amount_total} ${s.currency}`);
  } else if (ev.type === "checkout.session.async_payment_failed") { await patchOrder(o.id, { paymentStatus: "failed", paymentError: "Payment failed" }); await evt("stripe", ev.type, o.id, "processed", "failed"); }
}
async function flutterwaveWebhook(req, res) {
  const given = Buffer.from(String(req.headers["verif-hash"] || "")), want = Buffer.from(process.env.FLW_SECRET_HASH || "");
  if (!want.length || given.length !== want.length || !crypto.timingSafeEqual(given, want)) { await evt("flutterwave", "bad_signature", null, "failed", "hash mismatch"); return sendJSON(res, 401, { error: "Bad signature" }); }
  const b = await readBody(req); sendJSON(res, 200, { received: true }); const d = b && b.data; if (!d) return;
  if (String(b.event || "").startsWith("transfer")) { // payout result
    const o = findOrder((x) => "SOKP-" + x.id === d.reference); if (!o) { const dl = store.readAll("deliveries").find((x) => "SOKR-" + x.id === d.reference); if (dl) await riderTransferResult(dl, { ok: String(d.status).toUpperCase() === "SUCCESSFUL", failed: String(d.status).toUpperCase() === "FAILED", message: d.complete_message }); return; }
    if (String(d.status).toUpperCase() === "SUCCESSFUL") { await patchOrder(o.id, { paymentStatus: "paid_out", paidOutAt: now(), payoutNote: null }); await evt("flutterwave", "payout_completed", o.id, "processed", "transfer successful"); }
    else if (String(d.status).toUpperCase() === "FAILED") { await patchOrder(o.id, { paymentStatus: "payout_failed", payoutError: d.complete_message || "Transfer failed", payoutAttempts: (o.payoutAttempts || 0) + 1, lastPayoutAt: now() }); await evt("flutterwave", "payout_failed", o.id, "failed", d.complete_message || "failed"); }
    return;
  }
  if (!d.tx_ref) return; const o = findOrder((x) => "SOK-" + x.id === d.tx_ref); if (!o || o.paymentProvider !== "flutterwave") return evt("flutterwave", String(b.event), null, "ignored", "no matching order");
  if (FINAL.includes(o.paymentStatus)) return;
  const v = await payments.flutterwaveVerify(d.id).catch(() => null); // never trust the webhook body alone
  if (v && v.status === "successful" && v.tx_ref === d.tx_ref && v.currency === payments.due(o).currency && Number(v.amount) >= payments.due(o).amount) await settlePayment(o, { provider: "flutterwave", id: String(v.id) });
  else if (v && v.status === "successful") await evt("flutterwave", String(b.event), o.id, "needs_review", `amount/currency mismatch: ${v.amount} ${v.currency}`);
  else if (d.status === "failed") { await patchOrder(o.id, { paymentStatus: "failed", paymentError: "Payment failed" }); await evt("flutterwave", String(b.event), o.id, "processed", "failed"); }
}
async function cryptoWebhook(req, res) {
  const b = await readBody(req); if (!payments.verifyNowSignature(b, req.headers["x-nowpayments-sig"])) { await evt("crypto", "bad_signature", null, "failed", "signature check failed"); return sendJSON(res, 401, { error: "Bad signature" }); }
  sendJSON(res, 200, { received: true }); return applyCrypto(b);
}
async function applyCrypto(b) { // used by the notification NOWPayments sends AND by our own look-ups when a notification goes missing
  const o = findOrder((x) => x.id === b.order_id); if (!o || o.paymentProvider !== "nowpayments") return evt("crypto", "ipn", null, "ignored", "no matching order");
  // A REPEATED DEPOSIT (more money sent to an address already used for this order) arrives as its own payment carrying a parent_payment_id. NOWPayments advises never to ship on one automatically: the totals may not add up.
  if (b.parent_payment_id && String(b.parent_payment_id) !== String(b.payment_id)) { const pu = payments.cryptoPaidUsd(b); return evt("crypto", "repeat_deposit", o.id, "needs_review", `a repeated deposit (payment ${b.payment_id}, parent ${b.parent_payment_id}, status ${b.payment_status}, about USD ${pu != null ? Math.round(pu * 100) / 100 : "?"}) arrived for this order — it was NOT counted automatically; check the totals in your NOWPayments dashboard and send the money back or mark the order by hand`); }
  if (b.payment_id && String(o.cryptoPaymentId || "") !== String(b.payment_id) && !FINAL.includes(o.paymentStatus)) await patchOrder(o.id, { cryptoPaymentId: String(b.payment_id) }); // remembered, so a lost final notification can be recovered
  let st = String(b.payment_status || ""); const due = payments.due(o).amount, paidUsd = payments.cryptoPaidUsd(b), usd = String(b.price_currency || "").toLowerCase() === "usd", r2 = (n) => Math.round(n * 100) / 100;
  // "finished" can be set by NOWPayments account settings even when LESS than the price arrived (short, repeated or wrong-asset deposits): believe the amount actually received, not the label
  if (st === "finished" && usd && paidUsd != null && paidUsd > 0 && paidUsd + payments.cryptoTolerance(due) < due) st = "partially_paid";
  if (FINAL.includes(o.paymentStatus)) { if (st === "refunded") await evt("crypto", "ipn", o.id, "needs_review", "NOWPayments refunded a payment that was already held — check this order"); return; }
  if (["confirming", "confirmed", "sending"].includes(st)) return void (await patchOrder(o.id, { cryptoStatus: st, cryptoUpdatedAt: now() })); // seen on the network, not final yet: the buyer is told it's being confirmed
  if (st === "finished") {
    if (usd && Number(b.price_amount) + 0.01 >= due) { if (paidUsd != null && paidUsd > due * 1.02 + 0.5) await evt("crypto", "overpaid", o.id, "needs_review", `buyer sent about USD ${r2(paidUsd - due)} more than the price — send the difference back by hand if you want to`); await patchOrder(o.id, { cryptoStatus: "finished" }); await settlePayment(o, { provider: "nowpayments", id: String(b.payment_id) }); }
    else await evt("crypto", "ipn", o.id, "needs_review", "price mismatch");
  } else if (st === "partially_paid") {
    if (usd && paidUsd != null && paidUsd + payments.cryptoTolerance(due) >= due) { await evt("crypto", "accepted_short", o.id, "processed", `USD ${r2(due - paidUsd)} short — within the tolerance (exchange withdrawal fees), accepted`); await patchOrder(o.id, { cryptoStatus: "finished", cryptoShortUsd: r2(Math.max(0, due - paidUsd)) }); await settlePayment(o, { provider: "nowpayments", id: String(b.payment_id), note: "small shortfall accepted" }); }
    else { await patchOrder(o.id, { cryptoStatus: "partial", cryptoPaidUsd: paidUsd, cryptoRemainingUsd: paidUsd != null ? r2(Math.max(0, due - paidUsd)) : null, cryptoUpdatedAt: now() }); await evt("crypto", "ipn", o.id, "processed", "partially paid — the buyer is asked to send the rest"); } // not held: the payment page lets them top up; if it expires, the money received is flagged for a refund
  } else if (["failed", "expired"].includes(st)) { const got = o.cryptoPaidUsd || paidUsd || 0;
    await patchOrder(o.id, { paymentStatus: "failed", paymentError: "Crypto payment " + st, cryptoStatus: st, cryptoRefundDueUsd: got > 0 ? got : null });
    await evt("crypto", "ipn", o.id, got > 0 ? "needs_review" : "processed", got > 0 ? `${st} after USD ${got} was received — send that back by hand to the address it came from` : st);
  } else if (st === "refunded") await evt("crypto", "ipn", o.id, "needs_review", "NOWPayments reports this payment as refunded");
}
async function cryptoCheck(req, res, m) { // "I paid but the page hasn't updated": the buyer gives the Payment ID shown on the payment page. We ask NOWPayments and act ONLY if that payment belongs to THIS order.
  const u = requireAuth(req, res); if (!u) return; const o = userOrder(m[1]); if (!o || o.buyerId !== u.id) return sendJSON(res, 404, { error: "Order not found." });
  if (o.paymentProvider !== "nowpayments" || o.paymentStatus !== "pending") return sendJSON(res, 400, { error: "No crypto payment is waiting on this order." });
  const w = waitMinutes("cryptochk:" + u.id, 12, 3600e3); if (w) return sendJSON(res, 429, { error: `Too many attempts. Try again in ${w} minute(s).` }); noteAttempt("cryptochk:" + u.id);
  const b = await readBody(req), pid = String(b.paymentId || "").trim(); if (!/^\d{4,20}$/.test(pid)) return sendJSON(res, 400, { error: "The Payment ID is a number, like 1234567890 — copy it from the payment page." });
  const d = await payments.cryptoPaymentById(pid).catch(() => null); if (!d) return sendJSON(res, 404, { error: "The payment service doesn't know that Payment ID — check the number." });
  if (String(d.order_id) !== o.id) { await evt("crypto", "check_mismatch", o.id, "needs_review", `Payment ${pid} belongs to a different order`); return sendJSON(res, 400, { error: "That payment isn't for this order." }); }
  await applyCrypto(d); const nu = userOrder(o.id); sendJSON(res, 200, { status: nu.paymentStatus, cryptoStatus: nu.cryptoStatus || null, order: viewOrder(nu, u.id) });
}
async function cryptoSweep() { // a final notification that never arrived: ask NOWPayments about crypto orders whose payment number we already know
  try { for (const o of store.readAll("orders").filter((x) => x.paymentProvider === "nowpayments" && x.paymentStatus === "pending" && x.cryptoPaymentId && Date.now() - new Date(x.pendingSince || 0).getTime() > 2 * 60000 && Date.now() - new Date(x.pendingSince || 0).getTime() < 3 * 86400e3)) { const d = await payments.cryptoPaymentById(o.cryptoPaymentId); if (d && String(d.order_id) === o.id) await applyCrypto(d); } } catch (e) { console.error("cryptoSweep", e.message); }
}
// ---- crypto go-live: what's done, which USDC networks are on, and the USDC ↔ shilling float ----
async function adminCrypto(req, res) {
  if (!requireAdmin(req, res)) return; const e = process.env, sandbox = e.NOWPAYMENTS_SANDBOX === "1", url = /^https:\/\//.test(e.PUBLIC_BASE_URL || "");
  const checklist = [
    { id: "key", label: "NOWPayments API key", ok: !!e.NOWPAYMENTS_API_KEY, fix: "Create an account at nowpayments.io, set your payout wallet (the USDC address you control), then generate an API key." },
    { id: "ipn", label: "IPN secret key", ok: !!e.NOWPAYMENTS_IPN_SECRET, fix: "In NOWPayments → Settings → Payments, create the IPN secret and paste it below." },
    { id: "url", label: "A public https address for payment notifications", ok: url, fix: "Set PUBLIC_BASE_URL to your https address (a tunnel works for testing)." },
    { id: "mode", label: sandbox ? "Sandbox mode (practice coins, no real money)" : "Live mode", ok: !sandbox, info: true, fix: "Set NOWPAYMENTS_SANDBOX=1 to practise with a sandbox key; remove it to go live." },
  ], orders = store.readAll("orders").filter((x) => x.paymentProvider === "nowpayments"), usdOf = (x) => { const d = payments.due(x); return d.currency === "USD" ? d.amount : 0; };
  const heldUsd = r2c(sum(orders.filter((x) => ["escrowed", "payout_pending", "payout_initiated", "payout_failed"].includes(x.paymentStatus)), usdOf)), paidOutUsd = r2c(sum(orders.filter((x) => x.paymentStatus === "paid_out"), usdOf)), convUsd = r2c(sum(store.readAll("treasury_conversions"), (x) => x.usd));
  const refundDue = orders.filter((x) => x.cryptoRefundDueUsd > 0 && x.paymentStatus === "failed" && !x.cryptoRefundSent).map((x) => ({ orderId: x.id, usd: x.cryptoRefundDueUsd, buyer: x.buyerName }));
  const out = { mode: sandbox ? "sandbox" : "live", ready: payments.cfg.nowpayments(), waitingFor: checklist.filter((x) => !x.ok && !x.info).map((x) => x.id), checklist, minUsd: payments.cryptoMinUsd(), pinned: e.CRYPTO_PAY_CURRENCY || null, ipnUrl: payments.cfg.nowpayments() ? `${(e.PUBLIC_BASE_URL || "").replace(/\/$/, "")}/api/webhooks/crypto` : null,
    treasury: { heldUsd, paidOutUsd, convertedUsd: convUsd, toConvertUsd: Math.max(0, r2c(paidOutUsd - convUsd)) }, refundsDue: refundDue };
  if (payments.cfg.nowpayments()) { const cn = await payments.cryptoCoins().catch((x) => ({ ok: false, error: x.message })); out.coins = cn.ok ? { source: cn.source, usdc: cn.usdc, count: cn.coins.length } : { error: cn.error }; }
  sendJSON(res, 200, out);
}
const r2c = (n) => Math.round(Number(n) * 100) / 100;
async function adminCryptoConvert(req, res) { // "I turned $X of USDC into shillings and put them in the Equity account" — keeps the float honest
  if (!requireAdmin(req, res)) return; const b = await readBody(req), usd = r2c(b.usd); if (!(usd > 0) || usd > 1e7) return sendJSON(res, 400, { error: "Enter how many US dollars (USDC) you converted." });
  await store.mutate("treasury_conversions", (all) => [...all, { id: id(), usd, note: clean(b.note, 120), at: now() }]); await evt("admin", "usdc_converted", null, "processed", `USD ${usd} of USDC converted to shillings`); sendJSON(res, 200, { ok: true });
}
// ---- international bank transfer: confirming that the money arrived ----
async function confirmWire(o, { amount, currency, bankRef, source }) {
  if (!o || o.paymentProvider !== "bank_wire" || o.paymentStatus !== "pending" || !o.wire) return { ok: false, status: 400, error: "This order isn't waiting for a bank transfer." };
  const m = payments.wireMatches(o.wire, { amount, currency }); if (!m.ok) { await evt("bank_wire", "wire_mismatch", o.id, "needs_review", `${source}: ${m.error}`); return { ok: false, status: 400, error: m.error }; }
  await patchOrder(o.id, { wireReceived: { amount: Number(amount), currency: String(currency || o.wire.currency).toUpperCase(), bankRef: clean(bankRef, 120), at: now(), source } });
  const held = await settlePayment(o, { provider: "bank_wire", id: clean(bankRef, 120) || o.wire.reference, note: `bank transfer received (${source})` }); return { ok: true, order: held };
}
async function wireSent(req, res, m) { // the buyer tells us they've sent it — just a hint for whoever confirms arrivals
  const p = partyOrder(req, res, m[1]); if (!p) return; if (p.o.buyerId !== p.u.id || p.o.paymentProvider !== "bank_wire" || p.o.paymentStatus !== "pending") return sendJSON(res, 400, { error: "There's no bank transfer to confirm for this order." });
  const b = await readBody(req).catch(() => ({})), note = clean(b && b.note, 120); // optional: an M-Pesa code or the bank's reference, so whoever confirms can find the payment on the statement
  await evt("bank_wire", "wire_buyer_says_sent", p.o.id, "processed", (p.o.wire && p.o.wire.reference) + (note ? " · " + note : "")); sendJSON(res, 200, { order: viewOrder(await patchOrder(p.o.id, { wireSentAt: now(), wireSentNote: note }), p.u.id) });
}
async function wireWebhook(req, res) { // for Wise / bank automation: POST {reference, amount, currency, bankReference} signed with HMAC-SHA256(raw body, WIRE_WEBHOOK_SECRET) in x-sokoni-signature
  if (!process.env.WIRE_WEBHOOK_SECRET) return sendJSON(res, 503, { error: "Arrival notifications aren't enabled." }); const raw = (await readRaw(req)).toString("utf8");
  if (!payments.verifyWireSignature(raw, req.headers["x-sokoni-signature"])) { await evt("bank_wire", "bad_signature", null, "failed", "signature check failed"); return sendJSON(res, 401, { error: "Bad signature" }); }
  let b; try { b = JSON.parse(raw); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); } const o = findOrder((x) => x.wire && x.wire.reference === String(b.reference || "").trim().toUpperCase());
  if (!o) { await evt("bank_wire", "wire_unmatched", null, "needs_review", `reference ${clean(b.reference, 40)} matches no waiting order`); return sendJSON(res, 200, { received: true, matched: false }); }
  if (FINAL.includes(o.paymentStatus)) return sendJSON(res, 200, { received: true, matched: true, already: true }); const r = await confirmWire(o, { amount: b.amount, currency: b.currency, bankRef: b.bankReference, source: "notification" }); sendJSON(res, 200, { received: true, matched: true, confirmed: r.ok, error: r.ok ? undefined : r.error });
}
async function adminTransfers(req, res) { if (!requireAdmin(req, res)) return; sendJSON(res, 200, { transfers: store.readAll("orders").filter((o) => o.paymentProvider === "bank_wire" && o.paymentStatus === "pending" && o.wire).sort(byNewest).map((o) => ({ orderId: o.id, reference: o.wire.reference, crop: o.crop, buyer: o.buyerName + " (" + o.buyerCountry + ")", expected: o.wire.amount, currency: o.wire.currency, createdAt: o.wire.createdAt, expiresAt: o.wire.expiresAt, buyerSaysSent: o.wireSentAt || null, buyerNote: o.wireSentNote || "" })), auto: { enabled: bankAutoOn(), url: bankUrl(), cap: bankCap() } }); }
// ---- bank text → confirmations: a pasted statement, or a forwarded bank alert ----
const bankToken = () => hmac("bank|" + (process.env.PUBLIC_BASE_URL || "")).slice(0, 24), bankAutoOn = () => process.env.BANK_AUTO_CONFIRM === "1", bankCap = () => envNum("BANK_AUTO_MAX", 50000);
const bankUrl = () => `${(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "")}/api/webhooks/bank/${bankToken()}`;
async function applyBankText(text, { single, requireCredit, cap, source }) { // finds the waiting orders this text pays, and confirms them through the same checked path as every other arrival
  const orders = store.readAll("orders").filter((o) => o.paymentProvider === "bank_wire" && o.paymentStatus === "pending" && o.wire).map((o) => ({ ...o, codes: bankmatch.refsOf(o.wireSentNote || "").codes }));
  const res = bankmatch.match(bankmatch.parse(text, { single }), orders, payments.wireMatches, { requireCredit, cap }), out = { confirmed: 0, review: 0, ignored: 0, results: [] };
  for (const r of res) {
    if (r.status === "confirm") { const o = orders.find((x) => x.id === r.orderId), c = await confirmWire(o, { amount: r.amount, currency: o.wire.currency, bankRef: "bank-text", source }); if (c.ok) { out.confirmed++; r.status = "confirmed"; } else { r.status = "needs_review"; r.reason = c.error; out.review++; } }
    else if (r.status === "needs_review" || r.status === "ambiguous") { out.review++; await evt("bank_wire", "auto_match_review", r.orderId, "needs_review", `${source}: ${r.reason}`); } else out.ignored++;
    out.results.push({ status: r.status, orderId: r.orderId, reason: r.reason, line: r.raw });
  }
  return out;
}
async function bankImport(req, res) { // admin pastes lines from the bank statement; matching orders are held, everything else is listed for a person
  if (!requireAdmin(req, res)) return; const b = await readBody(req, 1e6), text = String(b.text || ""); if (text.trim().length < 5) return sendJSON(res, 400, { error: "Paste some statement lines first." });
  sendJSON(res, 200, await applyBankText(text, { single: false, requireCredit: false, cap: Infinity, source: "statement" }));
}
async function bankAlert(req, res, m) { // a forwarded bank alert (SMS / email) from a phone app or Make/Zapier — OFF unless BANK_AUTO_CONFIRM=1, and capped
  if (!bankAutoOn()) return sendJSON(res, 503, { error: "Automatic confirmation from bank alerts is switched off." }); if (m[1] !== bankToken()) return sendJSON(res, 403, { error: "Forbidden" });
  const k = "ba:" + clientIp(req), w = waitMinutes(k, 300, 3600e3); if (w) return sendJSON(res, 429, { error: "Too many alerts." }); noteAttempt(k);
  const raw = (await readRaw(req)).toString("utf8").slice(0, 100000); let text = raw; try { const j = JSON.parse(raw); text = String(j.text || j.message || j.body || j.content || raw); } catch (e) { /* plain text */ }
  const out = await applyBankText(text, { single: true, requireCredit: true, cap: bankCap(), source: "alert" }); sendJSON(res, 200, { received: true, confirmed: out.confirmed, review: out.review });
}
async function adminConfirmTransfer(req, res, m) { // the one place a human confirms money: a bank transfer that arrived (until a bank/Wise feed is connected)
  if (!requireAdmin(req, res)) return; const b = await readBody(req); const o = store.readAll("orders").find((x) => x.id === m[1]); const r = await confirmWire(o, { amount: b.amount, currency: b.currency, bankRef: b.bankReference, source: "admin" }); if (!r.ok) return sendJSON(res, r.status, { error: r.error }); sendJSON(res, 200, { order: adminOrder(r.order) });
}
// ---- Operations → Payment setup ----
async function adminSettingsGet(req, res) { if (!requireAdmin(req, res)) return; sendJSON(res, 200, settings.view()); }
async function adminSettingsPut(req, res) { if (!requireAdmin(req, res)) return; const b = await readBody(req); const r = await settings.save(b.values || {}, Array.isArray(b.clear) ? b.clear : []); if (!r.ok) return sendJSON(res, 400, { error: r.errors[0], errors: r.errors }); await evt("admin", "payment_settings_changed", null, "processed", [...Object.keys(b.values || {}).filter((k) => String((b.values || {})[k]).trim()), ...(b.clear || []).map((k) => "clear " + k)].join(", ").slice(0, 280)); sendJSON(res, 200, settings.view()); }
// PayPal: the buyer approves on PayPal's page and lands on /api/paypal/return; we never trust that redirect (or a webhook body) — we ask PayPal for the order.
async function ppSettle(o, r) {
  if (!r || FINAL.includes(o.paymentStatus)) return; const d = payments.due(o);
  if (r.paid && r.currency === d.currency && r.amount + 0.005 >= d.amount) await settlePayment(o, { provider: "paypal", id: r.id });
  else if (r.paid) await evt("paypal", "capture", o.id, "needs_review", `amount/currency mismatch: ${r.amount} ${r.currency}`);
  else if (r.status === "VOIDED") { await patchOrder(o.id, { paymentStatus: "failed", paymentError: "The PayPal payment was cancelled" }); await evt("paypal", "order", o.id, "processed", "voided"); }
}
async function paypalReturn(req, res, m, url) {
  const oid = clean(url.searchParams.get("order"), 60), tok = clean(url.searchParams.get("token"), 80), o = findOrder((x) => x.id === oid), go = (q) => { res.writeHead(302, { Location: `/?order=${encodeURIComponent(oid)}&${q}` }); res.end(); };
  if (!o || o.paymentProvider !== "paypal" || o.providerRef !== tok) return go("failed=1");
  try { await ppSettle(o, await payments.paypalSync(tok)); } catch (e) { console.error("paypal return", e.message); }
  const cur = findOrder((x) => x.id === oid); go(cur && FINAL.includes(cur.paymentStatus) ? "paid=1" : "pending=1");
}
async function paypalWebhook(req, res) {
  const b = await readBody(req); if (!(await payments.verifyPaypalWebhook(req.headers, b).catch(() => false))) { await evt("paypal", "bad_signature", null, "failed", "signature check failed"); return sendJSON(res, 401, { error: "Bad signature" }); }
  sendJSON(res, 200, { received: true }); const r0 = b.resource || {}, pu = (r0.purchase_units || [])[0] || {}, ourId = r0.custom_id || pu.custom_id || pu.reference_id, ppId = b.event_type === "CHECKOUT.ORDER.APPROVED" ? r0.id : r0.supplementary_data && r0.supplementary_data.related_ids && r0.supplementary_data.related_ids.order_id;
  const o = findOrder((x) => (ourId && x.id === ourId) || (ppId && x.providerRef === ppId)); if (!o || o.paymentProvider !== "paypal") return evt("paypal", String(b.event_type || "event"), null, "ignored", "no matching order");
  if (["CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.COMPLETED"].includes(b.event_type)) await ppSettle(o, await payments.paypalSync(o.providerRef).catch(() => null));
  else if (["PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.DECLINED"].includes(b.event_type) && !FINAL.includes(o.paymentStatus)) { await patchOrder(o.id, { paymentStatus: "failed", paymentError: "The PayPal payment was declined" }); await evt("paypal", b.event_type, o.id, "processed", "declined"); }
}
// ---- Equity Bank (Jenga) callbacks. Equity doesn't sign them, so the address carries a secret, the reference must be one we issued, the amount and number must match,
// and we ask Equity for a second opinion before holding the order. ----
// ---- Paystack: signed notifications for payments AND transfers. A notification is never trusted on its own: we always ask Paystack for its own record first. ----
async function paystackPayoutResult(ref, ok, failed, message) { // one place for every payout answer: a seller's payout, a rider's fee, a refund
  const dl = store.readAll("deliveries").find((x) => x.riderPayoutRef === ref); if (dl) { await riderTransferResult(dl, { ok, failed, message }); return; }
  const ro = findOrder((x) => x.refundRef === ref && x.paymentStatus === "refunding");
  if (ro) { if (ok) { await patchOrder(ro.id, { paymentStatus: "refunded", refundedAt: now(), refundRetry: false, refundError: null }); await evt("paystack", "refund_completed", ro.id, "processed", "refund reached the buyer's M-Pesa"); } else if (failed) { await patchOrder(ro.id, { refundRetry: false, refundError: message || "Paystack could not complete the refund" }); await evt("paystack", "refund_failed", ro.id, "needs_review", (message || "failed") + " — send this refund by hand"); } return; }
  const o = findOrder((x) => x.payoutRef === ref); if (!o) return evt("paystack", "transfer", null, "ignored", "no payout for reference " + ref);
  if (ok) { if (o.paymentStatus !== "paid_out") { await patchOrder(o.id, { paymentStatus: "paid_out", paidOutAt: now(), payoutNote: null }); await evt("paystack", "payout_completed", o.id, "processed", "sent to M-Pesa"); } }
  else if (failed && o.paymentStatus === "payout_initiated") { await patchOrder(o.id, { paymentStatus: "payout_failed", payoutError: message || "Paystack could not complete the payout", payoutAttempts: (o.payoutAttempts || 0) + 1, lastPayoutAt: now() }); await evt("paystack", "payout_failed", o.id, "failed", message || "failed"); }
  else if (failed && o.paymentStatus === "paid_out") await evt("paystack", "payout_reversed", o.id, "needs_review", "Paystack says this payout was reversed after it succeeded — the money came back to your balance; check the order and pay the seller again by hand");
}
async function paystackFollow(ref) { const st = await paystack.transferStatus(ref).catch(() => null); if (!st) return; if (st.status === "success") await paystackPayoutResult(ref, true, false); else if (st.status === "failed" || st.status === "reversed") await paystackPayoutResult(ref, false, true, st.reason); }
async function paystackWebhook(req, res) {
  const raw = (await readRaw(req)).toString("utf8");
  if (!paystack.verifySignature(raw, req.headers["x-paystack-signature"])) { await evt("paystack", "bad_signature", null, "failed", "signature check failed"); return sendJSON(res, 401, { error: "Bad signature" }); }
  let b; try { b = JSON.parse(raw); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
  sendJSON(res, 200, { received: true }); const ev = paystack.parseEvent(b); if (!ev) return;
  if (ev.kind === "refund") { // a CARD refund answered by Paystack
    const ro = findOrder((x) => x.refundRef === ev.ref && x.paymentProvider === "paystack" && x.paymentStatus === "refunding"); if (!ro) return evt("paystack", ev.event, null, "ignored", "no card refund waiting for " + ev.ref);
    if (/processed$/.test(ev.event)) { await patchOrder(ro.id, { paymentStatus: "refunded", refundedAt: now(), refundRetry: false, refundError: null }); await evt("paystack", "refund_completed", ro.id, "processed", "card refund processed"); }
    else { await patchOrder(ro.id, { refundRetry: false, refundError: ev.reason || "Paystack could not complete the card refund" }); await evt("paystack", "refund_failed", ro.id, "needs_review", "card refund failed — refund it from your Paystack dashboard (Transactions → the payment → Refund) and mark the order refunded"); }
    return;
  }
  if (ev.kind === "transfer") { const st = await paystack.transferStatus(ev.ref).catch(() => null); if (!st) return evt("paystack", ev.event, null, "needs_review", "could not check transfer " + ev.ref + " with Paystack — the sweep will retry"); await paystackPayoutResult(ev.ref, st.status === "success", st.status === "failed" || st.status === "reversed", st.reason || ev.reason); return; }
  const o = findOrder((x) => x.providerRef === ev.ref && x.paymentProvider === "paystack"); if (!o) return evt("paystack", ev.event, null, "ignored", "no order for reference " + ev.ref);
  if (FINAL.includes(o.paymentStatus)) return;
  const v = await paystack.verifyCharge(ev.ref).catch(() => null), dd = payments.due(o); // never trust the notification body alone
  if (v && v.paid && v.currency === dd.currency && Number(v.amount) + 0.5 >= dd.amount) await settlePayment(o, { provider: "paystack", id: v.id || ev.id, note: "checked with Paystack" });
  else if (v && v.paid) await evt("paystack", ev.event, o.id, "needs_review", `amount/currency mismatch: ${v.amount} ${v.currency}`);
  else if (v && v.failed) { await patchOrder(o.id, { paymentStatus: "failed", paymentError: "The payment didn't go through." }); await evt("paystack", ev.event, o.id, "processed", "failed"); }
  else if (!v) await evt("paystack", ev.event, o.id, "needs_review", "Paystack's own record could not be checked — the sweep will look again");
}
async function paystackSweep() { // transfer answers that never arrived: ask Paystack by reference
  if (!paystack.isConfigured()) return;
  try { for (const o of store.readAll("orders")) { const age = Date.now() - new Date(o.lastPayoutAt || o.pendingSince || 0).getTime();
      if (o.payoutRoute === "paystack_mobile" && o.paymentStatus === "payout_initiated" && o.payoutRef && age > 3 * 60000) await paystackFollow(o.payoutRef); else if (o.paymentStatus === "refunding" && /^sokrf-/.test(String(o.refundRef || ""))) await paystackFollow(o.refundRef); }
    for (const d of store.readAll("deliveries")) if (d.riderPayoutRoute === "paystack_mobile" && d.riderPayoutStatus === "initiated" && d.riderPayoutRef) await paystackFollow(d.riderPayoutRef);
  } catch (e) { console.error("paystackSweep", e.message); }
}
// ---- Fincra: signed notifications for collections AND payouts. A notification is never trusted on its own: we always ask Fincra for its own record first. ----
async function fincraPayoutResult(ref, ok, failed, message) { // one place for every payout answer: a seller's payout, a rider's fee, a refund
  const dl = store.readAll("deliveries").find((x) => x.riderPayoutRef === ref); if (dl) { await riderTransferResult(dl, { ok, failed, message }); return; }
  const ro = findOrder((x) => x.refundRef === ref && x.paymentStatus === "refunding");
  if (ro) { if (ok) { await patchOrder(ro.id, { paymentStatus: "refunded", refundedAt: now(), refundRetry: false, refundError: null }); await evt("fincra", "refund_completed", ro.id, "processed", "refund reached the buyer's M-Pesa"); } else if (failed) { await patchOrder(ro.id, { refundRetry: false, refundError: message || "Fincra could not complete the refund" }); await evt("fincra", "refund_failed", ro.id, "needs_review", (message || "failed") + " — send this refund by hand"); } return; }
  const o = findOrder((x) => x.payoutRef === ref); if (!o) return evt("fincra", "payout", null, "ignored", "no payout for reference " + ref);
  if (ok) { if (o.paymentStatus !== "paid_out") { await patchOrder(o.id, { paymentStatus: "paid_out", paidOutAt: now(), payoutNote: null }); await evt("fincra", "payout_completed", o.id, "processed", "sent to M-Pesa"); } }
  else if (failed && o.paymentStatus === "payout_initiated") { await patchOrder(o.id, { paymentStatus: "payout_failed", payoutError: message || "Fincra could not complete the payout", payoutAttempts: (o.payoutAttempts || 0) + 1, lastPayoutAt: now() }); await evt("fincra", "payout_failed", o.id, "failed", message || "failed"); }
}
async function fincraFollow(ref) { const st = await fincra.payoutStatus(ref).catch(() => null); if (!st) return; if (st.status === "successful") await fincraPayoutResult(ref, true, false); else if (st.status === "failed") await fincraPayoutResult(ref, false, true, st.reason); }
async function fincraWebhook(req, res) {
  const raw = (await readRaw(req)).toString("utf8");
  if (!fincra.verifySignature(raw, req.headers["signature"])) { await evt("fincra", "bad_signature", null, "failed", "signature check failed"); return sendJSON(res, 401, { error: "Bad signature" }); }
  let b; try { b = JSON.parse(raw); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
  sendJSON(res, 200, { received: true }); const ev = fincra.parseEvent(b); if (!ev) return;
  if (ev.kind === "payout") { const st = await fincra.payoutStatus(ev.ref).catch(() => null); if (!st) return evt("fincra", ev.event, null, "needs_review", "could not check payout " + ev.ref + " with Fincra — the sweep will retry"); await fincraPayoutResult(ev.ref, st.status === "successful", st.status === "failed", st.reason || ev.reason); return; }
  const o = findOrder((x) => x.providerRef === ev.ref && x.paymentProvider === "fincra"); if (!o) return evt("fincra", ev.event, null, "ignored", "no order for reference " + ev.ref);
  if (FINAL.includes(o.paymentStatus)) return;
  const v = await fincra.verifyCharge(ev.ref).catch(() => null), dd = payments.due(o); // never trust the notification body alone
  if (v && v.paid && v.currency === dd.currency && Number(v.amount) + 0.5 >= dd.amount) await settlePayment(o, { provider: "fincra", id: v.id || ev.id, note: "checked with Fincra" });
  else if (v && v.paid) await evt("fincra", ev.event, o.id, "needs_review", `amount/currency mismatch: ${v.amount} ${v.currency}`);
  else if (v && v.failed) { await patchOrder(o.id, { paymentStatus: "failed", paymentError: "The payment didn't go through." }); await evt("fincra", ev.event, o.id, "processed", "failed"); }
  else if (!v) await evt("fincra", ev.event, o.id, "needs_review", "Fincra's own record could not be checked — the sweep will look again");
}
async function fincraSweep() { // payout answers that never arrived: ask Fincra by reference
  if (!fincra.isConfigured()) return;
  try { for (const o of store.readAll("orders")) { const age = Date.now() - new Date(o.lastPayoutAt || o.pendingSince || 0).getTime();
      if (o.payoutRoute === "fincra_mobile" && o.paymentStatus === "payout_initiated" && o.payoutRef && age > 3 * 60000) await fincraFollow(o.payoutRef); else if (o.paymentStatus === "refunding" && /^SOKRF-/.test(String(o.refundRef || ""))) await fincraFollow(o.refundRef); }
    for (const d of store.readAll("deliveries")) if (d.riderPayoutRoute === "fincra_mobile" && d.riderPayoutStatus === "initiated" && d.riderPayoutRef) await fincraFollow(d.riderPayoutRef);
  } catch (e) { console.error("fincraSweep", e.message); }
}
async function jengaStkCallback(req, res, m) {
  if (m[1] !== jenga.urls().token) return sendJSON(res, 403, { error: "Forbidden" }); const b = await readBody(req); sendJSON(res, 200, { status: true, message: "Received" });
  const r = jenga.parseStk(b); if (!r) return; const o = findOrder((x) => x.jengaRef === r.ref); if (!o) return evt("jenga", "stk", null, "ignored", "no order for reference " + r.ref);
  if (FINAL.includes(o.paymentStatus)) return;
  if (r.code === 3) { // paid AND credited to your Equity account
    const due = payments.due(o).amount; if (!(Number(r.amount) + 0.5 >= due)) return evt("jenga", "stk", o.id, "needs_review", `amount mismatch: paid ${r.amount}, due ${due}`);
    if (o.jengaPhone && r.phone && String(r.phone).replace(/\D/g, "").slice(-9) !== String(o.jengaPhone).slice(-9)) return evt("jenga", "stk", o.id, "needs_review", "paid from a different number than the prompt was sent to");
    const v = await jenga.transactionDetails(r.ref).catch(() => null); if (v && v.ok && v.state === 1) return evt("jenga", "stk", o.id, "needs_review", "the callback said paid but Equity's own record says the payment failed");
    await settlePayment(o, { provider: "jenga", id: r.telcoRef || r.ref, note: v && v.ok && v.state === 2 ? "checked with Equity" : "callback (Equity's record could not be checked)" });
  } else if (r.code === 2 || r.code === 4) await evt("jenga", "stk", o.id, "needs_review", `${r.message || "paid, awaiting settlement"} — the customer paid but the money has not reached your Equity account yet; the order is NOT held. Check your account, then confirm.`);
  else if ([1, 5, 6, 7].includes(r.code)) { await patchOrder(o.id, { paymentStatus: "failed", paymentError: r.message || "The M-Pesa payment didn't go through." }); await evt("jenga", "stk", o.id, "processed", r.message); }
}
async function jengaPayoutCallback(req, res, m) {
  if (m[1] !== jenga.urls().token) return sendJSON(res, 403, { error: "Forbidden" }); const b = await readBody(req); sendJSON(res, 200, { status: true, message: "Received" }); const r = jenga.parsePayout(b); if (!r) return;
  const dl = store.readAll("deliveries").find((x) => x.riderPayoutRef === r.ref); if (dl) { await riderTransferResult(dl, { ok: r.ok, failed: !r.ok, message: r.message }); return; }
  const ro = findOrder((x) => x.refundRef === r.ref && x.paymentStatus === "refunding"); // the answer to a refund we sent
  if (ro) { if (r.ok) { await patchOrder(ro.id, { paymentStatus: "refunded", refundedAt: now(), refundRetry: false, refundError: null }); await evt("jenga", "refund_completed", ro.id, "processed", "refund reached the buyer's M-Pesa"); } else { await patchOrder(ro.id, { refundRetry: false, refundError: r.message || "Equity could not complete the refund" }); await evt("jenga", "refund_failed", ro.id, "needs_review", (r.message || "failed") + " — send this refund by hand"); } return; }
  const o = findOrder((x) => x.payoutRef === r.ref); if (!o) return evt("jenga", "payout", null, "ignored", "no payout for reference " + r.ref);
  if (r.ok) { await patchOrder(o.id, { paymentStatus: "paid_out", paidOutAt: now() }); await evt("jenga", "payout_completed", o.id, "processed", "sent to M-Pesa"); }
  else { await patchOrder(o.id, { paymentStatus: "payout_failed", payoutError: r.message, payoutAttempts: (o.payoutAttempts || 0) + 1, lastPayoutAt: now() }); await evt("jenga", "payout_failed", o.id, "failed", r.message); }
}
// ---- Equity go-live: what is done, what is missing, and a one-click check of the real connection ----
async function coinBond(req, res) {
  const u = requireAuth(req, res); if (!u) return; const b = await readBody(req), amt = round2(b.amount); if (!(amt > 0)) return sendJSON(res, 400, { error: "Enter how many coins to lock." });
  const bal = coinBalance(u.id); if (amt > bal) return sendJSON(res, 400, { error: `You have ${bal} spendable coins — you can't lock more than that.` });
  const mid = id(); await store.mutate("coin_ledger", (all) => [...all, { id: mid, key: "bond:" + mid, userId: u.id, delta: -amt, bondDelta: amt, reason: "bond_lock", at: now() }]); sendJSON(res, 200, { coin: coinInfo(u.id) });
}
async function coinUnbond(req, res) {
  const u = requireAuth(req, res); if (!u) return; const b = await readBody(req), amt = round2(b.amount), free = round2(bondOf(u.id) - unbondingOf(u.id)); if (!(amt > 0)) return sendJSON(res, 400, { error: "Enter how many coins to unlock." });
  if (amt > free) return sendJSON(res, 400, { error: `You can unlock at most ${free} coins (the rest is already unlocking).` });
  await store.mutate("coin_unbonds", (all) => [...all, { id: id(), userId: u.id, amount: amt, requestedAt: now(), releaseAt: new Date(Date.now() + BOND_COOLDOWN_DAYS() * 86400e3).toISOString(), status: "waiting" }]); sendJSON(res, 200, { coin: coinInfo(u.id) });
}
async function slashBond(o) { // a seller lost a dispute: part of the bond is slashed — half burned, half to the buyer. Once per order.
  const bond = bondOf(o.farmerId); if (!(bond > 0)) return null; const slash = Math.min(bond, Math.max(1, Math.ceil(bond * BOND_SLASH_SHARE()))), award = Math.floor(slash / 2);
  const rows = [{ id: id(), key: "slash:" + o.id, userId: o.farmerId, delta: 0, bondDelta: -slash, reason: "bond_slash", orderId: o.id, at: now() }, ...(award > 0 ? [{ id: id(), key: "award:" + o.id, userId: o.buyerId, delta: award, reason: "bond_award", orderId: o.id, at: now() }] : [])];
  let did = false; await store.mutate("coin_ledger", (all) => { if (all.some((x) => x.key === "slash:" + o.id)) return all; did = true; return [...all, ...rows]; }); if (!did) return null;
  await evt("coin", "bond_slashed", o.id, "processed", `${slash} coins slashed from the seller's bond, ${award} to the buyer`); return { slash, award };
}
async function bondSweep() { // unlock requests that have cooled off — unless the seller has a dispute open
  try { for (const x of store.readAll("coin_unbonds").filter((y) => y.status === "waiting" && new Date(y.releaseAt).getTime() <= Date.now())) {
    if (store.readAll("orders").some((o) => o.farmerId === x.userId && o.disputed && o.paymentStatus === "escrowed")) continue; const amt = Math.min(x.amount, bondOf(x.userId));
    if (amt > 0) await store.mutate("coin_ledger", (all) => (all.some((e) => e.key === "unbond:" + x.id) ? all : [...all, { id: id(), key: "unbond:" + x.id, userId: x.userId, delta: amt, bondDelta: -amt, reason: "bond_unlock", at: now() }]));
    await store.mutate("coin_unbonds", (all) => all.map((y) => (y.id === x.id ? { ...y, status: "released", releasedAt: now(), released: amt } : y))); } } catch (e) { console.error("bondSweep", e.message); }
}
async function boostListing(req, res, m) { // coins buy visibility: pinned to the top of the market for 1–7 days
  const u = requireAuth(req, res); if (!u) return; const l = store.readAll("listings").find((x) => x.id === m[1]); if (!l || l.farmerId !== u.id) return sendJSON(res, 404, { error: "Listing not found." }); if (l.status !== "available") return sendJSON(res, 400, { error: "Only a live listing can be boosted." });
  const b = await readBody(req), days = Math.floor(Number(b.days)); if (!(days >= 1 && days <= 7)) return sendJSON(res, 400, { error: "Boost for 1 to 7 days." }); const cost = days * BOOST_PER_DAY(), bal = coinBalance(u.id); if (cost > bal) return sendJSON(res, 400, { error: `${days} day${days > 1 ? "s" : ""} costs ${cost} coins and you have ${bal}.` });
  const base = boostedNow(l) ? new Date(l.boostedUntil).getTime() : Date.now(), until = new Date(base + days * 86400e3).toISOString(), bid = id();
  await store.mutate("coin_ledger", (all) => [...all, { id: bid, key: "boost:" + bid, userId: u.id, delta: -cost, reason: "boost", listingId: l.id, at: now() }]); await store.mutate("listings", (all) => all.map((x) => (x.id === l.id ? { ...x, boostedUntil: until } : x)));
  sendJSON(res, 200, { boostedUntil: until, cost, coin: coinInfo(u.id) });
}
async function pushKey(req, res) { const k = await webpush.vapid(); sendJSON(res, 200, { publicKey: k.publicKey }); }
async function pushSubscribe(req, res) { const u = requireAuth(req, res); if (!u) return; const b = await readBody(req), r = await webpush.subscribe(u.id, b.subscription); if (r.error) return sendJSON(res, 400, { error: r.error }); sendJSON(res, 200, { ok: true, devices: webpush.count(u.id) }); }
async function pushUnsubscribe(req, res) { const u = requireAuth(req, res); if (!u) return; const b = await readBody(req); await webpush.unsubscribe(u.id, String(b.endpoint || "").slice(0, 500)); sendJSON(res, 200, { ok: true, devices: webpush.count(u.id) }); }
async function pushTest(req, res) { const u = requireAuth(req, res); if (!u) return; const w = waitMinutes("pushtest:" + u.id, 5, 3600e3); if (w) return sendJSON(res, 429, { error: `Too many tests. Try again in ${w} minute(s).` }); noteAttempt("pushtest:" + u.id); const sent = await webpush.notify(u.id, { title: "Sokoni", body: "Notifications are working ✓", url: "/", tag: "test" }); sendJSON(res, 200, { sent, devices: webpush.count(u.id) }); }
// ============ ratings and feedback: buyers rate the farmer after receiving an order ============
// An order can be rated once it is complete (the buyer confirmed receipt, or it was released automatically) or a dispute was settled. One rating per order, editable for a few days.
// Buyers who haven't rated are reminded every 2 days (a few times, then it stops); "Skip" stops reminders for that order.
const RATING_EDIT_MS = () => envNum("RATING_EDIT_DAYS", 7) * 86400e3; let ratingCache = null;
function ratingIndex() { if (ratingCache && Date.now() - ratingCache.at < 5000) return ratingCache; const byOrder = new Map(), by = new Map(); for (const r of store.readAll("ratings")) { if (r.hidden) continue; byOrder.set(r.orderId, r); if (!by.has(r.sellerId)) by.set(r.sellerId, []); by.get(r.sellerId).push(r); }
  const bySeller = new Map(); for (const [sid, rs] of by) { const n = rs.length, pct = (k, v, pool) => { const p = rs.filter((r) => pool(r[k])); return p.length ? Math.round((p.filter((r) => r[k] === v).length / p.length) * 100) : null; }; bySeller.set(sid, { avg: Math.round((rs.reduce((a, r) => a + r.stars, 0) / n) * 10) / 10, count: n, dist: [1, 2, 3, 4, 5].map((s) => rs.filter((r) => r.stars === s).length), matchedYesPct: pct("matched", "yes", (x) => !!x), onTimePct: pct("onTime", "yes", (x) => x && x !== "na") }); }
  return (ratingCache = { at: Date.now(), byOrder, bySeller }); }
const sellerRating = (sid) => { const s = ratingIndex().bySeller.get(sid); return s ? { avg: s.avg, count: s.count } : { avg: null, count: 0 }; };
const ratingLift = (sid) => { const s = ratingIndex().bySeller.get(sid); return s && s.count >= 3 ? (s.avg - 3.5) * 86400e3 : 0; }; // well-rated sellers rank a little higher (at most about a day and a half), badly rated ones a little lower
const ratingEligible = (o) => !!(o.buyerConfirmedAt || o.disputeResolution);
function ratingFields(o, uid) { const r = ratingIndex().byOrder.get(o.id) || null, mine = !!uid && o.buyerId === uid, editable = !!(r && Date.now() - new Date(r.createdAt).getTime() < RATING_EDIT_MS());
  return { rating: r ? { stars: r.stars, matched: r.matched, onTime: r.onTime, comment: r.comment, at: r.editedAt || r.createdAt, editable: mine && editable } : null, canRate: mine && ratingEligible(o) && (!r || editable), ratingPending: mine && ratingEligible(o) && !r && !o.ratingSkippedAt }; }
async function rateOrder(req, res, m) {
  const u = requireAuth(req, res); if (!u) return; const o = store.readAll("orders").find((x) => x.id === m[1]); if (!o || o.buyerId !== u.id) return sendJSON(res, 404, { error: "Order not found." });
  if (!ratingEligible(o)) return sendJSON(res, 400, { error: "You can rate an order once you have received it." }); const b = await readBody(req), stars = Math.round(Number(b.stars));
  if (!(stars >= 1 && stars <= 5)) return sendJSON(res, 400, { error: "Choose from 1 to 5 stars." }); const prev = store.readAll("ratings").find((r) => r.orderId === o.id);
  if (prev && Date.now() - new Date(prev.createdAt).getTime() >= RATING_EDIT_MS()) return sendJSON(res, 400, { error: "This rating can no longer be changed." });
  const matched = ["yes", "mostly", "no"].includes(b.matched) ? b.matched : null, onTime = ["yes", "late", "na"].includes(b.onTime) ? b.onTime : null, comment = maskContacts(clean(b.comment, 500));
  const rec = prev ? { ...prev, stars, matched, onTime, comment, editedAt: now() } : { id: id(), orderId: o.id, listingId: o.listingId, sellerId: o.farmerId, buyerId: o.buyerId, crop: o.crop, country: o.buyerCountry, stars, matched, onTime, comment, hidden: false, createdAt: now() };
  await store.mutate("ratings", (all) => (prev ? all.map((r) => (r.id === prev.id ? rec : r)) : [...all, rec])); ratingCache = null;
  if (!prev) { pushTo(o.farmerId, { title: "New rating", body: `A buyer rated your ${o.crop} order ${"★".repeat(stars)}${"☆".repeat(5 - stars)}${comment ? " — " + comment.slice(0, 60) : ""}`, url: "/?order=" + o.id, tag: "rating-" + o.id });
    if (matched) dataset.addOutcome(o.listingId, { type: matched === "yes" ? "buyer_confirmed_match" : matched === "mostly" ? "buyer_mostly_matched" : "buyer_said_not_matching", order: o.id }).catch(() => {}); } // the buyer's own verdict on "did it match the photos and the quality report" is real-world ground truth for the quality labels
  sendJSON(res, prev ? 200 : 201, { order: viewOrder(userOrder(o.id), u.id) });
}
async function skipRating(req, res, m) { const u = requireAuth(req, res); if (!u) return; const o = store.readAll("orders").find((x) => x.id === m[1]); if (!o || o.buyerId !== u.id) return sendJSON(res, 404, { error: "Order not found." }); await store.mutate("orders", (all) => all.map((x) => (x.id === o.id ? { ...x, ratingSkippedAt: now() } : x))); sendJSON(res, 200, { order: viewOrder(userOrder(o.id), u.id) }); }
async function sellerFeedback(req, res, m) { const sid = m[1], s = ratingIndex().bySeller.get(sid); const list = store.readAll("ratings").filter((r) => r.sellerId === sid && !r.hidden).sort(byNewest).slice(0, 30).map((r) => ({ stars: r.stars, comment: r.comment || "", crop: r.crop, matched: r.matched, onTime: r.onTime, from: r.country || "", at: r.editedAt || r.createdAt }));
  sendJSON(res, 200, { avg: s ? s.avg : null, count: s ? s.count : 0, dist: s ? s.dist : [0, 0, 0, 0, 0], matchedYesPct: s ? s.matchedYesPct : null, onTimePct: s ? s.onTimePct : null, feedback: list }); }
async function ratingSweep() { // reminders: every 2 days, only for recent orders, a few times at most, one message per buyer
  const every = envNum("RATING_REMIND_EVERY_DAYS", 2) * 86400e3, max = envNum("RATING_REMIND_MAX", 5), window = envNum("RATING_REMIND_WINDOW_DAYS", 14) * 86400e3, nowMs = Date.now(), idx = ratingIndex(), due = new Map();
  for (const o of store.readAll("orders")) { if (!o.buyerConfirmedAt || o.disputeResolution || o.ratingSkippedAt || o.paymentProvider === "test" || idx.byOrder.has(o.id) || (o.ratingReminders || 0) >= max) continue;
    if (nowMs - new Date(o.buyerConfirmedAt).getTime() > window || nowMs - new Date(o.ratingRemindedAt || o.buyerConfirmedAt).getTime() < every) continue; if (!due.has(o.buyerId)) due.set(o.buyerId, []); due.get(o.buyerId).push(o); }
  for (const [buyerId, list] of due) { const buyer = userById(buyerId); if (!buyer) continue; const one = list.length === 1 ? list[0] : null;
    const title = one ? "How was your order?" : `${list.length} orders are waiting for your rating`, body = one ? `Rate ${one.farmerName} for the ${one.crop} you received — it takes 10 seconds.` : `Tell other buyers how ${list.length} of your recent orders went.`, url = one ? `/?order=${one.id}&rate=1` : "/?tab=orders";
    pushTo(buyerId, { title, body, url, tag: "rate-reminder" }); if (buyer.email && notify.emailProvider()) Promise.resolve(notify.sendEmail(buyer.email, title + " — Sokoni", `${body}\n\nOpen Sokoni: ${baseUrl()}${url}\n\nYour feedback helps good farmers get found and keeps the market honest.`)).catch(() => {});
    const ids = new Set(list.map((x) => x.id)); await store.mutate("orders", (all) => all.map((x) => (ids.has(x.id) ? { ...x, ratingRemindedAt: now(), ratingReminders: (x.ratingReminders || 0) + 1 } : x))); } // (written directly, so it doesn't mark the order as "updated")
}
async function adminRatings(req, res) { if (!requireAdmin(req, res)) return; const nm = (uid) => { const u = userById(uid); return u ? displayName(u) : "?"; }; sendJSON(res, 200, { ratings: store.readAll("ratings").sort(byNewest).slice(0, 300).map((r) => ({ id: r.id, order: r.orderId.slice(0, 6), crop: r.crop, seller: nm(r.sellerId), buyer: nm(r.buyerId), stars: r.stars, matched: r.matched, onTime: r.onTime, comment: r.comment, hidden: !!r.hidden, hiddenReason: r.hiddenReason || null, at: r.editedAt || r.createdAt })) }); }
async function adminHideRating(req, res, m) { if (!requireAdmin(req, res)) return; const b = await readBody(req), r = store.readAll("ratings").find((x) => x.id === m[1]); if (!r) return sendJSON(res, 404, { error: "Rating not found." }); const hidden = b.hidden !== false;
  await store.mutate("ratings", (all) => all.map((x) => (x.id === r.id ? { ...x, hidden, hiddenReason: hidden ? clean(b.reason, 200) : null } : x))); ratingCache = null; await evt("admin", hidden ? "rating_hidden" : "rating_restored", r.orderId, "processed", clean(b.reason, 100)); sendJSON(res, 200, { ok: true, hidden }); }
// ============ company analytics: a permanent record, rebuilt every few minutes, exportable ============
async function analyticsSweep() { try { await analytics.syncIfStale(envNum("ANALYTICS_SYNC_MINUTES", 10) * 60000); } catch (e) { console.error("analytics sync", e.message); } }
async function adminAnalytics(req, res, m, url) { if (!requireAdmin(req, res)) return; try { await analytics.syncIfStale(60000); } catch (e) { console.error("analytics sync", e.message); }
  const q = url.searchParams, raw = q.get("days"), days = raw == null ? 30 : Math.min(3650, Math.max(0, Number(raw) || 0)), country = clean(q.get("country"), 2).toUpperCase(), category = clean(q.get("category"), 40), facts = store.readAll("analytics_facts");
  sendJSON(res, 200, { ...analytics.report({ days, country, category }), options: { countries: [...new Set(facts.map((f) => f.originCountry).filter(Boolean))].sort(), categories: [...new Set(facts.map((f) => f.category).filter(Boolean))].sort() } }); }
async function adminAnalyticsExport(req, res, m, url) { if (!requireAdmin(req, res)) return; try { await analytics.syncIfStale(60000); } catch (e) { /* export what is stored */ }
  const kind = clean(url.searchParams.get("kind"), 12), ex = analytics.exportRows(kind); if (!ex) return sendJSON(res, 400, { error: "kind must be orders, listings, ratings or daily." });
  if (url.searchParams.get("format") === "json") return sendJSON(res, 200, { kind, rows: ex.rows.map((r) => Object.fromEntries(ex.cols.map((c) => [c, r[c]]))) });
  res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sokoni-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" }); res.end(analytics.toCsv(ex.rows, ex.cols)); }
async function adminDataset(req, res) { if (!requireAdmin(req, res)) return; sendJSON(res, 200, { ...dataset.stats(), exportCommand: "node tools/export-dataset.js C:\\sokoni-dataset-export", note: "Each record is a quality label kept with its photos. Outcomes (completed, dispute won/lost) are attached as ground truth. No names, phones or listing ids are exported." }); }
async function adminEconomics(req, res) { // what Sokoni really keeps, after provider fees, payout fees and coin credits
  if (!requireAdmin(req, res)) return; const days = Math.min(365, Math.max(1, Number(new URL(req.url, "http://x").searchParams.get("days")) || 30)), since = Date.now() - days * 86400e3;
  const done = store.readAll("orders").filter((o) => o.paymentStatus === "paid_out" && o.paymentProvider !== "test" && new Date(o.paidOutAt || o.updatedAt || 0).getTime() >= since), s = economics.summary(done);
  const warn = s.orders ? (s.netPct < s.targetPct ? `Net ${s.netPct}% is below your ${s.targetPct}% target. Raise the commission to about ${s.recommendedCommissionPct}% (it is ${s.commissionPct}% now), or lower your costs.` : null) : null;
  const led = store.readAll("coin_ledger"), treas = Math.round(led.filter((e) => e.userId === "sokoni:treasury").reduce((n, e) => n + (e.delta || 0), 0) * 100) / 100, minted = Math.round(led.filter((e) => ["completed_trade", "trade_levy"].includes(e.reason)).reduce((n, e) => n + (e.delta || 0), 0) * 100) / 100;
  const usersCoinUsd = Math.round((minted - treas) * envNum("COIN_USD_VALUE", 0.01) * 100) / 100;
  sendJSON(res, 200, { days, ...s, coin: { levyCollectedUsd: s.levyUsd, usersCoinValueUsd: usersCoinUsd, setAsideRecommendedUsd: usersCoinUsd, mintedFromTrades: minted, sokoniTreasury: treas, heldByUsers: Math.round((minted - treas) * 100) / 100, levyPercentEachSide: envNum("COIN_LEVY_PCT", 0.05), sokoniShare: envNum("COIN_SOKONI_SHARE", 0.5), usdPerCoin: envNum("COIN_USD_VALUE", 0.01) }, assumedCostPct: Math.round(economics.assumedCostPct() * 100) / 100, warning: warn, note: "Cost figures are assumptions until you replace them with your real fee schedules (COST_PCT_MPESA, COST_PCT_CRYPTO, COST_PCT_BANK, COST_PCT_CARD, COST_FIXED_PAYOUT_USD)." });
}
async function adminEquity(req, res) {
  if (!requireAdmin(req, res)) return; const e = process.env, c = payments.cfg, live = jenga.env() === "production", haveAcct = !!jenga.acct();
  const url = /^https:\/\//.test(e.PUBLIC_BASE_URL || ""), creds = !!(e.JENGA_MERCHANT_CODE && e.JENGA_CONSUMER_SECRET && e.JENGA_API_KEY), key = !!e.JENGA_PRIVATE_KEY;
  const checklist = [
    { id: "credentials", label: "Merchant code, consumer secret and API key", ok: creds, fix: "Enter them below (from the Jenga HQ console)." },
    { id: "key", label: "Signing key created, and its public half uploaded to the Jenga console", ok: key, fix: "Press “Generate signing keys”, then upload the public key it shows in the Jenga console (API Keys)." },
    { id: "account", label: "Your Equity business account number", ok: haveAcct, fix: creds && key && url ? "Enter it below — this is the ONLY thing still to plug in; everything else switches on by itself." : "Enter it below when your bank gives it to you — the other items above need doing too." },
    { id: "url", label: "A public https address for Equity to call back", ok: url, fix: "Set PUBLIC_BASE_URL to your https address (a tunnel works for testing)." },
    { id: "mode", label: live ? "Live mode" : "Sandbox mode (practice money — payouts stay off until you go live)", ok: live, info: true, fix: "Set JENGA_ENV=production with your live credentials when Equity approves you." },
  ];
  const sellerWait = store.readAll("orders").filter((o) => ["payout_pending", "payout_failed"].includes(o.paymentStatus) && o.currency === "KES"), owed = geo.roundMoney(sum(sellerWait, (o) => o.sellerPayout + (o.coinBonus || 0)), "KES");
  const out = { mode: live ? "live" : "sandbox", ready: jenga.isConfigured(), waitingFor: checklist.filter((x) => !x.ok && !x.info).map((x) => x.id), checklist,
    features: { mpesaPrompt: c.jenga(), bankTransferDetails: c.wire(), bankTransfersConfirmThemselves: payments.wireIsEquity(), payouts: jenga.payoutsOn(), refunds: jenga.payoutsOn() }, paused: jenga.paused(), account: haveAcct ? { number: jenga.acct().replace(/.(?=.{4})/g, "•"), name: jenga.accountName() } : null,
    treasury: { owedToSellersKES: owed, ordersWaiting: sellerWait.length }, deposits: store.readAll("equity_seen").slice(-15).reverse().map(({ text, ...d }) => d) };
  out.paybillWaiting = paybillWaiting().map((x) => ({ orderId: x.id, ref: x.id.slice(0, 6), crop: x.crop, buyer: x.buyerName, due: x.chargeAmount, paid: x.mpesaPaid || 0, currency: x.chargeCurrency || "KES", codes: store.readAll("mpesa_claims").filter((c) => c.orderId === x.id && c.equity && c.status === "waiting").map((c) => c.code), since: x.pendingSince, network: x.mobileNetwork || "mpesa" })); out.features.payBillManual = !!payments.manualKind();
  if (jenga.isConfigured()) { const b = await jenga.balance().catch((x) => ({ ok: false, error: x.message })); out.balance = b.ok ? { available: b.available, current: b.current, currency: b.currency } : { error: b.error }; if (b.ok) out.treasury.shortfallKES = Math.max(0, geo.roundMoney(owed - b.available, "KES")); }
  sendJSON(res, 200, out);
}
async function adminPaybillConfirm(req, res) { // one click: "I can see this Pay Bill payment in the Equity account" (needed only until the Equity API is connected — after that it confirms by itself)
  if (!requireAdmin(req, res)) return; const b = await readBody(req), q = clean(b.orderId, 60), cands = q.length >= 6 ? store.readAll("orders").filter((x) => x.id === q || x.id.startsWith(q)) : [];
  if (cands.length !== 1) return sendJSON(res, 404, { error: cands.length ? "More than one order starts with that — type more of the id." : "No order with that id." }); const o = cands[0];
  if (!o.equityPaybill || o.paymentStatus !== "pending") return sendJSON(res, 400, { error: "That order isn't waiting for a Pay Bill payment." });
  const left = Math.max(0, Math.round((o.chargeAmount - (o.mpesaPaid || 0)) * 100) / 100), amount = b.amount == null || b.amount === "" ? left : Number(b.amount); if (!(amount > 0) || amount > left * 1.05 + 1) return sendJSON(res, 400, { error: `Enter the amount you received (up to ${left}).` });
  const claim = store.readAll("mpesa_claims").find((c) => c.orderId === o.id && c.equity && c.status === "waiting" && (!b.code || c.code === String(b.code).toUpperCase())) || null, st = await applyEquityPaybill(o, { id: claim ? claim.code : "manual-" + o.id.slice(0, 8), amount }, "admin", claim);
  await evt("admin", "paybill_confirmed", o.id, "processed", `KES ${amount} confirmed by hand${claim ? " · " + claim.code : ""}`); const u = userOrder(o.id); sendJSON(res, 200, { ok: st === "confirmed" && u.paymentStatus !== "pending", status: u.paymentStatus, paid: u.mpesaPaid || 0, due: u.chargeAmount }); // ok = the order is now PAID, not merely that some money was recorded
}
async function adminEquityAssign(req, res) { // the rare payment with nothing to identify it: a person says which order it is for (the order id, or its first 6+ characters)
  if (!requireAdmin(req, res)) return; const b = await readBody(req), rec = store.readAll("equity_seen").find((x) => x.id === String(b.depositId || "").slice(0, 200)), q = clean(b.orderId, 60), cands = q.length >= 6 ? store.readAll("orders").filter((x) => x.id === q || x.id.startsWith(q)) : [];
  if (!rec) return sendJSON(res, 404, { error: "That payment isn't on the statement list." }); if (cands.length !== 1) return sendJSON(res, 404, { error: cands.length ? "More than one order starts with that — type more of the id." : "No order with that id." }); const o = cands[0];
  if (rec.status === "confirmed") return sendJSON(res, 409, { error: "That payment is already applied to an order." });
  let st; if (o.equityPaybill) st = await applyEquityPaybill(o, { id: rec.id, amount: rec.amount }, "admin", null); else if (o.wire && o.paymentStatus === "pending") { const c = await confirmWire(o, { amount: rec.amount, currency: o.wire.currency, bankRef: rec.id, source: "admin_assign" }); st = c.ok ? "confirmed" : "review"; } else return sendJSON(res, 400, { error: "That order isn't waiting for a bank or Paybill payment." });
  await markEquitySeen(rec.id, { status: st === "confirmed" ? "confirmed" : "review", orderId: o.id }); await evt("admin", "equity_assigned", o.id, "processed", `${rec.id} → ${st}`); sendJSON(res, 200, { ok: st === "confirmed", status: st });
}
async function adminEquityCheck(req, res) {
  if (!requireAdmin(req, res)) return; jenga.resetBreaker(); const steps = [];
  const run = async (name, fn) => { try { const r = await fn(); steps.push({ name, ok: !!r.ok, detail: r.detail || r.error || "" }); return r.ok; } catch (x) { steps.push({ name, ok: false, detail: x.message }); return false; } };
  if (await run("Log in to Equity (merchant code, consumer secret, API key)", () => jenga.testLogin())) {
    if (!process.env.JENGA_PRIVATE_KEY) steps.push({ name: "Signing key", ok: false, detail: "Press “Generate signing keys” and upload the public key in the Jenga console." });
    else if (jenga.acct()) {
      await run("Read your account balance (proves the signing key and account number work)", async () => { const b = await jenga.balance(true); return b.ok ? { ok: true, detail: `${b.currency} ${b.available.toFixed(2)} available` } : b; });
      await run("Read your account statement (this is how bank transfers confirm themselves)", async () => { const st = await jenga.fullStatement({ from: jenga.ymd(1), to: jenga.ymd(0), limit: 5 }); return st.ok ? { ok: true, detail: `${st.transactions.length} recent entries` } : st; });
    } else steps.push({ name: "Read your account balance and statement", ok: false, detail: "Waiting for your Equity account number." });
  }
  sendJSON(res, 200, { ok: steps.every((x) => x.ok), steps });
}
async function adminJengaKeys(req, res) { // make the signing key pair: the private half stays encrypted here, the public half is uploaded to the Jenga console
  if (!requireAdmin(req, res)) return; const b = await readBody(req);
  if (process.env.JENGA_PRIVATE_KEY && b.force !== true) { let pub = null; try { pub = jenga.publicKeyOf(); } catch (e) { /* invalid key */ } return sendJSON(res, 409, { error: "A signing key already exists. A new one means uploading its public key to Jenga again — are you sure?", publicKey: pub }); }
  const k = jenga.generateKeys(), r = await settings.save({ JENGA_PRIVATE_KEY: k.privateKey }); if (!r.ok) return sendJSON(res, 400, { error: r.errors.join(" ") });
  await evt("admin", "jenga_keys_generated", null, "processed", "new signing key"); sendJSON(res, 200, { ok: true, publicKey: k.publicKey });
}
async function adminJengaPublicKey(req, res) { if (!requireAdmin(req, res)) return; if (!process.env.JENGA_PRIVATE_KEY) return sendJSON(res, 200, { publicKey: null }); try { sendJSON(res, 200, { publicKey: jenga.publicKeyOf() }); } catch (e) { sendJSON(res, 200, { publicKey: null, error: "The saved signing key isn't a valid private key." }); } }
async function mpesaStkCallback(req, res) {
  const b = await readBody(req); const r = mpesa.parseStkCallback(b); sendJSON(res, 200, { ResultCode: 0, ResultDesc: "Accepted" }); if (!r) return;
  const o = findOrder((x) => x.mpesaCheckoutRequestId === r.checkoutRequestId); if (!o) return evt("mpesa", "stk", null, "ignored", "no matching order");
  if (r.success) { if (r.amount == null || Number(r.amount) + 0.5 >= payments.due(o).amount) await settlePayment(o, { provider: "mpesa", id: r.mpesaReceiptNumber }); else await evt("mpesa", "stk", o.id, "needs_review", `amount mismatch: ${r.amount}`); }
  else { await patchOrder(o.id, { paymentStatus: "failed", paymentError: r.resultDesc }); await evt("mpesa", "stk", o.id, "processed", r.resultDesc); }
}
async function mpesaB2c(req, res) {
  const b = await readBody(req); sendJSON(res, 200, { ok: true }); const r = b && b.Result; if (!r) return;
  const dl = store.readAll("deliveries").find((x) => x.riderConversationId && (x.riderConversationId === r.ConversationID || x.riderConversationId === r.OriginatorConversationID)); if (dl) { await riderTransferResult(dl, { ok: Number(r.ResultCode) === 0, failed: Number(r.ResultCode) !== 0, message: r.ResultDesc }); return; }
  const o = findOrder((x) => x.payoutConversationId && (x.payoutConversationId === r.ConversationID || x.payoutConversationId === r.OriginatorConversationID)); if (!o) return evt("mpesa", "b2c", null, "ignored", "no matching payout");
  if (Number(r.ResultCode) === 0) { await patchOrder(o.id, { paymentStatus: "paid_out", paidOutAt: now() }); await evt("mpesa", "payout_completed", o.id, "processed", "b2c ok"); }
  else { await patchOrder(o.id, { paymentStatus: "payout_failed", payoutError: r.ResultDesc, payoutAttempts: (o.payoutAttempts || 0) + 1, lastPayoutAt: now() }); await evt("mpesa", "payout_failed", o.id, "failed", r.ResultDesc); }
}
async function getI18n(req, res, m) { const r = await i18n.dictionary(m[1]); sendJSON(res, r.error ? 404 : 200, r); }
async function confirmReceipt(req, res, m) {
  const p = partyOrder(req, res, m[1]); if (!p) return;
  if (p.o.buyerId !== p.u.id) return sendJSON(res, 403, { error: "Only the buyer can confirm receipt." });
  if (p.o.paymentStatus !== "escrowed") return sendJSON(res, 400, { error: "This order isn't in escrow — nothing to release." });
  if (p.o.disputed) return sendJSON(res, 400, { error: "This order is under dispute — an administrator will resolve it." });
  await releaseOrder(p.o, "buyer_confirmed"); sendJSON(res, 200, { ok: true, message: "Receipt confirmed — the seller is being paid automatically." });
}
async function disputeOrder(req, res, m) {
  const p = partyOrder(req, res, m[1]); if (!p) return; const b = await readBody(req); const reason = clean(b.reason, 500);
  if (p.o.buyerId !== p.u.id || p.o.paymentStatus !== "escrowed") return sendJSON(res, 400, { error: "You can only dispute an order whose payment is held in escrow." });
  if (!reason) return sendJSON(res, 400, { error: "Please describe the problem." });
  await patchOrder(p.o.id, { disputed: true, disputeReason: reason, disputedAt: now() }); pushTo(p.o.farmerId, { title: "A dispute was opened", body: `${p.o.buyerName} raised a problem with the order for ${p.o.crop}. Open it to respond.`, url: "/?order=" + p.o.id, urgent: true, tag: "order-" + p.o.id }); await evt("sokoni", "dispute_opened", p.o.id, "processed", reason.slice(0, 120)); sendJSON(res, 200, { ok: true, message: "Dispute opened. An administrator will review it and the funds stay held." });
}
// Background jobs (every 5 min): reconcile stuck payments, retry payouts, auto-release when nobody objects.
async function autoReleaseSweep() { // release held funds when the goods were delivered (or collected) and nobody disputed
  try { for (const o of store.readAll("orders")) { if (o.paymentStatus !== "escrowed" || o.disputed) continue;
    if (o.deliveredAt && new Date(o.deliveredAt).getTime() < Date.now() - AUTO_RELEASE_DAYS * 86400e3) await releaseOrder(o, "auto_after_delivery");
    else if (!o.deliveryId && !o.shipmentId && o.escrowedAt && new Date(o.escrowedAt).getTime() < Date.now() - SELF_PICKUP_DAYS * 86400e3) await releaseOrder(o, "auto_self_pickup"); } } catch (e) { console.error("autoRelease", e.message); }
}
// A buyer who has just paid should not wait for the 5-minute sweep: while they are looking at the order, the page asks us to check that ONE payment
// with the provider. It is the same check as the sweep (the provider's own record, right amount, right currency), at most once every few seconds per order.
const lastPayCheck = new Map();
async function checkPayment(req, res, m) {
  const p = partyOrder(req, res, m[1]); if (!p) return; const { u, o } = p; if (o.buyerId !== u.id) return sendJSON(res, 403, { error: "Only the buyer can check this payment." });
  if (o.paymentStatus !== "pending" || !o.providerRef || o.paymentProvider === "bank_wire") return sendJSON(res, 200, { status: o.paymentStatus, checked: false });
  const t0 = Date.now(), every = process.env.PAYMENT_CHECK_EVERY_MS != null && process.env.PAYMENT_CHECK_EVERY_MS !== "" ? Number(process.env.PAYMENT_CHECK_EVERY_MS) : 8000;
  if (t0 - new Date(o.pendingSince || 0).getTime() < 6000 || t0 - (lastPayCheck.get(o.id) || 0) < every) return sendJSON(res, 200, { status: "pending", checked: false });
  lastPayCheck.set(o.id, t0); if (lastPayCheck.size > 5000) lastPayCheck.clear();
  let r = null; try { r = await payments.pollStatus(o); } catch (e) { return sendJSON(res, 200, { status: "pending", checked: false }); }
  if (r) { const dd = payments.due(o), okAmt = r.minor != null ? r.minor === payments.minorUnits(dd.amount, dd.currency) : Number(r.amount) + 0.005 >= dd.amount;
    if (r.paid && okAmt && String(r.currency).toUpperCase() === dd.currency) { await settlePayment(o, { provider: o.paymentProvider, id: r.id, note: "found while the buyer was waiting" }); await evt(o.paymentProvider, "reconciled", o.id, "processed", "payment found while the buyer was waiting"); }
    else if (r.failed && !r.paid) { await patchOrder(o.id, { paymentStatus: "failed", paymentError: "The payment didn't go through." }); await evt(o.paymentProvider, "reconciled", o.id, "processed", "failed"); } }
  const cur = store.readAll("orders").find((x) => x.id === o.id); sendJSON(res, 200, { status: cur ? cur.paymentStatus : "pending", checked: true });
}
async function reconcileSweep() { // a webhook may have been missed: ask the provider directly
  try { for (const o of store.readAll("orders")) { if (o.paymentStatus !== "pending" || !o.providerRef || !o.pendingSince || Date.now() - new Date(o.pendingSince).getTime() < 3 * 60000) continue;
    if (o.paymentProvider === "bank_wire") { if (o.wire && Date.now() > new Date(o.wire.expiresAt).getTime()) { await patchOrder(o.id, { paymentStatus: "failed", paymentError: "The bank transfer wasn't received in time." }); await evt("bank_wire", "wire_expired", o.id, "needs_review", o.wire.reference + " not received — if the buyer did send it, confirm it manually or refund them"); } continue; } // wires can't be polled
    const r = await payments.pollStatus(o); if (!r) continue;
    const dd = payments.due(o), okAmt = r.minor != null ? r.minor === payments.minorUnits(dd.amount, dd.currency) : Number(r.amount) + 0.005 >= dd.amount;
    if (r.paid && okAmt && String(r.currency).toUpperCase() === dd.currency) { await settlePayment(o, { provider: o.paymentProvider, id: r.id, note: "found by reconciliation" }); await evt(o.paymentProvider, "reconciled", o.id, "processed", "payment found by polling"); }
    else if (r.failed && !r.paid) { await patchOrder(o.id, { paymentStatus: "failed", paymentError: "The payment didn't go through." }); await evt(o.paymentProvider, "reconciled", o.id, "processed", "failed"); }
    else if (!r.paid && Date.now() - new Date(o.pendingSince).getTime() > 24 * 3600e3) await patchOrder(o.id, { paymentStatus: "failed", paymentError: "Payment expired" }); } } catch (e) { console.error("reconcile", e.message); }
}
async function payoutSweep() { // sellers who add a payout method later, and transient failures, get paid without anyone clicking
  try { for (const o of store.readAll("orders")) { const last = o.lastPayoutAt ? new Date(o.lastPayoutAt).getTime() : 0;
    if (o.paymentStatus === "payout_pending" && Date.now() - last > 4 * 60000) await runPayout(o);
    else if (o.paymentStatus === "payout_failed" && o.payoutWaitingFunds && Date.now() - last > 30 * 60000 && Date.now() - new Date(o.payoutWaitingSince || 0).getTime() < fundsWaitMs()) await runPayout(o);
    else if (o.paymentStatus === "payout_failed" && !o.payoutWaitingFunds && (o.payoutAttempts || 0) < 5 && Date.now() - last > 10 * 60000 * (o.payoutAttempts || 1)) await runPayout(o); }
    for (const d of store.readAll("deliveries")) { const last = d.lastRiderPayoutAt ? new Date(d.lastRiderPayoutAt).getTime() : 0; if (d.riderPayoutStatus === "pending" && Date.now() - last > 4 * 60000) await payRider(d); else if (d.riderPayoutStatus === "failed" && d.riderWaitingFunds && Date.now() - last > 30 * 60000 && Date.now() - new Date(d.riderWaitingSince || 0).getTime() < fundsWaitMs()) await payRider(d); else if (d.riderPayoutStatus === "failed" && !d.riderWaitingFunds && (d.riderPayoutAttempts || 0) < 5 && Date.now() - last > 10 * 60000 * (d.riderPayoutAttempts || 1)) await payRider(d); } } catch (e) { console.error("payoutSweep", e.message); }
}
// ---- Equity: bank transfers confirm THEMSELVES by reading your account statement; PesaLink payouts and refunds are followed through. No admin involved. ----
const paybillWaiting = () => store.readAll("orders").filter((x) => x.equityPaybill && x.paymentStatus === "pending");
const markEquitySeen = (sid, patch) => store.mutate("equity_seen", (all) => all.map((x) => (x.id === sid ? { ...x, ...patch } : x)));
async function applyEquityPaybill(o, t, how, claim) { // a payment from the M-Pesa menu has arrived in the Equity account: same rules as any other (partial payments add up, extra is flagged)
  if (o.paymentStatus !== "pending" || o.status !== "accepted" || FINAL.includes(o.paymentStatus)) { await evt("jenga", "paybill_orphan", o.id, "needs_review", `KES ${t.amount} arrived but this order isn't awaiting payment — refund the buyer`); if (claim) await setClaim(claim.id, { status: "review" }); return "review"; }
  const code = claim ? claim.code : String(t.id || "").slice(0, 24), due = o.chargeAmount, paid = Math.round(((o.mpesaPaid || 0) + Number(t.amount)) * 100) / 100, codes = [...(o.mpesaCodes || []), code];
  if (paid + 0.5 >= due) { const u = await patchOrder(o.id, { mpesaPaid: paid, mpesaCodes: codes, mpesaReceipt: codes.join(", ") }); await settlePayment(u, { provider: "jenga", id: codes.join(","), note: `Paybill payment ${code} (${how})` }); if (paid > due + 1) await evt("jenga", "paybill_overpaid", o.id, "needs_review", `paid KES ${paid}, due KES ${due} — refund KES ${Math.round((paid - due) * 100) / 100}`); }
  else { await patchOrder(o.id, { mpesaPaid: paid, mpesaCodes: codes }); await evt("jenga", "paybill_partial", o.id, "processed", `KES ${paid} of ${due} received`); }
  if (claim) await setClaim(claim.id, { status: "approved", approvedAt: now(), transId: code }); return "confirmed";
}
function matchPaybill(t) { // → { order, claim?, how } or null. Evidence, strongest first: the M-Pesa code on Equity's line; else this buyer's phone on the line + exactly one waiting order that fits.
  const text = (t.description + " " + t.reference).toUpperCase(), flat = text.replace(/[^A-Z0-9]/g, ""), digits = text.replace(/\D/g, "");
  for (const c of store.readAll("mpesa_claims").filter((x) => x.equity && x.status === "waiting")) if (flat.includes(c.code)) { const o = userOrder(c.orderId); if (o) return { order: o, claim: c, how: "code" }; }
  const fits = paybillWaiting().filter((x) => x.jengaPhone && digits.includes(String(x.jengaPhone).slice(-9)) && t.amount + 0.5 >= x.chargeAmount - (x.mpesaPaid || 0) && t.amount <= (x.chargeAmount - (x.mpesaPaid || 0)) * 1.05 + 1);
  return fits.length === 1 ? { order: fits[0], how: "phone" } : null;
}
async function tryEquityClaim(o, claim) { // the credit may already have been seen before the buyer typed the code
  const hit = store.readAll("equity_seen").find((x) => !["confirmed", "already"].includes(x.status) && String(x.text || "").includes(claim.code)); if (!hit) return false;
  const st = await applyEquityPaybill(o, { id: hit.id, amount: hit.amount }, "code", claim); if (st === "confirmed") { await markEquitySeen(hit.id, { status: "confirmed", orderId: o.id }); return true; } return false;
}
const WIRE_REF = /SOK[0-9A-F]{8}/;
const refIn = (t) => [t.description, t.reference].map((x) => (String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "").match(WIRE_REF) || [])[0]).find(Boolean) || null;
async function applyEquityStatement(st) {
  const seen = new Set(store.readAll("equity_seen").map((x) => x.id)), fresh = [], out = { confirmed: 0, review: 0, other: 0 };
  const waiting = () => store.readAll("orders").filter((o) => o.paymentProvider === "bank_wire" && o.paymentStatus === "pending" && o.wire);
  for (const t of st.transactions) {
    if (t.type !== "credit" || seen.has(t.id) || !(t.amount > 0)) continue; seen.add(t.id); const ref = refIn(t); let status = "other", orderId = null, how = "reference";
    let o = ref ? findOrder((x) => x.paymentProvider === "bank_wire" && x.wire && x.wire.reference === ref) : null; const flatText = (String(t.description) + String(t.reference)).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!o && !ref) { const pb = matchPaybill(t); if (pb) { orderId = pb.order.id; status = await applyEquityPaybill(pb.order, t, pb.how, pb.claim); how = "paybill-" + pb.how; } }
    if (!o && !ref && !orderId && !/MPESA|247247|SAFARICOM/.test(flatText)) { // no reference typed: only when the buyer pressed "I've sent it" AND exactly one waiting order fits the amount — never a guess between two
      const fits = waiting().filter((x) => x.wireSentAt && x.wire.currency === String(st.currency).toUpperCase() && payments.wireMatches(x.wire, { amount: t.amount, currency: st.currency }).ok && t.amount <= x.wire.amount * 1.05 + 1 && new Date(t.at).getTime() >= new Date(x.wire.createdAt).getTime() - 86400e3);
      if (fits.length === 1) { o = fits[0]; how = "amount"; } else if (fits.length > 1) { status = "review"; }
    }
    if (o) { orderId = o.id; if (o.paymentStatus === "pending") { const c = await confirmWire(o, { amount: t.amount, currency: st.currency, bankRef: t.reference || t.id, source: how === "amount" ? "equity_statement_amount" : "equity_statement" }); status = c.ok ? "confirmed" : "review"; } else status = "already"; }
    if (status === "confirmed") out.confirmed++; else if (status === "review" && orderId && how.startsWith("paybill")) out.review++; else if (status === "review") { out.review++; await evt("jenga", "deposit_needs_review", orderId, "needs_review", `KES ${t.amount} ${ref || "(no reference)"} — ${how === "amount" ? "more than one waiting transfer fits" : "amount or currency doesn't match"}`); } else out.other++;
    fresh.push({ id: t.id, at: t.at, amount: t.amount, status, orderId, ref, description: String(t.description).slice(0, 120), text: flatText.slice(0, 200), seenAt: now() });
  }
  if (fresh.length) await store.mutate("equity_seen", (all) => [...all, ...fresh].slice(-2000)); return out;
}
let equityBusy = false;
async function equitySweep() {
  if (!jenga.isConfigured() || equityBusy) return; equityBusy = true;
  try {
    for (const o of paybillWaiting()) if (Date.now() - new Date(o.pendingSince || 0).getTime() > 24 * 3600e3) { await patchOrder(o.id, { paymentStatus: "failed", paymentError: "Payment expired" }); await evt("jenga", "paybill_expired", o.id, "processed", "no Paybill payment arrived within a day"); }
    const waiting = store.readAll("orders").filter((o) => o.paymentProvider === "bank_wire" && o.paymentStatus === "pending" && o.wire), pbw = paybillWaiting();
    if ((waiting.length && payments.wireIsEquity()) || pbw.length) { const oldest = Math.min(...[...waiting.map((o) => new Date(o.wire.createdAt || Date.now()).getTime()), ...pbw.map((o) => new Date(o.pendingSince || Date.now()).getTime())]), days = Math.min(10, Math.max(1, Math.ceil((Date.now() - oldest) / 86400e3) + 1));
      const st = await jenga.fullStatement({ from: jenga.ymd(days), to: jenga.ymd(0), limit: 500 }); if (st.ok) await applyEquityStatement(st); else await evt("jenga", "statement_error", null, "failed", st.error); }
    for (const o of store.readAll("orders")) { // a PesaLink payout that didn't answer at once: ask Equity (state 2 = paid, 1 = failed)
      if (o.paymentStatus === "payout_initiated" && o.payoutRoute === "jenga_pesalink" && o.payoutRef && Date.now() - new Date(o.lastPayoutAt || 0).getTime() > 2 * 60000) { const t = await jenga.transactionDetails(o.payoutRef);
        if (t.ok && t.state === 2) await patchOrder(o.id, { paymentStatus: "paid_out", paidOutAt: now() }); else if (t.ok && t.state === 1) await patchOrder(o.id, { paymentStatus: "payout_failed", payoutError: "The PesaLink transfer failed", payoutAttempts: (o.payoutAttempts || 0) + 1, lastPayoutAt: now() }); }
      if (o.paymentStatus === "refunding" && o.refundRetry && (o.refundAttempts || 0) < 12 && Date.now() - new Date(o.lastRefundAt || 0).getTime() > 10 * 60000) { // a refund that couldn't go out yet (e.g. balance momentarily short) is retried by itself
        let r; try { r = await payments.refund(o, { phone: (userById(o.buyerId) || {}).phone }); } catch (e) { r = { automatic: true, pending: true, retry: true, reason: e.message }; }
        const n = (o.refundAttempts || 0) + 1; if (r.automatic && !r.retry) await patchOrder(o.id, { refundRef: r.ref, refundRetry: false, refundError: null, lastRefundAt: now(), refundAttempts: n }); else if (!r.automatic || n >= 12) { await patchOrder(o.id, { refundRetry: false, refundError: r.reason || "retries used up", lastRefundAt: now(), refundAttempts: n }); await evt("jenga", "refund_failed", o.id, "needs_review", (r.reason || "retries used up") + " — send this refund by hand"); } else await patchOrder(o.id, { refundError: r.reason, lastRefundAt: now(), refundAttempts: n }); } }
  } catch (e) { console.error("equitySweep", e.message); } finally { equityBusy = false; }
}
const sweeps = async () => { await reconcileSweep(); await payoutSweep(); await autoReleaseSweep(); await qualitySweep(); await bondSweep(); await cryptoSweep(); await fincraSweep(); await paystackSweep(); await ratingSweep(); await analyticsSweep(); };

// ---------- admin: operations dashboard. Normal payments and payouts are automatic — humans only settle disputes and exceptions ----------
const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
const byCur = (orders, f) => { const o = {}; orders.forEach((x) => { o[x.currency] = geo.roundMoney((o[x.currency] || 0) + f(x), x.currency); }); return o; };
const adminOrder = (o) => ({ id: o.id, coinLevy: (o.coinLevyBuyer || 0) + (o.coinLevySeller || 0), crop: o.crop, amount: payments.chargeOf(o), deliveryFee: o.deliveryFee || 0, currency: o.currency, charged: o.chargeCurrency ? { currency: o.chargeCurrency, amount: o.chargeAmount } : null, sellerPayout: o.sellerPayout, commission: o.commission, paymentStatus: o.paymentStatus, provider: o.paymentProvider || null, method: o.paymentMethod || null, buyer: o.buyerName + " (" + o.buyerCountry + ")", seller: o.farmerName + " (" + o.farmerCountry + ")", createdAt: o.createdAt, escrowedAt: o.escrowedAt || null, paidOutAt: o.paidOutAt || null, pendingSince: o.pendingSince || null, disputed: !!o.disputed, disputeReason: o.disputeReason || null, payoutNote: o.payoutNote || null, payoutError: o.payoutError || null, payoutRoute: o.payoutRoute || null, releaseReason: o.releaseReason || null });
async function adminOverview(req, res) {
  if (!requireAdmin(req, res)) return; const orders = store.readAll("orders"), day = new Date(); day.setUTCHours(0, 0, 0, 0); const rates = await fx.getRates();
  const usd = (cur, amt) => (rates && rates.rates[cur] ? Math.round((amt / rates.rates[cur]) * 100) / 100 : null); const toUsd = (m) => { let t = 0; for (const [c, a] of Object.entries(m)) { const v = usd(c, a); if (v == null) return null; t += v; } return Math.round(t * 100) / 100; };
  const paid = orders.filter((o) => o.escrowedAt && o.paymentStatus !== "refunded"), held = orders.filter((o) => o.paymentStatus === "escrowed"), today = paid.filter((o) => new Date(o.escrowedAt) >= day), pend = orders.filter((o) => ["payout_pending", "payout_failed", "payout_initiated"].includes(o.paymentStatus));
  const gmv = byCur(paid, (o) => o.amount), heldM = byCur(held, (o) => payments.chargeOf(o)), todayM = byCur(today, (o) => payments.chargeOf(o)), pendM = byCur(pend, (o) => o.sellerPayout), fees = byCur(paid, (o) => o.commission);
  const ships = store.readAll("shipments").filter((x) => ["carrier_selected", "picked_up", "in_transit", "at_customs"].includes(x.status)).length, dels = store.readAll("deliveries").filter((x) => ["assigned", "picked_up"].includes(x.status)).length;
  sendJSON(res, 200, { activeOrders: orders.filter((o) => o.status === "accepted" && !["paid_out", "refunded", "failed"].includes(o.paymentStatus)).length, paymentsToday: { count: today.length, byCurrency: todayM, usd: toUsd(todayM) }, gmv: { byCurrency: gmv, usd: toUsd(gmv) }, fundsHeld: { count: held.length, byCurrency: heldM, usd: toUsd(heldM) },
    payoutsPending: { count: pend.length + store.readAll("deliveries").filter((d) => ["pending", "failed", "initiated"].includes(d.riderPayoutStatus)).length, failed: pend.filter((o) => o.paymentStatus === "payout_failed").length, byCurrency: pendM, usd: toUsd(pendM) }, platformFees: { byCurrency: fees, usd: toUsd(fees) }, deliveriesInProgress: dels + ships, openDisputes: orders.filter((o) => o.disputed && o.paymentStatus === "escrowed").length, listingReviews: store.readAll("listings").filter((l) => l.status === "pending_review").length, wiresAwaiting: store.readAll("orders").filter((o) => o.paymentProvider === "bank_wire" && o.paymentStatus === "pending").length, riderReviews: store.readAll("users").filter((x) => x.isRider && !vehicleVerified(x) && !(x.vehicle && x.vehicle.verification.status === "rejected")).length, companyReviews: store.readAll("users").filter((x) => x.kind === "company" && x.company && x.company.verification && x.company.verification.status === "pending").length, fxAvailable: !!rates });
}
async function adminPayments(req, res, m, url) {
  if (!requireAdmin(req, res)) return; const st = url.searchParams.get("status") || "successful"; const sets = { successful: ["escrowed", "payout_pending", "payout_initiated", "paid_out", "payout_failed"], pending: ["pending"], failed: ["failed"], refunded: ["refunding", "refunded"] };
  sendJSON(res, 200, { payments: store.readAll("orders").filter((o) => (sets[st] || []).includes(o.paymentStatus)).sort(byNewest).slice(0, 300).map(adminOrder) });
}
async function adminReconciliations(req, res) {
  if (!requireAdmin(req, res)) return; const out = []; const ago = (iso) => Date.now() - new Date(iso).getTime();
  for (const o of store.readAll("orders")) { const a = adminOrder(o);
    if (o.paymentStatus === "pending" && o.pendingSince && ago(o.pendingSince) > 15 * 60000) out.push({ kind: "payment_stuck", severity: "warn", text: "Payment pending for over 15 minutes — the poller keeps checking the provider", order: a });
    if (o.paymentStatus === "payout_failed" && o.payoutWaitingFunds) out.push({ kind: "payout_waiting_funds", severity: "warn", text: `Waiting for settlement: your provider balance is too low to send this payout yet (${o.payoutError || ""}). It retries every 30 minutes for 3 days — top up the balance or wait for the buyer's payment to settle.`, order: a });
    else if (o.paymentStatus === "payout_failed") out.push({ kind: "payout_failed", severity: "error", text: `Payout failed (${o.payoutAttempts || 1}×): ${o.payoutError || "unknown"}`, order: a });
    if (o.paymentStatus === "payout_pending" && o.lastPayoutAt && ago(o.lastPayoutAt) > 3600e3) out.push({ kind: "payout_waiting", severity: "info", text: o.payoutNote || "Waiting for a supported payout method", order: a }); }
  store.readAll("provider_events").filter((e) => ["needs_review", "failed"].includes(e.status)).slice(-100).forEach((e) => out.push({ kind: "provider_event", severity: e.status === "failed" ? "error" : "warn", text: `${e.provider} · ${e.type} · ${e.detail}`, at: e.at, orderId: e.orderId }));
  sendJSON(res, 200, { items: out.reverse() });
}
async function adminEvents(req, res) { if (!requireAdmin(req, res)) return; sendJSON(res, 200, { events: store.readAll("provider_events").slice(-250).reverse() }); }
const dest = (u) => { const q = u && u.payout; if (!q) return "No payout method saved"; return q.type === "mpesa" ? `M-Pesa ${q.phone}` : q.type === "mobile_money" ? `${q.network} ${q.phone}` : q.type === "bank" ? `${q.bankName} · ${q.accountNumber} · ${q.accountName} (${q.country})` : q.type === "swift" ? `${q.bankName} · SWIFT ${q.swift} · ${q.accountNumber} · ${q.accountName} (${q.country}${q.currency ? ", " + q.currency : ""})` : `${q.network} · ${q.address}${q.memo ? " memo " + q.memo : ""}`; };
async function adminPayouts(req, res, m, url) {
  if (!requireAdmin(req, res)) return; const st = url.searchParams.get("status") || "pending"; const sets = { pending: ["payout_pending", "payout_initiated"], failed: ["payout_failed"], completed: ["paid_out"], manual: ["payout_pending", "payout_failed"] };
  const rs = { pending: ["pending", "initiated"], manual: ["pending", "failed"], failed: ["failed"], completed: ["paid"] };
  const riders = store.readAll("deliveries").filter((d) => d.riderId && (rs[st] || []).includes(d.riderPayoutStatus) && (st !== "manual" || d.riderPayoutManual || d.riderPayoutStatus === "failed")).sort(byNewest).slice(0, 200).map((d) => ({ id: d.id, orderId: d.orderId, rider: (userById(d.riderId) || {}).name, amount: d.feeAmount, currency: d.feeCurrency, status: d.riderPayoutStatus, route: d.riderPayoutRoute || null, note: d.riderPayoutError || d.riderPayoutNote || "", destination: dest(userById(d.riderId)), deliveredAt: d.deliveredAt }));
  sendJSON(res, 200, { riderPayouts: riders, payouts: store.readAll("orders").filter((o) => (sets[st] || []).includes(o.paymentStatus) && (st !== "manual" || o.payoutManual || o.paymentStatus === "payout_failed")).sort(byNewest).slice(0, 300).map((o) => ({ ...adminOrder(o), destination: dest(userById(o.farmerId)), manual: !!o.payoutManual })) });
}
async function adminMarkPaidOut(req, res, m) { // exception tool: the team paid a seller outside the automatic rails (SWIFT, crypto, unsupported mobile money…)
  if (!requireAdmin(req, res)) return; const b = await readBody(req); const o = store.readAll("orders").find((x) => x.id === m[1]); if (!o || !["payout_pending", "payout_failed"].includes(o.paymentStatus)) return sendJSON(res, 400, { error: "Order isn't awaiting a payout." });
  await evt("admin", "payout_manual", o.id, "processed", clean(b.reference, 120)); sendJSON(res, 200, { order: adminOrder(await patchOrder(o.id, { paymentStatus: "paid_out", paidOutAt: now(), payoutRoute: "manual", payoutRef: clean(b.reference, 120), payoutNote: null })) });
}
async function adminRetryRiderPayout(req, res, m) { if (!requireAdmin(req, res)) return; const d = store.readAll("deliveries").find((x) => x.id === m[1]); if (!d || !["pending", "failed"].includes(d.riderPayoutStatus)) return sendJSON(res, 400, { error: "Nothing to retry." }); await payRider(d); sendJSON(res, 200, { ok: true }); }
async function adminMarkRiderPaid(req, res, m) { if (!requireAdmin(req, res)) return; const b = await readBody(req); const d = store.readAll("deliveries").find((x) => x.id === m[1]); if (!d || !["pending", "failed"].includes(d.riderPayoutStatus)) return sendJSON(res, 400, { error: "This rider payout isn't waiting." }); await patchDelivery(d.id, { riderPayoutStatus: "paid", riderPaidAt: now(), riderPayoutRoute: "manual", riderPayoutRef: clean(b.reference, 120), riderPayoutNote: null }); await evt("admin", "rider_payout_manual", d.orderId, "processed", clean(b.reference, 120)); sendJSON(res, 200, { ok: true }); }
async function adminAiTest(req, res) { if (!requireAdmin(req, res)) return; const r = await ai.selfTest(); sendJSON(res, 200, { ok: r.ok, model: ai.model(), error: r.ok ? null : r.error.message, last: ai.last }); }
async function adminDisputes(req, res) {
  if (!requireAdmin(req, res)) return; const msgs = store.readAll("messages");
  sendJSON(res, 200, { disputes: store.readAll("orders").filter((o) => o.disputed && o.paymentStatus === "escrowed").sort(byNewest).map((o) => ({ ...adminOrder(o), reason: o.disputeReason, openedAt: o.disputedAt, delivered: !!o.deliveredAt, hasDelivery: !!(o.deliveryId || o.shipmentId), chat: msgs.filter((x) => x.threadType === "order" && x.threadId === o.id).slice(-30).map((x) => ({ from: x.senderName, text: x.text, at: x.createdAt })), listing: (() => { const l = store.readAll("listings").find((x) => x.id === o.listingId); return l ? { photos: (l.photos || []).map((x) => x.url), quality: l.quality || null } : null; })() })) });
}
async function adminResolve(req, res, m) {
  if (!requireAdmin(req, res)) return; const b = await readBody(req); const o = store.readAll("orders").find((x) => x.id === m[1]); const note = clean(b.note, 300);
  if (!o || !o.disputed || o.paymentStatus !== "escrowed") return sendJSON(res, 400, { error: "Order isn't a held, disputed order." });
  const why = maskContacts(clean(o.disputeReason, 200));
  if (b.decision === "release") { await dataset.addOutcome(o.listingId, { type: "dispute_seller_won", order: o.id, reason: why }); const u = await patchOrder(o.id, { disputed: false, disputeResolution: "released", adminNote: note }); await releaseOrder(u, "dispute_released"); await evt("admin", "dispute_resolved", o.id, "processed", "released to seller"); return sendJSON(res, 200, { order: adminOrder(await patchOrder(o.id, {})) }); }
  if (b.decision === "refund") { let r = { automatic: false }; const eq = o.paymentProvider === "jenga" || o.paymentProvider === "bank_wire";
    try { r = await payments.refund(o, { phone: (userById(o.buyerId) || {}).phone }); } catch (e) { if (!eq) return sendJSON(res, 502, { error: "Refund failed at the provider: " + e.message }); r = { automatic: true, pending: true, retry: true, ref: null, reason: e.message }; } // Equity hiccup (e.g. balance momentarily short): decided now, sent automatically as soon as it works
    await slashBond(o); await dataset.addOutcome(o.listingId, { type: "dispute_buyer_won", order: o.id, reason: why }); const done = r.automatic && !r.pending, u = await patchOrder(o.id, { disputed: false, disputeResolution: "refund", adminNote: note, paymentStatus: done ? "refunded" : "refunding", refundRef: r.ref, refundedAt: done ? now() : null, refundRetry: !!r.retry, refundError: r.retry || !r.automatic ? r.reason || null : null, refundAttempts: 0, lastRefundAt: now() });
    await evt("admin", "dispute_resolved", o.id, "processed", done ? "refunded automatically" : r.automatic ? (r.retry ? "refund queued — retrying automatically: " + r.reason : "refund sent — awaiting Equity's confirmation") : "refund must be sent manually: " + (r.reason || "this payment type can't be reversed here")); return sendJSON(res, 200, { order: adminOrder(u), manualRefundRequired: !r.automatic, refundNote: r.reason || null }); }
  sendJSON(res, 400, { error: "decision must be 'release' or 'refund'." });
}
async function adminMarkRefunded(req, res, m) { if (!requireAdmin(req, res)) return; const b = await readBody(req); const o = store.readAll("orders").find((x) => x.id === m[1]); if (!o || o.paymentStatus !== "refunding") return sendJSON(res, 400, { error: "Order isn't awaiting a manual refund." }); sendJSON(res, 200, { order: adminOrder(await patchOrder(o.id, { paymentStatus: "refunded", refundRef: clean(b.reference, 120), refundedAt: now() })) }); }
async function adminRetryPayout(req, res, m) { if (!requireAdmin(req, res)) return; const o = store.readAll("orders").find((x) => x.id === m[1]); if (!o || !["payout_pending", "payout_failed"].includes(o.paymentStatus)) return sendJSON(res, 400, { error: "Nothing to retry." }); await runPayout(o); sendJSON(res, 200, { order: adminOrder(await patchOrder(o.id, {})) }); }
async function adminReviews(req, res) { if (!requireAdmin(req, res)) return; sendJSON(res, 200, { reviews: store.readAll("listings").filter((l) => l.status === "pending_review").sort(byNewest).map((l) => ({ id: l.id, crop: l.crop, seller: l.farmerName, country: l.country, location: l.location, photos: (l.photos || []).map((p) => p.url), trust: l.trust, createdAt: l.createdAt })) }); }
async function adminReviewDecision(req, res, m) {
  if (!requireAdmin(req, res)) return; const b = await readBody(req); if (!["approve", "reject"].includes(b.decision)) return sendJSON(res, 400, { error: "decision must be approve or reject." }); let out = null;
  await store.mutate("listings", (all) => all.map((l) => { if (l.id !== m[1] || l.status !== "pending_review") return l; out = { ...l, status: b.decision === "approve" ? "available" : "rejected", reviewNote: clean(b.note, 300) }; return out; }));
  if (!out) return sendJSON(res, 400, { error: "Listing isn't awaiting review." }); sendJSON(res, 200, { ok: true });
}
// ---------- going live: readiness checklist, connection tests, accounting export, health ----------
const baseUrl = () => (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""), isLocalUrl = (u) => !u || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(u);
const keyMode = (kind) => { const k = kind === "stripe" ? process.env.STRIPE_SECRET_KEY || "" : kind === "flutterwave" ? process.env.FLW_SECRET_KEY || "" : ""; if (!k) return null; if (kind === "stripe") return /^(sk|rk)_test_/.test(k) ? "test" : /^(sk|rk)_live_/.test(k) ? "live" : "unknown"; return /TEST/i.test(k) ? "test" : "live"; };
async function captureAnon(req, res) { const k = "ca:" + clientIp(req), w = waitMinutes(k, 30, 3600e3); if (w) return sendJSON(res, 429, { error: "Too many camera sessions. Try again later." }); noteAttempt(k); sendJSON(res, 200, await trust.issueAnon()); }
async function riderVehicle(req, res) { // a rider (re)submits vehicle details + a live plate photo
  const u = requireRider(req, res); if (!u) return; const me = userById(u.id), b = await readBody(req, 4e6), vtype = clean(b.vehicleType, 40), needPlate = vtype !== "Bicycle", plate = plateKey(b.plateNumber), make = clean(b.vehicleMake, 80);
  if (!VEHICLES.includes(vtype)) return sendJSON(res, 400, { error: "Please select a valid vehicle type." }); if (needPlate && (plate.length < 3 || plate.length > 10)) return sendJSON(res, 400, { error: "Enter your vehicle's number plate." }); if (make.length < 2) return sendJSON(res, 400, { error: "Enter your vehicle's make, model and colour." });
  const ph = checkVehiclePhoto(await trust.consumeSession(b.captureToken, me.id), b.vehiclePhoto, me.vehicle && me.vehicle.photoSha); if (ph.error) return sendJSON(res, 400, { error: ph.error });
  const typed = { type: vtype, plate: needPlate ? plate : "", makeModel: make }, dec = await decideVehicle(typed, ph.buf), file = `veh-${me.id}.jpg`; fs.writeFileSync(path.join(PRIVATE_DIR, file), ph.buf);
  await store.mutate("vehicle_photos", (all) => [...all.filter((x) => x.userId !== me.id), { sha: ph.hash, userId: me.id }]); let out = null;
  await store.mutate("users", (all) => all.map((x) => { if (x.id !== me.id) return x; out = { ...x, vehicleType: vtype, plateNumber: typed.plate, vehicle: { ...typed, photoFile: file, photoSha: ph.hash, photoAt: new Date(ph.at).toISOString(), verification: { status: dec.status, note: dec.note, plateRead: dec.plateRead, at: now() } } }; return out; }));
  if (dec.status !== "verified") await store.mutate("rider_status", (all) => all.map((r) => (r.riderId === me.id ? { ...r, online: false } : r))); sendJSON(res, 200, { user: publicUser(out), status: dec.status, note: dec.note });
}
async function adminRiders(req, res, m, url) {
  if (!requireAdmin(req, res)) return; const st = url.searchParams.get("status") || "pending", of = (u) => (u.vehicle ? u.vehicle.verification.status : "pending");
  sendJSON(res, 200, { riders: store.readAll("users").filter((u) => u.isRider && of(u) === st).map((u) => ({ userId: u.id, name: u.name, phone: u.phone, email: u.email, country: u.country, vehicle: u.vehicle ? { type: u.vehicle.type, plate: u.vehicle.plate, makeModel: u.vehicle.makeModel, plateRead: u.vehicle.verification.plateRead, note: u.vehicle.verification.note, photoAt: u.vehicle.photoAt, hasPhoto: !!u.vehicle.photoFile } : { type: u.vehicleType, plate: u.plateNumber, makeModel: "", note: "Registered before vehicle checks existed — no photo yet.", hasPhoto: false } })) });
}
async function adminRiderPhoto(req, res, m) { if (!requireAdmin(req, res)) return; const u = userById(m[1]); if (!u || !u.vehicle || !u.vehicle.photoFile) return sendJSON(res, 404, { error: "No photo." }); fs.readFile(path.join(PRIVATE_DIR, path.basename(u.vehicle.photoFile)), (err, data) => { if (err) return sendJSON(res, 404, { error: "File missing." }); res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" }); res.end(data); }); }
async function adminRiderReview(req, res, m) {
  if (!requireAdmin(req, res)) return; const b = await readBody(req), u = userById(m[1]); if (!u || !u.isRider || !u.vehicle) return sendJSON(res, 400, { error: "This rider has no vehicle submission." }); if (!["approve", "reject"].includes(b.decision)) return sendJSON(res, 400, { error: "decision must be approve or reject." });
  await store.mutate("users", (all) => all.map((x) => (x.id === u.id ? { ...x, vehicle: { ...x.vehicle, verification: { ...x.vehicle.verification, status: b.decision === "approve" ? "verified" : "rejected", note: b.decision === "approve" ? "" : clean(b.note, 300) || "Your vehicle photo wasn't accepted. Please retake it.", at: now(), reviewedBy: "admin" } } } : x)));
  if (b.decision === "reject") await store.mutate("rider_status", (all) => all.map((r) => (r.riderId === u.id ? { ...r, online: false } : r))); await evt("admin", "vehicle_" + b.decision, null, "processed", u.name); sendJSON(res, 200, { ok: true });
}
async function adminUsers(req, res, m, url) { // find an account by name, phone or email
  if (!requireAdmin(req, res)) return; const q = clean(url.searchParams.get("q"), 80).toLowerCase(), digits = q.replace(/\D/g, ""); if (q.length < 3) return sendJSON(res, 200, { users: [] });
  sendJSON(res, 200, { users: store.readAll("users").filter((u) => String(u.name || "").toLowerCase().includes(q) || String(u.email || "").toLowerCase().includes(q) || (digits.length >= 3 && String(u.phone || "").replace(/\D/g, "").includes(digits))).slice(0, 20).map((u) => ({ id: u.id, name: u.name, phone: u.phone, email: u.email || "", country: u.country, kind: u.kind, isRider: !!u.isRider, isCarrier: !!u.isCarrier, createdAt: u.createdAt, emailVerified: !!u.emailVerified, phoneVerified: !!u.phoneVerified })) });
}
function tempPassword() { const pick = (s) => s[crypto.randomInt(s.length)], U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnpqrstuvwxyz", D = "23456789", S = "!@#$%&*"; for (;;) { const a = [pick(U), pick(U), pick(U), pick(L), pick(L), pick(L), pick(L), pick(D), pick(D), pick(D), pick(S), pick(S)]; for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } const p = a.join(""); if (!passwordPolicy.problems(p, []).length) return p; } }
async function adminResetPassword(req, res, m) { // the way back in for someone who forgot their password while codes are off — check who they are BEFORE doing this (e.g. call them on the number they registered with)
  if (!requireAdmin(req, res)) return; const u = userById(m[1]); if (!u) return sendJSON(res, 404, { error: "No such user." }); const tmp = tempPassword();
  await store.mutate("users", (all) => all.map((x) => (x.id === u.id ? { ...x, passwordHash: hashPassword(tmp) } : x))); sessionsFrom.set(u.id, Date.now()); for (const k of ["lp:" + u.phone, "le:" + String(u.email || "").toLowerCase()]) attempts.delete(k);
  tellPasswordChanged(u); await evt("admin", "password_reset", null, "processed", u.name); sendJSON(res, 200, { ok: true, temporary: tmp });
}
async function adminNotifyTest(req, res) { // send a real test code to your own phone / email to prove the provider works
  if (!requireAdmin(req, res)) return; const b = await readBody(req), ch = clean(b.channel, 8);
  if (ch === "sms") { const to = String(b.to || "").replace(/[\s()-]/g, ""); if (!dial.validE164(to)) return sendJSON(res, 400, { error: "Enter your number with the country code, e.g. +254712345678." }); const r = await notify.sendSms(to, notify.codeSms("123456")); if (r && r.ok) await markCommsOk("sms"); return sendJSON(res, 200, r); }
  if (ch === "email") { const to = clean(b.to, 120).toLowerCase(); if (!emailOk(to)) return sendJSON(res, 400, { error: "Enter a valid email address." }); const m = notify.codeEmail("123456", "test"); const r = await notify.sendEmail(to, m.subject, m.text); if (r && r.ok) await markCommsOk("email"); return sendJSON(res, 200, r); }
  sendJSON(res, 400, { error: "channel must be sms or email." });
}
async function adminCoverage(req, res, m, url) { // what can a buyer in ANY country use right now?
  if (!requireAdmin(req, res)) return; const cc = clean(url.searchParams.get("country"), 2).toUpperCase(), c = payments.cfg;
  const r = coverage.coverageFor(cc, { mp2: c.mpesa(), fw: c.flutterwave(), st: c.stripe(), wr: c.wire(), cr: c.nowpayments(), pyp: c.paypal() }, { flw: payments.FLW_CURRENCIES(), paypal: payments.PAYPAL_CURRENCIES() });
  if (!r) return sendJSON(res, 404, { error: "Unknown country." }); sendJSON(res, 200, r);
}
async function adminReadiness(req, res) {
  if (!requireAdmin(req, res)) return; const base = baseUrl(), c = payments.cfg, checks = [], add = (id, level, text) => checks.push({ id, level, text });
  const mp = process.env.MPESA_ENV || "sandbox", modes = { flutterwave: c.flutterwave() ? keyMode("flutterwave") : null, stripe: c.stripe() ? keyMode("stripe") : null, jenga: c.jenga() ? (process.env.JENGA_ENV === "production" ? "live" : "test") : null, fincra: c.fincra() ? (fincra.isLive() ? "live" : "test") : null, paystack: c.paystack() ? (paystack.isLive() ? "live" : "test") : null, mpesa: c.mpesa() ? (mp === "production" ? "live" : "test") : null }, real = c.flutterwave() || c.stripe() || c.nowpayments() || c.mpesa() || (c.fincra() && fincra.isLive()) || (c.paystack() && paystack.isLive());
  if (!base) add("base", "error", "PUBLIC_BASE_URL isn't set — payment providers can't send confirmations back to you."); else if (isLocalUrl(base)) add("base", real ? "error" : "warn", "PUBLIC_BASE_URL points at this computer — providers on the internet can't reach it. Deploy with a public https:// address (or use a tunnel while testing)."); else if (!base.startsWith("https://")) add("base", "error", "PUBLIC_BASE_URL must start with https:// — providers refuse plain-http callbacks."); else add("base", "ok", "Public address: " + base);
  { const ap = adminPathStatus(), ips = String(process.env.ADMIN_ALLOWED_IPS || "").trim(), shown = ap.state === "secret" || !!ips; add("adminpage", shown ? "ok" : ap.state === "default" && base.startsWith("https://") ? "warn" : ap.state === "default" ? "ok" : "warn", ap.state === "secret" ? `Admin page hidden: it is at ${ap.path}, and /admin.html says “Not found”.${ips ? " Only your allowed addresses can reach it." : ""}` : ips ? "Admin page limited to your allowed addresses (ADMIN_ALLOWED_IPS)." : ap.state === "default" ? "The admin sign-in page is public at /admin.html (it needs the admin password). Set ADMIN_PATH to a secret address and/or ADMIN_ALLOWED_IPS." : ap.message); }
  const at = process.env.ADMIN_TOKEN || ""; add("admin", !at ? "error" : at.length < 16 ? "warn" : "ok", !at ? "ADMIN_TOKEN isn't set — the Operations console is disabled." : at.length < 16 ? "ADMIN_TOKEN is short — use at least 16 random characters (it protects refunds and company documents)." : "ADMIN_TOKEN is strong enough.");
  if (c.paystack()) add("paystack", paystack.isLive() && !paystack.payoutsOn() ? "warn" : "ok", paystack.isLive() ? (paystack.payoutsOn() ? "Paystack is LIVE: PIN prompts and automatic M-Pesa payouts are on." : "Paystack is LIVE for collections, but automatic payouts are OFF — sellers and riders are paid by hand until you switch them on (after one small real payout).") : "Paystack is on a TEST key: nothing here moves real money.");
  if (c.fincra()) add("fincra", fincra.isLive() && !fincra.payoutsOn() ? "warn" : "ok", fincra.isLive() ? (fincra.payoutsOn() ? "Fincra is LIVE: PIN prompts and automatic M-Pesa payouts are on." : "Fincra is LIVE for collections, but automatic payouts are OFF — sellers and riders are paid by hand until you switch them on (after one small real payout).") : "Fincra is in SANDBOX mode: nothing here moves real money.");
  add("secret", process.env.SERVER_SECRET ? "ok" : "warn", process.env.SERVER_SECRET ? "SERVER_SECRET is set (logins survive restarts)." : "SERVER_SECRET isn't set — everyone is logged out on every restart, and tokens are weaker. Set a long random value.");
  if (process.env.DEV_PAYMENTS === "1") add("dev", c.test() ? "warn" : "ok", c.test() ? "TEST payments are ON (local only). Turn DEV_PAYMENTS off before real users arrive." : "DEV_PAYMENTS is set but ignored on a public address — good. Remove it from your settings anyway.");
  { const sp = notify.smsProvider(), ep = notify.emailProvider(), dev = notify.devAllowed();
    if (!codesOn()) { const mode = codesMode(), missing = [!sp && "an SMS provider", !ep && "an email provider", sp && !commsVerified("sms") && "a successful SMS test", ep && !commsVerified("email") && "a successful email test"].filter(Boolean); add("codes", "warn", mode === "off" ? "Sign-in codes are forced OFF (VERIFY_CODES=0): phone numbers and emails are NOT verified and logins need only a password." : `Sign-in codes are OFF for now: phone numbers and emails are NOT verified, and logins need only a password. They switch ON by themselves once both providers are connected and tested — still missing: ${missing.join(", ")}. (Payment setup → SMS / Email → "Send a test … to me".)`); add("email", ep ? "ok" : "warn", ep ? `Receipts are emailed through ${ep === "resend" ? "Resend" : "SendGrid"}.` : "No email provider: users can't be emailed their receipts yet. Add Resend under Payment setup → Email."); }
    else { add("sms", sp ? "ok" : dev ? "warn" : "error", sp ? `SMS codes are sent through ${sp === "africastalking" ? "Africa's Talking" : "Twilio"}.` : dev ? "No SMS provider: codes are only shown on screen / in the server log (local testing)." : "No SMS provider is connected — nobody can sign up or log in, because every login needs a code. Add Africa's Talking or Twilio under Payment setup.");
    add("email", ep ? "ok" : dev ? "warn" : "error", ep ? `Email codes are sent through ${ep === "resend" ? "Resend" : "SendGrid"}.` : dev ? "No email provider: codes are only shown on screen / in the server log (local testing)." : "No email provider is connected — nobody can sign up or log in. Add Resend or SendGrid under Payment setup.");
    if (process.env.DEV_OTP === "1") add("devotp", dev ? "warn" : "ok", dev ? "DEV_OTP is on: codes appear on screen for anyone. Local testing only — switch it off before real users arrive." : "DEV_OTP is set but ignored on a public address — good. Remove it from your settings anyway."); } }
  const names = [["Equity (Jenga)", c.jenga()], ["Flutterwave", c.flutterwave()], ["Stripe", c.stripe()], ["M-Pesa", c.mpesa()], ["Crypto", c.nowpayments()]].filter((x) => x[1]).map((x) => x[0]);
  add("providers", real ? "ok" : c.test() ? "warn" : "error", real ? "Connected for collecting payments: " + names.join(", ") : c.test() ? "Only the fake test sandbox is available — nobody can pay for real." : "No payment provider is connected, so nobody can pay.");
  const live = Object.entries(modes).filter(([, m]) => m === "live").map(([k]) => k), test = Object.entries(modes).filter(([, m]) => m === "test").map(([k]) => k);
  if (test.length && !isLocalUrl(base)) add("testkeys", "warn", `TEST keys in use for: ${test.join(", ")}. Customers' payments through these are not real money — swap in live keys when you're ready.`); if (live.length && test.length) add("mixed", "warn", "You're mixing live and test providers.");
  if (live.length && !(base.startsWith("https://") && !isLocalUrl(base))) add("livebase", "error", "A LIVE provider is configured but the public address isn't https — live payments can't be confirmed.");
  add("payouts", mpesa.isPayoutConfigured() || c.flutterwave() ? "ok" : "warn", mpesa.isPayoutConfigured() || c.flutterwave() ? "An automatic payout rail is connected (sellers and riders are paid without anyone clicking)." : "No automatic payout rail is connected — sellers and riders would have to be paid by hand.");
  if (c.mpesa() && !/^https:\/\//.test(process.env.MPESA_CALLBACK_BASE_URL || "")) add("mpesacb", "error", "MPESA_CALLBACK_BASE_URL must be an https:// address — Safaricom rejects http callbacks in production.");
  add("backup", backup.state.last ? "ok" : "warn", backup.state.last ? "Last automatic backup: " + backup.state.last + ". Copy the backup folder off this machine regularly." : "No backup has run yet." + (backup.state.error ? " Error: " + backup.state.error : ""));
  const cm = Number(process.env.PLATFORM_COMMISSION_PERCENT || 7), need = Math.round((economics.targetPct() + economics.assumedCostPct()) * 10) / 10; add("commission", cm >= need ? "ok" : "warn", `Platform commission is ${cm}%. After typical payment, payout and coin costs (about ${Math.round(economics.assumedCostPct() * 10) / 10}%), a net of ${economics.targetPct()}% needs about ${need}%. Operations → Economics shows the real figure once orders complete.`);
  add("cap", "ok", Number(process.env.MAX_ORDER_USD || 0) > 0 ? `Order size is limited to about USD ${process.env.MAX_ORDER_USD} (MAX_ORDER_USD). Remove that line from your settings for no limit.` : "No limit on the size of an order. (If you ever want one, set MAX_ORDER_USD.)");
  { const fm = process.env.FX_MARGIN_PERCENT == null || process.env.FX_MARGIN_PERCENT === "" ? 2 : Number(process.env.FX_MARGIN_PERCENT); add("fx", fm >= 1 ? "ok" : "warn", `Currency buffer: ${fm}% is added when a buyer is charged in a different currency from the listing, so exchange-rate moves don't leave you short of what you owe sellers.` + (fm >= 1 ? "" : " Consider at least 1–2% (FX_MARGIN_PERCENT).")); }
  const U = (p) => (base ? base + p : "(set PUBLIC_BASE_URL first)" + p), cb = (process.env.MPESA_CALLBACK_BASE_URL || base || "").replace(/\/$/, "");
  const miss = (ks) => ks.filter((k) => !process.env[k]), payBillOnly = !c.jenga() && !c.mpesa() && !c.flutterwave() && payments.manualKind() === "equity", fw = c.flutterwave(), mp2 = c.mpesa(), jg = c.jenga(), st = c.stripe(), wr = c.wire(), cr = c.nowpayments(), pyp = c.paypal(), pick = (...xs) => xs.filter(Boolean).join(" + ") || null;
  const methods = [
    { id: "mpesa", icon: "🇰🇪", label: "M-Pesa & mobile money", partial: payBillOnly, ready: mp2 || fw || jg || payBillOnly, via: pick(jg && "Equity Bank (Jenga)", !jg && mp2 && "M-Pesa (Daraja)", !jg && !mp2 && fw && "Flutterwave", payBillOnly && "Equity Pay Bill 247247 — you confirm each payment by hand until the Equity API is connected"), mode: jg ? modes.jenga : mp2 ? modes.mpesa : fw ? modes.flutterwave : null, buyers: "Pays with a PIN prompt on their phone or by Pay Bill — M-Pesa, Airtel Money, Equitel (T-Kash once Equity confirms it).", needs: mp2 || fw || jg ? [] : ["Equity Bank (Jenga): " + (miss(["JENGA_MERCHANT_CODE", "JENGA_CONSUMER_SECRET", "JENGA_API_KEY", "JENGA_ACCOUNT_NUMBER", "JENGA_PRIVATE_KEY", "PUBLIC_BASE_URL"]).join(", ") || "complete"), "Flutterwave: " + (miss(["FLW_SECRET_KEY", "FLW_SECRET_HASH", "PUBLIC_BASE_URL"]).join(", ") || "complete"), "or M-Pesa (Daraja): " + (miss(["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "MPESA_CALLBACK_BASE_URL"]).join(", ") || "complete")] },
    { id: "momo", icon: "📱", label: "Mobile money", ready: fw, via: pick(fw && "Flutterwave"), mode: fw ? modes.flutterwave : null, buyers: "Pays with a prompt on their phone (MTN, Airtel, Orange, Vodacom…) in the African countries Flutterwave covers — shown to buyers there instead of M-Pesa.", needs: fw ? [] : ["Flutterwave: " + (miss(["FLW_SECRET_KEY", "FLW_SECRET_HASH", "PUBLIC_BASE_URL"]).join(", ") || "complete")] },
    { id: "card", icon: "💳", label: "Card", ready: fw || st, via: pick(st && "Stripe", !st && fw && "Flutterwave"), mode: st ? modes.stripe : fw ? modes.flutterwave : null, buyers: "Visa / Mastercard, including cards issued in the USA (USD must be enabled on the provider account).", needs: fw || st ? [] : ["Flutterwave: " + (miss(["FLW_SECRET_KEY", "FLW_SECRET_HASH", "PUBLIC_BASE_URL"]).join(", ") || "complete")] },
    { id: "paypal", icon: "🅿️", label: "PayPal", ready: pyp, via: pick(pyp && "PayPal"), mode: pyp ? (process.env.PAYPAL_ENV === "live" ? "live" : "test") : null, buyers: "Pays with a PayPal balance or card — familiar to buyers in the USA, Europe and Brazil.", needs: pyp ? [] : ["PayPal: " + (miss(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PUBLIC_BASE_URL"]).join(", ") || "complete")] },
    { id: "international", icon: "🌍", label: "International payment", ready: fw || st || wr, via: pick(fw && "secure page (Flutterwave)", st && "secure page (Stripe)", wr && "bank transfer (wire / ACH)"), mode: null, buyers: "Pays from abroad on a secure page and/or by bank transfer (wire / ACH). A transfer is held for the order only once the money has arrived.", needs: fw || st || wr ? [] : ["Flutterwave: " + (miss(["FLW_SECRET_KEY", "FLW_SECRET_HASH", "PUBLIC_BASE_URL"]).join(", ") || "complete"), "and/or bank transfer: " + (miss(["WIRE_ACCOUNT_NAME", "WIRE_BANK_NAME", "WIRE_ACCOUNT_NUMBER"]).concat(process.env.WIRE_SWIFT || process.env.WIRE_ROUTING ? [] : ["WIRE_SWIFT or WIRE_ROUTING"]).join(", ") || "complete")] },
    { id: "crypto", icon: "₿", label: "Crypto / stablecoin", ready: cr, via: pick(cr && "NOWPayments"), mode: null, buyers: "Pays with USDT, USDC, BTC and others. Crypto payments are final, so refunds are manual.", needs: cr ? [] : ["NOWPayments: " + (miss(["NOWPAYMENTS_API_KEY", "NOWPAYMENTS_IPN_SECRET", "PUBLIC_BASE_URL"]).join(", ") || "complete")] }];
  sendJSON(res, 200, { ready: !checks.some((x) => x.level === "error"), checks, comms: { sms: { configured: !!notify.smsProvider(), provider: notify.smsProvider(), tips: [["Africa's Talking", "Create an account at africastalking.com → Settings → API key. Start in the Sandbox, then go live and top up your credit."], ["Twilio", "twilio.com → Console: Account SID + Auth Token, plus a sending number."], ["Sender name", "Optional: ask your provider to approve a short sender name (e.g. SOKONI) so codes show a name instead of a number."]] }, email: { configured: !!notify.emailProvider(), provider: notify.emailProvider(), tips: [["Resend", "resend.com → add your domain → add the DNS records it gives you → create an API key."], ["SendGrid", "sendgrid.com → Sender Authentication → verify your domain → create an API key."], ["From address", "Must be on a domain you verified, e.g. Sokoni <no-reply@your-domain.com>. Otherwise messages are rejected or land in spam."]] } }, methods, worldRegions: coverage.summary({ mp2, fw, st, wr, cr, pyp }, { flw: payments.FLW_CURRENCIES(), paypal: payments.PAYPAL_CURRENCIES() }), providers: [
    { id: "flutterwave", name: "Flutterwave", configured: c.flutterwave(), mode: modes.flutterwave, does: "Collects: cards, M-Pesa and other mobile money, bank transfer. Pays out: M-Pesa and bank transfers.", steps: [["Webhook URL", U("/api/webhooks/flutterwave")], ["Secret hash", "Dashboard → Settings → Webhooks: set the secret hash to exactly the value of FLW_SECRET_HASH"]] },
    { id: "paystack", name: "Paystack", configured: c.paystack(), mode: modes.paystack, does: "Collects: M-Pesa and Airtel Money PIN prompts into your Paystack balance. Pays out: M-Pesa wallets (" + (paystack.payoutsOn() ? "ON" : "off — switch on after a small live test") + ").", steps: [["Webhook URL", paystack.urls().webhook || "(set PUBLIC_BASE_URL first)"], ["Where to save it", "Paystack dashboard → Settings → API Keys & Webhooks: paste it into Test Webhook URL (and later Live Webhook URL), then Save changes. Paystack signs notifications with your secret key — there is no separate webhook secret."], ["Keep the money until delivery", "Paystack dashboard → Settings → Preferences / Payouts: switch to manual payouts (money stays in your balance). Collected money becomes payable about 2 days later."], ["Payouts without a code", "Preferences → untick “Confirm transfers before sending”, or payouts wait for a one-time code. Protect your secret key and add this server's IP to the IP Whitelist."], ["Networks", "Airtel Money prompts are on (Paystack provider atl); set PROMPT_NETWORKS to mpesa (Equity card) to switch them off. Equitel and T-Kash are not offered through Paystack."]] },
    { id: "fincra", name: "Fincra", configured: c.fincra(), mode: modes.fincra, does: "Collects: M-Pesa, Airtel Money and Equitel PIN prompts into your Fincra wallet. Pays out: M-Pesa wallets (" + (fincra.payoutsOn() ? "ON" : "off — switch on after a small live test") + ").", steps: [["Webhook URL", fincra.urls().webhook || "(set PUBLIC_BASE_URL first)"], ["Webhook secret", "Fincra dashboard → Settings → API: copy the webhook secret key into the Webhook secret key box here"], ["IP address", "Fincra dashboard → Settings → API: whitelist THIS server's public IP address, or every call is refused"], ["Networks", "Airtel Money and Equitel prompts are off until you add them to PROMPT_NETWORKS (Equity card) — test each in the sandbox first"]] },
    { id: "jenga", name: "Equity Bank (Jenga)", configured: c.jenga(), mode: modes.jenga, does: "Collects: an M-Pesa PIN prompt settled in real time into your Equity account. Pays out: M-Pesa wallets (" + (jenga.payoutsOn() ? "ON" : "off — switch on only after a small live test") + ").", steps: [["Payment callback", jenga.urls().stk], ["Payout callback", jenga.urls().payout], ["Public key", "Operations → Payment setup → Equity Bank → Generate signing keys, then upload it in the Jenga console"]] },
    { id: "mpesa", name: "M-Pesa (Safaricom Daraja)", configured: c.mpesa(), mode: modes.mpesa, does: "Collects: M-Pesa STK push straight into your own Paybill/Till. Pays out: B2C" + (mpesa.isPayoutConfigured() ? " (configured)." : " (not configured)."), steps: [["Paybill payments — confirmation URL", c2bUrls().confirmation], ["Paybill payments — validation URL", c2bUrls().validation], ["STK callback", cb + "/api/mpesa/stk-callback"], ["B2C result URL", cb + "/api/mpesa/b2c-callback"], ["B2C timeout URL", cb + "/api/mpesa/b2c-timeout"]] },
    { id: "stripe", name: "Stripe", configured: c.stripe(), mode: modes.stripe, does: "Collects: cards and local methods. Note: Kenyan businesses can't open a direct Stripe account (Kenya is on Stripe's extended network).", steps: [["Webhook URL", U("/api/webhooks/stripe")], ["Events to send", "checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed"], ["Signing secret", "Put the endpoint's signing secret in STRIPE_WEBHOOK_SECRET"]] },
    { id: "wire", name: "International bank transfer (wire / ACH)", configured: c.wire(), mode: null, does: "Collects: USD/EUR/GBP bank transfers from abroad into YOUR bank, Wise or Payoneer account. The buyer gets your details and a unique reference; the order is held once the money has arrived.", steps: [["Arrival notification URL (optional, automatic)", U("/api/webhooks/wire")], ["How to call it", "POST JSON {reference, amount, currency, bankReference} with header x-sokoni-signature = hex HMAC-SHA256 of the raw body, keyed with your arrival-notification secret"], ["Without that", "Confirm arrivals yourself under Payments → Bank transfers"]] },
    { id: "paypal", name: "PayPal", configured: c.paypal(), mode: c.paypal() ? (process.env.PAYPAL_ENV === "live" ? "live" : "test") : null, does: "Collects: PayPal balance and cards from buyers in the USA, Europe, Brazil and ~200 markets. Fees are higher than card rails and new business accounts can have payout holds — good as an extra option, not your only one.", steps: [["Webhook URL", U("/api/webhooks/paypal")], ["Events to send", "CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.DENIED"], ["Webhook ID", "Optional but recommended: paste the new webhook's ID into Payment setup so signatures are verified too"]] },
    { id: "nowpayments", name: "Crypto (NOWPayments)", configured: c.nowpayments(), mode: null, does: "Collects: crypto and stablecoins (payments are final — refunds are manual).", steps: [["IPN callback URL", U("/api/webhooks/crypto")], ["IPN secret", "Dashboard → Store settings: use the same value as NOWPAYMENTS_IPN_SECRET"]] }] });
}
async function adminProviderTest(req, res) { if (!requireAdmin(req, res)) return; const b = await readBody(req), pid = clean(b.provider, 20);
  if (pid === "ai") { if (!ai.configured()) return sendJSON(res, 200, { ok: false, error: "No AI key yet — paste it above and press Save first." }); const r = await ai.selfTest(); return sendJSON(res, 200, r.ok ? { ok: true, detail: `The AI answered (model ${ai.model()}). Quality reports, the price guide, weight estimates and translations are on.` } : { ok: false, error: ai.explain(r.error) }); }
  sendJSON(res, 200, await payments.testConnection(pid)); }
const csvCell = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
async function adminExportPayments(req, res, m, url) { // for your accountant and for matching against provider statements
  if (!requireAdmin(req, res)) return; const from = url.searchParams.get("from") || "0000", to = url.searchParams.get("to") || "9999", dels = new Map(store.readAll("deliveries").map((d) => [d.id, d]));
  const head = ["created", "order_id", "product", "quantity", "unit", "buyer", "buyer_country", "seller", "seller_country", "currency", "produce_amount", "delivery_fee", "total_charged", "charged_currency", "charged_amount", "fx_rate", "platform_commission", "seller_payout", "payment_provider", "payment_method", "provider_payment_id", "payment_status", "paid_into_escrow_at", "release_reason", "seller_payout_route", "seller_payout_ref", "seller_paid_at", "rider_payout_status", "rider_payout_ref"];
  const rows = store.readAll("orders").filter((o) => o.paymentStatus !== "unpaid" && o.createdAt >= from && o.createdAt <= to + "~").sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map((o) => { const d = o.deliveryId ? dels.get(o.deliveryId) : null;
    return [o.createdAt, o.id, o.crop, o.quantityWanted, o.unit, o.buyerName, o.buyerCountry, o.farmerName, o.farmerCountry, o.currency, o.amount, o.deliveryFee || 0, o.total != null ? o.total : o.amount, o.chargeCurrency || o.currency, o.chargeAmount != null ? o.chargeAmount : (o.total != null ? o.total : o.amount), o.fxRate || 1, o.commission, o.sellerPayout, o.paymentProvider, o.paymentMethod, o.providerPaymentId, o.paymentStatus, o.escrowedAt, o.releaseReason, o.payoutRoute, o.payoutRef, o.paidOutAt, d && d.riderPayoutStatus, d && d.riderPayoutRef].map(csvCell).join(","); });
  res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="sokoni-payments.csv"', "Cache-Control": "no-store" }); res.end([head.join(","), ...rows].join("\n"));
}
async function health(req, res) { try { fs.accessSync(path.dirname(PRIVATE_DIR), fs.constants.W_OK); sendJSON(res, 200, { ok: true, uptimeSec: Math.round(process.uptime()) }); } catch (e) { sendJSON(res, 503, { ok: false, error: "data folder not writable" }); } }
async function adminProviders(req, res) {
  if (!requireAdmin(req, res)) return; const c = payments.cfg;
  sendJSON(res, 200, { providers: [{ id: "Paystack", on: c.paystack(), payout: paystack.payoutsOn() }, { id: "Fincra", on: c.fincra(), payout: fincra.payoutsOn() }, { id: "M-Pesa (Daraja)", on: c.mpesa(), payout: mpesa.isPayoutConfigured() }, { id: "Flutterwave", on: c.flutterwave(), payout: c.flutterwave() }, { id: "Stripe", on: c.stripe(), payout: false }, { id: "Crypto (NOWPayments)", on: c.nowpayments(), payout: false }, { id: "Test sandbox (DEV_PAYMENTS)", on: c.test(), payout: c.test() }],
    ai: { configured: ai.configured(), vision: vision.isConfigured(), model: ai.model(), last: ai.last }, places: process.env.GEONAMES_USERNAME ? "geonames" : "photon (keyless fallback)", sharp: trust.hasSharp, blockedCountries: [...BLOCKED] });
}

// ---------- local delivery: the system dispatches (offer → accept), everyone sees live progress, the rider is paid instantly ----------
const OFFER_MS = Number(process.env.OFFER_SECONDS || 60) * 1000, ROAD_FACTOR = Number(process.env.ROAD_FACTOR || 1.3), STALE_MS = 120000;
const FALLBACK_USD = { KES: 129, UGX: 3700, TZS: 2600, RWF: 1400, ETB: 120, NGN: 1550, GHS: 15, ZAR: 18, ZMW: 27, MWK: 1750, EGP: 49, MAD: 10, XOF: 600, XAF: 600, EUR: 0.92, GBP: 0.78, INR: 84, USD: 1 }; // used only if live FX is unavailable
async function rideFee(km, currency) {
  const usd = RIDER_BASE_USD + RIDER_PER_KM_USD * (Number.isFinite(km) ? km : 0); const r = currency === "USD" ? 1 : (await fx.rate("USD", currency)) || FALLBACK_USD[currency] || null; if (!r) return null;
  return { amount: geo.roundMoney(usd * r, currency), currency };
}
async function quoteDelivery(listing, buyer, lat, lng, qty) { // → { error } | { km, fee (what the BUYER pays), total (the whole fee), sellerShare, weightKg, vehicle }
  if (listing.country !== buyer.country) return { error: "Local rider delivery is only available within the same country. For cross-border orders, request freight quotes instead." };
  if (listing.lat == null || listing.lng == null) return { error: "This seller hasn't set a pickup location, so a rider can't be sent. Choose to collect it instead." };
  if (lat == null || lng == null) return { error: "Share your delivery location first." };
  const km = Math.round(haversineKm(listing.lat, listing.lng, lat, lng) * ROAD_FACTOR * 10) / 10, q = Number(qty) > 0 ? Number(qty) : 1;
  const w = delivery.weight({ crop: listing.crop, unit: listing.unit, quantity: q, unitKg: listing.unitKg }), p = delivery.priceUsd({ km, weightKg: w.weightKg, temperature: listing.temperature, crop: listing.crop }); if (p.error) return { error: p.error };
  const r = listing.currency === "USD" ? 1 : (await fx.rate("USD", listing.currency)) || FALLBACK_USD[listing.currency] || null; if (!r) return { error: "Delivery isn't available for this currency right now." };
  const total = geo.roundMoney(p.usd * r, listing.currency), sh = delivery.split(total, geo.roundMoney(q * listing.pricePerUnit, listing.currency), listing.currency);
  return { km, fee: sh.buyer, total, sellerShare: sh.seller, currency: listing.currency, weightKg: w.weightKg, vehicle: p.vehicle };
}
async function deliveryQuote(req, res, m, url) {
  const u = requireAuth(req, res); if (!u) return; const buyer = userById(u.id), l = store.readAll("listings").find((x) => x.id === clean(url.searchParams.get("listingId"), 80)); if (!l || !buyer) return sendJSON(res, 404, { error: "Listing not found." });
  const q = await quoteDelivery(l, buyer, num(url.searchParams.get("lat")), num(url.searchParams.get("lng")), num(url.searchParams.get("qty"))); if (q.error) return sendJSON(res, 400, { error: q.error }); sendJSON(res, 200, { distanceKm: q.km, fee: q.fee, total: q.total, sellerShare: q.sellerShare, currency: q.currency, weightKg: q.weightKg, vehicle: q.vehicle });
}
async function createLocalDelivery(o) { // called automatically once the payment is held
  if (o.deliveryId || o.deliveryMode !== "rider" || !o.dropoff) return null; const l = store.readAll("listings").find((x) => x.id === o.listingId); if (!l || l.lat == null) return null;
  const d = { id: id(), orderId: o.id, farmerId: o.farmerId, buyerId: o.buyerId, country: l.country, pickupLat: l.lat, pickupLng: l.lng, pickupLocationText: l.location, dropoffLat: o.dropoff.lat, dropoffLng: o.dropoff.lng, dropoffLocationText: o.dropoff.text || "", distanceKm: o.deliveryDistanceKm, feeAmount: delivery.riderPay(o.deliveryTotal != null ? o.deliveryTotal : o.deliveryFee, o.currency), feeCurrency: o.currency, weightKg: o.deliveryWeightKg || null, minVehicle: o.deliveryVehicle || null, strictVehicle: !!delivery.minVehicleFor(o.crop),
    status: "searching", riderId: null, riderName: null, vehicleType: null, offeredTo: null, offerExpiresAt: null, declinedBy: [], offerRound: 0, lastOfferAt: null, createdAt: now(), assignedAt: null, pickedUpAt: null, deliveredAt: null, riderPayoutStatus: null };
  await store.mutate("deliveries", (all) => [...all, d]); await patchOrder(o.id, { deliveryId: d.id, deliveryStatus: "searching" }); await dispatchDelivery(d); return d;
}
async function dispatchDelivery(d0) { // offer the job to the nearest online, free rider who hasn't declined it
  let d = store.readAll("deliveries").find((x) => x.id === d0.id); if (!d || d.status !== "searching") return d;
  const pick = (skip) => { let best = null, bd = Infinity; for (const r of store.readAll("rider_status")) { if (!r.online || r.currentDeliveryId || r.offerDeliveryId || r.lat == null || skip.includes(r.riderId)) continue; if (d.minVehicle && !delivery.canCarry((userById(r.riderId) || {}).vehicleType, d.weightKg, d.distanceKm, d.minVehicle, d.strictVehicle)) continue; if (Date.now() - new Date(r.updatedAt || 0).getTime() > STALE_MS) continue; const dist = haversineKm(d.pickupLat, d.pickupLng, r.lat, r.lng); if (dist <= RIDER_RADIUS_KM && dist < bd) { best = r; bd = dist; } } return best ? { best, bd } : null; };
  let c = pick(d.declinedBy || []);
  if (!c && (d.declinedBy || []).length && d.lastOfferAt && Date.now() - new Date(d.lastOfferAt).getTime() > 5 * 60000) { c = pick([]); if (c) await store.mutate("deliveries", (all) => all.map((x) => (x.id === d.id ? { ...x, declinedBy: [] } : x))); } // everyone said no a while ago: ask again
  if (!c) return d; let out = null;
  await store.mutate("deliveries", (all) => all.map((x) => { if (x.id !== d.id || x.status !== "searching") return x; out = { ...x, status: "offered", offeredTo: c.best.riderId, offerExpiresAt: new Date(Date.now() + OFFER_MS).toISOString(), lastOfferAt: now(), offerRound: (x.offerRound || 0) + 1 }; return out; }));
  if (!out) return d; await store.mutate("rider_status", (all) => all.map((r) => (r.riderId === c.best.riderId ? { ...r, offerDeliveryId: out.id } : r))); await patchOrder(out.orderId, { deliveryStatus: "offered" }); pushTo(c.best.riderId, { title: "New delivery offer", body: `${out.pickupLocationText || "Pickup"} → ${out.dropoffLocationText || "drop-off"} · ${out.distanceKm} km · ${out.feeCurrency} ${out.feeAmount}`, url: "/?tab=deliver", urgent: true, tag: "offer-" + out.id }); await evt("dispatch", "offer", out.orderId, "processed", `offered to the nearest rider (${c.bd.toFixed(1)} km away)`); return out;
}
async function releaseOffer(did, riderId, why) { // the rider declined, or didn't answer in time
  let out = null; await store.mutate("deliveries", (all) => all.map((x) => { if (x.id !== did || x.status !== "offered" || x.offeredTo !== riderId) return x; out = { ...x, status: "searching", offeredTo: null, offerExpiresAt: null, declinedBy: [...(x.declinedBy || []), riderId] }; return out; }));
  await store.mutate("rider_status", (all) => all.map((r) => (r.riderId === riderId ? { ...r, offerDeliveryId: null } : r))); if (!out) return;
  await patchOrder(out.orderId, { deliveryStatus: "searching" }); await evt("dispatch", "offer_" + why, out.orderId, "processed", why); await dispatchDelivery(out);
}
async function dispatchSweep() { try { for (const d of store.readAll("deliveries")) { if (d.status === "offered" && new Date(d.offerExpiresAt).getTime() <= Date.now()) await releaseOffer(d.id, d.offeredTo, "timeout"); } for (const d of store.readAll("deliveries")) if (d.status === "searching") await dispatchDelivery(d); } catch (e) { console.error("dispatch", e.message); } }
async function riderAccept(req, res, m) {
  const u = requireRider(req, res); if (!u) return; const d = store.readAll("deliveries").find((x) => x.id === m[1]); if (!d || d.status !== "offered" || d.offeredTo !== u.id) return sendJSON(res, 400, { error: "This delivery isn't offered to you any more." });
  if (new Date(d.offerExpiresAt).getTime() <= Date.now()) { await releaseOffer(d.id, u.id, "timeout"); return sendJSON(res, 400, { error: "The offer expired." }); } const rider = userById(u.id); let out = null;
  await store.mutate("deliveries", (all) => all.map((x) => { if (x.id !== d.id) return x; out = { ...x, status: "assigned", riderId: u.id, riderName: rider.name, vehicleType: rider.vehicleType, assignedAt: now(), offeredTo: null, offerExpiresAt: null }; return out; }));
  await store.mutate("rider_status", (all) => all.map((r) => (r.riderId === u.id ? { ...r, currentDeliveryId: d.id, offerDeliveryId: null } : r))); await patchOrder(out.orderId, { deliveryStatus: "assigned" }); pushTo(out.buyerId, { title: "A rider is on the way", body: `${rider.name} will collect your order from the seller.`, url: "/?order=" + out.orderId, tag: "order-" + out.orderId }); await evt("dispatch", "accepted", out.orderId, "processed", rider.name); sendJSON(res, 200, { delivery: stripD(out) });
}
async function riderDecline(req, res, m) { const u = requireRider(req, res); if (!u) return; const d = store.readAll("deliveries").find((x) => x.id === m[1]); if (!d || d.status !== "offered" || d.offeredTo !== u.id) return sendJSON(res, 400, { error: "This delivery isn't offered to you any more." }); await releaseOffer(d.id, u.id, "declined"); sendJSON(res, 200, { ok: true }); }
async function getDelivery(req, res, m) {
  const u = requireAuth(req, res); if (!u) return; const d = store.readAll("deliveries").find((x) => x.id === m[1]);
  if (!d || ![d.farmerId, d.buyerId, d.riderId].includes(u.id)) return sendJSON(res, 403, { error: "You're not part of this delivery." });
  let riderLocation = null, progress = null;
  if (d.riderId && d.status !== "delivered") { const rs = store.readAll("rider_status").find((r) => r.riderId === d.riderId); if (rs && rs.lat != null) { riderLocation = { lat: rs.lat, lng: rs.lng, acc: rs.acc != null ? rs.acc : null, updatedAt: rs.updatedAt };
    const tgt = d.status === "assigned" ? { lat: d.pickupLat, lng: d.pickupLng, label: "pickup" } : { lat: d.dropoffLat, lng: d.dropoffLng, label: "dropoff" }; const km = haversineKm(rs.lat, rs.lng, tgt.lat, tgt.lng);
    progress = { target: tgt.label, distanceKm: Math.round(km * 10) / 10, distanceM: Math.round(km * 1000), etaMin: Math.max(1, Math.round(((km * ROAD_FACTOR) / 25) * 60)) }; } }
  sendJSON(res, 200, { delivery: stripD(d), riderLocation, progress });
}
async function riderOnline(req, res) {
  const u = requireRider(req, res); if (!u) return; const online = (await readBody(req)).online === true;
  if (online) { const me = userById(u.id), vs = me && me.vehicle && me.vehicle.verification; if (!vehicleVerified(me)) return sendJSON(res, 403, { error: !vs ? "Add your vehicle details and number-plate photo first (Account → Vehicle)." : vs.status === "rejected" ? vs.note || "Your vehicle photo wasn't accepted. Retake it under Account → Vehicle." : "Your vehicle is being reviewed — you can go online as soon as it's approved.", code: "VEHICLE_NOT_VERIFIED" }); }
  await store.mutate("rider_status", (all) => all.some((r) => r.riderId === u.id) ? all.map((r) => r.riderId === u.id ? { ...r, online, updatedAt: now() } : r) : [...all, { riderId: u.id, online, lat: null, lng: null, updatedAt: now(), currentDeliveryId: null, offerDeliveryId: null }]);
  const mine = store.readAll("rider_status").find((r) => r.riderId === u.id); if (!online && mine && mine.offerDeliveryId) await releaseOffer(mine.offerDeliveryId, u.id, "declined"); if (online) await dispatchSweep(); sendJSON(res, 200, { ok: true });
}
async function riderLocation(req, res) {
  const u = requireRider(req, res); if (!u) return; const b = await readBody(req); const lat = num(b.lat), lng = num(b.lng), acc = num(b.acc);
  if (lat == null || lng == null) return sendJSON(res, 400, { error: "lat and lng are required." });
  await store.mutate("rider_status", (all) => all.some((r) => r.riderId === u.id) ? all.map((r) => r.riderId === u.id ? { ...r, lat, lng, acc, updatedAt: now() } : r) : [...all, { riderId: u.id, online: true, lat, lng, acc, updatedAt: now(), currentDeliveryId: null, offerDeliveryId: null }]);
  await dispatchSweep(); sendJSON(res, 200, { ok: true });
}
async function riderDeliveries(req, res) {
  const u = requireRider(req, res); if (!u) return; const rs = store.readAll("rider_status").find((r) => r.riderId === u.id);
  const offers = store.readAll("deliveries").filter((d) => d.status === "offered" && d.offeredTo === u.id && new Date(d.offerExpiresAt).getTime() > Date.now()).map((d) => ({ id: d.id, pickupText: d.pickupLocationText, dropoffText: d.dropoffLocationText, distanceKm: d.distanceKm, toPickupKm: rs && rs.lat != null ? Math.round(haversineKm(rs.lat, rs.lng, d.pickupLat, d.pickupLng) * 10) / 10 : null, feeAmount: d.feeAmount, feeCurrency: d.feeCurrency, weightKg: d.weightKg || null, needs: d.minVehicle || null, expiresAt: d.offerExpiresAt, secondsLeft: Math.max(0, Math.round((new Date(d.offerExpiresAt).getTime() - Date.now()) / 1000)) }));
  sendJSON(res, 200, { offers, online: !!(rs && rs.online), deliveries: store.readAll("deliveries").filter((d) => d.riderId === u.id && !["delivered", "cancelled"].includes(d.status)).sort(byNewest).map(stripD) });
}
async function riderEarnings(req, res) {
  const u = requireRider(req, res); if (!u) return;
  const done = store.readAll("deliveries").filter((d) => d.riderId === u.id && d.status === "delivered").sort((a, b) => new Date(b.deliveredAt) - new Date(a.deliveredAt));
  const totals = {}, pending = {}; done.forEach((d) => { const bucket = d.riderPayoutStatus === "paid" ? totals : pending; bucket[d.feeCurrency] = geo.roundMoney((bucket[d.feeCurrency] || 0) + d.feeAmount, d.feeCurrency); });
  sendJSON(res, 200, { deliveries: done.map(stripD), totals, pending });
}
const riderItem = (d) => ({ id: d.id, ref: "SOKR-" + d.id, currency: d.feeCurrency, amount: d.feeAmount, narration: `Sokoni delivery ${d.id.slice(0, 8)}`, crop: "delivery" });
async function patchDelivery(did, p) { let out = null; await store.mutate("deliveries", (all) => all.map((x) => { if (x.id !== did) return x; out = { ...x, ...p }; return out; })); if (out) await ledgerSyncDelivery(out).catch((e) => console.error("ledger:", e.message)); return out; }
async function payRider(d0) { // instant, automatic: runs the moment the delivery code is confirmed
  const d = store.readAll("deliveries").find((x) => x.id === d0.id); if (!d || !d.riderId) return; const rider = userById(d.riderId); if (!rider) return;
  if (!(d.feeAmount > 0)) { await patchDelivery(d.id, { riderPayoutStatus: "paid", riderPaidAt: now() }); return; }
  if (!payouts.pick(riderItem(d), rider)) { await patchDelivery(d.id, { riderPayoutStatus: "pending", riderPayoutNote: rider.payout ? payouts.why(riderItem(d), rider) : "Add a payout method in Account to receive your delivery fee instantly.", riderPayoutManual: !!rider.payout, lastRiderPayoutAt: now() }); return; }
  try { const r = await payouts.pay(riderItem(d), rider);
    if (r.status === "completed") await patchDelivery(d.id, { riderPayoutStatus: "paid", riderPaidAt: now(), riderPayoutRoute: r.route, riderPayoutRef: r.ref, riderPayoutNote: null, riderWaitingFunds: false });
    else await patchDelivery(d.id, { riderPayoutStatus: "initiated", riderPayoutRoute: r.route, riderPayoutRef: r.ref, riderConversationId: r.conversationId || null, riderPayoutNote: null, lastRiderPayoutAt: now() });
    await evt(r.route, "rider_payout_sent", d.orderId, "processed", r.status);
  } catch (e) { console.error("rider payout", d.id, e.message);
    if (LOW_FUNDS.test(e.message)) { await patchDelivery(d.id, { riderPayoutStatus: "failed", riderPayoutError: e.message, riderWaitingFunds: true, riderWaitingSince: d.riderWaitingSince || now(), riderPayoutNote: "Your payout is being processed.", lastRiderPayoutAt: now() }); await evt("payout", "rider_payout_waiting_funds", d.orderId, "needs_review", "provider balance too low — will retry as funds settle"); return; }
    await patchDelivery(d.id, { riderPayoutStatus: "failed", riderPayoutError: e.message, riderPayoutAttempts: (d.riderPayoutAttempts || 0) + 1, lastRiderPayoutAt: now() }); await evt("payout", "rider_payout_failed", d.orderId, "failed", e.message); }
}
async function payRiderBacklog(uid) { for (const d of store.readAll("deliveries")) if (d.riderId === uid && ["pending", "failed"].includes(d.riderPayoutStatus)) await payRider(d); }
async function riderTransferResult(d, r) { if (r.ok) { await patchDelivery(d.id, { riderPayoutStatus: "paid", riderPaidAt: now(), riderPayoutNote: null }); await evt("payout", "rider_payout_completed", d.orderId, "processed", "transfer successful"); } else if (r.failed) { await patchDelivery(d.id, { riderPayoutStatus: "failed", riderPayoutError: r.message || "Transfer failed", riderPayoutAttempts: (d.riderPayoutAttempts || 0) + 1, lastRiderPayoutAt: now() }); await evt("payout", "rider_payout_failed", d.orderId, "failed", r.message || "failed"); } }
// Handover proof: the seller gives the rider a pickup code; the buyer gives the delivery code on receipt. The buyer's code also ACCEPTS the delivery,
// which releases the held funds to the seller automatically.
async function checkHandoverCode(order, kind, given) {
  if ((order.codeAttempts || 0) >= 6) return { ok: false, status: 429, error: "Too many wrong codes. Ask the buyer to open a dispute so we can help." };
  if (String(given || "").trim() === String(kind === "pickup" ? order.pickupCode : order.deliveryCode)) return { ok: true };
  await patchOrder(order.id, { codeAttempts: (order.codeAttempts || 0) + 1 }); return { ok: false, status: 400, error: "That code isn't right." };
}
async function updateDeliveryStatus(req, res, m) {
  const u = requireRider(req, res); if (!u) return; const b = await readBody(req);
  if (!["picked_up", "delivered"].includes(b.status)) return sendJSON(res, 400, { error: "Status must be 'picked_up' or 'delivered'." });
  const d0 = store.readAll("deliveries").find((d) => d.id === m[1] && d.riderId === u.id); if (!d0) return sendJSON(res, 403, { error: "You can only update your own assigned deliveries." });
  if ((b.status === "picked_up" && d0.status !== "assigned") || (b.status === "delivered" && d0.status !== "picked_up")) return sendJSON(res, 400, { error: "Update the steps in order: picked up, then delivered." });
  const order = store.readAll("orders").find((o) => o.id === d0.orderId); if (!order) return sendJSON(res, 404, { error: "Order not found." });
  const chk = await checkHandoverCode(order, b.status === "picked_up" ? "pickup" : "delivery", b.code); if (!chk.ok) return sendJSON(res, chk.status, { error: chk.error });
  const rs = store.readAll("rider_status").find((r) => r.riderId === u.id); let out = null;
  await store.mutate("deliveries", (all) => all.map((d) => { if (d.id !== m[1]) return d; out = { ...d, status: b.status, [b.status === "picked_up" ? "pickedUpAt" : "deliveredAt"]: now(), [b.status + "Evidence"]: { at: now(), lat: rs && rs.lat, lng: rs && rs.lng } }; return out; }));
  const patch = { deliveryStatus: b.status }; if (b.status === "delivered") patch.deliveredAt = now(); const upd = await patchOrder(order.id, patch); pushTo(order.buyerId, b.status === "delivered" ? { title: "Delivered", body: `Your ${order.crop} was delivered. Thank you for using Sokoni.`, url: "/?order=" + order.id, tag: "order-" + order.id } : { title: "Picked up", body: `Your ${order.crop} is on its way to you.`, url: "/?order=" + order.id, tag: "order-" + order.id });
  if (b.status === "delivered") { await store.mutate("rider_status", (all) => all.map((r) => r.riderId === u.id ? { ...r, currentDeliveryId: null } : r)); if (upd.paymentStatus === "escrowed" && !upd.disputed) await releaseOrder(upd, "delivery_code"); await payRider(out); }
  sendJSON(res, 200, { delivery: stripD(out) });
}

// ---------- freight: shipments, quotes, carriers (any mode, any country) ----------
const isParty = (s, uid) => s.farmerId === uid || s.buyerId === uid;
function shipmentView(s, viewerId) {
  const v = { ...s }; v.docChecklist = catalog.docChecklist({ international: s.originCountry !== s.destCountry, perishable: s.perishable, live: !!(catalog.cropInfo(s.crop) || {}).live });
  const seesPrivate = isParty(s, viewerId) || s.carrierId === viewerId;
  if (!seesPrivate) { delete v.pickupDetail; delete v.deliveryDetail; delete v.farmerId; delete v.buyerId; }
  return v;
}
async function requestFreight(req, res) {
  const a = requireAuth(req, res); if (!a) return; const b = await readBody(req);
  const o = store.readAll("orders").find((x) => x.id === clean(b.orderId, 80));
  if (!o || (o.buyerId !== a.id && o.farmerId !== a.id)) return sendJSON(res, 403, { error: "You're not part of this order." });
  if (o.status !== "accepted") return sendJSON(res, 400, { error: "The seller must accept the order before you request freight." });
  if (o.deliveryId || o.shipmentId) return sendJSON(res, 400, { error: "Delivery has already been requested for this order." });
  const l = store.readAll("listings").find((x) => x.id === o.listingId); const weight = num(b.weightKg);
  if (!weight || weight <= 0) return sendJSON(res, 400, { error: "Enter the approximate total weight in kg." });
  const pickupDetail = clean(b.pickupDetail, 300), deliveryDetail = clean(b.deliveryDetail, 300);
  if (!pickupDetail || !deliveryDetail) return sendJSON(res, 400, { error: "Enter the pickup and delivery addresses." });
  const info = catalog.cropInfo(o.crop);
  const s = { id: id(), orderId: o.id, farmerId: o.farmerId, buyerId: o.buyerId, crop: o.crop, perishable: !!(info && info.perishable), temperature: (l && l.temperature) || "ambient",
    originCountry: (l && l.country) || o.farmerCountry, destCountry: o.buyerCountry, originText: (l && l.location) || "", destText: clean(b.destText, 120), pickupDetail, deliveryDetail,
    weightKg: weight, modesPreferred: Array.isArray(b.modesPreferred) ? b.modesPreferred.filter((x) => catalog.MODE_IDS.has(x)) : [], incoterm: catalog.INCOTERM_IDS.has(b.incoterm) ? b.incoterm : o.incoterm,
    cargoNotes: maskContacts(clean(b.cargoNotes, 400)), status: "requesting_quotes", selectedQuoteId: null, carrierId: null, docs: {}, events: [], createdAt: now() };
  await store.mutate("shipments", (all) => [...all, s]); await patchOrder(o.id, { shipmentId: s.id, shipmentStatus: s.status });
  sendJSON(res, 201, { shipment: shipmentView(s, a.id) });
}
async function getShipment(req, res, m) {
  const u = requireAuth(req, res); if (!u) return; const s = store.readAll("shipments").find((x) => x.id === m[1]);
  if (!s) return sendJSON(res, 404, { error: "Shipment not found." });
  const quotes = store.readAll("quotes").filter((q) => q.shipmentId === s.id);
  const mineQuote = quotes.find((q) => q.carrierId === u.id);
  if (!isParty(s, u.id) && s.carrierId !== u.id && !mineQuote) return sendJSON(res, 403, { error: "You're not part of this shipment." });
  sendJSON(res, 200, { shipment: shipmentView(s, u.id), quotes: isParty(s, u.id) ? quotes.sort(byNewest) : (mineQuote ? [mineQuote] : []) });
}
async function carrierOpen(req, res) {
  const a = requireCarrier(req, res); if (!a) return; const me = userById(a.id); const quotes = store.readAll("quotes");
  const reefer = (me.modes || []).some((x) => catalog.MODE_BY_ID[x] && catalog.MODE_BY_ID[x].reefer);
  const rows = store.readAll("shipments").filter((s) => s.status === "requesting_quotes")
    .filter((s) => me.servesAll || ((me.servedCountries || []).includes(s.originCountry) && (me.servedCountries || []).includes(s.destCountry)))
    .filter((s) => !s.modesPreferred.length || s.modesPreferred.some((x) => (me.modes || []).includes(x)))
    .filter((s) => s.temperature === "ambient" || reefer).sort(byNewest)
    .map((s) => ({ shipment: shipmentView(s, a.id), myQuote: quotes.find((q) => q.shipmentId === s.id && q.carrierId === a.id) || null }));
  sendJSON(res, 200, { requests: rows });
}
async function submitQuote(req, res, m) {
  const a = requireCarrier(req, res); if (!a) return; const me = userById(a.id); const b = await readBody(req);
  const s = store.readAll("shipments").find((x) => x.id === m[1]);
  if (!s || s.status !== "requesting_quotes") return sendJSON(res, 400, { error: "This request is no longer open for quotes." });
  const mode = clean(b.mode, 30), price = num(b.price), eta = num(b.etaDays), currency = clean(b.currency, 3).toUpperCase();
  if (!(me.modes || []).includes(mode)) return sendJSON(res, 400, { error: "Choose one of the transport modes you operate." });
  if (s.temperature !== "ambient" && !(catalog.MODE_BY_ID[mode] && catalog.MODE_BY_ID[mode].reefer)) return sendJSON(res, 400, { error: "This cargo needs temperature control — choose a refrigerated or temperature-controlled mode." });
  if (!price || price <= 0 || eta == null || eta < 0 || eta > 365 || !geo.CURRENCY_SET.has(currency)) return sendJSON(res, 400, { error: "Enter a valid price, currency and transit time (days)." });
  const prev = store.readAll("quotes").find((q) => q.shipmentId === s.id && q.carrierId === a.id);
  const q = { id: prev ? prev.id : id(), shipmentId: s.id, carrierId: a.id, carrierName: me.name, companyName: me.companyName, mode, price: geo.roundMoney(price, currency), currency, etaDays: Math.round(eta), notes: maskContacts(clean(b.notes, 400)), status: "pending", createdAt: now() };
  await store.mutate("quotes", (all) => prev ? all.map((x) => x.id === q.id ? q : x) : [...all, q]); sendJSON(res, 201, { quote: q });
}
async function acceptQuote(req, res, m) {
  const u = requireAuth(req, res); if (!u) return; const b = await readBody(req);
  const s = store.readAll("shipments").find((x) => x.id === m[1]);
  if (!s || !isParty(s, u.id)) return sendJSON(res, 403, { error: "You're not part of this shipment." });
  if (s.status !== "requesting_quotes") return sendJSON(res, 400, { error: "A carrier has already been selected." });
  const o = store.readAll("orders").find((x) => x.id === s.orderId);
  if (!o || !HELD.includes(o.paymentStatus)) return sendJSON(res, 400, { error: "Pay for the order into escrow first, then choose a carrier." });
  const q = store.readAll("quotes").find((x) => x.id === clean(b.quoteId, 80) && x.shipmentId === s.id);
  if (!q) return sendJSON(res, 404, { error: "Quote not found." });
  await store.mutate("quotes", (all) => all.map((x) => x.shipmentId !== s.id ? x : { ...x, status: x.id === q.id ? "accepted" : "rejected" }));
  let out = null;
  await store.mutate("shipments", (all) => all.map((x) => { if (x.id !== s.id) return x; out = { ...x, status: "carrier_selected", selectedQuoteId: q.id, carrierId: q.carrierId, carrierName: q.companyName || q.carrierName, carrierMode: q.mode, carrierPrice: q.price, carrierCurrency: q.currency, etaDays: q.etaDays, events: [...x.events, { at: now(), status: "carrier_selected", note: `via ${(catalog.MODE_BY_ID[q.mode] || {}).label || q.mode}`, location: "" }] }; return out; }));
  await patchOrder(o.id, { shipmentStatus: "carrier_selected" }); sendJSON(res, 200, { shipment: shipmentView(out, u.id) });
}
async function shipmentStatus(req, res, m) {
  const u = requireCarrier(req, res); if (!u) return; const b = await readBody(req);
  if (!catalog.CARGO_STATUSES.includes(b.status)) return sendJSON(res, 400, { error: "Invalid status." });
  const s0 = store.readAll("shipments").find((x) => x.id === m[1] && x.carrierId === u.id && x.status !== "delivered"); if (!s0) return sendJSON(res, 403, { error: "You can only update your own active shipments." });
  const order = store.readAll("orders").find((o) => o.id === s0.orderId); if (!order) return sendJSON(res, 404, { error: "Order not found." });
  if (b.status === "picked_up" && s0.status !== "carrier_selected") return sendJSON(res, 400, { error: "Update the steps in order." });
  if (["in_transit", "at_customs"].includes(b.status) && s0.status === "carrier_selected") return sendJSON(res, 400, { error: "Confirm pickup with the seller's code first." });
  if (b.status === "delivered" && s0.status === "carrier_selected") return sendJSON(res, 400, { error: "Confirm pickup with the seller's code first." });
  if (b.status === "picked_up" || b.status === "delivered") { const chk = await checkHandoverCode(order, b.status === "picked_up" ? "pickup" : "delivery", b.code); if (!chk.ok) return sendJSON(res, chk.status, { error: chk.error }); }
  let out = null;
  await store.mutate("shipments", (all) => all.map((x) => { if (x.id !== m[1]) return x; out = { ...x, status: b.status, events: [...x.events, { at: now(), status: b.status, note: clean(b.note, 300), location: clean(b.location, 120) }] }; if (b.status === "delivered") out.deliveredAt = now(); return out; }));
  const patch = { shipmentStatus: b.status }; if (b.status === "delivered") patch.deliveredAt = now(); const upd = await patchOrder(out.orderId, patch);
  if (b.status === "delivered" && upd.paymentStatus === "escrowed" && !upd.disputed) await releaseOrder(upd, "delivery_code");
  sendJSON(res, 200, { shipment: shipmentView(out, u.id) });
}
async function shipmentDocs(req, res, m) {
  const u = requireAuth(req, res); if (!u) return; const b = await readBody(req); let out = null;
  await store.mutate("shipments", (all) => all.map((x) => { if (x.id !== m[1] || !isParty(x, u.id)) return x; out = { ...x, docs: { ...x.docs, [clean(b.docId, 40)]: b.done === true } }; return out; }));
  if (!out) return sendJSON(res, 403, { error: "You're not part of this shipment." }); sendJSON(res, 200, { shipment: shipmentView(out, u.id) });
}
async function carrierJobs(req, res) {
  const a = requireCarrier(req, res); if (!a) return; const ships = store.readAll("shipments");
  const jobs = ships.filter((s) => s.carrierId === a.id).sort(byNewest).map((s) => shipmentView(s, a.id));
  const myQuotes = store.readAll("quotes").filter((q) => q.carrierId === a.id && q.status === "pending").sort(byNewest).map((q) => ({ quote: q, shipment: ships.find((s) => s.id === q.shipmentId) })).filter((x) => x.shipment && x.shipment.status === "requesting_quotes").map((x) => ({ quote: x.quote, shipment: shipmentView(x.shipment, a.id) }));
  sendJSON(res, 200, { jobs, myQuotes });
}

// ---------- company accounts: documents (stored privately), verification ----------
const magicOk = (b) => (b.length > 4 && ((b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || b.slice(0, 4).toString() === "%PDF")) ? (b[0] === 0xff ? ["jpg", "image/jpeg"] : b[0] === 0x89 ? ["png", "image/png"] : ["pdf", "application/pdf"]) : null;
async function setCompany(uid, fn) { let out = null; await store.mutate("users", (all) => all.map((u) => { if (u.id !== uid) return u; out = { ...u, company: fn(u.company || {}) }; return out; })); return out; }
async function companyDocUpload(req, res) {
  const a = requireAuth(req, res); if (!a) return; const me = userById(a.id); if (!me || me.kind !== "company") return sendJSON(res, 400, { error: "Only company accounts can upload business documents." });
  const b = await readBody(req, 9e6); const type = DOC_TYPES.has(b.type) ? b.type : "other", buf = Buffer.from(String(b.data || ""), "base64"), kind = magicOk(buf);
  if (!kind) return sendJSON(res, 400, { error: "Upload a photo (JPG/PNG) or a PDF of the document." }); if (buf.length > 5e6) return sendJSON(res, 400, { error: "That file is too large (5 MB maximum)." });
  if ((me.company.docs || []).length >= 8) return sendJSON(res, 400, { error: "You can upload up to 8 documents." });
  if (me.company.verification && me.company.verification.status === "pending") return sendJSON(res, 400, { error: "Your documents are under review — you can add more once the review is finished." });
  const did = id(), file = `${did}.${kind[0]}`; fs.writeFileSync(path.join(PRIVATE_DIR, file), buf);
  const out = await setCompany(me.id, (c) => ({ ...c, docs: [...(c.docs || []), { id: did, type, filename: clean(String(b.filename || "document").split(/[\\/]/).pop(), 80) || "document", mediaType: kind[1], file, size: buf.length, uploadedAt: now() }] })); sendJSON(res, 201, { user: publicUser(out) });
}
async function companyDocDelete(req, res, m) {
  const a = requireAuth(req, res); if (!a) return; const me = userById(a.id); const d = me && me.company && (me.company.docs || []).find((x) => x.id === m[1]); if (!d) return sendJSON(res, 404, { error: "Document not found." });
  if (me.company.verification && me.company.verification.status === "pending") return sendJSON(res, 400, { error: "Your documents are under review." });
  try { fs.unlinkSync(path.join(PRIVATE_DIR, path.basename(d.file))); } catch (e) { /* already gone */ } sendJSON(res, 200, { user: publicUser(await setCompany(me.id, (c) => ({ ...c, docs: c.docs.filter((x) => x.id !== d.id) }))) });
}
async function companySubmit(req, res) {
  const a = requireAuth(req, res); if (!a) return; const me = userById(a.id); if (!me || me.kind !== "company") return sendJSON(res, 400, { error: "Only company accounts can be verified." }); const c = me.company, st = (c.verification && c.verification.status) || "none";
  if (!["none", "rejected"].includes(st)) return sendJSON(res, 400, { error: st === "pending" ? "Your documents are already under review." : "Your company is already verified." });
  if (!c.regNumber) return sendJSON(res, 400, { error: "Add your registration number first." }); if (!(c.docs || []).some((d) => d.type === "registration")) return sendJSON(res, 400, { error: "Upload your business registration certificate first." });
  await evt("sokoni", "company_submitted", null, "processed", c.legalName); sendJSON(res, 200, { user: publicUser(await setCompany(me.id, (x) => ({ ...x, verification: { status: "pending", submittedAt: now() } }))) });
}
async function adminCompanies(req, res, m, url) {
  if (!requireAdmin(req, res)) return; const st = url.searchParams.get("status") || "pending";
  sendJSON(res, 200, { companies: store.readAll("users").filter((u) => u.kind === "company" && u.company && ((u.company.verification && u.company.verification.status) || "none") === st).map((u) => ({ userId: u.id, contact: u.name, phone: u.phone, email: u.email, country: u.country, company: { legalName: u.company.legalName, businessType: u.company.businessType, regNumber: u.company.regNumber, taxId: u.company.taxId }, verification: u.company.verification, docs: (u.company.docs || []).map((d) => ({ id: d.id, type: d.type, filename: d.filename, uploadedAt: d.uploadedAt, size: d.size })) })) });
}
async function adminDocument(req, res, m) { // documents are private: only an admin can open them
  if (!requireAdmin(req, res)) return; let doc = null; for (const u of store.readAll("users")) { const d = u.company && (u.company.docs || []).find((x) => x.id === m[1]); if (d) doc = d; }
  if (!doc) return sendJSON(res, 404, { error: "Document not found." }); fs.readFile(path.join(PRIVATE_DIR, path.basename(doc.file)), (err, data) => { if (err) return sendJSON(res, 404, { error: "File missing." }); res.writeHead(200, { "Content-Type": doc.mediaType, "Cache-Control": "private, no-store" }); res.end(data); });
}
async function adminCompanyReview(req, res, m) {
  if (!requireAdmin(req, res)) return; const b = await readBody(req); if (!["approve", "reject"].includes(b.decision)) return sendJSON(res, 400, { error: "decision must be approve or reject." });
  const u = userById(m[1]); if (!u || !u.company || !u.company.verification || u.company.verification.status !== "pending") return sendJSON(res, 400, { error: "This company isn't awaiting review." });
  await setCompany(u.id, (c) => ({ ...c, verification: { status: b.decision === "approve" ? "verified" : "rejected", note: clean(b.note, 300), submittedAt: c.verification.submittedAt, reviewedAt: now() } })); await evt("admin", "company_" + b.decision, null, "processed", u.company.legalName); sendJSON(res, 200, { ok: true });
}
// ---------- reference data ----------
async function meta(req, res) {
  sendJSON(res, 200, { countries: geo.COUNTRIES, currencies: geo.CURRENCIES, crops: catalog.CROPS, units: catalog.UNITS, temperatures: catalog.TEMPERATURES, modes: catalog.MODES, incoterms: catalog.INCOTERMS,
    build: build.id, vehicles: VEHICLES, commissionPercent: COMMISSION, autoReleaseDays: AUTO_RELEASE_DAYS, payoutWaitDays: payments.payoutWaitDays(), photoCount: trust.PHOTO_COUNT, devPayments: payments.cfg.test(), visionConfigured: vision.isConfigured(), countryLanguages: langs.COUNTRY_LANGUAGES, rtlLanguages: [...langs.RTL], blockedCountries: [...BLOCKED], translationAvailable: i18n.aiConfigured(), passwordRules: passwordPolicy.RULES, dialCodes: dial.DIAL, devOtp: notify.devAllowed(), verifyCodes: codesOn(), devMode: !process.env.PUBLIC_BASE_URL || /localhost|127\.0\.0\.1/.test(process.env.PUBLIC_BASE_URL), businessTypes: catalog.BUSINESS_TYPES, payoutAuto: payouts.autoTypes() });
}
async function fxRates(req, res) { const d = await fx.getRates(); sendJSON(res, 200, d ? { base: d.base, rates: d.rates, updatedAt: d.updatedAt } : { rates: null }); }

// ---------- price suggestion ----------
// The price guide shows short, plain notes: no web addresses, no markdown links, no "(source: …)" citations, cut at the end of a sentence rather than mid-word.
function plainNote(text, max) {
  let t = String(text || "").replace(/\[([^\]]*)\]\(\s*(?:https?:\/\/|www\.)[^)]*\)/gi, "$1").replace(/https?:\/\/\S+/gi, "").replace(/\bwww\.\S+/gi, "").replace(/\s*\((?:sources?|via|per|see)[^)]*\)/gi, "").replace(/\s+/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
  if (t.length <= max) return t; const cut = t.slice(0, max), dot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return dot > max * 0.45 ? cut.slice(0, dot + 1) : cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[,;:\-–]+$/, "") + "…";
}
async function priceSuggestion(req, res) {
  const u = requireAuth(req, res); if (!u) return; const b = await readBody(req);
  const crop = clean(b.crop, 60), unit = clean(b.unit, 20), currency = clean(b.currency, 3).toUpperCase(), country = clean(b.country, 2).toUpperCase(), quantity = clean(String(b.quantity || ""), 20), town = clean(b.location, 120);
  if (!crop || !geo.CURRENCY_SET.has(currency)) return sendJSON(res, 400, { error: "Choose a product and currency first." });
  const unitName = ((catalog.UNITS.find((x) => x.v === unit) || {}).l || unit), cname = ((geo.COUNTRIES.find((c) => c.code === country) || {}).name || country);
  const similar = store.readAll("listings").filter((l) => l.status === "available" && l.currency === currency && l.unit === unit && String(l.crop).toLowerCase() === crop.toLowerCase()).map((l) => l.pricePerUnit);
  const platform = similar.length ? { n: similar.length, low: Math.min(...similar), high: Math.max(...similar), avg: geo.roundMoney(similar.reduce((a, c) => a + c, 0) / similar.length, currency) } : null;
  const base = { currency, unit: unitName, platform };
  if (!ai.configured()) return sendJSON(res, 200, { ...base, live: false, confidence: "low", suggested: platform ? { low: platform.low, high: platform.high, currency } : null, summary: platform ? `Sokoni sellers currently list ${crop} between ${platform.low} and ${platform.high} ${currency} per ${unitName} (average ${platform.avg}). Live market data isn't available yet.` : `No comparable Sokoni listings yet, and live market data isn't available yet.` });
  const prompt = `You are a market-price analyst for agricultural produce. Estimate a FAIR price a seller should ask, per ${unitName}, for: ${crop}${quantity ? ", about " + quantity + " " + unitName : ""}, located in ${town ? town + ", " : ""}${cname}. Selling currency: ${currency}.\n` +
    `Use web search to find CURRENT wholesale / farm-gate / market prices (not retail shop prices): (1) in ${cname} — national average or the nearest major wholesale market, and (2) GLOBAL / export benchmarks (for example FAO price tools, USDA market news, major wholesale markets or exchanges). Prefer official or market-data sources.\n` +
    `Sokoni's own current listings for this product (${currency} per ${unitName}): ${platform ? `${platform.n} listings, low ${platform.low}, high ${platform.high}, average ${platform.avg}` : "none yet"}.\n` +
    `Answer with ONLY one JSON object: {"local":{"low":number,"high":number,"currency":"ISO code","basis":"ONE short plain sentence (at most 20 words) on what this range reflects"},"global":{"low":number,"high":number,"currency":"USD","basis":"ONE short plain sentence (at most 20 words) on what this range reflects"},"suggested":{"low":number,"high":number,"currency":"${currency}"},"summary":"two short plain sentences (at most 45 words in all) a farmer can act on","confidence":"low"|"medium"|"high","asOf":"month/year of the data"}. All prices per ${unitName}. Convert currencies carefully. If you cannot find reliable data say so in "basis", set confidence "low", and never invent a number. Write in a neutral voice (never "I" or "my"). NEVER name websites, publications or other sources, and never include links or citations anywhere in your answer: only the figures and a short plain explanation.`;
  const msg = [{ role: "user", content: prompt }]; let r = await ai.claude({ messages: msg, max_tokens: 1800, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }], kind: "price-suggestion" }), live = true;
  if (!r.ok) { live = false; r = await ai.claude({ messages: msg, max_tokens: 1200, kind: "price-suggestion" }); }  // web search may not be enabled for this key → fall back to the model's own market knowledge
  if (!r.ok) return sendJSON(res, 502, { error: "The price guide isn't reachable right now. Try again in a minute." });
  const o = ai.jsonOf(ai.textOf(r.data)); if (!o) return sendJSON(res, 502, { error: "The price guide gave an unreadable answer. Try again." });
  const sources = []; for (const blk of r.data.content || []) if (blk.type === "web_search_tool_result" && Array.isArray(blk.content)) for (const x of blk.content) if (x.url && !sources.some((y) => y.url === x.url)) sources.push({ title: String(x.title || x.url).slice(0, 120), url: x.url }); live = live && sources.length > 0;
  const rng = (x, cur) => (x && Number.isFinite(+x.low) && Number.isFinite(+x.high) && +x.low > 0 && +x.high >= +x.low ? { low: +x.low, high: +x.high, currency: String(x.currency || cur).toUpperCase().slice(0, 3), basis: plainNote(x.basis, 170) } : null);
  const local = rng(o.local, currency), global = rng(o.global, "USD"); let sug = rng(o.suggested, currency);
  if (sug && sug.currency !== currency) { const rate = await fx.rate(sug.currency, currency); if (rate) sug = { low: geo.roundMoney(sug.low * rate, currency), high: geo.roundMoney(sug.high * rate, currency), currency }; }
  sendJSON(res, 200, { ...base, live, confidence: ["low", "medium", "high"].includes(o.confidence) ? o.confidence : "low", asOf: String(o.asOf || "").slice(0, 40), local, global, suggested: sug && { low: sug.low, high: sug.high, currency: sug.currency }, summary: plainNote(o.summary, 320) });
}

// ---------- static + router ----------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };
// Lets an Android app that wraps this website (a Play Store version) prove it belongs to this site, so it opens full-screen with no browser bar.
// Set ANDROID_PACKAGE (e.g. africa.sokoni.app) and ANDROID_SHA256 (the signing certificate fingerprint(s) from Play Console, comma-separated).
function assetLinks(req, res) {
  const pkg = String(process.env.ANDROID_PACKAGE || "").trim(), fps = String(process.env.ANDROID_SHA256 || "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(x));
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" }); res.end(JSON.stringify(pkg && fps.length ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: fps } }] : []));
}
function serveStatic(res, pathname, root, spa) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/uploads\//, "").replace(/^\/+/, ""); const fp = path.join(root, rel);
  if (!fp.startsWith(root)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(fp, (err, data) => {
    if (err) { if (!spa) { res.writeHead(404); return res.end("Not found"); } return fs.readFile(path.join(root, "index.html"), (e2, idx) => { if (e2) { res.writeHead(404); return res.end("Not found"); } res.writeHead(200, { "Content-Type": "text/html" }); res.end(idx); }); }
    const ext = path.extname(fp), h = { "Content-Type": MIME[ext] || "application/octet-stream" };
    if (root === PUBLIC_DIR) { if (ext === ".html" || ext === ".webmanifest" || /[\\/]sw\.js$/.test(fp)) h["Cache-Control"] = "no-cache"; else if (/[\\/]icons[\\/]/.test(fp)) h["Cache-Control"] = "public, max-age=86400"; } // the app, its manifest and its service worker are always re-checked, so an update reaches everyone at once
    if (root === PUBLIC_DIR && /[\\/]admin\.html$/.test(fp)) { h["X-Robots-Tag"] = "noindex, nofollow, noarchive"; h["Cache-Control"] = "no-store"; }
    res.writeHead(200, h); res.end(data);
  });
}
const R = (method, re, fn) => ({ method, re, fn });
const routes = [
  R("GET", /^\/api\/meta$/, meta), R("GET", /^\/api\/fx$/, fxRates), R("POST", /^\/api\/signup$/, signup), R("POST", /^\/api\/signup\/verify$/, signupVerify), R("POST", /^\/api\/signup\/resend$/, signupResend), R("POST", /^\/api\/login$/, login), R("POST", /^\/api\/login\/verify$/, loginVerify), R("POST", /^\/api\/password\/forgot$/, passwordForgot), R("POST", /^\/api\/password\/reset$/, passwordReset), R("POST", /^\/api\/me\/password$/, passwordChange), R("POST", /^\/api\/login\/resend$/, loginResend), R("POST", /^\/api\/login\/enroll$/, loginEnroll), R("POST", /^\/api\/capture\/anon$/, captureAnon), R("POST", /^\/api\/riders\/vehicle$/, riderVehicle), R("GET", /^\/api\/me$/, getMe), R("PUT", /^\/api\/me$/, putMe),
  R("GET", /^\/api\/listings$/, getListings), R("GET", /^\/api\/listings\/mine$/, getMyListings), R("GET", /^\/api\/listings\/([^/]+)$/, getListing), R("POST", /^\/api\/orders\/([^/]+)\/seen$/, orderSeen), R("POST", /^\/api\/listings$/, createListing), R("PATCH", /^\/api\/listings\/([^/]+)$/, updateListing), R("DELETE", /^\/api\/listings\/([^/]+)$/, deleteListing),
  R("GET", /^\/api\/orders\/farmer$/, (q, s) => ordersFor(q, s, "farmerId")), R("GET", /^\/api\/orders\/buyer$/, (q, s) => ordersFor(q, s, "buyerId")), R("POST", /^\/api\/orders$/, createOrder), R("PATCH", /^\/api\/orders\/([^/]+)$/, respondOrder),
  R("GET", /^\/api\/threads\/(order|delivery|shipment)\/([^/]+)\/messages$/, getMessages), R("POST", /^\/api\/threads\/(order|delivery|shipment)\/([^/]+)\/messages$/, postMessage),
  R("GET", /^\/api\/i18n\/([A-Za-z-]+)$/, getI18n), R("POST", /^\/api\/admin\/transfers\/import$/, bankImport), R("POST", /^\/api\/webhooks\/bank\/([a-f0-9]+)$/, bankAlert), R("POST", /^\/api\/webhooks\/crypto$/, cryptoWebhook), R("POST", /^\/api\/webhooks\/paypal$/, paypalWebhook), R("GET", /^\/api\/paypal\/return$/, paypalReturn), R("POST", /^\/api\/webhooks\/wire$/, wireWebhook), R("POST", /^\/api\/orders\/([^/]+)\/wire-sent$/, wireSent),
  R("GET", /^\/api\/geo\/hint$/, geoHint), R("GET", /^\/api\/places$/, placesSearch), R("GET", /^\/api\/places\/reverse$/, placesReverse), R("POST", /^\/api\/capture\/session$/, captureSession),
  R("GET", /^\/api\/inbox$/, inbox), R("POST", /^\/api\/threads\/(order|delivery|shipment)\/([^/]+)\/read$/, markRead), R("GET", /^\/api\/payout\/banks$/, payoutBanks), R("POST", /^\/api\/listings\/([^/]+)\/quality$/, listingQuality), R("POST", /^\/api\/listings\/([^/]+)\/fix-location$/, fixLocation), R("POST", /^\/api\/listings\/([^/]+)\/retake$/, retakePhotos), R("POST", /^\/api\/webhooks\/stripe$/, stripeWebhook), R("POST", /^\/api\/webhooks\/flutterwave$/, flutterwaveWebhook),
  R("POST", /^\/api\/orders\/([^/]+)\/pay$/, payOrder), R("POST", /^\/api\/orders\/preview$/, previewOrder), R("POST", /^\/api\/orders\/([^/]+)\/check-payment$/, checkPayment), R("POST", /^\/api\/orders\/([^/]+)\/edit$/, editOrder), R("POST", /^\/api\/orders\/([^/]+)\/cancel$/, cancelOrder), R("POST", /^\/api\/orders\/([^/]+)\/remove$/, removeOrder), R("POST", /^\/api\/orders\/([^/]+)\/confirm-receipt$/, confirmReceipt), R("POST", /^\/api\/orders\/([^/]+)\/dispute$/, disputeOrder),
  R("POST", /^\/api\/price-suggestion$/, priceSuggestion),
  R("POST", /^\/api\/webhooks\/paystack$/, paystackWebhook), R("POST", /^\/api\/webhooks\/fincra$/, fincraWebhook), R("POST", /^\/api\/mpesa\/stk-callback$/, mpesaStkCallback), R("POST", /^\/api\/webhooks\/jenga\/([a-f0-9]+)\/stk$/, jengaStkCallback), R("POST", /^\/api\/webhooks\/jenga\/([a-f0-9]+)\/payout$/, jengaPayoutCallback), R("POST", /^\/api\/orders\/([^/]+)\/crypto-check$/, cryptoCheck), R("POST", /^\/api\/coin\/bond$/, coinBond), R("POST", /^\/api\/coin\/unbond$/, coinUnbond), R("POST", /^\/api\/listings\/([^/]+)\/boost$/, boostListing), R("POST", /^\/api\/orders\/([^/]+)\/rating$/, rateOrder), R("POST", /^\/api\/orders\/([^/]+)\/rating-skip$/, skipRating), R("GET", /^\/api\/sellers\/([^/]+)\/feedback$/, sellerFeedback), R("GET", /^\/api\/admin\/ratings$/, adminRatings), R("POST", /^\/api\/admin\/ratings\/([^/]+)\/hide$/, adminHideRating), R("GET", /^\/api\/admin\/analytics$/, adminAnalytics), R("GET", /^\/api\/admin\/analytics\/export$/, adminAnalyticsExport), R("GET", /^\/api\/push\/key$/, pushKey), R("POST", /^\/api\/push\/subscribe$/, pushSubscribe), R("POST", /^\/api\/push\/unsubscribe$/, pushUnsubscribe), R("POST", /^\/api\/push\/test$/, pushTest), R("GET", /^\/api\/admin\/economics$/, adminEconomics), R("GET", /^\/api\/admin\/dataset$/, adminDataset), R("GET", /^\/api\/admin\/crypto$/, adminCrypto), R("POST", /^\/api\/admin\/crypto\/convert$/, adminCryptoConvert), R("GET", /^\/api\/admin\/equity$/, adminEquity), R("POST", /^\/api\/admin\/equity\/check$/, adminEquityCheck), R("POST", /^\/api\/admin\/equity\/assign$/, adminEquityAssign), R("POST", /^\/api\/admin\/equity\/paybill-confirm$/, adminPaybillConfirm), R("POST", /^\/api\/admin\/jenga\/keys$/, adminJengaKeys), R("GET", /^\/api\/admin\/jenga\/public-key$/, adminJengaPublicKey), R("POST", /^\/api\/webhooks\/c2b\/([a-f0-9]+)\/confirmation$/, c2bConfirmation), R("POST", /^\/api\/webhooks\/c2b\/([a-f0-9]+)\/validation$/, c2bValidation), R("GET", /^\/api\/wallet$/, getWallet), R("GET", /^\/api\/wallet\/export\.csv$/, walletCsv), R("POST", /^\/api\/orders\/([^/]+)\/mpesa-claim$/, mpesaClaim), R("GET", /^\/api\/admin\/mpesa$/, adminMpesa), R("POST", /^\/api\/admin\/mpesa\/register$/, adminMpesaRegister), R("POST", /^\/api\/admin\/mpesa\/simulate$/, adminMpesaSimulate), R("POST", /^\/api\/admin\/mpesa\/payments\/([A-Za-z0-9]+)\/assign$/, adminMpesaAssign), R("GET", /^\/api\/admin\/mpesa\/claims\/([^/]+)\/receipt$/, adminMpesaReceipt), R("POST", /^\/api\/mpesa\/b2c-callback$/, mpesaB2c), R("POST", /^\/api\/mpesa\/b2c-timeout$/, (q, s) => sendJSON(s, 200, { ok: true })),
  R("GET", /^\/api\/admin\/overview$/, adminOverview), R("GET", /^\/api\/admin\/payments$/, adminPayments), R("GET", /^\/api\/admin\/reconciliations$/, adminReconciliations), R("GET", /^\/api\/admin\/events$/, adminEvents), R("GET", /^\/api\/admin\/payouts$/, adminPayouts),
  R("GET", /^\/api\/admin\/disputes$/, adminDisputes), R("POST", /^\/api\/admin\/orders\/([^/]+)\/resolve$/, adminResolve), R("POST", /^\/api\/admin\/orders\/([^/]+)\/mark-refunded$/, adminMarkRefunded), R("POST", /^\/api\/admin\/orders\/([^/]+)\/retry-payout$/, adminRetryPayout),
  R("GET", /^\/api\/admin\/reviews$/, adminReviews), R("POST", /^\/api\/admin\/listings\/([^/]+)\/review$/, adminReviewDecision), R("GET", /^\/api\/admin\/providers$/, adminProviders), R("GET", /^\/api\/admin\/readiness$/, adminReadiness), R("GET", /^\/api\/admin\/users$/, adminUsers), R("POST", /^\/api\/admin\/users\/([^/]+)\/reset-password$/, adminResetPassword), R("GET", /^\/api\/admin\/riders$/, adminRiders), R("GET", /^\/api\/admin\/riders\/([^/]+)\/photo$/, adminRiderPhoto), R("POST", /^\/api\/admin\/riders\/([^/]+)\/review$/, adminRiderReview), R("POST", /^\/api\/admin\/notify-test$/, adminNotifyTest), R("GET", /^\/api\/admin\/coverage$/, adminCoverage), R("GET", /^\/api\/admin\/transfers$/, adminTransfers), R("POST", /^\/api\/admin\/orders\/([^/]+)\/confirm-transfer$/, adminConfirmTransfer), R("GET", /^\/api\/admin\/settings$/, adminSettingsGet), R("PUT", /^\/api\/admin\/settings$/, adminSettingsPut), R("POST", /^\/api\/admin\/provider-test$/, adminProviderTest), R("GET", /^\/api\/admin\/export\/payments\.csv$/, adminExportPayments), R("GET", /^\/api\/health$/, health), R("GET", /^\/api\/admin\/companies$/, adminCompanies), R("GET", /^\/api\/admin\/documents\/([^/]+)$/, adminDocument), R("POST", /^\/api\/admin\/companies\/([^/]+)\/review$/, adminCompanyReview),
  R("POST", /^\/api\/company\/documents$/, companyDocUpload), R("DELETE", /^\/api\/company\/documents\/([^/]+)$/, companyDocDelete), R("POST", /^\/api\/company\/submit$/, companySubmit), R("POST", /^\/api\/admin\/ai-test$/, adminAiTest), R("POST", /^\/api\/admin\/deliveries\/([^/]+)\/retry-payout$/, adminRetryRiderPayout), R("POST", /^\/api\/admin\/deliveries\/([^/]+)\/mark-paid-out$/, adminMarkRiderPaid), R("POST", /^\/api\/admin\/orders\/([^/]+)\/mark-paid-out$/, adminMarkPaidOut),
  R("GET", /^\/api\/delivery-quote$/, deliveryQuote), R("POST", /^\/api\/deliveries\/([^/]+)\/accept$/, riderAccept), R("POST", /^\/api\/deliveries\/([^/]+)\/decline$/, riderDecline), R("GET", /^\/api\/deliveries\/([^/]+)$/, getDelivery), R("PATCH", /^\/api\/deliveries\/([^/]+)\/status$/, updateDeliveryStatus),
  R("POST", /^\/api\/riders\/online$/, riderOnline), R("POST", /^\/api\/riders\/location$/, riderLocation), R("GET", /^\/api\/riders\/deliveries$/, riderDeliveries), R("GET", /^\/api\/riders\/earnings$/, riderEarnings),
  R("POST", /^\/api\/shipments$/, requestFreight), R("GET", /^\/api\/shipments\/([^/]+)$/, getShipment), R("POST", /^\/api\/shipments\/([^/]+)\/quotes$/, submitQuote), R("POST", /^\/api\/shipments\/([^/]+)\/accept$/, acceptQuote),
  R("PATCH", /^\/api\/shipments\/([^/]+)\/status$/, shipmentStatus), R("PATCH", /^\/api\/shipments\/([^/]+)\/docs$/, shipmentDocs),
  R("GET", /^\/api\/carriers\/open$/, carrierOpen), R("GET", /^\/api\/carriers\/jobs$/, carrierJobs),
];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost"); let p = url.pathname;
  try {
    if (!p.startsWith("/api/")) { const secret = adminSecretPath(); if (secret) { if (p === "/admin.html") { res.writeHead(404); return res.end("Not found"); } if (p === secret) p = "/admin.html"; } if (p === "/admin.html" && !adminIpOk(req)) { res.writeHead(404); return res.end("Not found"); } }
    if (p.startsWith("/api/")) {
      for (const r of routes) { if (r.method !== req.method) continue; const m = p.match(r.re); if (m) return await r.fn(req, res, m, url); }
      return sendJSON(res, 404, { error: "Not found" });
    }
    if (p === "/.well-known/assetlinks.json") return assetLinks(req, res);
    if (p.startsWith("/uploads/")) return serveStatic(res, p, UPLOADS_DIR, false);
    return serveStatic(res, p, PUBLIC_DIR, true);
  } catch (e) { console.error(e); sendJSON(res, e.message === "Invalid JSON" || e.message === "Body too large" ? 400 : 500, { error: e.message === "Invalid JSON" || e.message === "Body too large" ? e.message : "Something went wrong on our end. Please try again." }); }
});
function startupReport() {
  const c = payments.cfg, on = [["M-Pesa via Equity (Jenga)", c.jenga()], ["M-Pesa Pay Bill (you confirm each payment by hand until the Equity API is connected)", !c.jenga() && !c.mpesa() && payments.manualKind() === "equity"], ["M-Pesa (Daraja)", c.mpesa()], ["Flutterwave", c.flutterwave()], ["Stripe", c.stripe()], ["PayPal", c.paypal()], ["Bank transfer", c.wire()], ["USDC (crypto)", c.nowpayments()], ["TEST sandbox", c.test()]].filter((x) => x[1]).map((x) => x[0]);
  if (process.env.DEV_PAYMENTS === "1" && !c.test()) console.log("ℹ DEV_PAYMENTS is set but IGNORED because PUBLIC_BASE_URL is a public address (the fake sandbox only runs locally). Remove DEV_PAYMENTS from your settings.");
  { const at0 = String(process.env.ADMIN_TOKEN || ""); if (at0 && at0.length < 20) console.log(`⚠ ADMIN_TOKEN is short (${at0.length} characters). Once your site is on the internet anyone can reach the sign-in page, so use 24+ random characters.`);
    { const ap = adminPathStatus(); if (ap.state === "secret") console.log(`🔒 Admin console: ${(process.env.PUBLIC_BASE_URL || "http://localhost:" + PORT).replace(/\/$/, "")}${ap.path}  (/admin.html says “Not found”)`); else if (ap.state === "invalid" || ap.state === "example") console.log("⚠ " + ap.message); else if (/^https:\/\//.test(process.env.PUBLIC_BASE_URL || "") && !process.env.ADMIN_ALLOWED_IPS) console.log("ℹ Your admin sign-in page is public at /admin.html (it needs your admin password to do anything). For extra privacy set ADMIN_PATH (a secret page address) and/or ADMIN_ALLOWED_IPS."); } }
  { const weak = []; if (["change-me-to-a-long-random-string", "change-me-too", "change-me"].includes(process.env.ADMIN_TOKEN)) weak.push("ADMIN_TOKEN"); if (["change-me-to-a-long-random-string", "change-me-too", "change-me"].includes(process.env.SERVER_SECRET)) weak.push("SERVER_SECRET"); if (process.env.SERVER_SECRET && process.env.SERVER_SECRET.length < 16 && !weak.includes("SERVER_SECRET")) weak.push("SERVER_SECRET (too short — use 30+ random characters)");
    for (const k of ["ADMIN_TOKEN", "SERVER_SECRET"]) if (String(process.env[k] || "").startsWith("#")) console.log(`ℹ ${k} starts with "#". The "#" is PART of it — type it too when you sign in, or take it out of your settings file (and restart).`);
    if (process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN === process.env.SERVER_SECRET) console.log("⚠ ADMIN_TOKEN and SERVER_SECRET are the same value. Make them different: the admin password travels from your browser to the server, but SERVER_SECRET must never leave the server.");
    if (weak.length) console.log("⚠ " + weak.join(" and ") + " is still an example value or too weak. Anyone who knows it can use your admin page or read your saved keys. Replace it with your own long random value."); }
  const envFiles = global.__sokoniEnvFiles || [], dataDir = path.resolve(process.env.SOKONI_DATA_DIR || path.join(__dirname, "data"));
  const noFile = "NO settings file found — your keys and bank details are NOT loaded.\n  → Create a file called  sokoni.env  in your home folder (" + require("os").homedir() + ") — or  .env  next to server.js — then restart.", txtWarn = (global.__sokoniEnvTxt || []).map((f) => "\n  ⚠ Found " + f + ".txt — Windows added “.txt”. Rename it to " + require("path").basename(f) + " (turn on View → File name extensions in File Explorer to see it).").join("");
  console.log("Settings read from: " + (envFiles.length ? envFiles.join("  +  ") : noFile) + txtWarn + "\nData folder: " + dataDir + "  (users, listings and orders live here)");
  console.log("Unzipped a new version? It starts empty unless you copy your data folder into it — or keep one permanent sokoni.env in your home folder and set SOKONI_DATA_DIR in it so nothing is lost.");
  { const bp = build.check(); console.log("Build: " + build.id + (bp.length ? "" : " (all files match)")); if (bp.length) console.log("⚠ MIXED VERSIONS — some files in this folder are from a different download:\n  · " + bp.join("\n  · ") + "\n  Copy ALL the files from the newest zip over this folder (keep your settings file and data folder), then restart."); }
  console.log("Sign-in codes: " + (codesOn() ? "ON (SMS + email)" : codesMode() === "off" ? "forced OFF" : "OFF for now — they switch on automatically once an SMS and an email provider are connected and tested") + " | Receipts by email: " + (notify.emailProvider() ? "on" : "off until an email provider is connected"));
  console.log("Payments enabled: " + (on.length ? on.join(", ") : "NONE — buyers cannot pay. For local testing set DEV_PAYMENTS=1 in .env (and check no terminal has set DEV_PAYMENTS=0)."));
  if (c.test()) console.log("⚠  DEV_PAYMENTS is on: fake payments and payouts are enabled. Never run production like this.");
  console.log("AI: " + (ai.configured() ? "key found, model " + ai.model() + " (Admin → Providers → Test AI now)" : "no AI key — quality reports, price guide, weight estimates and translations are off (add ANTHROPIC_API_KEY to your settings file, or paste it in Operations → Payment setup → AI)") + " | Admin console: " + (ADMIN_TOKEN ? "enabled" : "disabled (set ADMIN_TOKEN)"));
}
if (require.main === module) { server.listen(...(process.env.HOST ? [PORT, process.env.HOST] : [PORT]), () => { console.log(`Sokoni running at http://localhost:${PORT}` + (process.env.HOST ? ` (listening on ${process.env.HOST} only)` : "")); startupReport(); backup.startBackups(); }); (setTimeout(() => qualitySweep().catch(() => {}), 20000).unref(), setInterval(sweeps, 5 * 60000)).unref(); setInterval(equitySweep, 90000).unref(); setInterval(dispatchSweep, 10000).unref(); }
module.exports = { server, dispatchSweep, autoReleaseSweep, sweeps, reconcileSweep, payoutSweep, qualitySweep, equitySweep, bondSweep, cryptoSweep, ledgerSyncOrder, ratingSweep, analyticsSweep, ratingIndexReset: () => { ratingCache = null; }, adminLockReset: () => adminFails.clear(), adminPathStatus, fincraSweep, paystackSweep };
