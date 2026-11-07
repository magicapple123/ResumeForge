# SPDX-License-Identifier: Apache-2.0
"""简历质量相关只读 action（T28 收尾）：check_ats_match / compare_resume_versions。

这两对都真实存在（工具 + 路由），且路由 handler 是同步纯本地计算，用旧实现委托范式：
- check_ats_match：路由 POST /api/resumes/{resume_id}/ats-check（body 是 jd_text）；
  工具参数是 resume_id + job_id（本地按岗位 JD 算），run_tool 保留旧 handler 语义。
- compare_resume_versions：路由 GET /api/resumes/{resume_id}/versions/{base_id}/compare/{against}；
  工具参数是 from_version/to_version，用 tool_argument_aliases + argument_map 对齐。
run_quality_check / get_resume_preflight 的路由分别是 async / 需要 Request 对象，不适合
同步 ActionSpec run，保留静态声明并进 allowlist。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.ats import AtsCheckOut
from ....schemas.versions import VersionCompareOut
from ..legacy import route_runner, tool_runner
from ..registry import define_action
from ..spec import ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session  # noqa: F401


class CheckAtsMatchInput(BaseModel):
    """check_ats_match 两侧共用入参（并集）：路由用 jd_text，工具用 job_id。"""

    model_config = ConfigDict(extra="forbid")

    resume_id: int = Field(description="简历 id（先用 list_resumes 查）")
    job_id: int | None = Field(default=None, description="岗位 id（先用 list_jobs 查）")
    jd_text: str = Field(default="", description="岗位 JD 原文（路由侧用）")


class CompareResumeVersionsInput(BaseModel):
    """compare_resume_versions 两侧共用入参：路由 base_id/against ↔ 工具 from/to_version。"""

    model_config = ConfigDict(extra="forbid", coerce_numbers_to_str=True)

    resume_id: int = Field(description="简历 id")
    base_id: int = Field(description="起始版本 id（较旧的一侧）")
    against: str = Field(description="目标版本 id 或 current（较新的一侧）")

    # 旧工具参数名（tool_argument_aliases 会把它们换成上面的字段）
    @classmethod
    def tool_defaults(cls) -> dict[str, object]:
        return {}


def _compare_tool_arguments(payload: CompareResumeVersionsInput) -> dict[str, object]:
    target: object = payload.against
    if isinstance(target, str) and target.isdigit():
        target = int(target)
    return {
        "resume_id": payload.resume_id,
        "from_version": payload.base_id,
        "to_version": target,
    }


_ACTIONS: dict[str, ActionSpec] | None = None


def quality_action_pairs() -> dict[str, ActionSpec]:
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    check_ats = define_action(
        ActionSpec(
            name="check_ats_match",
            description=(
                "用**本地规则**估算某份简历对某个岗位的 ATS 适配度（关键词覆盖 / 格式风险 / "
                "信息位置），返回三个分项分、加权总分与前 5 条问题。结果只是本地启发式估计，"
                "回答时必须原样转述免责声明：「本地规则估计，不代表真实 ATS 解析结果」。"
            ),
            input_model=CheckAtsMatchInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.ats", "ats_check"),
            run_tool=tool_runner(
                "app.services.assistant_tools.quality_tools", "_tool_check_ats_match"
            ),
            service_entry="ats_check.check_ats",
            tool_fields=("resume_id", "job_id"),
            ignore_unknown_arguments=True,
            http=HttpRoute(
                "POST", "/api/resumes/{resume_id}/ats-check", AtsCheckOut, tags=("ats",)
            ),
        )
    )
    compare = define_action(
        ActionSpec(
            name="compare_resume_versions",
            description=(
                "对比同一份简历的两个命名版本（from_version → to_version），返回正文行差异、"
                "排版项增删改与字段级变更摘要，超出上限会截断。只读，不恢复也不覆盖任何版本；"
                "版本 id 先用 list_versions 查。"
            ),
            input_model=CompareResumeVersionsInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.resumes.versions_routes", "compare_versions"),
            run_tool=tool_runner(
                "app.services.assistant_tools.quality_tools",
                "_tool_compare_resume_versions",
                argument_map=_compare_tool_arguments,
            ),
            service_entry="resume.document_versions.compare_versions",
            tool_fields=("resume_id", "base_id", "against"),
            tool_argument_aliases=(("from_version", "base_id"), ("to_version", "against")),
            http=HttpRoute(
                "GET",
                "/api/resumes/{resume_id}/versions/{base_id}/compare/{against}",
                VersionCompareOut,
                tags=("resumes",),
            ),
        )
    )
    _ACTIONS = {check_ats.name: check_ats, compare.name: compare}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return quality_action_pairs()


__all__ = [
    "CheckAtsMatchInput",
    "CompareResumeVersionsInput",
    "actions",
    "quality_action_pairs",
]
