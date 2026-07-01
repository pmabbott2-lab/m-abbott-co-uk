import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = Database["public"]["Enums"]["app_role"];

/** Advisors and admins must use an authenticator app (TOTP). */
export function requiresAuthenticatorMfa(roles: AppRole[]): boolean {
  return roles.includes("advisor") || roles.includes("admin");
}

/** Customers and introducers verify each login with an SMS code. */
export function requiresSmsLoginVerification(roles: AppRole[]): boolean {
  return !requiresAuthenticatorMfa(roles);
}

export async function fetchUserRoles(userId: string): Promise<AppRole[]> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) {
    console.error("fetchUserRoles", error);
    return [];
  }
  return (data ?? []).map((r) => r.role);
}
