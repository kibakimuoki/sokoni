// Password policy. The same rules (ids + wording) are sent to the browser so the sign-up form can tick them off live.
const RULES = [
  { id: "len", text: "At least 10 characters", test: (p) => p.length >= 10 },
  { id: "lower", text: "A small letter (a–z)", test: (p) => /[a-z]/.test(p) },
  { id: "upper", text: "A capital letter (A–Z)", test: (p) => /[A-Z]/.test(p) },
  { id: "digit", text: "A number (0–9)", test: (p) => /[0-9]/.test(p) },
  { id: "special", text: "A special character (e.g. ! @ # $ % & *)", test: (p) => /[^A-Za-z0-9]/.test(p) },
];
const COMMON = ["password", "qwerty", "letmein", "welcome", "admin", "iloveyou", "sokoni", "123456", "abc123", "monkey", "dragon"];
// returns a list of human-readable problems (empty = fine). `personal` = strings the password must not contain (name, phone digits, email name…)
function problems(pw, personal = []) {
  const p = typeof pw === "string" ? pw : "", out = RULES.filter((r) => !r.test(p)).map((r) => r.text);
  if (p.length > 128) out.push("At most 128 characters");
  const flat = p.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!out.length && COMMON.some((w) => flat.includes(w))) out.push("Too easy to guess — avoid common words like “password”");
  if (!out.length) { const toks = personal.flatMap((x) => String(x || "").toLowerCase().split(/[^a-z0-9]+/)).filter((t) => t.length >= 4).flatMap((t) => (/^\d+$/.test(t) && t.length >= 7 ? [t, t.slice(-7)] : [t]));
    if (toks.some((t) => flat.includes(t))) out.push("Don't include your name, phone number or email in your password"); }
  return out;
}
module.exports = { RULES: RULES.map(({ id, text }) => ({ id, text })), problems };
