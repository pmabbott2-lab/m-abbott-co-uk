import { createContext, useContext, type ReactNode } from "react";
import type { TenantPresentation } from "@/lib/tenant-presentation";

const TenantUiContext = createContext<TenantPresentation | null>(null);

export function TenantUiProvider({
  value,
  children,
}: {
  value: TenantPresentation;
  children: ReactNode;
}) {
  return <TenantUiContext.Provider value={value}>{children}</TenantUiContext.Provider>;
}

/** Current URL tenant presentation, or null on platform root / non-tenant routes. */
export function useTenantUi(): TenantPresentation | null {
  return useContext(TenantUiContext);
}

export function useRequiredTenantUi(): TenantPresentation {
  const t = useTenantUi();
  if (!t) {
    throw new Error("Tenant UI context is required on this route.");
  }
  return t;
}
