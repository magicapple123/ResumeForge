# SPDX-License-Identifier: Apache-2.0
"""20 份**迭代样例**（W00 要求的那 20 份小规模合成样例）。

作用：日常改渲染/导出后先跑这一组，确认"每套模板 × 三档字号 × 两种纸面语言 ×
有无照片"的基本外观没坏。它们**不追求覆盖边界**（那是 sample_corpus_boundaries 的
100 份），而是每条路径都有且只有一条最小可复现证据：参数组合一眼能看明白，
失败时报告里的 id 就能定位到"哪套模板的哪一档"。

期望口径：
- max_pages 是"自然页数上限"：宽边距模板（modern/elegant/minimal/editorial）在
  standard 档同一份内容自然排 2 页，所以声明 2——这是实测结果，不是放水；
- photo 与 include_photo 一致（关掉照片时 PDF/HTML/Word 都不该有照片对象）；
- text_tokens 取姓名与公司名：它们在所有文本产物里都必须出现。
"""

from __future__ import annotations

from typing import Any

from .sample_content_variants import dense
from .sample_specs import Expect, Sample, base_content, with_photo

_NAME = "示例甲"
_COMPANY = "示例科技有限公司"
_BASE_TOKENS = (_NAME, _COMPANY)


def _content(*, photo: bool = True, photo_kind: str = "standard") -> dict[str, Any]:
    content = base_content()
    if photo:
        return with_photo(content, kind=photo_kind)
    return content


def _expect(
    *,
    page_limit: int,
    photo: bool,
    tokens: tuple[str, ...],
    overflow: bool = False,
    max_pages: int | None = None,
) -> Expect:
    return Expect(
        max_pages=page_limit if max_pages is None else max_pages,
        overflow=overflow,
        photo=photo,
        text_tokens=tokens,
    )


def _sample(
    index: int,
    *,
    template: str,
    coverage: tuple[str, ...],
    font_scale: str = "standard",
    language: str = "zh-CN",
    photo: bool = True,
    page_limit: int = 1,
    format_config: dict[str, Any] | None = None,
    content: dict[str, Any] | None = None,
    overflow: bool = False,
    max_pages: int | None = None,
) -> Sample:
    tokens = _BASE_TOKENS if content is None else (_NAME,)
    return Sample(
        sample_id=f"iter-{index:02d}",
        kind="iteration",
        category="iteration",
        title=f"迭代 {index:02d} · {template} · {font_scale} · {language}",
        coverage=coverage,
        content=content if content is not None else _content(photo=photo),
        template=template,
        font_scale=font_scale,
        page_limit=page_limit,
        language=language,
        format_config=format_config,
        include_photo=photo,
        expect=_expect(
            page_limit=page_limit,
            photo=photo,
            tokens=tokens,
            overflow=overflow,
            max_pages=max_pages,
        ),
    )


def iteration_samples() -> list[Sample]:
    """按固定顺序返回 20 份迭代样例（顺序即报告顺序，不许随环境变化）。"""
    return [
        _sample(
            1,
            template="classic",
            coverage=("可见模板 classic 的默认一页版面", "七分区齐全 + 照片"),
        ),
        _sample(
            2,
            template="modern",
            page_limit=2,
            coverage=("可见模板 modern 的默认版面", "同一份标准内容在 modern 自然排 2 页"),
        ),
        _sample(
            3,
            template="compact",
            coverage=("可见模板 compact 的默认一页版面", "细线分隔 + 紧凑行距"),
        ),
        _sample(
            4,
            template="elegant",
            page_limit=2,
            coverage=("可见模板 elegant 的居中页头", "照片在左侧；同一份内容自然排 2 页"),
        ),
        _sample(
            5,
            template="minimal",
            page_limit=2,
            coverage=("可见模板 minimal 的无装饰版面", "纯黑白灰 + 大页边距；标准内容自然排 2 页"),
        ),
        _sample(
            6,
            template="scholar",
            coverage=("可见模板 scholar 的学术版式", "加粗标题 + 整宽细线 + 技能列表"),
        ),
        _sample(
            7,
            template="classic",
            font_scale="small",
            coverage=("小字号档（11px）", "同样内容的行高与标签几何"),
        ),
        _sample(
            8,
            template="classic",
            font_scale="large",
            page_limit=2,
            coverage=("大字号档（18px）", "一页放不下时按 page_limit=2 正常顺延"),
        ),
        _sample(
            9,
            template="modern",
            font_scale="small",
            coverage=("modern + 小字号", "色块页头在小字号下的比例"),
        ),
        _sample(
            10,
            template="scholar",
            font_scale="small",
            photo=False,
            coverage=("学术模板无照片", "无照片时页头不留空洞"),
        ),
        _sample(
            11,
            template="classic",
            language="en-US",
            coverage=("英文纸面文案（en-US）", "七分区标题与字段前缀走 resume_labels"),
        ),
        _sample(
            12,
            template="scholar",
            language="en-US",
            coverage=("学术模板 + 英文纸面文案", "英文标题长度对分页的影响"),
        ),
        _sample(
            13,
            template="classic",
            format_config={
                "section_order": [
                    "summary",
                    "education",
                    "experience",
                    "projects",
                    "skills",
                    "campus_experience",
                    "awards",
                ]
            },
            coverage=("自定义分区顺序", "summary 提前后 PDF/Word/Markdown 顺序一致"),
        ),
        _sample(
            14,
            template="modern",
            page_limit=2,
            content=with_photo(dense(4), kind="standard"),
            overflow=True,
            max_pages=3,
            coverage=("故意超页：内容需要 3 页、上限 2 页", "截断并标记 overflow，不缩字号"),
        ),
        _sample(
            15,
            template="compact",
            photo=False,
            format_config={"accent": "#7a3e2f", "line_height": 1.45},
            coverage=("版式覆盖：强调色 + 行高", "format_config 在 PDF/HTML/Word 同源生效"),
        ),
        _sample(
            16,
            template="technical",
            coverage=("已下线但仍可渲染的 technical 模板", "老记录 template 字段解析"),
        ),
        _sample(
            17,
            template="editorial",
            page_limit=2,
            coverage=(
                "已下线但仍可渲染的 editorial 模板",
                "衬线标题 + 居中分区标题；标准内容自然 2 页",
            ),
        ),
        _sample(
            18,
            template="split",
            coverage=("已下线但仍可渲染的 split 双栏模板", "两栏并排与行级分页"),
        ),
        _sample(
            19,
            template="classic",
            page_limit=2,
            format_config={"page_padding": 20, "line_height": 1.9, "accent": "#2f4858"},
            coverage=("宽页边距 + 大行高 + 自定义强调色", "参数即呈现；标准内容自然排 2 页"),
        ),
        _sample(
            20,
            template="minimal",
            font_scale="large",
            page_limit=2,
            coverage=("极简模板 + 大字号 + 两页上限", "字号档与页数上限组合"),
        ),
    ]


__all__ = ["iteration_samples"]
