import { createFileRoute } from "@tanstack/react-router";
import { chatCompletion } from "@/lib/ai-gateway.server";
import { getQuestion, nextStep, findSection, SECTIONS, type Section, type AnswersMap } from "@/lib/interview-script";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

interface Body {
  sessionId: string;
  transcript: string;
  skipEvaluation?: boolean;
}

const ACKS = [
  "Thank you", "Thanks for that", "That's great", "Brilliant", "Perfect",
  "Got it", "Wonderful", "Excellent", "Cheers", "Appreciate that",
  "Okay, noted", "Right, thanks", "Understood", "Smashing", "Fantastic",
  "Noted, thanks", "Lovely", "Great",
];
function pickAck(): string {
  return ACKS[Math.floor(Math.random() * ACKS.length)];
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseSmallNumber(text?: string | null): number | null {
  const value = (text ?? "").toLowerCase();
  const digit = value.match(/\b([1-9]|10)\b/);
  if (digit) return Number(digit[1]);
  for (const [word, n] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(value)) return n;
  }
  return null;
}

function isFinishedChildren(text: string): boolean {
  return /\b(that'?s\s+(it|all|everyone)|all\s+done|no\s+more|finished)\b/i.test(text);
}

function countChildDetails(text: string): number {
  const parts = text
    .split(/\s*;\s*|\s*\n\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const ageMatches = text.match(/\b(?:[1-9]|1[0-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/gi);
  return Math.max(parts.length, ageMatches?.length ?? 0);
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
        const currentQ = getQuestion(section, index);

        // Save customer transcript (first call sends empty transcript to get first question)
        let cleanedValue: string | null = null;
        let acknowledgement = "";
        let followupPrompt = "";
        let stayOnSameQuestion = false;
        let nextFollowupCount = 0;

        if (body.transcript.trim() && currentQ) {
          await supabase.from("interview_messages").insert({
            session_id: body.sessionId,
            role: "customer",
            text: body.transcript,
            section,
          });

          const rawValue = body.transcript.trim().replace(/\s+/g, " ");

          if (currentQ.key === "dependants_details") {
            // Deterministic loop for children: accumulate until expected count or "that's it".
            const { data: existingDetail } = await supabase
              .from("interview_answers")
              .select("value")
              .eq("session_id", body.sessionId)
              .eq("section", section)
              .eq("field_key", currentQ.key)
              .maybeSingle();
            const newDetail = rawValue
              .replace(/\b(that'?s\s+(it|all|everyone)|all\s+done|no\s+more|finished)\b/gi, "")
              .replace(/^[\s,.;-]+|[\s,.;-]+$/g, "")
              .trim();
            cleanedValue = [existingDetail?.value ?? "", newDetail].filter(Boolean).join("; ") || existingDetail?.value || rawValue;
            acknowledgement = pickAck();
          } else if (currentQ.expects && !body.skipEvaluation) {
            // AI-driven evaluation: ask follow-ups when the answer is incomplete.
            const { evaluateAnswer } = await import("@/lib/interview-evaluator.server");
            const { data: existing } = await supabase
              .from("interview_answers")
              .select("value")
              .eq("session_id", body.sessionId)
              .eq("section", section)
              .eq("field_key", currentQ.key)
              .maybeSingle();
            const priorAnswer = existing?.value ?? "";
            const currentFollowupCount = session.followup_count ?? 0;
            // Derive first name from any prior full_name answer for personalised follow-ups.
            const { data: nameRow } = await supabase
              .from("interview_answers")
              .select("value")
              .eq("session_id", body.sessionId)
              .eq("section", "personal")
              .eq("field_key", "full_name")
              .maybeSingle();
            const firstName = ((nameRow?.value ?? "").trim().split(/\s+/)[0] ?? "").replace(/[^\p{L}'-]/gu, "");
            const result = await evaluateAnswer({
              fieldKey: currentQ.key,
              fieldLabel: currentQ.label,
              expects: currentQ.expects,
              prompt: currentQ.prompt,
              transcript: rawValue,
              priorAnswer,
              followupCount: currentFollowupCount,
              firstName: firstName || undefined,
            });
            cleanedValue = result.cleanedValue || rawValue;
            acknowledgement = result.acknowledgement || pickAck();
            if (!result.complete) {
              stayOnSameQuestion = true;
              followupPrompt = result.followup || `Sorry ${firstName || ""}, could you tell me a bit more so I can capture: ${currentQ.expects}`.trim();
              nextFollowupCount = currentFollowupCount + 1;
            }
          } else {
            cleanedValue = rawValue;
            acknowledgement = pickAck();
          }

          const { error: answerErr } = await supabase.from("interview_answers").upsert(
            {
              session_id: body.sessionId,
              section,
              field_key: currentQ.key,
              field_label: currentQ.label,
              value: cleanedValue,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "session_id,section,field_key" },
          );
          if (answerErr) {
            console.error("answer save failed", answerErr);
            return new Response("Could not save answer", { status: 500 });
          }
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
        if (currentQ && cleanedValue !== null) {
          answersMap[`${section}:${currentQ.key}`] = cleanedValue;
        }

        // Determine next question (advance), or stay for AI follow-up / dependants loop
        const isFirst = !body.transcript.trim() && index === 0 && section === "personal";
        let step = isFirst ? { section, index } : nextStep(section, index, answersMap);

        if (stayOnSameQuestion) {
          step = { section, index };
          acknowledgement = "";
        }

        if (body.transcript.trim() && currentQ?.key === "dependants_details" && !isFinishedChildren(body.transcript)) {
          const expectedChildren = parseSmallNumber(answersMap["personal:dependants_count"]);
          const detailsSoFar = answersMap["personal:dependants_details"] ?? cleanedValue ?? "";
          const capturedChildren = countChildDetails(detailsSoFar);
          if (!expectedChildren || capturedChildren < expectedChildren) {
            step = { section, index };
            acknowledgement = "";
            followupPrompt = expectedChildren
              ? `Thank you — I've got ${capturedChildren || "that"} of ${expectedChildren}. Please tell me the next child's name and age, or say "that's it" if there aren't any more.`
              : "Thank you — please tell me the next child's name and age, or say \"that's it\" if there aren't any more.";
          }
        }


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

        // Personalise prompts using the customer's first name once we have it.
        const fullName = answersMap["personal:full_name"] ?? "";
        const firstName = (fullName.trim().split(/\s+/)[0] ?? "").replace(/[^\p{L}'-]/gu, "");
        const personalise = (text: string) =>
          firstName ? text.replace(/\{firstName\}/g, firstName) : text.replace(/,?\s*\{firstName\}/g, "");

        const intro = !isFirst && (step.section !== section || step.index === 0) && step.index === 0 ? sec.intro + " " : "";
        const ack = !isFirst && acknowledgement ? acknowledgement + ". " : "";
        const basePrompt = personalise(followupPrompt || (isFirst ? nextQ.prompt : ack + intro + nextQ.prompt));
        const sayText = basePrompt;

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
            followup_count: stayOnSameQuestion ? nextFollowupCount : 0,
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
          prompt: personalise(nextQ.prompt),
          sayText,
        });
      },
    },
  },
});
