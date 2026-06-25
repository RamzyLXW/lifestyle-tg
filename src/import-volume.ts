// Массовый импорт тома: идём по ссылкам «Наступна», вежливо (пауза + кеш), до границы тома.
// Бриф п.6 «Вежливость к сайту»: пауза между ЖИВЫМИ запросами, кеш, один проход.
//   npm run import:volume -- 5            # Том 5 (Журнал/Дневник), до лимита страниц
//   npm run import:volume -- 5 --max 120  # больше страниц
//   npm run import:volume -- 5 --start shev501
import { fetchPage, isCached, pageSlug } from "./fetcher.js";
import { parseEntry, looksValid } from "./parser.js";
import { Store } from "./db.js";

const BASE = "http://litopys.org.ua/shevchenko/";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** href из ссылки «Наступна» (следующая страница тома).
 *  Имена страниц бывают с буквенным суффиксом: shev117k (Коментарі), shev117p (першодрук/вариант),
 *  поэтому slug — [0-9a-z]+, а не только цифры (иначе цепочка рвётся на первой суффиксной странице). */
function nextLink(html: string): string | null {
  const m = html.match(/<a\s+href="(shev[0-9a-z]+\.htm)"[^>]*>\s*Наступна\s*<\/a>/i);
  return m ? m[1]! : null;
}

/** Похоже ли, что страница относится к нужному тому (по заголовку/цитате «Том. N» / «Т. N:»). */
function inVolume(html: string, vol: number): boolean {
  return new RegExp(`Том\\.?\\s*${vol}\\b|Т\\.?\\s*${vol}\\s*:`).test(html);
}

function pageTitle(html: string): string {
  return (html.match(/<title>([^<]*)<\/title>/) || [])[1] ?? "";
}

/** Аппарат/служебные/вариантные страницы — НЕ берём.
 *  - редакторский аппарат (бриф п.9): Коментарі/Примітки/Список скорочень/покажчики/вихідні дані/Зміст;
 *  - редколлегия/вступит. статьи: «Від редколегії» и т.п.;
 *  - параллельные тексты-дубли поэм: «Варіанти», «Інша редакція», «Текст першодруку/першодрук»
 *    (это тот же стих в другой редакции — иначе в базе два дубля одного произведения). */
function isApparatus(html: string): boolean {
  const title = pageTitle(html);
  // обложка тома: <title> начинается с «Тарас Шевченко. Повне зібрання творів…» (у стихов — имя стиха).
  if (/^\s*Тарас Шевченко\.\s*Повне зібрання/i.test(title)) return true;
  // судим по ИМЕНИ произведения = части до сайтового суффикса (иначе «Шевченко» из суффикса ловит всё).
  // «Шевченк» в имени → это вступит. статья/аппарат О Шевченко (его стихи так себя не называют).
  const head = title.split(/Тарас Шевченко\.\s*Повне зібрання/i)[0] ?? title;
  return /Коментар|Приміт|Список скорочень|покажчик|Вихідні дані|Зміст|редколег|Варіанти|Інша редакц|Інші редакц|першодрук|Шевченк/i.test(
    head,
  );
}

/** Дневник («Щоденник») — отдельная страница-блоб, её режет сплиттер (import-diary), не генерик-импорт. */
function isDiaryPage(html: string): boolean {
  return /^\s*Щоденник/i.test(pageTitle(html));
}

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const vol = Number(process.argv[2] || 5);
  const max = Number(argVal("--max") || 40);
  const startSlug = argVal("--start") || `shev${vol}`;
  const delayMs = Number(argVal("--delay") || 900);

  let url = `${BASE}${startSlug}.htm`;
  const now = new Date().toISOString();
  const store = new Store();
  const seen = new Set<string>();
  let pages = 0, inserted = 0, updated = 0, skipped = 0, thin = 0, withDate = 0, apparatus = 0;
  let stop = "лимит страниц";

  while (pages < max) {
    if (seen.has(url)) { stop = "цикл навигации"; break; }
    seen.add(url);

    const cached = isCached(url);
    let html: string;
    try {
      html = await fetchPage(url);
    } catch (e) {
      stop = `ошибка загрузки: ${(e as Error).message}`;
      break;
    }
    pages++;

    if (!inVolume(html, vol)) {
      if (inserted + updated + skipped > 0) { stop = `конец тома (${pageSlug(url)} вне Т.${vol})`; break; }
      // ещё не начали (обложка/титул) — просто идём дальше
    } else if (isApparatus(html) || isDiaryPage(html)) {
      apparatus++; // аппарат или страница-дневник (её режет import-diary) — пропускаем
    } else {
      const entry = parseEntry(html, url);
      if (looksValid(entry).ok) {
        const { action } = store.upsert(entry, now);
        if (action === "inserted") inserted++;
        else if (action === "updated") updated++;
        else skipped++;
        if (entry.orig_date.precision !== "none") withDate++;
      } else {
        thin++;
      }
    }

    const nl = nextLink(html);
    if (!nl) { stop = "нет ссылки «Наступна»"; break; }
    url = `${BASE}${nl}`;
    if (!cached) await sleep(delayMs); // пауза только на живых запросах
  }

  const total = store.count();
  store.close();
  console.log(`\nТом ${vol}: страниц пройдено ${pages} (стоп: ${stop})`);
  console.log(`  новых ${inserted}, обновлено ${updated}, пропущено(одобрено) ${skipped}, аппарат/дневник-блоб ${apparatus}, тонких ${thin}`);
  console.log(`  с распарсенной датой: ${withDate}`);
  console.log(`  всего записей в базе: ${total}`);
}

main().catch((e) => {
  console.error("✗ ошибка import:volume:", e instanceof Error ? e.message : e);
  process.exit(1);
});
