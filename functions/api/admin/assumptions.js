/** GET/PUT /api/admin/assumptions: default rates and starting inputs for new plans (KV key "assumptions"). */
import { cleanRates, cleanScenario, cleanIntroInputs } from "../../../marketing/mortgage-hub-website/admin/model.js";
import { json, fail, kvOf, readJsonBody, errorResponse } from "../../_lib/admin-store.js";

const KEY = "assumptions";

export async function onRequestGet({ env, data }) {
  const kv = kvOf(env);
  if (!kv) return fail(503, "Storage not configured");
  return json({ ok: true, user: data.adminEmail || null, assumptions: await kv.get(KEY, "json") });
}

export async function onRequestPut({ request, env, data }) {
  const kv = kvOf(env);
  if (!kv) return fail(503, "Storage not configured");
  try {
    const body = await readJsonBody(request);
    const current = (await kv.get(KEY, "json")) || {};
    const record = {
      version: 1,
      rates: cleanRates(body && body.rates),
      adviserTemplate: body && body.adviserTemplate ? cleanScenario(body.adviserTemplate, "Starting inputs, ") : current.adviserTemplate || null,
      introducerTemplate: body && body.introducerTemplate ? cleanIntroInputs(body.introducerTemplate, "Introducer starting inputs, ") : current.introducerTemplate || null,
      updatedAt: new Date().toISOString(),
      updatedBy: data.adminEmail || null,
    };
    await kv.put(KEY, JSON.stringify(record));
    return json({ ok: true, assumptions: record });
  } catch (err) {
    return errorResponse(err);
  }
}
