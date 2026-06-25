// Лёгкая загрузка .env без зависимостей (секреты: токен бота, chat_id, id таблицы).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = v; // env-переменные имеют приоритет
  }
}

export function requireEnv(key: string): string {
  loadEnv();
  const v = process.env[key];
  if (!v) {
    console.error(`✗ нет ${key} — задай в .env или через переменную окружения`);
    process.exit(1);
  }
  return v;
}
