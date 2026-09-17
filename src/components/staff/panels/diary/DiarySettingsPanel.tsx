import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Plus, Trash2 } from "lucide-react";
import {
  getAdvisorDiarySettings,
  saveAdvisorDiarySettings,
  type DiaryDayWindow,
  type DiaryException,
} from "@/lib/diary-settings.functions";
import { listAdvisors } from "@/lib/sessions.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = {
  /** When set (advisor view), lock to that advisor. */
  viewAsAdvisorId?: string;
  /** Admins can pick whose settings to edit. */
  allowAdvisorFilter?: boolean;
};

export function DiarySettingsPanel({ viewAsAdvisorId, allowAdvisorFilter }: Props) {
  const qc = useQueryClient();
  const getFn = useServerFn(getAdvisorDiarySettings);
  const saveFn = useServerFn(saveAdvisorDiarySettings);
  const advisorsFn = useServerFn(listAdvisors);

  const [advisorId, setAdvisorId] = useState(viewAsAdvisorId ?? "");
  const [slotMinutes, setSlotMinutes] = useState(90);
  const [bufferMinutes, setBufferMinutes] = useState(0);
  const [minNoticeMinutes, setMinNoticeMinutes] = useState(60);
  const [maxHorizonDays, setMaxHorizonDays] = useState(28);
  const [windows, setWindows] = useState<DiaryDayWindow[]>([]);
  const [exceptions, setExceptions] = useState<Array<DiaryException & { id?: string }>>([]);
  const [newExceptionDate, setNewExceptionDate] = useState("");

  useEffect(() => {
    if (viewAsAdvisorId) setAdvisorId(viewAsAdvisorId);
  }, [viewAsAdvisorId]);

  const advisorsQ = useQuery({
    queryKey: ["advisors-list"],
    queryFn: () => advisorsFn(),
    enabled: Boolean(allowAdvisorFilter) && !viewAsAdvisorId,
  });

  const settingsKey = advisorId || "self";
  const settingsQ = useQuery({
    queryKey: ["diary-settings", settingsKey],
    queryFn: () =>
      getFn({
        data: advisorId ? { advisorId } : {},
      }),
  });

  useEffect(() => {
    if (!settingsQ.data) return;
    setSlotMinutes(settingsQ.data.slotMinutes);
    setBufferMinutes(settingsQ.data.bufferMinutes);
    setMinNoticeMinutes(settingsQ.data.minNoticeMinutes);
    setMaxHorizonDays(settingsQ.data.maxHorizonDays);
    setWindows(settingsQ.data.windows);
    setExceptions(settingsQ.data.exceptions);
    if (!advisorId && settingsQ.data.advisorId) setAdvisorId(settingsQ.data.advisorId);
  }, [settingsQ.data]);

  const windowsByDay = useMemo(() => {
    const map = new Map<number, DiaryDayWindow[]>();
    for (let d = 0; d < 7; d++) map.set(d, []);
    for (const w of windows) {
      map.get(w.dayOfWeek)?.push(w);
    }
    return map;
  }, [windows]);

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          advisorId: advisorId || undefined,
          slotMinutes,
          bufferMinutes,
          minNoticeMinutes,
          maxHorizonDays,
          windows,
          exceptions: exceptions.map((e) => ({
            exceptionDate: e.exceptionDate,
            unavailable: e.unavailable !== false,
            note: e.note ?? null,
          })),
        },
      }),
    onSuccess: () => {
      toast.success("Diary availability saved");
      qc.invalidateQueries({ queryKey: ["diary-settings"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  function setDayAvailable(day: number, available: boolean) {
    setWindows((prev) => {
      const without = prev.filter((w) => w.dayOfWeek !== day);
      if (!available) return without;
      if (prev.some((w) => w.dayOfWeek === day)) {
        return prev.map((w) => (w.dayOfWeek === day ? { ...w, active: true } : w));
      }
      return [
        ...without,
        { dayOfWeek: day, startTime: "09:00", endTime: "17:00", active: true },
      ];
    });
  }

  function updateWindow(day: number, index: number, patch: Partial<DiaryDayWindow>) {
    setWindows((prev) => {
      const dayWins = prev.filter((w) => w.dayOfWeek === day);
      const others = prev.filter((w) => w.dayOfWeek !== day);
      const next = dayWins.map((w, i) => (i === index ? { ...w, ...patch } : w));
      return [...others, ...next];
    });
  }

  function addPeriod(day: number) {
    setWindows((prev) => [
      ...prev,
      { dayOfWeek: day, startTime: "14:00", endTime: "18:00", active: true },
    ]);
  }

  function removePeriod(day: number, index: number) {
    setWindows((prev) => {
      const dayWins = prev.filter((w) => w.dayOfWeek === day);
      const others = prev.filter((w) => w.dayOfWeek !== day);
      return [...others, ...dayWins.filter((_, i) => i !== index)];
    });
  }

  function addException() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newExceptionDate)) {
      toast.error("Pick a date first");
      return;
    }
    if (exceptions.some((e) => e.exceptionDate === newExceptionDate)) {
      toast.error("That date is already listed");
      return;
    }
    setExceptions((prev) => [
      ...prev,
      { exceptionDate: newExceptionDate, unavailable: true, note: null },
    ]);
    setNewExceptionDate("");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-semibold">
          <CalendarDays className="w-4 h-4" />
          Diary settings
        </div>
        <p className="text-sm text-muted-foreground">
          Set when Mortgage Hub may offer appointments. Outlook remains the source of truth for
          existing meetings — Hub only offers slots inside these windows that are free in Outlook.
        </p>
      </div>

      {allowAdvisorFilter && !viewAsAdvisorId && (
        <div className="space-y-1 max-w-md">
          <Label className="text-xs">Advisor</Label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={advisorId}
            onChange={(e) => setAdvisorId(e.target.value)}
          >
            <option value="">Your diary / select advisor…</option>
            {(advisorsQ.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name || a.email || a.id}
              </option>
            ))}
          </select>
        </div>
      )}

      {settingsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading diary settings…</p>
      ) : settingsQ.isError ? (
        <p className="text-sm text-destructive">
          {settingsQ.error instanceof Error ? settingsQ.error.message : "Could not load settings"}
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Appointment length (minutes)</Label>
              <Input
                type="number"
                min={15}
                max={240}
                step={15}
                value={slotMinutes}
                onChange={(e) => setSlotMinutes(Number(e.target.value) || 90)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Buffer between appointments (minutes)</Label>
              <Input
                type="number"
                min={0}
                max={180}
                step={5}
                value={bufferMinutes}
                onChange={(e) => setBufferMinutes(Number(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Minimum notice (minutes)</Label>
              <Input
                type="number"
                min={0}
                max={10080}
                step={15}
                value={minNoticeMinutes}
                onChange={(e) => setMinNoticeMinutes(Number(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Book ahead (days)</Label>
              <Input
                type="number"
                min={1}
                max={180}
                value={maxHorizonDays}
                onChange={(e) => setMaxHorizonDays(Number(e.target.value) || 28)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Weekly availability</h3>
            <div className="space-y-3">
              {DAY_LABELS.map((label, day) => {
                const dayWins = windowsByDay.get(day) ?? [];
                const available = dayWins.some((w) => w.active !== false);
                return (
                  <div key={day} className="rounded-lg border p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm font-medium min-w-[4.5rem]">
                        <input
                          type="checkbox"
                          checked={available}
                          onChange={(e) => setDayAvailable(day, e.target.checked)}
                        />
                        {label}
                      </label>
                      {!available && (
                        <span className="text-xs text-muted-foreground">Unavailable</span>
                      )}
                      {available && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => addPeriod(day)}
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          Add period
                        </Button>
                      )}
                    </div>
                    {available &&
                      dayWins.map((w, i) => (
                        <div key={`${day}-${i}`} className="flex flex-wrap items-center gap-2 pl-6">
                          <Input
                            type="time"
                            className="w-[8.5rem] h-8"
                            value={w.startTime}
                            onChange={(e) => updateWindow(day, i, { startTime: e.target.value })}
                          />
                          <span className="text-xs text-muted-foreground">to</span>
                          <Input
                            type="time"
                            className="w-[8.5rem] h-8"
                            value={w.endTime}
                            onChange={(e) => updateWindow(day, i, { endTime: e.target.value })}
                          />
                          {dayWins.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-muted-foreground"
                              onClick={() => removePeriod(day, i)}
                              aria-label="Remove period"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Temporary unavailable dates</h3>
            <p className="text-xs text-muted-foreground">
              Block specific dates (holidays, leave) without changing the weekly pattern.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  className="h-9"
                  value={newExceptionDate}
                  onChange={(e) => setNewExceptionDate(e.target.value)}
                />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addException}>
                Add date
              </Button>
            </div>
            {exceptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No blocked dates.</p>
            ) : (
              <ul className="space-y-1">
                {exceptions.map((e) => (
                  <li
                    key={e.exceptionDate}
                    className="flex items-center justify-between gap-2 text-sm rounded-md border px-3 py-1.5"
                  >
                    <span>{e.exceptionDate}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() =>
                        setExceptions((prev) => prev.filter((x) => x.exceptionDate !== e.exceptionDate))
                      }
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save diary settings"}
          </Button>
        </>
      )}
    </div>
  );
}
