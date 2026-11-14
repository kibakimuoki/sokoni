// Snapshot of the data files (orders, users, payments log, private company documents). Runs at start-up and every 6 hours; keeps the newest N.
// IMPORTANT: a backup on the same disk doesn't protect you from losing the disk — copy BACKUP_DIR somewhere else regularly (cloud drive, rclone, scp).
const fs = require("fs"), path = require("path"); const { DATA_DIR } = require("./store");
const DIR = () => process.env.BACKUP_DIR || path.join(DATA_DIR, "..", "sokoni-backups"), KEEP = () => Number(process.env.BACKUP_KEEP || 30);
const state = { last: null, error: null };
function backupNow() {
  try { const dst = path.join(DIR(), new Date().toISOString().replace(/[:.]/g, "-")); fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(DATA_DIR)) if (/\.json$/.test(f)) fs.copyFileSync(path.join(DATA_DIR, f), path.join(dst, f));
    const priv = path.join(DATA_DIR, "private"); if (fs.existsSync(priv)) fs.cpSync(priv, path.join(dst, "private"), { recursive: true });
    const all = fs.readdirSync(DIR()).filter((d) => /^\d{4}-/.test(d)).sort(); for (const old of all.slice(0, Math.max(0, all.length - KEEP()))) fs.rmSync(path.join(DIR(), old), { recursive: true, force: true });
    state.last = new Date().toISOString(); state.error = null; return dst; } catch (e) { state.error = e.message; console.error("backup failed:", e.message); return null; }
}
const startBackups = () => { backupNow(); setInterval(backupNow, 6 * 3600e3).unref(); };
module.exports = { backupNow, startBackups, state, DIR };
