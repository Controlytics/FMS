/**
 * SMS Channel — Sends SMS via multiple providers (Twilio, AWS SNS, Vonage, HTTP Gateway).
 */

import type { SmsConfig, NotificationPayload, DeliveryResult, NotificationChannel as IChannel } from '../types.js';
import { getSmsConfig } from '../config-loader.js';

/**
 * Normalize phone number by adding country code if missing.
 */
function normalizePhone(phone: string, defaultCountryCode?: string): string {
  let normalized = phone.replace(/[\s\-()]/g, '');
  if (!normalized.startsWith('+')) {
    const code = defaultCountryCode ?? '+91';
    normalized = code.startsWith('+') ? `${code}${normalized}` : `+${code}${normalized}`;
  }
  return normalized;
}

/**
 * Validate phone number format (basic E.164 check).
 */
function isValidPhone(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

async function sendViaTwilio(config: SmsConfig, to: string, message: string): Promise<DeliveryResult> {
  const { twilioAccountSid, twilioAuthToken, twilioFromNumber } = config;
  if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber) {
    return { success: false, error: 'Twilio credentials not configured' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
  const auth = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');

  const body = new URLSearchParams({
    To: to,
    From: twilioFromNumber,
    Body: message,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    return { success: false, error: String(data.message ?? `Twilio error: ${res.status}`) };
  }

  return { success: true, messageId: String(data.sid ?? '') };
}

async function sendViaAwsSns(config: SmsConfig, to: string, message: string): Promise<DeliveryResult> {
  const { awsAccessKeyId, awsSecretAccessKey, awsRegion } = config;
  if (!awsAccessKeyId || !awsSecretAccessKey || !awsRegion) {
    return { success: false, error: 'AWS SNS credentials not configured' };
  }

  // Use child_process.spawn (non-blocking) instead of execSync
  const { spawn } = await import('child_process');
  
  return new Promise<DeliveryResult>((resolve) => {
    const env = {
      ...process.env,
      AWS_ACCESS_KEY_ID: awsAccessKeyId,
      AWS_SECRET_ACCESS_KEY: awsSecretAccessKey,
    };

    const child = spawn('aws', [
      'sns', 'publish',
      '--region', awsRegion,
      '--phone-number', to,
      '--message', message,
      '--output', 'json',
    ], { env, timeout: 15000 });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code: number | null) => {
      if (code === 0) {
        try {
          const parsed = JSON.parse(stdout);
          resolve({ success: true, messageId: parsed.MessageId ?? 'aws-' + Date.now() });
        } catch {
          resolve({ success: true, messageId: 'aws-' + Date.now() });
        }
      } else {
        resolve({ success: false, error: ('AWS SNS error: ' + stderr).substring(0, 300) });
      }
    });
    child.on('error', (err: Error) => {
      resolve({ success: false, error: ('AWS SNS error: ' + err.message).substring(0, 300) });
    });
  });
}

async function sendViaVonage(config: SmsConfig, to: string, message: string): Promise<DeliveryResult> {
  const { vonageApiKey, vonageApiSecret, vonageFromNumber } = config;
  if (!vonageApiKey || !vonageApiSecret) {
    return { success: false, error: 'Vonage credentials not configured' };
  }

  const res = await fetch('https://rest.nexmo.com/sms/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: vonageApiKey,
      api_secret: vonageApiSecret,
      to: to.replace('+', ''),
      from: vonageFromNumber ?? config.senderId ?? 'DigiLog',
      text: message,
    }),
  });

  const data = await res.json() as Record<string, unknown>;
  const messages = data.messages as Array<Record<string, unknown>> | undefined;
  if (messages?.[0]?.status !== '0') {
    return { success: false, error: String(messages?.[0]?.['error-text'] ?? 'Vonage send failed') };
  }

  return { success: true, messageId: String(messages?.[0]?.['message-id'] ?? '') };
}

async function sendViaHttpGateway(config: SmsConfig, to: string, message: string): Promise<DeliveryResult> {
  const { httpGatewayUrl, httpGatewayMethod, httpGatewayHeaders, httpGatewayBodyTemplate } = config;
  if (!httpGatewayUrl) {
    return { success: false, error: 'HTTP Gateway URL not configured' };
  }

  const method = httpGatewayMethod ?? 'POST';
  let url = httpGatewayUrl;
  let body: string | undefined;

  // Replace placeholders in URL and body template
  const replacePlaceholders = (str: string) =>
    str.replace(/\{phone\}/g, to).replace(/\{message\}/g, encodeURIComponent(message));

  url = replacePlaceholders(url);

  if (method === 'POST' && httpGatewayBodyTemplate) {
    body = httpGatewayBodyTemplate
      .replace(/\{phone\}/g, to)
      .replace(/\{message\}/g, message);
  }

  const res = await fetch(url, {
    method,
    headers: httpGatewayHeaders ?? { 'Content-Type': 'application/json' },
    ...(body ? { body } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    return { success: false, error: `HTTP Gateway error (${res.status}): ${text.substring(0, 200)}` };
  }

  return { success: true, messageId: `http-${Date.now()}` };
}

export const smsChannel: IChannel = {
  name: 'SMS',

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    const config = await getSmsConfig();
    if (!config || !config.enabled) {
      return { success: false, error: 'SMS notifications are not enabled' };
    }

    const phone = normalizePhone(payload.recipient, config.defaultCountryCode);
    if (!isValidPhone(phone)) {
      return { success: false, error: `Invalid phone number: ${payload.recipient}` };
    }

    const message = payload.message.replace(/<[^>]*>/g, '').substring(0, 1600);

    switch (config.provider) {
      case 'twilio':
        return sendViaTwilio(config, phone, message);
      case 'aws-sns':
        return sendViaAwsSns(config, phone, message);
      case 'vonage':
        return sendViaVonage(config, phone, message);
      case 'http-gateway':
        return sendViaHttpGateway(config, phone, message);
      default:
        return { success: false, error: `Unknown SMS provider: ${config.provider}` };
    }
  },

  async testConnection(): Promise<DeliveryResult> {
    const config = await getSmsConfig();
    if (!config || !config.enabled) {
      return { success: false, error: 'SMS notifications are not enabled' };
    }
    // Basic validation that credentials exist
    switch (config.provider) {
      case 'twilio':
        if (!config.twilioAccountSid || !config.twilioAuthToken)
          return { success: false, error: 'Twilio credentials missing' };
        break;
      case 'aws-sns':
        if (!config.awsAccessKeyId || !config.awsSecretAccessKey)
          return { success: false, error: 'AWS credentials missing' };
        break;
      case 'vonage':
        if (!config.vonageApiKey || !config.vonageApiSecret)
          return { success: false, error: 'Vonage credentials missing' };
        break;
      case 'http-gateway':
        if (!config.httpGatewayUrl)
          return { success: false, error: 'HTTP Gateway URL missing' };
        break;
    }
    return { success: true, messageId: 'config-validated' };
  },
};
