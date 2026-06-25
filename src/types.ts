// Нормализованная модель записи (бриф, п.4).
// Движок выбора видит ТОЛЬКО это, не зная про устройство сайта.

export type DatePrecision = "day" | "month" | "year" | "none";
export type EntryKind = "diary" | "letter" | "poem" | "other";

export interface OrigDate {
  year: number | null;
  month: number | null; // 1..12
  day: number | null; // 1..31
  precision: DatePrecision;
}

export interface ParsedEntry {
  /** стабильный признак записи на сайте (URL+якорь / имя страницы) — для идемпотентности */
  source_id: string;
  source_url: string;
  author: string; // «Тарас Шевченко»
  work_title: string | null; // напр. «ДУМКА»
  text: string; // авторский текст (без редакторских сносок)
  orig_date: OrigDate; // дата оригинала — у писем/стихов может быть неполной
  kind: EntryKind;
  citation: string | null; // том + страница издания
  /** диагностика парсинга: сколько абзацев редакторского аппарата отброшено */
  notes_dropped: number;
}
