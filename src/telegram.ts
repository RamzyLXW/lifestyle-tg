// Тонкий слой Telegram Bot API (бриф, п.3.5: sendMessage, parse_mode=HTML).
// Токен берётся из .env (TELEGRAM_BOT_TOKEN) и НИКОГДА не логируется.
import { requireEnv } from "./config.js";

async function call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: params ? JSON.stringify(params) : undefined,
  });
  const data = (await res.json()) as { ok: boolean; result?: T; error_code?: number; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.error_code} ${data.description}`);
  return data.result as T;
}

export interface BotInfo { id: number; username: string; first_name: string }
export interface ChatInfo { id: number; type: string; title?: string; username?: string }
export interface SentMessage { message_id: number }

export const getMe = () => call<BotInfo>("getMe");
export const getChat = (chatId: string) => call<ChatInfo>("getChat", { chat_id: chatId });

export const sendMessage = (chatId: string, html: string) =>
  call<SentMessage>("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
