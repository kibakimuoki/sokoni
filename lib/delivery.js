// What a local delivery costs, which vehicle it needs, who pays what — and what the rider earns.
// The price is a plain formula (so it is explainable, fair and never changes by mood). The only "smart" part is estimating how heavy a
// crate or a bunch of a given crop is when the seller hasn't said; that estimate is cached, bounded and invisible to users.
const catalog = require("./catalog"), geo = require("./countries"), store = require("./store");
const num = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) ? v : d; }, clamp = (n, a, b) => Math.min(b, Math.max(a, n));

// Smallest → largest. cap = the most it can safely carry (kg). base / perKm in US$; perTenKg = extra per 10 kg above "free" kg; maxKm = the longest trip it is sensible for.
const VEHICLES = [
  { id: "Bicycle", cap: 15, base: 0.8, perKm: 0.2, free: 15, perTenKg: 0, maxKm: 6 },
  { id: "Motorbike (boda)", cap: 80, base: 0.8, perKm: 0.2, free: 20, perTenKg: 0.04, maxKm: 60 },
  { id: "Tuk-tuk", cap: 300, base: 1.5, perKm: 0.3, free: 80, perTenKg: 0.03, maxKm: 40 },
  { id: "Car / van", cap: 500, base: 2.5, perKm: 0.4, free: 150, perTenKg: 0.02, maxKm: 200 },
  { id: "Pickup truck", cap: 1200, base: 4, perKm: 0.6, free: 300, perTenKg: 0.02, maxKm: 300 },
];
const vehicleOf = (type) => VEHICLES.find((v) => v.id === type) || null;
// the smallest vehicle that can take this load this far (null = too heavy/far for local riders → freight quotes)
// (a bicycle rider may still take a short, light job — see canCarry — but the price and the label are for a motorbike, the smallest motor vehicle)
const requiredVehicle = (weightKg, km, minId) => VEHICLES.slice(Math.max(1, VEHICLES.findIndex((v) => v.id === minId))).find((v) => weightKg <= v.cap && (km == null || km <= v.maxKm)) || null;
const canCarry = (type, weightKg, km, minId, strict) => { const v = vehicleOf(type); if (!v) return true; if (strict && minId && VEHICLES.indexOf(v) < VEHICLES.findIndex((x) => x.id === minId)) return false; return weightKg <= v.cap && (km == null || km <= v.maxKm); }; // a bigger vehicle may take a lighter load

// ---- how heavy is one unit? ----
const HEAD_KG = [[/camel/i, 450], [/donkey/i, 150], [/dairy|cow/i, 400], [/beef|steer|bull|cattle/i, 350], [/calves|calf/i, 80], [/pig/i, 90], [/sheep|mutton/i, 40], [/goat/i, 35], [/turkey/i, 6], [/goose|geese/i, 5], [/duck/i, 2.5], [/rabbit/i, 2.5], [/guinea/i, 1.5], [/quail/i, 0.2], [/chicken|broiler|layer|kienyeji/i, 2]];
// the smallest vehicle a living animal may travel in, whatever its weight (a goat is light, but it does not go on a motorbike)
const LIVE_MIN = [[/cattle|cow|calves|calf|camel|donkey/i, "Pickup truck"], [/pig|goat|sheep/i, "Tuk-tuk"], [/chicken|turkey|duck|goose|geese|rabbit|guinea|quail/i, "Motorbike (boda)"]];
const minVehicleFor = (crop) => { const i = catalog.cropInfo(crop); if (!i || !i.live) return null; const h = LIVE_MIN.find(([re]) => re.test(crop)); return h ? h[1] : "Pickup truck"; };
const LITRES = { litre: 1, jerrycan20: 20, drum200: 200, tank1000: 1000 }, density = (crop) => (/honey/i.test(crop) ? 1.42 : /oil/i.test(crop) ? 0.92 : /milk|yoghurt|mala/i.test(crop) ? 1.03 : 1.04); // kg per litre; +4% for the container
const UNIT_KG = { kg: 1, tonne: 1000, lb: 0.4536, bag50: 50, bag90: 90, pallet: 600, container20: 18000, container40: 26000 };
const CRATE_KG = { Vegetables: 22, Fruits: 20, "Roots & tubers": 30, Grains: 25, Pulses: 25, "Nuts & seeds": 20, "Cash crops": 25, Spices: 15, Flowers: 8, "Herbs & leaves": 8, Other: 20, "Medicinal & other": 15 };
const BUNCH_KG = { "Herbs & leaves": 0.3, Vegetables: 0.5, Fruits: 1, Flowers: 0.3 };
function tableKg(crop, unit) {
  if (LITRES[unit]) return Math.round(LITRES[unit] * density(crop) * 1.04 * 100) / 100;
  if (unit === "head") { const h = HEAD_KG.find(([re]) => re.test(crop)); return h ? h[1] : 50; } if (unit === "tray") return 2; if (unit === "dozen") return 0.75;
  if (UNIT_KG[unit] != null) return UNIT_KG[unit]; const info = catalog.cropInfo ? catalog.cropInfo(crop) : null, cat = (info && info.category) || "Other";
  if (unit === "crate") return CRATE_KG[cat] || 20; if (unit === "box") return /flower|herb/i.test(cat) ? 4 : 12;
  if (unit === "bunch") return /banana|plantain/i.test(crop) ? 15 : BUNCH_KG[cat] || 0.5; return 1;
}
const cachedKg = (crop, unit) => { try { const r = store.readAll("unit_weights").find((x) => x.key === `${crop}|${unit}`); return r ? r.kg : null; } catch { return null; } };
function weight({ crop, unit, quantity, unitKg }) { // → { weightKg, perUnitKg, source }
  const own = Number(unitKg), cached = cachedKg(crop, unit); let per, source;
  if (own > 0 && own <= 2000) { per = own; source = "seller"; } else if (cached) { per = cached; source = "estimate"; } else { per = tableKg(crop, unit); source = "table"; }
  return { weightKg: Math.round(per * Number(quantity || 0) * 10) / 10, perUnitKg: per, source };
}
// Optional, background: ask the AI once what a crate/box/bunch of this crop weighs; keep it only if plausible. Never blocks anything.
async function refineUnitWeight(crop, unit) {
  try { if (!["crate", "box", "bunch"].includes(unit) || cachedKg(crop, unit)) return null; const ai = require("./ai"); if (!ai.configured()) return null;
    const r = await ai.claude({ system: "You estimate the typical weight of ONE sales unit of fresh produce in East African markets. Reply with JSON only: {\"kg\": number}.", messages: [{ role: "user", content: `Typical weight in kg of one ${unit} of ${crop}?` }], max_tokens: 60, kind: "unit-weight" });
    if (!r.ok) return null; const j = ai.jsonOf(ai.textOf(r.data)), kg = j && Number(j.kg), base = tableKg(crop, unit); if (!(kg > 0) || kg < base / 5 || kg > base * 5) return null; // implausible: ignore
    await store.mutate("unit_weights", (all) => (all.some((x) => x.key === `${crop}|${unit}`) ? all : [...all, { key: `${crop}|${unit}`, kg: Math.round(kg * 100) / 100, source: "ai", at: new Date().toISOString() }])); return kg;
  } catch { return null; }
}

// ---- the price (in US$; the caller converts) ----
function priceUsd({ km, weightKg, temperature, crop }) {
  const need = requiredVehicle(weightKg, km, minVehicleFor(crop)); if (!need) return { error: weightKg > VEHICLES[VEHICLES.length - 1].cap ? "This load is too heavy for a local rider (about " + Math.round(weightKg) + " kg). Please request freight quotes — a transport company can carry it." : "This trip is too far for a local rider. Please request freight quotes." };
  const tf = temperature === "frozen" ? num("DELIVERY_FROZEN_MULT", 1.5) : temperature === "chilled" ? num("DELIVERY_CHILLED_MULT", 1.25) : 1, d = Number.isFinite(km) ? km : 0;
  const raw = (need.base + need.perKm * d + need.perTenKg * Math.max(0, weightKg - need.free) / 10) * tf * num("DELIVERY_RATE_MULT", 1);
  return { usd: Math.max(num("DELIVERY_MIN_USD", 0.8), raw), vehicle: need.id };
}
// ---- who pays: the buyer pays most; the seller covers a share, but never more than a slice of what they are selling ----
function split(total, goodsValue, currency) {
  const sellerPct = clamp(num("DELIVERY_SELLER_SHARE_PCT", 30), 0, 100), capPct = clamp(num("DELIVERY_SELLER_CAP_PCT", 10), 0, 100);
  const seller = geo.roundMoney(Math.min((total * sellerPct) / 100, (goodsValue * capPct) / 100), currency); return { seller, buyer: geo.roundMoney(total - seller, currency) };
}
// ---- what the rider takes home: the whole fee, minus Sokoni's cut (0% by default) ----
const riderPay = (total, currency) => geo.roundMoney(total * (1 - clamp(num("RIDER_CUT_PCT", 0), 0, 50) / 100), currency);
module.exports = { minVehicleFor, VEHICLES, vehicleOf, requiredVehicle, canCarry, weight, tableKg, refineUnitWeight, priceUsd, split, riderPay };
