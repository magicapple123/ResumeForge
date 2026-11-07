# SPDX-License-Identifier: Apache-2.0
"""profile 域的 action 契约（T28 Batch B）。

迁移对（工具 ↔ 路由，真实成对存在）：

- get_profile ↔ GET /api/profile（只读；两侧都没有入参，空模型）

两侧输出视图刻意不同、但同源：路由返回 ProfileOut（编辑视图全量，含姓名/电话/照片
data URL，响应模型不变）；工具返回脱敏上下文（api.assistant_context.profile_context，
放宽模式开启后才含身份字段）。ActionOutcome 的 data 只给路由、text 只给工具，所以
一份 run 能同时保持两种既有视图，不会把脱敏策略从工具侧搬走。

- update_profile ↔ PUT /api/profile（可逆写；T28 收尾批用 run_tool 分流迁移：路由是
  ProfileUpdate 整份替换、工具是 read-modify-write（先读当前全量再叠加，未传字段保留）。
  run / run_tool 分别委托两份既有实现，业务逻辑零复制；两侧共用同一个 input_model 与
  权限/预览声明。

**工具侧字段面**：旧工具只接受 11 个基础字段（name/gender/birth_year/phone/email/city/
target_city/job_intent/personal_website/github/summary），嵌套条目（教育/经历/项目/技能/
奖项）与照片/网申字段都是路由侧字段。input_model 仍是完整 ProfileUpdate（路由 OpenAPI
与运行时不变），工具侧用 tool_fields 投影出那 11 个字段；tool_adapter 对投影外的入参是
"剥离"而不是报错——与旧工具 handler「只认基础字段、其余静默忽略」的行为一致。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.profile import MAX_PROFILE_DETAIL_CHARS, ProfileOut, ProfileUpdate
from ..legacy import preview_runner, route_runner, tool_runner
from ..registry import define_action
from ..spec import ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


class GetProfileInput(BaseModel):
    """get_profile 的两侧共用入参：旧路由与旧工具都没有参数（schema 必须是空对象）。"""

    model_config = ConfigDict(extra="forbid")


def _run_get_profile(db: Session, payload: GetProfileInput) -> ActionOutcome:
    """同一份入参同时产出两个既有视图（data 给路由、text 给工具）。"""
    # 惰性 import：本模块会被 assistant_tools 的工具声明模块在包初始化期间反向导入，
    # 顶层依赖 assistant_tools 会形成 import 环（与 domains/jobs.py 同一处理）。
    from ...assistant_tools.job_tools import _tool_get_profile
    from ...profile.profile_service import project_legacy_profile

    # 工具文本沿用既有 handler：脱敏/放宽模式的取舍只此一份，run 不复制该逻辑。
    legacy = _tool_get_profile(db, {})
    return ActionOutcome(
        summary=legacy.summary,
        text=legacy.text,
        link=legacy.link,
        data=project_legacy_profile(db),
    )


#: 旧工具 update_profile 声明过的 11 个基础字段（模型只能看到/传入这些）。
_TOOL_PROFILE_FIELDS = (
    "name",
    "gender",
    "birth_year",
    "phone",
    "email",
    "city",
    "target_city",
    "job_intent",
    "personal_website",
    "github",
    "summary",
)


class UpdateProfileInput(ProfileUpdate):
    """update_profile 两侧共用入参：路由整份替换、工具 read-modify-write（run_tool 分流）。

    路由侧收完整 ProfileUpdate（嵌套条目/照片/网申字段全保留）；工具侧 tool_fields 只
    暴露旧工具声明的 11 个基础字段，其余入参被剥离——旧工具对它们就是静默忽略。
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(default="", max_length=64, description="姓名")
    gender: str = Field(default="", max_length=64)
    birth_year: str = Field(default="", max_length=32)
    phone: str = Field(default="", max_length=32)
    email: str = Field(default="", max_length=128)
    city: str = Field(default="", max_length=64, description="所在城市")
    target_city: str = Field(default="", max_length=64, description="期望工作城市")
    job_intent: str = Field(default="", max_length=128, description="求职意向")
    personal_website: str = Field(default="", max_length=256)
    github: str = Field(default="", max_length=256)
    summary: str = Field(default="", max_length=MAX_PROFILE_DETAIL_CHARS, description="个人总结")


_ACTIONS: dict[str, ActionSpec] | None = None


def profile_actions() -> dict[str, ActionSpec]:
    """构建（并注册）profile 域 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    if _ACTIONS is not None:  # 内层重入已完成构建（工具声明模块在 assistant_tools 初始化期调用）
        return _ACTIONS
    get_profile = define_action(
        ActionSpec(
            name="get_profile",
            description="读取个人资料（已脱敏：不含姓名、电话、邮箱和照片）。想确认某个字段是否已填写时用它。",
            input_model=GetProfileInput,
            permission=Permission.READ_ONLY,
            run=_run_get_profile,
            service_entry="settings_service.get_assistant_relaxed_mode",
            # 旧路由忽略未知 query 参数、旧工具忽略未声明的参数：用开关保持同样的宽容。
            ignore_unknown_arguments=True,
            http=HttpRoute("GET", "/api/profile", ProfileOut, tags=("profile",)),
        )
    )
    update_profile = define_action(
        ActionSpec(
            name="update_profile",
            description=(
                "更新个人资料里的基础字段（只传要改的那些，其余字段会被保留）。"
                "教育经历、工作经历、项目、技能、奖项等结构化条目暂不支持，"
                "请让用户在「我的资料」页面编辑。"
            ),
            input_model=UpdateProfileInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=route_runner("app.api.profile", "save_profile"),
            run_tool=tool_runner("app.services.assistant_tools.job_tools", "_tool_update_profile"),
            preview=preview_runner(
                "app.services.assistant_tools.previews", "preview_update_profile"
            ),
            service_entry="profile.profile_service.update_profile",
            tool_fields=_TOOL_PROFILE_FIELDS,
            # 旧 PUT 路由的 Pydantic 模型是 extra=ignore：前端可能回传资料草稿的额外字段，
            # 保持"未知 body 字段被忽略"的历史行为（工具侧仍有 tool_fields 严格投影）。
            ignore_unknown_arguments=True,
            http=HttpRoute("PUT", "/api/profile", ProfileOut, tags=("profile",)),
        )
    )
    _ACTIONS = {spec.name: spec for spec in (get_profile, update_profile)}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return profile_actions()


__all__ = ["GetProfileInput", "UpdateProfileInput", "actions", "profile_actions"]
