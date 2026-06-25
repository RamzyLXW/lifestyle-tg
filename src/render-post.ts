// CLI: примеры поста (превью, без Telegram). Шапку канала Telegram добавляет сам — её в тексте нет.
import { renderPostPreview, renderPostHtml, type RenderInput } from "./render.js";

const dated: RenderInput = {
  excerpt: "Сколько лет потерянных! Сколько цветов увядших! И что же я купил у судьбы своими усилиями — не погибнуть?",
  footer: { kind: "date", year: 1860, month: 2, day: 18 },
};
const quote: RenderInput = {
  excerpt: "Тече вода в синє море, та не витікає…",
  footer: { kind: "source", source_label: "Думка" },
};

console.log("======== dated (есть дата) → дата + возраст ========");
console.log(renderPostPreview(dated));
console.log("\n— HTML —\n" + renderPostHtml(dated));

console.log("\n\n======== quote (нет даты) → источник ========");
console.log(renderPostPreview(quote));
console.log("\n— HTML —\n" + renderPostHtml(quote));
