/** Client-safe staff contact task helpers. */

export const STAFF_TASK_TYPES = ["welcome_call", "next_contact"] as const;
export type StaffTaskType = (typeof STAFF_TASK_TYPES)[number];

export const STAFF_TASK_LABELS: Record<StaffTaskType, string> = {
  welcome_call: "Welcome call",
  next_contact: "Next contact",
};

export function isStaffTaskOverdue(
  dueAt: string | null | undefined,
  completedAt: string | null | undefined,
): boolean {
  if (!dueAt || completedAt) return false;
  return new Date(dueAt).getTime() < Date.now();
}
