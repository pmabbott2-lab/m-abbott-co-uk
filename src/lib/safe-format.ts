import { format, formatDistanceToNow } from "date-fns";

function toValidDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** date-fns format() throws on invalid dates — use this in UI render paths. */
export function safeFormat(
  value: string | number | Date | null | undefined,
  pattern: string,
  fallback = "—",
): string {
  const d = toValidDate(value);
  if (!d) return fallback;
  try {
    return format(d, pattern);
  } catch {
    return fallback;
  }
}

export function safeFormatDistanceToNow(
  value: string | number | Date | null | undefined,
  options?: Parameters<typeof formatDistanceToNow>[1],
  fallback = "—",
): string {
  const d = toValidDate(value);
  if (!d) return fallback;
  try {
    return formatDistanceToNow(d, options);
  } catch {
    return fallback;
  }
}
