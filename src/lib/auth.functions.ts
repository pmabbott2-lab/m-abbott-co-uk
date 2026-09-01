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
        "SMS sign-in is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID in .env.",
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

/** After appointment signup without a password — verify SMS and return a magic-link token. */
export const verifyAppointmentSignupSms = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      phone: z.string().min(7),
      code: z.string().length(6),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const phone = normaliseUkPhone(data.phone);
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, email, phone")
      .eq("phone", phone)
      .maybeSingle();
    if (!profile?.id) {
      throw new Error("No account found for that mobile number.");
    }
    if (!verifyLoginSmsCode(profile.id, data.code)) {
      throw new Error("That code is invalid or expired. Request a new one.");
    }

    const { emailForCustomerAccount } = await import("@/lib/booking.functions");
    const authEmail = emailForCustomerAccount(profile.email ?? "", phone);

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: authEmail,
    });
    if (linkError) throw new Error(linkError.message);

    const tokenHash = linkData.properties?.hashed_token;
    if (!tokenHash) throw new Error("Could not complete sign-in.");

    return { tokenHash };
  });
