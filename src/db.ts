// Локальная база (бриф: «парсим сайт один раз к себе, дальше живём из своей базы»).
// node:sqlite — встроен в Node 22, без нативной сборки. Колонки = модель из п.4.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedEntry } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB = path.join(__dirname, "..", "shevchenko.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     TEXT UNIQUE NOT NULL,   -- идемпотентность: повторный импорт не плодит дубли
  source_url    TEXT NOT NULL,
  author        TEXT NOT NULL,
  work_title    TEXT,
  text          TEXT NOT NULL,          -- авторский текст (без сносок)
  orig_year     INTEGER,
  orig_month    INTEGER,                -- 1..12, NULL у неполных дат
  orig_day      INTEGER,                -- 1..31, NULL у неполных дат
  date_precision TEXT NOT NULL,         -- day | month | year | none
  kind          TEXT NOT NULL,          -- diary | letter | poem | other
  citation      TEXT,
  approved      INTEGER NOT NULL DEFAULT 0,  -- ставит человек при вычитке
  interesting   INTEGER NOT NULL DEFAULT 0,  -- ставит человек при вычитке
  published_at  TEXT,                        -- журнал антиповтора (пусто = не постили)
  notes_dropped INTEGER NOT NULL DEFAULT 0,  -- диагностика парсера
  imported_at   TEXT NOT NULL
);
-- для стратегии «в этот день»
CREATE INDEX IF NOT EXISTS idx_entries_md ON entries(orig_month, orig_day);
`;

// Колонки вычитки приходят из таблицы (round-trip Sheet -> DB). Добавляем мягко (миграция).
const REVIEW_COLUMNS = [
  ["excerpt", "TEXT"],
  ["source_label", "TEXT"],
  ["footer_kind", "TEXT"], // date | source
] as const;

export interface UpsertResult {
  action: "inserted" | "updated" | "skipped";
}

export class Store {
  private db: DatabaseSync;

  constructor(file: string = DEFAULT_DB) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
    // мягкая миграция: добавить колонки вычитки, если их ещё нет
    for (const [name, type] of REVIEW_COLUMNS) {
      try {
        this.db.exec(`ALTER TABLE entries ADD COLUMN ${name} ${type}`);
      } catch {
        /* колонка уже есть — ок */
      }
    }
  }

  /**
   * Идемпотентная вставка по source_id.
   *  - новой записи нет        -> INSERT;
   *  - есть и НЕ одобрена       -> UPDATE распарсенных полей (бэкфилл улучшений парсера);
   *  - есть и approved=1        -> НЕ трогаем (защищаем ручную вычитку).
   * Поля вычитки (approved/interesting/published_at) не перезаписываем никогда (бриф п.3.1/п.6).
   */
  upsert(e: ParsedEntry, importedAt: string): UpsertResult {
    const existing = this.get(e.source_id) as { approved?: number } | undefined;

    const stmt = this.db.prepare(`
      INSERT INTO entries
        (source_id, source_url, author, work_title, text,
         orig_year, orig_month, orig_day, date_precision, kind,
         citation, notes_dropped, imported_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source_id) DO UPDATE SET
        source_url=excluded.source_url, work_title=excluded.work_title, text=excluded.text,
        orig_year=excluded.orig_year, orig_month=excluded.orig_month, orig_day=excluded.orig_day,
        date_precision=excluded.date_precision, kind=excluded.kind,
        citation=excluded.citation, notes_dropped=excluded.notes_dropped, imported_at=excluded.imported_at
      WHERE entries.approved = 0
    `);
    stmt.run(
      e.source_id, e.source_url, e.author, e.work_title, e.text,
      e.orig_date.year, e.orig_date.month, e.orig_date.day, e.orig_date.precision, e.kind,
      e.citation, e.notes_dropped, importedAt,
    );

    if (!existing) return { action: "inserted" };
    return { action: existing.approved ? "skipped" : "updated" };
  }

  get(source_id: string): Record<string, unknown> | undefined {
    return this.db
      .prepare("SELECT * FROM entries WHERE source_id = ?")
      .get(source_id) as Record<string, unknown> | undefined;
  }

  all(): Record<string, unknown>[] {
    return this.db
      .prepare("SELECT * FROM entries ORDER BY id")
      .all() as Record<string, unknown>[];
  }

  /** Записать вычитанные поля из таблицы (round-trip Sheet -> DB). Обновляет только переданное. */
  updateReviewed(sid: string, r: Record<string, string | number | null>): boolean {
    const cols: string[] = [];
    const vals: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(r)) {
      if (v === undefined) continue;
      cols.push(`${k} = ?`);
      vals.push(v);
    }
    if (cols.length === 0) return false;
    vals.push(sid);
    const info = this.db
      .prepare(`UPDATE entries SET ${cols.join(", ")} WHERE source_id = ?`)
      .run(...vals);
    return info.changes > 0;
  }

  /** Одобренные и ещё НЕ опубликованные (антиповтор) — пул для движка выбора. */
  approvedUnpublished(): Record<string, unknown>[] {
    return this.db
      .prepare(
        "SELECT * FROM entries WHERE approved = 1 AND (published_at IS NULL OR published_at = '') ORDER BY id",
      )
      .all() as Record<string, unknown>[];
  }

  /** Отметить публикацию (журнал антиповтора). */
  markPublished(sid: string, iso: string): void {
    this.db.prepare("UPDATE entries SET published_at = ? WHERE source_id = ?").run(iso, sid);
  }

  /** Тексты выжимок, опубликованные за последние `days` дней (для кулдауна по тексту). */
  recentlyPublished(days: number): { excerpt: string | null }[] {
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = this.db
      .prepare(
        "SELECT excerpt, published_at FROM entries WHERE published_at IS NOT NULL AND published_at != ''",
      )
      .all() as { excerpt: string | null; published_at: string }[];
    return rows.filter((r) => {
      const t = Date.parse(r.published_at);
      return Number.isFinite(t) && t >= cutoffMs;
    });
  }

  /** Удалить запись (напр. blob-дневник заменяем разрезанными записями, или чистим аппарат). */
  remove(sid: string): number {
    return Number(this.db.prepare("DELETE FROM entries WHERE source_id = ?").run(sid).changes);
  }

  count(): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM entries").get() as { n: number };
    return r.n;
  }

  close(): void {
    this.db.close();
  }
}
