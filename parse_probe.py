#!/usr/bin/env python3
"""
Разведочный экстрактор ОДНОЙ страницы litopys.org.ua (бриф, п.8).
Не импортёр. Цель — честно показать, что извлекается из страницы:
  - авторский текст чисто (без редакторских примечаний),
  - дата в машинном виде,
  - стабильный source_id.

Ключевая находка по вёрстке:
  <p class="K1">   -> авторский текст (и навигация/пустые <br> — отсеиваем)
  <p class="Prym"> -> редакторский аппарат (примечания, источники) — НЕ берём
  <strong id="pageNNN">/NNN/</strong> -> вшитые маркеры страниц печатного изд. — вырезаем
"""
import re
import sys
import html
from pathlib import Path

NAV_WORDS = {"Попередня", "Головна", "Наступна", "Варіанти"}


def strip_tags(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).replace("\xa0", " ").strip()


def extract(html_text: str, url: str) -> dict:
    # source_id: имя страницы — стабильный признак
    page = url.rsplit("/", 1)[-1]

    # заголовок произведения: первый <h2><b>...</b></h2> не равный году
    titles = re.findall(r"<h2>\s*<b>(.*?)</b>\s*</h2>", html_text, re.S)
    titles = [strip_tags(t) for t in titles]
    year = next((t for t in titles if re.fullmatch(r"\d{4}", t)), None)
    work_title = next((t for t in titles if not re.fullmatch(r"\d{3,4}", t)), None)

    # цитата-источник: <small>[ ... ]</small> -> том/страница
    src = re.search(r"<small>\s*\[(.*?)\]\s*</small>", html_text, re.S)
    citation = strip_tags(src.group(1)) if src else None

    # все абзацы с классом
    paras = re.findall(r'<p\s+class=(K1|Prym)\b[^>]*>(.*?)</p>', html_text, re.S)

    author_lines, notes_lines = [], []
    for cls, raw in paras:
        # вырезаем вшитые маркеры страниц /NNN/
        raw = re.sub(r'<strong[^>]*>\s*/\d+/\s*</strong>', "", raw)
        # навигация и цитата свёрстаны как <p class=K1> со ссылками/<small> —
        # авторский текст ссылок не содержит, поэтому такие абзацы отсекаем
        if re.search(r'<a\b', raw) or re.search(r'<small\b', raw):
            continue
        txt = strip_tags(raw)
        if not txt:                       # пустые <br>-абзацы
            continue
        if txt in NAV_WORDS:              # одиночные навигационные слова
            continue
        (author_lines if cls == "K1" else notes_lines).append(txt)

    return {
        "source_id": page,
        "url": url,
        "work_title": work_title,
        "orig_year": year,
        "citation": citation,
        "author_text": "\n".join(author_lines),
        "notes_dropped_count": len(notes_lines),
        "notes_chars_dropped": sum(len(x) for x in notes_lines),
    }


def main():
    f = Path(sys.argv[1] if len(sys.argv) > 1 else "cache/shev104.utf8.html")
    url = sys.argv[2] if len(sys.argv) > 2 else "http://litopys.org.ua/shevchenko/shev104.htm"
    data = extract(f.read_text(encoding="utf-8"), url)

    print("=" * 60)
    print("source_id   :", data["source_id"])
    print("url         :", data["url"])
    print("work_title  :", data["work_title"])
    print("orig_year   :", data["orig_year"], "(нет дня/месяца -> пул рандомных цитат)")
    print("citation    :", data["citation"])
    print(f"notes dropped: {data['notes_dropped_count']} абзацев / "
          f"{data['notes_chars_dropped']} символов редакторского аппарата")
    print("=" * 60)
    print("--- АВТОРСКИЙ ТЕКСТ (только K1, аппарат вырезан) ---")
    print(data["author_text"])
    print("=" * 60)


if __name__ == "__main__":
    main()
