# SPDX-License-Identifier: Apache-2.0
"""BOSS 薪资字体解密测试。

数据来源两档：
- 合成字体（fontTools 现场构建，无网络无系统字体）：验证轮廓比对机制本身；
- 真实夹具（docs/job-hunt-fixtures/，缺了就 skip，E18）：验证明文对照 + 约束求解
  在真实页面数据上的行为，断言只落在**有实证**的符号上。
"""
from __future__ import annotations

import base64
import io
import re

import pytest

import app.services.job_hunt.sites.boss_font as bf
from job_hunt_fixtures import has, load


# ---------------------------------------------------------------------------
# decode_salary：纯替换逻辑（硬编码映射，不依赖夹具）
# ---------------------------------------------------------------------------

MAPPING = {chr(0xE031): "0", chr(0xE032): "1", chr(0xE039): "8"}


def test_decode_empty_string():
    r = bf.decode_salary("", MAPPING)
    assert r.text == "" and r.ok is True


def test_decode_plaintext_passthrough():
    for text in ("8-12K", "面议", "150-250元/天", "K·13薪"):
        r = bf.decode_salary(text, MAPPING)
        assert r.text == text and r.ok is True


def test_decode_without_mapping_marks_not_ok():
    r = bf.decode_salary(f"{chr(0xE039)}-{chr(0xE032)}K", None)
    assert r.ok is False and chr(0xE039) in r.text
    r = bf.decode_salary("8-12K", None)
    assert r.ok is True and r.text == "8-12K"


def test_decode_substitutes_known_keeps_unknown():
    text = f"{chr(0xE039)}-{chr(0xE032)}{chr(0xE03A)}K"
    r = bf.decode_salary(text, MAPPING)
    assert r.text == f"8-1{chr(0xE03A)}K"  # 未映射的字符原样保留，不猜
    assert r.ok is False


def test_decode_full_mapping_ok():
    text = f"{chr(0xE031)}{chr(0xE032)}-{chr(0xE039)}{chr(0xE039)}K"
    r = bf.decode_salary(text, MAPPING)
    assert (r.text, r.ok) == ("01-88K", True)  # E031→0, E032→1, E039→8


def test_is_encoded_char_bounds():
    assert bf.is_encoded_char(chr(0xE031)) and bf.is_encoded_char(chr(0xF8FF))
    assert not bf.is_encoded_char("K") and not bf.is_encoded_char(chr(0xE000 - 1))
    assert bf.encoded_chars_in(f"a{chr(0xE031)}K") == {chr(0xE031)}


# ---------------------------------------------------------------------------
# mapping_from_pairs：逐位对齐 + 多数票
# ---------------------------------------------------------------------------


def test_pairs_length_mismatch_ignored():
    pairs = [(f"{chr(0xE039)}K", "8-12K"), (f"{chr(0xE039)}-K", "8-K")]
    assert bf.mapping_from_pairs(pairs) == {chr(0xE039): "8"}


def test_pairs_majority_vote_wins():
    a, b = chr(0xE032), chr(0xE033)
    pairs = [(f"{a}", "1"), (f"{a}", "1"), (f"{a}", "2"), (f"{b}", "2")]
    m = bf.mapping_from_pairs(pairs)
    assert m == {a: "1", b: "2"}


def test_pairs_ignores_non_digit_plain():
    pairs = [("K" + chr(0xE032), "K薪"), (chr(0xE039), "x"), (chr(0xE039), "8")]
    assert bf.mapping_from_pairs(pairs) == {chr(0xE039): "8"}


# ---------------------------------------------------------------------------
# mapping_from_constraints：结构约束求解
# ---------------------------------------------------------------------------


def test_constraints_empty_input_returns_known():
    cm = bf.mapping_from_constraints([], known={"a": "1"})
    assert cm.certain == {}  # 非混淆字符的 known 不收
    cm = bf.mapping_from_constraints([], known={chr(0xE032): "1"})
    assert cm.certain == {chr(0xE032): "1"}


def test_constraints_pure_plaintext_no_symbols():
    cm = bf.mapping_from_constraints(["8-12K", "3-5K"])
    assert cm.certain == {} and cm.candidates == {}


def test_constraints_too_many_symbols_gives_up():
    # 12 个独立符号超出穷举上限（>9），只回已知、不猜
    sal = [f"{chr(0xE060 + i * 2)}-{chr(0xE060 + i * 2 + 1)}K" for i in range(6)]
    cm = bf.mapping_from_constraints(sal)
    assert cm.certain == {} and all(not v for v in cm.candidates.values())


def test_constraints_small_case_pins_unique():
    # 下限卡 3K：'X-4K' 里 X≥3 且 X<4 → X=3 唯一；'Y-9K' 的 Y 仍有 4..8 多解
    sal = [f"{chr(0xE031)}-4K", f"{chr(0xE032)}-9K"]
    cm = bf.mapping_from_constraints(sal)
    assert cm.certain == {chr(0xE031): "3"}
    assert cm.candidates == {chr(0xE032): {"4", "5", "6", "7", "8"}}


# ---------------------------------------------------------------------------
# 合成字体：轮廓比对机制（fontTools 现场构建，无网络）
# ---------------------------------------------------------------------------


def _digit_pen_points(d: int) -> list[tuple[float, float]]:
    """第 d 个数字 = 顶点高度递增的三角形；形状两两不同。"""
    return [(0, 0), (500, 0), (250, 600 + d * 40)]


def _build_synthetic_font() -> bytes:
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    fb = FontBuilder(1000, isTTF=True)
    order = ["gPad", *(f"g{d}" for d in range(10)), *(f"p{d}" for d in range(10)), "g0copy"]
    fb.setupGlyphOrder(order)
    glyph_map: dict[str, object] = {}
    # 垫片字形（不进 cmap）：fontTools fontBuilder 编译 cmap format 4 时会把
    # glyphId=1 的映射丢掉（实测），垫一个不参与映射的字形把真实字形顶到 ≥2。
    pen = TTGlyphPen(None)
    pen.moveTo((0, 0)); pen.lineTo((7, 0)); pen.lineTo((3, 11)); pen.closePath()
    glyph_map["gPad"] = pen.glyph()
    for d in range(10):
        pen = TTGlyphPen(None)
        pts = _digit_pen_points(d)
        pen.moveTo(pts[0]); pen.lineTo(pts[1]); pen.lineTo(pts[2]); pen.closePath()
        glyph_map[f"g{d}"] = pen.glyph()
        # PUA 0xE031+d = 数字 d 字形的逐点拷贝（厂商混淆的真实做法）
        pen = TTGlyphPen(None)
        pen.moveTo(pts[0]); pen.lineTo(pts[1]); pen.lineTo(pts[2]); pen.closePath()
        glyph_map[f"p{d}"] = pen.glyph()
    # 复合字形：引用 g0 平移 (137,-11)，归一化后应仍匹配 '0'
    pen = TTGlyphPen(glyph_map)
    pen.addComponent("g0", (1, 0, 0, 1, 137, -11))
    glyph_map["g0copy"] = pen.glyph()

    cmap = {**{ord(str(d)): f"g{d}" for d in range(10)},
            **{0xE031 + d: f"p{d}" for d in range(10)},
            0xE040: "g0copy"}
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyph_map)  # type: ignore[arg-type]
    fb.setupHorizontalMetrics({name: (600, 0) for name in order})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": "SynthBoss", "styleName": "R"})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost()
    out = io.BytesIO()
    fb.save(out)
    return out.getvalue()


def test_synthetic_font_digit_map():
    data = _build_synthetic_font()
    mapping = bf.build_digit_map_from_font(data)
    # 简单字形拷贝 + 复合字形（带平移）都能对回数字；实测 fontBuilder 保留全部映射
    expected = {chr(0xE031 + d): str(d) for d in range(10)}
    expected[chr(0xE040)] = "0"
    assert mapping == expected


def test_extract_font_bytes_finds_embedded_ttf():
    data = _build_synthetic_font()
    html = f"<style>@font-face{{src:url(data:font/ttf;base64,{base64.b64encode(data).decode()})}}</style>"
    extracted = bf.extract_font_bytes(html)
    assert extracted is not None and extracted[:4] == data[:4]
    assert bf.build_digit_map_from_font(extracted) is not None


def test_extract_font_bytes_rejects_png_and_garbage():
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 300).decode()
    assert bf.extract_font_bytes(f"<img src='data:image/png;base64,{png}'>") is None
    assert bf.extract_font_bytes("<p>no font here</p>") is None
    assert bf.extract_font_bytes("") is None
    assert bf.build_digit_map_from_font(b"") is None
    assert bf.build_digit_map_from_font(b"not a font at all" * 20) is None


# ---------------------------------------------------------------------------
# 真实夹具（缺夹具 → skip，绝不假装通过）
# ---------------------------------------------------------------------------

_LIST_CARDS_RE = re.compile(
    r'class="job-name">([^<]+)</a><span[^>]*class="job-salary">([^<]*)</span>'
)
_DET_TITLE_RE = re.compile(r'<h1 title="([^"]+)">')
_DET_SALARY_RE = re.compile(r'<span class="salary">([^<]+)</span>')


def _boss_ground_pair() -> tuple[str, str] | None:
    """详情页主岗位的（列表页混淆薪资, 明文薪资）对照对。"""
    if not (has("boss_list.html") and has("boss_detail.html")):
        return None
    cards = _LIST_CARDS_RE.findall(load("boss_list.html"))
    title_m = _DET_TITLE_RE.search(load("boss_detail.html"))
    salary_m = _DET_SALARY_RE.search(load("boss_detail.html"))
    if not (cards and title_m and salary_m):
        return None
    wanted = title_m.group(1).strip()
    for title, salary in cards:
        if title.strip() == wanted:
            return salary, salary_m.group(1).strip()
    return None


@pytest.mark.skipif(not (has("boss_list.html") and has("boss_detail.html")),
                    reason="缺 BOSS 夹具（需登录补抓）")
class TestBossFixtures:
    def test_ground_pair_exists(self):
        pair = _boss_ground_pair()
        assert pair is not None, "列表与详情没有同岗位对照——夹具结构变了"
        encoded, plain = pair
        assert bf.encoded_chars_in(encoded), "列表薪资应当含混淆字符"
        assert plain == "8-12K", f"详情明文薪资变了：{plain}"

    def test_pairs_mapping_from_fixture(self):
        pair = _boss_ground_pair()
        assert pair is not None
        mapping = bf.mapping_from_pairs([pair])
        assert mapping == {chr(0xE039): "8", chr(0xE032): "1", chr(0xE033): "2"}

    def test_constraints_pin_three_more_symbols(self):
        pair = _boss_ground_pair()
        assert pair is not None
        known = bf.mapping_from_pairs([pair])
        salaries = [s for _, s in _LIST_CARDS_RE.findall(load("boss_list.html"))]
        cm = bf.mapping_from_constraints(salaries, known=known)
        # 穷举全部可行赋值后取值唯一的符号（18 个可行解里全部一致）
        assert cm.certain == {
            chr(0xE031): "0", chr(0xE032): "1", chr(0xE033): "2",
            chr(0xE034): "3", chr(0xE035): "4", chr(0xE039): "8",
        }
        # 其余符号老实留在候选集里：候选全部落在 {5,6,7,9}，且不止一个（没被乱猜）
        assert set(cm.candidates) == {chr(0xE036), chr(0xE037), chr(0xE038), chr(0xE03A)}
        assert all(v <= {"5", "6", "7", "9"} for v in cm.candidates.values())
        assert all(len(v) > 1 for v in cm.candidates.values())

    def test_decode_cards_with_derived_mapping(self):
        pair = _boss_ground_pair()
        assert pair is not None
        cm = bf.mapping_from_constraints(
            [s for _, s in _LIST_CARDS_RE.findall(load("boss_list.html"))],
            known=bf.mapping_from_pairs([pair]),
        )
        cards = _LIST_CARDS_RE.findall(load("boss_list.html"))
        decoded = {t: bf.decode_salary(s, cm.certain) for t, s in cards}
        # 只含已钉死符号的卡片：完整还原（全部 15 卡里这 4 张的字符集 ⊆ certain）
        assert decoded["AI人工智能技术员（服装方向）"].text == "8-12K"
        assert decoded["AI 漫剧合伙人"].text == "8-13K"
        assert decoded["AI短剧制作员（带货/剧情/多平台）"].text == "8-13K"
        assert decoded["接受无经验+当月发薪（人工智能赛道+双休）"].text == "12-24K"
        for title in ("AI人工智能技术员（服装方向）", "AI 漫剧合伙人",
                      "AI短剧制作员（带货/剧情/多平台）",
                      "接受无经验+当月发薪（人工智能赛道+双休）"):
            assert decoded[title].ok is True
        # 含未定符号的卡片：已知位被还原、未知位保留原样并标 ok=False
        partial = decoded["人工智能训练师"]
        assert partial.ok is False and partial.text.endswith("-8K")

    def test_no_font_embedded_in_fixture(self):
        # 夹具是 DOM 导出，字体走外链没被保存：字体路径在夹具上应诚实返回 None
        assert bf.extract_font_bytes(load("boss_list.html")) is None
