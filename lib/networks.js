// The mobile-money networks a Kenyan buyer may pay with. What each one can do depends on what EQUITY has confirmed / switched on for YOUR merchant account,
// so it is controlled by two settings (Operations → Payment setup → Equity, or your settings file) instead of being hard-wired:
//   PAYBILL_NETWORKS  networks whose customers can pay Equity's Pay Bill 247247 by hand        (default: mpesa, airtel, equitel)
//   PROMPT_NETWORKS   networks that can be sent a PIN prompt through Equity's API              (default: mpesa)
// Equity documents the PIN prompt for Safaricom (M-Pesa) and, as a separate product that Finserve must authorise for you, Equitel. Nothing is published for an
// Airtel Money or T-Kash prompt: add them to PROMPT_NETWORKS only after Finserve confirms. Telkom's T-Kash isn't confirmed for Pay Bill either, so it is off until you add "tkash".
const NETWORKS = [
  { id: "mpesa", name: "M-Pesa", telco: "Safaricom" },
  { id: "airtel", name: "Airtel Money", telco: "Airtel" },
  { id: "equitel", name: "Equitel", telco: "Equitel" },
  { id: "tkash", name: "T-Kash", telco: "Telkom" },
];
const words = (v, d) => String(v == null || String(v).trim() === "" ? d : v).toLowerCase().split(/[\s,;]+/).filter(Boolean);
const get = (id) => NETWORKS.find((n) => n.id === String(id || "").toLowerCase()) || null;
const paybillOn = (id) => words(process.env.PAYBILL_NETWORKS, "mpesa,airtel,equitel").includes(id), promptOn = (id, provider) => words(process.env.PROMPT_NETWORKS, provider === "paystack" ? "mpesa,airtel" : "mpesa").includes(id); // Paystack can prompt Airtel Money in Kenya, so it is on by default there; through Equity it stays off until Finserve confirms
// a Kenyan mobile number in international form (Safaricom 07…/011…, Airtel 073/078/010…, Telkom 077…, Equitel 076…)
const kenyanMobile = (msisdn) => /^254(?:7\d{8}|1[01]\d{7})$/.test(String(msisdn || ""));
module.exports = { NETWORKS, get, paybillOn, promptOn, kenyanMobile };
