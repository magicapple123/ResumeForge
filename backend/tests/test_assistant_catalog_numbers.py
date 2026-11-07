# SPDX-License-Identifier: Apache-2.0
"""T09 内容护栏：能力地图里的数字必须能从同句清单数出来。

背景：目录里写"回收站覆盖 23 类内容（…22 项…）"这类**自相矛盾**的句子时，助手会
照着错的数字回答，而普通校验（工具名/域覆盖）完全看不出来。这里只校验**文案内部
自洽**（数字 vs 同句清单条数），**不校验与代码常量一致**——后者靠发布前人工复核
（对照 TRASH_SPECS、models/drill.py、reminder_service.py 的档位），本轮登记为 D5=A
的已知边界。

判定口径（刻意保守，避免把"上限"当成"清单"误报）：
- 只扫 where 文本里带数字的「N 类 / N 套 / N 个 / N 档」；
- 把 where 按 。；; 与换行切句，在**同一句**里找数字后面最近的括号清单或冒号清单
  （清单项用 / 或 、分隔，支持括号嵌套）；
- 有清单：清单条数必须等于 N；
- 没有清单：类/套/档 视为"声称有清单却找不到"→ 红；"N 个"若句子里有「最多」等
  上限语义或没有「共」字，则按"数量上限/普通量词"放过。
"""

from __future__ import annotations

import re

from app.services.feature_catalog import FEATURES

NUMBER_CLAIM = re.compile(r"(\d+)\s*(类|套|个|档)")
SENTENCE_BREAK = re.compile(r"[。；;\n]")
OPEN_TO_CLOSE = {"（": "）", "(": ")"}


def _sentences(text: str) -> list[str]:
    return [part for part in SENTENCE_BREAK.split(text) if part.strip()]


def _split_top_level(text: str) -> list[str]:
    """按 / 与 、 切清单项，括号内的分隔符不切（例如 Claude（Anthropic 原生））。"""
    items: list[str] = []
    buffer: list[str] = []
    depth = 0
    for char in text:
        if char in OPEN_TO_CLOSE:
            depth += 1
        elif char in OPEN_TO_CLOSE.values() and depth > 0:
            depth -= 1
        if depth == 0 and char in {"/", "、"}:
            item = "".join(buffer).strip()
            if item:
                items.append(item)
            buffer = []
            continue
        buffer.append(char)
    tail = "".join(buffer).strip()
    if tail:
        items.append(tail)
    return items


def _candidate_lists(sentence: str, start: int, end: int) -> list[str]:
    """数字之后、同一句内所有可数的清单（括号内容 / 冒号之后）。"""
    candidates: list[str] = []
    index = start
    while index < end:
        char = sentence[index]
        if char in OPEN_TO_CLOSE:
            close_char = OPEN_TO_CLOSE[char]
            depth = 0
            cursor = index
            while cursor < end:
                if sentence[cursor] == char:
                    depth += 1
                elif sentence[cursor] == close_char:
                    depth -= 1
                    if depth == 0:
                        break
                cursor += 1
            if depth == 0:
                candidates.append(sentence[index + 1 : cursor])
                index = cursor
        elif char in "：:":
            candidates.append(sentence[index + 1 :])
            break
        index += 1
    return [items for items in (_split_top_level(text) for text in candidates) if len(items) >= 2]


def _violations(text: str) -> list[str]:
    problems: list[str] = []
    for sentence in _sentences(text):
        for claim in NUMBER_CLAIM.finditer(sentence):
            expected = int(claim.group(1))
            unit = claim.group(2)
            candidates = _candidate_lists(sentence, claim.end(), len(sentence))
            if candidates:
                if not any(len(items) == expected for items in candidates):
                    counts = sorted({len(items) for items in candidates})
                    problems.append(f"{claim.group(0)}：同句清单条数是 {counts}，不是 {expected}")
                continue
            if unit in {"类", "套", "档"}:
                problems.append(f"{claim.group(0)}：同句找不到可数清单（{sentence.strip()[:80]}）")
            elif "最多" in sentence[: claim.start()] or "共" not in sentence:
                continue
            else:
                problems.append(f"{claim.group(0)}：同句找不到可数清单（{sentence.strip()[:80]}）")
    return problems


def test_parser_split_keeps_nested_parentheses_together():
    items = _split_top_level("DeepSeek / Claude（Anthropic 原生）/ 豆包")
    assert items == ["DeepSeek", "Claude（Anthropic 原生）", "豆包"]


def test_parser_accepts_a_matching_list():
    assert _violations("覆盖 3 类内容（岗位 / 简历 / 面经）") == []


def test_parser_rejects_a_mismatched_list():
    problems = _violations("覆盖 3 类内容（岗位 / 简历 / 面经 / 提醒）")
    assert len(problems) == 1
    assert "不是 3" in problems[0]


def test_parser_ignores_attachment_limits():
    assert _violations("上传附件（最多 4 个、单个 ≤2MB、合计 ≤5MB）") == []


def test_every_catalog_number_claim_is_countable_from_its_own_sentence():
    problems = [
        f"{feature.key}（{feature.where[:40]}…）：{problem}"
        for feature in FEATURES
        for problem in _violations(feature.where)
    ]
    assert not problems, "目录数字与同句清单不一致：\n" + "\n".join(problems)
