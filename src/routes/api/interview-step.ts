import { createFileRoute } from "@tanstack/react-router";
import { chatCompletion } from "@/lib/ai-gateway.server";
import { getQuestion, nextStep, findSection, type Section } from "@/lib/interview-script";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

interface Body {
  sessionId: string;
  transcript: string;
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

        // Save customer transcript (if not empty — first call sends empty transcript to get first question)
        if (body.transcript.trim() && currentQ) {
          await supabase.from("interview_messages").insert({
            session_id: body.sessionId,
            role: "customer",
            text: body.transcript,
            section,
          });

          // Use AI to extract a clean structured value
          const extractionPrompt = `You are extracting a structured answer from a customer's spoken reply in a mortgage fact-find.

Field: ${currentQ.label}
Question asked: "${currentQ.prompt}"
Customer's reply (verbatim transcription, may have filler words): "${body.transcript}"

Return ONLY a JSON object: {"value": "<concise cleaned answer>", "confident": true|false}.
If the reply doesn't actually answer the question, set confident to false and value to the raw reply.`;
          let value = body.transcript.trim();
          try {
            const out = await chatCompletion({
              messages: [
                { role: "system", content: "You extract clean answers from interview transcripts. Reply with only valid JSON." },
                { role: "user", content: extractionPrompt },
              ],
              response_format: { type: "json_object" },
              temperature: 0,
            });
            const parsed = JSON.parse(out) as { value?: string };
            if (parsed.value) value = parsed.value;
          } catch (e) {
            console.error("extraction failed", e);
          }

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

        // Determine next question
        const isFirst = !body.transcript.trim() && index === 0 && section === "personal";
        const step = isFirst ? { section, index } : nextStep(section, index);

        if (!step) {
          await supabase
            .from("interview_sessions")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", body.sessionId);
          return Response.json({ done: true });
        }

        const nextQ = getQuestion(step.section, step.index)!;
        const sec = findSection(step.section)!;
        // Intro line if changing section
        const intro = !isFirst && (step.section !== section || step.index === 0) && step.index === 0 ? sec.intro + " " : "";
        const sayText = (isFirst ? "Hi! I'll guide you through a quick fact-find for your mortgage application. " + sec.intro + " " : intro) + nextQ.prompt;

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
            updated_at: new Date().toISOString(),
          })
          .eq("id", body.sessionId);

        return Response.json({
          done: false,
          section: step.section,
          sectionTitle: sec.title,
          questionIndex: step.index,
          questionsInSection: sec.questions.length,
          fieldKey: nextQ.key,
          fieldLabel: nextQ.label,
          sayText,
        });
      },
    },
  },
});
