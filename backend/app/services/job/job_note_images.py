# SPDX-License-Identifier: Apache-2.0
"""岗位备注图的磁盘副本落盘（best-effort）。

原先长在 ``api/jobs.py``：``services/actions`` 的新增/编辑岗位动作也要落同一份副本，
只能反向 import 路由模块。落盘属于服务层职责，放在这里两边共用。
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..user_files import save_from_data_url

logger = logging.getLogger(__name__)


def save_note_image_copies(db: Session, job_id: int, note_images: list[str]) -> None:
    """best-effort：把岗位备注图 data URL 落一份磁盘副本（失败只记日志）。"""
    for index, data_url in enumerate(note_images or []):
        if not data_url:
            continue
        try:
            save_from_data_url(
                db,
                str(data_url),
                source_type="job_note",
                source_ref=f"job:{job_id}",
                fallback_name=f"job-{job_id}-note-{index + 1}",
            )
        except Exception:  # noqa: BLE001 - 副本是锦上添花，绝不能挡住岗位保存
            logger.warning("岗位备注图磁盘副本保存失败 job:%s", job_id, exc_info=True)


__all__ = ["save_note_image_copies"]
