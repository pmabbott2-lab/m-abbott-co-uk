import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ReportExportBox } from "@/components/ReportExportBox";
import { exportOwnerCustomerReport } from "@/lib/sessions.functions";
import { customerReportToSheet } from "@/lib/report-mappers";

/** Owner-only export of all customers with fees and commission totals. */
export function OwnerCustomerExportBox() {
  const exportFn = useServerFn(exportOwnerCustomerReport);
  const reportQ = useQuery({
    queryKey: ["owner-customer-export"],
    queryFn: () => exportFn(),
    staleTime: 60_000,
  });

  const rows = reportQ.data?.rows ?? [];
  const sheet = customerReportToSheet(rows);

  return (
    <ReportExportBox
      filename={`customer-report-${new Date().toISOString().slice(0, 10)}`}
      label="Customers"
      sheets={[sheet]}
      pdfTitle="Customer master report"
    />
  );
}
