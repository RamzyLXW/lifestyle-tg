// Движок выбора записи на день (бриф, п.5). Упорядоченные стратегии, первое сработавшее побеждает.
// Антиповтор обеспечивается на входе: подаём только approved + ещё не опубликованные.
import type { Footer } from "./render.js";

export interface Selectable {
  source_id: string;
  excerpt: string | null;
  source_label: string | null;
  footer_kind: string | null; // date | source | null
  work_title: string | null; // запасной источник для низа, если source_label пуст
  interesting: number;
  orig_year: number | null;
  orig_month: number | null;
  orig_day: number | null;
}

/** Причесать ВЕРХНИЙ РЕГИСТР названия («ДУМКА» -> «Думка»); остальное не трогаем. */
function prettifyTitle(s: string): string {
  const t = s.trim();
  const letters = t.replace(/[^A-Za-zА-Яа-яЁёІЇЄҐіїєґ]/g, "");
  const upper = (letters.match(/[A-ZА-ЯЁІЇЄҐ]/g) ?? []).length;
  if (letters.length > 0 && upper / letters.length > 0.8) {
    const low = t.toLowerCase();
    return low.charAt(0).toUpperCase() + low.slice(1);
  }
  return t;
}

export type Strategy = "on-this-day" | "random-interesting" | "none";

export interface Plan {
  entry?: Selectable;
  strategy: Strategy;
}

/** 1) «В этот день»: совпадает день+месяц. Если несколько — самая ранняя по году. */
function onThisDay(pool: Selectable[], today: { month: number; day: number }): Selectable | undefined {
  const match = pool.filter((e) => e.orig_month === today.month && e.orig_day === today.day);
  match.sort((a, b) => (a.orig_year ?? 9999) - (b.orig_year ?? 9999));
  return match[0];
}

/** 2) Фолбэк: случайная «интересная» цитата. rand ∈ [0,1) можно подменить для тестов. */
function randomInteresting(pool: Selectable[], rand: () => number): Selectable | undefined {
  const cands = pool.filter((e) => e.interesting === 1);
  if (cands.length === 0) return undefined;
  return cands[Math.floor(rand() * cands.length)];
}

/** Выбор записи. pool = approved + неопубликованные (антиповтор уже учтён). */
export function selectEntry(
  pool: Selectable[],
  today: { month: number; day: number },
  rand: () => number = Math.random,
): Plan {
  const byDay = onThisDay(pool, today);
  if (byDay) return { entry: byDay, strategy: "on-this-day" };
  const rnd = randomInteresting(pool, rand);
  if (rnd) return { entry: rnd, strategy: "random-interesting" };
  return { strategy: "none" };
}

/**
 * Низ поста (по референсу):
 *   • есть ПОЛНАЯ дата (день+месяц+год) -> дата + возраст (дневник/письмо);
 *   • иначе -> название источника (стих/повесть).
 * Вычитка может переопределить через footer_kind ("date"/"source").
 */
export function chooseFooter(e: Selectable): Footer | null {
  const hasFullDate = e.orig_year != null && e.orig_month != null && e.orig_day != null;
  // источник для низа: ручной source_label, иначе — название произведения (work_title)
  const sourceLabel = e.source_label?.trim() || prettifyTitle(e.work_title ?? "");

  if (e.footer_kind === "date" && hasFullDate)
    return { kind: "date", year: e.orig_year!, month: e.orig_month, day: e.orig_day };
  if (e.footer_kind === "source" && sourceLabel)
    return { kind: "source", source_label: sourceLabel };
  if (hasFullDate) return { kind: "date", year: e.orig_year!, month: e.orig_month, day: e.orig_day };
  if (sourceLabel) return { kind: "source", source_label: sourceLabel };
  return null;
}
