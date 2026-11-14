// Web Push notifications with no extra packages: VAPID identity (RFC 8292) + aes128gcm payload encryption (RFC 8291), using only Node's crypto.
// A user's phone/browser gives us a "subscription" (an address on Google's / Mozilla's / Apple's push service + two keys). We encrypt each message for that
// device alone; the push service only ever sees scrambled bytes.
const crypto = require("crypto"), store = require("./store");
const b64u = (b) => Buffer.from(b).toString("base64url"), unb64u = (s) => Buffer.from(String(s || ""), "base64url");
// SECURITY: the address in a subscription is chosen by the user, and our server posts to it. Only the real push services are allowed (otherwise it could be aimed at internal addresses).
const ALLOWED = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|[a-z0-9.-]*push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/i;
const hostOk = (endpoint) => { try { const u = new URL(endpoint); if (u.protocol !== "https:" || u.port || u.username) return false; const extra = String(process.env.PUSH_ALLOWED_HOSTS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean); return ALLOWED.test(u.hostname) || extra.includes(u.hostname.toLowerCase()); } catch (e) { return false; } };
async function vapid() { // our sender identity, made once and kept in the data folder
  const have = store.readAll("push_keys")[0]; if (have) return have;
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }), pj = publicKey.export({ format: "jwk" });
  const k = { publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(pj.x), unb64u(pj.y)])), privateJwk: privateKey.export({ format: "jwk" }), createdAt: new Date().toISOString() };
  await store.mutate("push_keys", (all) => (all.length ? all : [k])); return store.readAll("push_keys")[0];
}
function vapidJwt(aud, k) {
  const sub = process.env.PUSH_SUBJECT || (/^https:\/\//.test(process.env.PUBLIC_BASE_URL || "") ? process.env.PUBLIC_BASE_URL : "mailto:admin@sokoni.example");
  const h = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" })), c = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub })), key = crypto.createPrivateKey({ key: k.privateJwk, format: "jwk" });
  return h + "." + c + "." + b64u(crypto.sign("sha256", Buffer.from(h + "." + c), { key, dsaEncoding: "ieee-p1363" }));
}
function encrypt(payload, p256dh, auth) { // → the request body for one device
  const ua = unb64u(p256dh), authSecret = unb64u(auth), ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys(); const asPub = ecdh.getPublicKey(), secret = ecdh.computeSecret(ua), salt = crypto.randomBytes(16);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", secret, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), ua, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16)), nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce), body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]), rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}
const validKeys = (p256dh, auth) => { const a = unb64u(p256dh), b = unb64u(auth); return a.length === 65 && a[0] === 4 && b.length === 16; };
async function subscribe(userId, s) { // → { ok } | { error }
  const e = s && s.endpoint, k = (s && s.keys) || {}; if (!hostOk(e)) return { error: "That notification address isn't one we can use." }; if (!validKeys(k.p256dh, k.auth)) return { error: "The notification keys are not valid." };
  await store.mutate("push_subs", (all) => { const mine = all.filter((x) => x.userId === userId && x.endpoint !== e).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)), drop = new Set(mine.slice(0, Math.max(0, mine.length - 4)).map((x) => x.endpoint)); // at most 5 devices each
    return [...all.filter((x) => x.endpoint !== e && !(x.userId === userId && drop.has(x.endpoint))), { id: crypto.randomUUID(), userId, endpoint: e, p256dh: k.p256dh, auth: k.auth, failures: 0, createdAt: new Date().toISOString() }]; });
  return { ok: true };
}
const unsubscribe = (userId, endpoint) => store.mutate("push_subs", (all) => all.filter((x) => !(x.userId === userId && x.endpoint === endpoint)));
const count = (userId) => store.readAll("push_subs").filter((x) => x.userId === userId).length;
async function sendOne(sub, payload) { // → HTTP status
  const k = await vapid(), body = encrypt(Buffer.from(JSON.stringify(payload)), sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, { method: "POST", headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: String(payload.ttl || 86400), Urgency: payload.urgent ? "high" : "normal", Authorization: `vapid t=${vapidJwt(new URL(sub.endpoint).origin, k)}, k=${k.publicKey}` }, body }); return r.status;
}
async function notify(userId, p) { // → how many devices accepted it. A device that is gone (404/410) is forgotten; one that keeps failing is dropped after 5 tries.
  const subs = store.readAll("push_subs").filter((x) => x.userId === userId); if (!subs.length) return 0; const payload = { title: String(p.title || "Sokoni").slice(0, 80), body: String(p.body || "").slice(0, 200), url: String(p.url || "/").slice(0, 200), tag: p.tag ? String(p.tag).slice(0, 60) : undefined, urgent: !!p.urgent, icon: "/icons/icon-192.png" }; let sent = 0;
  for (const s of subs) { try { const st = await sendOne(s, payload); if (st === 404 || st === 410) await store.mutate("push_subs", (all) => all.filter((x) => x.endpoint !== s.endpoint)); else if (st >= 200 && st < 300) { sent++; if (s.failures) await store.mutate("push_subs", (all) => all.map((x) => (x.endpoint === s.endpoint ? { ...x, failures: 0 } : x))); } else await fail(s); } catch (e) { await fail(s); } } return sent;
}
const fail = (s) => store.mutate("push_subs", (all) => all.flatMap((x) => (x.endpoint !== s.endpoint ? [x] : (x.failures || 0) + 1 >= 5 ? [] : [{ ...x, failures: (x.failures || 0) + 1 }])));
module.exports = { vapid, subscribe, unsubscribe, count, notify, hostOk, encrypt, vapidJwt };
