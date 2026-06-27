// Постер (бриф, п.3.5): движок выбирает запись -> рендер -> sendMessage -> пишем published_at.
//   npm run post -- --check          проверка токена и канала (getMe + getChat), без отправки
//   npm run post -- --dry-run        выбрать и показать пост, НЕ отправлять
//   npm run post -- --date 18.02     выбрать на конкретный день
//   npm run post                     выбрать на сегодня и ОТПРАВИТЬ в канал
import fs from "node:fs";
import { Store } from "./db.js";
import { selectEntry, chooseFooter, labelKey, COOLDOWN_DAYS, type Selectable } from "./engine.js";
import { renderPostHtml, renderPostPreview, type RenderInput } from "./render.js";
import { requireEnv } from "./config.js";
import { getMe, getChat, sendMessage } from "./telegram.js";

function parseToday(): { month: number; day: number } {
  const i = process.argv.indexOf("--date");
  if (i !== -1 && process.argv[i + 1]) {
    const [d, m] = process.argv[i + 1]!.split(/[.\-/]/).map(Number);
    if (d && m) return { month: m, day: d };
  }
  const now = new Date();
  return { month: now.getMonth() + 1, day: now.getDate() };
}

async function check() {
  const me = await getMe();
  console.log(`✓ бот: @${me.username} (id ${me.id})`);
  const chatId = requireEnv("TELEGRAM_CHAT_ID");
  const chat = await getChat(chatId);
  console.log(`✓ канал: ${chat.title ?? chat.username ?? chat.id} (type=${chat.type}, id=${chat.id})`);
  console.log("Токен и доступ к каналу в порядке. Можно постить.");
}

async function post() {
  const dryRun = process.argv.includes("--dry-run");
  const today = parseToday();

  const store = new Store();
  const pool = store.approvedUnpublished() as unknown as Selectable[];
  const recentLabels = new Set(
    store.recentlyPublished(COOLDOWN_DAYS).map(labelKey).filter((k) => k !== ""),
  );
  const { entry, strategy, relaxedCooldown } = selectEntry(pool, today, { recentLabels });

  if (relaxedCooldown) {
    console.log(`ℹ️  90-дневный кулдаун по подписи снят: все кандидаты недавно использовали свой ярлык.`);
  }

  if (!entry) {
    console.log("⚠️  нечего постить (пул пуст / всё опубликовано) — ПРОПУСК дня + алерт (бриф п.5).");
    store.close();
    return;
  }
  if (!entry.excerpt?.trim()) {
    console.log(`⚠️  ${entry.source_id} одобрена, но выжимка пуста — пропуск + алерт.`);
    store.close();
    return;
  }
  const footer = chooseFooter(entry);
  if (!footer) {
    console.log(`⚠️  у ${entry.source_id} нет ни даты, ни источника для низа — пропуск.`);
    store.close();
    return;
  }

  const input: RenderInput = { excerpt: entry.excerpt, footer };
  const html = renderPostHtml(input);
  const stratRu = strategy === "on-this-day" ? "«в этот день»" : "фолбэк: случайная интересная";
  console.log(`стратегия: ${stratRu} | запись: ${entry.source_id} | footer: ${footer.kind}\n`);
  console.log(renderPostPreview(input));

  if (dryRun) {
    console.log("\n— DRY-RUN: не отправлено, published_at не записан —");
    store.close();
    return;
  }

  const chatId = requireEnv("TELEGRAM_CHAT_ID");
  const iso = new Date().toISOString();
  const sent = await sendMessage(chatId, html);
  store.markPublished(entry.source_id, iso);
  store.close();
  // Журнал для НАДЁЖНОГО сохранения состояния в CI: после отправки в Telegram воркфлоу берёт
  // свежую БД из origin и заново ставит этот published_at (см. src/mark-published.ts), чтобы
  // гонка git push не «потеряла» публикацию и стих не вышел повторно (баг 26→27.06 с shev107).
  fs.writeFileSync(".last-post.json", JSON.stringify({ source_id: entry.source_id, published_at: iso }));
  console.log(`\n✓ опубликовано в ${chatId} (message_id ${sent.message_id}), published_at записан.`);
}

const run = process.argv.includes("--check") ? check() : post();
run.catch((e) => {
  console.error("✗ ошибка постера:", e instanceof Error ? e.message : e);
  process.exit(1);
});
