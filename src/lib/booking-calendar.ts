/** Shared calendar disable rules for Hub booking (Mon–Fri, not in the past). */
export function bookingCalendarDisabled(date: Date): boolean {
  const day = date.getDay();
  if (day === 0 || day === 6) return true;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return date < start;
}
