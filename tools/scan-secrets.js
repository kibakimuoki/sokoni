// Run this BEFORE you push to GitHub. It scans exactly the files that would be uploaded and looks for anything that resembles a key, a password,
// a private key, or a file that should never leave your computer. It NEVER prints a secret — only the file, the line and what kind of thing it found.
//   node tools/scan-secrets.js                              (scan this folder)
//   node tools/scan-secrets.js --also "0123456789012,Jane Doe"   (also look for your own private values, e.g. an account number)
//   node tools/scan-secrets.js --dir C:\some\folder          (scan another folder)
const fs = require("fs"), path = require("path"), cp = require("child_process");
const args = process.argv.slice(2), opt = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; }, root = path.resolve(opt("dir") || path.join(__dirname, ".."));
const also = String(opt("also") || "").split(",").map((x) => x.trim()).filter((x) => x.length >= 4);
function list() {
  if (!opt("dir")) try { const out = cp.execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }), l = out.split(/\r?\n/).filter(Boolean); if (l.length) return { files: l, how: "the files git would upload" }; } catch (e) { /* not a git folder (yet): walk it */ }
  const skip = new Set(["node_modules", ".git", "data", "sokoni-data", "sokoni-backups", "uploads"]), res = [];
  (function walk(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (skip.has(e.name)) continue; const r = rel ? rel + "/" + e.name : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else res.push(r); } })(root, "");
  return { files: res, how: "every file in the folder (git isn't managing it yet)" };
}
const HARD = [["an AI key", /sk-ant-[A-Za-z0-9_-]{16,}/], ["an AWS key", /AKIA[0-9A-Z]{16}/], ["an e-mail provider key", /\bre_[A-Za-z0-9]{20,}/], ["a SendGrid key", /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/], ["a GitHub token", /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/], ["a Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/], ["a live payment key", /\b[sr]k_live_[A-Za-z0-9]{16,}/]];
const ASSIGN = /\b([A-Z][A-Z0-9_]*(?:SECRET|PASSWORD|PASSKEY|TOKEN|PRIVATE_KEY|API_KEY|CONSUMER_KEY)[A-Z0-9_]*)\s*[=:]\s*["']?([^\s"'<>#;,)]{8,})/g, PLACEHOLDER = /^(change-?me|your|xxx|\.\.\.|test|example|placeholder|none|null|undefined|process\.|true|false|paste)|[$({\[]|^[A-Za-z_]+(\.[A-Za-z_]+)+$/i; // (the last part: code such as  k.privateKey,  not a secret)
const NEVER = [[/(^|\/)(\.env|sokoni\.env(\.txt)?)$/, "a settings file with your passwords"], [/(^|\/)[^/]*\.env$/, "a settings file"], [/\.(pem|key)$|(^|\/)id_(rsa|ed25519)$/, "a private key file"], [/\.(tgz|sql)$|\.tar\.gz$/, "a backup archive"], [/(^|\/)(data|sokoni-data|sokoni-backups|uploads|private)\//, "customer data, photos or documents"]];
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz|mp4)$/i, hits = []; const { files, how } = list(); let scanned = 0;
for (const rel of files) {
  const base = path.basename(rel); for (const [re, why] of NEVER) if (re.test(rel) && !/\.example$/.test(rel)) { hits.push({ rel, line: 0, what: `this file is ${why} and must not be on GitHub` }); break; }
  if (SKIP_EXT.test(rel)) continue; let text; try { const f = path.join(root, rel), st = fs.statSync(f); if (!st.isFile() || st.size > 2e6) continue; text = fs.readFileSync(f, "utf8"); } catch (e) { continue; } scanned++;
  const lines = text.split(/\r?\n/), inTests = /^tests\//.test(rel), isExample = /\.example$/.test(rel);
  lines.forEach((ln, i) => {
    for (const [what, re] of HARD) if (re.test(ln)) hits.push({ rel, line: i + 1, what: `looks like ${what}` });
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(ln) && /^[A-Za-z0-9+\/=]{30,}$/.test((lines[i + 1] || "").trim())) hits.push({ rel, line: i + 1, what: "looks like a private key" }); // (the header and the key are on different lines)
    if (!inTests && !isExample) { ASSIGN.lastIndex = 0; let m; while ((m = ASSIGN.exec(ln))) if (!PLACEHOLDER.test(m[2])) hits.push({ rel, line: i + 1, what: `${m[1]} is set to a real-looking value` }); }
    also.forEach((lit, k) => { if (ln.toLowerCase().includes(lit.toLowerCase())) hits.push({ rel, line: i + 1, what: `contains your private value #${k + 1} (from --also)` }); });
  });
}
console.log(`\nSecret scan — ${scanned} files checked (${how})\n`);
if (!hits.length) { console.log("  ✓ Nothing found. It is safe to push.\n"); process.exit(0); }
for (const h of hits.slice(0, 60)) console.log(`  ✗ ${h.rel}${h.line ? ":" + h.line : ""} — ${h.what}`);
console.log(`\n${hits.length} problem(s). Do NOT push yet: remove them (or add the file to .gitignore). If a real key was ever pushed, revoke it and make a new one — deleting it later does not un-publish it.\n`); process.exit(1);
