// One-time codes: 6 digits, stored only as an HMAC (never the code itself), compared in constant time.
const crypto = require("crypto"); const { hmac } = require("./auth");
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");
const hashCode = (id, channel, code) => hmac(`otp|${id}|${channel}|${String(code).trim()}`);
const matches = (id, channel, code, hash) => { if (!hash || !/^\d{6}$/.test(String(code || "").trim())) return false; const a = Buffer.from(hashCode(id, channel, code)), b = Buffer.from(hash); return a.length === b.length && crypto.timingSafeEqual(a, b); };
module.exports = { newCode, hashCode, matches };
