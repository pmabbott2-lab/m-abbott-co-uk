import { type ReactNode, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isValidUkMobile, normaliseUkPhone } from "@/lib/phone";
import { shouldBlockAuthenticatedApp } from "@/lib/auth-recovery";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import avatarImg from "@/assets/susan.png";

type ProfilePhone = { hasPhone: boolean } | null;

// Loads the current user's profile phone. Returns null (fail-open) on any error
// so a transient query failure never traps the user out of the whole app.
async function fetchProfilePhone(): Promise<ProfilePhone> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("phone")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.warn("[PhoneCaptureGate] could not load profile phone:", error.message);
    return null;
  }

  return { hasPhone: Boolean(data?.phone && data.phone.trim().length > 0) };
}

// Blocking-but-friendly prompt that asks Google sign-in users (who arrive with
// no phone) for their mobile number before they continue. Mounted at the
// `/_authenticated` choke point so it covers every authenticated page.
export function PhoneCaptureGate({ children }: { children: ReactNode }) {
  const recoveryActive =
    typeof window !== "undefined" && shouldBlockAuthenticatedApp();

  const profileQ = useQuery({
    queryKey: ["profile-phone-gate"],
    queryFn: fetchProfilePhone,
    enabled: !recoveryActive,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: async (raw: string) => {
      const normalised = normaliseUkPhone(raw);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Your session has expired — please sign in again.");

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ phone: normalised })
        .eq("id", user.id);
      if (updateError) throw new Error(updateError.message);

      // Mirror into auth metadata so it's consistent with the email-signup path
      // (which stores phone in raw_user_meta_data). Non-fatal if it fails.
      try {
        await supabase.auth.updateUser({ data: { phone: normalised } });
      } catch (err) {
        console.warn("[PhoneCaptureGate] could not mirror phone to auth metadata:", err);
      }
    },
    onSuccess: () => setSaved(true),
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not save your number — please try again."),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isValidUkMobile(phone)) {
      setError("Please enter a valid UK mobile number, e.g. 07123 456789.");
      return;
    }
    save.mutate(phone);
  };

  // Fail open: while loading, on error, during password recovery, or once the
  // number is captured, never block the app.
  const needsPhone =
    !recoveryActive &&
    !saved &&
    profileQ.isSuccess &&
    profileQ.data !== null &&
    !profileQ.data.hasPhone;

  return (
    <>
      {children}
      <Dialog open={needsPhone}>
        <DialogContent
          className="[&>button]:hidden"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <img
              src={avatarImg}
              alt="Your guide"
              width={64}
              height={64}
              className="mx-auto rounded-full object-cover object-top"
            />
            <DialogTitle className="text-center">Add your mobile number</DialogTitle>
            <DialogDescription className="text-center">
              We use your mobile to confirm appointments and text you a link to pick up where you
              left off. It only takes a moment.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="gate-phone">Mobile number</Label>
              <Input
                id="gate-phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="07…"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (error) setError(null);
                }}
                autoFocus
                aria-invalid={error ? true : undefined}
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={save.isPending} className="w-full">
                {save.isPending ? "Saving…" : "Save and continue"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
