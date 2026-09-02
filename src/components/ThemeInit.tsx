import { useEffect } from "react";
import { initThemeProfile } from "@/lib/theme";

/** Client-only theme init — avoids inline script issues in the document head. */
export function ThemeInit() {
  useEffect(() => {
    initThemeProfile();
  }, []);
  return null;
}
