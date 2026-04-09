import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Brand colors
const COLORS = {
  primary: [30, 58, 95] as [number, number, number],       // #1e3a5f
  secondary: [59, 130, 246] as [number, number, number],    // #3b82f6
  accent: [139, 92, 246] as [number, number, number],       // #8b5cf6
  dark: [15, 23, 42] as [number, number, number],           // #0f172a
  text: [30, 41, 59] as [number, number, number],           // #1e293b
  muted: [100, 116, 139] as [number, number, number],       // #64748b
  light: [148, 163, 184] as [number, number, number],       // #94a3b8
  border: [226, 232, 240] as [number, number, number],      // #e2e8f0
  headerBg: [241, 245, 249] as [number, number, number],    // #f1f5f9
  altRow: [248, 250, 252] as [number, number, number],      // #f8fafc
  green: [21, 128, 61] as [number, number, number],
  blue: [29, 78, 216] as [number, number, number],
  red: [220, 38, 38] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

let cachedLogo: { data: string; w: number; h: number } | null = null;

async function loadLogo(): Promise<{ data: string; w: number; h: number } | null> {
  if (cachedLogo) return cachedLogo;
  try {
    const res = await fetch('/api/config/branding');
    const branding = await res.json();
    const logoUrl = branding?.logoUrl || '/logo.jpg';
    const imgRes = await fetch(logoUrl);
    if (!imgRes.ok) return null;
    const blob = await imgRes.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject();
      reader.readAsDataURL(blob);
    });
    // Get natural dimensions to preserve aspect ratio
    const dims: { w: number; h: number } = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 1, h: 1 });
      img.src = dataUrl;
    });
    cachedLogo = { data: dataUrl, w: dims.w, h: dims.h };
    return cachedLogo;
  } catch { return null; }
}

async function loadBranding(): Promise<{ companyName: string; appName: string }> {
  try {
    const res = await fetch('/api/config/branding');
    const data = await res.json();
    return { companyName: data?.companyName || 'Controlytics AI Pvt Ltd', appName: data?.appName || 'DigiLog' };
  } catch {
    return { companyName: 'Controlytics AI Pvt Ltd', appName: 'DigiLog' };
  }
}

export interface ReportConfig {
  title: string;
  subtitle?: string;
  orientation?: 'portrait' | 'landscape';
  formatDateTime: (d: string) => string;
}

export interface ReportDoc {
  doc: jsPDF;
  y: number;
  pw: number;
  ph: number;
  colors: typeof COLORS;
  addTable: (opts: {
    head: string[];
    body: string[][];
    columnStyles?: Record<number, any>;
    headColor?: [number, number, number];
  }) => void;
  addSectionTitle: (text: string) => void;
  addKeyValue: (pairs: [string, string][], columns?: number) => void;
  checkPageBreak: (needed: number) => void;
  save: (filename: string) => void;
}

export async function createReport(config: ReportConfig): Promise<ReportDoc> {
  const [logo, branding] = await Promise.all([loadLogo(), loadBranding()]);
  const doc = new jsPDF({ orientation: config.orientation ?? 'portrait', unit: 'mm', format: 'a4' });
  const pw = doc.internal.pageSize.width;
  const ph = doc.internal.pageSize.height;
  let y = 10;

  // ── Top accent line ──
  doc.setFillColor(...COLORS.secondary);
  doc.rect(0, 0, pw, 2, 'F');

  y = 6;

  // ── Logo (aspect-ratio preserved, max 12mm tall) ──
  const maxLogoH = 12;
  let logoEndX = 14;
  if (logo) {
    try {
      const aspect = logo.w / logo.h;
      const logoH = maxLogoH;
      const logoW = logoH * aspect;
      doc.addImage(logo.data, 'JPEG', 14, y, logoW, logoH);
      logoEndX = 14 + logoW + 4;
    } catch { /* skip */ }
  }

  // ── Company name + app tagline ──
  doc.setFontSize(13); doc.setTextColor(...COLORS.primary);
  doc.text(branding.companyName, logoEndX, y + 5);
  doc.setFontSize(7.5); doc.setTextColor(...COLORS.muted);
  doc.text(branding.appName + ' - Digital Filter Management System', logoEndX, y + 10);

  y += maxLogoH + 4;

  // ── Report title bar ──
  doc.setFillColor(...COLORS.primary);
  doc.rect(14, y, pw - 28, 8, 'F');
  doc.setFontSize(10); doc.setTextColor(...COLORS.white);
  doc.text(config.title, 18, y + 5.5);

  // Generated timestamp on right
  doc.setFontSize(7); doc.setTextColor(200, 210, 225);
  doc.text(config.formatDateTime(new Date().toISOString()), pw - 14, y + 5.5, { align: 'right' });

  y += 12;

  // ── Subtitle / filters info ──
  if (config.subtitle) {
    doc.setFontSize(8); doc.setTextColor(...COLORS.muted);
    const lines = doc.splitTextToSize(config.subtitle, pw - 28);
    doc.text(lines, 14, y);
    y += lines.length * 4 + 2;
  }

  // Thin separator
  doc.setDrawColor(...COLORS.border); doc.setLineWidth(0.3);
  doc.line(14, y, pw - 14, y); y += 4;

  const addFooters = () => {
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      // Footer line
      doc.setDrawColor(...COLORS.border); doc.setLineWidth(0.3);
      doc.line(14, ph - 12, pw - 14, ph - 12);
      // Footer text
      doc.setFontSize(7); doc.setTextColor(...COLORS.light);
      doc.text(`${branding.companyName}  |  ${branding.appName}`, 14, ph - 7);
      doc.text(`Page ${i} of ${pageCount}`, pw - 30, ph - 7);
    }
  };

  const checkPageBreak = (needed: number) => {
    if (y + needed > ph - 18) { doc.addPage(); y = 14; }
  };

  const addSectionTitle = (text: string) => {
    checkPageBreak(10);
    doc.setFillColor(...COLORS.headerBg);
    doc.roundedRect(14, y - 1, pw - 28, 7, 1, 1, 'F');
    doc.setFontSize(9); doc.setTextColor(...COLORS.primary);
    doc.text(text, 17, y + 4);
    y += 10;
  };

  const addTable = (opts: { head: string[]; body: string[][]; columnStyles?: Record<number, any>; headColor?: [number, number, number] }) => {
    checkPageBreak(20);
    autoTable(doc, {
      startY: y,
      head: [opts.head],
      body: opts.body,
      theme: 'grid',
      styles: { fontSize: 7, cellPadding: 2.5, lineColor: COLORS.border, lineWidth: 0.2, textColor: COLORS.text, overflow: 'linebreak' },
      headStyles: { fillColor: opts.headColor ?? COLORS.primary, textColor: COLORS.white, fontStyle: 'bold', fontSize: 7.5 },
      alternateRowStyles: { fillColor: COLORS.altRow },
      columnStyles: opts.columnStyles ?? {},
    });
    y = (doc as any).lastAutoTable.finalY + 5;
  };

  const addKeyValue = (pairs: [string, string][], columns = 3) => {
    checkPageBreak(12);
    const colW = (pw - 28) / columns;
    let row = 0;
    for (let i = 0; i < pairs.length; i++) {
      const col = i % columns;
      if (col === 0 && i > 0) { row++; y += 9; }
      if (col === 0) checkPageBreak(10);
      const x = 14 + col * colW;
      doc.setFontSize(7); doc.setTextColor(...COLORS.muted);
      doc.text(pairs[i][0], x, y);
      doc.setFontSize(9); doc.setTextColor(...COLORS.text);
      doc.text(pairs[i][1] || '-', x, y + 4);
    }
    y += 12;
  };

  return {
    doc, get y() { return y; }, set y(v) { y = v; },
    pw, ph, colors: COLORS,
    addTable, addSectionTitle, addKeyValue, checkPageBreak,
    save: (filename: string) => { addFooters(); doc.save(filename); },
  };
}
