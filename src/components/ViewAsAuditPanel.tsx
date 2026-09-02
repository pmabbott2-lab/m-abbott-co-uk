import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { listViewAsAuditLog } from "@/lib/view-as-audit.functions";
import { ReportExportBox } from "@/components/ReportExportBox";
import { ReportTableScroll } from "@/components/ReportTableScroll";
import { viewAsAuditToSheet } from "@/lib/report-mappers";

type ViewAsAuditPanelProps = {
  viewType: "advisor" | "introducer" | "customer";
  targetUserId?: string;
  title?: string;
};

export function ViewAsAuditPanel({
  viewType,
  targetUserId,
  title = "View-as audit log",
}: ViewAsAuditPanelProps) {
  const listFn = useServerFn(listViewAsAuditLog);
  const auditQ = useQuery({
    queryKey: ["view-as-audit", viewType, targetUserId],
    queryFn: () =>
      listFn({
        data: {
          viewType,
          targetUserId,
        },
      }),
  });

  const rows = auditQ.data ?? [];
  const sheet = viewAsAuditToSheet(rows);

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-sm">{title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Changes and actions made while viewing as this {viewType}. Latest entries shown.
        </p>
      </div>
      <ReportTableScroll visibleRows={5}>
        <ul className="text-xs divide-y">
          {auditQ.isLoading && (
            <li className="p-2.5 text-muted-foreground">Loading audit log…</li>
          )}
          {!auditQ.isLoading && rows.length === 0 && (
            <li className="p-2.5 text-muted-foreground">No audit entries yet.</li>
          )}
          {rows.slice(0, 100).map((a) => (
            <li key={a.id} className="p-2.5 text-muted-foreground">
              <span className="text-foreground font-medium">
                {format(new Date(a.created_at), "d MMM yyyy HH:mm")}
              </span>
              {" · "}
              {a.summary}
            </li>
          ))}
        </ul>
      </ReportTableScroll>
      <ReportExportBox
        filename={`${viewType}-view-audit-${new Date().toISOString().slice(0, 10)}`}
        label="Export audit"
        sheets={[sheet]}
        pdfSections={[{ title: `${viewType} view audit`, headers: sheet.headers, rows: sheet.rows }]}
      />
    </div>
  );
}
