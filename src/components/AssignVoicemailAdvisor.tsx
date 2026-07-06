import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { assignUnallocatedVoicemail, listAssigneeAdvisors } from "@/lib/booking.functions";
import { Button } from "@/components/ui/button";

export function AssignVoicemailAdvisor({
  callbackId,
  onAssigned,
}: {
  callbackId: string;
  onAssigned?: () => void;
}) {
  const advisorsFn = useServerFn(listAssigneeAdvisors);
  const assignFn = useServerFn(assignUnallocatedVoicemail);

  const advisorsQ = useQuery({
    queryKey: ["assignee-advisors"],
    queryFn: () => advisorsFn(),
  });

  const assign = useMutation({
    mutationFn: (advisorId: string) => assignFn({ data: { callbackId, advisorId } }),
    onSuccess: (result) => {
      const linked = result.sessionId ? " Linked to matching customer case." : "";
      toast.success(`Assigned to ${result.advisorName ?? "advisor"}.${linked}`);
      onAssigned?.();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not assign"),
  });

  const advisors = advisorsQ.data ?? [];

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <select
        className="rounded-md border bg-background px-2 py-1.5 text-xs max-w-[160px]"
        defaultValue=""
        disabled={assign.isPending || advisorsQ.isLoading}
        onChange={(e) => {
          const advisorId = e.target.value;
          if (advisorId) assign.mutate(advisorId);
          e.target.value = "";
        }}
      >
        <option value="" disabled>
          Assign to advisor…
        </option>
        {advisors.map((a) => (
          <option key={a.id} value={a.id}>
            {a.full_name || a.email || a.id.slice(0, 8)}
          </option>
        ))}
      </select>
      {assign.isPending && (
        <Button type="button" size="sm" variant="ghost" disabled>
          Assigning…
        </Button>
      )}
    </div>
  );
}
