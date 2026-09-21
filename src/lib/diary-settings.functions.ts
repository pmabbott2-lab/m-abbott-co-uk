import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canView } from "@/lib/admin-access";
import { resolveAdminAccess } from "@/lib/admin.functions";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const windowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(timeRegex),
  endTime: z.string().regex(timeRegex),
  active: z.boolean(),
});

const exceptionSchema = z.object({
  exceptionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  unavailable: z.boolean().default(true),
  note: z.string().max(200).optional().nullable(),
});

export type DiaryDayWindow = z.infer<typeof windowSchema>;
export type DiaryException = z.infer<typeof exceptionSchema> & { id?: string };

export type DiarySettingsPayload = {
  advisorId: string;
  slotMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxHorizonDays: number;
  windows: DiaryDayWindow[];
  exceptions: Array<DiaryException & { id: string }>;
};

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

async function assertCanManageDiary(userId: string, email: string | undefined, targetAdvisorId: string) {
  if (userId === targetAdvisorId) {
    const { resolveActingTenantRole } = await import("@/lib/tenant-role.server");
    const view = await resolveActingTenantRole(userId);
    if (view.isAdvisor) return;
  }

  const access = await resolveAdminAccess(userId, email);
  if (access.isOwner || access.isSupervisor || canView(access, "advisors") || canView(access, "appointments")) {
    return;
  }
  throw new Error("Forbidden");
}

export const getAdvisorDiarySettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        advisorId: z.string().uuid().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const advisorId = data.advisorId ?? context.userId;
    await assertCanManageDiary(context.userId, email, advisorId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: settings }, { data: windows, error: winErr }, { data: exceptions, error: exErr }] =
      await Promise.all([
        supabaseAdmin.from("advisor_diary_settings").select("*").eq("advisor_id", advisorId).maybeSingle(),
        supabaseAdmin
          .from("advisor_availability")
          .select("day_of_week, start_time, end_time, active, slot_minutes")
          .eq("advisor_id", advisorId)
          .order("day_of_week")
          .order("start_time"),
        supabaseAdmin
          .from("advisor_diary_exceptions")
          .select("id, exception_date, unavailable, note")
          .eq("advisor_id", advisorId)
          .gte("exception_date", new Date().toISOString().slice(0, 10))
          .order("exception_date"),
      ]);

    if (winErr) throw new Error(winErr.message);
    if (exErr) throw new Error(exErr.message);

    const mappedWindows: DiaryDayWindow[] = (windows ?? []).map((w) => ({
      dayOfWeek: w.day_of_week,
      startTime: String(w.start_time).slice(0, 5),
      endTime: String(w.end_time).slice(0, 5),
      active: w.active !== false,
    }));

    // Default Mon–Fri 09:00–17:00 when nothing configured yet.
    const effectiveWindows =
      mappedWindows.length > 0
        ? mappedWindows
        : [1, 2, 3, 4, 5].map((dayOfWeek) => ({
            dayOfWeek,
            startTime: "09:00",
            endTime: "17:00",
            active: true,
          }));

    const slotFromWindows = windows?.[0]?.slot_minutes;

    return {
      advisorId,
      dayNames: DAY_NAMES,
      slotMinutes: settings?.slot_minutes ?? slotFromWindows ?? 90,
      bufferMinutes: settings?.buffer_minutes ?? 0,
      minNoticeMinutes: settings?.min_notice_minutes ?? 60,
      maxHorizonDays: settings?.max_horizon_days ?? 28,
      windows: effectiveWindows,
      exceptions: (exceptions ?? []).map((e) => ({
        id: e.id as string,
        exceptionDate: String(e.exception_date).slice(0, 10),
        unavailable: e.unavailable !== false,
        note: e.note ?? null,
      })),
    } satisfies DiarySettingsPayload & { dayNames: typeof DAY_NAMES };
  });

export const saveAdvisorDiarySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        advisorId: z.string().uuid().optional(),
        slotMinutes: z.number().int().min(15).max(240),
        bufferMinutes: z.number().int().min(0).max(180),
        minNoticeMinutes: z.number().int().min(0).max(10080),
        maxHorizonDays: z.number().int().min(1).max(180),
        windows: z.array(windowSchema).max(28),
        exceptions: z.array(exceptionSchema).max(90),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const advisorId = data.advisorId ?? context.userId;
    await assertCanManageDiary(context.userId, email, advisorId);

    for (const w of data.windows) {
      if (parseTimeToMinutes(w.endTime) <= parseTimeToMinutes(w.startTime)) {
        throw new Error(
          `${DAY_NAMES[w.dayOfWeek]} window ${w.startTime}–${w.endTime} is invalid (end must be after start).`,
        );
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: settingsErr } = await supabaseAdmin.from("advisor_diary_settings").upsert({
      advisor_id: advisorId,
      slot_minutes: data.slotMinutes,
      buffer_minutes: data.bufferMinutes,
      min_notice_minutes: data.minNoticeMinutes,
      max_horizon_days: data.maxHorizonDays,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    });
    if (settingsErr) throw new Error(settingsErr.message);

    const { error: delWinErr } = await supabaseAdmin
      .from("advisor_availability")
      .delete()
      .eq("advisor_id", advisorId);
    if (delWinErr) throw new Error(delWinErr.message);

    if (data.windows.length > 0) {
      const { error: insWinErr } = await supabaseAdmin.from("advisor_availability").insert(
        data.windows.map((w) => ({
          advisor_id: advisorId,
          day_of_week: w.dayOfWeek,
          start_time: w.startTime,
          end_time: w.endTime,
          slot_minutes: data.slotMinutes,
          active: w.active,
        })),
      );
      if (insWinErr) throw new Error(insWinErr.message);
    }

    const { error: delExErr } = await supabaseAdmin
      .from("advisor_diary_exceptions")
      .delete()
      .eq("advisor_id", advisorId)
      .gte("exception_date", new Date().toISOString().slice(0, 10));
    if (delExErr) throw new Error(delExErr.message);

    if (data.exceptions.length > 0) {
      const { error: insExErr } = await supabaseAdmin.from("advisor_diary_exceptions").insert(
        data.exceptions.map((e) => ({
          advisor_id: advisorId,
          exception_date: e.exceptionDate,
          unavailable: e.unavailable,
          note: e.note?.trim() || null,
        })),
      );
      if (insExErr) throw new Error(insExErr.message);
    }

    return { ok: true as const };
  });
