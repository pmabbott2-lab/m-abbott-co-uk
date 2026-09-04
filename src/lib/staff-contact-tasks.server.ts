/** Internal staff-only contact tasks (welcome call, next contact). */

import type { StaffTaskType } from "@/lib/staff-contact-tasks";

export {
  STAFF_TASK_TYPES,
  STAFF_TASK_LABELS,
  isStaffTaskOverdue,
  type StaffTaskType,
} from "@/lib/staff-contact-tasks";

/** Default SLA for welcome call after allocation / case open. */
export const WELCOME_CALL_DUE_MS = 24 * 60 * 60 * 1000;

export type StaffContactTaskRow = {
  id: string;
  session_id: string;
  task_type: StaffTaskType;
  due_at: string;
  completed_at: string | null;
  created_at: string;
};

function isMissingTaskTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

type SupabaseAdmin = Awaited<
  ReturnType<typeof import("@/integrations/supabase/client.server")>
>["supabaseAdmin"];

export async function ensureWelcomeCallTask(
  supabaseAdmin: SupabaseAdmin,
  sessionId: string,
  createdBy: string | null,
  opts?: { dueAt?: string },
): Promise<void> {
  // One welcome call per session ever (completed or open) — staff-only contact task.
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("staff_contact_tasks")
    .select("id")
    .eq("session_id", sessionId)
    .eq("task_type", "welcome_call")
    .limit(1)
    .maybeSingle();
  if (readErr && !isMissingTaskTable(readErr)) {
    console.error("ensureWelcomeCallTask read failed", readErr);
    return;
  }
  if (existing) return;

  const dueAt =
    opts?.dueAt ?? new Date(Date.now() + WELCOME_CALL_DUE_MS).toISOString();

  const { error } = await supabaseAdmin.from("staff_contact_tasks").insert({
    session_id: sessionId,
    task_type: "welcome_call",
    due_at: dueAt,
    created_by: createdBy,
  });
  if (error && !isMissingTaskTable(error)) console.error("ensureWelcomeCallTask insert failed", error);
}

/**
 * Backfill welcome-call tasks for sessions that already have a confirmed appointment
 * but never received a staff contact task (e.g. booked before this feature).
 * Due = appointment created_at + 24h (so today's bookings show as due / overdue correctly).
 */
export async function backfillWelcomeCallsFromAppointments(
  supabaseAdmin: SupabaseAdmin,
  sessionIds?: string[],
): Promise<number> {
  let apptQuery = supabaseAdmin
    .from("appointments")
    .select("session_id, created_at")
    .eq("status", "confirmed")
    .not("session_id", "is", null)
    .order("created_at", { ascending: true });
  if (sessionIds && sessionIds.length > 0) {
    apptQuery = apptQuery.in("session_id", sessionIds);
  }
  const { data: appts, error: apptErr } = await apptQuery;
  if (apptErr) {
    if (isMissingTaskTable(apptErr)) return 0;
    console.error("backfillWelcomeCallsFromAppointments appts failed", apptErr);
    return 0;
  }
  if (!appts?.length) return 0;

  const bySession = new Map<string, string>();
  for (const row of appts) {
    const sid = row.session_id as string | null;
    if (!sid || bySession.has(sid)) continue;
    bySession.set(sid, row.created_at as string);
  }

  const ids = [...bySession.keys()];
  const { data: existing, error: existErr } = await supabaseAdmin
    .from("staff_contact_tasks")
    .select("session_id")
    .eq("task_type", "welcome_call")
    .in("session_id", ids);
  if (existErr) {
    if (isMissingTaskTable(existErr)) return 0;
    console.error("backfillWelcomeCallsFromAppointments existing failed", existErr);
    return 0;
  }
  const have = new Set((existing ?? []).map((r) => r.session_id as string));

  let created = 0;
  for (const [sessionId, createdAt] of bySession) {
    if (have.has(sessionId)) continue;
    const dueAt = new Date(new Date(createdAt).getTime() + WELCOME_CALL_DUE_MS).toISOString();
    await ensureWelcomeCallTask(supabaseAdmin, sessionId, null, { dueAt });
    created += 1;
  }
  return created;
}

export async function listStaffContactTasksForSession(
  supabaseAdmin: SupabaseAdmin,
  sessionId: string,
): Promise<Array<StaffContactTaskRow & { completed_by: string | null }>> {
  const { data, error } = await supabaseAdmin
    .from("staff_contact_tasks")
    .select("id, session_id, task_type, due_at, completed_at, completed_by, created_at")
    .eq("session_id", sessionId)
    .order("due_at", { ascending: true });
  if (error) {
    if (isMissingTaskTable(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as Array<StaffContactTaskRow & { completed_by: string | null }>;
}

export async function syncNextContactTask(
  supabaseAdmin: SupabaseAdmin,
  sessionId: string,
  nextContactAt: string | null,
  userId: string | null,
): Promise<void> {
  if (!nextContactAt) {
    const { error } = await supabaseAdmin
      .from("staff_contact_tasks")
      .update({ completed_at: new Date().toISOString(), completed_by: userId })
      .eq("session_id", sessionId)
      .eq("task_type", "next_contact")
      .is("completed_at", null);
    if (error && !isMissingTaskTable(error)) console.error("syncNextContactTask clear failed", error);
    return;
  }

  const { data: open, error: readErr } = await supabaseAdmin
    .from("staff_contact_tasks")
    .select("id")
    .eq("session_id", sessionId)
    .eq("task_type", "next_contact")
    .is("completed_at", null)
    .maybeSingle();
  if (readErr && !isMissingTaskTable(readErr)) {
    console.error("syncNextContactTask read failed", readErr);
    return;
  }

  if (open) {
    const { error } = await supabaseAdmin
      .from("staff_contact_tasks")
      .update({ due_at: nextContactAt })
      .eq("id", open.id);
    if (error && !isMissingTaskTable(error)) console.error("syncNextContactTask update failed", error);
    return;
  }

  const { error } = await supabaseAdmin.from("staff_contact_tasks").insert({
    session_id: sessionId,
    task_type: "next_contact",
    due_at: nextContactAt,
    created_by: userId,
  });
  if (error && !isMissingTaskTable(error)) console.error("syncNextContactTask insert failed", error);
}

export async function listOpenStaffContactTasks(
  supabaseAdmin: SupabaseAdmin,
  sessionIds?: string[],
): Promise<StaffContactTaskRow[]> {
  // Empty array = advisor with no allocations → no tasks (do not fall through to "all").
  if (sessionIds && sessionIds.length === 0) return [];

  let query = supabaseAdmin
    .from("staff_contact_tasks")
    .select("id, session_id, task_type, due_at, completed_at, created_at")
    .is("completed_at", null)
    .order("due_at", { ascending: true });
  if (sessionIds && sessionIds.length > 0) {
    query = query.in("session_id", sessionIds);
  }
  const { data, error } = await query;
  if (error) {
    if (isMissingTaskTable(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as StaffContactTaskRow[];
}

export async function completeStaffContactTaskById(
  supabaseAdmin: SupabaseAdmin,
  taskId: string,
  userId: string,
): Promise<{ taskType: StaffTaskType; sessionId: string } | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("staff_contact_tasks")
    .update({ completed_at: now, completed_by: userId })
    .eq("id", taskId)
    .is("completed_at", null)
    .select("session_id, task_type")
    .maybeSingle();
  if (error) {
    if (isMissingTaskTable(error)) return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  return {
    taskType: data.task_type as StaffTaskType,
    sessionId: data.session_id,
  };
}

export { isMissingTaskTable };
