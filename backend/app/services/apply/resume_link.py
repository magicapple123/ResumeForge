# SPDX-License-Identifier: Apache-2.0
"""投递台「这次用哪份简历投」的唯一判定（T30 / 迁移 0032 + 0033）。

从 ``_queue`` / ``_tasks`` / ``task_apply`` 里抽出来，只做"简历这一件事"：

1. **内外互斥**：``resume_id`` 与 ``external_resume_id`` 只能有一个非空。判定本身写在
   ``schemas.apply.check_resume_link_exclusive``（schema 的 422 与本模块共用同一句文案），
   本模块负责另一半——**PATCH 合并后的最终状态**：改选一侧就把另一侧清掉，否则库里
   会留下"两个都指"的行，读侧无从取舍。
2. **外部简历必须还存在**：指向回收站里的 / 已彻底删除的 id 一律 422
   （``APPLY_EXTERNAL_RESUME_MISSING``），绝不留到下游变成一次 500。用户能自己解决
   （重新选一份），所以这是"报清楚"，不是"报错"。
3. **附件取 ``file_id``，不复制字节**：``user_file`` 已经是内容寻址的共享登记，
   投递台只记 ``external_resume_id``，运行时按它读 ``file_id`` 找到物理文件。
   复制一份副本会让"投出去的是哪一版"变成两份可能不一致的字节。

标题快照单独说一句：``apply_task_item.resume_title`` 存的是**当时的名字**
（外部简历改名 / 删除后历史记录仍显示当时的名字），与内部简历同一口径。界面上的
「外部 · 」前缀是**展示**，由前端按 ``external_resume_id`` 是否为真加上去——后端不拼，
否则快照里就混进了一句会随语言变的话。

延迟导入 ``_queue.resolve_resume``：``_queue`` 在模块顶层 import 本模块（用它解析队列
条目的简历），这里若在顶层反向 import 就成环；"哪份内部简历"的规则只有那一份实现，
不在这里另写一遍。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from ...models.apply import ApplyQueueItem, ApplyTaskItem
from ...models.external_resume import ExternalResume
from ...models.job import Job
from ...models.resume import ResumeRecord
from ...schemas.apply.base import APPLY_EXTERNAL_RESUME_MISSING
from .. import external_resumes as external_resume_service
from ._base import ApplyUnprocessable

#: 外部简历原件在磁盘上缺失时的说明（不是用户的错，但也不能假装能投）。
EXTERNAL_FILE_MISSING = "这份外部简历的原件文件在磁盘上找不到了，请重新上传或改选一份"


@dataclass(frozen=True)
class ResumePlan:
    """一次投递实际会用什么：内部简历 / 外部简历原件 / 都没有（附原因）。

    ``file_id`` 是**附件**的落点（外部简历才有），``file_path`` 是它此刻在磁盘上的位置；
    两者都由 ``external_resume.file_id`` 推出，投递台不保留自己的副本。
    """

    resume: ResumeRecord | None = None
    external: ExternalResume | None = None
    resume_id: int | None = None
    external_resume_id: int | None = None
    title: str = ""
    file_id: int | None = None
    file_path: Path | None = None
    #: 拿不到可用简历时的中文原因（空串 = 拿到了）。写进投递记录的诊断，不参与任何筛选。
    missing_reason: str = ""


def external_resume_of(db: Session, external_resume_id: int | None) -> ExternalResume | None:
    """按 id 取一条**未删除**的外部简历；回收站里的当作不存在。"""
    if external_resume_id is None:
        return None
    return external_resume_service.get_external_resume(db, int(external_resume_id))


def require_external(db: Session, external_resume_id: int) -> ExternalResume:
    """取外部简历，取不到就是 422（**不是** 404 也不是 500）。

    为什么 422：请求体形状完全合法，是这个取值已经失效了；用户能自己解决（重选一份），
    而 404 会让人以为"这条投递记录/队列条目不见了"。
    """
    row = external_resume_of(db, external_resume_id)
    if row is None:
        raise ApplyUnprocessable(APPLY_EXTERNAL_RESUME_MISSING)
    return row


def external_names(db: Session, ids: list[int | None]) -> dict[int, str]:
    """按 id **批量**取外部简历名（一页一次查询，缺失/已删的不在返回里）。

    与 ``external_resume_of`` 同口径（只认未删除的），只是把"每行一次主键查询"换成
    一次 ``in_``：队列页 500 条时逐行取名字就是 500 次查询。
    """
    wanted = sorted({int(item_id) for item_id in ids if item_id})
    if not wanted:
        return {}
    rows = (
        db.query(ExternalResume.id, ExternalResume.name)
        .filter(ExternalResume.id.in_(wanted), ExternalResume.deleted_at.is_(None))
        .all()
    )
    return {int(row_id): str(name or "") for row_id, name in rows}


def stored_link(
    db: Session, resume_id: int | None, external_resume_id: int | None
) -> tuple[int | None, int | None, str]:
    """把请求里的两个 id 收敛成**可落库的三元组**（内部 id / 外部 id / 标题快照）。

    - 两个都给：schema 已经 422 过，这里再挡一次（service 也被助手工具这样直接调用）；
    - 只给外部：外部简历必须还存在（422），标题取它的名字；
    - 只给内部：内部简历必须还存在（404，沿用既有文案）；
    - 都不给：`(None, None, "")`，运行时按默认规则解析。
    """
    if resume_id is not None and external_resume_id is not None:
        # 与 schema 同一条判定、同一句文案：两处各写一遍迟早判得不一样。
        from ...schemas.apply.base import check_resume_link_exclusive

        try:
            check_resume_link_exclusive(resume_id, external_resume_id)
        except ValueError as exc:
            raise ApplyUnprocessable(str(exc)) from None
    if external_resume_id is not None:
        external = require_external(db, int(external_resume_id))
        return None, int(external.id), external.name or ""
    if resume_id is not None:
        resume = db.get(ResumeRecord, int(resume_id))
        if resume is None:
            # 延迟导入只为一行文案；``_base`` 的异常类与本模块无环，但保持导入顺序清晰。
            from ._base import ApplyNotFound

            raise ApplyNotFound("指定的简历不存在")
        return int(resume.id), None, resume.title or ""
    return None, None, ""


def _plan_of_external(db: Session, external: ExternalResume) -> ResumePlan:
    """外部简历 → 投递计划：解析 ``file_id`` 的物理路径（缺失就如实说，不静默降级）。"""
    file_id = int(external.file_id)
    title = external.name or ""
    try:
        path = external_resume_service.resolve_original_path(db, external)
    except Exception:  # noqa: BLE001 - 原件缺失的类型在服务层是多支的，统一按"没有文件"处理
        # 原件丢失不该让整批投递崩掉：本条按"没有可用简历"跳过，用户会看到原因。
        return ResumePlan(
            external=external,
            external_resume_id=int(external.id),
            title=title,
            file_id=file_id,
            file_path=None,
            missing_reason=EXTERNAL_FILE_MISSING,
        )
    return ResumePlan(
        external=external,
        external_resume_id=int(external.id),
        title=title,
        file_id=file_id,
        file_path=path,
    )


def resume_plan(
    db: Session, job: Job | None, item: ApplyTaskItem | ApplyQueueItem | None
) -> ResumePlan:
    """这条待投记录实际会用哪份简历（**执行期与建批次期共用**）。

    - 指向外部简历：不再回退到"该岗位最近的内部简历"——用户明确选的就是这份原件，
      同时拿一份内部简历会让招呼语变量（``{name}`` 等）读到别处的值；
    - 指向内部简历：走 ``_queue.resolve_resume``（唯一实现）；
    - 都没指定：按默认规则为该岗位找最近一份已保存简历，找不到就给 ``missing_reason``。
    """
    external_id = getattr(item, "external_resume_id", None)
    if external_id is not None:
        external = external_resume_of(db, external_id)
        if external is None:
            return ResumePlan(
                external_resume_id=int(external_id),
                missing_reason="这份外部简历已被删除，请重新为这条岗位选一份简历",
            )
        return _plan_of_external(db, external)

    # 延迟导入解环：``_queue`` 顶层 import 本模块。
    from ._queue import resolve_resume

    resume_id = getattr(item, "resume_id", None)
    resume = resolve_resume(db, job.id if job is not None else None, resume_id)
    if resume is None:
        return ResumePlan(
            missing_reason="未找到可用简历：请先在简历中心为该岗位生成简历后再投递",
        )
    return ResumePlan(
        resume=resume,
        resume_id=int(resume.id),
        title=resume.title or "",
    )


__all__ = [
    "EXTERNAL_FILE_MISSING",
    "ResumePlan",
    "external_names",
    "external_resume_of",
    "require_external",
    "resume_plan",
    "stored_link",
]
