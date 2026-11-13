// Simple JSON-file data store. No external dependencies.
// Swap for Postgres/Mongo later if you outgrow it.
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.SOKONI_DATA_DIR || path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function fileFor(name) {
  if (!/^[a-z_]+$/.test(name)) throw new Error("Invalid collection name: " + name);
  return path.join(DATA_DIR, name + ".json");
}

const parse = (file) => { const raw = fs.readFileSync(file, "utf8").trim(); return raw ? JSON.parse(raw) : []; };
function load(file) {
  if (!fs.existsSync(file)) return [];
  try { return parse(file); } catch (e) {
    // A file that won't parse must NEVER be treated as empty — the next save would overwrite every record with an empty list.
    const bak = file + ".bak";
    if (fs.existsSync(bak)) { try { const good = parse(bak); fs.copyFileSync(file, file + ".corrupt-" + Date.now()); fs.copyFileSync(bak, file); console.error("⚠ " + path.basename(file) + " was unreadable (" + e.message + ") — restored from its last good backup."); return good; } catch (e2) { /* fall through */ } }
    throw new Error("DATA FILE CORRUPT: " + file + " (" + e.message + "). Refusing to continue so nothing is overwritten — restore it from a backup.");
  }
}
function writeAtomic(file, text) { // write a temp file, flush it to disk, keep the previous version as .bak, then swap in
  const tmp = file + ".tmp", fd = fs.openSync(tmp, "w"); try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak"); fs.renameSync(tmp, file);
}

// Serialize writes per-file so near-simultaneous requests can't clobber each other.
const writeQueues = {};
function queueWrite(file, fn) {
  const prev = writeQueues[file] || Promise.resolve();
  const next = prev.then(fn, fn);
  writeQueues[file] = next.catch(() => {});
  return next;
}

function readAll(name) { return load(fileFor(name)); }

function mutate(name, mutator) {
  const file = fileFor(name);
  return queueWrite(file, async () => {
    const current = load(file);
    const updated = await mutator(current);
    writeAtomic(file, JSON.stringify(updated, null, 2));
    return updated;
  });
}

module.exports = { readAll, mutate, DATA_DIR };
