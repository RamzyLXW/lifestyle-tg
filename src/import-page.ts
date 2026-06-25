// CLI: импорт ОДНОЙ страницы в локальную базу (бриф, п.8 — сначала одна запись).
//   npm run import -- <url>
// По умолчанию — тестовая страница shev104 («ДУМКА», 1838).
// Идемпотентно: запусти дважды — дубля не будет.
import { fetchPage } from "./fetcher.js";
import { parseEntry, looksValid } from "./parser.js";
import { Store } from "./db.js";

const DEFAULT_URL = "http://litopys.org.ua/shevchenko/shev104.htm";

async function main() {
  const url = process.argv[2] ?? DEFAULT_URL;
  const nowIso = new Date().toISOString();

  console.log(`→ загружаю ${url}`);
  const html = await fetchPage(url);
  const entry = parseEntry(html, url);

  const v = looksValid(entry);
  if (!v.ok) {
    console.error(`✗ пропуск: ${v.reason}`);
    process.exit(1);
  }

  const store = new Store();
  const before = store.count();
  const { action } = store.upsert(entry, nowIso);
  const row = store.get(entry.source_id);
  const after = store.count();
  store.close();

  const d = entry.orig_date;
  const dateStr =
    d.precision === "day" ? `${d.day}.${d.month}.${d.year}`
    : d.precision === "month" ? `${d.month}.${d.year}`
    : d.precision === "year" ? `${d.year}`
    : "—";

  console.log("─".repeat(60));
  console.log(`source_id : ${entry.source_id}`);
  console.log(`title     : ${entry.work_title ?? "—"}`);
  console.log(`kind      : ${entry.kind}`);
  console.log(`date      : ${dateStr}  (precision=${d.precision})`);
  console.log(`citation  : ${entry.citation ?? "—"}`);
  console.log(`аппарат отброшен: ${entry.notes_dropped} абз.`);
  console.log("─".repeat(60));
  console.log("АВТОРСКИЙ ТЕКСТ:");
  console.log(entry.text);
  console.log("─".repeat(60));
  const msg = { inserted: "✓ вставлено (новая запись)", updated: "↻ обновлено (бэкфилл парсера, не одобрено)", skipped: "• пропущено (уже одобрено — вычитка защищена)" };
  console.log(msg[action]);
  console.log(`строк в базе: ${before} → ${after}`);
  console.log(`row.id=${row?.["id"]} approved=${row?.["approved"]} interesting=${row?.["interesting"]} published_at=${row?.["published_at"] ?? "null"}`);
}

main().catch((e) => {
  console.error("✗ ошибка:", e instanceof Error ? e.message : e);
  process.exit(1);
});
