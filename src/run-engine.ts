// CLI: выбрать запись на день и собрать пост (без отправки).
//   npm run engine                 — на сегодня
//   npm run engine -- --date 18.02 — на конкретный день (тест стратегии «в этот день»)
import { Store } from "./db.js";
import { selectEntry, chooseFooter, labelKey, COOLDOWN_DAYS, type Selectable } from "./engine.js";
import { renderPostPreview, renderPostHtml, type RenderInput } from "./render.js";

function parseToday(): { month: number; day: number } {
  const i = process.argv.indexOf("--date");
  if (i !== -1 && process.argv[i + 1]) {
    const [d, m] = process.argv[i + 1]!.split(/[.\-/]/).map(Number);
    if (d && m) return { month: m, day: d };
  }
  const now = new Date();
  return { month: now.getMonth() + 1, day: now.getDate() };
}

function main() {
  const today = parseToday();
  const store = new Store();
  const pool = store.approvedUnpublished() as unknown as Selectable[];
  const recentLabels = new Set(
    store.recentlyPublished(COOLDOWN_DAYS).map(labelKey).filter((k) => k !== ""),
  );
  store.close();

  console.log(
    `Пул (approved + не опубликовано): ${pool.length} | под кулдауном подписей: ${recentLabels.size} | день ${today.day}.${today.month}\n`,
  );

  const { entry, strategy, relaxedCooldown } = selectEntry(pool, today, { recentLabels });
  if (relaxedCooldown) console.log("ℹ️  90-дневный кулдаун по подписи снят (все кандидаты под ним).\n");
  if (!entry) {
    console.log("⚠️  нечего постить (пул пуст / всё опубликовано) — ПРОПУСК дня + алерт (бриф п.5).");
    return;
  }

  const strategyRu = strategy === "on-this-day" ? "«в этот день»" : "фолбэк: случайная интересная";
  if (!entry.excerpt?.trim()) {
    console.log(`⚠️  запись ${entry.source_id} одобрена, но выжимка пуста — пропуск + алерт.`);
    return;
  }

  const footer = chooseFooter(entry);
  if (!footer) {
    console.log(`⚠️  у ${entry.source_id} нет ни даты, ни источника для низа поста — пропуск.`);
    return;
  }

  const input: RenderInput = { excerpt: entry.excerpt, footer };
  console.log(`стратегия: ${strategyRu} | запись: ${entry.source_id} | footer: ${footer.kind}\n`);
  console.log("============ ПОСТ (превью) ============");
  console.log(renderPostPreview(input));
  console.log("\n============ HTML (Telegram) ============");
  console.log(renderPostHtml(input));
}

main();
