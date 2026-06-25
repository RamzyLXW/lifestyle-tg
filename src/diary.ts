// Сплиттер Щоденника (shev501): одна большая страница -> отдельные датированные записи.
// Разметка дневника (см. разведку):
//   <p class=K1><b>1857</b></p>            -> маркер года (1857 / 1858)
//   <p class=K1><i>13 июня</i></p>          -> начало записи (день+месяц; месяц иногда в [скобках])
//   <p class=K1><i>15 [июня]</i></p>
//   <p class=K1> … проза … </p>             -> текст записи (копим до следующей даты)
//   <p class=K2> … </p>                     -> стихотворные вставки (пропускаем — нужна проза)
import * as cheerio from "cheerio";
import type { ParsedEntry } from "./types.js";
import { pageSlug } from "./fetcher.js";

const AUTHOR = "Тарас Шевченко";
// Дневник по-русски: месяцы в род. падеже.
const MONTHS_RU: Record<string, number> = {
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6,
  июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
};
const MONTH_RE = Object.keys(MONTHS_RU).join("|");
const DATE_RE = new RegExp(`^(\\d{1,2})\\s*\\[?\\s*(${MONTH_RE})\\s*\\]?\\.?$`, "i");
const DAY_ONLY_RE = /^(\d{1,2})\s*\.?$/;
const YEAR_RE = /^(185[78])$/; // дневник: 1857–1858

const clean = (s: string) => s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
const pad = (n: number) => String(n).padStart(2, "0");

interface Raw { day: number; month: number; year: number | null; lines: string[] }

export function splitDiary(html: string, url: string): ParsedEntry[] {
  const $ = cheerio.load(html);

  let citation: string | null = null;
  $("small").each((_, el) => {
    if (citation) return;
    const m = clean($(el).text()).match(/^\[(.*)\]$/);
    if (m) citation = clean(m[1]!);
  });

  const raws: Raw[] = [];
  let year: number | null = null;
  let lastMonth: number | null = null;
  let cur: Raw | null = null;

  $("p").each((_, el) => {
    const $el = $(el);
    if (($el.attr("class") ?? "").trim() !== "K1") return; // только проза-дневник
    $el.find('strong[id^="page"]').remove(); // вырезать вшитые /NNN/
    const txt = clean($el.text());
    if (!txt) return;

    if (YEAR_RE.test(txt)) { year = Number(txt); return; } // маркер года

    const hasItalic = $el.find("i").length > 0;
    const dm = txt.match(DATE_RE);
    if (dm && hasItalic) {
      lastMonth = MONTHS_RU[dm[2]!.toLowerCase()]!;
      cur = { day: Number(dm[1]), month: lastMonth, year, lines: [] };
      raws.push(cur);
      return;
    }
    const dOnly = txt.match(DAY_ONLY_RE);
    if (dOnly && hasItalic && lastMonth) {
      cur = { day: Number(dOnly[1]), month: lastMonth, year, lines: [] };
      raws.push(cur);
      return;
    }

    if (cur) cur.lines.push(txt); // обычный абзац -> в текущую запись
  });

  const slug = pageSlug(url);
  const seen = new Set<string>();
  const out: ParsedEntry[] = [];

  for (const r of raws) {
    const text = r.lines.join("\n").trim();
    if (text.replace(/\s/g, "").length < 20) continue; // пустые/обрывочные записи
    let id = `${slug}#${r.year ?? "0000"}-${pad(r.month)}-${pad(r.day)}`;
    let n = 2;
    while (seen.has(id)) id = `${slug}#${r.year ?? "0000"}-${pad(r.month)}-${pad(r.day)}-${n++}`;
    seen.add(id);

    out.push({
      source_id: id,
      source_url: `${url}#${r.year ?? ""}-${r.month}-${r.day}`,
      author: AUTHOR,
      work_title: "Щоденник",
      text,
      orig_date: { year: r.year, month: r.month, day: r.day, precision: "day" },
      kind: "diary",
      citation,
      notes_dropped: 0,
    });
  }
  return out;
}
