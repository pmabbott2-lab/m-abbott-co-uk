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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: task } = await supabaseAdmin
      .from("staff_contact_tasks")
      .select("session_id")
      .eq("id", data.taskId)
      .maybeSingle();
    let tenantId: string | null = null;
    if (task?.session_id) {
      const { data: session } = await supabaseAdmin
        .from("interview_sessions")
        .select("tenant_id")
        .eq("id", task.session_id)
        .maybeSingle();
      tenantId = (session as { tenant_id?: string | null } | null)?.tenant_id ?? null;
    }
    const { requireActingTenantStaff } = await import("@/lib/tenant-role.server");
    await requireActingTenantStaff(context.userId, null, tenantId);

    const result = await completeStaffContactTaskById(supabaseAdmin, data.taskId, context.userId);
    if (!result) throw new Error("Task not found or already completed");

    const label = STAFF_TASK_LABELS[result.taskType as StaffTaskType] ?? result.taskType;
    try {
      await supabaseAdmin.from("customer_contact_log").insert({
        session_id: result.sessionId,
        author_id: context.userId,
        entry_type: "contact",
        body: `${label} completed`,
      });
    } catch (e) {
      console.error("completeStaffContactTask log failed", e);
    }

    const { clearSessionAttention } = await import("@/lib/sessions.functions");
    await clearSessionAttention(result.sessionId, context.userId, "staff_task_completed");

    return { ok: true, taskType: result.taskType };
  });
