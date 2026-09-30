/** Auth email for customers without an address — phone-only bookings. */
export function emailForCustomerAccount(email: string, phone: string): string {
  const trimmed = email.trim().toLowerCase();
  if (trimmed) return trimmed;
  const digits = phone.replace(/\D/g, "");
  return `phone+${digits}@customers.mortgagehub.local`;
}
