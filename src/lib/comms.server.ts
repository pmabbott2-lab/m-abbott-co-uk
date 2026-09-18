/**
 * Communication templates + shared regulatory footers.
 * SMS/email bodies are editable in Marketing → Scripts; regulatory text is
 * stored once and appended automatically on send.
 */
import { supabaseAdminUntyped as supabaseAdmin } from "@/integrations/supabase/client.server";

export type CommsChannel = "sms" | "email" | "voice";

export type CommunicationTemplateRow = {
  id: string;
  tenant_id?: string | null;
  template_key: string;
  name: string;
  description: string;
  channel: CommsChannel;
  subject: string | null;
  body: string;
  active: boolean;
  required_tokens: string[];
  sort_order: number;
  updated_at: string;
  updated_by: string | null;
};

export type CommunicationSettingsRow = {
  email_regulatory_footer: string;
  sms_regulatory_footer: string;
  updated_at: string;
  updated_by: string | null;
};

const settingsCache = new Map<
  string,
  { at: number; value: CommunicationSettingsRow }
>();

function isMissingRelation(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  return (
    error.code === "42P01" ||
    /relation .* does not exist/i.test(msg) ||
    /could not find the table/i.test(msg)
  );
}

/** Replace {token} placeholders. Unknown tokens left intact. */
export function interpolateTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{([a-z0-9_]+)\}/gi, (_full, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key] ?? "";
    return `{${key}}`;
  });
}

/** Ensure SMS regulatory line begins with * as required for short disclosures. */
export function normaliseSmsRegulatoryFooter(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("*") ? trimmed : `*${trimmed}`;
}

export function appendSmsRegulatoryFooter(body: string, footer: string): string {
  const text = body.trimEnd();
  const reg = normaliseSmsRegulatoryFooter(footer);
  if (!reg) return text;
  if (text.includes(reg)) return text;
  // Avoid duplicating if body already ends with a * disclosure line
  const lines = text.split("\n");
  const last = lines[lines.length - 1]?.trim() ?? "";
  if (last.startsWith("*") && last.length > 8) return text;
  return `${text}\n${reg}`;
}

export function appendEmailRegulatoryFooter(body: string, footer: string): string {
  const text = body.trimEnd();
  const reg = footer.trim();
  if (!reg) return text;
  if (text.includes(reg)) return text;
  return `${text}\n\n---\n${reg}`;
}

export async function getCommunicationSettings(
  tenantId?: string,
): Promise<CommunicationSettingsRow> {
  const now = Date.now();
  const cacheKey = tenantId ?? "__platform__";
  const cached = settingsCache.get(cacheKey);
  if (cached && now - cached.at < 30_000) return cached.value;

  let query = supabaseAdmin
    .from("communication_settings")
    .select("email_regulatory_footer, sms_regulatory_footer, updated_at, updated_by")
    .eq("id", 1);
  query = tenantId ? query.eq("tenant_id", tenantId) : query.is("tenant_id", null);
  const { data, error } = await query.maybeSingle();

  if (error && !isMissingRelation(error)) {
    console.error("[comms] load settings failed", error.message);
  }

  const value: CommunicationSettingsRow = {
    // Unknown/missing tenant context must never inherit Mortgage Easy (001) text.
    email_regulatory_footer: data?.email_regulatory_footer ?? "",
    sms_regulatory_footer: data?.sms_regulatory_footer ?? "",
    updated_at: data?.updated_at ?? new Date().toISOString(),
    updated_by: data?.updated_by ?? null,
  };
  settingsCache.set(cacheKey, { at: now, value });
  return value;
}

export function clearCommunicationSettingsCache(tenantId?: string) {
  if (tenantId) settingsCache.delete(tenantId);
  else settingsCache.clear();
}

export async function getCommunicationTemplate(
  templateKey: string,
  tenantId?: string,
): Promise<CommunicationTemplateRow | null> {
  let query = supabaseAdmin
    .from("communication_templates")
    .select(
      "id, tenant_id, template_key, name, description, channel, subject, body, active, required_tokens, sort_order, updated_at, updated_by",
    )
    .eq("template_key", templateKey)
    .eq("active", true);
  query = tenantId
    ? query.or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
    : query.is("tenant_id", null);
  const { data, error } = await query.maybeSingle();

  if (error) {
    if (!isMissingRelation(error)) console.error("[comms] load template failed", templateKey, error.message);
    return null;
  }
  return (data as CommunicationTemplateRow | null) ?? null;
}

export async function renderSmsFromTemplate(
  templateKey: string,
  vars: Record<string, string>,
  fallback: string,
  tenantId?: string,
): Promise<string> {
  const tpl = await getCommunicationTemplate(templateKey, tenantId);
  const body = tpl ? interpolateTemplate(tpl.body, vars) : fallback;
  const settings = await getCommunicationSettings(tenantId);
  return appendSmsRegulatoryFooter(body, settings.sms_regulatory_footer);
}

export async function renderEmailFromTemplate(
  templateKey: string,
  vars: Record<string, string>,
  fallbackBody: string,
  fallbackSubject?: string,
  tenantId?: string,
): Promise<{ subject: string; body: string }> {
  const tpl = await getCommunicationTemplate(templateKey, tenantId);
  const subject = tpl?.subject
    ? interpolateTemplate(tpl.subject, vars)
    : fallbackSubject ?? "";
  const rawBody = tpl ? interpolateTemplate(tpl.body, vars) : fallbackBody;
  const settings = await getCommunicationSettings(tenantId);
  return {
    subject,
    body: appendEmailRegulatoryFooter(rawBody, settings.email_regulatory_footer),
  };
}

/** Append regulatory footer to an already-built SMS body (for callers that skip templates). */
export async function withSmsRegulatoryFooter(body: string, tenantId?: string): Promise<string> {
  const settings = await getCommunicationSettings(tenantId);
  return appendSmsRegulatoryFooter(body, settings.sms_regulatory_footer);
}
