/** Test accounts — owner-provisioned only. Revoke before deleting profiles. */

export const TEST_ACCOUNT_PHONE = "07123456789";
export const TEST_ACCOUNT_PASSWORD = "TestHub2026!";

export type TestAccountSpec = {
  email: string;
  fullName: string;
  role: "introducer" | "advisor" | "customer";
};

export const TEST_ACCOUNTS: TestAccountSpec[] = [
  { email: "1@test.co.uk", fullName: "Test Introducer One", role: "introducer" },
  { email: "2@test.co.uk", fullName: "Test Introducer Two", role: "introducer" },
  { email: "3@test.co.uk", fullName: "Test Introducer Three", role: "introducer" },
  { email: "4@test.co.uk", fullName: "Test Advisor Four", role: "advisor" },
  { email: "5@test.co.uk", fullName: "Test Advisor Five", role: "advisor" },
  { email: "6@test.co.uk", fullName: "Test Customer Six", role: "customer" },
  { email: "7@test.co.uk", fullName: "Test Customer Seven", role: "customer" },
  { email: "8@test.co.uk", fullName: "Test Customer Eight", role: "customer" },
  { email: "9@test.co.uk", fullName: "Test Customer Nine", role: "customer" },
  { email: "10@test.co.uk", fullName: "Test Customer Ten", role: "customer" },
  { email: "11@test.co.uk", fullName: "Test Customer Eleven", role: "customer" },
  { email: "12@test.co.uk", fullName: "Test Customer Twelve", role: "customer" },
];

export function isTestAccountEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const norm = email.trim().toLowerCase();
  return TEST_ACCOUNTS.some((a) => a.email === norm);
}
