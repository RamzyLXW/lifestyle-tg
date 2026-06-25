// Round-trip: Google Sheets -> SQLite. Тянем РУЧНУЮ вычитку обратно в базу,
// чтобы движок выбора работал из локальной базы (бриф: «живём из своей базы»).
//   SHEVCHENKO_SHEET_ID=<id> npm run import:sheet
//
// Переносим: excerpt, source_label, footer_kind, approved, interesting и
// исправленные человеком дату (orig_year/month/day). Распарсенный текст не трогаем.
import { Store } from "./db.js";
import { getSheets, SHEET_NAME, requireSpreadsheetId } from "./sheets.js";

const num = (s: unknown): number | null => {
  const v = String(s ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const flag = (s: unknown): number => (String(s ?? "").trim() === "1" ? 1 : 0);
const str = (s: unknown): string => String(s ?? "").trim();

async function main() {
  const spreadsheetId = requireSpreadsheetId();
  const sheets = await getSheets();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:R`,
  });
  const rows = res.data.values ?? [];

  const store = new Store();
  let updated = 0;
  let approved = 0;
  let missing = 0;

  for (const r of rows) {
    const sid = str(r[0]); // A
    if (!sid) continue;
    if (!store.get(sid)) { missing++; continue; } // в таблице есть, в базе нет — пропуск

    const isApproved = flag(r[4]); // E
    const fields: Record<string, string | number | null> = {
      excerpt: str(r[1]) || null,      // B
      source_label: str(r[2]) || null, // C
      footer_kind: str(r[3]) || null,  // D
      approved: isApproved,            // E
      interesting: flag(r[5]),         // F
      orig_year: num(r[6]),            // G
      orig_month: num(r[7]),           // H
      orig_day: num(r[8]),             // I
    };
    store.updateReviewed(sid, fields);
    updated++;
    if (isApproved) approved++;
  }

  store.close();
  console.log(`✓ обновлено из таблицы: ${updated} (одобрено: ${approved}, нет в базе: ${missing})`);
}

main().catch((e) => {
  console.error("✗ ошибка import:sheet:", e instanceof Error ? e.message : e);
  process.exit(1);
});
