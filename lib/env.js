// Loads KEY=VALUE pairs from ./.env into process.env (never overrides real environment variables). Zero dependencies.
const fs = require("fs"); const path = require("path"); const os = require("os");
global.__sokoniEnvFiles = [];
// Looked for, in this order (the first value for a setting wins): SOKONI_ENV_FILE, ./.env, ../sokoni.env, and sokoni.env in YOUR HOME FOLDER (C:\\Users\\you\\sokoni.env) — keep it in your home folder and every version you unzip, wherever you unzip it, finds it.
const CANDIDATES = [process.env.SOKONI_ENV_FILE, path.join(__dirname, "..", ".env"), path.join(__dirname, "..", "..", "sokoni.env"), path.join(os.homedir(), "sokoni.env"), path.join(os.homedir(), "sokoni", "sokoni.env")].filter(Boolean);
global.__sokoniEnvTried = CANDIDATES; global.__sokoniEnvTxt = CANDIDATES.filter((f) => { try { return fs.existsSync(f + ".txt"); } catch (e) { return false; } }); // Windows Notepad likes to save "sokoni.env" as "sokoni.env.txt" — we notice that and say so
if (process.env.SOKONI_TEST !== "1") for (const file of CANDIDATES) try { // tests set SOKONI_TEST=1 so your personal .env can never leak into them
  const txt = fs.readFileSync(file, "utf8"); global.__sokoniEnvFiles.push(path.resolve(file));
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (!m) continue;
    let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
} catch (e) { /* no .env file — fine */ }
