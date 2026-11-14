require("./_env");
const __os = require("os"), __fs = require("fs"), __path = require("path"); process.env.SOKONI_DATA_DIR = __fs.mkdtempSync(__path.join(__os.tmpdir(), "sokoni-test-"));
process.env.ANTHROPIC_API_KEY = "test-key";
const realFetch = global.fetch; let calls = 0;
global.fetch = async (url, opt = {}) => {
  if (String(url).startsWith("https://api.anthropic.com/v1/messages")) {
    calls++; const prompt = JSON.parse(opt.body).messages[0].content; const obj = JSON.parse(prompt.slice(prompt.lastIndexOf("\n\n{") + 2));
    const out = {}; for (const [k, v] of Object.entries(obj)) out[k] = k === "{n}d ago" ? "DE:d ago" /* drops placeholder */ : "DE:" + v;
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "```json\n" + JSON.stringify(out) + "\n```" }] }) };
  }
  return realFetch(url, opt);
};
const { server } = require("../server.js"); let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };
const get = async (p) => { const r = await realFetch("http://localhost:3995" + p); return { s: r.status, d: await r.json() }; };
(async () => {
  await new Promise((r) => server.listen(3995, r)); const en = require("../i18n/en.json"); const total = Object.keys(en).length;
  ok((await get("/api/i18n/en")).d.source === "en", "english needs no dictionary");
  ok((await get("/api/i18n/zz")).s === 404, "unknown language rejected");
  ok((await get("/api/i18n/..%2F..%2Fetc")).s === 404, "path traversal rejected");
  const sw = (await get("/api/i18n/sw")).d; ok(sw.dict["Accept"] === "Kubali" && sw.dict["Your orders"] === "Oda zako", "Swahili seed served"); 
  ok(Object.keys(sw.dict).length >= 417 && sw.source === "ai", "Swahili: seed + AI fills the gaps (" + Object.keys(sw.dict).length + "/" + total + ")");
  const callsAfterSw = calls;
  const de = (await get("/api/i18n/de")).d; ok(de.source === "ai" && de.dict["Accept"] === "DE:Accept", "German produced by AI");
  ok(de.dict["{n}m ago"] === "DE:{n}m ago" && !("{n}d ago" in de.dict) && de.complete === false, "translation that drops a placeholder is rejected (falls back to English)");
  const c2 = calls; await get("/api/i18n/de"); ok(calls > callsAfterSw && calls === c2 + 1, "repeat request re-asks only for the one rejected key (cached the rest)");
  ok(require("fs").existsSync(require("path").join(process.env.SOKONI_DATA_DIR, "i18n", "de.json")), "cache file written");
  const [a, b] = await Promise.all([get("/api/i18n/fr"), get("/api/i18n/fr")]); ok(a.d.dict["Accept"] === "Accepter" && b.d.dict["Accept"] === "Accepter", "French seed served concurrently");
  const meta = (await get("/api/meta")).d; ok(meta.countryLanguages.KE[0] === "sw" && meta.countryLanguages.FR[0] === "fr" && meta.rtlLanguages.includes("ar") && meta.translationAvailable === true, "meta exposes country→language map");
  ok(Object.keys(meta.countryLanguages).length >= 190, "language suggestions for " + Object.keys(meta.countryLanguages).length + " countries");
  console.log(`\n${pass} passed, ${fail} failed`); server.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
