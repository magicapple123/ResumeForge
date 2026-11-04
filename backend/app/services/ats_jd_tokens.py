# SPDX-License-Identifier: Apache-2.0
"""ATS 检测的**JD 抽词**：复合词切分、英文 token 白名单、中文短语边界。

拆分自 ``services/ats_keywords.py``（原 397 行，加切分/白名单会超 500 行预算）。
本模块只回答一个问题——**这份 JD 里哪些词值得让候选人对齐**，并分成两档：

- 核心词：命中词库或别名表、且出现在**要求段**（非「加分项」）的词（写法差异已被归一，
  见 ``ats_aliases``）；
- 补充词：JD 抽到的其余英文 token 与中文短语，以及只出现在加分段的词库词，
  **都不进核心覆盖率的分母**。

五条口径（2026-11 抽词噪音修复 + 加成分档）：

1. **复合词切分**：``vue/react/element`` 是 3 个词，不是 1 个永远命中不了的串。切分前先
   整体查词库/别名，``C++`` / ``C#`` / ``CI/CD`` / ``Node.js`` / ``.NET`` 因此不会被切坏。
2. **白名单优先**：英文 token 要么命中词库/别名，要么「长度 ≥3 且不是停用词、通用缩写」。
3. **中文短语必须从左边界起算**：旧实现 ``([\\u4e00-\\u9fa5]{0,6}?(?:后缀))`` 会在任意
   汉字位置起匹配，于是「实现数据可视化」被切成「实现数据」。现在按汉字片段**从右往左**
   取窗口，剥掉修饰词与虚词，「实现数据」「类产品」「搭建高性能」都不再产生。
4. **数字不是词**：片段只由汉字构成，``1-2 秒`` / ``2024-08`` 不会被切出任何 token。
5. **加分项不进核心分母**：JD 写明「加分项：X、Y」时，X/Y 即使命中词库也算补充词
   （``required_jd_text`` 切出要求段）。分档只看 JD 的字面结构，不做语义判断。
"""

from __future__ import annotations

import re

from .ats_aliases import (
    _PHRASE_PAIRS,
    is_jd_token_allowed,
    normalize_alias,
)

# JD 里的英文技术词：C++ / C# / Node.js / CI/CD / scikit-learn 都应先被整体抓出来。
# 开头的 ``\.?`` 是为了 ``.NET``：点本身是词的一部分，不能等到切分阶段才补救。
_JD_TOKEN_RE = re.compile(r"\.?[A-Za-z][A-Za-z0-9+#./-]{1,24}")
# 复合词分隔符。切分只在这些字符上发生，且要求切分前整体不命中词库/别名。
_COMPOUND_SPLIT_RE = re.compile(r"[./+\-]+")
# 汉字片段：中文短语只在连续汉字内部寻找，数字/标点/英文天然是边界。
_CJK_RUN_RE = re.compile(r"[\u4e00-\u9fa5]+")
# 「加分项」标记：标记之后到本句结束的内容是加分技能。分档依据是 JD 自己写的结构，
# 不是模型判断——同一份 JD 反复跑必须给出同一份核心/补充清单（需求 1：分数确定性）。
# 刻意不收英文 ``plus``：``MyBatis Plus`` 里的 Plus 是技术名的一部分，收进来会把整段要求
# 误判成加分项（实测会把 MyBatis-Plus 降级成补充词）。
_BONUS_MARKER_RE = re.compile(
    r"(?:加分项|加分|优先考虑|优先录用|优先|bonus|nice\s+to\s+have)", re.IGNORECASE
)
# 加分标记只在**本句/本行**内生效，否则一句"X 优先"会把后面整段要求都降级。
_SENTENCE_END_RE = re.compile(r"[。！？；;\n]")

# 抽词上限：英文 token 20、中文短语 20（与拆分前一致，改动只影响"抽得准不准"）。
_MAX_JD_TOKENS = 20
_MAX_JD_PHRASES = 20

# 中文短语的后缀：JD 里以这些词收尾的片段通常是可检索的技能/职责短语。
_CHINESE_SUFFIXES = (
    "开发",
    "设计",
    "优化",
    "架构",
    "测试",
    "运维",
    "分析",
    "管理",
    "算法",
    "数据",
    "系统",
    "平台",
    "服务",
    "接口",
    "性能",
    "安全",
    "部署",
    "监控",
    "调优",
    "建模",
    "挖掘",
    "推荐",
    "搜索",
    "风控",
    "增长",
    "运营",
    "产品",
    "项目",
    "团队",
    "沟通",
    "协作",
    "可视化",
)
# 只在片段**结尾**判定后缀：名字保持旧名，避免历史导入面失效。
_CHINESE_PHRASE_RE = re.compile(r"(?:" + "|".join(_CHINESE_SUFFIXES) + r")$")
# 短语前常见的修饰词/虚词：剥掉之后才既能在简历里匹配到，又不至于都是同一个后缀。
_PHRASE_NOISE_PREFIXES = (
    "熟悉",
    "精通",
    "掌握",
    "了解",
    "具备",
    "具有",
    "要求",
    "负责",
    "参与",
    "至少",
    "相关",
    "以上",
    "能够",
    "可以",
    "良好",
    "扎实",
    "熟练",
    "使用",
    "实现",
    "支持",
    "搭建",
    "完成",
    "提供",
    "构建",
    "建设",
    "进行",
    "开展",
    "推动",
    "落地",
    # "沟通能力和项目管理" → 先剥"能力"，再剥掉连词"和"，才剩下可匹配的"项目管理"。
    "能力",
)
_PHRASE_NOISE_CHARS = "的和与及在对为并或等有之其这那各该本此每多两几名位"
# 修饰词/虚词同时也是**片段边界**：中文没有空格，"负责搭建高性能数据服务" 只能靠这些词
# 切成 "高性能数据服务"，从右往左取窗口才不会从"搭建"中间下刀。
_PHRASE_SPLIT_RE = re.compile("|".join(_PHRASE_NOISE_PREFIXES))
# 片段不能以这些"量词/类别词"开头——那是上一个词的尾巴，不是词首（「各类产品」→「类产品」）。
_PHRASE_BAD_PREFIXES = ("类", "种", "项", "个", "条", "些", "等")
# 只有形容词、没有领域名词的短语（「搭建高性能」剥完只剩「高性能」），对齐它没有意义。
_PHRASE_GENERIC_ONLY = frozenset({"高性能", "高可用", "高效率", "高质量", "可视化"})

# 短语别名替换：多词写法必须在分词前归一，否则 "mybatis plus" 会被空格拆成 plus。
_PHRASE_ALIAS_RE = re.compile(
    r"(?<![A-Za-z0-9])(?:"
    + "|".join(re.escape(pair[0]) for pair in _PHRASE_PAIRS)
    + r")(?![A-Za-z0-9])",
    re.IGNORECASE,
)
_PHRASE_ALIAS_MAP = {pair[0].lower(): pair[1] for pair in _PHRASE_PAIRS}


def normalize_phrase_aliases(text: str) -> str:
    """把 ``MyBatis Plus`` / ``springboot`` 这类多词写法替换成词库里的规范词。"""
    return _PHRASE_ALIAS_RE.sub(lambda match: _PHRASE_ALIAS_MAP[match.group(0).lower()], text)


def split_compound(token: str) -> list[str]:
    """按 ``. / + -`` 把复合词拆成片段（``vue/react/element`` → 3 个）。"""
    parts = [part for part in _COMPOUND_SPLIT_RE.split(token) if len(part) >= 2]
    return parts or [token]


def _split_pieces(token: str, library_keys: dict[str, str]) -> list[str]:
    """先整体查词库/别名，命中就整块保留；否则才切分（``C++`` / ``CI/CD`` 不会被切坏）。"""
    # 只去句尾的句点/连字符（"Python."），不能连 ``+`` ``#`` ``.`` 一起 strip——
    # 那正是 ``C++`` / ``C#`` / ``.NET`` 的词内字符。
    base = token.rstrip("-.")
    if not base:
        return []
    # ① 整体命中词库或别名：C++ / C# / CI/CD / Node.js 这类"分隔符就是词的一部分"的写法，
    #    切开会只剩单字母或无意义片段。
    for candidate in (token, base):
        if candidate.lower() in library_keys or normalize_alias(candidate) is not None:
            return [candidate]
    # ② 语言标记（+ / #）与点开头的产品名（.NET）同样是整词，按分隔符切只剩字母。
    if "+" in base or "#" in base or base.startswith("."):
        return [base]
    return split_compound(base)


def _jd_tech_tokens(jd_text: str, library_keys: dict[str, str] | None = None) -> list[str]:
    """JD 里的英文技术 token（已切分/归一/白名单过滤，小写去重，最多 20 个）。"""
    keys = library_keys or {}
    tokens: list[str] = []
    seen: set[str] = set()
    for match in _JD_TOKEN_RE.finditer(normalize_phrase_aliases(jd_text)):
        for piece in _split_pieces(match.group(0), keys):
            word = normalize_alias(piece) or piece
            key = word.lower()
            if key in seen or not is_jd_token_allowed(word, keys):
                continue
            seen.add(key)
            tokens.append(key)
            if len(tokens) >= _MAX_JD_TOKENS:
                return tokens
    return tokens


def _strip_phrase_noise(phrase: str) -> str:
    """剥掉短语前的修饰词与虚词（"熟悉后端开发" → "后端开发"）。"""
    text = phrase
    changed = True
    while changed and len(text) > 2:
        changed = False
        for prefix in _PHRASE_NOISE_PREFIXES:
            if text.startswith(prefix) and len(text) - len(prefix) >= 2:
                text = text[len(prefix) :]
                changed = True
                break
        if changed:
            continue
        if text[0] in _PHRASE_NOISE_CHARS and len(text) > 2:
            text = text[1:]
            changed = True
    return text


def _cut_at_noise_char(phrase: str) -> str:
    """窗口里出现虚词时只保留虚词之后的半句（"开发与接口设计" → "接口设计"）。"""
    for index, char in enumerate(phrase):
        if char in _PHRASE_NOISE_CHARS:
            tail = phrase[index + 1 :]
            if len(tail) >= 2:
                return tail
            return phrase
    return phrase


def _phrase_is_useful(phrase: str) -> bool:
    """2–8 字、不以量词开头、不是裸后缀、不是纯形容词。"""
    if not 2 <= len(phrase) <= 8:
        return False
    if phrase.startswith(_PHRASE_BAD_PREFIXES):
        return False
    if phrase in _PHRASE_GENERIC_ONLY:
        return False
    # 单独一个后缀（"数据" / "产品" / "平台"）太泛，对齐它没有意义；2 字实词（"测试"）同样
    # 只会在片段裁切里出现，交给「自动化测试」这类完整短语表达。
    return not (len(phrase) <= 2 and _CHINESE_PHRASE_RE.match(phrase))


def _segment_phrases(segment: str) -> list[str]:
    """单个汉字片段内**从右往左**取最长窗口，避免任意位置起匹配产生碎片。

    先按修饰词/虚词把片段切成小块（"负责搭建高性能数据服务" → "高性能数据服务"），
    再在小块内从右往左取窗口：窗口命中有效短语就整窗消费，无效时只消费句尾后缀，
    给左边半句再一次机会（"性能优化与监控" → 先否掉"监控"，再取到"性能优化"）。
    两条路径都必然缩短 ``rest``，循环一定收敛。
    """
    phrases: list[str] = []
    for piece in _PHRASE_SPLIT_RE.split(segment):
        rest = piece
        while len(rest) >= 2:
            suffix = _CHINESE_PHRASE_RE.search(rest)
            if suffix is None:
                break
            window = rest[-10:]
            phrase = _strip_phrase_noise(_cut_at_noise_char(window))
            if _phrase_is_useful(phrase):
                phrases.append(phrase)
                rest = rest[: len(rest) - len(window)]
            else:
                rest = rest[: len(rest) - len(suffix.group(0))]
            rest = rest.rstrip(_PHRASE_NOISE_CHARS)
    return phrases


def _jd_chinese_phrases(jd_text: str) -> list[str]:
    """从 JD 里按后缀抽 2–8 字中文短语（去重、最多 20 个）。"""
    phrases: list[str] = []
    seen: set[str] = set()
    for segment in _CJK_RUN_RE.findall(normalize_phrase_aliases(jd_text)):
        for phrase in _segment_phrases(segment):
            if phrase in seen:
                continue
            seen.add(phrase)
            phrases.append(phrase)
            if len(phrases) >= _MAX_JD_PHRASES:
                return phrases
    return phrases


def _bonus_spans(jd_text: str) -> list[tuple[int, int]]:
    """「加分项」标记覆盖的区间：从标记起到本句结束（无句末标点时到文本末尾）。"""
    spans: list[tuple[int, int]] = []
    for match in _BONUS_MARKER_RE.finditer(jd_text):
        end = _SENTENCE_END_RE.search(jd_text, match.end())
        spans.append((match.start(), end.start() if end else len(jd_text)))
    return spans


def required_jd_text(jd_text: str) -> str:
    """去掉「加分项」段落后的 JD 文本——**核心词只从这里取**。

    为什么要有这一步：JD 的加分技能（"加分项：Kubernetes、Flink"）常与岗位主干无关，
    把它们算进核心分母等于用"公司希望但不强求"的词扣用户的分。
    """
    spans = _bonus_spans(jd_text)
    if not spans:
        return jd_text
    kept: list[str] = []
    cursor = 0
    for start, end in spans:
        if start > cursor:
            kept.append(jd_text[cursor:start])
        cursor = max(cursor, end)
    kept.append(jd_text[cursor:])
    return " ".join(part for part in kept if part.strip())


def jd_keyword_tiers(jd_text: str, library: list[str]) -> tuple[list[str], list[str]]:
    """把 JD 抽词分成 (核心词, 补充词)。

    核心词 = 命中词库或别名表、且出现在**要求段**（非「加分项」）的词；补充词 = 其余英文
    token 与中文短语，以及只出现在加分段的词库词。两档分别去重，**补充词不进核心覆盖率
    的分母**。
    """
    library_keys = {word.lower(): word for word in library}
    text = normalize_phrase_aliases(jd_text)
    required = normalize_phrase_aliases(required_jd_text(jd_text))
    required_tokens = set(_jd_tech_tokens(required, library_keys))
    required_phrases = set(_jd_chinese_phrases(required))
    core: list[str] = []
    supplemental: list[str] = []
    seen: set[str] = set()
    for token in _jd_tech_tokens(text, library_keys):
        key = token.lower()
        if key in seen:
            continue
        seen.add(key)
        display = library_keys.get(key)
        if display is not None and key in required_tokens:
            core.append(display)
        else:
            supplemental.append(key)
    for phrase in _jd_chinese_phrases(text):
        if phrase in seen:
            continue
        seen.add(phrase)
        canonical = library_keys.get(phrase)
        if canonical is not None and phrase in required_phrases:
            core.append(canonical)
        else:
            supplemental.append(phrase)
    return core, supplemental


__all__ = [
    "_CHINESE_PHRASE_RE",
    "_CHINESE_SUFFIXES",
    "_CJK_RUN_RE",
    "_JD_TOKEN_RE",
    "_MAX_JD_PHRASES",
    "_MAX_JD_TOKENS",
    "_PHRASE_BAD_PREFIXES",
    "_PHRASE_GENERIC_ONLY",
    "_PHRASE_NOISE_CHARS",
    "_PHRASE_NOISE_PREFIXES",
    "_jd_chinese_phrases",
    "_jd_tech_tokens",
    "_strip_phrase_noise",
    "jd_keyword_tiers",
    "normalize_phrase_aliases",
    "required_jd_text",
    "split_compound",
]
