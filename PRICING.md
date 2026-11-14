# Delivery price, who pays, and what Sokoni keeps

## 1. The delivery price is a formula, not a guess
Every local delivery is priced from four things: **how far**, **how heavy**, **which vehicle that load needs**, and **whether it must stay cool**. The same inputs always give the same price, so it is explainable and fair. (The AI is *not* setting prices. Its only job is optional and invisible: when a seller sells by the crate, box or bunch and hasn't said what one weighs, it estimates that weight once per crop. The estimate is kept only if it is plausible, and the seller's own figure always wins.)

**How heavy is the load?** Liquids are weighed by volume - a litre of milk is about 1.03 kg, of oil 0.92 kg and of honey 1.42 kg, plus about 4% for the container; a jerrycan, drum and tank are 20, 200 and 1,000 litres. For everything else: kg and bags are exact; a tonne is 1,000 kg; a crate is about 22 kg for vegetables (20 fruit, 30 roots and tubers…); a banana bunch about 15 kg; a leafy bunch about 0.3 kg. A seller can type the real weight of one crate/box/bunch when listing.

**Which vehicle?** The smallest motor vehicle that can carry it that far (a bicycle rider may still take a short, light job):

| Vehicle | Carries up to | Base | Per km | Longest trip |
|---|---|---|---|---|
| Motorbike (boda) | 80 kg | US$0.80 | US$0.20 | 60 km |
| Tuk-tuk | 300 kg | US$1.50 | US$0.30 | 40 km |
| Car / van | 500 kg | US$2.50 | US$0.40 | 200 km |
| Pickup truck | 1,200 kg | US$4.00 | US$0.60 | 300 km |

A small extra is added for each 10 kg above what the vehicle's base price covers. **Chilled** loads cost 25% more, **frozen** 50% more. A load over 1,200 kg (or a trip too far) goes to **freight quotes** from transport companies instead. Only riders whose vehicle can carry the job are offered it.

*Examples at KES 129 to the US dollar:* 20 kg of tomatoes over 10 km ≈ KES 360 (motorbike) · 88 kg (4 crates) over 12 km ≈ KES 660 (tuk-tuk) · 100 kg of avocado over 20 km ≈ KES 975 (tuk-tuk) · 450 kg of maize over 25 km ≈ KES 1,690 (van) · 2 tonnes → freight quotes.

*These rates and capacities are starting points, not Kenyan market data. Compare them with what riders really charge and adjust.*

## 2. Who pays the rider
- The **rider takes home the whole fee** (minus a Sokoni cut, which is 0% until you set `RIDER_CUT_PCT`). They are paid instantly when the buyer's delivery code is confirmed.
- The **buyer pays most** of it, added to their total.
- The **seller covers a share**, deducted from their payout: **30%** of the fee, but **never more than 10% of the value of what they are selling**, so a small farmer never pays more than a slice of the sale. Example: fee KES 1,200 on goods worth KES 5,500 → seller KES 360, buyer KES 840. On a tiny order (fee KES 104, goods KES 100) → seller KES 10, buyer KES 94.
- If a dispute ends in a **refund**, the buyer gets back everything they paid. The rider has already been paid, and the seller's share isn't collected, so Sokoni absorbs that share. This is rare and small.

## 3. What Sokoni really keeps (target: 5% net)
Gross commission is not profit. Out of it come the payment provider's fee on what the buyer paid, a fee for every payout to a seller or rider, and coins used as fee credit. So a **5% gross commission nets only about 3.3%** on a typical M-Pesa order. The default commission is therefore **7%**, which nets about **5.3%** (US$100 order: US$7.00 − US$1.50 provider − US$0.20 payout = US$5.30). The 0.05%-each-side **coin levy** is collected on top (US$0.10 on that order, before any coins are later used as fee credit), which lifts it to about **5.4%** — see COIN.md.

The cost figures are **assumptions** until you replace them with your real fee schedules: M-Pesa/Equity 1.5% (`COST_PCT_MPESA`), crypto 1.0% (`COST_PCT_CRYPTO`), bank transfer 0.2% (`COST_PCT_BANK`), card 3.5% (`COST_PCT_CARD`), PayPal 4% (`COST_PCT_PAYPAL`), US$0.20 per payout (`COST_FIXED_PAYOUT_USD`).

**Operations → Economics** works out the real net on finished orders (by how the buyer paid), warns when it is under target, and recommends the commission that would hit 5% at your measured costs. Check it after your first dozen real orders and adjust `PLATFORM_COMMISSION_PERCENT`.
*Very small orders can't reach 5%:* the fixed payout fee dominates. Consider a minimum order value.

## 4. Settings (all optional; defaults shown)
`PLATFORM_COMMISSION_PERCENT=7` · `NET_TARGET_PERCENT=5` · `DELIVERY_SELLER_SHARE_PCT=30` · `DELIVERY_SELLER_CAP_PCT=10` · `RIDER_CUT_PCT=0` · `DELIVERY_MIN_USD=0.8` · `DELIVERY_RATE_MULT=1` (scales every price) · `DELIVERY_CHILLED_MULT=1.25` · `DELIVERY_FROZEN_MULT=1.5` · `COST_PCT_MPESA` · `COST_PCT_CRYPTO` · `COST_PCT_BANK` · `COST_PCT_CARD` · `COST_PCT_PAYPAL` · `COST_FIXED_PAYOUT_USD`
