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
    const email = (context.claims as { email?: string }).email;
    const { resolveAdminAccess } = await import("@/lib/admin.functions");
    const adminAccess = await resolveAdminAccess(context.userId, email);
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdvisor = (roles ?? []).some((r) => r.role === "advisor");
    const isStaff = isAdvisor || adminAccess.isAdmin;
    if (!isStaff) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
