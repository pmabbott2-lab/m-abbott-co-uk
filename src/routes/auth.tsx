import { createFileRoute, useNavigate, useMatches, Outlet } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  clearPasswordRecoveryPending,
  goToPasswordRecoveryPage,
  isPasswordRecoveryPending,
  isPasswordRecoveryUrl,
} from "@/lib/auth-recovery";
import { sendLoginSmsCode, verifyLoginSmsCodeFn } from "@/lib/auth.functions";
import {
  clearLoginSmsVerified,
  isLoginSmsVerified,
  markLoginSmsVerified,
} from "@/lib/auth-sms-session";
import { setReferralCookie } from "@/lib/referral";
import { getAuthCallbackUrl, getPasswordResetUrl, isLocalDev } from "@/lib/app-url";
import { isLoginMfaSuspended } from "@/lib/auth-mfa-config";
import { fetchUserRoles, requiresAuthenticatorMfa, requiresSmsLoginVerification } from "@/lib/auth-roles";
import {
  buildHomePathAfterAuth,
  clearPostAuthStart,
  parsePostAuthStart,
  readPostAuthStart,
  readPostAuthStartFromUrl,
  readAuthEntryFromLocation,
  readTenantSlugFromLocation,
  resolvePostAuthStart,
  savePostAuthStart,
  syncPostAuthStart,
  usesAppointmentSignupFlow,
} from "@/lib/post-auth-journey";

function hasTestLoginBypass(session: Session): boolean {
  const meta = session.user.app_metadata as { test_email_bypass?: boolean } | undefined;
  return Boolean(meta?.test_email_bypass);
}
import { isValidUkMobile, normaliseUkPhone } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import avatarImg from "@/assets/susan.png";
import { CustomerAppointmentSignup } from "@/components/CustomerAppointmentSignup";

type AuthMode = "signin" | "signup" | "forgot" | "phone" | "mfa-challenge" | "mfa-enroll" | "mfa-setup-required" | "sms-login-challenge";

function isSupabaseMfaDisabledMessage(msg: string): boolean {
  return /mfa|totp|factor|not enabled|disabled|unavailable/i.test(msg);
}

export const Route = createFileRoute("/auth")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 0,
  pendingComponent: () => null,
  validateSearch: (search: Record<string, unknown>) => {
    const fromBroker =
      search.from === "broker" ||
      search.from === "mortgageeasy";
    const start =
      parsePostAuthStart(typeof search.start === "string" ? search.start : null) ?? undefined;
    const joinRaw = search.join;
    const join =
      joinRaw === "1" ||
      joinRaw === 1 ||
      joinRaw === true ||
      joinRaw === "true" ||
      joinRaw === "signup" ||
      search.mode === "signup" ||
      search.mode === "join" ||
      start !== undefined;
    const tenantRaw = typeof search.tenant === "string" ? search.tenant.trim().toLowerCase() : "";
    const tenant = /^[a-z0-9-]{2,64}$/.test(tenantRaw) ? tenantRaw : undefined;
    return {
      recovery: search.recovery === "1" || search.recovery === 1 || search.recovery === true,
      join,
      fromBroker,
      start,
      tenant,
    };
  },
  head: () => ({
    meta: [
      { title: "Sign in — Mortgage Hub" },
      { name: "description", content: "Sign in to get started with Mortgage Hub." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  // `/auth` is the parent of child routes like `/auth/reset`. Since this
  // component has no <Outlet/>, render child routes here instead of the
  // sign-in form (otherwise the reset page never mounts). Derive this from the
  // matched route tree (consistent across SSR/client) to avoid hydration
  // mismatches that a window-location check would cause.
  const matches = useMatches();
  const isChildRoute = matches.some((m) => m.routeId === "/auth/reset");
  const { recovery, fromBroker, tenant: tenantFromSearch } = Route.useSearch();
  const urlIntent = readAuthEntryFromLocation();
  const journeyStart = urlIntent.start;
  const effectiveJoin = urlIntent.join;
  const tenantSlug = tenantFromSearch ?? readTenantSlugFromLocation();
  const [mode, setMode] = useState<AuthMode>(() => {
    if (typeof window === "undefined") return "signin";
    return readAuthEntryFromLocation().join ? "signup" : "signin";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [devResetLink, setDevResetLink] = useState<string | null>(null);
  // SMS OTP login: once a code is sent we remember the E.164 number we sent it
  // to and switch to the code-entry step.
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  // TOTP MFA: challenge after password sign-in, or first-time enrollment for staff.
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaChallengeId, setMfaChallengeId] = useState<string | null>(null);
  const [mfaTotpCode, setMfaTotpCode] = useState("");
  const [mfaQrSvg, setMfaQrSvg] = useState<string | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaEnrollFactorId, setMfaEnrollFactorId] = useState<string | null>(null);
  const [mfaBlocking, setMfaBlocking] = useState(false);
  const [mfaStaffRequired, setMfaStaffRequired] = useState(false);
  // SMS login verification for customers & introducers (after email/Google sign-in).
  const [smsBlocking, setSmsBlocking] = useState(false);
  const [smsSentTo, setSmsSentTo] = useState<string | null>(null);
  const [smsLoginCode, setSmsLoginCode] = useState("");
  const [smsNeedsPhone, setSmsNeedsPhone] = useState(false);
  const [smsChallengePhone, setSmsChallengePhone] = useState("");

  const sendLoginSmsFn = useServerFn(sendLoginSmsCode);
  const verifyLoginSmsFn = useServerFn(verifyLoginSmsCodeFn);
  const signInInFlight = useRef(false);

  const goHomeAfterAuth = (routeStart?: typeof journeyStart) => {
    const pendingStart =
      mode === "signin" ? null : resolvePostAuthStart(routeStart ?? journeyStart);
    window.location.assign(buildHomePathAfterAuth(pendingStart, tenantSlug));
  };

  const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out — please try again.`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const maybeEnterAppWithSession = async (session: Session): Promise<void> => {
    if (isPasswordRecoveryPending() || mfaBlocking || smsBlocking) return;
    try {
      if (
        await withTimeout(
          resumeLoginStepIfNeeded(session),
          8000,
          "Sign-in check",
        )
      ) {
        return;
      }
      goHomeAfterAuth();
    } catch (err) {
      console.error("[auth] session resume failed:", err);
      await supabase.auth.signOut({ scope: "local" });
      showStatus("error", err instanceof Error ? err.message : "Please sign in again.");
    }
  };

  useLayoutEffect(() => {
    if (isChildRoute) return;
    const intent = readAuthEntryFromLocation();
    const urlStart = intent.start;
    if (urlStart) {
      savePostAuthStart(urlStart);
    }
    const refSlug = new URLSearchParams(window.location.search).get("ref")?.trim().toLowerCase()
      || new URLSearchParams(window.location.search).get("introducer")?.trim().toLowerCase();
    if (refSlug) {
      setReferralCookie(refSlug);
    }
    const isOAuthReturn =
      typeof window !== "undefined" &&
      (window.location.hash.includes("access_token") || window.location.hash.includes("error"));
    if (intent.join) {
      setMode("signup");
      return;
    }
    setMode("signin");
    if (!isOAuthReturn) {
      clearPostAuthStart();
    }
  }, [isChildRoute, effectiveJoin, journeyStart, fromBroker]);

  useEffect(() => {
    if (isChildRoute) return;
    if (recovery || isPasswordRecoveryUrl() || isPasswordRecoveryPending()) {
      goToPasswordRecoveryPage();
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        goToPasswordRecoveryPage();
        return;
      }
      if (event === "SIGNED_OUT") {
        clearLoginSmsVerified();
        return;
      }
      // Initial session is handled below — avoids double redirect before the form renders.
      if (event === "INITIAL_SESSION") return;
      if (signInInFlight.current) return;
      if (session && !isPasswordRecoveryPending() && !mfaBlocking && !smsBlocking) {
        await maybeEnterAppWithSession(session);
      }
    });

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session || signInInFlight.current) return;
      await maybeEnterAppWithSession(data.session);
    })();

    return () => subscription.unsubscribe();
  }, [recovery, navigate, isChildRoute, mfaBlocking, smsBlocking, journeyStart]);

  const showStatus = (type: "error" | "success", text: string) => {
    setStatus({ type, text });
    if (type === "success") toast.success(text);
    else toast.error(text);
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setStatus(null);
    setDevResetLink(null);
    setPassword("");
    if (next !== "signup") setPhone("");
    setOtpSentTo(null);
    setOtpCode("");
    setMfaFactorId(null);
    setMfaChallengeId(null);
    setMfaTotpCode("");
    setMfaQrSvg(null);
    setMfaSecret(null);
    setMfaEnrollFactorId(null);
    setMfaBlocking(false);
    setMfaStaffRequired(false);
    setSmsBlocking(false);
    setSmsSentTo(null);
    setSmsLoginCode("");
    setSmsNeedsPhone(false);
    setSmsChallengePhone("");
    if (typeof window !== "undefined") {
      const broker = fromBroker || urlIntent.fromBroker;
      if (next === "signup") {
        const preservedStart =
          readPostAuthStartFromUrl() ?? journeyStart ?? readPostAuthStart() ?? undefined;
        if (preservedStart) savePostAuthStart(preservedStart);
        void navigate({
          to: "/auth",
          search: {
            ...(broker ? { from: "broker" as const } : {}),
            join: "1",
            ...(preservedStart ? { start: preservedStart } : {}),
          },
          replace: true,
        });
      } else if (next === "signin") {
        clearPostAuthStart();
        void navigate({
          to: "/auth",
          search: broker ? { from: "broker" as const } : {},
          replace: true,
        });
      }
    }
  };

  const finishSignIn = async (session?: Session | null) => {
    signInInFlight.current = true;
    try {
      setMfaBlocking(false);
      setMfaStaffRequired(false);
      setSmsBlocking(false);
      clearPasswordRecoveryPending();
      if (session?.access_token && session.refresh_token) {
        // Force-persist the session before leaving /auth — soft navigates can race
        // the ssr:false auth guard and bounce back to login with an empty screen.
        const { error } = await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
        if (error) throw error;
        markLoginSmsVerified(session);
      } else if (session) {
        markLoginSmsVerified(session);
      }
      for (let i = 0; i < 20; i++) {
        const { data } = await supabase.auth.getSession();
        if (data.session?.user) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      // Full reload so /_authenticated beforeLoad always sees a stored session.
      const pendingStart = mode === "signin" ? null : resolvePostAuthStart(journeyStart);
      window.location.assign(buildHomePathAfterAuth(pendingStart, tenantSlug));
    } finally {
      // Keep in-flight true through navigation; unload clears it.
    }
  };

  const dispatchLoginSms = async (phone?: string): Promise<boolean> => {
    try {
      const result = await sendLoginSmsFn({ data: phone ? { phone } : {} });
      setSmsSentTo(result.sentTo);
      setSmsNeedsPhone(false);
      setSmsLoginCode("");
      showStatus("success", `We've texted a 6-digit code to ${result.sentTo}.`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not send the code";
      if (/mobile number|phone/i.test(msg)) {
        setSmsNeedsPhone(true);
        setSmsSentTo(null);
      }
      showStatus("error", msg);
      return false;
    }
  };

  const beginCustomerSmsChallenge = async (session: Session): Promise<boolean> => {
    const roles = await fetchUserRoles(session.user.id);
    if (!requiresSmsLoginVerification(roles)) return false;
    if (isLoginSmsVerified(session)) return false;
    if (hasTestLoginBypass(session)) {
      markLoginSmsVerified(session);
      return false;
    }

    setSmsBlocking(true);
    setMode("sms-login-challenge");

    const { data: profile } = await supabase
      .from("profiles")
      .select("phone")
      .eq("id", session.user.id)
      .maybeSingle();
    const savedPhone = profile?.phone?.trim();
    if (savedPhone) {
      setSmsChallengePhone(savedPhone);
      await dispatchLoginSms();
    } else {
      setSmsNeedsPhone(true);
      setSmsSentTo(null);
    }
    return true;
  };

  /** Staff (advisor/admin): authenticator. Customers/introducers: SMS code. Skipped when MFA suspended. */
  const resolveLoginStepAfterSignIn = async (session: Session): Promise<boolean> => {
    if (isLoginMfaSuspended()) return false;
    const roles = await fetchUserRoles(session.user.id);
    if (requiresAuthenticatorMfa(roles)) {
      setMfaStaffRequired(true);
      if (await beginMfaChallenge()) return true;
      if (await maybePromptMfaEnrollment()) return true;
      return false;
    }
    return beginCustomerSmsChallenge(session);
  };

  const resumeLoginStepIfNeeded = async (session: Session): Promise<boolean> => {
    if (isLoginMfaSuspended()) return false;
    const roles = await fetchUserRoles(session.user.id);
    if (requiresAuthenticatorMfa(roles)) {
      setMfaStaffRequired(true);
      if (await beginMfaChallenge()) return true;
      if (await maybePromptMfaEnrollment()) return true;
      return false;
    }
    if (isLoginSmsVerified(session)) return false;
    if (hasTestLoginBypass(session)) {
      markLoginSmsVerified(session);
      return false;
    }
    return beginCustomerSmsChallenge(session);
  };

  const showStaffMfaSetupRequired = () => {
    setMfaBlocking(true);
    setMfaStaffRequired(true);
    setMode("mfa-setup-required");
  };

  const signOutAndRestart = async () => {
    await supabase.auth.signOut();
    switchMode("signin");
  };

  const retryStaffMfaSetup = async () => {
    setStatus(null);
    setLoading(true);
    try {
      if (await maybePromptMfaEnrollment()) return;
      showStatus(
        "error",
        "TOTP still isn't available. In Supabase go to Authentication → MFA, enable TOTP, save, then try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const beginMfaChallenge = async (): Promise<boolean> => {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
    if (listErr) {
      if (isSupabaseMfaDisabledMessage(listErr.message ?? "")) {
        showStaffMfaSetupRequired();
        return true;
      }
      console.error("mfa listFactors", listErr);
      showStatus("error", "Could not load MFA — try signing in again.");
      return true;
    }
    const verifiedTotp = factors?.totp?.find((f) => f.status === "verified");
    if (
      verifiedTotp &&
      aal?.currentLevel === "aal1" &&
      aal?.nextLevel === "aal2"
    ) {
      const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({
        factorId: verifiedTotp.id,
      });
      if (chErr) throw chErr;
      setMfaFactorId(verifiedTotp.id);
      setMfaChallengeId(challenge.id);
      setMfaTotpCode("");
      setMfaBlocking(true);
      setMode("mfa-challenge");
      return true;
    }
    return false;
  };

  const maybePromptMfaEnrollment = async (): Promise<boolean> => {
    const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
    if (listErr) {
      console.error("mfa listFactors", listErr);
      if (isSupabaseMfaDisabledMessage(listErr.message ?? "")) {
        showStaffMfaSetupRequired();
        return true;
      }
      return false;
    }
    const hasVerified = (factors?.totp ?? []).some((f) => f.status === "verified");
    if (hasVerified) return false;

    const { data: enroll, error: enrollErr } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Authenticator app",
    });
    if (enrollErr) {
      const msg = enrollErr.message ?? "";
      if (isSupabaseMfaDisabledMessage(msg)) {
        showStaffMfaSetupRequired();
        return true;
      }
      showStatus("error", msg || "Could not start authenticator setup.");
      return false;
    }

    setMfaEnrollFactorId(enroll.id);
    setMfaQrSvg(enroll.totp.qr_code);
    setMfaSecret(enroll.totp.secret);
    setMfaTotpCode("");
    setMfaBlocking(true);
    setMode("mfa-enroll");
    return true;
  };

  const verifyMfaChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaFactorId || !mfaChallengeId) return;
    const code = mfaTotpCode.trim();
    if (!/^\d{6}$/.test(code)) {
      showStatus("error", "Enter the 6-digit code from your authenticator app.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: mfaChallengeId,
        code,
      });
      if (error) throw error;
      const { data: sessionData } = await supabase.auth.getSession();
      await finishSignIn(sessionData.session);
    } catch (err) {
      showStatus("error", err instanceof Error ? err.message : "Invalid code — try again.");
    } finally {
      setLoading(false);
    }
  };

  const verifyMfaEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaEnrollFactorId) return;
    const code = mfaTotpCode.trim();
    if (!/^\d{6}$/.test(code)) {
      showStatus("error", "Enter the 6-digit code from your authenticator app.");
      return;
    }
    setLoading(true);
    try {
      const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({
        factorId: mfaEnrollFactorId,
      });
      if (chErr) throw chErr;
      const { error } = await supabase.auth.mfa.verify({
        factorId: mfaEnrollFactorId,
        challengeId: challenge.id,
        code,
      });
      if (error) throw error;
      toast.success("Authenticator app linked");
      const { data: sessionData } = await supabase.auth.getSession();
      await finishSignIn(sessionData.session);
    } catch (err) {
      showStatus("error", err instanceof Error ? err.message : "Could not verify — check the code.");
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setLoading(true);
    try {
      if (mode === "forgot") {
        const res = await fetch("/api/auth/request-password-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim() }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          redirectTo?: string;
          setupHint?: string;
          resetLink?: string;
          mode?: "direct_link" | "email";
        };
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? "Could not create reset link");
        }

        if (data.mode === "direct_link" && data.resetLink) {
          setDevResetLink(data.resetLink);
          showStatus(
            "success",
            `Reset link ready for ${data.redirectTo ?? getPasswordResetUrl()}. Click the button below.`,
          );
          if (data.setupHint) {
            toast.message("Supabase redirect URLs", { description: data.setupHint });
          }
          return;
        }

        const target = data.redirectTo ?? getPasswordResetUrl();
        let message = `If an account exists for that email, we've sent a reset link. It should open at ${target}.`;
        if (data.setupHint) message += ` ${data.setupHint}`;
        showStatus("success", message);
        if (data.resetLink) setDevResetLink(data.resetLink);
        return;
      }

      if (mode === "signup") {
        const form = e.currentTarget;
        const fd = new FormData(form);
        const emailValue = (String(fd.get("email") ?? "") || email).trim();
        const passwordValue = String(fd.get("password") ?? "") || password;
        const nameValue = (String(fd.get("name") ?? "") || fullName).trim();
        const phoneRaw = (String(fd.get("phone") ?? "") || phone).trim();

        if (!nameValue || nameValue.length < 2) {
          showStatus("error", "Enter your full name.");
          return;
        }
        if (!emailValue) {
          showStatus("error", "Enter your email address.");
          return;
        }
        if (!passwordValue || passwordValue.length < 6) {
          showStatus("error", "Password must be at least 6 characters.");
          return;
        }
        if (!isValidUkMobile(phoneRaw)) {
          showStatus("error", "Enter a valid UK mobile number (e.g. 07123 456789).");
          return;
        }
        const phoneValue = normaliseUkPhone(phoneRaw);

        const { data, error } = await supabase.auth.signUp({
          email: emailValue,
          password: passwordValue,
          options: {
            emailRedirectTo: getAuthCallbackUrl(),
            data: { full_name: nameValue, phone: phoneValue },
          },
        });
        if (error) throw error;

        if (data.user && data.user.identities?.length === 0) {
          showStatus("error", "An account with this email already exists. Try signing in or reset your password.");
          switchMode("signin");
          return;
        }

        if (data.session) {
          clearPasswordRecoveryPending();
          if (await resolveLoginStepAfterSignIn(data.session)) return;
          await finishSignIn(data.session);
          return;
        }

        showStatus(
          "success",
          "Account created. Check your email for a confirmation link, then sign in here.",
        );
        switchMode("signin");
        return;
      }

      const form = e.currentTarget;
      const fd = new FormData(form);
      const emailValue = (String(fd.get("email") ?? "") || email).trim();
      const passwordValue = String(fd.get("password") ?? "") || password;
      if (!emailValue || !passwordValue) {
        showStatus("error", "Enter your email and password to sign in.");
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailValue,
        password: passwordValue,
      });
      if (error) throw error;
      if (!data.session) {
        showStatus("error", "Sign-in did not complete. Please try again.");
        return;
      }
      clearPasswordRecoveryPending();

      if (await resolveLoginStepAfterSignIn(data.session)) return;
      await finishSignIn(data.session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      if (/email not confirmed/i.test(msg)) {
        showStatus("error", "Please confirm your email first — check your inbox for the link from Supabase.");
      } else if (/invalid api key/i.test(msg)) {
        showStatus(
          "error",
          "Invalid Supabase API key. In .env, copy the full publishable and service_role keys from Supabase → Settings → API (new keys start with sb_publishable_ / sb_secret_). Then restart npm run dev.",
        );
      } else if (/invalid login credentials/i.test(msg)) {
        showStatus("error", "Wrong email or password. Try Forgot password? below.");
      } else {
        showStatus("error", msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    syncPostAuthStart(journeyStart);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: getAuthCallbackUrl() },
      });
      if (error) throw error;
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Google sign-in failed. Use email/password, or enable Google in your Supabase project.",
      );
      setLoading(false);
    }
  };

  const sendOtp = async (resend = false) => {
    const e164 = normaliseUkPhone(phone);
    if (!isValidUkMobile(phone)) {
      showStatus("error", "Enter a valid UK mobile number (e.g. 07123 456789).");
      return;
    }
    setStatus(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
      if (error) throw error;
      setOtpSentTo(e164);
      setOtpCode("");
      showStatus("success", `We've texted a 6-digit code to ${e164}.${resend ? " (resent)" : ""}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not send the code";
      if (/signups not allowed|otp.*disabled|phone.*provider|not enabled/i.test(msg)) {
        showStatus(
          "error",
          "Phone sign-in isn't enabled yet. An admin must turn on the Phone provider and an SMS provider in Supabase.",
        );
      } else {
        showStatus("error", msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const verifyOtpCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpSentTo) return;
    const token = otpCode.trim();
    if (!/^\d{6}$/.test(token)) {
      showStatus("error", "Enter the 6-digit code from the text message.");
      return;
    }
    setStatus(null);
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: otpSentTo,
        token,
        type: "sms",
      });
      if (error) throw error;
      if (!data.session) {
        showStatus("error", "Sign-in did not complete. Please try again.");
        return;
      }
      clearPasswordRecoveryPending();
      markLoginSmsVerified(data.session);
      if (await resolveLoginStepAfterSignIn(data.session)) return;
      await finishSignIn(data.session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      if (/expired|invalid|incorrect|token/i.test(msg)) {
        showStatus("error", "That code is invalid or expired. Request a new one.");
      } else {
        showStatus("error", msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const verifySmsLoginChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = smsLoginCode.trim();
    if (!/^\d{6}$/.test(code)) {
      showStatus("error", "Enter the 6-digit code from the text message.");
      return;
    }
    setLoading(true);
    try {
      await verifyLoginSmsFn({ data: { code } });
      const { data: sessionData } = await supabase.auth.getSession();
      await finishSignIn(sessionData.session);
    } catch (err) {
      showStatus("error", err instanceof Error ? err.message : "Invalid code — try again.");
    } finally {
      setLoading(false);
    }
  };

  const sendSmsLoginCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (smsNeedsPhone && !isValidUkMobile(smsChallengePhone)) {
      showStatus("error", "Enter a valid UK mobile number (e.g. 07123 456789).");
      return;
    }
    setLoading(true);
    try {
      await dispatchLoginSms(smsNeedsPhone ? smsChallengePhone : undefined);
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === "sms-login-challenge"
      ? "Check your phone"
      : mode === "mfa-challenge"
      ? "Two-factor authentication"
      : mode === "mfa-enroll"
        ? "Set up authenticator app"
        : mode === "mfa-setup-required"
          ? "Enable staff authenticator in Supabase"
        : mode === "forgot"
      ? "Reset your password"
      : mode === "phone"
        ? "Sign in with your phone"
        : mode === "signup"
          ? journeyStart === "voice"
            ? "Create your account — then talk to Susan"
            : journeyStart === "chat"
              ? "Create your account — then chat with Susan"
              : journeyStart === "book"
                ? "Book your appointment"
                : "Start your journey with Susan"
          : "Get started with Mortgage Hub";

  const subtitle =
    mode === "sms-login-challenge"
      ? smsSentTo
        ? `Enter the 6-digit code we texted to ${smsSentTo}.`
        : "We'll text you a one-time code to confirm it's you."
      : mode === "mfa-challenge"
      ? "Enter the 6-digit code from Microsoft Authenticator, Google Authenticator, or Authy."
      : mode === "mfa-enroll"
        ? mfaStaffRequired
          ? "Staff accounts must link an authenticator app before continuing."
          : "Scan the QR code with your authenticator app, then enter the code to finish setup."
        : mode === "mfa-setup-required"
          ? "Your account is an advisor or admin. Supabase must have TOTP turned on before you can link Microsoft Authenticator."
        : mode === "forgot"
      ? isLocalDev()
        ? "We'll create a direct reset link for localhost (no email required)."
        : "Enter your email and we'll send you a reset link."
        : mode === "phone"
        ? otpSentTo
          ? "Enter the 6-digit code we just texted you."
          : "Customers and introducers: we'll text you a one-time code to sign in — no authenticator app needed."
        : mode === "signup" && journeyStart === "voice"
          ? "A short spoken fact-find with Susan — create your account to begin."
          : mode === "signup" && journeyStart === "chat"
            ? "A quiet typed fact-find with Susan — create your account to begin."
            : mode === "signup" && journeyStart === "book"
              ? "Pick a time with your advisor — we'll confirm by text."
              : mode === "signup"
                ? "To get started we only need your name, email address, telephone number and a password."
              : mode === "signin"
                ? "Sign in to your Mortgage Hub account."
                : "Create your account to get started with Mortgage Hub.";

  const submitLabel =
    mode === "forgot"
      ? isLocalDev()
        ? "Get reset link"
        : "Send reset link"
      : mode === "signup"
        ? "Create account"
        : "Sign in";

  const signupTabLabel = usesAppointmentSignupFlow(journeyStart) ? "Book appointment" : "Create account";
  const appointmentSignup =
    mode === "signup" && effectiveJoin && journeyStart === "book";

  // Child routes (e.g. /auth/reset) render here via the parent's outlet.
  if (isChildRoute) return <Outlet />;

  if (appointmentSignup) {
    return (
      <div className="min-h-screen bg-background px-4 sm:px-6 py-8 sm:py-12">
        <div className="max-w-4xl mx-auto">
          <CustomerAppointmentSignup
            journey="book"
            onComplete={() => void finishSignIn()}
            onSwitchSignIn={() => switchMode("signin")}
          />
        </div>
        <p className="text-xs text-center text-muted-foreground mt-8 space-x-3">
          <a href="/" className="hover:underline">← Back home</a>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-background">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <img src={avatarImg} alt="Your guide" width={96} height={96} className="mx-auto rounded-full object-cover object-top" />
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="bg-card rounded-2xl shadow-sm border p-6 space-y-4">
          {mode === "signin" || mode === "signup" ? (
            <div className="flex gap-2 p-1 bg-muted rounded-lg">
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className={`flex-1 text-sm py-2 rounded-md transition ${mode === "signin" ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className={`flex-1 text-sm py-2 rounded-md transition ${mode === "signup" ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}
              >
                {signupTabLabel}
              </button>
            </div>
          ) : mode === "mfa-setup-required" ? (
            <button
              type="button"
              onClick={() => void signOutAndRestart()}
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              ← Sign out
            </button>
          ) : (
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              ← Back to sign in
            </button>
          )}

          {status && (
            <div
              role="alert"
              className={`rounded-lg border px-3 py-2 text-sm ${
                status.type === "error"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-primary/30 bg-primary/10 text-foreground"
              }`}
            >
              {status.text}
            </div>
          )}

          {devResetLink && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-4 text-sm space-y-3">
              <p className="font-medium text-foreground">Open this reset link</p>
              <Button
                type="button"
                className="w-full"
                onClick={() => {
                  // Force a full navigation to Supabase's verify URL. Supabase
                  // then redirects back to /auth/reset with the recovery tokens.
                  window.location.assign(devResetLink);
                }}
              >
                Reset password
              </Button>
              <p className="text-xs text-muted-foreground break-all">
                Or copy this link into your browser:
                <br />
                <a href={devResetLink} className="underline">{devResetLink}</a>
              </p>
            </div>
          )}

          {mode === "mfa-setup-required" && (
            <div className="space-y-4 text-sm">
              <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                <li>Open your Supabase project dashboard.</li>
                <li>Go to <strong>Authentication</strong> → <strong>MFA</strong> (or Multi-factor authentication).</li>
                <li>Enable <strong>TOTP</strong> (authenticator app) and save.</li>
                <li>Come back here and tap the button below to scan the QR code with Microsoft Authenticator.</li>
              </ol>
              <p className="text-xs text-muted-foreground">
                Customers and introducers use a text-message code instead — you only see this screen because
                your account is an advisor or admin.
              </p>
              <Button type="button" className="w-full" disabled={loading} onClick={() => void retryStaffMfaSetup()}>
                {loading ? "Checking…" : "I've enabled TOTP — set up my authenticator"}
              </Button>
            </div>
          )}

          {mode === "sms-login-challenge" && (
            <>
              {smsNeedsPhone && !smsSentTo && (
                <form onSubmit={sendSmsLoginCode} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="sms-login-phone">Mobile number</Label>
                    <Input
                      id="sms-login-phone"
                      type="tel"
                      autoComplete="tel"
                      inputMode="tel"
                      placeholder="07…"
                      value={smsChallengePhone}
                      onChange={(e) => setSmsChallengePhone(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Sending…" : "Text me a code"}
                  </Button>
                </form>
              )}
              {smsSentTo && (
                <form onSubmit={verifySmsLoginChallenge} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="sms-login-code">6-digit code</Label>
                    <Input
                      id="sms-login-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="123456"
                      value={smsLoginCode}
                      onChange={(e) => setSmsLoginCode(e.target.value.replace(/\D/g, ""))}
                      required
                      autoFocus
                    />
                  </div>
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Verifying…" : "Verify & continue"}
                  </Button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void sendSmsLoginCode()}
                    className="w-full text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
                  >
                    Resend code
                  </button>
                </form>
              )}
            </>
          )}

          {mode === "mfa-challenge" && (
            <form onSubmit={verifyMfaChallenge} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="mfa-code">Authenticator code</Label>
                <Input
                  id="mfa-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={mfaTotpCode}
                  onChange={(e) => setMfaTotpCode(e.target.value.replace(/\D/g, ""))}
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Verifying…" : "Verify & continue"}
              </Button>
            </form>
          )}

          {mode === "mfa-enroll" && (
            <form onSubmit={verifyMfaEnrollment} className="space-y-4">
              {mfaQrSvg && (
                <div
                  className="mx-auto w-48 h-48 rounded-lg border bg-white p-2 [&_svg]:w-full [&_svg]:h-full"
                  dangerouslySetInnerHTML={{ __html: mfaQrSvg }}
                />
              )}
              {mfaSecret && (
                <p className="text-xs text-muted-foreground break-all text-center">
                  Or enter this key manually: <span className="font-mono">{mfaSecret}</span>
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="mfa-enroll-code">6-digit code</Label>
                <Input
                  id="mfa-enroll-code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={mfaTotpCode}
                  onChange={(e) => setMfaTotpCode(e.target.value.replace(/\D/g, ""))}
                  required
                />
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Verifying…" : "Enable & continue"}
              </Button>
              {!mfaStaffRequired && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => void finishSignIn()}
                >
                  Skip for now
                </Button>
              )}
            </form>
          )}

          {mode !== "phone" && mode !== "mfa-challenge" && mode !== "mfa-enroll" && mode !== "mfa-setup-required" && mode !== "sms-login-challenge" && (
          <form method="post" onSubmit={onSubmit} className="space-y-3">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" name="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
            )}
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="phone">Mobile number</Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="07…"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Your preferred contact — we can text you a link to pick up where you left off.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {mode !== "forgot" && (
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
            )}
            {mode === "signin" && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            )}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Please wait…" : submitLabel}
            </Button>
          </form>
          )}

          {mode === "phone" && !otpSentTo && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendOtp(false);
              }}
              className="space-y-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="otp-phone">Mobile number</Label>
                <Input
                  id="otp-phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="07123 456789"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  UK mobile only. For customers and introducers — advisors and admins should sign in with email and an authenticator app.
                </p>
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Sending code…" : "Text me a code"}
              </Button>
            </form>
          )}

          {mode === "phone" && otpSentTo && (
            <form onSubmit={verifyOtpCode} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="otp-code">6-digit code</Label>
                <Input
                  id="otp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  required
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Sent to {otpSentTo}.
                </p>
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Verifying…" : "Verify & sign in"}
              </Button>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setOtpSentTo(null);
                    setOtpCode("");
                    setStatus(null);
                  }}
                  className="text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
                >
                  ← Use a different number
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void sendOtp(true)}
                  className="text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
                >
                  Resend code
                </button>
              </div>
            </form>
          )}

          {(mode === "signin" || mode === "signup") && (
            <>
              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <span className="relative bg-card px-2 text-xs text-muted-foreground mx-auto block w-fit">or</span>
              </div>
              <Button variant="outline" className="w-full" onClick={onGoogle} disabled={loading} type="button">
                Continue with Google
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => switchMode("phone")}
                disabled={loading}
                type="button"
              >
                Sign in with text message (SMS code)
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-center text-muted-foreground space-x-3">
          <a href="/" className="hover:underline">← Back home</a>
          {(mode === "signin" || mode === "signup") && (
            <>
              <span>·</span>
              <button
                type="button"
                onClick={() => switchMode("forgot")}
                className="hover:underline"
              >
                Forgot password?
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
