import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Scrollable table/list body showing roughly `visibleRows` data rows (default 10). */
export function ReportTableScroll({
  children,
  visibleRows = 10,
  className,
}: {
  children: ReactNode;
  visibleRows?: number;
  className?: string;
}) {
  const maxHeight = 44 + visibleRows * 44;
  return (
    <div
      className={cn(
        "overflow-auto rounded-lg border [-webkit-overflow-scrolling:touch]",
        className,
      )}
      style={{ maxHeight }}
    >
      {children}
    </div>
  );
}
