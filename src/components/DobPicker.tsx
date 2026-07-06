import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DOB_MONTHS, dobYearOptions, isValidDobParts } from "@/lib/dob-parse";

interface DobPickerProps {
  onConfirm: (day: number, month: number, year: number) => void;
  onSayInstead?: () => void;
  sayInsteadLabel?: string;
}

export function DobPicker({ onConfirm, onSayInstead, sayInsteadLabel = "Say it instead" }: DobPickerProps) {
  const years = useMemo(() => dobYearOptions(), []);
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");

  const dayNum = Number(day);
  const monthNum = Number(month);
  const yearNum = Number(year);
  const valid = isValidDobParts(dayNum, monthNum, yearNum);

  return (
    <div className="w-full max-w-md space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Select value={day} onValueChange={setDay}>
          <SelectTrigger className="rounded-full">
            <SelectValue placeholder="Day" />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <SelectItem key={d} value={String(d)}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="rounded-full">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {DOB_MONTHS.map((m) => (
              <SelectItem key={m.value} value={String(m.value)}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="rounded-full">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent className="max-h-56">
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          size="lg"
          className="rounded-full"
          disabled={!valid}
          onClick={() => onConfirm(dayNum, monthNum, yearNum)}
        >
          Confirm date
        </Button>
        {onSayInstead && (
          <Button variant="ghost" size="lg" className="rounded-full border border-dashed" onClick={onSayInstead}>
            {sayInsteadLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
