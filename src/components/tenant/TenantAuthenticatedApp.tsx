import type { ReactNode } from "react";
import { PhoneCaptureGate } from "@/components/PhoneCaptureGate";
import { TenantAuthenticatedGate } from "@/components/tenant/TenantAuthenticatedGate";

/** Membership + phone capture wrapper for tenant-scoped authenticated app pages. */
export function TenantAuthenticatedApp({ children }: { children: ReactNode }) {
  return (
    <TenantAuthenticatedGate>
      <PhoneCaptureGate>{children}</PhoneCaptureGate>
    </TenantAuthenticatedGate>
  );
}
