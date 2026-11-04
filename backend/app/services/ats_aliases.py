# SPDX-License-Identifier: Apache-2.0
"""ATS 抽词的**别名归一**与**英文白名单**。

JD 里的技术词有大量等价写法（``Postgres`` / ``PostgreSQL``、``k8s`` / ``Kubernetes``、
``React.js`` / ``React``）。按字面比对会把"写法不同"算成"没命中"，这是纯误伤，会让用户
去改一个本来就写对的词。本模块负责两件事：

- ``_PHRASE_ALIASES`` / ``_ALIASES``：把别名映射回词库里的规范词。多词写法（``MyBatis Plus``）
  必须在**分词之前**按短语替换，否则会被空格拆成 ``mybatis`` + ``plus`` 两块；
- ``_JD_STOPWORDS`` / ``_GENERIC_ABBREVIATIONS`` / ``_NOISE_WORDS``：英文 token 的**正向**
  判据。为什么是白名单而不是黑名单：``api`` / ``orm`` / ``ai`` 这类通用缩写枚举不完，
  所以只有「命中词库或别名」或者「够长且不是通用缩写」才配进目标词
  （``is_jd_token_allowed``）。
"""

from __future__ import annotations

from functools import lru_cache

# 单 token 别名（小写）→ 规范词。键里**不含空格**：带空格的写法必须在分词前按短语替换，
# 否则会被空格拆成两半（见 ``_PHRASE_ALIASES``）。
_ALIASES: dict[str, str] = {
    "postgres": "PostgreSQL",
    "postgresql": "PostgreSQL",
    "pgsql": "PostgreSQL",
    "k8s": "Kubernetes",
    "golang": "Go",
    "springboot": "Spring Boot",
    "springcloud": "Spring Cloud",
    "react.js": "React",
    "reactjs": "React",
    "vue.js": "Vue",
    "vuejs": "Vue",
    "nodejs": "Node.js",
    "mybatisplus": "MyBatis-Plus",
    "mybatis-plus": "MyBatis-Plus",
}

# 多词别名（键里**有空格**）→ 规范词：分词前按短语整体替换。
_PHRASE_ALIASES: tuple[tuple[str, str], ...] = (
    ("mybatis plus", "MyBatis-Plus"),
    ("spring boot", "Spring Boot"),
    ("spring cloud", "Spring Cloud"),
    ("react native", "React Native"),
)

# 英文停用词：JD 里高频出现，但对"ATS 关键词覆盖"没有区分度。
_JD_STOPWORDS = frozenset(
    {
        "a",
        "about",
        "ability",
        "able",
        "all",
        "also",
        "an",
        "and",
        "any",
        "applicant",
        "are",
        "as",
        "at",
        "be",
        "been",
        "benefits",
        "build",
        "building",
        "but",
        "by",
        "can",
        "candidate",
        "candidates",
        "company",
        "description",
        "etc",
        "excellent",
        "experience",
        "experiences",
        "familiar",
        "for",
        "from",
        "full",
        "get",
        "good",
        "has",
        "have",
        "help",
        "how",
        "if",
        "in",
        "is",
        "it",
        "job",
        "join",
        "knowledge",
        "learn",
        "location",
        "more",
        "must",
        "new",
        "not",
        "of",
        "on",
        "or",
        "other",
        "our",
        "part",
        "position",
        "preferred",
        "remote",
        "required",
        "requirements",
        "responsibilities",
        "salary",
        "should",
        "skill",
        "skills",
        "strong",
        "team",
        "than",
        "that",
        "the",
        "this",
        "time",
        "to",
        "us",
        "use",
        "used",
        "using",
        "we",
        "what",
        "when",
        "who",
        "why",
        "will",
        "with",
        "work",
        "would",
        "year",
        "years",
        "you",
        "your",
    }
)

# 纯通用缩写：任何技术栈的 JD 里都会出现，写进简历也没有区分度。
# 与 ``_JD_STOPWORDS`` 分开，是因为它们的过滤理由不同（一个是语法词，一个是通用缩写），
# 未来放宽阈值时也应当分开动。
_GENERIC_ABBREVIATIONS = frozenset(
    {
        "ai",
        "api",
        "apis",
        "db",
        "http",
        "https",
        "id",
        "orm",
        "sdk",
        "sql",
        "ui",
        "url",
        "ux",
    }
)

# JD 里的英语口语/招聘话术：不是技能，也不该出现在"未命中关键词"里。
_NOISE_WORDS = frozenset(
    {
        "coding",
        "plus",
        "vibe",
        "nice",
        "bonus",
        # 多词技术名的残片：``Spring Boot`` / ``Spring Cloud`` / ``React Native`` 整词已由
        # 词库命中，单独剩下的 boot / cloud / native 不构成关键词。
        "boot",
        "cloud",
        "native",
    }
)

# 英文 token 进目标词的最短长度：``go`` / ``c`` 这类两字符词靠词库命中，不靠白名单。
_MIN_WHITELIST_LEN = 3

# 短语别名替换：按长度倒序，保证 ``spring boot`` 先于 ``boot`` 之类的短写法命中。
_PHRASE_PAIRS = tuple(sorted(_PHRASE_ALIASES, key=lambda pair: -len(pair[0])))


def normalize_alias(token: str) -> str | None:
    """单个 token 的别名归一；不是别名时返回 None。"""
    return _ALIASES.get(token.strip().lower())


def is_jd_token_allowed(token: str, library_keys: dict[str, str]) -> bool:
    """英文 token 是否值得作为目标词：词库/别名优先，其次"够长且不是通用缩写"。"""
    key = token.strip().lower()
    if not key:
        return False
    if key in library_keys or normalize_alias(key) is not None:
        return True
    if len(key) < _MIN_WHITELIST_LEN:
        return False
    return (
        key not in _JD_STOPWORDS and key not in _GENERIC_ABBREVIATIONS and key not in _NOISE_WORDS
    )


@lru_cache(maxsize=256)
def alias_variants(canonical: str) -> tuple[str, ...]:
    """一个规范词在简历里可能的全部写法（自身 + 指向它的别名，小写）。

    归一必须**双向**才有意义：JD 写 ``Postgres``、简历写 ``PostgreSQL`` 要算命中；反过来
    JD 写 ``Kubernetes``、简历写 ``k8s`` 同样要算命中。词边界匹配保证 ``postgres`` 不会
    在 ``postgresql`` 里重复计数。
    """
    key = canonical.strip().lower()
    variants = [key]
    for alias, target in _ALIASES.items():
        if target.lower() == key and alias not in variants:
            variants.append(alias)
    for alias, target in _PHRASE_ALIASES:
        if target.lower() == key and alias not in variants:
            variants.append(alias)
    return tuple(variants)


__all__ = [
    "_ALIASES",
    "_GENERIC_ABBREVIATIONS",
    "_JD_STOPWORDS",
    "_MIN_WHITELIST_LEN",
    "_NOISE_WORDS",
    "_PHRASE_ALIASES",
    "_PHRASE_PAIRS",
    "alias_variants",
    "is_jd_token_allowed",
    "normalize_alias",
]
