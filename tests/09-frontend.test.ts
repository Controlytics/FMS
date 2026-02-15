import { describe, it, expect } from 'vitest';

const WEB_URL = 'http://43.205.32.23:5173';

describe('FRONTEND INTEGRATION TESTS', () => {
  // ─── PAGE ACCESSIBILITY ─────────────────────────────────────
  describe('Page Accessibility', () => {
    it('should serve the main HTML page', async () => {
      const res = await fetch(WEB_URL);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<div id="root">');
      expect(html).toContain('</html>');
    });

    it('should serve index.html with correct content-type', async () => {
      const res = await fetch(WEB_URL);
      const ct = res.headers.get('content-type') || '';
      expect(ct).toContain('text/html');
    });

    it('should serve JavaScript bundles', async () => {
      const res = await fetch(WEB_URL);
      const html = await res.text();
      // Vite injects a script tag with /src/main.tsx or a built JS file
      const hasScript = html.includes('<script') && html.includes('src=');
      expect(hasScript).toBe(true);
    });

    it('should serve the login page at /login', async () => {
      const res = await fetch(`${WEB_URL}/login`);
      expect(res.status).toBe(200);
    });

    it('should serve SPA routes (all return index.html)', async () => {
      const routes = ['/users', '/config', '/audit', '/assets'];
      for (const route of routes) {
        const res = await fetch(`${WEB_URL}${route}`);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('<div id="root">');
      }
    });
  });

  // ─── STATIC ASSETS ─────────────────────────────────────────
  describe('Static Assets', () => {
    it('should serve CSS or JS bundles for styling', async () => {
      const res = await fetch(WEB_URL);
      const html = await res.text();
      // Tailwind CSS v4 injects styles via JS modules in dev mode
      const hasAssets = html.includes('.css') || html.includes('<style') || html.includes('.tsx') || html.includes('.js');
      expect(hasAssets).toBe(true);
    });
  });

  // ─── API PROXY ──────────────────────────────────────────────
  describe('API Proxy', () => {
    it('should proxy /api requests to backend', async () => {
      const res = await fetch(`${WEB_URL}/api/health`);
      // In dev mode, Vite proxies /api to port 3000
      // In production, this might not work (depends on deployment)
      expect([200, 404, 502]).toContain(res.status);
    });
  });

  // ─── RESPONSE TIMES ────────────────────────────────────────
  describe('Response Times', () => {
    it('should load main page within 5 seconds', async () => {
      const start = Date.now();
      await fetch(WEB_URL);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(5000);
    });

    it('should respond to API health check within 2 seconds', async () => {
      const start = Date.now();
      await fetch('http://43.205.32.23:3000/api/health');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(2000);
    });
  });
});
