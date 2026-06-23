import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listMySessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("interview_sessions")
      .select("*")
      .order("started_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("interview_sessions")
      .insert({ customer_id: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  });

export const getSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: session, error } = await context.supabase
      .from("interview_sessions")
      .select("*")
      .eq("id", data.sessionId)
      .single();
    if (error) throw new Error(error.message);
    const { data: messages } = await context.supabase
      .from("interview_messages")
      .select("*")
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: true });
    const { data: answers } = await context.supabase
      .from("interview_answers")
      .select("*")
      .eq("session_id", data.sessionId);
    return { session, messages: messages ?? [], answers: answers ?? [] };
  });

export const submitSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("interview_sessions")
      .update({ status: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", data.sessionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setSessionPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      sessionId: z.string().uuid(),
      section: z.enum(["personal", "employment", "outgoings", "property"]),
      index: z.number().int().min(0),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("interview_sessions")
      .update({
        current_section: data.section,
        current_question_index: data.index,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.sessionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      sessionId: z.string().uuid(),
      section: z.string(),
      fieldKey: z.string(),
      fieldLabel: z.string(),
      value: z.string(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("interview_answers").upsert(
      {
        session_id: data.sessionId,
        section: data.section,
        field_key: data.fieldKey,
        field_label: data.fieldLabel,
        value: data.value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id,section,field_key" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (data ?? []).map((r) => r.role);
    return { isAdvisor: roles.includes("advisor"), roles };
  });

export const listAllSessionsForAdvisor = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roleRows } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(roleRows ?? []).some((r) => r.role === "advisor")) {
      throw new Error("Forbidden");
    }
    const { data: sessions, error } = await context.supabase
      .from("interview_sessions")
      .select("*")
      .order("started_at", { ascending: false });
    if (error) throw new Error(error.message);
    const customerIds = Array.from(new Set((sessions ?? []).map((s) => s.customer_id)));
    let profiles: Array<{ id: string; full_name: string | null; email: string | null }> = [];
    if (customerIds.length > 0) {
      const { data: p } = await context.supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", customerIds);
      profiles = p ?? [];
    }
    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    return (sessions ?? []).map((s) => ({
      ...s,
      customer: profileMap.get(s.customer_id) ?? null,
    }));
  });

export const addAdvisorNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid(), note: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("advisor_notes")
      .insert({ session_id: data.sessionId, advisor_id: context.userId, note: data.note });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: notes, error } = await context.supabase
      .from("advisor_notes")
      .select("*")
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return notes ?? [];
  });
