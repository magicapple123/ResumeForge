# SPDX-License-Identifier: Apache-2.0
"""版式的**唯一保存编排**（``PATCH /api/resumes/{id}/layout`` 的业务本体）。

从 ``api/resumes/layout_render_routes.py`` 原样搬入服务层（RF-03b）：该端点的 handler
与助手动作 ``update_resume_layout`` 的 ``run`` 必须走同一段编排，而动作层按守卫不许
import ``app.api``。搬移是逐行等价搬运——**判据与注释一并搬来**，因为它们描述的正是
踩过的坑（局部 PATCH、页数语义值 0、语言字段不能给默认值）。

事务边界仍在调用方：``document_save.save_layout`` 不自行 ``commit``，与内容保存同一条
"唯一保存实现"约束（见 ``services/resume/document_save.py`` 的模块 docstring）。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from ...schemas.resume import (
    ResumeLayoutUpdate,
    ResumeOut,
    mode_page_limit,
)
from ...schemas.resume_generation import UNLIMITED_PAGE_LIMIT
from .. import trash
from .document_save import RevisionConflict, save_layout
from .resume_out import build_resume_out
from .resume_read_service import RESUME_NOT_FOUND_DETAIL, ResumeNotFound
from .resume_record import resolved_format_name, resolved_style_name
from .resume_sections import persistable_format_config
from .resume_templates import font_scale_spec, validated_format_config


def layout_values_from_payload(
    db: Session,
    record: ResumeRecord,
    payload: ResumeLayoutUpdate,
) -> dict[str, object]:
    """把请求体里**这一次真的带了的字段**翻译成最终列值。

    「带了哪些字段」的唯一判据是 Pydantic v2 的 ``model_fields_set``（"这一次的请求体
    解析出了哪些键"），**不是**"值是否等于默认值"。曾经的实现无条件用 schema 默认值拼
    ``values``，于是只发 ``{"font_scale": "large"}`` 就会把 ``page_limit`` 静默重置成
    默认的 1、把悬空的 ``format_name`` 清成空串——用户拖了一下字号滑杆，页数上限和版式
    一起被改掉，界面上却什么提示都没有。
    """
    provided = payload.model_fields_set
    # 模板名按"内置优先，其次用户自制"解析；版式单独存一份名字，渲染时再解析成
    # 具体的覆盖配置——这样用户改了版式，引用它的简历跟着变。
    # W14：文档模式先定，页数上限按模式夹紧（普通 1–3 / 长 CV 1–10；切回普通不静默丢页数）。
    document_mode = payload.document_mode or getattr(record, "document_mode", "resume") or "resume"
    values: dict[str, object] = {}
    if "template" in provided:
        values["template"] = resolved_style_name(db, payload.template)
    if "format_name" in provided:
        # 显式传空串仍是"清空版式名"（老客户端/前端清预设就走这条路）；只有**没带**
        # 这个键时才保持库里原值。悬空的版式名由 ``resolved_format_name`` 归一。
        values["format_name"] = resolved_format_name(db, payload.format_name)
    if "page_limit" in provided:
        # 「不限篇幅」（0）是**语义值**，原样落库：交给 mode_page_limit 会被折成渲染
        # 保护上限 10，保存一次就变成"最多 10 页"，用户再打开面板看到的不再是「不限」。
        # 只有真正的页数（1–N）才需要按模式夹紧。
        values["page_limit"] = (
            UNLIMITED_PAGE_LIMIT
            if payload.page_limit == UNLIMITED_PAGE_LIMIT
            else mode_page_limit(payload.page_limit, document_mode)
        )
    if "font_scale" in provided:
        values["font_scale"] = font_scale_spec(payload.font_scale)["name"]
    # 文档模式只有显式带了才写。只切模式、不重报页数时不动 ``page_limit``：
    # 越界的旧值由渲染侧 ``mode_page_limit`` 夹紧，保存动作不该替用户"顺手"改数字。
    if payload.document_mode is not None:
        values["document_mode"] = document_mode
    # None = 这次不涉及这一项，保持原样；空字典 = 明确清掉覆盖。
    if payload.format_config is not None:
        # T7：v2 记录不再写 v1 的 section_order（唯一真相是 document.sections）。
        # 旧客户端/旧草稿仍可能带这个键：结构落位已由文档自身完成，保存时直接剥离。
        values["format_config"] = validated_format_config(
            persistable_format_config(payload.format_config)
        )
    # 语言与本接口的其它字段一样是"整体替换"语义，所以**必须先判 None**：给默认值
    # 就等于"拖动一次字号滑杆把英文简历静默改回中文"，而用户完全看不出发生了什么。
    # None = 这次不涉及，保持原样（见 §9.1 R1）。
    if payload.language is not None:
        values["language"] = payload.language
    return values


def apply_layout_update(
    db: Session,
    *,
    resume_id: int,
    payload: ResumeLayoutUpdate,
) -> ResumeOut:
    """保存版式并返回详情视图（路由 handler 与助手动作共用的唯一编排）。

    错误边界（与迁移前逐条一致）：

    - 记录不存在/已进回收站 → :class:`ResumeNotFound`（两侧各翻成同一条 404）；
    - ``expected_revision`` 不匹配 → :class:`RevisionConflict`（409，一个字节都不动）；
    - 写入竞态（读到之后被删）→ 同样是 :class:`ResumeNotFound`。
    """
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise ResumeNotFound(RESUME_NOT_FOUND_DETAIL)
    values = layout_values_from_payload(db, record, payload)
    # 版式保存成功 = 这份简历"存在了"：制作台草稿到这一步才进简历中心（0051）。
    # 转正与 revision+1 在 ``save_layout`` 的同一条 UPDATE 里，不会拆成两次写。
    outcome = save_layout(
        db,
        record_id=record.id,
        values=values,
        expected_revision=payload.expected_revision,
    )
    if outcome is None:  # 竞态：读到之后被删
        raise ResumeNotFound(RESUME_NOT_FOUND_DETAIL)
    # 详情视图不带 db：与原实现一致（这条路径不需要按记录重取自定义字段定义）。
    return build_resume_out(outcome.record)


__all__ = [
    "RevisionConflict",
    "apply_layout_update",
    "layout_values_from_payload",
]
