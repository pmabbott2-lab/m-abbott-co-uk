/**
 * /api/admin/scenarios: saved adviser plans (KV keys "plan:<uuid>").
 *   GET            list (name, adviser, updatedAt)
 *   GET ?all=1     every plan in full (firm view)
 *   GET ?id=…      one plan
 *   PUT            { id?, plan } create or update
 *   DELETE ?id=…   remove
 */
import { cleanPlan } from "../../../marketing/mortgage-hub-website/admin/model.js";
import { json, fail, kvOf, readJsonBody, errorResponse } from "../../_lib/admin-store.js";

const PREFIX = "plan:";
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function listKeys(kv) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: PREFIX, cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

function idFrom(url) {
  const id = new URL(url).searchParams.get("id");
  return id && ID_RE.test(id) ? id : null;
}

export async function onRequestGet({ request, env }) {
  const kv = kvOf(env);
  if (!kv) return fail(503, "Storage not configured");
  const url = new URL(request.url);
  if (url.searchParams.has("id")) {
    const id = idFrom(request.url);
    const record = id && (await kv.get(PREFIX + id, "json"));
    return record ? json({ ok: true, plan: record }) : fail(404, "Plan not found");
  }
  const keys = await listKeys(kv);
  if (url.searchParams.get("all") === "1") {
    const plans = await Promise.all(keys.map((k) => kv.get(k.name, "json")));
    return json({ ok: true, plans: plans.filter(Boolean) });
  }
  const plans = keys.map((k) => ({ id: k.name.slice(PREFIX.length), ...(k.metadata || {}) }));
  plans.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  return json({ ok: true, plans });
}

export async function onRequestPut({ request, env, data }) {
  const kv = kvOf(env);
  if (!kv) return fail(503, "Storage not configured");
  try {
    const body = await readJsonBody(request);
    const id = body && body.id ? String(body.id) : crypto.randomUUID();
    if (!ID_RE.test(id)) return fail(400, "Invalid plan id");
    const plan = cleanPlan(body && body.plan);
    const updatedAt = new Date().toISOString();
    const record = { id, ...plan, updatedAt, updatedBy: data.adminEmail || null };
    await kv.put(PREFIX + id, JSON.stringify(record), { metadata: { name: plan.name, adviser: plan.adviser, updatedAt } });
    return json({ ok: true, plan: record });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete({ request, env }) {
  const kv = kvOf(env);
  if (!kv) return fail(503, "Storage not configured");
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail(403, "Cross-origin request refused");
  const id = idFrom(request.url);
  if (!id) return fail(400, "Invalid plan id");
  await kv.delete(PREFIX + id);
  return json({ ok: true });
}
