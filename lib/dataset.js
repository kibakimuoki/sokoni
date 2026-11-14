// Every product-quality label the system produces is kept TOGETHER WITH ITS PHOTOS, so a better model can be trained later.
// Later real-world outcomes (a dispute upheld or rejected, a trade completed without complaint) are attached as ground truth: they tell us whether a label was right.
// Privacy: no names, phones, e-mails or exact places are stored here; a record is tied to a listing only through a one-way key. Export drops even that.
const fs = require("fs"), path = require("path"), crypto = require("crypto"), store = require("./store"), catalog = require("./catalog");
const DIR = () => path.join(store.DATA_DIR, "dataset"), IMGS = () => path.join(DIR(), "images"), UPLOADS = () => path.join(store.DATA_DIR, "uploads");
const keyOf = (listingId) => crypto.createHash("sha256").update("sokoni-dataset|" + listingId + "|" + (process.env.SERVER_SECRET || "")).digest("hex").slice(0, 24), sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const PROMPT_VERSION = "quality-v1";
function snapshot(listing, rid) { // copy the listing's photos into the dataset folder so they survive if the listing is later deleted
  fs.mkdirSync(IMGS(), { recursive: true }); const out = [];
  for (const [i, p] of (listing.photos || []).entries()) { try { const buf = fs.readFileSync(path.join(UPLOADS(), path.basename(p.url))), file = `${rid}-${i + 1}.jpg`; fs.writeFileSync(path.join(IMGS(), file), buf); out.push({ file, sha256: sha(buf) }); } catch (e) { /* photo missing: keep the label anyway */ } }
  return out;
}
async function record({ listing, quality, model, source }) { // → the stored record, or null
  if (!listing || !quality || listing.trainingOptOut) return null; const lk = keyOf(listing.id), labels = JSON.stringify(quality), existing = store.readAll("quality_dataset").filter((r) => r.listingKey === lk);
  if (existing.some((r) => JSON.stringify(r.labels) === labels)) return null; // the same answer again adds nothing
  const rid = `${lk}-${existing.length + 1}`, info = (catalog.cropInfo && catalog.cropInfo(listing.crop)) || {}, rec = { id: rid, listingKey: lk, round: existing.length + 1, crop: listing.crop, category: info.category || null, country: listing.country || null, unit: listing.unit || null, temperature: listing.temperature || null,
    labels: quality, labelSource: source || "ai", model: model || null, promptVersion: PROMPT_VERSION, images: snapshot(listing, rid), consent: true, outcomes: [], createdAt: new Date().toISOString() };
  await store.mutate("quality_dataset", (all) => [...all, rec]); return rec;
}
async function addOutcome(listingId, outcome) { // e.g. { type: "dispute_buyer_won", order: "<order id>", reason: "…" } — attached to every record of that listing, once per order
  if (!listingId || !outcome || !outcome.type) return 0; const lk = keyOf(listingId), ok = crypto.createHash("sha256").update("o|" + (outcome.order || "") + "|" + outcome.type).digest("hex").slice(0, 16); let n = 0;
  await store.mutate("quality_dataset", (all) => all.map((r) => { if (r.listingKey !== lk || (r.outcomes || []).some((x) => x.key === ok)) return r; n++; return { ...r, outcomes: [...(r.outcomes || []), { key: ok, type: outcome.type, reason: outcome.reason ? String(outcome.reason).slice(0, 200) : undefined, at: new Date().toISOString() }] }; }));
  return n;
}
function stats() {
  const all = store.readAll("quality_dataset"), by = (f) => all.reduce((m, r) => { const k = f(r) || "unknown"; m[k] = (m[k] || 0) + 1; return m; }, {});
  const outs = all.flatMap((r) => (r.outcomes || []).map((o) => o.type)).reduce((m, k) => { m[k] = (m[k] || 0) + 1; return m; }, {});
  return { records: all.length, withImages: all.filter((r) => r.images.length).length, images: all.reduce((n, r) => n + r.images.length, 0), withOutcome: all.filter((r) => (r.outcomes || []).length).length, byCrop: by((r) => r.crop), byGrade: by((r) => r.labels && r.labels.grade), byCategory: by((r) => r.category), outcomes: outs };
}
function exportTo(outDir) { // labels.jsonl + images/ — no listing, seller or buyer identifiers
  fs.mkdirSync(path.join(outDir, "images"), { recursive: true }); const lines = []; let imgs = 0;
  for (const r of store.readAll("quality_dataset")) { const images = []; for (const im of r.images) { try { fs.copyFileSync(path.join(IMGS(), im.file), path.join(outDir, "images", im.file)); images.push({ file: "images/" + im.file, sha256: im.sha256 }); imgs++; } catch (e) { /* missing */ } }
    lines.push(JSON.stringify({ id: r.id, crop: r.crop, category: r.category, country: r.country, unit: r.unit, temperature: r.temperature, labels: r.labels, label_source: r.labelSource, model: r.model, prompt_version: r.promptVersion, images, outcomes: (r.outcomes || []).map(({ type, reason, at }) => ({ type, reason, at })), created_at: r.createdAt })); }
  fs.writeFileSync(path.join(outDir, "labels.jsonl"), lines.join("\n") + (lines.length ? "\n" : "")); return { records: lines.length, images: imgs };
}
module.exports = { record, addOutcome, stats, exportTo, keyOf, PROMPT_VERSION };
