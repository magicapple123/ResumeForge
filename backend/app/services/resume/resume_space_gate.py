# SPDX-License-Identifier: Apache-2.0
"""#23 篇幅闭环：生成后按**真实渲染**数页，超限先带差距重试一次，仍超限确定性裁剪。

为什么是独立模块：`resume_generator.py` 已 429 行（500 行预算），而这里要装
"数页 → 重试提示词 → 裁剪"三件事；且裁剪与数页是纯函数（可脱离事件循环单测）。

三条硬边界：
1. **数页必须用真实渲染**（`build_resume_pdf`），不数模型输出的字数——旧链路只靠
   提示词叮嘱，模型按 4 页写、渲染砍成 1 页，用户拿到缺三分之二且无提示的简历。
2. **事实锁字段不参与裁剪**：扩展栏目的 status / 署名顺序 / 链接由 grounding 与
   回填负责，本模块只裁 description/highlights 的**要点条数**，绝不改写字段值。
3. **裁剪有下限**：每条描述至少保留 1 条要点、每份简历最多裁 24 刀；到下限仍超限
   就如实警告，不再硬裁（宁可让用户看到"超出 1 页"也不悄悄把简历删空）。
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ...schemas.resume import ResumeContent

logger = logging.getLogger(__name__)

# 单次裁剪的要点条数上限：超限说明资料与篇幅严重不匹配，裁剪只会更糟。
_MAX_TRIM_POINTS = 24
# 描述列表的最少要点数：裁到 1 条就停（0 条等于删条目，那是 #34 覆盖度的领域）。
_MIN_POINTS_PER_LIST = 1

# 要点列表所在的字段：只裁这些键（事实锁与结构化字段都不在这里面）。
_POINT_LIST_FIELDS: tuple[str, ...] = ("description", "highlights", "achievements")

# 重试提示词不走 .md 模板文件（新增提示词文件要同批改 preflight 与打包脚本，
# 而这段指令是纯程序化拼装，放在 Python 里与 _CONSUMED_SYSTEM_SUPPLEMENT 同先例）。
_SPACE_RETRY_INSTRUCTION = """刚才那份简历按真实排版渲染出了 {pages} 页，超出了「最多 {limit} 页」的篇幅上限。

请**整体压缩**后重新输出完整 JSON（结构与上一轮一致）：
- 每条描述性要点删掉修饰语，保留「动作 + 方法 + 结果」主干；
- 每个条目只保留与岗位最相关的 {points_hint} 条要点，其余整条删除；
- 个人总结压缩到 80 字以内；
- 事实锁字段（论文/专利/证照的 status、署名顺序、链接）保持不变。
宁可少写，也不要超出篇幅；渲染页数由内容量决定，不是由页数上限决定。
"""


def rendered_page_count(
    resume: Any,
    *,
    template: str = "classic",
    font_scale: str = "standard",
    language: str = "zh-CN",
) -> int:
    """按真实 PDF 渲染数页；渲染失败返回 0（调用方据此跳过闸门，不阻断生成）。"""
    try:
        from ..pdf_exporter.fit import build_resume_pdf

        pdf = build_resume_pdf(
            resume if isinstance(resume, dict) else resume.model_dump(),
            template=template,
            page_limit=10,
            font_scale=font_scale,
            language=language,
        )
    except Exception:  # noqa: BLE001 - 数页失败不该把一次成功生成变成失败
        logger.warning("篇幅闸门渲染数页失败，本轮跳过篇幅检查", exc_info=True)
        return 0
    if not getattr(pdf, "spans", None):
        return 0
    return max((int(getattr(span, "page", 1) or 1) for span in pdf.spans), default=1)


def page_overage(
    resume: Any,
    *,
    page_limit: int,
    template: str = "classic",
    font_scale: str = "standard",
    language: str = "zh-CN",
) -> int:
    """渲染页数超出上限几页；未超限或无法测量返回 0。"""
    if int(page_limit) <= 0:
        # 0 = 不限篇幅：没有"超出"这个概念，直接判为不超页（不裁剪、不发警告）。
        return 0
    pages = rendered_page_count(resume, template=template, font_scale=font_scale, language=language)
    if pages <= 0:
        return 0
    return max(0, pages - max(1, int(page_limit)))


def space_retry_prompt(resume: dict[str, Any], overage: int, page_limit: int) -> str:
    """带真实差距的压缩指令（拼在原对话后面，模型看得见自己上一轮的输出）。"""
    pages = max(1, int(page_limit)) + max(1, int(overage))
    points_hint = "1-2" if page_limit <= 1 else "2-3"
    return _SPACE_RETRY_INSTRUCTION.format(
        pages=pages, limit=max(1, int(page_limit)), points_hint=points_hint
    )


def _trim_point_lists(
    section_list: list[dict[str, Any]], budget: int, protected: frozenset[str]
) -> int:
    """按"最长要点优先删"的确定性顺序裁要点，返回实际删除条数。

    每轮从所有可裁列表里挑出**最长的一条**删掉（删长条比删短条省更多版面，
    且保留下来的都是更紧凑的表达）；任何列表裁到 `_MIN_POINTS_PER_LIST` 就不再动。
    `protected` 里的要点（自定义字段回填行）不参与裁剪——它们是确定性回填的用户数据，
    删掉等于把资料里的非空字段又弄丢（C5-B 的反面）。
    """
    removed = 0
    while removed < budget:
        candidates: list[tuple[int, str, int, int]] = []
        for s_index, entry in enumerate(section_list):
            if not isinstance(entry, dict):
                continue
            for field in _POINT_LIST_FIELDS:
                values = entry.get(field)
                if not isinstance(values, list) or len(values) <= _MIN_POINTS_PER_LIST:
                    continue
                for p_index, point in enumerate(values):
                    if isinstance(point, str) and point.strip() and point.strip() not in protected:
                        candidates.append((len(point), field, s_index, p_index))
        if not candidates:
            return removed
        length, field, s_index, p_index = max(candidates, key=lambda item: item[0])
        section_list[s_index][field].pop(p_index)
        removed += 1
        _ = length
    return removed


def trim_to_page_limit(
    resume: dict[str, Any],
    *,
    page_limit: int,
    template: str = "classic",
    font_scale: str = "standard",
    language: str = "zh-CN",
    max_rounds: int = 8,
    protected_lines: frozenset[str] = frozenset(),
) -> tuple[dict[str, Any], int]:
    """确定性裁剪到页数上限内；返回 (裁剪后的简历, 删除的要点条数)。

    只动 `description` / `highlights` / `achievements` 三个要点列表；核心板块
    （工作/项目/技能/校园）与扩展栏目的其他字段一概不改。每轮删完重渲染数页，
    最多 `max_rounds` 轮；到上限仍超页就停手（调用方负责把"仍超 N 页"写进警告）。
    """
    limit = max(1, int(page_limit))
    total_removed = 0
    sections = [
        key
        for key in (
            "experience",
            "projects",
            "campus_experience",
            "education",
            "publications",
            "research_projects",
            "patents",
            "credentials",
            "awards",
        )
        if isinstance(resume.get(key), list)
    ]
    for _ in range(max(1, int(max_rounds))):
        overage = page_overage(
            resume,
            page_limit=limit,
            template=template,
            font_scale=font_scale,
            language=language,
        )
        if overage <= 0:
            break
        removed_this_round = 0
        for key in sections:
            section_list = resume.get(key)
            if not isinstance(section_list, list):
                continue
            removed_this_round += _trim_point_lists(
                section_list, max(1, overage * 3), protected_lines
            )
            if removed_this_round >= _MAX_TRIM_POINTS:
                break
        if removed_this_round == 0:
            break
        total_removed += removed_this_round
        if total_removed >= _MAX_TRIM_POINTS:
            break
    return resume, min(total_removed, _MAX_TRIM_POINTS)


def coverage_gaps(resume: dict[str, Any]) -> list[str]:
    """#34 生成后覆盖度检查：核心板块必须有代表项；缺失返回可读清单（空列表=通过）。"""
    labels = {
        "experience": "实习/工作经历",
        "projects": "项目经历",
        "skills": "专业技能",
        "campus_experience": "校园经历",
    }
    gaps: list[str] = []
    for key, label in labels.items():
        value = resume.get(key)
        if isinstance(value, list) and len(value) > 0:
            continue
        if key == "skills":
            # 技能可能合并进语言/技能列表；空数组才算缺
            gaps.append(f"{label}（应为至少 6 项，当前为空）")
        else:
            gaps.append(f"{label}（没有保留任何条目）")
    return gaps


def finalize_page_budget(
    resume: Any,
    warnings: list[str],
    *,
    page_limit: int,
    font_scale: str,
    language: str,
    protected_lines: frozenset[str] = frozenset(),
) -> Any:
    """#23 后半段 + #34 可观测：内容定稿后的确定性裁剪与如实警告（原地改 warnings）。

    生成器在后处理（扩展栏目回填等）完成后调用——此时数页才是最终页数。模型重试
    已在更早阶段跑过一次；仍超限就按"最长要点优先"裁到装下，删了多少、还超多少
    如实写进 warnings，绝不静默截断。返回（可能被替换的）resume。
    """
    final_overage = page_overage(
        resume, page_limit=page_limit, font_scale=font_scale, language=language
    )
    if final_overage <= 0:
        # 含"不限篇幅"（page_limit <= 0）：不裁剪、不发超页/删减警告，但**仍做覆盖度检查**
        # ——"这个板块一条都没留下"和篇幅无关，用户需要知道。
        if int(page_limit) <= 0:
            final_gaps = coverage_gaps(resume if isinstance(resume, dict) else resume.model_dump())
            if final_gaps:
                warnings.append(
                    "以下核心板块在生成结果中没有保留任何条目："
                    + "、".join(final_gaps)
                    + "。可核对资料后手动补充，或重新生成。"
                )
        return resume
    raw = resume if isinstance(resume, dict) else resume.model_dump()
    trimmed, removed = trim_to_page_limit(
        raw,
        page_limit=page_limit,
        font_scale=font_scale,
        language=language,
        protected_lines=protected_lines,
    )
    if removed > 0:
        # 用 pydantic 校验重建，而不是 parse_resume 往返——后者会丢掉 v1 的
        # custom_sections / custom_fields（2026-11-01 实测把自建板块整块丢掉）。
        # dict 输入（测试/工具调用）没有模型可校验，原样返回裁剪结果。
        if isinstance(resume, dict):
            resume = trimmed
        else:
            try:
                reparsed = type(resume).model_validate(trimmed)
            except Exception:  # noqa: BLE001 - 重建失败沿用原简历，警告照发
                logger.error("[space-gate] trimmed resume rebuild failed", exc_info=True)
                reparsed = None
            if reparsed is not None:
                resume = reparsed
        warnings.append(
            f"已按篇幅上限自动删减 {removed} 条要点（超长内容优先删）；"
            "需要恢复的内容可以在「手动调整」里手动加回。"
        )
    remaining = page_overage(
        resume, page_limit=page_limit, font_scale=font_scale, language=language
    )
    if remaining > 0:
        warnings.append(
            f"按「最多 {page_limit} 页」生成后实际渲染仍超出 {remaining} 页"
            f"（目标 {page_limit} 页、实际 {max(1, int(page_limit)) + remaining} 页）："
            "内容会按页数上限截断展示，建议手动精简或提高页数上限后重新生成。"
        )
    final_gaps = coverage_gaps(resume if isinstance(resume, dict) else resume.model_dump())
    if final_gaps:
        warnings.append(
            "以下核心板块在生成结果中没有保留任何条目："
            + "、".join(final_gaps)
            + "。可核对资料后手动补充，或重新生成。"
        )
    return resume


def serialize_shortfall_context(resume: dict[str, Any]) -> str:
    """把当前产物的板块条数概要给重试提示（模型据此决定删哪个板块）。"""
    counts = {key: len(value) for key, value in resume.items() if isinstance(value, list) and value}
    return json.dumps(counts, ensure_ascii=False)


async def run_space_retry(
    *,
    provider: Any,
    messages: list[dict[str, str]],
    resume: dict[str, Any],
    overage: int,
    page_limit: int,
    coverage_gap_texts: list[str] | None = None,
    usage_records: list[Any] | None = None,
    budget: Any = None,
    total_budget: Any = None,
) -> ResumeContent | None:
    """篇幅/覆盖度重试：带真实差距的压缩指令 + 当前板块概要，返回解析后的简历或 None。

    返回 ``ResumeContent``（不是裸 dict）：调用方拿到的必须是**已校验的模型**，因为它
    要接着过 cliche / 一致性门槛，那些函数只认 v1 模型；``parse_resume`` 的产物就是这个类型。
    失败一律返回 None（沿用首轮产物 + 警告口径），绝不把一次成功生成变成失败——
    与 `run_quality_retry` 的失败语义一致。重试是真实的模型调用，必须像质量重试一样
    取**子预算段**（预算耗尽不得伪装成网络问题逃过记账）。
    """
    from ...runtime.operation_budget import OperationCancelled
    from .resume_generation_helpers import (
        begin_budget_segment,
        end_budget_segment,
        parse_resume,
        record_call_usage,
    )

    parts = [space_retry_prompt(resume, overage, page_limit)] if overage > 0 else []
    if coverage_gap_texts:
        parts.append(
            "此外，以下核心板块在结果里缺失，请补上代表条目（没有事实依据的除外，"
            "补写必须只用候选资料里的事实）：\n- " + "\n- ".join(coverage_gap_texts)
        )
    if not parts:
        return None
    retry_messages = [
        *messages,
        {
            "role": "user",
            "content": "\n\n".join(parts)
            + "\n\n当前产物的板块条数概要："
            + serialize_shortfall_context(resume),
        },
    ]
    segment = budget.child() if budget is not None else None
    if segment is not None:
        segment.raise_if_stopped()
    try:
        begin_budget_segment(provider, segment)
        raw = await provider.chat(retry_messages)
        return parse_resume(raw)
    except OperationCancelled:
        # 用户取消/预算停止必须穿透：不能把"已取消"吞成"沿用首轮"。
        raise
    except Exception as exc:  # noqa: BLE001 - 篇幅重试失败保留首轮结果（与质量重试同口径）
        logger.warning("篇幅重试失败，将沿用首轮结果，异常类型=%s", type(exc).__name__)
        return None
    finally:
        end_budget_segment(provider, total_budget)
        if usage_records is not None:
            record_call_usage(provider, usage_records)


__all__ = [
    "coverage_gaps",
    "finalize_page_budget",
    "page_overage",
    "rendered_page_count",
    "run_space_retry",
    "serialize_shortfall_context",
    "space_retry_prompt",
    "trim_to_page_limit",
]
