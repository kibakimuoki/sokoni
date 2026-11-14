// Password hashing (scrypt) and signed session tokens using only Node's crypto.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.SOKONI_DATA_DIR || path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const SECRET_FILE = path.join(DATA_DIR, "server-secret.txt");

function getServerSecret() {
  if (process.env.SERVER_SECRET) return process.env.SERVER_SECRET;
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, "utf8").trim();
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(SECRET_FILE, secret);
  return secret;
}
const SECRET = getServerSecret();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + crypto.scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(crypto.scryptSync(password, salt, 64).toString("hex"), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return body + "." + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

const hmac = (data) => crypto.createHmac("sha256", SECRET).update(String(data)).digest("hex");
module.exports = { hashPassword, verifyPassword, signToken, verifyToken, hmac };
