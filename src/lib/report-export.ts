import type { ExportSheet } from "@/lib/report-export.types";

function cell(v: string | number | null | undefined): string {
  if (v == null) return "";
  return String(v);
}

export async function downloadExcel(filename: string, sheets: ExportSheet[]): Promise<void> {
  if (typeof window === "undefined") return;
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const data = [sheet.headers, ...sheet.rows.map((row) => row.map(cell))];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export async function downloadPdf(
  filename: string,
  title: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
): Promise<void> {
  if (typeof window === "undefined") return;
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const landscape = headers.length > 6;
  const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
  doc.setFontSize(14);
  doc.text(title, 14, 14);
  autoTable(doc, {
    head: [headers],
    body: rows.map((row) => row.map(cell)),
    startY: 20,
    styles: { fontSize: landscape ? 7 : 8, cellPadding: 1.5 },
    headStyles: { fillColor: [40, 40, 40] },
  });
  doc.save(`${filename}.pdf`);
}

export async function downloadPdfWorkbook(
  filename: string,
  sections: { title: string; headers: string[]; rows: (string | number | null | undefined)[][] }[],
): Promise<void> {
  if (typeof window === "undefined") return;
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const landscape = sections.some((s) => s.headers.length > 6);
  const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (i > 0) doc.addPage();
    doc.setFontSize(12);
    doc.text(section.title, 14, 14);
    autoTable(doc, {
      head: [section.headers],
      body: section.rows.map((row) => row.map(cell)),
      startY: 20,
      styles: { fontSize: landscape ? 7 : 8, cellPadding: 1.5 },
      headStyles: { fillColor: [40, 40, 40] },
    });
  }
  doc.save(`${filename}.pdf`);
}
