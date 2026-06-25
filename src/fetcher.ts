// Вежливая загрузка страниц litopys (бриф, п.6 «Вежливость к сайту»):
//  - правильный User-Agent с контактом,
//  - кеш скачанного локально (повторно не дёргаем сайт),
//  - декодирование windows-1251 -> UTF-16/JS-строка (сайт в cp1251!).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import iconv from "iconv-lite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "cache");

const UA =
  "Mozilla/5.0 (research; lifestyle-tg-bot; contact mishkoroman01@gmail.com)";

/** имя страницы из URL: .../shev104.htm -> shev104 */
export function pageSlug(url: string): string {
  const last = url.split("/").pop() ?? url;
  return last.replace(/\.html?$/i, "");
}

/** уже скачана локально? (чтобы при краулинге не делать паузу на кешированных) */
export function isCached(url: string): boolean {
  return existsSync(path.join(CACHE_DIR, `${pageSlug(url)}.cp1251.html`));
}

/**
 * Скачать страницу (или взять из кеша) и вернуть HTML, декодированный из cp1251.
 * Сырые байты тоже кешируем — чтобы не зависеть от перекодировки и не ходить на сайт повторно.
 */
export async function fetchPage(
  url: string,
  opts: { useCache?: boolean } = {},
): Promise<string> {
  const useCache = opts.useCache ?? true;
  if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true });

  const rawPath = path.join(CACHE_DIR, `${pageSlug(url)}.cp1251.html`);

  let buf: Buffer;
  if (useCache && existsSync(rawPath)) {
    buf = await readFile(rawPath);
  } else {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} при загрузке ${url}`);
    buf = Buffer.from(await res.arrayBuffer());
    await writeFile(rawPath, buf); // кеш сырых байт
  }

  return iconv.decode(buf, "win1251");
}
