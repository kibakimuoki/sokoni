// Single place that talks to Claude. Remembers the last result so the Operations console can show WHY an AI call failed
// (bad key, wrong model, no credit, web-search not enabled…) instead of failing silently.
const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const configured = () => !!process.env.ANTHROPIC_API_KEY;
const last = { ok: null, at: null, kind: null, error: null, model: null };
async function claude({ system, messages, max_tokens = 900, tools, kind = "call", model }) {
  if (!configured()) { last.ok = false; last.at = new Date().toISOString(); last.kind = kind; last.error = "ANTHROPIC_API_KEY is not set"; return { ok: false, error: { status: 0, message: last.error } }; }
  const body = { model: model || MODEL(), max_tokens, messages }; if (system) body.system = system; if (tools) body.tools = tools;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 90000);
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", ...(process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : {}) }, body: JSON.stringify(body) }); clearTimeout(t);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const msg = (d.error && d.error.message) || r.statusText || "request failed"; Object.assign(last, { ok: false, at: new Date().toISOString(), kind, error: `${r.status}: ${msg}`, model: body.model }); console.error("Claude error", kind, last.error); return { ok: false, error: { status: r.status, message: msg } }; }
    Object.assign(last, { ok: true, at: new Date().toISOString(), kind, error: null, model: body.model }); return { ok: true, data: d };
  } catch (e) { Object.assign(last, { ok: false, at: new Date().toISOString(), kind, error: e.name === "AbortError" ? "timed out" : e.message, model: body.model }); console.error("Claude error", kind, last.error); return { ok: false, error: { status: 0, message: last.error } }; }
}
const textOf = (d) => ((d && d.content) || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
function jsonOf(text) { const s = String(text || "").replace(/```(?:json)?/gi, ""); const a = s.indexOf("{"), b = s.lastIndexOf("}"); if (a < 0 || b <= a) return null; try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; } }
const selfTest = () => claude({ messages: [{ role: "user", content: "Reply with the single word OK." }], max_tokens: 10, kind: "self-test" });
// What an error from the AI provider means for the person setting this up.
function explain(err) {
  const st = (err && err.status) || 0, msg = String((err && err.message) || ""), key = String(process.env.ANTHROPIC_API_KEY || "");
  if (st === 0) return `Couldn't reach the AI provider (${msg || "no answer"}). Check this computer's internet connection and try again.`;
  if (st === 401 || st === 403 || /invalid x-api-key|authentication|permission/i.test(msg)) { const hint = /^sk-ant-admin/.test(key) ? " This looks like an ADMIN key, which can't send messages — create a normal API key." : !/^sk-ant-/.test(key) ? " It doesn't look like an API key from the provider (they start with “sk-ant-”)." : ""; return `The AI provider rejected the key. Check you pasted the whole key, that it hasn't been revoked or disabled, and that it belongs to the right workspace.${hint}`; }
  if (st === 404 || /model/i.test(msg) && st < 500) return `The AI provider doesn't accept the model “${MODEL()}”. Clear the model box to use the default, or enter a current model name. (${msg})`;
  if (/credit balance|billing|payment/i.test(msg)) return `The AI account has no credit left. Add credit in the provider's console. (${msg})`;
  if (st === 429) return `The AI provider is rate-limiting this key or its spending limit was reached. Check the limits in the provider's console. (${msg})`;
  if (/workspace/i.test(msg)) return `The AI provider says: ${msg} If it asks for a workspace, put the workspace ID in the “Workspace ID” box and save.`;
  return `${st}: ${msg}`;
}
module.exports = { claude, textOf, jsonOf, configured, model: MODEL, last, selfTest, explain };
