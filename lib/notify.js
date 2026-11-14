// Sends sign-in / verification codes by SMS and email through whichever provider is configured (all plain HTTPS, no dependencies).
//   SMS:   Africa's Talking (AT_USERNAME + AT_API_KEY, great for Kenya & Africa) or Twilio (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM, global)
//   Email: Resend (RESEND_API_KEY) or SendGrid (SENDGRID_API_KEY) — both need EMAIL_FROM on a domain you have verified with them
// With no provider, codes can only be shown on screen / in the server log for LOCAL testing (DEV_OTP=1 and a localhost PUBLIC_BASE_URL); never on a public site.
const baseIsLocal = () => { const b = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""); return !b || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(b); };
const devAllowed = () => process.env.DEV_OTP === "1" && baseIsLocal();
const smsProvider = () => { const p = (process.env.SMS_PROVIDER || "").toLowerCase(); if (p === "africastalking" && process.env.AT_API_KEY && process.env.AT_USERNAME) return p; if (p === "twilio" && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) return p; if (!p) { if (process.env.AT_API_KEY && process.env.AT_USERNAME) return "africastalking"; if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) return "twilio"; } return ""; };
const emailProvider = () => { const p = (process.env.EMAIL_PROVIDER || "").toLowerCase(); if (p === "resend" && process.env.RESEND_API_KEY) return p; if (p === "sendgrid" && process.env.SENDGRID_API_KEY) return p; if (!p) { if (process.env.RESEND_API_KEY) return "resend"; if (process.env.SENDGRID_API_KEY) return "sendgrid"; } return ""; };
const from = () => process.env.EMAIL_FROM || "Sokoni <no-reply@localhost>";
const parseFrom = (f) => { const m = String(f).match(/^\s*(.*?)\s*<([^>]+)>\s*$/); return m ? { name: m[1] || "Sokoni", email: m[2] } : { name: "Sokoni", email: String(f).trim() }; };
const j = async (r) => { try { return await r.json(); } catch (e) { return {}; } };
async function sendSms(to, text) {
  const p = smsProvider();
  if (p === "africastalking") { const base = process.env.AT_SANDBOX === "1" ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com"; const f = new URLSearchParams({ username: process.env.AT_USERNAME, to, message: text }); if (process.env.AT_SENDER_ID) f.set("from", process.env.AT_SENDER_ID);
    try { const r = await fetch(base + "/version1/messaging", { method: "POST", headers: { apiKey: process.env.AT_API_KEY, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: f.toString() }); const d = await j(r), rec = d.SMSMessageData && d.SMSMessageData.Recipients && d.SMSMessageData.Recipients[0];
      return r.ok && rec && (rec.statusCode === 101 || /success/i.test(String(rec.status))) ? { ok: true, provider: p } : { ok: false, provider: p, error: (rec && rec.status) || (d.SMSMessageData && d.SMSMessageData.Message) || "SMS provider rejected the message" }; } catch (e) { return { ok: false, provider: p, error: e.message }; } }
  if (p === "twilio") { const f = new URLSearchParams({ To: to, Body: text }); if (process.env.TWILIO_MESSAGING_SERVICE_SID) f.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID); else f.set("From", process.env.TWILIO_FROM || "");
    try { const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(process.env.TWILIO_ACCOUNT_SID)}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + Buffer.from(process.env.TWILIO_ACCOUNT_SID + ":" + process.env.TWILIO_AUTH_TOKEN).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: f.toString() }); const d = await j(r);
      return r.status === 201 ? { ok: true, provider: p } : { ok: false, provider: p, error: d.message || "SMS provider rejected the message" }; } catch (e) { return { ok: false, provider: p, error: e.message }; } }
  if (devAllowed()) { if (process.env.SOKONI_TEST !== "1") console.log(`[DEV] SMS to ${to}: ${text}`); return { ok: true, provider: "console" }; }
  return { ok: false, provider: "", error: "No SMS provider is connected" };
}
async function sendEmail(to, subject, text) {
  const p = emailProvider(), f = from();
  if (p === "resend") { try { const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from: f, to: [to], subject, text }) }); const d = await j(r);
      return r.ok ? { ok: true, provider: p } : { ok: false, provider: p, error: d.message || "Email provider rejected the message" }; } catch (e) { return { ok: false, provider: p, error: e.message }; } }
  if (p === "sendgrid") { const fr = parseFrom(f); try { const r = await fetch("https://api.sendgrid.com/v3/mail/send", { method: "POST", headers: { Authorization: "Bearer " + process.env.SENDGRID_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: fr, subject, content: [{ type: "text/plain", value: text }] }) });
      if (r.status === 202) return { ok: true, provider: p }; const d = await j(r); return { ok: false, provider: p, error: (d.errors && d.errors[0] && d.errors[0].message) || "Email provider rejected the message" }; } catch (e) { return { ok: false, provider: p, error: e.message }; } }
  if (devAllowed()) { if (process.env.SOKONI_TEST !== "1") console.log(`[DEV] EMAIL to ${to}: ${subject} — ${text.split("\n")[0]}`); return { ok: true, provider: "console" }; }
  return { ok: false, provider: "", error: "No email provider is connected" };
}
const codeSms = (code) => `Your Sokoni code is ${code}. It expires in 10 minutes. Never share it with anyone.`;
const codeEmail = (code, why) => ({ subject: `Your Sokoni code: ${code}`, text: `Your Sokoni ${why || "verification"} code is ${code}.\n\nIt expires in 10 minutes. If you didn't ask for it, ignore this message — nobody can use it without your password.\n\nNever share this code with anyone, including people who say they are from Sokoni.` });
module.exports = { sendSms, sendEmail, smsProvider, emailProvider, devAllowed, baseIsLocal, codeSms, codeEmail };
