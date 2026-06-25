// CLI: показать топ цитат-кандидатов для записи (подсказка для вычитки).
//   npm run excerpts -- [source_id]
import { Store } from "./db.js";
import { rankExcerpts } from "./excerpt.js";

const sid = process.argv[2] ?? "shev503";
const store = new Store();
const row = store.get(sid);
store.close();

if (!row) {
  console.error(`✗ запись ${sid} не найдена. Сначала: npm run import -- <url>`);
  process.exit(1);
}

const text = String(row["text"] ?? "");
const cands = rankExcerpts(text, 6);

console.log(`Кандидаты-выжимки для ${sid} (${row["kind"]}, «${row["work_title"] ?? "—"}»):\n`);
cands.forEach((c, i) => {
  console.log(`${i + 1}. [score ${c.score}] (${c.sentences} предл., ${c.len} симв.)`);
  console.log(`   ${c.text}\n`);
});
