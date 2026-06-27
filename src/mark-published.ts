// Переналожить published_at на ТЕКУЩУЮ shevchenko.db из журнала .last-post.json.
//
// Нужно для НАДЁЖНОГО сохранения состояния в CI: после поста в Telegram воркфлоу берёт самую
// свежую БД из origin и заново ставит отметку публикации. Так гонка git push не «теряет»
// публикацию — иначе тот же стих выйдет повторно (баг 26→27 июня: shev107 ушёл дважды, потому
// что коммит крона с published_at проиграл гонку push и не сохранился).
//
// Идемпотентно: если в свежей БД отметка уже стоит — diff пустой, коммитить нечего.
import fs from "node:fs";
import { Store } from "./db.js";

const FILE = ".last-post.json";

if (!fs.existsSync(FILE)) {
  console.log(`нет ${FILE} — переналагать нечего`);
  process.exit(0);
}

const { source_id, published_at } = JSON.parse(fs.readFileSync(FILE, "utf-8")) as {
  source_id: string;
  published_at: string;
};

const store = new Store();
store.markPublished(source_id, published_at);
store.close();
console.log(`✓ published_at для ${source_id} = ${published_at} наложен на shevchenko.db`);
