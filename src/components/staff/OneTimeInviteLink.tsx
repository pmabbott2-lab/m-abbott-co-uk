import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Shown once after creation; the link cannot be retrieved again (revoke and reissue). */
export function OneTimeInviteLink({ path, email }: { path: string; email?: string | null }) {
  const url = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input readOnly value={url} className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => toast.success("Invite link copied"));
          }}
        >
          Copy
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Copy this link now and send it to {email ? email : "the invitee"}. It is shown only once and
        only works for the invited email address. If it is lost, revoke the invite and create a new
        one.
      </p>
    </div>
  );
}
