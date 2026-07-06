import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { getPhoneCall, type PhoneCallDetail } from "@/lib/telephony.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function PhoneCallDetailDialog({
  callId,
  open,
  onOpenChange,
}: {
  callId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const getFn = useServerFn(getPhoneCall);
  const q = useQuery({
    queryKey: ["phone-call", callId],
    queryFn: () => getFn({ data: { callId: callId! } }),
    enabled: open && Boolean(callId),
  });

  const call = q.data;
  const title =
    call?.callKind === "inbound_voicemail"
      ? "Voicemail"
      : call?.direction === "inbound"
        ? "Inbound call"
        : "Outbound call";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {call
              ? `${format(new Date(call.startedAt), "PPpp")}${
                  call.fromNumber ? ` · from ${call.fromNumber}` : ""
                }${call.toNumber ? ` · to ${call.toNumber}` : ""}`
              : "Loading call details…"}
          </DialogDescription>
        </DialogHeader>
        {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {q.isError && (
          <p className="text-sm text-destructive">
            {q.error instanceof Error ? q.error.message : "Could not load call"}
          </p>
        )}
        {call && <CallDetailBody call={call} />}
      </DialogContent>
    </Dialog>
  );
}

function CallDetailBody({ call }: { call: PhoneCallDetail }) {
  if (call.aiStatus === "processing" || call.aiStatus === "pending") {
    return (
      <p className="text-sm text-muted-foreground">
        Transcript and summary are being prepared — check back in a minute.
      </p>
    );
  }
  if (call.aiStatus === "failed") {
    return (
      <p className="text-sm text-muted-foreground">
        We could not transcribe this recording. The call is still logged in history.
      </p>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      {call.summary && (
        <div>
          <h4 className="font-medium mb-1">Summary</h4>
          <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">{call.summary}</p>
        </div>
      )}
      {call.transcript && (
        <div>
          <h4 className="font-medium mb-1">Transcript</h4>
          <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed text-xs">{call.transcript}</p>
        </div>
      )}
      {!call.summary && !call.transcript && (
        <p className="text-muted-foreground">No transcript available for this call.</p>
      )}
    </div>
  );
}
