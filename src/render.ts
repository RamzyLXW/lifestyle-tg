// Рендер записи -> текст поста.
// ВАЖНО: «Тарас Шевченко. Лайфстайл» — это ИМЯ КАНАЛА, Telegram показывает его сам
// над каждым постом. В текст сообщения шапку НЕ кладём.
//
// Тело — обычным текстом; низ — жирным. Низ по данным (по референсу):
//   • есть полная дата (день+месяц+год)  -> дата + возраст:
//         <текст>
//
//         1860 год, 18 февраля
//         46 лет
//   • даты нет (стих/повесть)            -> название источника:
//         <текст>
//
//         Оговорки
//
// Тело — в оригинале (не переводим). Низ — по-русски.

// Дата рождения Шевченко — константа (бриф, п.4): 25.02.1814 ст.ст. / 09.03.1814 н.ст.
export const BIRTH_YEAR = 1814;

export type Footer =
  | { kind: "source"; source_label: string }
  | { kind: "date"; year: number; month?: number | null; day?: number | null };

export interface RenderInput {
  excerpt: string; // отобранный фрагмент (тело поста)
  footer: Footer;
}

const MONTH_GEN_RU = [
  "", "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Возраст в год записи — словоформа: 1 год / 2-4 года / 5-20 лет. */
export function formatAge(year: number): string {
  const age = year - BIRTH_YEAR;
  const m10 = age % 10;
  const m100 = age % 100;
  let word: string;
  if (m10 === 1 && m100 !== 11) word = "год";
  else if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) word = "года";
  else word = "лет";
  return `${age} ${word}`;
}

/** Дата оригинала буквально как в источнике (без конвертации стиля — бриф п.6). */
export function formatOrigDate(year: number, month?: number | null, day?: number | null): string {
  if (month && day) return `${year} год, ${day} ${MONTH_GEN_RU[month]}`;
  if (month) return `${year} год, ${MONTH_GEN_RU[month]}`;
  return `${year} год`;
}

/** Нижние строки поста (каждая пойдёт жирной). */
function footerLines(f: Footer): string[] {
  if (f.kind === "source") return [f.source_label.trim()];
  return [formatOrigDate(f.year, f.month, f.day), formatAge(f.year)];
}

/** HTML для Telegram (parse_mode=HTML). Тело экранируем, низ — жирным (бриф п.6). */
export function renderPostHtml(e: RenderInput): string {
  const tail = footerLines(e.footer).map((l) => `<b>${escapeHtml(l)}</b>`);
  return [escapeHtml(e.excerpt.trim()), "", ...tail].join("\n");
}

/** Плоский предпросмотр для консоли. */
export function renderPostPreview(e: RenderInput): string {
  return [e.excerpt.trim(), "", ...footerLines(e.footer)].join("\n");
}
