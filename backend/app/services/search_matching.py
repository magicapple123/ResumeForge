"""关键词匹配的**输入语义唯一实现处**：FTS 路径与 LIKE 路径必须逐字等价（RR-07）。

全局搜索（``/api/search``）与知识库检索各有两条执行路径：

- 快路径：迁移 ``0046``/``0044`` 建的 FTS5 trigram 虚拟表，取
  ``rowid IN (MATCH '"关键词"')``；
- 回退路径：多列 ``LIKE '%关键词%'``（历史库没跑过迁移、SQLite 太旧、关键词不足
  3 字符时）。

两条路径过去各写各的关键词形态，于是出现同类关键词结果不一致：

- **通配符**：``%``/``_`` 在 LIKE 里是通配符、在 FTS 的引号短语里是字面量
  （``foo%bar`` 能匹配 ``fooblahbar``，而 MATCH 不能）；
- **前后空白**：FTS 侧先 ``strip()`` 再匹配，``" foo "`` 会命中 ``foo...``；LIKE 侧
  按原样要求两侧空格；
- **变音符号**：trigram 默认 ``remove_diacritics=1``，``café`` 会连 ``cafe`` 一起命中，
  而 LIKE 不会。

本模块把"用户输入 = **字面子串**"这一约定写成一份实现：LIKE 侧显式 ``ESCAPE``，
FTS 侧保留原文（只判空时 strip），带变音符号的查询直接不走 FTS（见
:func:`fts_safe`）。改这里的任何一条都要同步改另一条，两个路径的对照测试
（``tests/test_search_fts.py``）按"同一端点两遍的 JSON 完全相等"钉住这个不变量。
"""

from __future__ import annotations

import unicodedata

# trigram 至少要 3 个字符才能表达子串查询；更短的关键词只能走 LIKE。
TRIGRAM_MIN_CHARS = 3

# LIKE 的转义字符与 ESCAPE 子句取值：``\`` 在 SQL 字符串里不是特殊字符，选它最省心。
LIKE_ESCAPE = "\\"


def normalized_term(raw: str) -> str:
    """判空用的规范形态：**只**去首尾空白，不改中间（空白是子串的一部分）。"""
    return (raw or "").strip()


def like_pattern(raw: str) -> str:
    """把用户输入转成"字面子串"的 LIKE 形态：``%``、``_``、``\\`` 全部转义。

    必须配合 ``column.like(pattern, escape=LIKE_ESCAPE)`` 使用；这里转义而不依赖
    SQLite 的通配符行为，是为了让两条路径对"用户输入里的 % 和 _"给同一个答案。
    """
    escaped = (
        (raw or "")
        .replace(LIKE_ESCAPE, LIKE_ESCAPE * 2)
        .replace("%", f"{LIKE_ESCAPE}%")
        .replace("_", f"{LIKE_ESCAPE}_")
    )
    return f"%{escaped}%"


def fts_safe(raw: str) -> bool:
    """这个关键词能否安全地交给 FTS trigram（即与 LIKE 结果必然一致）。

    两处已知的折叠差异，命中任意一条就回退 LIKE（慢一点，但对得上）：

    1. **变音符号**：trigram 默认 ``remove_diacritics=1``，``héllo`` 会命中 ``hello``，
       LIKE 不会。UTF-8 分解后与原字符不同即说明带变音符号（重音拉丁/希腊/西里尔、
       谚文音节等）。
    2. **非 ASCII 大小写折叠**：trigram 的小写折叠覆盖西里尔/希腊/拉丁扩展，
       而 SQLite 的 LIKE 只折 ASCII——``ПРИВЕТ`` 与 ``привет`` 在 FTS 下相等、
       在 LIKE 下不等。凡是"有大小写概念的非 ASCII 字符"（``lower() != upper()``）
       都算在内，纯中文/日文汉字不受影响，照旧走快路径。

    实测口径：``fts_safe("面试技巧") is True``，``fts_safe("привет") is False``。
    """
    for character in raw or "":
        if ord(character) < 128:
            continue
        if unicodedata.normalize("NFD", character) != character:
            return False
        if character.lower() != character.upper():
            return False
    return True


def match_expression(raw: str) -> str | None:
    """把用户输入转成安全的 FTS5 MATCH 表达式；不适配时返回 ``None``（回退 LIKE）。

    整个词项用双引号包成 FTS5 字符串常量，内部的 ``"`` 翻倍转义——用户输入里的
    AND/OR/NOT/NEAR、括号、通配符全部按字面量参与匹配，既没有语法错误也没有注入面。

    返回 ``None`` 的情形：

    - 去空白后为空（本来就不该加过滤）；
    - 长度不足 ``TRIGRAM_MIN_CHARS``（trigram 表达不了短查询）；
    - :func:`fts_safe` 判定带变音符号（结果会与 LIKE 不一致）。

    **不做 strip**：前后空白是子串的一部分，``" foo "`` 与 ``LIKE '% foo %'`` 同义。
    """
    term = normalized_term(raw)
    if len(term) < TRIGRAM_MIN_CHARS or not fts_safe(term):
        return None
    # 表达式用**原文**构造（含前后空白）：空白是子串的一部分。
    escaped = (raw or "").replace('"', '""')
    return f'"{escaped}"'


__all__ = [
    "LIKE_ESCAPE",
    "TRIGRAM_MIN_CHARS",
    "fts_safe",
    "like_pattern",
    "match_expression",
    "normalized_term",
]
