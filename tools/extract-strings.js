// Builds i18n/en.json — the master list of every translatable string (English text is the key).
// Run after changing any user-visible text:  node tools/extract-strings.js
// Sources: t("…")/tr("…") calls in public/index.html, static error/message strings in server.js, the catalogue
// (crops, units, modes, Incoterms, document checklist, temperatures), payment-option labels, vehicles and a few status words.
const fs = require("fs"); const path = require("path"); const root = path.join(__dirname, "..");
const out = new Set(); const unescape = (raw) => { try { return JSON.parse('"' + raw.replace(/\\'/g, "'") + '"'); } catch { return raw; } };
const scan = (file, re) => { const src = fs.readFileSync(path.join(root, file), "utf8"); let m; while ((m = re.exec(src))) { const s = unescape(m[1]); if (s && !s.includes("${")) out.add(s); } };
scan("public/index.html", /\b(?:t|tr)\(\s*"((?:[^"\\]|\\.)*)"/g);
scan("server.js", /(?:error|message): "((?:[^"\\]|\\.)*)"/g); scan("server.js", /BLOCKED_MSG = "((?:[^"\\]|\\.)*)"/g);
scan("lib/payments.js", /label: "((?:[^"\\]|\\.)*)"/g); scan("lib/trust.js", /f\("[a-z_]+", "(?:major|minor)", "((?:[^"\\]|\\.)*)"/g); scan("server.js", /payoutNote: "((?:[^"\\]|\\.)*)"/g);
const src = fs.readFileSync(path.join(root, "server.js"), "utf8"); const v = src.match(/const VEHICLES = \[(.*?)\];/); if (v) v[1].split(",").forEach((x) => out.add(x.trim().replace(/^"|"$/g, "")));
const cat = require("../lib/catalog");
cat.CROPS.forEach((c) => { out.add(c.name); out.add(c.category); }); cat.UNITS.forEach((u) => out.add(u.l)); cat.TEMPERATURES.forEach((x) => out.add(x.l)); cat.MODES.forEach((x) => out.add(x.label)); cat.INCOTERMS.forEach((x) => out.add(x.l)); cat.BUSINESS_TYPES.forEach((x) => out.add(x.l));
[[false, false], [true, false], [true, true]].forEach(([international, perishable]) => cat.docChecklist({ international, perishable }).forEach((d) => out.add(d.label)));
["Secure payment page", "Cards and local payment methods", "Bank transfer (wire / ACH)", "Pay from your bank — held safely once it arrives", "Market", "Sell", "Orders", "Messages", "Deliver", "Freight", "Account", "Requested", "Accepted", "Paid", "On the way", "Delivered", "Completed", "Your payout is queued.", "Payment confirmed — your money is held safely.", "Check your phone to complete the payment.", "Order", "Local delivery", "Live", "pending", "accepted", "declined", "requesting quotes", "carrier selected", "picked up", "in transit", "at customs", "delivered", "searching", "assigned", "rider"].forEach((x) => out.add(x));
const keys = [...out].sort(); const obj = {}; keys.forEach((k) => { obj[k] = k; });
fs.mkdirSync(path.join(root, "i18n"), { recursive: true }); fs.writeFileSync(path.join(root, "i18n", "en.json"), JSON.stringify(obj, null, 1));
console.log(keys.length + " strings written to i18n/en.json");
