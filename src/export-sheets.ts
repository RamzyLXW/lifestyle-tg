// Экспорт базы -> Google Sheets для ручной вычитки (бриф, п.2 + п.10).
// Идемпотентно и БЕЗ затирания вычитки:
//   - новый source_id            -> добавить строку (excerpt уже заполнен топ-подсказкой);
//   - есть, excerpt пуст, !approved -> бэкфилл подсказок (excerpt + alt_excerpts);
//   - есть, excerpt заполнен / approved -> не трогать.
//
// Запуск:  SHEVCHENKO_SHEET_ID=<id> npm run export
// Перед этим расшарить таблицу на service-account (Editor):
//   telegram-bot@steady-habitat-485620-a6.iam.gserviceaccount.com
import { Store } from "./db.js";
import { rankExcerpts } from "./excerpt.js";
import { getSheets, type Sheets, SHEET_NAME, requireSpreadsheetId } from "./sheets.js";

// Колонки. Слева — под вычитку; excerpt/alt_excerpts префиллим подсказками.
const HEADERS = [
  "source_id",     // A — ключ (идемпотентность)
  "excerpt",       // B — выжимка (префилл = топ-кандидат, правится руками)
  "source_label",  // C — вычитка: точное название источника
  "footer_kind",   // D — вычитка: date | source
  "approved",      // E — вычитка: 1/0
  "interesting",   // F — вычитка: 1/0
  "orig_year",     // G
  "orig_month",    // H
  "orig_day",      // I
  "date_precision",// J
  "kind",          // K
  "published_at",  // L — журнал антиповтора
  "work_title",    // M
  "citation",      // N
  "source_url",    // O
  "text",          // P — полный авторский текст (справочно)
  "imported_at",   // Q
  "alt_excerpts",  // R — другие кандидаты (подсказка)
] as const;
const LAST_COL = "R";
const COL_EXCERPT = "B";
const COL_ALT = "R";

function suggestions(text: string): { top: string; alts: string } {
  const c = rankExcerpts(text, 4);
  return {
    top: c[0]?.text ?? "",
    alts: c.slice(1).map((x) => x.text).join("\n\n"),
  };
}

async function ensureSheet(sheets: Sheets, spreadsheetId: string): Promise<void> {
  const writeHeaders = () =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS as unknown as string[]] },
    });
  // шапка фиксированная — пишем безусловно (идемпотентно; так подхватываются новые колонки)
  try {
    await writeHeaders();
  } catch (error) {
    if (!((error as Error).message ?? "").includes("Unable to parse range")) throw error;
    console.log(`⚠️  лист '${SHEET_NAME}' не найден — создаю`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    await writeHeaders();
    console.log(`📋 лист '${SHEET_NAME}' создан с заголовками`);
  }
}

interface SheetRow {
  rowNum: number; // номер строки в таблице (с 1)
  cells: string[]; // все ячейки строки (A..R)
}

const colIdx = (letter: string) => letter.charCodeAt(0) - 65; // A=0, B=1, ...

// Лимит ячейки Google Sheets — 50000 символов. Длинный справочный text (напр. «Гайдамаки» ~59 КБ)
// режем — это только справка для вычитки, цитата (excerpt) уже отобрана.
const MAX_CELL = 49000;
const cap = (s: string) => (s.length > MAX_CELL ? s.slice(0, MAX_CELL) + "…[обрізано]" : s);

// Даты человек правит при вычитке -> только ДОЗАПОЛНЯЕМ пустое (не затираем правки).
const FILL_ONLY_COLS: ReadonlyArray<readonly [string, string]> = [
  ["G", "orig_year"], ["H", "orig_month"], ["I", "orig_day"],
];
// Поля импортёра человек не трогает -> СИНХРОНИЗИРУЕМ с базой (перезапись при расхождении).
const SYNC_COLS: ReadonlyArray<readonly [string, string]> = [
  ["J", "date_precision"], ["K", "kind"], ["M", "work_title"],
  ["N", "citation"], ["O", "source_url"], ["P", "text"], ["Q", "imported_at"],
];
// Вычитку не трогаем никогда: excerpt/source_label/footer_kind/approved/interesting/published_at.

async function readRows(sheets: Sheets, spreadsheetId: string): Promise<Map<string, SheetRow>> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:${LAST_COL}`,
  });
  const map = new Map<string, SheetRow>();
  (res.data.values ?? []).forEach((r, i) => {
    const sid = String(r[0] ?? "");
    if (sid) map.set(sid, { rowNum: i + 2, cells: (r as unknown[]).map((c) => String(c ?? "")) });
  });
  return map;
}

function toRow(e: Record<string, unknown>, top: string, alts: string): string[] {
  const v = (k: string) => (e[k] == null ? "" : String(e[k]));
  // Предложения куратора (Роль 2a) уже в БД — выносим их в таблицу как префилл.
  // Если куратор не отработал, excerpt = эвристическая подсказка (top), остальное пусто.
  const excerpt = v("excerpt") || top;
  return [
    v("source_id"), excerpt, v("source_label"), v("footer_kind"),
    v("approved"), v("interesting"),
    v("orig_year"), v("orig_month"), v("orig_day"), v("date_precision"),
    v("kind"), v("published_at"), v("work_title"), v("citation"),
    v("source_url"), cap(v("text")), v("imported_at"), alts,
  ];
}

async function main() {
  const spreadsheetId = requireSpreadsheetId();

  const store = new Store();
  const entries = store.all();
  store.close();

  const sheets = await getSheets();
  await ensureSheet(sheets, spreadsheetId);
  const existing = await readRows(sheets, spreadsheetId);

  const appendRows: string[][] = [];
  const backfill: { range: string; values: string[][] }[] = [];
  let backfilledRows = 0;
  let skipped = 0;

  for (const e of entries) {
    const sid = String(e["source_id"]);
    const { top, alts } = suggestions(String(e["text"] ?? ""));
    const row = existing.get(sid);

    if (!row) {
      appendRows.push(toRow(e, top, alts));
      continue;
    }

    const cell = (L: string) => (row.cells[colIdx(L)] ?? "").trim();
    if (cell("E") === "1") { // одобрено — вычитка завершена, не трогаем
      skipped++;
      continue;
    }

    const put = (L: string, val: string) =>
      backfill.push({ range: `${SHEET_NAME}!${L}${row.rowNum}`, values: [[val]] });

    let touched = false;
    // выжимка: предпочитаем предложение куратора (БД), иначе эвристика — только если в таблице пусто
    const excerptFill = (e["excerpt"] == null ? "" : String(e["excerpt"])) || top;
    if (!cell(COL_EXCERPT) && excerptFill) { put(COL_EXCERPT, excerptFill); touched = true; }
    if (!cell(COL_ALT) && alts) { put(COL_ALT, alts); touched = true; }
    // предложения куратора (source_label/footer_kind) — дозаполняем только пустое (не затираем правки)
    for (const [L, key] of [["C", "source_label"], ["D", "footer_kind"]] as const) {
      const dbv = e[key] == null ? "" : String(e[key]);
      if (!cell(L) && dbv) { put(L, dbv); touched = true; }
    }
    // даты — дозаполняем только пустое (не затираем ручные правки)
    for (const [L, key] of FILL_ONLY_COLS) {
      const dbv = e[key] == null ? "" : String(e[key]);
      if (!cell(L) && dbv) { put(L, dbv); touched = true; }
    }
    // поля импортёра — синхронизируем (перезапись при расхождении)
    for (const [L, key] of SYNC_COLS) {
      const dbv = cap(e[key] == null ? "" : String(e[key]));
      if (dbv && cell(L) !== dbv) { put(L, dbv); touched = true; }
    }

    if (touched) backfilledRows++;
    else skipped++;
  }

  if (appendRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A:${LAST_COL}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: appendRows },
    });
  }
  if (backfill.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: backfill },
    });
  }

  console.log(`✓ добавлено ${appendRows.length}, бэкфилл строк ${backfilledRows} (ячеек ${backfill.length}), пропущено ${skipped}`);
  console.log(`  таблица: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
}

main().catch((e) => {
  console.error("✗ ошибка экспорта:", e instanceof Error ? e.message : e);
  process.exit(1);
});
