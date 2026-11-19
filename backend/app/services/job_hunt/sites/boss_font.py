# SPDX-License-Identifier: Apache-2.0
"""BOSS 直聘薪资字体解密：把列表页薪资里的私用区（PUA）字符还原成数字。

BOSS 搜索列表的薪资文本（如 "8-12K"）用自定义字体渲染：HTML 里躺着的其实是
``U+E031..U+E03A`` 这类 PUA 码点，视觉上的数字形状由 @font-face 加载的 woff/ttf
决定。不解密的话薪资全是 ``\ue035-\ue03aK`` 这样的废数据。

映射从哪来（按可信度递降，全部可组合）：

1. **字体轮廓比对**（``build_digit_map_from_font``）：页面/网络里拿到的字体文件，
   PUA 字形的轮廓与同字体里 ASCII 数字字形一致（厂商就是把数字字形复制到 PUA 码位）。
   用 fontTools 读 glyf 坐标 → 归一化签名 → 相等即映射。字体文件嵌在页面里时
   （base64 data URL）由 ``extract_font_bytes`` 就地提取；外链字体夜间不下载
   （红线），由采集运行时经 CDP 截获后传入。

   **格式支持范围：ttf / otf / ttc，以及 woff。woff2 需要额外装 ``brotli``**
   （fontTools 的 ``[woff]`` extra 才带它，是非默认的可选依赖）。没装 brotli 时
   本路径对 woff2 返回 ``None``，由下面两条路径兜底——不是故障，但要知道它生效不了。
2. **明文对照**（``mapping_from_pairs``）：同一岗位在别处出现过明文薪资——详情页
   主岗位薪资就是明文（``<span class="salary">8-12K</span>``），与列表卡片按标题
   配对后逐位对齐即得映射。每个岗位详情都会新增对照对，采得越多映射越全。
3. **结构约束**（``mapping_from_constraints``）：整页 15 张卡的薪资互相咬合
   （区间左<右、符号与数字一一对应、薪资量级合理），穷举可行赋值；**只输出在全部
   可行解里取值唯一的符号**，解不唯一的符号老实留白——宁缺毋假。

解码接口（``decode_salary``）永远不抛异常：映射缺了就保留原字符并在结果上标
``ok=False``，调用方据此决定要不要展示"薪资(未还原)"。
"""

from __future__ import annotations

import base64
import binascii
import io
import logging
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from itertools import permutations

logger = logging.getLogger(__name__)

# BOSS 混淆字符落在 Unicode 私用区（实测夹具为 U+E031..U+E03A，整块判定更稳）。
PUA_MIN = 0xE000
PUA_MAX = 0xF8FF

#: 字体魔数 → 是否为 fontTools 可读的字体（woff2 需 brotli，缺包时在调用处降级）。
_FONT_MAGICS = (b"wOF2", b"wOFF", b"OTTO", b"\x00\x01\x00\x00")

# 薪资量级的合理性窗（约束求解用；单位 → (下限, 上限, 最大跨度)）。
# 区间下限卡在 3K：BOSS 列表不会出现 "0-5K" / "2-8K" 起步的全职岗；日薪 50 起步。
_UNIT_BOUNDS: dict[str, tuple[int, int, int]] = {
    "K": (3, 40, 15),  # x-yK
    "D": (50, 500, 300),  # x-y元/天
}


def is_encoded_char(ch: str) -> bool:
    """字符是否落在私用区（即被字体混淆的字符）。"""
    return PUA_MIN <= ord(ch) <= PUA_MAX


def encoded_chars_in(text: str) -> set[str]:
    """文本里出现过的混淆字符集合。"""
    return {ch for ch in text if is_encoded_char(ch)}


@dataclass
class SalaryDecode:
    """一次薪资解码的结果。

    ``text`` 是尽量还原后的文本（映射没有的混淆字符**保留原样**，不丢不猜）；
    ``ok`` 表示文本里是否已无混淆字符（True = 全部还原或本来就没有）。
    """

    text: str
    ok: bool


def salary_for_display(decoded: str, raw: str, *, ok: bool) -> str:
    """挑一个能安全展示/入库的薪资文本。

    **未解码（``ok=False``）时绝不回退到混淆原文**：那会把 ``\ue032\ue033K`` 这类
    私用区字符直接写进库里，界面上是一串方块，而且比留空更糟——留空至少不骗人。

    优先级：解码成功 → 用解码值；否则用 ``raw``（它可能是详情页的明文，也可能与
    ``decoded`` 相同）；两者都含混淆字符 → 返回空串，如实表示"这条薪资没还原"。
    """
    plain = (decoded or "").strip()
    if ok and plain:
        return plain
    fallback = (raw or "").strip()
    if fallback and not encoded_chars_in(fallback):
        return fallback
    return ""


def decode_salary(text: str, mapping: Mapping[str, str] | None) -> SalaryDecode:
    """按字符映射还原薪资文本。无映射/空文本/纯明文都安全通过。"""
    if not text:
        return SalaryDecode(text="", ok=True)
    if not mapping:
        return SalaryDecode(text=text, ok=not encoded_chars_in(text))
    out: list[str] = []
    ok = True
    for ch in text:
        if is_encoded_char(ch):
            repl = mapping.get(ch)
            if repl is None:
                ok = False
                out.append(ch)
            else:
                out.append(repl)
        else:
            out.append(ch)
    return SalaryDecode(text="".join(out), ok=ok)


# ---------------------------------------------------------------------------
# 路径 1：字体文件 → 映射（轮廓比对）
# ---------------------------------------------------------------------------


def extract_font_bytes(html: str) -> bytes | None:
    """从页面 HTML 里就地提取内嵌字体（base64 data URL 形态）。

    BOSS 的 @font-face 有时内联在 <style> 或 JS 变量里。只认解码后魔数对得上的
    base64 块——页面里图片的 base64（PNG/JPEG 开头）不算。外链 URL 一律不下载
    （夜间无网络边界），返回 None 交给运行时经 CDP 截获。
    """
    if not html:
        return None
    for blob in re.findall(r"base64,([A-Za-z0-9+/=]{200,})", html):
        try:
            raw = base64.b64decode(blob + "=" * (-len(blob) % 4), validate=False)
        except (ValueError, binascii.Error):
            continue
        if raw[:4] in _FONT_MAGICS:
            return raw
    return None


def build_digit_map_from_font(font_bytes: bytes) -> dict[str, str] | None:
    """读字体文件，把「轮廓与某数字字形相同」的 PUA 字符映射到该数字。

    做法：glyf 表逐字形取轮廓点集 → 按包围盒归一化量化成签名；数字字形的签名
    建索引，PUA 字形逐个比对。复合字形（组件引用）先展开成有效点集。
    字体读不了 / 没有 glyf（CFF）/ 缺数字字形，返回 ``None``（调用方走对照路径）。
    """
    if not font_bytes or font_bytes[:4] not in _FONT_MAGICS:
        return None
    try:
        from fontTools.ttLib import TTFont
    except ImportError:  # pragma: no cover - 环境缺包时显式降级
        logger.warning("fontTools 未安装，字体解密不可用")
        return None
    if font_bytes[:4] == b"wOF2":
        try:
            import brotli  # noqa: F401
        except ImportError:
            logger.info("woff2 字体需要 brotli，未安装；跳过字体路径")
            return None
    try:
        font = TTFont(io.BytesIO(font_bytes), fontNumber=0, lazy=True)
        if "glyf" not in font or "cmap" not in font:
            return None
        glyf = font["glyf"]
        cmap = font.getBestCmap() or {}
        glyph_set = font.getGlyphSet()
        # 数字字形签名索引（同字体自洽，不依赖系统字体）。
        digit_sigs: dict[tuple, str] = {}
        for digit in "0123456789":
            name = cmap.get(ord(digit))
            if not name:
                continue
            sig = _glyph_signature(name, glyf, glyph_set)
            if sig is not None:
                digit_sigs.setdefault(sig, digit)
        if not digit_sigs:
            return None
        mapping: dict[str, str] = {}
        for code, name in cmap.items():
            if not (PUA_MIN <= code <= PUA_MAX):
                continue
            sig = _glyph_signature(name, glyf, glyph_set)
            digit = digit_sigs.get(sig) if sig is not None else None
            if digit is not None:
                mapping[chr(code)] = digit
        return mapping or None
    except Exception as exc:  # noqa: BLE001 — 字体脏数据降级，不抛给采集层
        logger.warning("字体解密失败（%s: %s），走明文对照路径", type(exc).__name__, exc)
        return None


def _glyph_signature(name: str, glyf, glyph_set) -> tuple | None:
    """字形的归一化点集签名；空字形/异常返回 None。"""
    glyph = glyf.get(name)
    if glyph is None:
        return None
    try:
        coords, ends, _flags = glyph.getCoordinates(glyf)
        points = [(pt[0], pt[1]) for pt in coords]
    except Exception:  # noqa: BLE001 — 个别字形坏了不影响其他
        return None
    # getCoordinates 会带 4 个幻点（advance 等）；endPts 存的是各轮廓的**终点索引**，
    # 总点数 = 最后一项 + 1（不是求和——那会把每轮廓少算一个点）。
    real = (ends[-1] + 1) if ends else 0
    points = points[:real]
    if len(points) < 3:
        return None
    return _normalize_points(points)


def _normalize_points(points: list[tuple[int, int]], *, grid: int = 8) -> tuple | None:
    """包围盒归一化 + 量化：平移到原点、最长边缩放到 256 格、坐标取整。

    厂商复制的字形坐标逐点一致，归一化后签名严格相等；量化网格吸收真实现场
    可能的亚像素抖动。
    """
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    min_x, min_y = min(xs), min(ys)
    span = max(max(xs) - min_x, max(ys) - min_y)
    if span <= 0:
        return None
    scale = 256 / span
    return (
        len(points),
        tuple(
            (round((x - min_x) * scale / grid) * grid, round((y - min_y) * scale / grid) * grid)
            for x, y in points
        ),
    )


# ---------------------------------------------------------------------------
# 路径 2：明文对照对 → 映射（逐位对齐，多数票）
# ---------------------------------------------------------------------------


def mapping_from_pairs(pairs: Iterable[tuple[str, str]]) -> dict[str, str]:
    """从（混淆文本, 明文文本）对照对推导映射。

    逐位对齐：两个文本等长时，混淆字符位与明文字符位一一对应；多对之间同一
    混淆字符出现冲突时取多数票（真对照不会冲突，投票只为容错）。不等长的对
    直接忽略——对齐猜测比没有对照更危险。
    """
    votes: dict[str, dict[str, int]] = {}
    for encoded, plain in pairs:
        if not encoded or not plain or len(encoded) != len(plain):
            continue
        for enc_ch, plain_ch in zip(encoded, plain, strict=True):
            if not is_encoded_char(enc_ch):
                continue
            if not (plain_ch.isdigit() and len(plain_ch) == 1):
                continue
            votes.setdefault(enc_ch, {})
            votes[enc_ch][plain_ch] = votes[enc_ch].get(plain_ch, 0) + 1
    mapping: dict[str, str] = {}
    for enc_ch, table in votes.items():
        best = max(table.items(), key=lambda kv: (kv[1], kv[0]))
        mapping[enc_ch] = best[0]
    return mapping


# ---------------------------------------------------------------------------
# 路径 3：整页结构约束 → 确定的那部分映射
# ---------------------------------------------------------------------------

#: 形如 "A-BK" / "A-B元/天" 的薪资（A/B 只含混淆字符与明文数字）。
_RANGE_RE = re.compile(r"^([0-9\uE000-\uF8FF]+)-([0-9\uE000-\uF8FF]+)(K|元/天)$")


@dataclass
class ConstraintMapping:
    """约束求解的结果：``certain`` 里每个混淆字符取值唯一（可信）；
    ``candidates`` 是其余字符的全部可行取值（不猜）。"""

    certain: dict[str, str]
    candidates: dict[str, set[str]]


def mapping_from_constraints(
    salaries: Iterable[str], known: Mapping[str, str] | None = None
) -> ConstraintMapping:
    """用「区间左<右 + 一一对应 + 量级合理」穷举可行赋值。

    只拿**区间形**薪资参与求解（单项如 "面议" / "K·N薪" 不参与）；解不唯一的
    符号进 ``candidates``，绝不混进 ``certain``。符号数超过 9 时不穷举（计算量
    失控），直接按已知返回。
    """
    fixed = {ch: d for ch, d in (known or {}).items() if is_encoded_char(ch) and d.isdigit()}
    ranges: list[tuple[str, str, str]] = []
    for text in salaries:
        if not text:
            continue
        m = _RANGE_RE.match(text)
        if not m:
            continue
        lo, hi, unit = m.group(1), m.group(2), m.group(3)
        if unit not in _UNIT_BOUNDS or not (set(lo) | set(hi)) - set("0123456789"):
            continue  # 纯明文区间没有求解价值
        ranges.append((lo, hi, unit))
    symbols = sorted({ch for lo, hi, _ in ranges for ch in lo + hi if is_encoded_char(ch)})
    symbols = [s for s in symbols if s not in fixed]
    candidates: dict[str, set[str]] = {s: set() for s in symbols}
    if not ranges or not symbols or len(symbols) > 9:
        return ConstraintMapping(certain=dict(fixed), candidates=candidates)

    used_digits = set(fixed.values())
    free_digits = [d for d in "0123456789" if d not in used_digits]
    bounds = [_UNIT_BOUNDS[u] for _, _, u in ranges]
    pairs_list = [(lo, hi) for lo, hi, _ in ranges]

    def value(token: str, assign: dict[str, str]) -> int:
        return int("".join(assign.get(ch, ch) for ch in token))

    for perm in permutations(free_digits, len(symbols)):
        assign = dict(fixed)
        assign.update(zip(symbols, perm, strict=True))
        ok = True
        for (lo, hi), (low, high, max_span) in zip(pairs_list, bounds, strict=True):
            try:
                a, b = value(lo, assign), value(hi, assign)
            except ValueError:  # 混淆字符未映射干净（不该发生，防御）
                ok = False
                break
            if not (low <= a < b <= high and b - a <= max_span):
                ok = False
                break
        if ok:
            for s, d in zip(symbols, perm, strict=True):
                candidates[s].add(d)
    certain = dict(fixed)
    for s, opts in candidates.items():
        if len(opts) == 1:
            certain[s] = next(iter(opts))
    # candidates 只留仍不确定的符号（与 docstring 的「其余字符」契约一致）。
    candidates = {s: opts for s, opts in candidates.items() if len(opts) > 1}
    return ConstraintMapping(certain=certain, candidates=candidates)


# ---------------------------------------------------------------------------
# 关于「硬编码映射表」——刻意不提供
# ---------------------------------------------------------------------------
#
# 早期版本这里有一份手工收敛的 ``BOSS_TTF_MAP``（``E031→0 … E03A→9``）。2026-11-19
# 上游作者用真实样本核对后证明它**整体偏移了一位**：``E032 E033-E032 E036`` 的真实值
# 是 23-26K，该表解出 12-15K。上游 ``services/sites/boss_text.py`` 的
# ``_PRIVATE_USE_DIGITS``（``U+E030+i → i``）才是对的。
#
# 更值得记的是**为什么当时没发现**：我用的交叉验证是「解出 15 条真实卡片、全部满足
# 下限 < 上限、量级合理」。而整体错位一位的映射**同样**满足这条——12-15K、7-10K
# 全都自洽。也就是说那个判据对「整体偏移」这一整类错误**零鉴别力**，把它当证据
# 等于没有验证。同理，`E038 与 E032(=1) 完全同形 → 只能是 7` 这条推理也站不住：
# 同形应当同值，推成 7 自相矛盾。
#
# 结论：**不提供任何硬编码兜底**。本模块只走三条动态路径（字体轮廓比对 / 明文对照 /
# 结构约束），它们对当前字体自校准，换字体时不会静默解出错数字——解不出来就是
# ``ok=False``，而不是给出一个看着合理其实是错的数。
#
# 调用方若确实需要一个"当前字体的常数"，应当从**当次**抓到的字体文件或明文对照
# 里现算，不要抄一份到代码里。

__all__ = [
    "PUA_MIN",
    "PUA_MAX",
    "SalaryDecode",
    "ConstraintMapping",
    "is_encoded_char",
    "encoded_chars_in",
    "decode_salary",
    "salary_for_display",
    "extract_font_bytes",
    "build_digit_map_from_font",
    "mapping_from_pairs",
    "mapping_from_constraints",
]
