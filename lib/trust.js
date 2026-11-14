// Listing trust layer. Camera-only capture raises the cost of faking a listing; it does NOT prove produce exists.
// Signals combined: single-use capture session (freshness) · capture timestamps · device metadata · location evidence ·
// SHA-256 + perceptual hashing (duplicates, reused photos) · AI screening · seller reputation.
const crypto = require("crypto");
const store = require("./store");
const { signToken, verifyToken } = require("./auth");
const { haversineKm } = require("./geo");
let sharp = null; try { sharp = require("sharp"); } catch (e) { /* optional: server-side perceptual hashing */ }
// Sokoni only ever decodes JPEG and PNG photos (checked before this point); switch off the other decoders a stranger could try to abuse (sharp security advisory GHSA-f88m-g3jw-g9cj).
if (sharp && typeof sharp.block === "function") try { sharp.block({ operation: ["VipsForeignLoadNsgif", "VipsForeignLoadTiff", "VipsForeignLoadVips"] }); } catch (e) { /* older sharp: nothing to block */ }
const PHOTO_COUNT = 5;
const MAX_MIN = Number(process.env.CAPTURE_MAX_MINUTES || 20);
const DUP_CROSS = Number(process.env.PHOTO_NEAR_DUP_DISTANCE || 4), DUP_INTRA = Number(process.env.PHOTO_INTRA_MIN_DISTANCE || 2);
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const popcnt = (n) => { let c = 0; while (n) { c += Number(n & 1n); n >>= 1n; } return c; };
const hamming = (a, b) => (a && b && a.length === 16 && b.length === 16 ? popcnt(BigInt("0x" + a) ^ BigInt("0x" + b)) : 64);
async function dhash(buf) {
  if (!sharp) return null;
  const px = await sharp(buf).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer(); let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}
function sellerStats(userId) {
  const orders = store.readAll("orders").filter((o) => o.farmerId === userId);
  const completed = orders.filter((o) => o.buyerConfirmedAt && ["payout_pending", "payout_initiated", "paid_out", "payout_failed"].includes(o.paymentStatus)).length;
  const lost = orders.filter((o) => o.disputeResolution === "refund").length;
  const level = lost >= 2 ? "watch" : completed >= 10 && lost === 0 ? "trusted" : completed >= 3 && lost <= 1 ? "established" : "new";
  return { completed, lost, level, score: Math.max(0, Math.min(100, 30 + completed * 7 - lost * 30)) };
}
async function issueSession(userId) {
  const stats = sellerStats(userId); const jti = crypto.randomUUID(), issuedAt = Date.now();
  await store.mutate("capture_sessions", (all) => [...all.filter((x) => Date.now() - x.issuedAt < 6 * 3600e3), { jti, userId, issuedAt, used: false }]);
  return { token: signToken({ typ: "cap", sub: userId, jti, exp: issuedAt + MAX_MIN * 60000 }), photos: PHOTO_COUNT, minutes: MAX_MIN, level: stats.level };
}
async function consumeSession(token, userId) {
  const p = verifyToken(token); if (!p || p.typ !== "cap" || p.sub !== userId) return null; let found = null;
  await store.mutate("capture_sessions", (all) => all.map((s) => { if (s.jti === p.jti && !s.used && s.userId === userId) { found = s; return { ...s, used: true }; } return s; })); return found;
}
const jpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
async function evaluate({ userId, session, photos, pin, country, deviceMeta, ai, sellerLevel, excludeListingId }) {
  const reject = [], flags = [], f = (id, severity, text) => flags.push({ id, severity, text }); const now = Date.now();
  if (!Array.isArray(photos) || photos.length !== PHOTO_COUNT) return { rejections: [`Take exactly ${PHOTO_COUNT} live photos with the camera.`], flags, level: "rejected", score: 0 };
  const out = [];
  for (const [i, p] of photos.entries()) {
    const buf = Buffer.from(String(p.data || ""), "base64");
    if (!jpeg(buf) || buf.length > 1.6e6 || buf.length < 4000) { reject.push(`Photo ${i + 1} isn't a valid camera capture.`); continue; }
    const at = Date.parse(p.capturedAt); if (!at || at < session.issuedAt - 60000 || at > now + 60000) { reject.push(`Photo ${i + 1} wasn't taken during this capture session.`); continue; }
    const hash = sha256(buf); if (p.hash && p.hash !== hash) { reject.push(`Photo ${i + 1} was altered after capture.`); continue; }
    let dh = null; try { dh = await dhash(buf); } catch (e) { /* undecodable */ }
    if (!dh && sharp) { reject.push(`Photo ${i + 1} couldn't be decoded as an image.`); continue; } if (!dh) { dh = /^[0-9a-f]{16}$/.test(p.dhash || "") ? p.dhash : null; f("dhash_unverified", "minor", "Perceptual hash came from the device"); }
    out.push({ buf, hash, dh, at, geo: p.geo && Number.isFinite(p.geo.lat) && Number.isFinite(p.geo.lng) ? { lat: +p.geo.lat, lng: +p.geo.lng, acc: +p.geo.acc || null } : null });
  }
  if (reject.length) return { rejections: reject, flags, level: "rejected", score: 0 };
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) if (out[i].hash === out[j].hash || hamming(out[i].dh, out[j].dh) <= DUP_INTRA) reject.push(`Photos ${i + 1} and ${j + 1} look the same — take 5 different shots (angles, close-up, packaging).`);
  const index = store.readAll("photo_index").filter((x) => x.listingId !== excludeListingId), other = {}, own = new Set();
  for (const [i, p] of out.entries()) {
    if (index.some((x) => x.sha === p.hash)) reject.push(`Photo ${i + 1} was already used on Sokoni — only fresh photos are allowed.`);
    else for (const x of index) if (hamming(x.dhash, p.dh) <= DUP_CROSS) { if (x.sellerId === userId) own.add(i); else (other[x.listingId] = other[x.listingId] || new Set()).add(i); }
  }
  const worst = Math.max(0, ...Object.values(other).map((x) => x.size)); // photos matching the SAME other listing
  if (worst >= 2) f("near_duplicate_other_seller", "major", "Several photos look almost the same as another listing"); else if (worst === 1) f("similar_photo_other_seller", "minor", "One photo looks similar to another seller's listing");
  if (own.size) f("reused_own_photo", "minor", "Some photos look like your earlier listings");
  if (reject.length) return { rejections: reject, flags, level: "rejected", score: 0 };
  const geos = out.map((p) => p.geo).filter(Boolean);
  if (!geos.length) f("no_location", "minor", "No location evidence on the photos"); else {
    let spread = 0; for (const a of geos) for (const b of geos) spread = Math.max(spread, haversineKm(a.lat, a.lng, b.lat, b.lng));
    if (spread > 1) f("photos_spread_out", "minor", "Photos were taken in different places");
    const radius = pin && pin.from === "gps" ? 5 : Number(process.env.PIN_TOWN_RADIUS_KM || 60); // a town-centre pin is only approximate; a GPS pin is exact
    if (pin && geos.some((g) => haversineKm(g.lat, g.lng, pin.lat, pin.lng) > radius)) f("far_from_pin", "major", "Photos were taken far from the listed location");
  }
  if (deviceMeta && deviceMeta.webdriver) f("automation_detected", "minor", "Automated browser detected");
  if (!deviceMeta || !deviceMeta.camera) f("no_device_info", "minor", "Missing device information");
  let aiNote = null;
  if (ai) { aiNote = (ai.quality && ai.quality.summary) || null;
    if (!ai.matchesCrop) f("ai_crop_mismatch", "major", "Photos don't appear to show the listed product");
    if (ai.quality && ai.quality.grade === "reject") f("ai_quality_reject", "major", "The produce looks spoiled or unsafe in the photos");
    if (!ai.consistent) f("ai_inconsistent", "major", "Photos don't look like the same produce/place");
    if (ai.risk === "high") f("ai_high_risk", "major", "Automatic screening rated this listing high risk"); else if (ai.risk === "medium") f("ai_medium_risk", "minor", "Automatic screening raised some concerns");
    ai.signals.filter((s) => s !== "none").forEach((s) => f("ai_" + s, ["screen_recapture", "ai_generated_look", "stock_photo_look", "edited_or_composited"].includes(s) ? "major" : "minor", "Automatic signal: " + s.replace(/_/g, " ")));
  } else f("ai_unavailable", "minor", "Automatic screening wasn't available");
  const pen = flags.reduce((s, x) => s + (x.severity === "major" ? 30 : 8), 0); const score = Math.max(0, 100 - pen);
  const level = flags.some((x) => x.severity === "major") ? "review" : score >= 80 ? "high" : "medium";
  return { rejections: [], flags, score, level, aiNote, photos: out, geoMatched: !!(geos.length && pin && !flags.some((x) => x.id === "far_from_pin")), sellerLevel };
}
// Rider sign-up: the number-plate photo must be taken live, but there is no account yet, so the session is anonymous (still single-use and short-lived).
async function issueAnon() { const jti = crypto.randomUUID(), issuedAt = Date.now(); await store.mutate("capture_sessions", (all) => [...all.filter((x) => Date.now() - x.issuedAt < 6 * 3600e3), { jti, userId: null, issuedAt, used: false }]); return { token: signToken({ typ: "cap", sub: "anon", jti, exp: issuedAt + MAX_MIN * 60000 }), minutes: MAX_MIN }; }
async function consumeAnon(token) { const p = verifyToken(token); if (!p || p.typ !== "cap" || p.sub !== "anon") return null; let found = null; await store.mutate("capture_sessions", (all) => all.map((s) => { if (s.jti === p.jti && !s.used && s.userId === null) { found = s; return { ...s, used: true }; } return s; })); return found; }
// One live photo (e.g. a vehicle with its plate): fresh, untampered, never used before. Returns { buf, hash, at } or { error }.
function checkOnePhoto(session, photo, ownSha) {
  if (!session) return { error: "Your camera session expired. Take the photo again." }; const p = photo || {}, buf = Buffer.from(String(p.data || ""), "base64");
  if (!jpeg(buf) || buf.length > 1.6e6 || buf.length < 4000) return { error: "That isn't a valid camera photo. Take it again with the camera." };
  const at = Date.parse(p.capturedAt), now = Date.now(); if (!at || at < session.issuedAt - 60000 || at > now + 60000) return { error: "The photo wasn't taken just now. Take it again with the camera." };
  const hash = sha256(buf); if (p.hash && p.hash !== hash) return { error: "The photo was altered after it was taken. Take it again." };
  if (store.readAll("photo_index").some((x) => x.sha === hash) || store.readAll("vehicle_photos").some((x) => x.sha === hash && x.sha !== ownSha)) return { error: "This photo has already been used on Sokoni. Take a fresh one." };
  return { buf, hash, at };
}
module.exports = { issueAnon, consumeAnon, checkOnePhoto, PHOTO_COUNT, issueSession, consumeSession, evaluate, sellerStats, sha256, hamming, hasSharp: !!sharp };
