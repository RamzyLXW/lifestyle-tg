// Агент-куратор (Роль 2a, RUBRIC.md). Читает украинский стих → предлагает выжимку (excerpt),
// source_label и флаг interesting. Человек ставит ТОЛЬКО approved=1 (бриф п.3.2 / RUBRIC).
// Пишет в review-колонки БД (excerpt/source_label/footer_kind/interesting); дальше `export` гонит в Sheets.
//
//   npm run curate                  # все некурированные укр. стихи
//   npm run curate -- --limit 5     # первые 5 (проверить качество перед прогоном по всем)
//   npm run curate -- --source-id shev146
//   npm run curate -- --list        # показать, что будет курировано — БЕЗ обращения к API
//   npm run curate -- --dry-run     # звать API и печатать предложения, НО не писать в БД
//   npm run curate -- --force       # перекурировать даже уже заполненные excerpt
//   npm run curate -- --concurrency 2 --effort high
//
// Секрет: ANTHROPIC_API_KEY в .env. Русские стихи/дневник куратор пропускает — им нужен шаг перевода.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { Store } from "./db.js";
import { loadEnv, requireEnv } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUBRIC_PATH = path.join(__dirname, "..", "RUBRIC.md");
const MODEL = "claude-opus-4-8";

// Структурированный вывод (output_config.format). Ограничения JSON-схемы строгие:
// только базовые типы + additionalProperties:false, без min/maxLength.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    take: {
      type: "boolean",
      description: "Проходит ли фрагмент чек-лист рубрики и стоит ли его постить.",
    },
    excerpt: {
      type: "string",
      description:
        "Самодостаточная цитата 1–3 предложения, СКОПИРОВАННАЯ ДОСЛОВНО из текста (украинский, оригинальная орфография).",
    },
    source_label: {
      type: "string",
      description: "Название произведения или первая строка стиха — для низа поста.",
    },
    reason: { type: "string", description: "Одно короткое предложение: почему take/skip." },
  },
  required: ["take", "excerpt", "source_label", "reason"],
} as const;

interface Proposal {
  take: boolean;
  excerpt: string;
  source_label: string;
  reason: string;
}

function buildSystem(): string {
  const rubric = readFileSync(RUBRIC_PATH, "utf-8");
  return `Ты — редактор-куратор телеграм-канала «Тарас Шевченко. Лайфстайл».
Тебе дают ОДНО произведение Шевченко (украинский стих). Найди ВНУТРИ него одну самодостаточную мысль
(1–3 предложения), которая цепляет вне контекста и звучит как живое высказывание современника, и оцени
её по «рубрике вкуса» владельца канала.

РУБРИКА ВКУСА (общий критерий — следуй ей буквально):
---
${rubric}
---

Правила вывода:
- excerpt: СКОПИРУЙ ДОСЛОВНО фрагмент из текста. Украинский язык, оригинальная орфография — НЕ переводи,
  НЕ модернизируй, НЕ переставляй и не заменяй слова. Можно только убрать переносы строк (соединив строки
  пробелом). Слова и их формы — ровно как в оригинале.
- Длина excerpt — ориентир ~40–240 символов; законченная мысль, не обрывок.
- source_label: название произведения, если оно есть; иначе первая строка стиха.
- take=true только если фрагмент проходит чек-лист «Берём» и не попадает в «Не берём». Если стих весь
  «мимо» — take=false, но всё равно верни лучший возможный excerpt (его увидит человек при вычитке).
- reason: одно короткое предложение по-русски.
Отвечай строго по схеме.`;
}

/** «Скелет слов»: только буквы/цифры в нижнем регистре через пробел.
 *  Терпим к пунктуации и переносам строк, но ловит изменённые/выдуманные слова. */
function skeleton(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Эвристика: русский текст? (для отсева — русские стихи идут через шаг перевода, не сюда). */
function isRussian(t: string): boolean {
  const ru = (t.match(/[ыэъ]/g) ?? []).length;
  const ua = (t.match(/[іїєґ]/g) ?? []).length;
  return ru > 3 && ru > ua;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

/** Один прогон модели по стиху. Возвращает предложение или бросает. */
async function propose(
  client: Anthropic,
  system: string,
  effort: "low" | "medium" | "high" | "max",
  poemText: string,
  workTitle: string,
  insist: boolean,
): Promise<Proposal> {
  const userText =
    (insist
      ? "ВАЖНО: excerpt должен быть СЛОВО В СЛОВО из текста ниже (можно убрать только переносы строк).\n\n"
      : "") + `Произведение: ${workTitle || "(без названия)"}\n\nТекст:\n${poemText}`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    output_config: { effort, format: { type: "json_schema", schema: SCHEMA } },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userText }],
  });

  if (res.stop_reason === "refusal") throw new Error("отказ модели (refusal)");
  const block = res.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!block) throw new Error("нет текстового блока в ответе");
  return JSON.parse(block.text) as Proposal;
}

/** Пул с ограниченной параллельностью (вежливо к API; SDK сам ретраит 429). */
async function runPool<T>(items: T[], n: number, worker: (item: T, i: number) => Promise<void>) {
  let idx = 0;
  const next = async (): Promise<void> => {
    const i = idx++;
    if (i >= items.length) return;
    await worker(items[i]!, i);
    return next();
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, next));
}

async function main() {
  const list = flag("--list");
  const dryRun = flag("--dry-run");
  const force = flag("--force");
  const limit = Number(arg("--limit") || 0);
  const sourceId = arg("--source-id");
  const concurrency = Math.max(1, Number(arg("--concurrency") || 3));
  const effort = (arg("--effort") || "medium") as "low" | "medium" | "high" | "max";

  const store = new Store();
  let targets = store.all().filter((e) => {
    if (sourceId) return e["source_id"] === sourceId;
    if (e["kind"] !== "poem") return false;
    if (Number(e["approved"]) === 1) return false; // вычитку не трогаем
    if (!force && String(e["excerpt"] ?? "").trim()) return false; // уже курировано
    if (isRussian(String(e["text"] ?? ""))) return false; // русские — через перевод
    return true;
  });
  if (limit > 0) targets = targets.slice(0, limit);

  console.log(
    `Куратор: к обработке ${targets.length} стих(ов)` +
      (force ? " (--force)" : "") +
      (sourceId ? ` (source-id=${sourceId})` : "") +
      `; модель ${MODEL}, effort=${effort}, concurrency=${concurrency}` +
      (dryRun ? " [DRY-RUN]" : list ? " [LIST]" : ""),
  );

  if (list) {
    for (const e of targets) console.log(`  ${e["source_id"]}  ${String(e["work_title"] ?? "")}`);
    store.close();
    return;
  }
  if (targets.length === 0) {
    console.log("Нечего курировать (всё уже сделано или нет подходящих записей).");
    store.close();
    return;
  }

  loadEnv();
  const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  const system = buildSystem();

  let ok = 0,
    skipped = 0,
    notVerbatim = 0,
    failed = 0;

  await runPool(targets, concurrency, async (e, i) => {
    const sid = String(e["source_id"]);
    const poemText = String(e["text"] ?? "");
    const workTitle = String(e["work_title"] ?? "");
    try {
      let p = await propose(client, system, effort, poemText, workTitle, false);
      let verbatim = skeleton(poemText).includes(skeleton(p.excerpt));
      if (!verbatim) {
        // одна попытка-настойка: дословно
        p = await propose(client, system, effort, poemText, workTitle, true);
        verbatim = skeleton(poemText).includes(skeleton(p.excerpt));
      }
      const interesting = p.take && verbatim ? 1 : 0;
      const reason = verbatim ? p.reason : `⚠ не дословно: ${p.reason}`;
      if (!verbatim) notVerbatim++;
      else if (p.take) ok++;
      else skipped++;

      const tag = !verbatim ? "⚠ НЕ ДОСЛОВНО" : p.take ? "✓ берём" : "· мимо";
      console.log(
        `[${i + 1}/${targets.length}] ${sid} ${tag}\n   «${p.excerpt}»\n   ↳ ${p.source_label} — ${reason}`,
      );

      if (!dryRun) {
        store.updateReviewed(sid, {
          excerpt: p.excerpt,
          source_label: p.source_label,
          footer_kind: "source", // стихи: низ = название (даты нет)
          interesting,
        });
      }
    } catch (err) {
      failed++;
      console.error(`[${i + 1}/${targets.length}] ${sid} ✗ ${err instanceof Error ? err.message : err}`);
    }
  });

  store.close();
  console.log(
    `\nГотово: годных ${ok}, мимо ${skipped}, не-дословно ${notVerbatim}, ошибок ${failed}` +
      (dryRun ? " (DRY-RUN — в БД не записано)" : ". Дальше: `npm run export` → вычитка в Sheets → `npm run import:sheet`."),
  );
}

main().catch((e) => {
  console.error("✗ ошибка curate:", e instanceof Error ? e.message : e);
  process.exit(1);
});
