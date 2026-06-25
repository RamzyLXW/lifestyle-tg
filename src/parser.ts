// Парсер ОДНОЙ страницы litopys.org.ua -> ParsedEntry (бриф, п.4 + п.8).
//
// Находки разведки (см. parse_probe.py / cache/shev104.utf8.html):
//   <p class="K1">   -> авторский текст
//   <p class="Prym"> -> редакторский аппарат (примечания, источники) — НЕ берём (п.2, п.9)
//   навигация и строка-цитата тоже свёрстаны как <p class=K1>, но содержат <a>/<small>
//                    -> авторский текст ссылок не содержит, поэтому такие абзацы отсекаем
//   <strong id="pageNNN">/NNN/</strong> -> вшитые маркеры страниц печатного изд. — вырезаем
//
// Парсер ИЗОЛИРОВАН: цепляется за вёрстку, всё хрупкое — здесь (бриф, п.6).
import * as cheerio from "cheerio";
import type { ParsedEntry, OrigDate, EntryKind } from "./types.js";
import { pageSlug } from "./fetcher.js";

const AUTHOR = "Тарас Шевченко";
const NAV_WORDS = new Set(["Попередня", "Головна", "Наступна", "Варіанти"]);

/** Первая строка из <title> — без сайтового суффикса «… Тарас Шевченко. Повне зібрання творів. Том. N».
 *  Для стихов без заголовка это и есть их «название» (первая строка). Пусто/только-суффикс -> null. */
function titleFirstLine($: cheerio.CheerioAPI): string | null {
  const raw = clean($("title").first().text());
  const head = raw.split(/\.?\s*Тарас Шевченко/i)[0]!.trim().replace(/[.…]+$/, "").trim();
  return head.length >= 2 ? head : null;
}

// Названия месяцев в род. падеже: рус. (дневник/письма) + укр. (заголовки сайта).
const MONTHS: Record<string, number> = {
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6,
  июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
  січня: 1, лютого: 2, березня: 3, квітня: 4, травня: 5, червня: 6,
  липня: 7, серпня: 8, вересня: 9, жовтня: 10, листопада: 11, грудня: 12,
};
const MONTH_RE = Object.keys(MONTHS).join("|");

function clean(s: string): string {
  return s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

// Шевченко жил 1814–1861; дневник 1857–58, письма до 1861. Даты вне диапазона — чужие
// (редакторские/цитаты), не дата записи. Отсекаем (бриф п.6: «похоже ли на нормальную запись»).
const YEAR_MIN = 1814;
const YEAR_MAX = 1861;
const validYear = (y: number) => y >= YEAR_MIN && y <= YEAR_MAX;

/** Полная дата (день+месяц+год) из строки. Два порядка слов:
 *  «12 червня 1857» (D M Y) и «1860, февраля 18» (Y M D — подпись письма). */
function scanDayDate(s: string): OrigDate | null {
  let m = s.match(new RegExp(`(\\d{1,2})\\s+(${MONTH_RE})\\s+(\\d{4})`, "i"));
  if (m && validYear(+m[3]!)) return { year: +m[3]!, month: MONTHS[m[2]!.toLowerCase()]!, day: +m[1]!, precision: "day" };
  m = s.match(new RegExp(`(\\d{4})\\s*,?\\s*(${MONTH_RE})\\s+(\\d{1,2})`, "i"));
  if (m && validYear(+m[1]!)) return { year: +m[1]!, month: MONTHS[m[2]!.toLowerCase()]!, day: +m[3]!, precision: "day" };
  return null;
}

/**
 * Дата оригинала. Порядок поиска:
 *   1) заголовки — у дневника дата записи стоит в заголовке;
 *   2) подпись в КОНЦЕ текста (последние строки) — у писем дата там («1860, февраля 18»);
 *   3) месяц+год / год из заголовков.
 * Середину текста не сканируем: внутри встречаются биографические даты (ложные срабатывания).
 * Стиль НЕ конвертируем — берём буквально (бриф п.6).
 */
export function extractOrigDate(headings: string[], authorLines: string[]): OrigDate {
  for (const h of headings) {
    const d = scanDayDate(h);
    if (d) return d;
  }
  for (const line of authorLines.slice(-3)) {
    const d = scanDayDate(line);
    if (d) return d;
  }
  for (const h of headings) {
    const m = h.match(new RegExp(`(${MONTH_RE})\\s+(\\d{4})`, "i"));
    if (m && validYear(+m[2]!)) return { year: +m[2]!, month: MONTHS[m[1]!.toLowerCase()]!, day: null, precision: "month" };
  }
  for (const h of headings) {
    const m = h.match(/\b(1[78]\d{2})\b/);
    if (m && validYear(+m[1]!)) return { year: +m[1]!, month: null, day: null, precision: "year" };
  }
  return { year: null, month: null, day: null, precision: "none" };
}

/** Тип записи — эвристика по цитате-источнику (том) и заголовкам. */
function inferKind(citation: string | null, headings: string[]): EntryKind {
  const hay = `${citation ?? ""} ${headings.join(" ")}`.toLowerCase();
  if (/щоденник|журнал|дневник/.test(hay)) return "diary";
  if (/лист|письмо/.test(hay)) return "letter";
  if (/поезі|поэзи|том\.?\s*1|том\.?\s*2/.test(hay)) return "poem";
  return "other";
}

export function parseEntry(html: string, url: string): ParsedEntry {
  const $ = cheerio.load(html);

  // заголовки-кандидаты (для типа и даты)
  const headings = $("h1,h2,h3,h4").map((_, el) => clean($(el).text())).get();
  // У многих поздних стихов (Т.2) ЗАГОЛОВКА НЕТ — они «без названия», известны по первой строке.
  // Сайт кладёт эту первую строку в <title> (до суффикса «. Тарас Шевченко. Повне зібрання…»).
  // Фолбэк: если из <h*> названия не вышло — берём первую строку из <title>.
  // На страницах-открывашках раздела <h> = РАЗДЕЛИТЕЛЬ периода («1839 — 1841», «ПОЕЗІЯ 1837—1847»),
  // а настоящее имя стиха лежит в <title>. Такие заголовки-разделители отбрасываем -> фолбэк на <title>.
  const isDivider = (t: string) =>
    /^\d{3,4}$/.test(t) || /^\d{4}\s*[—–-]\s*\d{4}$/.test(t) || /^поезія\s*\d/i.test(t);
  const work_title =
    headings.find((t) => t && !isDivider(t)) ?? titleFirstLine($) ?? null;

  // цитата-источник: <small>[ ... ]</small> -> том/страница
  let citation: string | null = null;
  $("small").each((_, el) => {
    if (citation) return;
    const t = clean($(el).text());
    const m = t.match(/^\[(.*)\]$/);
    if (m) citation = clean(m[1]!);
  });

  // авторский текст: p.K1, аппарат p.Prym отбрасываем
  const authorLines: string[] = [];
  let notesDropped = 0;
  $("p").each((_, el) => {
    const $el = $(el);
    const cls = ($el.attr("class") ?? "").trim();
    if (cls === "Prym") {
      if (clean($el.text())) notesDropped++;
      return;
    }
    if (cls !== "K1") return;
    // вырезаем вшитые маркеры страниц /NNN/
    $el.find('strong[id^="page"]').remove();
    // навигация и цитата: содержат ссылки/<small> — это не авторский текст
    if ($el.find("a, small").length > 0) return;
    const txt = clean($el.text());
    if (!txt || NAV_WORDS.has(txt)) return;
    authorLines.push(txt);
  });

  const orig_date = extractOrigDate(headings, authorLines);
  const kind = inferKind(citation, headings);

  return {
    source_id: pageSlug(url), // стабильный id (имя страницы)
    source_url: url,
    author: AUTHOR,
    work_title,
    text: authorLines.join("\n"),
    orig_date,
    kind,
    citation,
    notes_dropped: notesDropped,
  };
}

/** Грубая проверка «похоже ли на нормальную запись» (бриф, п.6). */
export function looksValid(e: ParsedEntry): { ok: boolean; reason?: string } {
  if (e.text.replace(/\s/g, "").length < 20)
    return { ok: false, reason: "слишком короткий/пустой авторский текст" };
  return { ok: true };
}
