import { createContext, useContext, type ReactNode } from "react";
import type { PlatformAuthorityView } from "@/lib/platform-authority";
import { deniedPlatformAuthority } from "@/lib/platform-authority";

const PlatformAuthorityContext = createContext<PlatformAuthorityView | null>(null);

export function PlatformAuthorityProvider({
  value,
  children,
}: {
  value: PlatformAuthorityView;
  children: ReactNode;
}) {
  return (
    <PlatformAuthorityContext.Provider value={value}>{children}</PlatformAuthorityContext.Provider>
  );
}

export function usePlatformAuthority(): PlatformAuthorityView {
  return useContext(PlatformAuthorityContext) ?? deniedPlatformAuthority();
}
