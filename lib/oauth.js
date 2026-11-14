// "Continue with Google / Facebook". The browser is sent to the provider, the provider sends it back to /api/auth/<provider>/callback with a one-time
// code, and this file swaps that code for the person's name and email. Nothing from the provider is trusted until the server has asked the provider
// itself (never the browser). Google email must be marked verified; Facebook only returns an email it has confirmed.
const env = (k) => String(process.env[k] || "").trim();
const publicBase = () => String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const fbVersion = () => (/^v\d+\.\d+$/.test(env("FACEBOOK_GRAPH_VERSION")) ? env("FACEBOOK_GRAPH_VERSION") : "v21.0");

const PROVIDERS = {
  google: { label: "Google", id: () => env("GOOGLE_CLIENT_ID"), secret: () => env("GOOGLE_CLIENT_SECRET") },
  facebook: { label: "Facebook", id: () => env("FACEBOOK_APP_ID"), secret: () => env("FACEBOOK_APP_SECRET") },
};
const isConfigured = (p) => !!PROVIDERS[p] && !!PROVIDERS[p].id() && !!PROVIDERS[p].secret();
const enabled = () => Object.keys(PROVIDERS).filter(isConfigured);
const redirectUri = (p, base) => (publicBase() || String(base || "").replace(/\/$/, "")) + "/api/auth/" + p + "/callback";

function authUrl(p, state, base) {
  const q = new URLSearchParams(), id = PROVIDERS[p].id();
  if (p === "google") { q.set("client_id", id); q.set("redirect_uri", redirectUri(p, base)); q.set("response_type", "code"); q.set("scope", "openid email profile"); q.set("state", state); q.set("prompt", "select_account"); return "https://accounts.google.com/o/oauth2/v2/auth?" + q; }
  q.set("client_id", id); q.set("redirect_uri", redirectUri(p, base)); q.set("response_type", "code"); q.set("scope", "email,public_profile"); q.set("state", state);
  return "https://www.facebook.com/" + fbVersion() + "/dialog/oauth?" + q;
}

async function getJSON(url, opts) {
  let r; try { r = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) }); } catch (e) { throw new Error("Couldn't reach the sign-in service. Please try again."); }
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error((d && (d.error_description || (d.error && d.error.message) || d.error)) ? "The sign-in service refused this request." : "The sign-in service refused this request."); return d;
}

// → { sub, name, email, emailVerified } or throws a plain-words error
async function profile(p, code, base) {
  if (!isConfigured(p)) throw new Error("This sign-in is not switched on.");
  const P = PROVIDERS[p], uri = redirectUri(p, base);
  if (p === "google") {
    const t = await getJSON("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: P.id(), client_secret: P.secret(), redirect_uri: uri, grant_type: "authorization_code" }) });
    if (!t.access_token) throw new Error("Google did not confirm the sign-in.");
    const u = await getJSON("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: "Bearer " + t.access_token } });
    if (!u.sub) throw new Error("Google did not return an account.");
    return { sub: String(u.sub), name: String(u.name || u.given_name || "").trim(), email: String(u.email || "").toLowerCase(), emailVerified: u.email_verified === true || u.email_verified === "true" };
  }
  const q = new URLSearchParams({ client_id: P.id(), client_secret: P.secret(), redirect_uri: uri, code });
  const t = await getJSON("https://graph.facebook.com/" + fbVersion() + "/oauth/access_token?" + q);
  if (!t.access_token) throw new Error("Facebook did not confirm the sign-in.");
  const u = await getJSON("https://graph.facebook.com/" + fbVersion() + "/me?" + new URLSearchParams({ fields: "id,name,email", access_token: t.access_token }));
  if (!u.id) throw new Error("Facebook did not return an account.");
  const email = String(u.email || "").toLowerCase(); return { sub: String(u.id), name: String(u.name || "").trim(), email, emailVerified: !!email }; // Facebook only returns an email address it has confirmed
}
module.exports = { PROVIDERS, isConfigured, enabled, authUrl, profile, redirectUri };
