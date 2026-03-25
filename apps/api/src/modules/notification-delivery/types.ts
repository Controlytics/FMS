/**
 * Notification Delivery System — Types
 */

export interface EmailConfig {
  // SMTP Server
  host: string;
  port: number;
  secure: boolean;           // true for TLS (465), false for STARTTLS (587)
  enabled: boolean;

  // Sender info
  fromEmail: string;
  fromName: string;

  // SMTP Provider preset
  smtpProvider?: 'custom' | 'gmail' | 'office365' | 'sendgrid' | 'aws-ses';

  // Authentication type (like ThingsBoard)
  authType: 'basic' | 'oauth2';

  // Basic auth fields
  username: string;
  password?: string;

  // OAuth2 fields (Microsoft Azure AD / Google / Custom)
  oauth2Provider?: 'microsoft' | 'office365' | 'google' | 'custom';
  clientId?: string;
  clientSecret?: string;
  providerTenantId?: string;    // Microsoft Azure AD Tenant ID
  refreshToken?: string;        // Google OAuth2 refresh token
  tokenUrl?: string;            // Custom OAuth2 token endpoint
  scope?: string;               // Custom OAuth2 scope

  // Timeouts
  connectionTimeout?: number;
  socketTimeout?: number;
}

export interface SmsConfig {
  provider: 'twilio' | 'aws-sns' | 'vonage' | 'http-gateway';
  enabled: boolean;
  // Twilio
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  // AWS SNS
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  // Vonage
  vonageApiKey?: string;
  vonageApiSecret?: string;
  vonageFromNumber?: string;
  // Generic HTTP gateway
  httpGatewayUrl?: string;
  httpGatewayMethod?: 'GET' | 'POST';
  httpGatewayHeaders?: Record<string, string>;
  httpGatewayBodyTemplate?: string;
  // Common
  defaultCountryCode?: string;
  senderId?: string;
}

export interface NotificationPayload {
  channel: 'EMAIL' | 'SMS' | 'TELEGRAM' | 'SLACK';
  recipient: string;           // email address or phone number
  subject?: string;            // for email
  message: string;             // plain text or HTML
  templateId?: string;         // optional template reference
  variables?: Record<string, string>;  // template variables
  triggeredBy?: string;        // rule-chain, alarm, system, manual
  ruleChainId?: string;
  alarmId?: string;
  metadata?: Record<string, unknown>;
}

export interface DeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface NotificationChannel {
  name: string;
  send(payload: NotificationPayload): Promise<DeliveryResult>;
  testConnection(): Promise<DeliveryResult>;
}
