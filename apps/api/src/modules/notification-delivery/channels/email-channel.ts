/**
 * Email Channel — Sends emails via SMTP using nodemailer.
 * Supports Basic Auth and OAuth2 (Microsoft Azure AD / Google).
 * Similar to ThingsBoard mail server configuration.
 */

import nodemailer from "nodemailer";
import { isIP } from 'node:net';
import type { EmailConfig, NotificationPayload, DeliveryResult, NotificationChannel as IChannel } from '../types.js';
import { getEmailConfig } from '../config-loader.js';
import { hardenedFetch, checkOutboundHost } from '../../../lib/ssrf.js';  // SAST-01: admin-typed tokenUrl; SEC-08: SMTP host
import { escapeHtml, unescapeHtml } from '../template-engine.js';
import { getLogger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';

/** Log type 6 — the raw SMTP / token-endpoint error lives here, never in a response. */
const mailLog = getLogger('email-channel', 'services');

// nodemailer 10 ships its own types and has no `Transporter` export; the
// transporter is whatever createTransport returns (`Mail`).
type Transporter = ReturnType<typeof nodemailer.createTransport>;
let transporter: Transporter | null = null;
let currentConfigHash = "";

/*
 * SEC-08 / SEC-14, SMTP half (security assessment 2026-10-22).
 *
 * The SMTP host is admin-typed and the server opens a socket to it. It had no
 * destination check, and the raw error ("connect ECONNREFUSED", "Greeting never
 * received", a TLS error) went back to the caller through the test endpoint and
 * into the delivery log — the same port-scan oracle as LDAP test-connection.
 *
 * Now the host is resolved through lib/ssrf.ts before every transport is built
 * (loopback / link-local / unspecified refused, private LAN allowed), and the
 * transport is given the checked ADDRESS, with the typed name kept as the TLS
 * servername. nodemailer does no DNS of its own for an IP literal, so the
 * address that passed the check is the one connected to (no rebinding window).
 *
 * This replaces a custom `dnsLookup` (an IPv4-only lookup "to avoid EC2 IPv6
 * ENETUNREACH") that nodemailer 9 never calls — it resolves hosts itself with
 * resolve4/resolve6 — so that hook was dead code and could not have carried
 * the check. IPv4 is still preferred, now for real.
 */
const MSG_SMTP_BLOCKED = 'SMTP server address is not allowed (loopback and link-local addresses are refused).';
const MSG_SMTP_UNREACHABLE = 'Could not reach the SMTP server. Check the host and port, and that the server is reachable from this machine.';

/** The SMTP host failed the destination check; the message is caller-safe. */
class SmtpDestinationError extends Error {
  constructor(message: string, readonly reason: string) { super(message); }
}
/** A token-endpoint failure; the message is caller-safe (provider text for the
 *  fixed Microsoft / Google endpoints, never a body from an admin-typed URL). */
class OAuth2TokenError extends Error {}

async function resolveSmtpDestination(host: string): Promise<{ host: string; servername?: string }> {
  const dest = await checkOutboundHost(host);
  if (!dest.ok) {
    throw new SmtpDestinationError(
      dest.error === 'Destination address not allowed' ? MSG_SMTP_BLOCKED : MSG_SMTP_UNREACHABLE,
      dest.error,
    );
  }
  const picked = dest.addresses.find((a) => a.family === 4) ?? dest.addresses[0];
  const name = host.trim().replace(/^\[(.*)\]$/, '$1');
  return { host: picked.address, ...(isIP(name) ? {} : { servername: name }) };
}

/** The sentence a caller (test endpoint, delivery log) gets. Never the raw error. */
function describeEmailFailure(err: unknown): string {
  if (err instanceof SmtpDestinationError || err instanceof OAuth2TokenError) return err.message;
  // nodemailer puts the SMTP reply code on protocol errors (EAUTH 535, EENVELOPE
  // 550, …): the configured server WAS reached and spoke SMTP, so the code is
  // reported. Socket / TLS / timeout / DNS errors carry none and get one sentence.
  const responseCode = (err as { responseCode?: unknown } | null)?.responseCode;
  if (typeof responseCode === 'number') return `The SMTP server rejected the request (response code ${responseCode}).`;
  return MSG_SMTP_UNREACHABLE;
}

let cachedOAuthToken: { token: string; expiresAt: number } | null = null;

function configHash(config: EmailConfig): string {
  // #notif-1 fix: include the basic-auth password so a password rotation busts the
  // cached transporter. Without it the hash was unchanged on rotation → getTransporter
  // returned a transporter built with the OLD password and every send failed until an
  // API restart (the basic-auth catch never self-heals). In-memory equality key only,
  // never logged. (oauth2 bypasses this cache entirely, see getTransporter.)
  return `${config.host}:${config.port}:${config.username}:${config.secure}:${config.authType}:${config.clientId ?? ''}:${config.password ?? ''}`;
}

/**
 * Fetch OAuth2 access token from Microsoft Azure AD or Google.
 */
async function fetchOAuth2Token(config: EmailConfig): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedOAuthToken && cachedOAuthToken.expiresAt > Date.now() + 60000) {
    return cachedOAuthToken.token;
  }

  if (config.oauth2Provider === 'microsoft' || config.oauth2Provider === 'office365') {
    const tenantId = config.providerTenantId || 'common';
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    // Check if we have a saved access token from Authorization Code flow
    const savedToken = (config as any).accessToken as string | undefined;
    const savedExpiry = (config as any).tokenExpiresAt as number | undefined;
    const savedRefresh = config.refreshToken;

    if (savedToken && savedExpiry && savedExpiry > Date.now() + 60000) {
      // Use saved access token (still valid)
      cachedOAuthToken = { token: savedToken, expiresAt: savedExpiry };
      return savedToken;
    }

    let body: URLSearchParams;
    if (savedRefresh) {
      // Refresh Token flow (from Authorization Code grant)
      body = new URLSearchParams({
        client_id: config.clientId!,
        client_secret: config.clientSecret!,
        refresh_token: savedRefresh,
        grant_type: 'refresh_token',
        scope: 'offline_access https://outlook.office365.com/SMTP.Send',
      });
    } else {
      // Client Credentials flow (fallback)
      body = new URLSearchParams({
        client_id: config.clientId!,
        client_secret: config.clientSecret!,
        scope: 'https://outlook.office365.com/.default',
        grant_type: 'client_credentials',
      });
    }

    const res = await hardenedFetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString().replace(/%7E/gi, '~'),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new OAuth2TokenError(`Microsoft OAuth2 token error: ${err}`);
    }

    const data = await res.json() as { access_token: string; expires_in: number; refresh_token?: string };
    cachedOAuthToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };

    // Persist new tokens back to DB if we got a refresh token
    if (savedRefresh) {
      // The app's ONE Prisma client (lib/prisma): a client per refresh opened a
      // second connection pool each time (2026-10-23, found when the API suite
      // exhausted Postgres's 100 connections).
      try {
        const dbConfig = await prisma.systemConfig.findUnique({ where: { configKey: 'notification-email' } });
        if (dbConfig) {
          const val = (dbConfig.configValue ?? {}) as Record<string, unknown>;
          val.accessToken = data.access_token;
          val.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
          if (data.refresh_token) val.refreshToken = data.refresh_token;
          await prisma.systemConfig.update({ where: { configKey: 'notification-email' }, data: { configValue: val as any } });
        }
      } catch (err) {
        // Not fatal: this send already holds a valid access token; the next one
        // refreshes again. But never silent - the rotated refresh token is lost.
        mailLog.error({ err }, 'Could not save the rotated OAuth2 tokens to notification-email');
      }
    }

    return data.access_token;

  } else if (config.oauth2Provider === 'google') {
    // Google OAuth2 — Refresh Token flow
    const tokenUrl = 'https://oauth2.googleapis.com/token';

    const body = new URLSearchParams({
      client_id: config.clientId!,
      client_secret: config.clientSecret!,
      refresh_token: config.refreshToken!,
      grant_type: 'refresh_token',
    });

    const res = await hardenedFetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString().replace(/%7E/gi, '~'),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new OAuth2TokenError(`Google OAuth2 token error: ${err}`);
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    cachedOAuthToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };
    return data.access_token;

  } else {
    // Custom OAuth2 provider
    if (!config.tokenUrl) throw new OAuth2TokenError('OAuth2 token URL not configured');

    const body = new URLSearchParams({
      client_id: config.clientId!,
      client_secret: config.clientSecret!,
      grant_type: 'client_credentials',
    });
    if (config.scope) body.set('scope', config.scope);

    const res = await hardenedFetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString().replace(/%7E/gi, '~'),
    });

    if (!res.ok) {
      // The token URL is admin-typed: its response body is logged, not returned —
      // returned, it let any HTTP endpoint on the LAN be read through the test.
      mailLog.warn({ status: res.status, body: (await res.text()).slice(0, 500) }, 'Custom OAuth2 token endpoint refused');
      throw new OAuth2TokenError(`OAuth2 token error: HTTP ${res.status}`);
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    cachedOAuthToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };
    return data.access_token;
  }
}

/** fetchOAuth2Token with every failure as an OAuth2TokenError carrying a caller-safe sentence. */
async function getOAuth2Token(config: EmailConfig): Promise<string> {
  try {
    return await fetchOAuth2Token(config);
  } catch (err) {
    if (err instanceof OAuth2TokenError) throw err;
    mailLog.warn({ err }, 'OAuth2 token request failed');
    const msg = err instanceof Error ? err.message : '';
    // hardenedFetch's refusal is a fixed sentence about OUR policy — kept.
    throw new OAuth2TokenError(msg.startsWith('Blocked outbound request:') ? msg : 'OAuth2 token request failed: could not reach the token endpoint.');
  }
}

async function getTransporter(config: EmailConfig): Promise<Transporter> {
  // Re-checked on every build AND on every reuse: the pinned address is part of
  // the cache key, so a DNS change for the mail server is picked up, and is
  // checked, rather than the old address being used forever.
  const dest = await resolveSmtpDestination(config.host);
  const hash = `${configHash(config)}@${dest.host}`;
  if (transporter && currentConfigHash === hash && config.authType !== 'oauth2') {
    return transporter;
  }

  if (config.authType === 'oauth2') {
    // OAuth2 authentication
    const accessToken = await getOAuth2Token(config);

    transporter = nodemailer.createTransport({
      host: dest.host,
      ...(dest.servername ? { servername: dest.servername } : {}),
      port: config.port,
      secure: config.secure,
      auth: {
        type: 'OAuth2',
        user: config.username,
        accessToken,
      },
      tls: {
        // Secure by default. This was hardcoded `false` in BOTH transporters
        // until 2026-07-15, reading no config at all — so a LAN attacker
        // presenting a forged certificate could harvest the SMTP password /
        // OAuth2 access token and read or modify every outbound mail. Same
        // class as the LDAP TLS default fixed the same day; an explicit
        // opt-out remains for internal servers with self-signed certs.
        rejectUnauthorized: config.tlsRejectUnauthorized ?? true,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    } as any);
  } else {
    // Basic auth (username + password)
    transporter = nodemailer.createTransport({
      host: dest.host,
      ...(dest.servername ? { servername: dest.servername } : {}),
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.username,
        pass: config.password,
      },
      tls: {
        // Secure by default. This was hardcoded `false` in BOTH transporters
        // until 2026-07-15, reading no config at all — so a LAN attacker
        // presenting a forged certificate could harvest the SMTP password /
        // OAuth2 access token and read or modify every outbound mail. Same
        // class as the LDAP TLS default fixed the same day; an explicit
        // opt-out remains for internal servers with self-signed certs.
        rejectUnauthorized: config.tlsRejectUnauthorized ?? true,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    } as any);
  }

  currentConfigHash = hash;
  return transporter;
}

/**
 * Wrap plain text message in a clean HTML email template.
 */
function wrapInHtmlTemplate(subject: string, body: string, isHtml: boolean): string {
  const content = isHtml ? body : body.replace(/\n/g, '<br>');
  // D7 (2026-10-21): the subject is plain text (it is also the Subject header),
  // so it is escaped where it is embedded in HTML. It used to arrive pre-escaped
  // from the template engine, which put `&amp;` / `&lt;` in the Subject header.
  const safeSubject = escapeHtml(subject);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeSubject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <div style="max-width:600px;margin:20px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:24px 32px;">
      <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:600;">DigiLog Notification</h1>
    </div>
    <div style="padding:32px;">
      <h2 style="color:#1e293b;margin:0 0 16px 0;font-size:18px;">${safeSubject}</h2>
      <div style="color:#475569;font-size:14px;line-height:1.7;">
        ${content}
      </div>
    </div>
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
      <p style="color:#94a3b8;font-size:12px;margin:0;text-align:center;">
        This is an automated notification from DigiLog. Do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export const emailChannel: IChannel = {
  name: 'EMAIL',

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    const config = await getEmailConfig();
    if (!config || !config.enabled) {
      return { success: false, error: 'Email notifications are not enabled' };
    }

    try {
      const transport = await getTransporter(config);
      const isHtml = payload.message.includes('<') && payload.message.includes('>');
      const htmlBody = wrapInHtmlTemplate(
        payload.subject ?? 'DigiLog Notification',
        payload.message,
        isHtml,
      );

      const result = await transport.sendMail({
        from: `"${config.fromName}" <${config.fromEmail}>`,
        to: payload.recipient,
        subject: payload.subject ?? 'DigiLog Notification',
        // D7: the text alternative is plain text — no tags, and no entities either.
        text: unescapeHtml(payload.message.replace(/<[^>]*>/g, '')),
        html: htmlBody,
      });

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (err) {
      // Invalidate cached token on auth errors so next attempt gets a fresh one
      if (config.authType === 'oauth2') {
        cachedOAuthToken = null;
        transporter = null;
        currentConfigHash = '';
      }
      mailLog.warn({ err, host: config.host }, 'Email send failed');
      return { success: false, error: describeEmailFailure(err) };
    }
  },

  async testConnection(): Promise<DeliveryResult> {
    const config = await getEmailConfig();
    if (!config || !config.enabled) {
      return { success: false, error: 'Email notifications are not enabled' };
    }

    try {
      if (config.authType === 'oauth2') {
        // Test OAuth2 token fetch first
        await getOAuth2Token(config);
      }
      const transport = await getTransporter(config);
      await transport.verify();
      return { success: true, messageId: 'connection-verified' };
    } catch (err) {
      cachedOAuthToken = null;
      transporter = null;
      currentConfigHash = '';
      mailLog.warn({ err, host: config.host }, 'SMTP connection test failed');
      return { success: false, error: describeEmailFailure(err) };
    }
  },
};
