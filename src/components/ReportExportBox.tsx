import { useState } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExportSheet } from "@/lib/report-export.types";
import {
  downloadExcel,
  downloadPdf,
  downloadPdfWorkbook,
} from "@/lib/report-export";
import { toast } from "sonner";

type PdfSection = {
  title: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
};

export type ReportExportBoxProps = {
  filename: string;
  label?: string;
  sheets: ExportSheet[];
  pdfTitle?: string;
  pdfSections?: PdfSection[];
};

/** Compact export control — top-left box with Excel and PDF downloads. */
export function ReportExportBox({
  filename,
  label = "Export",
  sheets,
  pdfTitle,
  pdfSections,
}: ReportExportBoxProps) {
  const [busy, setBusy] = useState<"excel" | "pdf" | null>(null);

  const run = async (kind: "excel" | "pdf") => {
    if (sheets.every((s) => s.rows.length === 0)) {
      toast.error("Nothing to export yet.");
      return;
    }
    setBusy(kind);
    try {
      if (kind === "excel") {
        await downloadExcel(filename, sheets);
        toast.success("Excel report downloaded");
      } else if (pdfSections && pdfSections.length > 0) {
        await downloadPdfWorkbook(filename, pdfSections);
        toast.success("PDF report downloaded");
      } else {
        const primary = sheets[0];
        await downloadPdf(filename, pdfTitle ?? label, primary.headers, primary.rows);
        toast.success("PDF report downloaded");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="inline-flex flex-col gap-1.5 rounded-lg border bg-card p-2 shadow-sm text-left w-[9.5rem] shrink-0">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground px-0.5">
        <Download className="w-3.5 h-3.5" />
        {label}
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-8 justify-start text-xs px-2"
        disabled={busy !== null}
        onClick={() => void run("excel")}
      >
        <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5 shrink-0" />
        {busy === "excel" ? "…" : "Excel"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 justify-start text-xs px-2"
        disabled={busy !== null}
        onClick={() => void run("pdf")}
      >
        <FileText className="w-3.5 h-3.5 mr-1.5 shrink-0" />
        {busy === "pdf" ? "…" : "PDF"}
      </Button>
    </div>
  );
}
