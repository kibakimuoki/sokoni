// Produce quality + authenticity screening from the live photos, using Claude vision (ANTHROPIC_API_KEY).
// One call looks at all photos and returns (a) a QUALITY REPORT buyers see — grade, freshness, ripeness, defects, shelf life — and
// (b) authenticity signals (screen re-capture, stock/AI-generated look, edits, mismatched product). These are model judgements from
// photos: useful signals, not laboratory measurements or proof.
const ai = require("./ai");
const isConfigured = () => ai.configured();
const GRADES = ["A", "B", "C", "reject"], RIPE = ["unripe", "ripe", "overripe", "not_applicable"], LEVELS = ["low", "medium", "high"], SEV = ["minor", "moderate", "severe"];
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
function cleanQuality(q) {
  if (!q || typeof q !== "object") return null; const grade = GRADES.includes(q.grade) ? q.grade : null; if (!grade) return null;
  const sl = q.shelfLifeDays && Number.isFinite(+q.shelfLifeDays.min) && Number.isFinite(+q.shelfLifeDays.max) ? { min: clampInt(q.shelfLifeDays.min, 0, 730), max: clampInt(q.shelfLifeDays.max, 0, 730) } : null;
  return { grade, freshness: clampInt(q.freshness, 0, 100), ripeness: RIPE.includes(q.ripeness) ? q.ripeness : "not_applicable", uniformity: LEVELS.includes(q.uniformity) ? q.uniformity : "medium", colour: String(q.colour || "").slice(0, 120), shelfLifeDays: sl && sl.min <= sl.max ? sl : null,
    defects: (Array.isArray(q.defects) ? q.defects : []).slice(0, 6).map((d) => ({ type: String(d.type || "").slice(0, 40), severity: SEV.includes(d.severity) ? d.severity : "minor", note: String(d.note || "").slice(0, 140) })).filter((d) => d.type),
    bestFor: (Array.isArray(q.bestFor) ? q.bestFor : []).map(String).filter((x) => ["fresh_market", "processing", "export", "animal_feed", "immediate_use"].includes(x)).slice(0, 4), confidence: LEVELS.includes(q.confidence) ? q.confidence : "medium", summary: String(q.summary || "").slice(0, 300) };
}
async function screenPhotos({ photos, crop, unit }) {
  if (!isConfigured()) return null;
  const live = !!((require("./catalog").cropInfo(crop) || {}).live);
  const liveNote = live ? `These are LIVE ANIMALS, so read the quality keys like this: grade A = healthy and in good body condition (alert, good coat or feathers, well fed); B = fair; C = thin, rough coat/feathers or minor visible problems; reject = visibly sick, injured or dead. "freshness" = overall body-condition score 0-100. ripeness = "not_applicable". shelfLifeDays = null. defects = visible problems only (injury, lameness, skin lesions, thinness, eye or nose discharge, parasites). bestFor = []. consistentAcrossPhotos = the same animals appear in every photo. This is NOT a veterinary examination: never say an animal is free of disease, only what is visible. ` : "";
  const prompt = `You are the ${live ? "livestock-condition" : "produce-quality"} and fraud-screening engine of a farm marketplace. A seller says these ${photos.length} photos were taken live right now and show: "${crop}".\n${liveNote}` +
    `Return ONLY one JSON object (no prose, no markdown) with exactly these keys:\n` +
    `{"matchesCrop":boolean,"consistentAcrossPhotos":boolean,"risk":"low"|"medium"|"high","signals":[any of "screen_recapture","stock_photo_look","ai_generated_look","watermark_or_text_overlay","edited_or_composited","different_products","studio_or_catalog_look","none"],` +
    `"quality":{"grade":"A"|"B"|"C"|"reject","freshness":0-100,"ripeness":"unripe"|"ripe"|"overripe"|"not_applicable","defects":[{"type":"e.g. bruising, mould, wilting, pest damage, cracks, discolouration, sprouting","severity":"minor"|"moderate"|"severe","note":"short"}],"uniformity":"low"|"medium"|"high","colour":"short description","shelfLifeDays":{"min":int,"max":int} or null,"bestFor":[any of "fresh_market","processing","export","animal_feed","immediate_use"],"confidence":"low"|"medium"|"high","summary":"one or two plain sentences a buyer can trust"}}\n` +
    `Grading: A = premium (fresh, uniform size/colour, no visible defects); B = good marketable quality with minor defects; C = acceptable for processing or discounted sale, notable defects; reject = spoiled/unsafe. ` +
    `Judge ONLY what is visible, consider the typical standards for ${crop}${unit ? " sold by the " + unit : ""}, and set confidence "low" if photos are blurry, dark or too few angles. If the photos do not show ${crop}, set matchesCrop=false. Be conservative and honest: these are signals, not proof.`;
  const content = photos.map((b64) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } })); content.push({ type: "text", text: prompt });
  const r = await ai.claude({ messages: [{ role: "user", content }], max_tokens: 900, kind: "photo-quality" }); if (!r.ok) return null;
  const o = ai.jsonOf(ai.textOf(r.data)); if (!o) { ai.last.ok = false; ai.last.error = "the model reply wasn't valid JSON"; return null; }
  return { matchesCrop: o.matchesCrop !== false, consistent: o.consistentAcrossPhotos !== false, risk: LEVELS.includes(o.risk) ? o.risk : "medium", signals: Array.isArray(o.signals) ? o.signals.map(String).slice(0, 8) : [], quality: cleanQuality(o.quality) };
}
// Reads the vehicle and its number plate from a live photo. The seller-typed plate is NOT shown to the model, so it can't just agree with us.
async function readPlate({ photo }) {
  if (!isConfigured()) return null;
  const prompt = `Look at this photo of a delivery vehicle. Return ONLY one JSON object (no prose): {"vehicleVisible":boolean,"vehicleType":"bicycle"|"motorbike"|"tuk-tuk"|"car"|"van"|"truck"|"other"|"none","plateVisible":boolean,"plate":"the registration plate text exactly as you can read it, uppercase, or an empty string","photoOfScreenOrPrint":boolean}. Never guess characters you cannot read clearly — if unsure set plateVisible to false and plate to "". Set photoOfScreenOrPrint to true if this looks like a photo of a screen or a printed picture rather than a real vehicle.`;
  const r = await ai.claude({ messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: photo } }, { type: "text", text: prompt }] }], max_tokens: 300, kind: "vehicle-plate" }); if (!r.ok) return null;
  const o = ai.jsonOf(ai.textOf(r.data)); if (!o) return null;
  return { vehicleVisible: o.vehicleVisible === true, vehicleType: String(o.vehicleType || "").slice(0, 20), plateVisible: o.plateVisible === true, plate: String(o.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12), screenOrPrint: o.photoOfScreenOrPrint === true };
}
// Reads an M-Pesa confirmation (SMS screenshot / statement). The result is only a pointer to the transaction code: Safaricom's own confirmation is what proves the payment.
async function readReceipt({ photo, mime }) {
  if (!isConfigured()) return null;
  const r = await ai.claude({ messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mime || "image/jpeg", data: photo } }, { type: "text", text: 'This should be a screenshot or photo of an M-Pesa confirmation message. Return ONLY one JSON object: {"looksLikeMpesa":boolean,"code":"the 10-character M-Pesa transaction code, uppercase, or empty","amount":number or null,"account":"the account number / reference, or empty"}. Never guess characters you cannot read.' }] }], max_tokens: 200, kind: "mpesa-receipt" }); if (!r.ok) return null;
  const o = ai.jsonOf(ai.textOf(r.data)); return o ? { looksLikeMpesa: o.looksLikeMpesa === true, code: String(o.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12), amount: Number(o.amount) || null, account: String(o.account || "") } : null;
}
module.exports = { readReceipt, readPlate, isConfigured, screenPhotos, cleanQuality, provider: "anthropic" };
