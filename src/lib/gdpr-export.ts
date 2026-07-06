import type { GdprHistoryExport } from "@/lib/telephony.functions";
import { format } from "date-fns";

function wrapText(doc: import("jspdf").jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  for (const line of lines) {
    if (y > 280) {
      doc.addPage();
      y = 16;
    }
    doc.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

export async function downloadGdprHistoryPdf(exportData: GdprHistoryExport): Promise<void> {
  if (typeof window === "undefined") return;
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  const width = 210 - margin * 2;
  let y = 16;

  doc.setFontSize(16);
  doc.text("Customer data export (GDPR)", margin, y);
  y += 10;
  doc.setFontSize(10);
  y = wrapText(
    doc,
    `Customer: ${exportData.customerName}${exportData.customerEmail ? ` · ${exportData.customerEmail}` : ""}`,
    margin,
    y,
    width,
    5,
  );
  y = wrapText(doc, `Session: ${exportData.sessionId}`, margin, y, width, 5);
  y = wrapText(doc, `Exported: ${format(new Date(exportData.exportedAt), "PPpp")}`, margin, y, width, 5);
  y += 4;

  doc.setFontSize(12);
  doc.text("History timeline", margin, y);
  y += 7;
  doc.setFontSize(9);

  for (const e of [...exportData.entries].reverse()) {
    const when = format(new Date(e.occurredAt), "PPpp");
    y = wrapText(doc, `${when} · ${e.type}`, margin, y, width, 4.5);
    if (e.body) y = wrapText(doc, e.body, margin + 4, y, width - 4, 4.5);
    y += 2;
  }

  if (exportData.calls.length > 0) {
    y += 4;
    if (y > 250) {
      doc.addPage();
      y = 16;
    }
    doc.setFontSize(12);
    doc.text("Phone call attachments", margin, y);
    y += 7;
    doc.setFontSize(9);

    for (const call of exportData.calls) {
      if (y > 240) {
        doc.addPage();
        y = 16;
      }
      y = wrapText(
        doc,
        `Call ${format(new Date(call.startedAt), "PPpp")} · ${call.toNumber} · ${call.status}`,
        margin,
        y,
        width,
        4.5,
      );
      if (call.advisorName) y = wrapText(doc, `Advisor: ${call.advisorName}`, margin + 4, y, width - 4, 4.5);
      if (call.summary) {
        doc.setFont("helvetica", "bold");
        y = wrapText(doc, "Summary", margin + 4, y, width - 4, 4.5);
        doc.setFont("helvetica", "normal");
        y = wrapText(doc, call.summary, margin + 4, y, width - 4, 4.5);
      }
      if (call.transcript) {
        doc.setFont("helvetica", "bold");
        y = wrapText(doc, "Transcript", margin + 4, y, width - 4, 4.5);
        doc.setFont("helvetica", "normal");
        y = wrapText(doc, call.transcript, margin + 4, y, width - 4, 4.5);
      }
      y += 4;
    }
  }

  const safeName = exportData.customerName.replace(/[^\w.-]+/g, "_").slice(0, 40);
  doc.save(`gdpr-export-${safeName}-${format(new Date(), "yyyy-MM-dd")}.pdf`);
}
