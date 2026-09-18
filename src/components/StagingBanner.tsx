import { shouldShowStagingBanner, stagingBannerLabel } from "@/lib/app-environment";

/** Persistent non-production indicator. Hidden when APP_ENV/VITE_APP_ENV is production. */
export function StagingBanner() {
  if (!shouldShowStagingBanner()) return null;
  const label = stagingBannerLabel();
  return (
    <div
      role="status"
      className="sticky top-0 z-[60] w-full bg-amber-600 text-amber-950 text-center text-xs sm:text-sm font-semibold tracking-wide py-1 px-3"
    >
      {label} · TEST ENVIRONMENT · Do not use for live customers
    </div>
  );
}
