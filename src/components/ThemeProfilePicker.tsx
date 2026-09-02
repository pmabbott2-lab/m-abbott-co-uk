import { useEffect, useState } from "react";
import { Check, Palette } from "lucide-react";
import { THEME_PROFILES, type ThemeProfileId } from "@/lib/theme-profiles";
import { applyThemeProfile, getStoredThemeProfile } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ThemeProfilePickerProps = {
  /** Compact grid for Manage tab; inline for header experiments */
  compact?: boolean;
  className?: string;
};

export function ThemeProfilePicker({ compact = false, className }: ThemeProfilePickerProps) {
  const [active, setActive] = useState<ThemeProfileId>(() =>
    typeof window !== "undefined" ? getStoredThemeProfile() : "classic-hub",
  );

  useEffect(() => {
    setActive(getStoredThemeProfile());
  }, []);

  const select = (id: ThemeProfileId) => {
    applyThemeProfile(id);
    setActive(id);
    const label = THEME_PROFILES.find((p) => p.id === id)?.label ?? id;
    toast.success(`Colour scheme: ${label}`);
  };

  return (
    <section className={cn("rounded-2xl border bg-card p-6 space-y-4", className)}>
      <div className="flex items-start gap-3">
        <Palette className="w-5 h-5 mt-0.5 shrink-0 text-primary" />
        <div className="space-y-1 min-w-0">
          <h3 className="font-medium">Colour scheme</h3>
          <p className="text-sm text-muted-foreground">
            Choose how Mortgage Hub looks for your firm. Saved on this browser — multi-tenant
            deployments will apply one scheme per firm automatically.
          </p>
        </div>
      </div>

      <div
        className={cn(
          "grid gap-3",
          compact ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
        )}
      >
        {THEME_PROFILES.map((profile) => {
          const selected = active === profile.id;
          return (
            <button
              key={profile.id}
              type="button"
              onClick={() => select(profile.id)}
              className={cn(
                "group relative flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition",
                selected
                  ? "border-primary ring-2 ring-primary/25 bg-primary/5"
                  : "border-border hover:border-primary/40 hover:bg-muted/40",
              )}
            >
              <div className="flex w-full gap-1 h-8 rounded-md overflow-hidden shadow-inner">
                <span className="flex-1" style={{ background: profile.swatch[0] }} />
                <span className="flex-1" style={{ background: profile.swatch[1] }} />
              </div>
              <div className="min-w-0 w-full">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold truncate">{profile.label}</span>
                  {profile.recommended && (
                    <span className="text-[10px] uppercase tracking-wide font-medium text-accent-foreground bg-accent px-1.5 py-0.5 rounded">
                      Demo
                    </span>
                  )}
                </div>
                {!compact && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{profile.description}</p>
                )}
              </div>
              {selected && (
                <span className="absolute top-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="w-3 h-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
