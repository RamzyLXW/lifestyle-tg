// Импорт дневника: режем shev501 на датированные записи и грузим в базу.
// Blob-страницу дневника (source_id="shev501"), если она была залита генерик-импортом, удаляем.
//   npm run import:diary            (берёт shev501 из кеша/сайта)
import { fetchPage } from "./fetcher.js";
import { splitDiary } from "./diary.js";
import { Store } from "./db.js";

const URL = process.argv[2] ?? "http://litopys.org.ua/shevchenko/shev501.htm";

async function main() {
  const html = await fetchPage(URL);
  const entries = splitDiary(html, URL);
  if (entries.length === 0) {
    console.error("✗ дневник не распознан — проверь разметку shev501");
    process.exit(1);
  }

  const store = new Store();
  const removed = store.remove("shev501"); // убрать blob, если был
  const now = new Date().toISOString();
  let inserted = 0, updated = 0, skipped = 0;
  for (const e of entries) {
    const { action } = store.upsert(e, now);
    if (action === "inserted") inserted++;
    else if (action === "updated") updated++;
    else skipped++;
  }
  const total = store.count();
  store.close();

  const years = entries.map((e) => e.orig_date.year).filter(Boolean) as number[];
  const first = entries[0]!.orig_date;
  const last = entries[entries.length - 1]!.orig_date;
  console.log(`✓ дневник разрезан: ${entries.length} записей (blob удалён: ${removed})`);
  console.log(`  новых ${inserted}, обновлено ${updated}, пропущено(одобрено) ${skipped}`);
  console.log(`  годы: ${Math.min(...years)}–${Math.max(...years)}; первая ${first.day}.${first.month}.${first.year}, последняя ${last.day}.${last.month}.${last.year}`);
  console.log(`  всего записей в базе: ${total}`);
}

main().catch((e) => {
  console.error("✗ ошибка import:diary:", e instanceof Error ? e.message : e);
  process.exit(1);
});
