/**
 * Rate-limit key derivation — IPv6-aware.
 *
 * Security assessment 2026-08-17, finding DEP-5: "@fastify/rate-limit counts per
 * exact IP; an IPv6 attacker has billions of addresses and can dodge the limit."
 *
 * That is the real defect and it is OURS, not just the library's: every
 * `keyGenerator` in this codebase was `(req) => req.ip`, which buckets per exact
 * address. A single residential IPv6 allocation is a /64 — 18 quintillion
 * addresses — so an attacker rotating the host portion gets a brand-new
 * brute-force budget on every request while the limiter reports healthy. IPv4
 * has no equivalent escape hatch, which is why this went unnoticed.
 *
 * Fix: bucket IPv6 by its /64 network prefix (the smallest block a single
 * subscriber is normally delegated), keep IPv4 exact. Upgrading the library
 * alone would not fix an explicit per-IP keyGenerator, so this must live here.
 *
 * Deliberately NOT narrower than /64: going to /48 or /32 would let one abusive
 * subscriber lock out an entire ISP's customers.
 */
import { isIPv4, isIPv6 } from 'node:net';

/** Expand an IPv6 address to its 8 full hextets. Returns null if unparseable. */
function expandIPv6(ip: string): string[] | null {
  // Drop any zone index (fe80::1%eth0) before parsing.
  const bare = ip.split('%')[0];
  const halves = bare.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];

  // A trailing IPv4 form (::ffff:1.2.3.4) is handled by the caller; if one
  // reaches here, refuse rather than mis-bucket it.
  if ([...head, ...tail].some((h) => h.includes('.'))) return null;

  const missing = 8 - (head.length + tail.length);
  if (halves.length === 2) {
    if (missing < 0) return null;
    return [...head, ...Array(missing).fill('0'), ...tail];
  }
  if (head.length !== 8) return null;
  return head;
}

/**
 * The bucket an address is counted against.
 * - IPv4 (incl. IPv4-mapped IPv6 `::ffff:a.b.c.d`) → the exact address.
 * - IPv6 → the /64 network prefix, so host-portion rotation cannot dodge the limit.
 * - Anything unparseable → returned as-is, so a weird value still gets *a* bucket
 *   rather than silently collapsing every caller into one shared key.
 */
export function rateLimitBucket(ip: string | undefined | null): string {
  if (!ip) return 'unknown';
  const addr = ip.trim();
  if (!addr) return 'unknown';

  if (isIPv4(addr)) return addr;

  // IPv4-mapped IPv6 — the real client is IPv4, so bucket it exactly.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  if (mapped && isIPv4(mapped[1])) return mapped[1];

  if (isIPv6(addr)) {
    const hextets = expandIPv6(addr);
    if (hextets) {
      // /64 == the first 4 hextets. Normalize each so 0000/0/00 all agree.
      return hextets.slice(0, 4).map((h) => parseInt(h || '0', 16).toString(16)).join(':') + '::/64';
    }
  }
  return addr;
}

/** Drop-in `keyGenerator` for @fastify/rate-limit. */
export function rateLimitKeyGenerator(req: { ip?: string }): string {
  return rateLimitBucket(req.ip);
}
