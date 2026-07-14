/**
 * One-shot: sync a local appointment to the assigned advisor's Teams calendar.
 * Usage: npx tsx scripts/resync-appointment-teams.ts <appointmentId>
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnv();

const appointmentId = process.argv[2];
if (!appointmentId) {
  console.error("Usage: npx tsx scripts/resync-appointment-teams.ts <appointmentId>");
  process.exit(1);
}

async function main() {
  const { supabaseAdmin } = await import("../src/integrations/supabase/client.server");
  const { syncAppointmentToTeams } = await import("../src/lib/teams-calendar.server");

  const { data: appt, error } = await supabaseAdmin
    .from("appointments")
    .select("*")
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!appt) throw new Error("Appointment not found");

  const result = await syncAppointmentToTeams({
    appointmentId: appt.id,
    advisorId: appt.advisor_id,
    customerName: appt.customer_name,
    customerEmail: appt.customer_email ?? null,
    customerPhone: appt.customer_phone,
    startsAt: appt.starts_at,
    endsAt: appt.ends_at,
    notes: appt.notes ?? null,
    existingEventId: appt.ms_event_id ?? null,
  });

  console.log(JSON.stringify({ appointmentId: appt.id, advisorId: appt.advisor_id, result }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
