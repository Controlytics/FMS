import puppeteer, { type Browser } from 'puppeteer-core';
import { detectEdgePath } from './edge-detector.js';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      executablePath: detectEdgePath(),
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
  }
  return browser;
}

interface PdfOptions {
  pageSize: string;
  orientation: string;
  margins: { top: number; right: number; bottom: number; left: number };
}

export async function renderPdf(html: string, options: PdfOptions): Promise<Buffer> {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    // May 16 H21 tuning (2026-05-20): was 'networkidle0' which forces a 500ms
    // idle window even when no network requests are pending. Phase 5 swapped
    // chart rendering from chartjs-node-canvas to inline @napi-rs/canvas
    // data URIs — there are NO network requests during setContent. 'load'
    // returns as soon as the synchronous parse + style + paint completes,
    // saving the 500ms penalty on every report.
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });

    const pdfUint8 = await page.pdf({
      format: (options.pageSize || 'A4') as never,
      landscape: options.orientation === 'landscape',
      margin: {
        top: `${options.margins.top ?? 20}mm`,
        right: `${options.margins.right ?? 15}mm`,
        bottom: `${options.margins.bottom ?? 20}mm`,
        left: `${options.margins.left ?? 15}mm`,
      },
      printBackground: true,
    });

    return Buffer.from(pdfUint8);
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
