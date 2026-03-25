/**
 * Telegram Channel — Sends notifications via Telegram Bot API.
 */
import type { NotificationPayload, DeliveryResult, NotificationChannel as IChannel } from "../types.js";
import { prisma } from "../../../lib/prisma.js";

interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  defaultChatId?: string;
}

let configCache: { config: TelegramConfig | null; cachedAt: number } | null = null;
const CACHE_TTL = 60_000;

async function getTelegramConfig(): Promise<TelegramConfig | null> {
  const now = Date.now();
  if (configCache && now - configCache.cachedAt < CACHE_TTL) return configCache.config;
  const row = await prisma.systemConfig.findUnique({ where: { configKey: "notification-telegram" } });
  const config = row?.configValue as unknown as TelegramConfig | null;
  configCache = { config, cachedAt: now };
  return config;
}

export const telegramChannel: IChannel = {
  name: "TELEGRAM",

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    const config = await getTelegramConfig();
    if (!config || !config.enabled) {
      return { success: false, error: "Telegram notifications are not enabled" };
    }
    if (!config.botToken) {
      return { success: false, error: "Telegram bot token not configured" };
    }

    const chatId = payload.recipient || config.defaultChatId;
    if (!chatId) {
      return { success: false, error: "No Telegram chat ID provided" };
    }

    const text = payload.subject
      ? `<b>${payload.subject}</b>\n\n${payload.message.replace(/<[^>]*>/g, "")}`
      : payload.message.replace(/<[^>]*>/g, "");

    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.substring(0, 4096),
        parse_mode: "HTML",
      }),
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!data.ok) {
      return { success: false, error: `Telegram API error: ${data.description ?? res.status}` };
    }

    const result = data.result as Record<string, unknown> | undefined;
    return { success: true, messageId: String(result?.message_id ?? `tg-${Date.now()}`) };
  },

  async testConnection(): Promise<DeliveryResult> {
    const config = await getTelegramConfig();
    if (!config || !config.enabled) {
      return { success: false, error: "Telegram notifications are not enabled" };
    }
    if (!config.botToken) {
      return { success: false, error: "Telegram bot token not configured" };
    }

    const url = `https://api.telegram.org/bot${config.botToken}/getMe`;
    const res = await fetch(url);
    const data = (await res.json()) as Record<string, unknown>;
    if (!data.ok) {
      return { success: false, error: `Invalid bot token: ${data.description}` };
    }
    const result = data.result as Record<string, unknown> | undefined;
    return { success: true, messageId: `bot:${result?.username ?? "unknown"}` };
  },
};
