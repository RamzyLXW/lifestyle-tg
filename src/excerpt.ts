// Нарезка авторского текста на короткие цитаты-кандидаты для выжимки (1-3 предложения).
// Это ПОДСКАЗКА для ручной вычитки, а не финальный выбор: человек берёт лучшую в таблице.
// Эвристика, без ИИ: сплит на предложения + простое ранжирование «постится ли как самостоятельная мысль».

const MIN_LEN = 40; // короче — обрывок
const MAX_LEN = 240; // длиннее — не «выжимка»
const MAX_SENT = 3;

const DOT_PH = "@@DOT@@"; // временно вместо точки в инициалах, чтобы не дробить «С. Т. Аксаков»

/** Разбивка на предложения. Бережём инициалы от ложных границ:
 *  точку после одиночной заглавной буквы заменяем на сентинел, после сплита возвращаем. */
export function splitSentences(text: string): string[] {
  const flat = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([А-ЯЁA-ZІЇЄҐ])\.(?=\s)/g, `$1${DOT_PH}`);
  const parts = flat.split(/(?<=[.!?…])\s+(?=[«"„(]?[А-ЯЁA-ZІЇЄҐ])/);
  return parts
    .map((s) => s.split(DOT_PH).join(".").trim())
    .filter((s) => s.length > 0);
}

export interface Candidate {
  text: string;
  sentences: number;
  len: number;
  score: number;
}

function scoreExcerpt(text: string, sentences: number): number {
  let s = 0;
  const len = text.length;

  if (/[!?]/.test(text)) s += 3; // эмоциональный удар (как в образце)
  if (/[«"„].+?[»"“]/.test(text)) s += 1; // содержит прямую речь/кавычки

  // параллелизм/анафора: слово (≥4 букв) повторяется — «Сколько… Сколько…»
  const words = text.toLowerCase().match(/[а-яёіїєґa-z]{4,}/g) ?? [];
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  if ([...freq.values()].some((n) => n >= 2)) s += 2;

  // длина: окно «твитабельности»
  if (len >= 60 && len <= 170) s += 2;
  else if (len >= MIN_LEN && len <= MAX_LEN) s += 1;
  else s -= 2;

  if (sentences <= 2) s += 1; // короче — лучше

  // даты/инициалы/ссылки на источники — менее «вечная» цитата
  const digits = text.match(/\d/g)?.length ?? 0;
  if (digits >= 3) s -= 3;
  const initials = text.match(/\b[А-ЯЁA-ZІЇЄҐ]\./g)?.length ?? 0;
  if (initials >= 2) s -= 2;

  return s;
}

/** Топ цитат-кандидатов: окна из 1..3 соседних предложений в пределах длины, по убыванию score. */
export function rankExcerpts(text: string, limit = 5): Candidate[] {
  const sents = splitSentences(text);
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (let i = 0; i < sents.length; i++) {
    let acc = "";
    for (let n = 1; n <= MAX_SENT && i + n <= sents.length; n++) {
      acc = (acc ? acc + " " : "") + sents[i + n - 1];
      const t = acc.trim();
      if (t.length < MIN_LEN || t.length > MAX_LEN) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push({ text: t, sentences: n, len: t.length, score: scoreExcerpt(t, n) });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
