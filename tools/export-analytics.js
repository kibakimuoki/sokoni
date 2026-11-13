// Writes the company's permanent analytics record to a folder as CSV files you can open in Excel or load into any tool.
//   Usage:  node tools/export-analytics.js C:\sokoni-analytics-export
// orders.csv (one row per order) · listings.csv (one row per listing) · daily.csv (one row per day) · ratings.csv
// People appear only as one-way keys: no names, phones or e-mails. Keep the folder private anyway.
const fs = require("fs"), path = require("path"), an = require("../lib/analytics");
(async () => { const out = path.resolve(process.argv[2] || "analytics-export"); fs.mkdirSync(out, { recursive: true }); await an.sync(); const n = {};
  for (const kind of ["orders", "listings", "daily", "ratings"]) { const ex = an.exportRows(kind); fs.writeFileSync(path.join(out, kind + ".csv"), an.toCsv(ex.rows, ex.cols)); n[kind] = ex.rows.length; }
  console.log(`Exported to ${out}:  ${n.orders} orders · ${n.listings} listings · ${n.daily} days · ${n.ratings} ratings`); })().catch((e) => { console.error(e.message); process.exit(1); });
