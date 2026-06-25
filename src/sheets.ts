// Общий слой доступа к Google Sheets (переиспользуют export-sheets.ts и import-sheet.ts).
// Авторизация — service-account через googleapis (паттерн из telegram-to-sheets/sync.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { google } from "googleapis";
import { requireEnv } from "./config.js";

export const SHEET_NAME = "entries";

/** Путь к ключу service-account (env -> локальный -> ключ из telegram-to-sheets). */
export function resolveCredentialsPath(): string {
  const candidates = [
    process.env["GOOGLE_APPLICATION_CREDENTIALS"],
    path.join(process.cwd(), "service-account.json"),
    path.join(os.homedir(), "LuxWinWeb", "telegram-to-sheets",
      "steady-habitat-485620-a6-3509e0d896fe.json"),
  ].filter(Boolean) as string[];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error(
    "Не найден ключ service-account. Укажи путь в GOOGLE_APPLICATION_CREDENTIALS " +
    "или положи service-account.json в корень проекта.",
  );
}

export async function getSheets() {
  const credentials = JSON.parse(fs.readFileSync(resolveCredentialsPath(), "utf-8"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

export type Sheets = Awaited<ReturnType<typeof getSheets>>;

/** id таблицы из .env / env SHEVCHENKO_SHEET_ID или выход с подсказкой. */
export function requireSpreadsheetId(): string {
  return requireEnv("SHEVCHENKO_SHEET_ID");
}
