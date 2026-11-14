// What Sokoni REALLY keeps. Gross commission is not profit: the payment provider takes a cut of what the buyer paid, every payout costs a fee,
// and coins used as fee credit are money Sokoni gives back. This module works out the net for each finished order and for the business.
// The cost figures below are ASSUMPTIONS — replace them (COST_* settings) with your real Equity / NOWPayments fee schedules.
const fx = require("./fx"), geo = require("./countries"), delivery = require("./delivery");
const num = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) ? v : d; };
const methodOf = (o) => ({ jenga: "mpesa", fincra: "mpesa", paystack: "mpesa", mpesa: "mpesa", nowpayments: "crypto", bank_wire: "bank", stripe: "card", flutterwave: "card", paypal: "paypal", test: "none" }[o.paymentProvider] || "mpesa");
const costPct = (method) => ({ mpesa: num("COST_PCT_MPESA", 1.5), crypto: num("COST_PCT_CRYPTO", 1.0), bank: num("COST_PCT_BANK", 0.2), card: num("COST_PCT_CARD", 3.5), paypal: num("COST_PCT_PAYPAL", 4.0), none: 0 }[method] || 0);
const targetPct = () => num("NET_TARGET_PERCENT", 5);
// → everything in the ORDER's currency
function orderEconomics(o) {
  const r = o.currency === "USD" ? 1 : fx.rateSync("USD", o.currency) || 1, goods = o.amount || 0, paid = o.total != null ? o.total : goods + (o.deliveryFee || 0), method = methodOf(o);
  const levy = (o.coinLevyBuyer || 0) + (o.coinLevySeller || 0), gross = (o.commission || 0) + levy, riderCut = o.deliveryTotal ? geo.roundMoney(o.deliveryTotal - delivery.riderPay(o.deliveryTotal, o.currency), o.currency) : 0;
  const providerFee = geo.roundMoney((paid * costPct(method)) / 100, o.currency), payouts = 1 + (o.deliveryId ? 1 : 0), payoutFees = geo.roundMoney(payouts * num("COST_FIXED_PAYOUT_USD", 0.2) * r, o.currency), coinCost = o.coinBonus || 0;
  const net = geo.roundMoney(gross + riderCut - providerFee - payoutFees - coinCost, o.currency);
  return { method, goods, gross, levy, riderCut, providerFee, payoutFees, coinCost, net, netPct: goods > 0 ? Math.round((net / goods) * 10000) / 100 : 0, currency: o.currency, usdRate: r };
}
const toUsd = (amount, e) => amount / e.usdRate;
// → business-wide figures (US$) over finished orders
function summary(orders) {
  const t = { orders: 0, goodsUsd: 0, levyUsd: 0, grossUsd: 0, riderCutUsd: 0, providerUsd: 0, payoutUsd: 0, coinUsd: 0, netUsd: 0 }, by = {};
  for (const o of orders) { const e = orderEconomics(o); t.orders++; t.goodsUsd += toUsd(e.goods, e); t.grossUsd += toUsd(e.gross, e); t.levyUsd += toUsd(e.levy, e); t.riderCutUsd += toUsd(e.riderCut, e); t.providerUsd += toUsd(e.providerFee, e); t.payoutUsd += toUsd(e.payoutFees, e); t.coinUsd += toUsd(e.coinCost, e); t.netUsd += toUsd(e.net, e);
    const b = by[e.method] || (by[e.method] = { orders: 0, goodsUsd: 0, netUsd: 0 }); b.orders++; b.goodsUsd += toUsd(e.goods, e); b.netUsd += toUsd(e.net, e); }
  const r2 = (n) => Math.round(n * 100) / 100, pct = (n, d) => (d > 0 ? Math.round((n / d) * 10000) / 100 : 0), costsUsd = t.providerUsd + t.payoutUsd + t.coinUsd - t.riderCutUsd;
  for (const k of Object.keys(by)) { by[k] = { orders: by[k].orders, goodsUsd: r2(by[k].goodsUsd), netUsd: r2(by[k].netUsd), netPct: pct(by[k].netUsd, by[k].goodsUsd) }; }
  const costPctOfGoods = pct(costsUsd, t.goodsUsd), commissionPct = num("PLATFORM_COMMISSION_PERCENT", 7);
  return { orders: t.orders, goodsUsd: r2(t.goodsUsd), grossUsd: r2(t.grossUsd), levyUsd: r2(t.levyUsd), costs: { providerUsd: r2(t.providerUsd), payoutUsd: r2(t.payoutUsd), coinUsd: r2(t.coinUsd), riderCutUsd: r2(t.riderCutUsd) }, netUsd: r2(t.netUsd), netPct: pct(t.netUsd, t.goodsUsd), targetPct: targetPct(), commissionPct, costPctOfGoods,
    recommendedCommissionPct: t.goodsUsd > 0 ? Math.ceil((targetPct() + costPctOfGoods) * 2) / 2 : null, byMethod: by };
}
// a typical-order estimate, used before there is any history: assumed costs as a share of the goods value
const assumedCostPct = () => costPct("mpesa") + (num("COST_FIXED_PAYOUT_USD", 0.2) * 2 / 50) * 100 * 0.5 + 0.05; // M-Pesa fee + (a payout or two on a ~US$50 order) + coin credits
module.exports = { orderEconomics, summary, assumedCostPct, targetPct, methodOf };
