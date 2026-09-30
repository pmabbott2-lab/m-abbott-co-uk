/** Auth email for customers without an address — phone-only bookings. */
export function emailForCustomerAccount(email: string, phone: string): string {
  const trimmed = email.trim().toLowerCase();
  if (trimmed) return trimmed;
  return syntheticCustomerAuthEmail(phone);
}

export const SYNTHETIC_CUSTOMER_EMAIL_DOMAIN = "customers.mortgagehub.local";

/** app_metadata.mh_identity marker for Auth users created by appointment signup. */
export const APPOINTMENT_CUSTOMER_IDENTITY = "appointment_customer";

/** Phone-derived Auth email: never proves ownership of any real mailbox. */
export function syntheticCustomerAuthEmail(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `phone+${digits}@${SYNTHETIC_CUSTOMER_EMAIL_DOMAIN}`;
}

export function isSyntheticCustomerAuthEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase().endsWith(`@${SYNTHETIC_CUSTOMER_EMAIL_DOMAIN}`);
}
