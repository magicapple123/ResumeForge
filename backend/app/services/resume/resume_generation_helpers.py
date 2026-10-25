# SPDX-License-Identifier: Apache-2.0
"""简历生成链路的小型纯辅助（从 resume_generator 拆出，行数预算产物）。

三件事都不依赖生成器状态，放在这里让门面文件保持在 500 行预算内：

- has_extended_facts：候选资料是否出现扩展事实栏目（决定提示词是否给出扩展输出
  结构；没有这些事实时提示词逐字节不变，计划 §6.2 C2）；
- parse_resume：模型原始输出 → 结构化简历（JSON 提取 + 容错解析的唯一组合）；
- record_call_usage：把 provider 的 last_usage 补进本链用量汇总（失败/取消轮次
  同样收集，能拿到多少算多少）。
"""

from __future__ import annotations

from typing import Any

from ...schemas.resume import ResumeContent
from .resume_content import coerce_resume, extract_json


def has_extended_facts(profile_data: dict[str, Any]) -> bool:
    """候选资料里是否出现扩展事实栏目（论文/科研/专利/证照/项目公开链接等）。

    仅用于决定生成提示词是否给出扩展输出结构：没有这些事实时提示词与旧行为逐字节
    不变（计划 §6.2 C2；新增事实存在时的结构扩展属明确的资料能力变化）。
    """
    extended_sections = ("publications", "research_projects", "patents", "credentials")
    if any(profile_data.get(section) for section in extended_sections):
        return True
    for item in profile_data.get("projects") or []:
        if isinstance(item, dict) and (item.get("public_url") or item.get("artifact_type")):
            return True
    for item in profile_data.get("experiences") or []:
        if isinstance(item, dict) and item.get("experience_kind"):
            return True
    return False


def parse_resume(raw: str) -> ResumeContent | None:
    """模型原始输出 → 结构化简历；解析失败返回 None（由调用方决定报错/重试）。"""
    data = extract_json(raw)
    return coerce_resume(data) if data is not None else None


def record_call_usage(provider: Any, usage_records: list[Any]) -> None:
    """把 provider 刚结束的这一次调用用量补进本链汇总（PR-07-6）。

    provider 只保留 last_usage（跨轮累计是调用方责任）；在每段的 finally 里调用
    ——失败与取消轮次同样能拿到多少算多少。测试假 Provider 可能不写甚至没有该属性，
    用 getattr 容忍缺失。
    """
    usage = getattr(provider, "last_usage", None)
    if usage is not None:
        usage_records.append(usage)


def begin_budget_segment(provider: Any, segment: Any) -> None:
    """把 child 段的剩余注入 provider 的请求级 deadline（RF-14 §2.1.c）。

    静态 request_deadline_seconds 压缩该段 read timeout（只能收紧，provider 的
    _timeout 取 min(配置值, 本值) 并夹正）；活预算 request_budget 注入 child 段本身
    ——provider 的每次传输尝试/重试决策用 remaining() 重算剩余，退避与硬墙钟都随
    时间递减（PR-07-1/2）。provider 实例不复用，调用方在 finally 里复位即可。
    """
    if segment is not None:
        provider.request_deadline_seconds = segment.remaining()
        provider.request_budget = segment


def end_budget_segment(provider: Any, total_budget: Any) -> None:
    """段结束复位 deadline，并把整链总预算（可能为 None）恢复给 provider。"""
    provider.request_deadline_seconds = None
    provider.request_budget = total_budget


__all__ = [
    "begin_budget_segment",
    "end_budget_segment",
    "has_extended_facts",
    "parse_resume",
    "record_call_usage",
]
