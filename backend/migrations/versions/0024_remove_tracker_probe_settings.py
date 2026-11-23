# SPDX-License-Identifier: Apache-2.0
"""0024：清除「申请状态回读」留下的凭据与设置行。

回读功能已整条移除（四个 ``/api/tracker/probe*`` 端点、门户 Cookie 那一行、
三个 ``tracker.probe.*`` 设置键）。这个迁移把**已经存在库里的值**一并删掉——
留着一份再也读不到的 Cookie，等于让凭据长期躺在磁盘上。

删的键：

- ``tracker.probe.enabled`` / ``tracker.probe.page_url`` / ``tracker.probe.cookie``
  / ``tracker.probe.last_run``（``LIKE 'tracker.probe.%'`` 一次覆盖，含未来可能
  多出来的同前缀键）；
- ``login_status.track_cookie``（面板缓存的状态 JSON）与
  ``login_status.probe_url.track_cookie``（该来源的探测地址）。

**降级是 no-op**：Cookie 是不可恢复的凭据，把它"降级回来"既做不到（值已删），
也不该做（回读功能在代码里已经不存在，恢复这行只会留下一个没人读的密文）。
这是本批次唯一的数据删除，发布说明里必须写明。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024_remove_tracker_probe_settings"
down_revision: str | Sequence[str] | None = "0023_add_application_track_link"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "app_setting"
_PROBE_PREFIX = "tracker.probe.%"
_COOKIE_SOURCE_KEYS = (
    "login_status.track_cookie",
    "login_status.probe_url.track_cookie",
)


def upgrade() -> None:
    """删掉回读相关的设置行；``app_setting`` 不存在时跳过。

    迁移会跑在"只有部分业务表"的库上（数据集切换、老备份恢复到更早 revision 都会重跑
    迁移），所以先检查表存在，不能假设它一定在。
    """
    if _TABLE not in set(sa.inspect(op.get_bind()).get_table_names()):
        return
    op.execute(
        sa.text(f"DELETE FROM {_TABLE} WHERE key LIKE :prefix OR key IN :keys").bindparams(  # noqa: S608
            sa.bindparam("prefix", _PROBE_PREFIX),
            sa.bindparam("keys", _COOKIE_SOURCE_KEYS, expanding=True),
        )
    )


def downgrade() -> None:
    """no-op：**凭据不可恢复**（值已被删除，也没有第二个副本）。

    刻意不重建"空行"：``app_setting`` 里存在一个空值的 ``tracker.probe.cookie``
    只会让后来的人以为"这里本该有东西"，并且回读代码已经不存在，没有任何读者。
    """
    return
