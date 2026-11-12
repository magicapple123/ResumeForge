# SPDX-License-Identifier: Apache-2.0
"""备选岗位截图的磁盘副本落盘（best-effort）。

原先长在 ``api/candidate_jobs.py``：``services/actions`` 的暂存动作也要落同一份副本，
只能反向 import 路由模块。落盘属于服务层职责，放在这里两边共用。
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from .user_files import save_from_data_url

logger = logging.getLogger(__name__)


def save_image_copies(db: Session, candidate_id: int, images: list[str] | None) -> None:
    """best-effort：把备选岗位截图 data URL 落一份磁盘副本（失败只记日志）。

    ``CandidateJobUpdate.images`` 允许显式传 ``null``（区分"没提这个字段"与"清空"），
    本函数对 ``None`` 与空列表同样按"没有图"处理。
    """
    for index, data_url in enumerate(images or []):
        if not data_url:
            continue
        try:
            save_from_data_url(
                db,
                str(data_url),
                source_type="candidate_image",
                source_ref=f"candidate_job:{candidate_id}",
                fallback_name=f"candidate-{candidate_id}-{index + 1}",
            )
        except Exception:  # noqa: BLE001 - 副本是锦上添花，绝不能挡住暂存
            logger.warning("备选岗位截图副本保存失败 candidate_job:%s", candidate_id, exc_info=True)


__all__ = ["save_image_copies"]
