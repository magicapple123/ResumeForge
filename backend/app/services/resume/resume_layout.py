"""简历版面诊断与「自动一页」的规则。

**为什么这些规则放在后端**：它们纯是判断（多少算满、先动哪个旋钮、字号缩到哪为止），
放这里能被 pytest 逐个钉住，也能让界面、助手和导出共用同一份结论。前端只做两件它
才有能力做的事——**在真实浏览器里量出高度**、**把选中的方案应用上去**。

**测量为什么必须在浏览器里做**：版面只有真正排版之后才存在。后端既没有浏览器，
也不该为了量一个高度去引一个无头浏览器依赖。

两条容易踩错的约定：

- **溢出不能用 ``scrollHeight`` 判断**。``scrollHeight`` 会把 ``padding`` 之外的空白
  一起算进去，量出来的"内容高度"偏大；要拿"固定页高 − 上下 padding"作为可用高度，
  再比最后一个可见元素的底边。
- **字号下限按绝对像素算，不按比例算**。档位本身有大小（小字号 12px、标准 14px），
  同一个比例系数在两者上的结果差很多：标准档乘 0.88 还有 12.3px，小字号档乘 0.88
  就只剩 10.6px 了。所以下限是"不低于 12px（≈9pt）"，换算成系数时要除以基准字号。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING


# ===== 版面健康区间 =====
# 单页：低于 82% 显得空，高于 96% 显得挤。
FILL_SPARSE = 0.82
FILL_DENSE = 0.96
# 明显太空：这时候该说的是"补内容或减少页数"，而不是"调间距"。
FILL_TOO_SPARSE = 0.60
# 多页时末页的底线：低于它说明最后一张几乎是空的，应该把内容前移。
LAST_PAGE_MIN_FILL = 0.70

# ===== 收紧用的下限（自动一页最多收这么多，再往下就不像是"同一份简历"了）=====
MIN_PADDING_MM = 12.0
MIN_LINE_HEIGHT = 1.4
MIN_SECTION_GAP = 0.8
# 正文字号不低于 12px（≈9pt）。低于这个数打印出来会明显吃力。
MIN_FONT_PX = 11.0

_PADDING_STEP_MM = 2.0
_SECTION_GAP_STEP = 0.25
_LINE_HEIGHT_STEP = 0.15
_FONT_STEP = 0.02

# 版面结论
STATUS_OVERFLOW = "overflow"
STATUS_DENSE = "dense"
STATUS_HEALTHY = "healthy"
STATUS_SPARSE = "sparse"
STATUS_TOO_SPARSE = "too_sparse"
STATUS_UNKNOWN = "unknown"

STATUS_LABELS = {
    STATUS_OVERFLOW: "超出所选页数",
    STATUS_DENSE: "偏满",
    STATUS_HEALTHY: "合适",
    STATUS_SPARSE: "偏空",
    STATUS_TOO_SPARSE: "明显太空",
    STATUS_UNKNOWN: "无法测量",
}

# 建议的类别。顺序就是界面上的展示顺序，也是"先改哪个"的优先级。
SUGGESTION_RESTRUCTURE = "restructure"
SUGGESTION_STRUCTURE = "structure"
SUGGESTION_SPACING = "spacing"
SUGGESTION_FONT = "font"
SUGGESTION_EXTEND = "extend"
SUGGESTION_CONTENT = "content"


@dataclass
class PageMeasure:
    """一页的实测填充度。``fill`` 是「正文占用高度 ÷ 该页可用高度」，可以大于 1。"""

    page: int
    fill: float


@dataclass
class Suggestion:
    kind: str
    title: str
    detail: str


@dataclass
class Diagnosis:
    status: str
    status_label: str
    # 整体填充度（正文总高 ÷ 总可用高），用于界面上的百分比读数。
    fill: float
    # 按内容量算出来需要几页；比所选页数大就说明塞不下。
    pages_needed: int
    page_limit: int
    pages: list[PageMeasure] = field(default_factory=list)
    suggestions: list[Suggestion] = field(default_factory=list)
    # 一句话结论，界面直接显示。
    summary: str = ""


def _round(value: float, digits: int = 3) -> float:
    return round(value + 0.0, digits)


def derive_pages(
    used_height: float, page_content_height: float, page_limit: int
) -> tuple[list[PageMeasure], int, float]:
    """把"内容总高"换算成逐页填充度、所需页数与整体填充度。

    这是纯算术，所以完整地测：客户端的职责只是把两个高度量准，剩下的换算全在这里。
    """
    if page_content_height <= 0 or page_limit < 1:
        return [], 0, 0.0

    capacity = page_content_height * page_limit
    # 至少算一页：内容为空时若算出 0 页，界面上会显示成"0 页"。
    pages_needed = max(1, int(-(-used_height // page_content_height)))

    pages: list[PageMeasure] = []
    remaining = used_height
    for index in range(1, pages_needed + 1):
        fill = min(1.0, remaining / page_content_height)
        pages.append(PageMeasure(page=index, fill=_round(max(0.0, fill))))
        remaining -= page_content_height

    return pages, pages_needed, _round(max(0.0, used_height / capacity))


def diagnose(
    *,
    used_height: float,
    page_content_height: float,
    page_limit: int,
    has_fit_room: bool = True,
) -> Diagnosis:
    """给出一份版面诊断。

    ``has_fit_room`` 为假表示版式已经没有可收紧的余地了，此时不应再建议"自动一页"。
    """
    if page_content_height <= 0 or page_limit < 1:
        return Diagnosis(
            status=STATUS_UNKNOWN,
            status_label=STATUS_LABELS[STATUS_UNKNOWN],
            fill=0.0,
            pages_needed=0,
            page_limit=max(1, page_limit),
            summary="没能量到版面尺寸，无法给出诊断。",
        )

    pages, pages_needed, fill = derive_pages(used_height, page_content_height, page_limit)
    last_page_fill = pages[-1].fill if pages else 0.0

    if pages_needed > page_limit:
        status = STATUS_OVERFLOW
    elif page_limit == 1:
        if fill < FILL_TOO_SPARSE:
            status = STATUS_TOO_SPARSE
        elif fill < FILL_SPARSE:
            status = STATUS_SPARSE
        elif fill > FILL_DENSE:
            status = STATUS_DENSE
        else:
            status = STATUS_HEALTHY
    else:
        # 多页：末页太空是最常见的问题（第一页塞满、第二页只有两行）。
        if last_page_fill < LAST_PAGE_MIN_FILL:
            status = STATUS_SPARSE
        elif fill > FILL_DENSE:
            status = STATUS_DENSE
        else:
            status = STATUS_HEALTHY

    suggestions = _suggestions(
        status=status,
        fill=fill,
        last_page_fill=last_page_fill,
        pages_needed=pages_needed,
        page_limit=page_limit,
        has_fit_room=has_fit_room,
    )
    return Diagnosis(
        status=status,
        status_label=STATUS_LABELS[status],
        fill=fill,
        pages_needed=pages_needed,
        page_limit=page_limit,
        pages=pages,
        suggestions=suggestions,
        summary=_summary(status, fill, last_page_fill, pages_needed, page_limit),
    )


def _percent(value: float) -> str:
    return f"{round(value * 100)}%"


def _summary(
    status: str, fill: float, last_page_fill: float, pages_needed: int, page_limit: int
) -> str:
    if status == STATUS_OVERFLOW:
        return (
            f"内容按当前版式需要 {pages_needed} 页，超过所选的 {page_limit} 页。"
            "可以先试试自动一页，它会按「间距 → 行高 → 字号」的顺序收紧。"
        )
    if status == STATUS_DENSE:
        return f"正文占了 {_percent(fill)}，已经接近页面上限；再添两行就会溢出去。"
    if status == STATUS_SPARSE and page_limit > 1:
        return (
            f"末页只占了 {_percent(last_page_fill)}，明显偏空。"
            "把内容往前挪、或减到更少的页数会更好看。"
        )
    if status == STATUS_SPARSE:
        return f"正文占了 {_percent(fill)}，页面下方还空着一块。"
    if status == STATUS_TOO_SPARSE:
        return f"正文只占了 {_percent(fill)}，看起来会比较单薄。"
    return f"正文占了 {_percent(fill)}，版面合适。"


def _suggestions(
    *,
    status: str,
    fill: float,
    last_page_fill: float,
    pages_needed: int,
    page_limit: int,
    has_fit_room: bool,
) -> list[Suggestion]:
    """按固定顺序给建议：重排 → 结构 → 间距/字号 → 扩页。

    **顺序本身就是规则的一部分**。先让人调间距、调不好再让人删内容，等于让人白改一轮；
    反过来先说"精简内容"，用户又可能删掉本来放得下的经历。所以只有前面几步都不够时才
    往下一步。
    """
    items: list[Suggestion] = []

    if status == STATUS_OVERFLOW:
        # ① 重排：不删东西、也不改版式，只是把顺序调一下。
        items.append(
            Suggestion(
                SUGGESTION_RESTRUCTURE,
                "先看能不能靠重排放下",
                "把最强、最相关的经历提到前面，同类的技能与奖项合并成一行，"
                "删掉重复的背景描述——通常这一轮就能省下一段的高度。",
            )
        )
        # ② 结构：不用调参数就能拿到的空间。
        items.append(
            Suggestion(
                SUGGESTION_STRUCTURE,
                "检查结构上有没有浪费",
                "确认没有多余的空标题、没有只占一行的独立区块。"
                "次要经历可以压成一行摘要，不必和主项目平均分配篇幅。",
            )
        )
        # ③ 间距 / 字号：这就是自动一页做的事，所以只在还有收紧余地时提。
        if has_fit_room:
            items.append(
                Suggestion(
                    SUGGESTION_SPACING,
                    "用「自动一页」收紧版式",
                    "按「页边距 → 区块间距 → 行高 → 字号」的顺序一项项试，"
                    "每试一项量一次，够放下就停——不会一次把字缩到很小。"
                    f"字号最多缩到 {MIN_FONT_PX:g}px（≈9pt）为止。",
                )
            )
        else:
            items.append(
                Suggestion(
                    SUGGESTION_FONT,
                    "版式已经收到最紧了",
                    "页边距、行高、字号都已经到下限量，再收会影响可读性。"
                    "接下来只能精简内容或增加页数。",
                )
            )
        # ④ 精简内容
        items.append(
            Suggestion(
                SUGGESTION_CONTENT,
                "精简内容（最后一招）",
                "删掉那些占了一行、但面试官不会追问的要点。"
                "宁可留三条扎实的，也不要写六条凑数的。",
            )
        )
        # ⑤ 扩页：明确说明代价。
        if page_limit < 3:
            items.append(
                Suggestion(
                    SUGGESTION_EXTEND,
                    "增加页数",
                    "最省事，但要确认内容值得多出一页——"
                    "一整页里只有两行是常见事故，校招简历通常一到两页最稳妥。",
                )
            )
        return items

    if status == STATUS_DENSE:
        items.append(
            Suggestion(
                SUGGESTION_RESTRUCTURE,
                "留一点余量",
                "现在只剩不到 4% 的余量，改两个字就可能溢出一行。"
                "要么把某条要点压短一点，要么先收紧行高腾出空间。",
            )
        )
        if has_fit_room:
            items.append(
                Suggestion(
                    SUGGESTION_SPACING,
                    "想更稳就先收一点",
                    "用「自动一页」收一档，页面会松快一点，也免得之后手改内容时突然溢出。",
                )
            )
        return items

    if status in (STATUS_SPARSE, STATUS_TOO_SPARSE):
        if page_limit > 1:
            if pages_needed < page_limit:
                items.append(
                    Suggestion(
                        SUGGESTION_EXTEND,
                        f"页数可以减少到 {pages_needed} 页",
                        "按当前内容量用不了这么多页。把页数调小会顺带把版式放大，"
                        "看起来更充实，也不会留出一整页空白。",
                    )
                )
            else:
                # 末页空、但页数已经压到刚好装下：这时唯一的办法是把内容再压一点，
                # 所以直接算出"还要压掉多少"——「精简一下」这种说法等于没说。
                capacity_used = fill * page_limit
                shrink = (
                    max(0.0, 1 - (pages_needed - 1) / capacity_used)
                    if capacity_used > 0
                    else 0.0
                )
                items.append(
                    Suggestion(
                        SUGGESTION_RESTRUCTURE,
                        "把内容压进一页会更利落",
                        f"末页只占了 {_percent(last_page_fill)}。"
                        f"整体再减少约 {_percent(shrink)} 的内容就能收进 {pages_needed - 1} 页——"
                        "通常合并同类项、删掉不会被追问的要点就够了。",
                    )
                )
        items.append(
            Suggestion(
                SUGGESTION_CONTENT,
                "把空间用起来",
                "补上还没写进去的经历或项目；如果确实写满了，"
                "可以调大字号或行高让版面更舒展——空着大半页反而显得准备不足。",
            )
        )
        items.append(
            Suggestion(
                SUGGESTION_STRUCTURE,
                "检查是不是筛得太狠",
                "如果生成时选的岗位太窄，很多经历会被筛掉。"
                "换一份「通用简历」或不特意筛，往往就能把版面填起来。",
            )
        )
        return items

    if status == STATUS_HEALTHY:
        items.append(
            Suggestion(
                SUGGESTION_RESTRUCTURE,
                f"占用 {_percent(fill)}，保持即可",
                "这个区间既不留大片空白，也不显得拥挤，直接导出就好。",
            )
        )
    return items


if TYPE_CHECKING:
    # 「自动一页」符号在 ``resume_fit`` 子模块；类型期静态可见，运行期经下面的
    # ``__getattr__`` 惰性转发——``resume_fit`` 反向依赖本模块的常量，顶层互相导入会成环
    # （与 Wave1 ``webform/live.py`` 的 MultiLiveSession 契约同一处理）。
    from .resume_fit import FitCandidate, build_fit_ladder, fit_room_report, font_adjust_floor


def __getattr__(name: str):
    """运行期惰性再导出 ``resume_fit`` 的自动一页符号。"""
    if name in {"FitCandidate", "build_fit_ladder", "fit_room_report", "font_adjust_floor"}:
        from . import resume_fit

        return getattr(resume_fit, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "Diagnosis",
    "FILL_DENSE",
    "FILL_SPARSE",
    "FILL_TOO_SPARSE",
    "FitCandidate",
    "LAST_PAGE_MIN_FILL",
    "MIN_FONT_PX",
    "MIN_LINE_HEIGHT",
    "MIN_PADDING_MM",
    "MIN_SECTION_GAP",
    "PageMeasure",
    "STATUS_DENSE",
    "STATUS_HEALTHY",
    "STATUS_LABELS",
    "STATUS_OVERFLOW",
    "STATUS_SPARSE",
    "STATUS_TOO_SPARSE",
    "STATUS_UNKNOWN",
    "SUGGESTION_CONTENT",
    "SUGGESTION_EXTEND",
    "SUGGESTION_FONT",
    "SUGGESTION_RESTRUCTURE",
    "SUGGESTION_SPACING",
    "SUGGESTION_STRUCTURE",
    "Suggestion",
    "build_fit_ladder",
    "derive_pages",
    "diagnose",
    "fit_room_report",
    "font_adjust_floor",
]
