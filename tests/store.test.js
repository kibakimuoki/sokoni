require("./_env"); const fs = require("fs"), os = require("os"), path = require("path");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sokoni-store-")); process.env.SOKONI_DATA_DIR = dir; process.env.BACKUP_DIR = path.join(dir, "bk"); process.env.BACKUP_KEEP = "2";
const store = require("../lib/store"), backup = require("../lib/backup"); let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } }; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const f = path.join(dir, "users.json");
  await store.mutate("users", (a) => [...a, { id: 1 }]); await store.mutate("users", (a) => [...a, { id: 2 }]);
  ok(store.readAll("users").length === 2 && JSON.parse(fs.readFileSync(f + ".bak", "utf8")).length === 1 && !fs.existsSync(f + ".tmp"), "writes are atomic and keep the previous version as .bak; no temp file left behind");
  fs.writeFileSync(f, '{"broken'); const r = store.readAll("users"); ok(r.length === 1 && JSON.parse(fs.readFileSync(f, "utf8")).length === 1 && fs.readdirSync(dir).some((x) => x.startsWith("users.json.corrupt-")), "a corrupt file is restored from the last good copy (and the bad one is kept for inspection)");
  fs.writeFileSync(f, "garbage"); fs.writeFileSync(f + ".bak", "also garbage"); let threw = false; try { store.readAll("users"); } catch (e) { threw = /CORRUPT/.test(e.message); } ok(threw, "if nothing is readable it refuses to continue instead of starting empty");
  let rejected = false; try { await store.mutate("users", (a) => [...a, { id: 3 }]); } catch (e) { rejected = true; } ok(rejected && fs.readFileSync(f, "utf8") === "garbage", "…and a save can never overwrite the unreadable file with an empty list");
  fs.writeFileSync(f, JSON.stringify([{ id: 9 }])); await store.mutate("orders", () => [{ id: "o" }]);
  const d1 = backup.backupNow(); ok(d1 && fs.existsSync(path.join(d1, "users.json")) && fs.existsSync(path.join(d1, "orders.json")), "backup copies the data files");
  await sleep(15); backup.backupNow(); await sleep(15); backup.backupNow(); ok(fs.readdirSync(path.join(dir, "bk")).length === 2 && backup.state.last && !backup.state.error, "only the newest BACKUP_KEEP backups are kept");
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
