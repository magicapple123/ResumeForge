# SPDX-License-Identifier: Apache-2.0
"""边界样例类别构造器（一）：中英混排 / 少内容 / 多内容 / 照片 / 缺字 / 长链接。

每个构造器返回固定顺序的 8 份样例；内容来自 sample_content_variants，渲染参数与
期望在构造器里显式声明。类别归属见 sample_corpus_boundaries.CATEGORY_BUILDERS。
"""

from __future__ import annotations

from typing import Any

from . import sample_content_variants as variants
from .sample_boundary_common import (
    ALL_TEMPLATES,
    FONT_SCALES,
    VISIBLE_TEMPLATES,
    make_sample,
)
from .sample_specs import Expect, Sample, base_content, with_photo


def build_mixed_language() -> list[Sample]:
    samples = []
    for idx in range(8):
        content = variants.mixed_language(idx)
        samples.append(
            make_sample(
                "mixed-language",
                idx + 1,
                f"中英混排 #{idx + 1}",
                (
                    "英文公司名/岗位名与中文正文混排",
                    f"日期格式：{'英文月名' if idx % 3 == 0 else '数字格式'}",
                    f"模板 {ALL_TEMPLATES[idx % len(ALL_TEMPLATES)]}",
                ),
                content,
                template=ALL_TEMPLATES[idx % len(ALL_TEMPLATES)],
                font_scale=FONT_SCALES[idx % 3],
                page_limit=2,
                # 中英混排内容长度随模板/字号波动，不钉自然页数：守 token 与页数上限。
                expect=Expect(
                    text_tokens=("Python", "FastAPI"),
                ),
            )
        )
    return samples


def build_sparse() -> list[Sample]:
    samples = []
    for idx in range(8):
        content = variants.sparse(idx)
        samples.append(
            make_sample(
                "sparse",
                idx + 1,
                f"少内容 #{idx + 1}",
                ("只剩 1–2 个字段", "空分区必须整段跳过（不留空标题）"),
                content,
                template=VISIBLE_TEMPLATES[idx % len(VISIBLE_TEMPLATES)],
                font_scale=FONT_SCALES[idx % 3],
                page_limit=1,
                include_photo=False,
                expect=Expect(max_pages=1, overflow=False, photo=False),
            )
        )
    return samples


def build_dense() -> list[Sample]:
    samples = []
    for idx in range(8):
        # 前 4 份故意超过 1 页（overflow=True），后 4 份给 3 页上限（应放得下或
        # 至少不越界，自然页数由分页算法决定，不钉精确值）。
        page_limit = 1 if idx < 4 else 3
        content = variants.dense(idx % 4 if idx < 4 else idx)
        samples.append(
            make_sample(
                "dense",
                idx + 1,
                f"多内容 #{idx + 1}（page_limit={page_limit}）",
                (
                    "条目多、要点长，内容自然排 2–3 页",
                    "超页时截断到上限并标记 overflow（不缩字号）"
                    if page_limit == 1
                    else "3 页上限内正常分页",
                ),
                content,
                template=("classic", "modern", "compact", "scholar")[idx % 4],
                font_scale="small" if idx % 2 == 0 else "standard",
                page_limit=page_limit,
                include_photo=idx % 2 == 0,
                expect=Expect(
                    # 自然页数随条目数线性增长，只守"超页必须标 overflow"与页数上限。
                    overflow=True if page_limit == 1 else None,
                    text_tokens=("示例科技有限公司（第 1 家）",),
                ),
            )
        )
    return samples


def build_photo() -> list[Sample]:
    configs: list[dict[str, Any]] = [
        {"kind": "standard", "template": "classic", "extra": None},
        {"kind": "wide", "template": "modern", "extra": None},
        {"kind": "tall", "template": "elegant", "extra": None},
        {"kind": "large", "template": "minimal", "extra": None},
        {"kind": "standard", "template": "split", "extra": None},
        {"kind": "standard", "template": "classic", "extra": {"photo_scale": 0.6}},
        {"kind": "standard", "template": "modern", "extra": {"photo_scale": 1.6}},
        {"kind": "none", "template": "classic", "extra": None},
    ]
    samples = []
    for idx, config in enumerate(configs):
        kind = config["kind"]
        include_photo = kind != "none"
        content = base_content()
        if include_photo:
            content = with_photo(content, kind=kind)
        scale = config["extra"]["photo_scale"] if config["extra"] else None
        samples.append(
            make_sample(
                "photo",
                idx + 1,
                f"照片 #{idx + 1}（{kind}）",
                (
                    "照片存在时的页头布局（左侧/右侧/极端宽高比）"
                    if include_photo
                    else "include_photo=False：产物里不应出现照片对象",
                    f"photo_scale={scale}" if scale is not None else "默认照片尺寸",
                ),
                content,
                template=config["template"],
                font_scale=FONT_SCALES[idx % 3],
                page_limit=3,
                format_config=config["extra"],
                include_photo=include_photo,
                expect=Expect(max_pages=3, photo=include_photo),
            )
        )
    return samples


def build_missing_glyph() -> list[Sample]:
    probes = [
        "😀🎉🚀",  # emoji（绝大多数 CJK 字体没有）
        "𠮷𪚥",  # CJK 扩展 B 区生僻字
        "①㊣Ⅷⅷ",  # 数字/符号兼容区
        "∑√∞≈≠≤≥±×÷",  # 数学符号
        "→←↑↓↔⇒⇔",  # 箭头
        "€£¥₩㊙",  # 货币与其他符号
        "ﻻﷺ",  # 阿拉伯文呈现形式
        "😀**加粗**𠮷",  # 缺字与加粗混排
    ]
    samples = []
    for idx in range(8):
        content = base_content()
        content["name"] = "示例戊"
        content["summary"] = f"缺字探测 #{idx + 1}：正常中文里混入 {probes[idx]} 这些字符。"
        content["experience"][0]["description"] = [
            f"要点里也有特殊字符：{probes[idx]}（此处应尽量保留、不崩溃）。",
            "另一条正常要点：确保正文可读。",
        ]
        samples.append(
            make_sample(
                "missing-glyph",
                idx + 1,
                f"缺字 #{idx + 1}",
                (
                    "表情/生僻字/数学符号等字体覆盖缺口",
                    "渲染不得崩溃；md/txt 保留原文；PDF 记下缺失字形清单",
                ),
                content,
                template=ALL_TEMPLATES[idx % len(ALL_TEMPLATES)],
                font_scale=FONT_SCALES[idx % 3],
                page_limit=2,
                expect=Expect(
                    max_pages=2,
                    missing_glyph_probe=True,
                    text_tokens=("缺字探测", "确保正文可读"),
                ),
            )
        )
    return samples


def build_long_url() -> list[Sample]:
    samples = []
    for idx in range(8):
        content = variants.long_url(idx)
        samples.append(
            make_sample(
                "long-url",
                idx + 1,
                f"长链接 #{idx + 1}（长度 {90 + idx * 34}+）",
                (
                    "无空格长 URL 在页眉与正文里换行",
                    "不截断、不丢字符；不制造意外空白页",
                ),
                content,
                template=("classic", "modern", "scholar", "split")[idx % 4],
                font_scale=("small", "standard")[idx % 2],
                page_limit=2,
                expect=Expect(
                    max_pages=3,
                    text_tokens=("https://example.com/abcdefghij", "https://example.org/docs/"),
                ),
            )
        )
    return samples
