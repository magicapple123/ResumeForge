# SPDX-License-Identifier: Apache-2.0
"""提醒与"简历"之间的关联规则（R14 / 迁移 0030）。

从 ``reminder_service`` 拆出来的原因只有一条：那个模块已经贴到 500 行预算的上限，
再加"外部简历"这一层关联就会越线。这里放的全是**与提醒本体无关**的横切规则：

- 内外简历互斥的兜底校验（PATCH 合并后的最终状态）；
- 回显时把外部简历标题挂到 ORM 实例上。

两者都不写库、不改状态机，只是"提醒指向哪份简历"这一件事的两面。放在独立模块里
也让它们能被单独测试，不必构造整条提醒流水线。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..models.external_resume import ExternalResume
from ..models.reminder import Reminder
from ..schemas.reminder import REMINDER_RESUME_LINK_CONFLICT
from . import trash


def assert_single_resume_link(reminder: Reminder, values: dict) -> None:
    """PATCH 之后"内外简历最多一个"的兜底校验（R14）。

    为什么不在 schema 里做：PATCH 只带变动的字段，schema 看不到库里已存的另一侧。
    例如一条提醒已关联内部简历 A，用户这次只提交 ``external_resume_id=7``——单看
    请求体完全合法，合并后却变成"两个都指"，读侧无从取舍。

    口径与 ``application_track`` 的先例一致：**合并后的最终状态**只能有一份简历；
    "把 ``resume_id`` 置空 + 同时给 ``external_resume_id``"是合法改选（合并后只剩一份）。

    错误码用 ``invalid_input``（HTTP 422），与 schema 层两条都给的 422 同一语义、
    同一句文案；助手工具侧拿到的是 ``invalid_input: …`` 这个稳定 token。
    """
    # 合并后的最终状态：请求里给了就用请求值（None 也算"明确置空"），否则沿用库里的。
    merged_resume_id = values.get("resume_id", reminder.resume_id)
    merged_external_id = values.get("external_resume_id", reminder.external_resume_id)
    if merged_resume_id is not None and merged_external_id is not None:
        # 延迟导入：``services.actions`` 是契约层，本模块只在报错这一条路径上需要它，
        # 放在模块顶部会让"提醒关联"与"动作契约层"在 import 期互相牵住。
        from .actions.spec import ActionError

        raise ActionError("invalid_input", REMINDER_RESUME_LINK_CONFLICT)


def attach_external_resume_names(db: Session, reminders: list[Reminder]) -> None:
    """把外部简历标题挂到 ORM 实例上（**不入库**，只供 ``ReminderOut`` 序列化时读取）。

    ``reminder`` 表没有标题快照列（与 tracker 的 ``resume_title`` 不同），所以名字实时
    读 ``external_resume.name``。用挂属性而不是改 model 加 relationship：读侧只需要一个
    字符串，而 relationship 会给每次列表查询都带一次 lazy load 的机会（N+1）。
    """
    ids = {item.external_resume_id for item in reminders if item.external_resume_id is not None}
    names: dict[int, str] = {}
    if ids:
        # 一次批量取名字：列表最多 200 条，逐条 get 就是逐条 SQL。
        rows = (
            db.query(ExternalResume.id, ExternalResume.name)
            .filter(ExternalResume.id.in_(ids), trash.live_only(ExternalResume))
            .all()
        )
        names = {int(row_id): (name or "") for row_id, name in rows}
    for item in reminders:
        external_id = item.external_resume_id
        # 响应专用字段（`ReminderOut.external_resume_name`），**没有对应的列**：名字来自
        # 上面那次批量查询，不落库（外部简历改名后，提醒里显示的应是新名字）。因此这里
        # 只能动态挂；写成 `item.external_resume_name = …` 会被 pyright 判成"给模型类
        # 赋一个不存在的属性"，而真加一个 `Mapped[...]` 又会要求一次迁移。
        # `B010`（别用 setattr 挂常量名）在这里不适用：它假定"属性本来就存在"，而这里
        # 刻意挂的正是模型上没有、只在响应里出现的字段。
        name = "" if external_id is None else names.get(int(external_id), "")
        setattr(item, "external_resume_name", name)  # noqa: B010


__all__ = ["assert_single_resume_link", "attach_external_resume_names"]
