import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canAmend, canView } from "@/lib/admin-access";
import { resolveAdminAccess } from "@/lib/admin.functions";
import {
  clearCommunicationSettingsCache,
  type CommunicationTemplateRow,
  type CommunicationSettingsRow,
} from "@/lib/comms.server";
import {
  resolveSoleMembershipTenant,
  withForcedTenantId,
} from "@/lib/tenant-assert.server";

async function requireCommsView(userId: string, email?: string) {
  const access = await resolveAdminAccess(userId, email);
  if (!(access.isOwner || access.isSupervisor || canView(access, "comms_templates"))) {
    throw new Error("Forbidden");
  }
  return access;
}

async function requireCommsAmend(userId: string, email?: string) {
  const access = await resolveAdminAccess(userId, email);
  if (!(access.isOwner || access.isSupervisor || canAmend(access, "comms_templates"))) {
    throw new Error("Forbidden");
  }
  return access;
}

export const listCommunicationTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    await requireCommsView(context.userId, email);
    const authorised = await resolveSoleMembershipTenant(context.userId);
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .from("communication_templates")
      .select(
        "id, tenant_id, template_key, name, description, channel, subject, body, active, required_tokens, sort_order, updated_at, updated_by",
      )
      .or(`tenant_id.eq.${authorised.tenant.id},tenant_id.is.null`)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return { templates: (data ?? []) as CommunicationTemplateRow[] };
  });

export const getCommunicationSettingsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    await requireCommsView(context.userId, email);
    const authorised = await resolveSoleMembershipTenant(context.userId);
    const { getCommunicationSettings } = await import("@/lib/comms.server");
    return getCommunicationSettings(authorised.tenant.id);
  });

export const updateCommunicationSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        emailRegulatoryFooter: z.string().max(4000),
        smsRegulatoryFooter: z.string().max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    await requireCommsAmend(context.userId, email);
    const authorised = await resolveSoleMembershipTenant(context.userId);
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    let sms = data.smsRegulatoryFooter.trim();
    if (sms && !sms.startsWith("*")) sms = `*${sms}`;
    const payload = withForcedTenantId({
      id: 1,
      email_regulatory_footer: data.emailRegulatoryFooter.trim(),
      sms_regulatory_footer: sms,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    }, authorised.tenant.id);
    const { data: existing, error: readErr } = await supabaseAdmin
      .from("communication_settings")
      .select("id")
      .eq("id", 1)
      .eq("tenant_id", authorised.tenant.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const { error } = existing
      ? await supabaseAdmin
          .from("communication_settings")
          .update(payload)
          .eq("id", 1)
          .eq("tenant_id", authorised.tenant.id)
      : await supabaseAdmin.from("communication_settings").insert(payload);
    if (error) throw new Error(error.message);
    clearCommunicationSettingsCache(authorised.tenant.id);
    return { ok: true };
  });

export const updateCommunicationTemplateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        templateId: z.string().uuid(),
        subject: z.string().max(300).nullable().optional(),
        body: z.string().min(1).max(8000),
        active: z.boolean().optional(),
        changeNote: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    await requireCommsAmend(context.userId, email);
    const authorised = await resolveSoleMembershipTenant(context.userId);
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: existing, error: readErr } = await supabaseAdmin
      .from("communication_templates")
      .select("id, tenant_id, subject, body")
      .eq("id", data.templateId)
      .or(`tenant_id.eq.${authorised.tenant.id},tenant_id.is.null`)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!existing) throw new Error("Template not found");

    let lastVersionQuery = supabaseAdmin
      .from("communication_template_versions")
      .select("version")
      .eq("template_id", data.templateId)
      .order("version", { ascending: false })
      .limit(1);
    lastVersionQuery = existing.tenant_id
      ? lastVersionQuery.eq("tenant_id", authorised.tenant.id)
      : lastVersionQuery.is("tenant_id", null);
    const { data: lastVer } = await lastVersionQuery.maybeSingle();
    const nextVersion = (lastVer?.version ?? 0) + 1;

    const versionPayload = {
      template_id: data.templateId,
      version: nextVersion,
      subject: existing.subject,
      body: existing.body,
      changed_by: context.userId,
      change_note: data.changeNote ?? "Saved previous version before amend",
    };
    await supabaseAdmin
      .from("communication_template_versions")
      .insert(existing.tenant_id
        ? withForcedTenantId(versionPayload, authorised.tenant.id)
        : versionPayload);

    const patch: Record<string, unknown> = {
      body: data.body,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    };
    if (data.subject !== undefined) patch.subject = data.subject;
    if (data.active !== undefined) patch.active = data.active;

    let updateQuery = supabaseAdmin
      .from("communication_templates")
      .update(patch)
      .eq("id", data.templateId);
    updateQuery = existing.tenant_id
      ? updateQuery.eq("tenant_id", authorised.tenant.id)
      : updateQuery.is("tenant_id", null);
    const { error } = await updateQuery;
    if (error) throw new Error(error.message);
    return { ok: true, version: nextVersion };
  });

export type { CommunicationTemplateRow, CommunicationSettingsRow };
