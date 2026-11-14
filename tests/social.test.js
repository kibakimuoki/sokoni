// Continue with Google / Facebook, plus the files search engines read (sitemap.xml, robots.txt, the page's share card and structured data).
require("./_env");
const __os = require("os"), __fs = require("fs"), __path = require("path"); process.env.SOKONI_DATA_DIR = __fs.mkdtempSync(__path.join(__os.tmpdir(), "sokoni-social-"));
Object.assign(process.env, { SERVER_SECRET: "test-secret-for-the-settings-store", ADMIN_TOKEN: "adm-secret", PUBLIC_BASE_URL: "http://localhost:3998", DEV_OTP: "1", VERIFY_CODES: "1", OTP_RESEND_GAP_SECONDS: "0", SIGNUP_PER_HOUR: "1000", BLOCKED_COUNTRIES: "KP" });
const H = require("./_helpers"), realFetch = global.fetch; const J = (o, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => o });
let G = { sub: "g-1", email: "wanjiru@example.com", email_verified: true, name: "Wanjiru Kamau" }, F = { id: "f-1", name: "Otieno Odhiambo", email: "otieno@example.com" }, seen = [];
global.fetch = async (url, opt = {}) => { const u = String(url); seen.push(u);
  if (u.startsWith("https://oauth2.googleapis.com/token")) return String(opt.body).includes("code=good") ? J({ access_token: "gtok" }) : J({ error: "invalid_grant" }, false);
  if (u.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) return J(G);
  if (u.startsWith("https://graph.facebook.com/") && u.includes("/oauth/access_token")) return u.includes("code=good") ? J({ access_token: "ftok" }) : J({ error: { message: "bad" } }, false);
  if (u.startsWith("https://graph.facebook.com/") && u.includes("/me?")) return J(F);
  if (u.startsWith("https://open.er-api.com/")) return J({ result: "success", rates: { USD: 1, KES: 130 } });
  return realFetch(url, opt); };
const { server } = require("../server.js"); const store = require("../lib/store"), settings = require("../lib/settings");
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };
const B = () => "http://localhost:" + server.address().port;
async function call(method, path, body, token) { const h = { "Content-Type": "application/json" }; if (token) h.Authorization = "Bearer " + token; const r = await realFetch(B() + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }); let d = {}; try { d = await r.json(); } catch (e) { /* none */ } return { s: r.status, d }; }
const raw = (path, cookie) => realFetch(B() + path, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
// start → (provider) → callback, the way a browser does it
async function flow(p, code, country, tamper) {
  const st = await raw("/api/auth/" + p + "/start" + (country ? "?country=" + country : "")); const loc = st.headers.get("location"), ck = (st.headers.get("set-cookie") || "").split(";")[0];
  let state = new URL(loc).searchParams.get("state"); if (tamper) state = state.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
  const cb = await raw("/api/auth/" + p + "/callback?code=" + code + "&state=" + encodeURIComponent(state), tamper === "nocookie" ? "" : ck), to = cb.headers.get("location") || ""; return { st, loc, ck, cb, to };
}
(async () => {
  await new Promise((r) => server.listen(3998, r));
  // nothing is shown until the keys are saved
  ok(((await call("GET", "/api/meta")).d.social || []).length === 0, "no Google/Facebook buttons until the keys are saved");
  const off = await raw("/api/auth/google/start"); ok(off.status === 302 && /^\/#social-error=/.test(off.headers.get("location")), "start without keys goes back with a plain message");
  ok(settings.FIELDS.some((f) => f.key === "GOOGLE_CLIENT_SECRET" && f.secret) && settings.FIELDS.some((f) => f.key === "FACEBOOK_APP_SECRET" && f.secret), "the two secrets are encrypted settings");
  Object.assign(process.env, { GOOGLE_CLIENT_ID: "gid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "gsecret", FACEBOOK_APP_ID: "fbid", FACEBOOK_APP_SECRET: "fbsecret" });
  const meta = (await call("GET", "/api/meta")).d; ok(meta.social.join() === "google,facebook", "both buttons appear once the keys are saved"); ok(/tiktok\.com\/@sokoni91/.test(meta.socialLinks.tiktok) && /facebook\.com\/share\/1Hx8qRELJC/.test(meta.socialLinks.facebook), "the TikTok and Facebook pages are in /api/meta");

  const adm = async () => { const r = await realFetch(B() + "/api/admin/provider-test", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": "adm-secret" }, body: JSON.stringify({ provider: "social" }) }); return r.json(); };
  { const bad = await adm(); ok(bad.ok === true || /./.test(bad.error || ""), "the console's Test connection knows the social sign-in card (no more 'Unknown provider')"); ok(!/Unknown provider/.test(bad.error || ""), "…and answers with something useful");
    const fx = global.fetch; global.fetch = async (u, o) => (String(u).startsWith("https://oauth2.googleapis.com/token") ? J({ error: "invalid_client" }, false) : String(u).startsWith("https://graph.facebook.com/oauth/access_token") ? J({ access_token: "app|tok" }) : fx(u, o)); const r1 = await adm(); ok(r1.ok === false && /Google does not recognise/.test(r1.error), "wrong Google keys are named in plain words");
    global.fetch = async (u, o) => (String(u).startsWith("https://oauth2.googleapis.com/token") ? J({ error: "invalid_grant" }, false) : String(u).startsWith("https://graph.facebook.com/oauth/access_token") ? J({ access_token: "app|tok" }) : fx(u, o)); const r2 = await adm(); ok(r2.ok === true && /Google: client ID and secret accepted/.test(r2.detail) && /Facebook: app ID and secret accepted/.test(r2.detail) && /api\/auth\/google\/callback/.test(r2.detail), "right keys pass and the redirect addresses to register are shown"); global.fetch = fx; }
  // the redirect to Google
  const g0 = await flow("google", "good", "UG"); const gu = new URL(g0.loc);
  ok(gu.origin + gu.pathname === "https://accounts.google.com/o/oauth2/v2/auth" && gu.searchParams.get("client_id") === "gid.apps.googleusercontent.com" && gu.searchParams.get("redirect_uri") === "http://localhost:3998/api/auth/google/callback" && /openid/.test(gu.searchParams.get("scope")) && gu.searchParams.get("response_type") === "code", "Google start sends the right client, redirect address and scopes");
  ok(/sok_oauth=[a-f0-9]{32}/.test(g0.ck) && /HttpOnly/i.test(g0.st.headers.get("set-cookie")) && /SameSite=Lax/i.test(g0.st.headers.get("set-cookie")), "the state nonce is kept in an HttpOnly cookie");
  // security of the callback
  const t1 = await flow("google", "good", "KE", "nocookie"); ok(/^\/#social-error=/.test(t1.to) && !/social=/.test(t1.to.replace("social-error=", "")), "a callback from a browser that never started the sign-in is refused");
  const t2 = await flow("google", "good", "KE", "sig"); ok(/^\/#social-error=/.test(t2.to), "a tampered state is refused");
  const t3 = await flow("google", "bad", "KE"); ok(/^\/#social-error=/.test(t3.to), "a code Google rejects is refused");
  const cancel = await raw("/api/auth/google/callback?error=access_denied"); ok(/^\/#social-error=/.test(cancel.headers.get("location")), "cancelling at Google comes back politely");

  // a brand-new person
  const n1 = g0; ok(true, "flow started");
  const r1 = await flow("google", "good", "UG"); const code1 = (r1.to.match(/^\/#social=([a-f0-9]+)$/) || [])[1]; ok(!!code1 && /Max-Age=0/i.test(r1.cb.headers.get("set-cookie") || ""), "a good sign-in returns a one-time code (never the session token) and clears the cookie");
  const f1 = await call("POST", "/api/auth/social/finish", { code: code1 }); ok(f1.s === 200 && f1.d.token && f1.d.user.email === "wanjiru@example.com" && f1.d.user.name === "Wanjiru Kamau" && f1.d.user.country === "UG" && f1.d.user.emailVerified === true && f1.d.user.phone === "" && !("passwordHash" in f1.d.user), "the code becomes a login for a new account (email verified, country kept, no phone yet)");
  ok((await call("POST", "/api/auth/social/finish", { code: code1 })).s === 400, "the one-time code works once only");
  ok((await call("GET", "/api/me", null, f1.d.token)).s === 200, "the session works");
  const r2 = await flow("google", "good", "KE"), f2 = await call("POST", "/api/auth/social/finish", { code: (r2.to.match(/social=([a-f0-9]+)/) || [])[1] }); ok(f2.d.user && f2.d.user.id === f1.d.user.id && store.readAll("users").filter((u) => u.email === "wanjiru@example.com").length === 1, "signing in again finds the same account (no duplicates)");
  ok((await call("POST", "/api/login", { identifier: "wanjiru@example.com", password: "" })).s === 401, "a Google-only account cannot be entered with an empty password");

  // an existing account is linked only when its email was verified
  const ex = await H.signupFull(call, { country: "KE", name: "Existing Person", phone: "0711 000 111", email: "wanjiru2@example.com", password: "Mango#River42x" }); ok(ex.s === 201, "setup: an ordinary account exists");
  G = { sub: "g-2", email: "wanjiru2@example.com", email_verified: true, name: "Existing Person" };
  const r3 = await flow("google", "good", "KE"), f3 = await call("POST", "/api/auth/social/finish", { code: (r3.to.match(/social=([a-f0-9]+)/) || [])[1] }); ok(f3.d.user && f3.d.user.id === ex.d.user.id && store.readAll("users").find((u) => u.id === ex.d.user.id).social.google === "g-2", "Google sign-in with a verified existing email joins that account");
  await store.mutate("users", (all) => [...all, { id: "unv-1", name: "Never Verified", phone: "+254722000333", email: "squat@example.com", country: "KE", passwordHash: "x", emailVerified: false, phoneVerified: false, kind: "individual", createdAt: new Date().toISOString() }]);
  G = { sub: "g-3", email: "squat@example.com", email_verified: true, name: "Someone Else" }; const r4 = await flow("google", "good", "KE"); ok(/^\/#social-error=/.test(r4.to) && !store.readAll("users").find((u) => u.id === "unv-1").social, "an account whose email was never verified is NOT taken over by a social sign-in");
  G = { sub: "g-4", email: "x@example.com", email_verified: false, name: "No" }; const r5 = await flow("google", "good", "KE"); ok(/^\/#social-error=/.test(r5.to), "a Google email that Google itself has not verified is refused");
  G = { sub: "g-5", email: "kp@example.com", email_verified: true, name: "Blocked" }; const r6 = await flow("google", "good", "KP"); ok(/^\/#social-error=/.test(r6.to) && !store.readAll("users").some((u) => u.email === "kp@example.com"), "a blocked country cannot sign up this way either");

  // Facebook
  const fb = await flow("facebook", "good", "KE"), fu = new URL(fb.loc); ok(fu.hostname === "www.facebook.com" && /dialog\/oauth/.test(fu.pathname) && fu.searchParams.get("client_id") === "fbid" && /email/.test(fu.searchParams.get("scope")), "Facebook start sends the right app and permissions");
  const ff = await call("POST", "/api/auth/social/finish", { code: (fb.to.match(/social=([a-f0-9]+)/) || [])[1] }); ok(ff.s === 200 && ff.d.user.email === "otieno@example.com" && ff.d.user.name === "Otieno Odhiambo", "Facebook creates an account too");
  F = { id: "f-2", name: "No Email" }; const fn = await flow("facebook", "good", "KE"); ok(/^\/#social-error=/.test(fn.to), "a Facebook account that shares no email is turned back with a plain message");

  // search engines
  const rb = await (await raw("/robots.txt")).text(); ok(/User-agent: \*/.test(rb) && /Disallow: \/api\//.test(rb) && /Sitemap: http:\/\/localhost:3998\/sitemap\.xml/.test(rb) && !/ops-/.test(rb), "robots.txt allows the site, hides /api/ and points at the sitemap");
  await store.mutate("listings", (all) => [...all, { id: "lst-aaaa-1111", crop: "Tomato", status: "available", audience: "everyone", createdAt: new Date().toISOString(), farmerId: "x" }, { id: "lst-bbbb-2222", crop: "Hidden", status: "available", audience: "companies", createdAt: new Date().toISOString(), farmerId: "x" }, { id: "lst-cccc-3333", crop: "Sold", status: "sold", audience: "everyone", createdAt: new Date().toISOString(), farmerId: "x" }]);
  const sm = await raw("/sitemap.xml"), smt = await sm.text(); ok(sm.status === 200 && /xml/.test(sm.headers.get("content-type")) && /<urlset/.test(smt) && /<loc>http:\/\/localhost:3998\/<\/loc>/.test(smt), "sitemap.xml is valid XML with the home page");
  ok(/listing=lst-aaaa-1111/.test(smt) && !/lst-bbbb-2222/.test(smt) && !/lst-cccc-3333/.test(smt), "the sitemap lists public, available produce only");
  const home = await (await raw("/")).text(); const ld = JSON.parse((home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1] || "[]");
  ok(/<link rel="canonical" href="http:\/\/localhost:3998\/">/.test(home) && /property="og:title"/.test(home) && /name="description"/.test(home) && /twitter:card/.test(home), "the page carries a description, canonical link and share card");
  ok(Array.isArray(ld) && ld[0]["@type"] === "Organization" && ld[0].sameAs.some((x) => /tiktok\.com\/@sokoni91/.test(x)) && ld[0].sameAs.some((x) => /facebook\.com/.test(x)), "structured data names Sokoni and lists the TikTok and Facebook pages");
  ok(/<meta name="sokoni-build"/.test(home) && !/\/admin\.html/.test(home.replace(/Disallow/g, "")), "the served page still carries its build stamp");
  console.log(`\n${pass} passed, ${fail} failed`); server.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
