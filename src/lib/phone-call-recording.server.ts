// Server-only: persist Twilio call recordings → transcript + summary (inbound + outbound).

import { processCallRecording } from "@/lib/call-ai.server";
import { getTwilioConfig } from "@/lib/sms.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidCallId(callId: string | null | undefined): callId is string {
  return Boolean(callId && callId !== "unknown" && UUID_RE.test(callId));
}

export async function findPhoneCallId(opts: {
  callId?: string | null;
  callSid?: string | null;
  recordingSid?: string | null;
}): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (isValidCallId(opts.callId)) {
    const { data } = await supabaseAdmin.from("phone_calls").select("id").eq("id", opts.callId).maybeSingle();
    if (data?.id) return data.id;
  }

  if (opts.callSid) {
    const { data } = await supabaseAdmin
      .from("phone_calls")
      .select("id")
      .eq("twilio_call_sid", opts.callSid)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  if (opts.recordingSid) {
    const { data } = await supabaseAdmin
      .from("phone_calls")
      .select("id")
      .eq("twilio_recording_sid", opts.recordingSid)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  return null;
}

async function twilioGet(path: string) {
  const { accountSid, authToken } = getTwilioConfig();
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}${path}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`Twilio GET ${path} failed (${res.status})`);
  return res.json() as Promise<{ recordings?: Array<{ sid: string; status: string; uri: string }> }>;
}

/** Fetch completed recordings for a Twilio call leg and process the first unprocessed one. */
export async function syncRecordingFromTwilioCall(
  callSid: string,
  callIdHint?: string | null,
): Promise<boolean> {
  if (!callSid) return false;

  const callId =
    (await findPhoneCallId({ callId: callIdHint, callSid })) ??
    (isValidCallId(callIdHint) ? callIdHint : null);
  if (!callId) return false;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row } = await supabaseAdmin
    .from("phone_calls")
    .select("id, ai_status, recording_url")
    .eq("id", callId)
    .maybeSingle();
  if (!row) return false;
  if (row.ai_status === "complete" && row.recording_url) return true;

  const list = await twilioGet(`/Calls/${callSid}/Recordings.json`);
  const recording = (list.recordings ?? []).find((r) => r.status === "completed") ?? list.recordings?.[0];
  if (!recording?.sid) return false;

  const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${getTwilioConfig().accountSid}/Recordings/${recording.sid}`;
  await processPhoneCallRecording(callId, recordingUrl, recording.sid);
  return true;
}

export async function processPhoneCallRecording(
  callId: string,
  recordingUrl: string,
  recordingSid?: string,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: existing } = await supabaseAdmin
    .from("phone_calls")
    .select("ai_status")
    .eq("id", callId)
    .maybeSingle();
  if (existing?.ai_status === "complete") return;

  await supabaseAdmin
    .from("phone_calls")
    .update({
      ai_status: "processing",
      recording_url: recordingUrl,
      twilio_recording_sid: recordingSid ?? null,
    })
    .eq("id", callId);

  try {
    const { transcript, summary } = await processCallRecording({ recordingUrl, recordingSid });
    await supabaseAdmin
      .from("phone_calls")
      .update({
        transcript,
        summary,
        ai_status: "complete",
        status: "completed",
        ended_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", callId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Processing failed";
    console.error(`[phone-call-recording] failed for ${callId}:`, msg);
    await supabaseAdmin
      .from("phone_calls")
      .update({ ai_status: "failed", error_message: msg })
      .eq("id", callId);
    throw e;
  }
}
