/**
 * Slack Channel — Sends notifications via Slack Incoming Webhooks.
 */
import type { NotificationPayload, DeliveryResult, NotificationChannel as IChannel } from "../types.js";
import { prisma } from "../../../lib/prisma.js";

interface SlackConfig {
  enabled: boolean;
  webhookUrl: string;
  defaultChannel?: string;
}

let configCache: { config: SlackConfig | null; cachedAt: number } | null = null;
const CACHE_TTL = 60_000;

async function getSlackConfig(): Promise<SlackConfig | null> {
  const now = Date.now();
  if (configCache && now - configCache.cachedAt < CACHE_TTL) return configCache.config;
  const row = await prisma.systemConfig.findUnique({ where: { configKey: "notification-slack" } });
  const config = row?.configValue as unknown as SlackConfig | null;
  configCache = { config, cachedAt: now };
  return config;
}

export const slackChannel: IChannel = {
  name: "SLACK",

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    const config = await getSlackConfig();
    if (!config || !config.enabled) {
      return { success: false, error: "Slack notifications are not enabled" };
    }
    if (!config.webhookUrl) {
      return { success: false, error: "Slack webhook URL not configured" };
    }

    const text = payload.subject
      ? `*${payload.subject}*\n${payload.message.replace(/<[^>]*>/g, "")}`
      : payload.message.replace(/<[^>]*>/g, "");

    const body: Record<string, unknown> = { text: text.substring(0, 3000) };
    const channel = payload.recipient || config.defaultChannel;
    if (channel) body.channel = channel;

    const res = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `Slack webhook error (${res.status}): ${errText.substring(0, 200)}` };
    }

    return { success: true, messageId: `slack-${Date.now()}` };
  },

  async testConnection(): Promise<DeliveryResult> {
    const config = await getSlackConfig();
    if (!config || !config.enabled) {
      return { success: false, error: "Slack notifications are not enabled" };
    }
    if (!config.webhookUrl) {
      return { success: false, error: "Slack webhook URL not configured" };
    }
    return { success: true, messageId: "config-validated" };
  },
};
