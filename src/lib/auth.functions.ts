import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isTwilioConfigured, normaliseUkPhone, sendSms } from "@/lib/sms.server";
import { storeLoginSmsCode, verifyLoginSmsCode } from "@/lib/auth-sms.store.server";

function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  return digits.length >= 4 ? `***${digits.slice(-4)}` : "***";
}

function randomSixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export const sendLoginSmsCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ phone: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!isTwilioConfigured()) {
      throw new Error(
        "SMS sign-in is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env.",
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("id", context.userId)
      .maybeSingle();
    if (profileErr) throw new Error(profileErr.message);

    const rawPhone = data.phone?.trim() || profile?.phone?.trim();
    if (!rawPhone) {
      throw new Error("Add your mobile number so we can text you a sign-in code.");
    }

    const e164 = normaliseUkPhone(rawPhone);
    if (data.phone?.trim()) {
      const { error: updateErr } = await supabaseAdmin
        .from("profiles")
        .update({ phone: e164 })
        .eq("id", context.userId);
      if (updateErr) throw new Error(updateErr.message);
    }

    const code = randomSixDigitCode();
    storeLoginSmsCode(context.userId, code);
    await sendSms({
      to: e164,
      body: `Your Mortgage Hub sign-in code is ${code}. It expires in 10 minutes.`,
    });

    return { sentTo: maskPhone(e164) };
  });

export const verifyLoginSmsCodeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string().length(6) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!verifyLoginSmsCode(context.userId, data.code)) {
      throw new Error("That code is invalid or expired. Request a new one.");
    }
    return { ok: true as const };
  });
