import { createFileRoute } from "@tanstack/react-router";
import { chatCompletion } from "@/lib/ai-gateway.server";
import { getQuestion, nextStep, findSection, SECTIONS, type Section, type AnswersMap } from "@/lib/interview-script";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

interface Body {
  sessionId: string;
  transcript: string;
}

const ACKS = ["Thanks", "Got it", "Lovely", "Great", "Okay, noted", "Brilliant", "Perfect"];
function pickAck(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return ACKS[Math.abs(h) % ACKS.length];
}

export const Route = createFileRoute("/api/interview-step")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const token = authHeader.slice(7);
        const body = (await request.json()) as Body;
        if (!body.sessionId || typeof body.transcript !== "string") {
          return new Response("Bad request", { status: 400 });
        }

        const supabase = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
          },
        );

        const { data: session, error: sErr } = await supabase
          .from("interview_sessions")
          .select("*")
          .eq("id", body.sessionId)
          .single();
        if (sErr || !session) return new Response("Session not found", { status: 404 });

        const section = session.current_section as Section;
        const index = session.current_question_index;
        const followupCount = (session as { followup_count?: number }).followup_count ?? 0;
        const currentQ = getQuestion(section, index);

        // Save customer transcript (first call sends empty transcript to get first question)
        let cleanedValue: string | null = null;
        let needsFollowup = false;
        let followupQuestion = "";
        let acknowledgement = "";

        if (body.transcript.trim() && currentQ) {
          await supabase.from("interview_messages").insert({
            session_id: body.sessionId,
            role: "customer",
            text: body.transcript,
            section,
          });

          // Single AI call: extract clean answer + decide if follow-up needed + craft a natural acknowledgement
          const evalPrompt = `You are Susan, a warm UK mortgage interview guide, processing a customer's spoken reply.

Field: ${currentQ.label}
Question asked: "${currentQ.prompt}"
Customer's reply (verbatim, may have filler words): "${body.transcript}"
Follow-ups already asked on this question: ${followupCount} (max ${MAX_FOLLOWUPS})

Return ONLY a JSON object with these keys:
{
  "value": "<concise cleaned answer to store>",
  "complete": true | false,           // true if the reply clearly answers the question
  "followup": "<one short, friendly follow-up question if complete is false and follow-ups remain; else empty string>",
  "acknowledgement": "<a short, natural one-line reaction like 'Thanks', 'Lovely', 'Great', 'Okay, noted'. Vary it. No more than 6 words. Do NOT repeat the answer back.>"
}

Rules:
- If the reply is vague, contradictory, or skips the question, set complete=false and provide a follow-up.
- If ${followupCount} >= ${MAX_FOLLOWUPS}, set complete=true and followup="" (move on regardless).
- Keep acknowledgement warm but brief.`;

          let value = body.transcript.trim();
          try {
            const out = await chatCompletion({
              messages: [
                { role: "system", content: "You process interview replies. Reply with only valid JSON." },
                { role: "user", content: evalPrompt },
              ],
              response_format: { type: "json_object" },
              temperature: 0.4,
            });
            const parsed = JSON.parse(out) as {
              value?: string;
              complete?: boolean;
              followup?: string;
              acknowledgement?: string;
            };
            if (parsed.value) value = parsed.value;
            acknowledgement = (parsed.acknowledgement ?? "").trim();
            if (parsed.complete === false && followupCount < MAX_FOLLOWUPS && parsed.followup?.trim()) {
              needsFollowup = true;
              followupQuestion = parsed.followup.trim();
            }
          } catch (e) {
            console.error("evaluation failed", e);
          }

          cleanedValue = value;
          await supabase.from("interview_answers").upsert(
            {
              session_id: body.sessionId,
              section,
              field_key: currentQ.key,
              field_label: currentQ.label,
              value,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "session_id,section,field_key" },
          );
        }

        // If a follow-up is needed, stay on the same question
        if (needsFollowup && currentQ) {
          const ack = acknowledgement ? acknowledgement + ". " : "";
          const sayText = ack + followupQuestion;
          await supabase.from("interview_messages").insert({
            session_id: body.sessionId,
            role: "avatar",
            text: sayText,
            section,
          });
          await supabase
            .from("interview_sessions")
            .update({
              followup_count: followupCount + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", body.sessionId);

          const sec = findSection(section)!;
          return Response.json({
            done: false,
            section,
            sectionTitle: sec.title,
            questionIndex: index,
            questionsInSection: sec.questions.length,
            fieldKey: currentQ.key,
            fieldLabel: currentQ.label,
            prompt: followupQuestion,
            sayText,
          });
        }

        // Build current answers map (including the value we just saved) so skip logic is up-to-date
        const { data: answerRows } = await supabase
          .from("interview_answers")
          .select("section, field_key, value")
          .eq("session_id", body.sessionId);
        const answersMap: AnswersMap = {};
        (answerRows ?? []).forEach((a) => {
          answersMap[`${a.section}:${a.field_key}`] = a.value ?? "";
        });

        // Determine next question (advance)
        const isFirst = !body.transcript.trim() && index === 0 && section === "personal";
        const step = isFirst ? { section, index } : nextStep(section, index, answersMap);

        if (!step) {
          // Interview complete — generate a written summary for the advisor
          const { data: allAnswers } = await supabase
            .from("interview_answers")
            .select("section, field_label, value")
            .eq("session_id", body.sessionId);

          const grouped: Record<string, string[]> = {};
          (allAnswers ?? []).forEach((a) => {
            const sec = findSection(a.section as Section)?.title ?? a.section;
            grouped[sec] = grouped[sec] ?? [];
            grouped[sec].push(`- ${a.field_label}: ${a.value}`);
          });
          const factsText = Object.entries(grouped)
            .map(([s, lines]) => `## ${s}\n${lines.join("\n")}`)
            .join("\n\n");

          let summary = "";
          try {
            summary = await chatCompletion({
              messages: [
                {
                  role: "system",
                  content:
                    "You are a UK mortgage advisor's assistant. Write a concise, professional client summary in plain English suitable for the advisor's file. Use short paragraphs grouped by Personal, Employment & income, Outgoings & credit, and Property & mortgage need. Do not invent details — use only what the customer provided. End with a one-line 'Recommended next step' if obvious.",
                },
                { role: "user", content: `Customer fact-find answers:\n\n${factsText}` },
              ],
              temperature: 0.2,
            });
          } catch (e) {
            console.error("summary failed", e);
          }

          await supabase
            .from("interview_sessions")
            .update({
              summary: summary || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", body.sessionId);
          return Response.json({ done: true, summary });
        }

        const nextQ = getQuestion(step.section, step.index)!;
        const sec = findSection(step.section)!;
        const intro = !isFirst && (step.section !== section || step.index === 0) && step.index === 0 ? sec.intro + " " : "";
        const ack = !isFirst && acknowledgement ? acknowledgement + ". " : "";
        const sayText = (isFirst
          ? "Hi, I'm Susan. I'll guide you through a quick fact-find for your mortgage application. " + sec.intro + " "
          : ack + intro) + nextQ.prompt;

        await supabase.from("interview_messages").insert({
          session_id: body.sessionId,
          role: "avatar",
          text: sayText,
          section: step.section,
        });
        await supabase
          .from("interview_sessions")
          .update({
            current_section: step.section,
            current_question_index: step.index,
            followup_count: 0,
            updated_at: new Date().toISOString(),
          })
          .eq("id", body.sessionId);

        // touch unused imports to satisfy bundler-tree-shaking checks
        void SECTIONS;
        void cleanedValue;

        return Response.json({
          done: false,
          section: step.section,
          sectionTitle: sec.title,
          questionIndex: step.index,
          questionsInSection: sec.questions.length,
          fieldKey: nextQ.key,
          fieldLabel: nextQ.label,
          prompt: nextQ.prompt,
          sayText,
        });
      },
    },
  },
});
