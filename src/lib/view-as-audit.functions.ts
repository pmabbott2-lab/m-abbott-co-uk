import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveAdminAccess } from "@/lib/admin.functions";

function isMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

export type ViewAsAuditRow = {
  id: string;
  view_type: "advisor" | "introducer" | "customer";
  acting_user_id: string;
  target_user_id: string;
  action: string;
  summary: string;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export async function logViewAsAudit(
  supabaseAdmin: Awaited<
    ReturnType<typeof import("@/integrations/supabase/client.server")>
  >["supabaseAdmin"],
  row: {
    viewType: "advisor" | "introducer" | "customer";
    actingUserId: string;
    targetUserId: string;
    action: string;
    summary: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabaseAdmin.from("view_as_audit_log").insert({
    view_type: row.viewType,
    acting_user_id: row.actingUserId,
    target_user_id: row.targetUserId,
    action: row.action,
    summary: row.summary,
    detail: row.detail ?? null,
  });
  if (error && !isMissing(error)) console.error("view_as_audit_log", error);
}

async function assertViewAsAuditor(userId: string, email: string | null): Promise<void> {
  const access = await resolveAdminAccess(userId, email);
  if (!access.isOwner && !access.isSupervisor) throw new Error("Forbidden");
}

export const listViewAsAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        viewType: z.enum(["advisor", "introducer", "customer"]),
        targetUserId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const {
      data: { user },
    } = await context.supabase.auth.getUser();
    await assertViewAsAuditor(context.userId, user?.email ?? null);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = supabaseAdmin
      .from("view_as_audit_log")
      .select("id, view_type, acting_user_id, target_user_id, action, summary, detail, created_at")
      .eq("view_type", data.viewType)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 200);

    if (data.targetUserId) query = query.eq("target_user_id", data.targetUserId);

    const { data: rows, error } = await query;
    if (error) {
      if (isMissing(error)) return [] as ViewAsAuditRow[];
      throw new Error(error.message);
    }
    return (rows ?? []) as ViewAsAuditRow[];
  });

/** Client-callable audit entry when a view-as action completes in the UI. */
export const recordViewAsAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        viewType: z.enum(["advisor", "introducer", "customer"]),
        targetUserId: z.string().uuid(),
        action: z.string().min(1).max(80),
        summary: z.string().min(1).max(500),
        detail: z.record(z.unknown()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const {
      data: { user },
    } = await context.supabase.auth.getUser();
    await assertViewAsAuditor(context.userId, user?.email ?? null);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await logViewAsAudit(supabaseAdmin, {
      viewType: data.viewType,
      actingUserId: context.userId,
      targetUserId: data.targetUserId,
      action: data.action,
      summary: data.summary,
      detail: data.detail,
    });
    return { ok: true };
  });
