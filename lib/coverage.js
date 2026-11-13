// Payment coverage for EVERY country: what a buyer there can use right now (given what you've connected), what they'd be charged in,
// which typical local methods exist, and which of those you can't reach yet. The per-country local-method list is editorial knowledge of the
// popular methods — treat it as a guide and confirm availability with your provider/acquirer. Nothing here moves money.
const { COUNTRIES } = require("./countries");
const REGIONS = {
  "Africa": "DZ AO BJ BW BF BI CM CV CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW",
  "Europe": "AL AD AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH UA GB VA",
  "Middle East": "BH IR IQ IL JO KW LB OM PS QA SA SY TR AE YE",
  "Asia": "AF AM AZ BD BT BN KH CN GE HK IN ID JP KZ KG LA MO MY MV MN MM NP PK PH SG KR LK TW TJ TH TL TM UZ VN KP",
  "North America": "CA US",
  "Latin America & Caribbean": "AG AR BS BB BZ BO BR CL CO CR CU DM DO EC SV GD GT GY HT HN JM MX NI PA PY PE PR KN LC VC SR TT UY VE",
  "Oceania": "AU FJ KI MH FM NR NZ PW PG WS SB TO TV VU",
};
const REGION_OF = {}; for (const [r, codes] of Object.entries(REGIONS)) for (const c of codes.split(" ")) REGION_OF[c] = r;
const SANCTIONED = ["CU", "IR", "KP", "SY"]; // comprehensively sanctioned: payment providers refuse these, and routing them can get your accounts closed
const CAUTION = new Set("RU BY MM VE AF LY SD SS SO YE ZW IQ LB".split(" ")); // commonly restricted or heavily screened by providers — confirm with yours
const CRYPTO_RESTRICTED = new Set("CN DZ BD NP EG IQ QA TN MA".split(" ")); // reported as banned or heavily restricted for crypto — verify local law
const mobileMoneyList = () => (process.env.MOBILE_MONEY_COUNTRIES ? process.env.MOBILE_MONEY_COUNTRIES.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) : "KE UG TZ RW GH ZM MW SL SN CI BJ BF ML TG NE GN CM GA CG CD".split(" "));
const isMobileMoney = (cc) => mobileMoneyList().includes(cc);
// typical popular local methods: [name, how you'd reach it] — "flw" = through Flutterwave when enabled for that country/currency; "acq" = needs a cross-border acquirer
const L = (s, k) => s.split("|").map((n) => [n.trim(), k]);
const LOCAL = {
  NG: L("Bank transfer|USSD|OPay", "flw"), GH: L("Mobile money (MTN, Vodafone, AirtelTigo)", "flw"), KE: L("M-Pesa", "flw"), UG: L("MTN & Airtel mobile money", "flw"), TZ: L("M-Pesa, Tigo Pesa & Airtel Money", "flw"), RW: L("MTN & Airtel mobile money", "flw"), ZM: L("MTN & Airtel mobile money", "flw"), MW: L("Airtel Money & TNM Mpamba", "flw"),
  SN: L("Orange / Wave / Free Money", "flw"), CI: L("Orange / MTN / Moov mobile money", "flw"), BJ: L("MTN / Moov mobile money", "flw"), BF: L("Orange / Moov mobile money", "flw"), ML: L("Orange / Moov mobile money", "flw"), TG: L("T-Money / Moov mobile money", "flw"), NE: L("Airtel / Moov mobile money", "flw"), GN: L("Orange / MTN mobile money", "flw"), SL: L("Orange / Africell mobile money", "flw"),
  CM: L("MTN & Orange mobile money", "flw"), GA: L("Airtel & Moov mobile money", "flw"), CG: L("MTN & Airtel mobile money", "flw"), CD: L("Vodacom, Airtel & Orange mobile money", "flw"), ZA: L("Instant EFT / bank account", "flw"),
  EG: L("Fawry|Mobile wallets", "acq"), MA: L("CMI bank cards|Cash Plus", "acq"), ET: L("Telebirr", "acq"), TN: L("Local bank cards", "acq"), DZ: L("CIB / Edahabia cards", "acq"),
  NL: L("iDEAL", "acq"), BE: L("Bancontact", "acq"), DE: L("SEPA Direct Debit|Wero", "acq"), AT: L("EPS", "acq"), FR: L("Cartes Bancaires|Wero", "acq"), ES: L("Bizum", "acq"), IT: L("PostePay|Satispay", "acq"), PT: L("MB WAY|Multibanco", "acq"), PL: L("BLIK|Przelewy24", "acq"), SE: L("Swish", "acq"), DK: L("MobilePay", "acq"), NO: L("Vipps", "acq"), FI: L("MobilePay|Online banking", "acq"), CH: L("TWINT", "acq"), GB: L("Faster Payments / Open Banking", "acq"), IE: L("Local debit cards", "acq"), CZ: L("Bank transfers", "acq"), RU: L("Mir|SBP (restricted)", "acq"), UA: L("Local bank apps", "acq"), TR: L("Troy|Local bank cards", "acq"), GR: L("Local bank transfers", "acq"), RO: L("Local bank transfers", "acq"), HU: L("Local bank transfers", "acq"),
  US: L("ACH debit|Apple Pay & Google Pay", "acq"), CA: L("Interac e-Transfer", "acq"), MX: L("OXXO cash|SPEI", "acq"), BR: L("Pix|Boleto bancário", "acq"), AR: L("Mercado Pago|Rapipago", "acq"), CO: L("PSE|Nequi|Efecty", "acq"), CL: L("Webpay|Khipu", "acq"), PE: L("PagoEfectivo|Yape", "acq"), UY: L("Abitab / RedPagos", "acq"), EC: L("Local cash & bank methods", "acq"),
  CN: L("Alipay|WeChat Pay|UnionPay", "acq"), HK: L("FPS|Alipay HK", "acq"), TW: L("Convenience-store payment|LINE Pay", "acq"), JP: L("Konbini (convenience store)|PayPay|JCB", "acq"), KR: L("KakaoPay|Naver Pay|Toss", "acq"), IN: L("UPI|NetBanking|RuPay|Paytm", "acq"), PK: L("JazzCash|Easypaisa", "acq"), BD: L("bKash|Nagad", "acq"), LK: L("Local bank transfers", "acq"),
  ID: L("GoPay|OVO|DANA|QRIS|Virtual accounts", "acq"), TH: L("PromptPay|TrueMoney", "acq"), VN: L("MoMo|VNPay|ZaloPay", "acq"), PH: L("GCash|Maya", "acq"), MY: L("FPX|Touch 'n Go|GrabPay", "acq"), SG: L("PayNow|GrabPay", "acq"), KZ: L("Kaspi", "acq"), UZ: L("Payme|Click", "acq"),
  SA: L("Mada|STC Pay|Apple Pay", "acq"), AE: L("Apple Pay|Local bank cards", "acq"), KW: L("KNET", "acq"), BH: L("Benefit", "acq"), JO: L("CliQ", "acq"), IL: L("Bit", "acq"), AU: L("PayID|Afterpay", "acq"), NZ: L("Online banking", "acq"),
};
const ACQ = "needs a cross-border acquirer (e.g. EBANX, dLocal, Adyen, Airwallex or 2Checkout) — they onboard businesses individually, so it isn't self-serve yet";
const byCode = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
const blockedSet = () => new Set([...String(process.env.BLOCKED_COUNTRIES || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean), ...(process.env.SANCTIONS_DEFAULTS === "off" ? [] : SANCTIONED)]);
// flags: { mp2, fw, st, wr, cr, pyp } — what is connected.  sup: { flw: [...currencies], paypal: [...currencies] }
function coverageFor(cc, f, sup) {
  const c = byCode[cc]; if (!c) return null; const region = REGION_OF[cc] || "Other", cur = c.currency, card = f.fw || f.st, bl = blockedSet();
  const base = { code: cc, name: c.name, region, currency: cur };
  if (bl.has(cc)) return { ...base, blocked: true, caution: SANCTIONED.includes(cc) ? "Comprehensively sanctioned — payment providers refuse this country, so Sokoni blocks it. Routing it can get your provider accounts closed." : "Blocked by this platform's BLOCKED_COUNTRIES setting.", chargeNote: "", items: [] };
  const localBy = [(sup.flw || []).includes(cur) && f.fw && "Flutterwave", (sup.paypal || []).includes(cur) && f.pyp && "PayPal"].filter(Boolean);
  const can = [(sup.flw || []).includes(cur) && "Flutterwave", (sup.paypal || []).includes(cur) && "PayPal"].filter(Boolean);
  const chargeNote = localBy.length ? `Buyers here are charged in ${cur} (${localBy.join(", ")}); on other methods in USD. They always see the exact amount first.` : can.length ? `Buyers here can be charged in ${cur} once ${can.join(" or ")} is connected; until then in USD.` : `${cur} isn't supported by Flutterwave or PayPal, so buyers here are charged in USD and see the exact amount first.`;
  const it = (name, ok, note) => ({ name, status: ok ? "ready" : "setup", note: note || "" }), items = [];
  items.push(it("Cards (Visa / Mastercard)", card, localBy.length ? `charged in ${cur} where supported` : "charged in USD"));
  items.push(it("PayPal", f.pyp, cc === "CN" ? "rarely used in mainland China" : "available to buyers in most countries"));
  items.push(it("Bank transfer (wire / ACH / SEPA)", f.wr, "to your USD / EUR / GBP receiving account"));
  if (isMobileMoney(cc)) items.push(it(cc === "KE" ? "M-Pesa" : "Mobile money", cc === "KE" ? (f.mp2 || f.fw) : f.fw, "pays with a prompt on their phone"));
  items.push(CRYPTO_RESTRICTED.has(cc) ? { name: "Crypto / stablecoin", status: "restricted", note: "reported as banned or heavily restricted here — buyers may be unable to use it; verify local law" } : it("Crypto / stablecoin", f.cr, "USDT / USDC and others; payments are final"));
  for (const [n, k] of LOCAL[cc] || []) { if (cc === "KE" && n === "M-Pesa") continue; items.push(k === "flw" ? { name: n, status: f.fw ? "ready" : "setup", note: "through Flutterwave when enabled for this country and currency" } : { name: n, status: "later", note: ACQ }); }
  return { ...base, blocked: false, caution: CAUTION.has(cc) ? "Payment providers commonly restrict or heavily screen this country — confirm with yours before relying on it." : "", chargeNote, items, localListed: (LOCAL[cc] || []).length > 0 };
}
// every region, summarised across ALL its countries
function summary(f, sup) {
  const bl = blockedSet();
  return Object.entries(REGIONS).map(([region, codes]) => {
    const list = codes.split(" ").filter((c) => byCode[c]), live = list.filter((c) => !bl.has(c)), cov = live.map((c) => coverageFor(c, f, sup)), n = live.length;
    const mm = live.filter(isMobileMoney).length, cr = live.filter((c) => CRYPTO_RESTRICTED.has(c)).length, card = f.fw || f.st;
    const reach = live.filter((c) => (LOCAL[c] || []).some(([, k]) => k === "flw")), later = live.filter((c) => (LOCAL[c] || []).some(([, k]) => k === "acq"));
    const notable = [...new Set(later.flatMap((c) => (LOCAL[c] || []).filter(([, k]) => k === "acq").slice(0, 1).map(([m]) => `${m} (${c})`)))].slice(0, 9);
    const it = (name, ok, note) => ({ name, status: ok ? "ready" : "setup", note: note || "" }), items = [it("Cards (Visa / Mastercard)", card, `all ${n} countries`), it("PayPal", f.pyp, `most of the ${n} countries`), it("Bank transfer", f.wr, `all ${n} countries (USD / EUR / GBP account)`)];
    if (mm) items.push(it("Mobile money", f.fw, `${mm} of ${n} countries`));
    items.push(it("Crypto / stablecoin", f.cr, cr ? `restricted or banned in ${cr} of ${n} countries — verify local law` : `all ${n} countries (check local law)`));
    if (reach.length) items.push(it("Local methods you can reach", f.fw, `${reach.length} countries via Flutterwave`));
    if (later.length) items.push({ name: "Local methods not reachable yet", status: "later", note: `${later.length} of ${n} countries have popular local methods that ${ACQ.replace("needs", "need")}. Examples: ${notable.join(", ")}` });
    return { region, countries: list.length, blocked: list.length - n, items };
  });
}
module.exports = { REGIONS, REGION_OF, SANCTIONED, CAUTION, CRYPTO_RESTRICTED, LOCAL, isMobileMoney, coverageFor, summary, blockedSet, byCode };
