import {
  DEFAULT_THEME_PROFILE,
  isThemeProfileId,
  THEME_STORAGE_KEY,
  type ThemeProfileId,
} from "@/lib/theme-profiles";

export function getStoredThemeProfile(): ThemeProfileId {
  if (typeof window === "undefined") return DEFAULT_THEME_PROFILE;
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw && isThemeProfileId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME_PROFILE;
}

export function applyThemeProfile(id: ThemeProfileId): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", id);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

/** Call once on client boot (before paint if possible). */
export function initThemeProfile(): ThemeProfileId {
  const id = getStoredThemeProfile();
  applyThemeProfile(id);
  return id;
}

/** Future multi-tenant: pass firm.theme_profile_id from server instead of localStorage. */
export function applyTenantThemeProfile(id: ThemeProfileId | string | null | undefined): ThemeProfileId {
  const resolved =
    id && typeof id === "string" && isThemeProfileId(id) ? id : DEFAULT_THEME_PROFILE;
  applyThemeProfile(resolved);
  return resolved;
}
