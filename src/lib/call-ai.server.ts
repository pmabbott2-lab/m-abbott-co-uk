// Server-only: download Twilio recording → OpenAI transcript → summary.

import { chatCompletion } from "@/lib/ai-gateway.server";
import { getTwilioConfig } from "@/lib/sms.server";
import { transcribeAudio } from "@/lib/openai.server";

export async function downloadTwilioRecording(recordingUrl: string): Promise<Blob> {
  const { accountSid, authToken } = getTwilioConfig();
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const url = recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) {
    throw new Error(`Failed to download recording (${res.status})`);
  }
  return res.blob();
}

export async function transcribeCallRecording(recordingUrl: string): Promise<string> {
  const blob = await downloadTwilioRecording(recordingUrl);
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
  const transcript = await transcribeCallRecording(opts.recordingUrl);
  const summary = await summarizeCallTranscript(transcript);
  return { transcript, summary };
}
