# SPDX-License-Identifier: Apache-2.0
"""tracker 域的 action 契约（T28 Batch B）。

迁移对（工具 ↔ 路由，真实成对存在）：

- list_application_tracks  ↔ GET  /api/tracker（只读；路由随列表下发漏斗统计，
  工具自己按 limit 截断并上报总数——同一份查询产出两个既有视图）
- get_application_track    ↔ GET  /api/tracker/{track_id}（只读）
- create_application_track ↔ POST /api/tracker（可逆写；创建即写首个状态事件与投递快照）

- update_application_track ↔ PUT /api/tracker/{track_id}（可逆写；T28 收尾批用 run_tool
  分流迁移：路由是 TrackUpdate 整份替换（未传字段取默认值），工具是 read-modify-write
  （_track_payload 先读当前记录再叠加，未传字段保留）。run / run_tool 分别委托两份既有
  实现，业务逻辑零复制；两侧共用 input_model、权限与预览声明。

跳过（记录理由，不迁）：

- DELETE /api/tracker/{track_id}：没有对应工具（助手不提供删除），不迁。

行为保持：路由路径/方法/响应模型/状态码、工具 name/description/permission/preview 不变；
已记录差异见 T28 证据：错误 detail 变契约形状（与 T27 一致）、工具 schema 由 input_model
生成（多出 additionalProperties=false 与默认值注解；create 工具历史上静默丢弃未知参数，
现在按路由的严格口径拒成 invalid_input）、create 工具缺省 status 时现在与路由一致取
applied（旧工具会报"未知的进度状态"）。
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ....models.tracker import STATUS_APPLIED, STATUSES
from ....schemas.tracker import (
    MAX_TRACK_COMPANY_CHARS,
    MAX_TRACK_DATE_CHARS,
    MAX_TRACK_EVIDENCE_CHARS,
    MAX_TRACK_STAGE_NOTE_CHARS,
    MAX_TRACK_TITLE_CHARS,
    TrackCreate,
    TrackListOut,
    TrackOut,
    TrackUpdate,
)
from ..legacy import preview_runner, tool_runner
from ..registry import define_action
from ..spec import ActionError, ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from ...assistant_tools.authorization import WritePreview

# 与 assistant_tools/_shared.py 的列表上限一致；tests/test_actions_profile_tracker_batch.py 钉住。
_DEFAULT_LIST_LIMIT = 20
_MAX_LIST_LIMIT = 50

# 状态枚举只在 input_model 里声明一次：路由 query 允许 ""（不过滤），工具 schema 的 enum
# 与旧声明逐字一致；create/update 不允许 ""（旧路由会把它拒成 422）。
# 这里写成显式字面量而不是 ``Literal[(*STATUSES,)]``：后者运行时正确，但类型检查器不接受
# "变量出现在类型表达式里"，且该别名一旦是非法类型，每个使用它的字段注解都会连带报错。
# 字面量的重复由下面的 import 期校验兜住——与 ``models.tracker.STATUSES`` 不一致就立刻
# 抛错，因此不会静默漂移成第二份真源。
TrackStatus = Literal[
    "applied", "screening", "assessment", "interview", "offer", "rejected", "unknown"
]
TrackStatusFilter = Literal[
    "applied", "screening", "assessment", "interview", "offer", "rejected", "unknown", ""
]
if tuple(get_args(TrackStatus)) != STATUSES or tuple(get_args(TrackStatusFilter)) != (
    *STATUSES,
    "",
):
    raise RuntimeError("tracker 状态字面量与 models.tracker.STATUSES 不一致，两处必须同改")


class ListApplicationTracksInput(BaseModel):
    """list_application_tracks 两侧共用入参（路由是 query，工具是 JSON 参数）。"""

    model_config = ConfigDict(extra="forbid")

    status: TrackStatusFilter = Field(default="", description="可选，当前进度状态")
    keyword: str = Field(default="", description="可选，公司/岗位/备注关键词")
    limit: int | None = Field(default=None, description="可选，最多返回多少条，默认 20")


class GetApplicationTrackInput(BaseModel):
    """get_application_track 两侧共用入参：track_id 在路由里来自路径参数。"""

    model_config = ConfigDict(extra="forbid")

    track_id: int = Field(description="求职进度 id")


class CreateApplicationTrackInput(TrackCreate):
    """create_application_track 两侧共用入参（继承 TrackCreate，校验器只有一份）。

    覆盖字段只为保住旧工具 schema 给模型看的说明文案与 required 口径
    （company/title 旧工具就标为必填）；status 用 Literal 保留旧工具 schema 的 enum。
    """

    model_config = ConfigDict(extra="forbid")

    company: str = Field(..., max_length=MAX_TRACK_COMPANY_CHARS, description="公司名称，必填")
    title: str = Field(..., max_length=MAX_TRACK_TITLE_CHARS, description="岗位名称，必填")
    status: TrackStatus = Field(default=STATUS_APPLIED)
    stage_note: str = Field(
        default="", max_length=MAX_TRACK_STAGE_NOTE_CHARS, description="阶段补充，如二面/HR 面"
    )
    applied_at: str = Field(
        default="", max_length=MAX_TRACK_DATE_CHARS, description="投递日期 YYYY-MM-DD"
    )
    status_date: str = Field(
        default="", max_length=MAX_TRACK_DATE_CHARS, description="当前状态日期 YYYY-MM-DD"
    )
    next_action_date: str = Field(
        default="", max_length=MAX_TRACK_DATE_CHARS, description="下一步日期 YYYY-MM-DD"
    )
    evidence: str = Field(
        default="", max_length=MAX_TRACK_EVIDENCE_CHARS, description="依据原文摘录"
    )


#: 旧工具 update_application_track 声明过的字段（channel 是路由专属，不进工具字段面）。
_TOOL_TRACK_FIELDS = (
    "track_id",
    "company",
    "title",
    "status",
    "stage_note",
    "applied_at",
    "status_date",
    "next_action",
    "next_action_date",
    "note",
    "evidence",
    "job_id",
    "resume_id",
)


class UpdateApplicationTrackInput(TrackUpdate):
    """update_application_track 两侧共用入参：track_id 路由来自路径、工具来自 JSON。

    路由整份替换、工具 read-modify-write（run_tool 分流）；status 用 Literal 保住旧工具
    schema 的 enum。channel 是路由专属字段：工具侧经 tool_fields 投影看不到也传不进。
    """

    model_config = ConfigDict(extra="forbid")

    track_id: int = Field(description="求职进度 id，必填")
    status: TrackStatus = Field(default=STATUS_APPLIED)

    @model_validator(mode="after")
    def must_identify_a_position(self) -> UpdateApplicationTrackInput:
        """覆盖 TrackCreate 的「公司/岗位必填」：工具侧是 read-modify-write。

        工具只传要改的字段，缺失 company/title 合法；路由侧整份替换的必填校验仍由
        _run_update_application_track 重建 TrackUpdate 时执行（统一转成 invalid_input，
        旧路由是 422）。

        **刻意不做字段清洗/赋值**：mode=after 校验器里的赋值会把字段标记进
        model_fields_set，exclude_unset 随后就会把默认空串也带给旧工具 handler、覆盖
        记录现值。清洗仍在下游（重建 TrackUpdate / 旧工具 handler）执行，语义不变。
        """
        return self


# ----------------------------- list_application_tracks（只读） -----------------------------


def _run_list_application_tracks(db: Session, payload: ListApplicationTracksInput) -> ActionOutcome:
    from ....api.tracker import _track_brief as _route_track_brief
    from ...assistant_tools._shared import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT
    from ...assistant_tools.tracker_tools import _track_brief as _tool_track_brief
    from ...tracker import MAX_LIST_LIMIT as ROUTE_LIST_LIMIT
    from ...tracker import count_tracks, list_tracks, summarize

    # 路由是 500 条兜底（旧行为），把上限下推 SQL，不能为了工具侧"总数"把全表拖进内存。
    # 工具的总数走同一过滤口径的 count（旧工具也是全量计数），行取同一排序的前 limit 条。
    records = list_tracks(
        db, status=payload.status, keyword=payload.keyword, limit=ROUTE_LIST_LIMIT
    )
    total = count_tracks(db, status=payload.status, keyword=payload.keyword)
    shown = records[: min(payload.limit or DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)]
    text = json.dumps(
        {
            "总数": total,
            "返回": len(shown),
            "求职进度": [_tool_track_brief(record) for record in shown],
        },
        ensure_ascii=False,
    )
    return ActionOutcome(
        summary=f"查看了 {len(shown)} 条求职进度",
        text=text,
        link="/tracker",
        data=TrackListOut(
            items=[_route_track_brief(record) for record in records[:ROUTE_LIST_LIMIT]],
            **summarize(db, status=payload.status, keyword=payload.keyword),
        ),
    )


# ----------------------------- get_application_track（只读） -----------------------------


def _run_get_application_track(db: Session, payload: GetApplicationTrackInput) -> ActionOutcome:
    from ...assistant_tools.tracker_tools import _tool_get_application_track
    from ...tracker import track_or_none, track_out

    record = track_or_none(db, payload.track_id)
    if record is None:
        raise ActionError("not_found", f"求职进度 {payload.track_id} 不存在")
    # 工具文本沿用既有 handler（详情字段的拼装只此一份），路由侧用既有 track_out。
    legacy = _tool_get_application_track(db, {"track_id": payload.track_id})
    return ActionOutcome(
        summary=legacy.summary,
        text=legacy.text,
        link=legacy.link,
        data=track_out(record),
    )


# ----------------------------- create_application_track（可逆写） -----------------------------


def _preview_create_application_track(
    db: Session, payload: CreateApplicationTrackInput
) -> WritePreview:
    from ...assistant_tools.previews import preview_create_application_track

    # 预览只看模型显式给出的字段（与旧工具预览的入参集合一致）。
    arguments = payload.model_dump(exclude_unset=True, mode="json")
    return preview_create_application_track(db, arguments)


def _run_create_application_track(
    db: Session, payload: CreateApplicationTrackInput
) -> ActionOutcome:
    from ...assistant_tools.tracker_tools import _track_brief as _tool_track_brief
    from ...tracker import create_track, track_out

    # create_track 负责记录 + 首个状态事件 + 投递快照的同一事务（业务逻辑只此一份）。
    record = create_track(db, payload)
    return ActionOutcome(
        summary=f"新增了「{record.company} · {record.title}」的求职进度",
        text=json.dumps(_tool_track_brief(record), ensure_ascii=False),
        link="/tracker",
        changed=True,
        data=track_out(record),
    )


def _run_update_application_track(
    db: Session, payload: UpdateApplicationTrackInput
) -> ActionOutcome:
    """路由侧：委托既有 save_track（整份替换语义），TrackUpdate 重建失败转 invalid_input。

    不用 legacy.route_runner 的原因：api.tracker 顶层有 from __future__ import annotations，
    handler 的参数注解是字符串，route_runner 的签名适配无法识别 TrackUpdate 模型参数
    （会报"无法提供参数 payload"）。这里显式重建同一个 TrackUpdate 再调用同一个 handler，
    业务逻辑仍只有一份；错误映射只把 schema 校验失败转成 invalid_input（旧路由 422）。
    """
    from ....api.tracker import save_track
    from ....schemas.tracker import TrackUpdate

    try:
        track_payload = TrackUpdate.model_validate(
            payload.model_dump(exclude={"track_id"}, exclude_unset=True, mode="json")
        )
        return ActionOutcome(data=save_track(payload.track_id, track_payload, db))
    except ValidationError as exc:
        message = "；".join(
            f"{'.'.join(str(item) for item in error.get('loc', ())) or 'arguments'}: "
            f"{error.get('msg', '参数不合法')}"
            for error in exc.errors()
        )
        raise ActionError("invalid_input", message or "参数校验失败") from exc


_ACTIONS: dict[str, ActionSpec] | None = None


def tracker_actions() -> dict[str, ActionSpec]:
    """构建（并注册）tracker 域 action，返回 name -> ActionSpec（幂等、可重入）。"""
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
    list_tracks_action = define_action(
        ActionSpec(
            name="list_application_tracks",
            description=(
                "列出求职进度记录，可按状态或公司/岗位/备注关键词筛选。用户问投递到哪一步、"
                "哪些岗位还在推进或哪些记录没有下一步时先调用。"
            ),
            input_model=ListApplicationTracksInput,
            permission=Permission.READ_ONLY,
            run=_run_list_application_tracks,
            service_entry="tracker.list_tracks",
            tool_defaults=(("limit", _DEFAULT_LIST_LIMIT),),
            # 旧路由忽略未知 query（例如岗位深链的 job_id 在旧列表端点就是不认识的），
            # 旧工具同样只读它认识的键：用开关保持这段历史行为。
            ignore_unknown_arguments=True,
            http=HttpRoute("GET", "/api/tracker", TrackListOut, tags=("tracker",)),
        )
    )
    get_track_action = define_action(
        ActionSpec(
            name="get_application_track",
            description="按 id 读取一条求职进度的完整内容。",
            input_model=GetApplicationTrackInput,
            permission=Permission.READ_ONLY,
            run=_run_get_application_track,
            service_entry=None,
            service_reason="内联 ORM 查询/组装，无 services 收口（T27 收口候选）",
            ignore_unknown_arguments=True,
            http=HttpRoute("GET", "/api/tracker/{track_id}", TrackOut, tags=("tracker",)),
        )
    )
    create_track_action = define_action(
        ActionSpec(
            name="create_application_track",
            description=(
                "新增一条求职进度。只在用户明确要求记录投递/筛选/面试/Offer 等进展时调用；"
                "公司、岗位和状态必填。"
            ),
            input_model=CreateApplicationTrackInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_create_application_track,
            preview=_preview_create_application_track,
            service_entry="tracker.create_track",
            http=HttpRoute("POST", "/api/tracker", TrackOut, status_code=201, tags=("tracker",)),
        )
    )
    update_track_action = define_action(
        ActionSpec(
            name="update_application_track",
            description=(
                "修改已有求职进度（先用 get_application_track 或 list_application_tracks 确认 id）。"
                "删除不通过工具执行，用户要删除时请引导去求职进度页或回收站。"
            ),
            input_model=UpdateApplicationTrackInput,
            permission=Permission.REVERSIBLE_WRITE,
            # 路由侧委托既有 save_track；input_model 为配合工具侧宽松了跨字段校验，
            # 所以这里用薄包装把 TrackUpdate 重建失败映射成 invalid_input（见该函数）。
            run=_run_update_application_track,
            run_tool=tool_runner(
                "app.services.assistant_tools.tracker_tools", "_tool_update_application_track"
            ),
            preview=preview_runner(
                "app.services.assistant_tools.previews", "preview_update_application_track"
            ),
            service_entry="tracker.update_track",
            tool_fields=_TOOL_TRACK_FIELDS,
            http=HttpRoute("PUT", "/api/tracker/{track_id}", TrackOut, tags=("tracker",)),
        )
    )
    _ACTIONS = {
        spec.name: spec
        for spec in (
            list_tracks_action,
            get_track_action,
            create_track_action,
            update_track_action,
        )
    }
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return tracker_actions()


__all__ = [
    "CreateApplicationTrackInput",
    "GetApplicationTrackInput",
    "ListApplicationTracksInput",
    "UpdateApplicationTrackInput",
    "actions",
    "tracker_actions",
]
