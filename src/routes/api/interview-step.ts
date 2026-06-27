import { createFileRoute } from "@tanstack/react-router";
import { chatCompletion } from "@/lib/ai-gateway.server";
import { extractStructuredFields, parseMoneyFromText, computeLoanAmount, formatGBP } from "@/lib/structured-answers";
import { resolveAddress, isLikelyPostcode } from "@/lib/address-lookup.server";
import { ageFromText } from "@/lib/dob-parse";
import { getQuestion, nextStep, findSection, SECTIONS, ACKNOWLEDGEMENTS, ackClip, firstGreeting, firstNameFromFullName, type Section, type AnswersMap } from "@/lib/interview-script";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

interface Body {
  sessionId: string;
  transcript: string;
}

function pickAck(): string {
  return ACKNOWLEDGEMENTS[Math.floor(Math.random() * ACKNOWLEDGEMENTS.length)];
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

        // First name comes from the login profile, so Susan can be personal from
        // the very first question (we no longer ask the customer their name).
        let profileFirstName = "";
        if (session.customer_id) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", session.customer_id)
            .single();
          profileFirstName = firstNameFromFullName(prof?.full_name);
        }

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
          const { data: priorRows } = await supabase
            .from("interview_answers")
            .select("section, field_key, value")
            .eq("session_id", body.sessionId);
          const priorMap: AnswersMap = {};
          (priorRows ?? []).forEach((a) => {
            priorMap[`${a.section}:${a.field_key}`] = a.value ?? "";
          });
          const firstName = profileFirstName;

          if (currentQ.key === "dependants_details") {
            const existingDetail = priorMap[`${section}:${currentQ.key}`];
            const newDetail = rawValue
              .replace(/\b(that'?s\s+(it|all|everyone)|all\s+done|no\s+more|finished)\b/gi, "")
              .replace(/^[\s,.;-]+|[\s,.;-]+$/g, "")
              .trim();
            cleanedValue = [existingDetail ?? "", newDetail].filter(Boolean).join("; ") || existingDetail || rawValue;
            acknowledgement = pickAck();
          } else if (currentQ.expects) {
            const { evaluateAnswer } = await import("@/lib/interview-evaluator.server");
            const priorAnswer = priorMap[`${section}:${currentQ.key}`] ?? "";
            const currentFollowupCount = session.followup_count ?? 0;
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
              structured_value: extractStructuredFields(currentQ.key, cleanedValue ?? ""),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "session_id,section,field_key" },
          );
          if (answerErr) {
            console.error("answer save failed", answerErr);
            return new Response("Could not save answer", { status: 500 });
          }

          const saveAddress = async (formatted: string, structured: Record<string, unknown>) => {
            await supabase.from("interview_answers").upsert(
              {
                session_id: body.sessionId,
                section,
                field_key: "home_address",
                field_label: "Address",
                value: formatted,
                structured_value: structured as never,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "session_id,section,field_key" },
            );
          };

          // After the house number/name, look up and store the full address.
          if (currentQ.key === "home_house") {
            const pc = priorMap["personal:home_postcode"] ?? "";
            try {
              const resolved = await resolveAddress(pc, rawValue);
              await saveAddress(resolved.formatted, {
                address: resolved.formatted,
                postcode: resolved.postcode,
                provider: resolved.provider,
              });
            } catch (e) {
              console.error("address lookup failed", e);
              await saveAddress([rawValue, pc].filter(Boolean).join(", "), { address: rawValue });
            }
          }

          // Handle the address confirmation step.
          if (currentQ.key === "home_confirm") {
            const s = rawValue.toLowerCase();
            const affirmative = /\b(yes|yeah|yep|yup|correct|that'?s right|right|confirm|confirmed|spot on|perfect|exactly|good)\b/.test(s);
            const negativeOnly =
              /\b(no|nope|not right|wrong|incorrect|that'?s not)\b/.test(s) &&
              rawValue.trim().split(/\s+/).length <= 5 &&
              !isLikelyPostcode(rawValue);
            const alreadyRetried = (session.followup_count ?? 0) >= 1;
            if (!affirmative && negativeOnly && !alreadyRetried) {
              stayOnSameQuestion = true;
              followupPrompt = "No problem — please say your full address, including the street, town and postcode.";
              nextFollowupCount = (session.followup_count ?? 0) + 1;
            } else if (!affirmative) {
              await saveAddress(rawValue, { address: rawValue });
            }
          }

          // If they correct the balance at the equity step, update amount owed.
          if (currentQ.key === "equity_confirm") {
            const corrected = parseMoneyFromText(rawValue);
            if (corrected != null) {
              await supabase.from("interview_answers").upsert(
                {
                  session_id: body.sessionId,
                  section,
                  field_key: "amount_owed",
                  field_label: "Mortgage balance owed",
                  value: rawValue,
                  structured_value: { amount_owed_gbp: corrected } as never,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "session_id,section,field_key" },
              );
            }
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
            .select("section, field_key, field_label, value")
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

          // Compute the customer's age deterministically from their DOB so the
          // model never has to (and never gets) the arithmetic wrong.
          const dobAnswer = (allAnswers ?? []).find((a) => a.field_key === "date_of_birth");
          const age = dobAnswer?.value ? ageFromText(dobAnswer.value) : null;
          const ageNote =
            age != null
              ? `\n\nThe customer's current age is ${age} (already calculated accurately from their date of birth). Use this exact figure; do not recalculate the age yourself.`
              : "";

          let summary = "";
          try {
            summary = await chatCompletion({
              messages: [
                {
                  role: "system",
                  content:
                    "You are a UK mortgage advisor's assistant. Write a concise, professional client summary in plain English suitable for the advisor's file. Use short paragraphs grouped by Personal, Employment & income, Outgoings & credit, and Property & mortgage need. Do not invent details — use only what the customer provided. If an age is supplied, use it verbatim and never compute ages yourself. End with a one-line 'Recommended next step' if obvious.",
                },
                { role: "user", content: `Customer fact-find answers:\n\n${factsText}${ageNote}` },
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

        // Personalise prompts using the first name from the login profile.
        const firstName = profileFirstName;
        const personalise = (text: string) =>
          firstName ? text.replace(/\{firstName\}/g, firstName) : text.replace(/,?\s*\{firstName\}/g, "");

        const intro = !isFirst && (step.section !== section || step.index === 0) && step.index === 0 ? sec.intro + " " : "";
        // The acknowledgement is spoken separately (pre-cached on the client for
        // an instant reply), so it is no longer prepended to the question text.
        const ackText = !isFirst && acknowledgement ? ackClip(acknowledgement) : "";

        // Present the looked-up address for confirmation.
        let confirmPrompt = "";
        if (nextQ.key === "home_confirm") {
          const addr = answersMap["personal:home_address"] ?? "";
          confirmPrompt = addr
            ? `I've got your address as ${addr}. If that's right, just say yes — otherwise, tell me the correct address.`
            : "Could you tell me your full address, including the street, town and postcode?";
        }

        // Remortgage: confirm the equity (value − balance owed) instead of a deposit.
        if (nextQ.key === "equity_confirm") {
          const price = parseMoneyFromText(answersMap["property:property_price"] ?? "");
          const owed = parseMoneyFromText(answersMap["property:amount_owed"] ?? "");
          if (price != null && owed != null) {
            const equity = Math.max(0, price - owed);
            confirmPrompt = `That leaves about ${formatGBP(equity)} of equity in the property. Does that sound right? If not, just tell me the correct balance.`;
          } else {
            confirmPrompt = "Roughly how much equity do you think you have in the property?";
          }
        }

        // Once we know the price and deposit, tell them what they're borrowing.
        let borrowNote = "";
        if (currentQ?.key === "deposit") {
          const price = parseMoneyFromText(answersMap["property:property_price"] ?? "");
          const depGbp = parseMoneyFromText(answersMap["property:deposit"] ?? "");
          const pctMatch = (answersMap["property:deposit"] ?? "").match(/(\d{1,2}(?:\.\d+)?)\s*(?:%|percent|per\s+cent)/i);
          const depPct = pctMatch ? parseFloat(pctMatch[1]) : null;
          const loan = computeLoanAmount(price, depGbp, depPct);
          if (loan != null) borrowNote = `So you're looking to borrow about ${formatGBP(loan)}. `;
        }

        const sayText = personalise(
          followupPrompt ||
            confirmPrompt ||
            (isFirst ? firstGreeting(firstName, nextQ.prompt) : intro + borrowNote + nextQ.prompt),
        );
        // The ack is only spoken when advancing to a new question, not on follow-ups.
        const ack = stayOnSameQuestion ? "" : ackText;

        await supabase.from("interview_messages").insert({
          session_id: body.sessionId,
          role: "avatar",
          text: [ack, sayText].filter(Boolean).join(" "),
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
          ack,
          sayText,
        });
      },
    },
  },
});
