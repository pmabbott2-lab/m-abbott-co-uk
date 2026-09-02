/** Firm / tenant visual theme profiles — localStorage now; multi-tenant DB later. */

export const THEME_STORAGE_KEY = "mortgage-hub:theme-profile";

export type ThemeProfileId =
  | "mortgage-easy"
  | "classic-hub"
  | "midnight"
  | "forest"
  | "ocean"
  | "slate"
  | "burgundy"
  | "royal"
  | "copper"
  | "arctic";

export type ThemeProfile = {
  id: ThemeProfileId;
  label: string;
  description: string;
  /** Two swatch colours for the picker [primary, accent] */
  swatch: [string, string];
  /** Recommended for MortgageEasy brokerage demo */
  recommended?: boolean;
};

export const THEME_PROFILES: ThemeProfile[] = [
  {
    id: "mortgage-easy",
    label: "MortgageEasy",
    description: "Navy and green — matches the MortgageEasy marketing site.",
    swatch: ["#1a2f4f", "#3d9e47"],
    recommended: true,
  },
  {
    id: "classic-hub",
    label: "Classic Hub",
    description: "Warm cream paper with navy ink and amber accent.",
    swatch: ["#2a3f5f", "#d4a017"],
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Deep navy workspace with cool highlights.",
    swatch: ["#0f172a", "#38bdf8"],
  },
  {
    id: "forest",
    label: "Forest",
    description: "Deep green brokerage — calm and trustworthy.",
    swatch: ["#14532d", "#4ade80"],
  },
  {
    id: "ocean",
    label: "Ocean",
    description: "Teal and blue — modern financial services.",
    swatch: ["#0c4a6e", "#22d3ee"],
  },
  {
    id: "slate",
    label: "Slate",
    description: "Neutral grey corporate — minimal distraction.",
    swatch: ["#334155", "#64748b"],
  },
  {
    id: "burgundy",
    label: "Burgundy",
    description: "Traditional wealth management tones.",
    swatch: ["#4c0519", "#fb7185"],
  },
  {
    id: "royal",
    label: "Royal",
    description: "Indigo and violet — contemporary fintech.",
    swatch: ["#312e81", "#a78bfa"],
  },
  {
    id: "copper",
    label: "Copper",
    description: "Warm bronze and terracotta — approachable advice.",
    swatch: ["#78350f", "#f97316"],
  },
  {
    id: "arctic",
    label: "Arctic",
    description: "Cool light blues — clean and airy.",
    swatch: ["#1e3a8a", "#93c5fd"],
  },
];

export const DEFAULT_THEME_PROFILE: ThemeProfileId =
  (import.meta.env.VITE_DEFAULT_THEME as ThemeProfileId | undefined) ?? "classic-hub";

export function isThemeProfileId(value: string): value is ThemeProfileId {
  return THEME_PROFILES.some((p) => p.id === value);
}

export function getThemeProfileMeta(id: ThemeProfileId): ThemeProfile {
  return THEME_PROFILES.find((p) => p.id === id) ?? THEME_PROFILES[0];
}
