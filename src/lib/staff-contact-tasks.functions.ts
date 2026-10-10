import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  completeStaffContactTaskById,
  STAFF_TASK_LABELS,
  type StaffTaskType,
} from "@/lib/staff-contact-tasks.server";

export const completeStaffContactTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ taskId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, supabaseAdminUntyped } =
      await import("@/integrations/supabase/client.server");
    const { authoriseTenantResource, resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE } =
      await import("@/lib/tenant-assert.server");
    const capability = {
      mutate: true,
      allocation: "adviser_must_be_allocated" as const,
      allow: (v: { member: boolean; isMainAdmin: boolean; isAdvisor: boolean }) =>
        v.member && (v.isMainAdmin || v.isAdvisor),
    };
    // Role is checked in the verified acting tenant before the task is read, so an unknown task
    // and a foreign one give the same answer.
    await resolveActingTenantForList(context.userId, capability);
    const { data: task, error: taskErr } = await supabaseAdminUntyped
      .from("staff_contact_tasks")
      .select("session_id, tenant_id")
      .eq("id", data.taskId)
      .maybeSingle();
    if (taskErr) throw new Error(taskErr.message);
    const taskRow = task as { session_id: string | null; tenant_id: string | null } | null;
    if (!taskRow?.session_id) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
    const { tenantId } = await authoriseTenantResource({
      userId: context.userId,
      kind: "session",
      id: taskRow.session_id,
      capability,
    });
    if (taskRow.tenant_id && taskRow.tenant_id !== tenantId) {
      throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
    }

    const result = await completeStaffContactTaskById(supabaseAdmin, data.taskId, context.userId);
    if (!result) throw new Error("Task not found or already completed");

    const label = STAFF_TASK_LABELS[result.taskType as StaffTaskType] ?? result.taskType;
    try {
      await supabaseAdminUntyped.from("customer_contact_log").insert({
        session_id: result.sessionId,
        author_id: context.userId,
        entry_type: "contact",
        body: `${label} completed`,
        tenant_id: tenantId,
      });
    } catch (e) {
      console.error("completeStaffContactTask log failed", e);
    }

    const { clearSessionAttention } = await import("@/lib/sessions.functions");
    await clearSessionAttention(result.sessionId, context.userId, "staff_task_completed");

    return { ok: true, taskType: result.taskType };
  });
