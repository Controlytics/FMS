import puppeteer, { type Browser } from 'puppeteer';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
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
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 });

    const pdfUint8 = await page.pdf({
      format: (options.pageSize || 'A4') as any,
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
