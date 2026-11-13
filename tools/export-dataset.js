// Writes the quality-label dataset (labels.jsonl + images/) to a folder you choose, ready for training.   Usage:  node tools/export-dataset.js C:\sokoni-dataset-export
const path = require("path"), ds = require("../lib/dataset"); const out = path.resolve(process.argv[2] || "dataset-export");
const r = ds.exportTo(out); console.log(`Exported ${r.records} labelled records and ${r.images} photos to ${out}`); console.log("No listing, seller or buyer identifiers are included. Keep this folder private.");
