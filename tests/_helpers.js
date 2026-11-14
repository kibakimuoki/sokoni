// Shared by the API / payments tests: the REAL two-step sign-up and two-factor login (codes are read from the dev-mode response).
let sharp = null; try { sharp = require("sharp"); } catch (e) { /* only rider sign-ups need it */ }
const crypto = require("crypto"); let n = 0;
const PW = "Secret#1234";
// call(method, path, body, token) → { s, d }
async function signupFull(call, body, codes) {
  const b = { ...body }; const digits = String(b.phone || "").replace(/\D/g, "") || String(++n); if (!b.email) b.email = `u${digits}@example.com`;
  const r = await call("POST", "/api/signup", b); if (r.s !== 202) return r;
  const dc = r.d.devCodes || (codes ? codes() : {}); return call("POST", "/api/signup/verify", { pendingId: r.d.pendingId, smsCode: dc.sms, emailCode: dc.email });
}
async function loginFull(call, identifier, password, codes) {
  const r = await call("POST", "/api/login", { identifier, password }); if (r.s !== 200 || !r.d.mfa) return r; const dc = r.d.devCodes || (codes ? codes() : {});
  return call("POST", "/api/login/verify", { mfaId: r.d.mfaId, code: r.d.channel === "sms" ? dc.sms : dc.email });
}
// a fresh live-looking JPEG for the number-plate photo, plus the anonymous camera session it must belong to
async function vehiclePhoto(call, token) {
  const sess = token ? null : (await call("POST", "/api/capture/anon", {})).d; const w = 320, h = 320, buf = Buffer.alloc(w * h * 3), cells = Array.from({ length: 72 }, () => crypto.randomInt(0, 256));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = cells[Math.floor(y * 8 / h) * 9 + Math.floor(x * 9 / w)], k = crypto.randomInt(0, 12), o = (y * w + x) * 3; buf[o] = (v + k) % 256; buf[o + 1] = (v * 0.7 + k) % 256; buf[o + 2] = (v * 0.4 + k) % 256; }
  const jpg = await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  return { captureToken: sess ? sess.token : null, vehiclePhoto: { data: jpg.toString("base64"), capturedAt: new Date(Date.now() + 100).toISOString(), hash: crypto.createHash("sha256").update(jpg).digest("hex") } };
}
module.exports = { signupFull, loginFull, vehiclePhoto, PW };
