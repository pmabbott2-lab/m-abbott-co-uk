// Server-only: download Twilio recording → OpenAI transcript → summary.

import { chatCompletion } from "@/lib/ai-gateway.server";
import { getTwilioConfig } from "@/lib/sms.server";
import { transcribeAudio } from "@/lib/openai.server";

export async function downloadTwilioRecording(recordingUrl: string, recordingSid?: string): Promise<Blob> {
  const { accountSid, authToken } = getTwilioConfig();
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const candidates = [
    recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`,
    recordingSid
      ? `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`
      : null,
    recordingSid
      ? `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3?RequestedChannels=dual`
      : null,
  ].filter(Boolean) as string[];

  for (const url of candidates) {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (res.ok) return res.blob();
  }
  throw new Error(`Failed to download recording (${candidates.length} URLs tried)`);
}

export async function transcribeCallRecording(recordingUrl: string, recordingSid?: string): Promise<string> {
  const blob = await downloadTwilioRecording(recordingUrl, recordingSid);
  const file = new File([blob], "call-recording.mp3", { type: "audio/mpeg" });
  return transcribeAudio(file);
}

export async function summarizeCallTranscript(transcript: string): Promise<string> {
  const trimmed = transcript.trim();
  if (!trimmed) return "No speech detected on this call.";

  return chatCompletion({
    messages: [
      {
        role: "system",
        content:
          "You summarise UK mortgage adviser phone calls for the adviser's file. " +
          "Write 3–6 short bullet points covering: purpose of call, key facts discussed, " +
          "agreed next steps, and any follow-up needed. British English. No invented details.",
      },
      { role: "user", content: `Call transcript:\n\n${trimmed}` },
    ],
    temperature: 0.2,
  });
}

export async function processCallRecording(opts: {
  recordingUrl: string;
  recordingSid?: string;
}): Promise<{ transcript: string; summary: string }> {
  const transcript = await transcribeCallRecording(opts.recordingUrl, opts.recordingSid);
  const summary = await summarizeCallTranscript(transcript);
  return { transcript, summary };
}
