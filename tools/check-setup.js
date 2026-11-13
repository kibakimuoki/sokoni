// One command that tells you what Sokoni will ACTUALLY do with your settings, without starting it.   Usage:  node tools/check-setup.js
// It reads your settings file(s) exactly the way the server does, then says: which file was read, whether every file is from the same download,
// where the admin page now is, and whether the admin password looks safe. (It never prints a password.)
const fs = require("fs"), path = require("path"), build = require("../lib/build"), srv = require("../server.js");
const say = (ok, text) => console.log((ok === true ? "  ✓ " : ok === false ? "  ✗ " : "  • ") + text);
const files = global.__sokoniEnvFiles || [], tried = global.__sokoniEnvTried || [], txt = global.__sokoniEnvTxt || [], port = process.env.PORT || 3000;
console.log("\nSokoni setup check\n");
if (files.length) say(true, "Settings file read: " + files.join("  +  ")); else say(false, "NO settings file was found. The server looks for, in this order:\n      " + tried.join("\n      "));
for (const f of txt) say(false, `Found ${f}.txt — Notepad added “.txt” to the name. Rename it to ${f} (File Explorer → View → Show → File name extensions).`);
const bp = build.check(); say(bp.length === 0, bp.length ? "Files from DIFFERENT downloads are mixed in this folder:\n      · " + bp.join("\n      · ") + "\n      Copy ALL the files from the newest zip (keep your settings file and data folder), then restart." : `Build ${build.id}: every file is from the same download`);
// where everything is kept (the same formula the server uses)
const dataDir = process.env.SOKONI_DATA_DIR || path.join(__dirname, "..", "data"), photos = (d) => { try { const f = fs.readdirSync(d).filter((x) => /\.(jpe?g|png|webp)$/i.test(x)); return { n: f.length, mb: f.reduce((s, x) => s + fs.statSync(path.join(d, x)).size, 0) / 1048576 }; } catch (e) { return null; } };
say(!!process.env.SOKONI_DATA_DIR, "Data folder (everything Sokoni stores): " + dataDir + (process.env.SOKONI_DATA_DIR ? "" : "\n      SOKONI_DATA_DIR is not set, so the data lives INSIDE the app folder and a new download would not find it. Put a line like  SOKONI_DATA_DIR=C:\\sokoni-data  in your settings file (on a server: /var/lib/sokoni)."));
{ const up = path.join(dataDir, "uploads"), c = photos(up); say(null, "Listing photos folder:  " + up + (c ? `   (${c.n} photos, ${c.mb.toFixed(1)} MB)` : "   (appears when the first listing is published)")); }
say(null, "Private documents and rider photos:  " + path.join(dataDir, "private") + "   (never shown to the public)"); say(null, "Training copies of photos:  " + path.join(dataDir, "dataset", "images"));
// which file says what about ADMIN_PATH (the first file that mentions a setting wins, and a real Windows environment variable beats every file)
const seen = []; for (const f of files) try { const m = fs.readFileSync(f, "utf8").split(/\r?\n/).map((l) => l.match(/^\s*ADMIN_PATH\s*=\s*(.*?)\s*$/)).find(Boolean); if (m) seen.push({ f, v: m[1].replace(/^["']|["']$/g, "") }); } catch (e) { /* unreadable: the server skips it too */ }
if (seen.length > 1 && new Set(seen.map((x) => x.v)).size > 1) say(false, "ADMIN_PATH is written in more than one settings file with different values — the FIRST one wins:\n      " + seen.map((x) => `${x.f}  →  ${x.v}`).join("\n      "));
if (process.env.ADMIN_PATH && seen.length && process.env.ADMIN_PATH !== seen[0].v) say(false, `ADMIN_PATH is also set as a Windows environment variable (“${process.env.ADMIN_PATH}”), which overrides the file (“${seen[0].v}”).`);
const ap = srv.adminPathStatus(), base = "http://localhost:" + port;
if (ap.state === "secret") { say(true, "Your admin console is at:  " + base + ap.path); say(true, "/admin.html now says “Not found” (a wrong address shows the normal Sokoni page — that is on purpose, so strangers can't tell where the real one is)."); }
else if (ap.state === "default") say(false, "ADMIN_PATH is not set, so the admin page is still the public /admin.html. " + (files.length ? `Add a line like   ADMIN_PATH=/ops-<random>.html   to ${files[0]}, save, and restart.` : "There is no settings file to put it in."));
else say(false, ap.message);
const t = String(process.env.ADMIN_TOKEN || ""), ss = String(process.env.SERVER_SECRET || "");
if (!t) say(false, "ADMIN_TOKEN is not set — the admin console is switched off."); else { say(t.length >= 20, `Admin password (ADMIN_TOKEN): ${t.length} characters${t.length < 20 ? " — too short for a site on the internet, use 24+ random characters" : ""}`); if (t.startsWith("#")) say(false, "ADMIN_TOKEN starts with “#”: that # is part of the password — type it when signing in, or remove it."); if (ss && t === ss) say(false, "ADMIN_TOKEN and SERVER_SECRET are the same value. Make them two different random values."); }
console.log(ap.state === "secret" ? "\nOpen the address above in your browser (copy and paste it exactly, including the letters and digits).\n" : "\n");
process.exit(0);
