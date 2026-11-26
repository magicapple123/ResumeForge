# SPDX-License-Identifier: Apache-2.0
"""外部简历的**行级动作**：收藏 / 备注 / 重命名（改名 + 关联岗位）。

从 `services/external_resumes.py` 拆出来，两个理由：

1. **500 行硬预算**：上传、本地提取、排序下推已经把那个文件写到 497 行，再塞三个动作
   必然超标；
2. **口径集中**：这三个动作只改"这一行"，**不碰文件、不碰正文、不产生新版本**。其中
   收藏带一条极易漏掉的约束——不许刷新 `updated_at`（R2「点星星跳行」，T15 已在内部
   简历上修过）。把它和"取数 / 建行 / 排序"混在一份 500 行的文件里，下一次改动很容易
   顺手写成 ORM 赋值；单独成文件后，这一行判据就在函数正上方。

## 三个动作的 `updated_at` 口径**不一样**，这是故意的

| 动作 | 刷新 `updated_at` | 为什么 |
| ---- | ---------------- | ------ |
| 收藏 | **不许** | 收藏是**标记**不是编辑：它不改内容，不该参与"最近更新"排序（R2） |
| 备注 | 要 | 备注是用户写的内容，属于编辑，"最近更新"里往前排是符合预期的 |
| 重命名 | 要 | 同上（既有行为，别改） |

## 依赖方向

本模块**单向**依赖 models / schemas / `favorites` / `trash`，`external_resumes.py`
反过来 import 本模块（`_live_job`、`update_external_resume`）。绝不能反向 import：
那会成环，而 `api/external_resumes.py` 同时 import 两个模块，环在启动时就炸。
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..models.external_resume import ExternalResume
from ..models.job import Job
from ..schemas.external_resume import (
    MAX_EXTERNAL_NOTE_CHARS,
    MAX_NAME_CHARS,
    ExternalResumeUpdateInput,
)
from . import favorites, trash

logger = logging.getLogger(__name__)


def _live_job(db: Session, job_id: int | None) -> Job | None:
    """关联岗位必须存在且未删；给了非法 id 就明确失败，而不是悄悄丢关联。"""
    if job_id is None:
        return None
    job = trash.get_live(db, Job, job_id)
    if job is None:
        raise ValueError("关联岗位不存在或已被删除")
    return job


def update_external_resume(
    db: Session, row: ExternalResume, payload: ExternalResumeUpdateInput
) -> ExternalResume:
    """改名 / 关联岗位（PATCH）。

    `job_id` 只有在调用方**显式传了**这个键时才处理：`model_fields_set` 区分"没传"
    （保留原关联）与"传 null"（取消关联）——只用 None 当默认值会让取消关联做不到。

    改名是编辑，`updated_at` 正常刷新（列表的「最近更新」列据此排序）。
    """
    if payload.name is not None:
        display = payload.name.strip()[:MAX_NAME_CHARS]
        if not display:
            raise ValueError("名称不能为空")
        row.name = display
    if "job_id" in payload.model_fields_set:
        job = _live_job(db, payload.job_id)
        row.job_id = job.id if job is not None else None
    db.commit()
    db.refresh(row)
    return row


def set_favorite(db: Session, row: ExternalResume, favorite: bool) -> bool:
    """收藏 / 取消收藏；返回是否真的写了库（幂等：重复点不产生写入）。

    **必须**走 `services/favorites.update_favorite`，不许在这里写 ORM 赋值：
    `external_resume.updated_at` 带 `onupdate=utcnow`，一次 `row.favorite = True`
    就会把它刷成"刚刚"，用户按「最近更新」排序时那一行会立刻跳到最前面——正是 R2
    的"点星星跳行"。（T15 在内部简历上修过同款 bug，这里是同一份判据。）

    不 commit：事务边界留在接口层（与 `favorites` 的其余调用方一致）。
    """
    changed = favorites.update_favorite(db, ExternalResume, int(row.id), bool(favorite))
    if changed:
        logger.info("外部简历收藏已更新 id=%s favorite=%s", row.id, bool(favorite))
    return changed


def set_note(db: Session, row: ExternalResume, note: str) -> str:
    """写备注（空串 = 清空）；返回落库后的备注。

    备注是**编辑**：与收藏相反，`updated_at` 应当刷新——它是用户写进去的内容，按
    「最近更新」排序时往前排正是应有的结果。所以这里用 ORM 赋值（会触发 `onupdate`），
    而不是收藏那条 Core UPDATE 路径。

    首尾空白去掉（纯空格的备注等于没写，读侧就不必再判），内部换行原样保留。
    """
    cleaned = (note or "").strip()
    if len(cleaned) > MAX_EXTERNAL_NOTE_CHARS:
        raise ValueError(f"备注最多 {MAX_EXTERNAL_NOTE_CHARS} 字")
    if cleaned == (row.note or ""):
        # 一模一样就不写库：免得"点保存一下就把这行顶到最近更新"变成无意义的排序抖动。
        return row.note or ""
    row.note = cleaned
    db.commit()
    db.refresh(row)
    logger.info("外部简历备注已更新 id=%s chars=%s", row.id, len(cleaned))
    return row.note or ""


__all__ = ["set_favorite", "set_note", "update_external_resume"]
