/**
 * Shared SSRF guard for outbound calls to admin-configured URLs.
 *
 * Security assessment 2026-08-17, finding SAST-01: the instrument auto-fetch
 * blocked SSRF properly, but the SMS/email notification channels — which also
 * call admin-typed URLs — did not reuse that protection. One hardened path and
 * one unhardened path is the classic way a guard rots: the next person copies
 * whichever they find first. This module is the single implementation; callers
 * differ only in method/headers/body.
 *
 * Threat model: an admin (or anyone who can reach an admin-config endpoint) sets
 * a URL the SERVER will fetch. Without a guard that URL can point at loopback,
 * at link-local 169.254.169.254 (cloud metadata), or be redirected there — using
 * the server as a proxy into things the network otherwise protects.
 *
 * Policy (matches the original instrument-fetch rules deliberately):
 *   - scheme allowlist: http/https only
 *   - DNS-resolve the host and reject if ANY resolved address is blocked, which
 *     closes DNS-rebinding-by-multiple-A-records
 *   - block loopback, link-local (incl. cloud metadata), unspecified/this-network
 *   - ALLOW private LAN (10/8, 172.16/12, 192.168/16): cleanroom instruments and
 *     on-prem SMS gateways legitimately live there
 *   - never follow redirects (a 302 to 169.254.169.254 is the classic bypass)
 *   - hard timeout
 */
import { lookup } from 'node:dns/promises';

export const DEFAULT_TIMEOUT_MS = 5000;

/**
 * True for addresses we refuse to connect to even when an admin typed the URL:
 * loopback, link-local (covers the 169.254.169.254 metadata endpoint), and the
 * unspecified/this-network address. Private LAN ranges are allowed.
 */
export function isBlockedAddress(ip: string, family: number): boolean {
  if (family === 4 || ip.includes('.')) {
    const v4 = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
    const parts = v4.split('.').map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true; // unparseable → block
    const [a, b] = parts;
    if (a === 127) return true; // loopback 127.0.0.0/8
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16 (incl. metadata)
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fe80') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true; // link-local fe80::/10
  }
  return false;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/** Validate scheme + resolved destination. Never throws. */
export async function checkOutboundUrl(rawUrl: string | null | undefined): Promise<UrlCheck> {
  if (!rawUrl || !rawUrl.trim()) return { ok: false, error: 'No URL configured' };

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'URL must use http or https' };
  }

  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(url.hostname, { all: true });
  } catch {
    return { ok: false, error: 'DNS resolution failed' };
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a.address, a.family))) {
    return { ok: false, error: 'Destination address not allowed' };
  }
  return { ok: true, url };
}

/**
 * `fetch` with the SSRF guard applied: destination checked, redirects refused,
 * hard timeout. Throws a plain Error when the destination is not allowed so
 * callers that already have try/catch error reporting surface it normally.
 */
export async function hardenedFetch(
  rawUrl: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const check = await checkOutboundUrl(rawUrl);
  if (!check.ok) throw new Error(`Blocked outbound request: ${check.error}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(check.url.toString(), {
      ...init,
      redirect: 'error', // a redirect aborts the call (SSRF defense)
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
