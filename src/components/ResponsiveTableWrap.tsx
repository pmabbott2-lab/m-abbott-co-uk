import type { ReactNode } from "react";

/** Keeps wide tables scrollable on tablet without breaking page layout. */
export function ResponsiveTableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <div className="overflow-x-auto max-w-full [-webkit-overflow-scrolling:touch]">
        <div className="min-w-[640px]">{children}</div>
      </div>
    </div>
  );
}
