import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markAdvisorContactHandled } from "@/lib/booking.functions";
import { toast } from "sonner";

export function MarkContactedButton({
  contactType,
  contactId,
  sessionId,
  contacted,
  onDone,
  size = "sm",
}: {
  contactType: "appointment" | "callback" | "phone_call";
  contactId: string;
  sessionId?: string | null;
  contacted?: boolean;
  onDone?: () => void;
  size?: "sm" | "default";
}) {
  const markFn = useServerFn(markAdvisorContactHandled);

  const mark = useMutation({
    mutationFn: () =>
      markFn({
        data: {
          contactType,
          contactId,
          sessionId: sessionId ?? undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Marked as contacted — saved to History");
      onDone?.();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  if (contacted) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Check className="w-3.5 h-3.5" />
        Contacted
      </span>
    );
  }

  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      disabled={mark.isPending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        mark.mutate();
      }}
    >
      {mark.isPending ? "Saving…" : "Contacted"}
    </Button>
  );
}
