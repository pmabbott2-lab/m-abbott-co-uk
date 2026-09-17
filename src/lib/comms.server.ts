/**
 * Communication templates + shared regulatory footers.
 * SMS/email bodies are editable in Marketing → Scripts; regulatory text is
 * stored once and appended automatically on send.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CommsChannel = "sms" | "email" | "voice";

export type CommunicationTemplateRow = {
  id: string;
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

const settingsCache: { at: number; value: CommunicationSettingsRow | null } = {
  at: 0,
  value: null,
};

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

export async function getCommunicationSettings(): Promise<CommunicationSettingsRow> {
  const now = Date.now();
  if (settingsCache.value && now - settingsCache.at < 30_000) return settingsCache.value;

  const { data, error } = await supabaseAdmin
    .from("communication_settings")
    .select("email_regulatory_footer, sms_regulatory_footer, updated_at, updated_by")
    .eq("id", 1)
    .maybeSingle();

  if (error && !isMissingRelation(error)) {
    console.error("[comms] load settings failed", error.message);
  }

  const value: CommunicationSettingsRow = {
    email_regulatory_footer:
      data?.email_regulatory_footer ??
      "MortgageEasy is authorised and regulated by the Financial Conduct Authority.",
    sms_regulatory_footer:
      data?.sms_regulatory_footer ??
      "*MortgageEasy is authorised and regulated by the FCA.",
    updated_at: data?.updated_at ?? new Date().toISOString(),
    updated_by: data?.updated_by ?? null,
  };
  settingsCache.at = now;
  settingsCache.value = value;
  return value;
}

export function clearCommunicationSettingsCache() {
  settingsCache.at = 0;
  settingsCache.value = null;
}

export async function getCommunicationTemplate(
  templateKey: string,
): Promise<CommunicationTemplateRow | null> {
  const { data, error } = await supabaseAdmin
    .from("communication_templates")
    .select(
      "id, template_key, name, description, channel, subject, body, active, required_tokens, sort_order, updated_at, updated_by",
    )
    .eq("template_key", templateKey)
    .eq("active", true)
    .maybeSingle();

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
): Promise<string> {
  const tpl = await getCommunicationTemplate(templateKey);
  const body = tpl ? interpolateTemplate(tpl.body, vars) : fallback;
  const settings = await getCommunicationSettings();
  return appendSmsRegulatoryFooter(body, settings.sms_regulatory_footer);
}

export async function renderEmailFromTemplate(
  templateKey: string,
  vars: Record<string, string>,
  fallbackBody: string,
  fallbackSubject?: string,
): Promise<{ subject: string; body: string }> {
  const tpl = await getCommunicationTemplate(templateKey);
  const subject = tpl?.subject
    ? interpolateTemplate(tpl.subject, vars)
    : fallbackSubject ?? "";
  const rawBody = tpl ? interpolateTemplate(tpl.body, vars) : fallbackBody;
  const settings = await getCommunicationSettings();
  return {
    subject,
    body: appendEmailRegulatoryFooter(rawBody, settings.email_regulatory_footer),
  };
}

/** Append regulatory footer to an already-built SMS body (for callers that skip templates). */
export async function withSmsRegulatoryFooter(body: string): Promise<string> {
  const settings = await getCommunicationSettings();
  return appendSmsRegulatoryFooter(body, settings.sms_regulatory_footer);
}
