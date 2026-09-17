import { Label } from "@/components/ui/label";

export type SlotAdvisorOption = {
  id: string;
  fullName: string;
  isTest?: boolean;
};

/** "any" = I don't mind (least-loaded free advisor that day). */
export type AdvisorChoice = "any" | string;

type Props = {
  selectedSlot: string | null;
  advisorsForSlot: SlotAdvisorOption[];
  value: AdvisorChoice;
  onChange: (v: AdvisorChoice) => void;
};

/**
 * Shown after a date/time is chosen. Lists advisors free at that slot plus
 * “I don’t mind” (assigns the least-loaded free advisor that day).
 */
export function BookingAdvisorPicker({
  selectedSlot,
  advisorsForSlot,
  value,
  onChange,
}: Props) {
  if (!selectedSlot) return null;

  return (
    <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
      <Label className="text-sm font-medium">Advisor</Label>
      <p className="text-xs text-muted-foreground">
        Choose who you&apos;d like, or leave it to us — we&apos;ll assign the advisor with
        the lightest diary that day.
      </p>
      <div className="grid gap-2">
        <label
          className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer text-sm ${
            value === "any" ? "border-primary bg-primary/5" : "hover:bg-background/60"
          }`}
        >
          <input
            type="radio"
            name="booking-advisor"
            checked={value === "any"}
            onChange={() => onChange("any")}
          />
          <span>
            <span className="font-medium">I don&apos;t mind</span>
            <span className="block text-xs text-muted-foreground">
              Assign whoever has the fewest appointments that day
            </span>
          </span>
        </label>
        {advisorsForSlot.map((a) => (
          <label
            key={a.id}
            className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer text-sm ${
              value === a.id ? "border-primary bg-primary/5" : "hover:bg-background/60"
            }`}
          >
            <input
              type="radio"
              name="booking-advisor"
              checked={value === a.id}
              onChange={() => onChange(a.id)}
            />
            <span>
              <span className="font-medium">{a.fullName}</span>
              {a.isTest ? (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Test
                </span>
              ) : null}
            </span>
          </label>
        ))}
        {advisorsForSlot.length === 0 && (
          <p className="text-xs text-muted-foreground px-1">
            No named advisors free at this time — use “I don&apos;t mind” or pick another slot.
          </p>
        )}
      </div>
    </div>
  );
}

export function advisorChoiceToPayload(choice: AdvisorChoice): {
  advisorId?: string;
  preferAnyAdvisor: boolean;
} {
  if (choice === "any") return { preferAnyAdvisor: true };
  return { advisorId: choice, preferAnyAdvisor: false };
}
