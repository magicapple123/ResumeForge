# SPDX-License-Identifier: Apache-2.0
"""0073：投递记录的失败三段稳定码（#39）。

**只加列，不加表、不删任何东西**（旧备份仍可导入）：

apply_task_item 三列：

- failure_step（VARCHAR(32)，默认空串）：失败发生在哪一步，取值与
  apply_task.current_step 同词表（opening / filling / greeting / uploading /
  submitting / verifying），unknown = 诊断里也看不出。
- failure_target（VARCHAR(64)，默认空串）：卡在哪个具体控件/环节
  （chat_input / send_button / apply_entry / job_card / search_results /
  resume_upload），空串 = 未识别。
- failure_reason（VARCHAR(40)，默认空串）：为什么失败的稳定子码
  （site_changed / render_timeout / page_not_navigated / selector_missing /
  login_required / captcha_required / greeting_missing / network_timeout /
  upload_failed / site_unsupported / profile_insufficient / unconfirmed / unknown）。

**历史行回填**：升级时对已有失败/跳过记录，按 failure_category + failure_detail
推导三列（确定性关键词映射）。回填规则**冻结在本文件里**、不 import 运行时模块
（services/apply/failure_taxonomy.py）——迁移必须能在未来代码演进之后仍原样重放，
这是迁移的一般要求。推导不中的维度留空串，界面如实显示"未识别"，不编造。

**升级安全**：表不存在时直接返回；加列前检查已存在，重复执行不报错。空串默认值保证
历史行升级后行为逐字节不变（界面把空串渲染为未识别）。

**downgrade 完整可逆**：SQLite 删列走 batch_alter_table（重建表），三列依次移除后
表结构与升级前一致（回填的数据随列一起消失，本来也没别处引用）。

Revision ID: 0073_apply_item_failure_taxonomy
Revises: 0072_interview_followup_closed
Create Date: 2026-11-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0073_apply_item_failure_taxonomy"
down_revision: str | Sequence[str] | None = "0072_interview_followup_closed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "apply_task_item"
_COLUMNS: tuple[tuple[str, sa.Column], ...] = (
    (
        "failure_step",
        sa.Column(
            "failure_step", sa.String(length=32), nullable=False, server_default=sa.text("''")
        ),
    ),
    (
        "failure_target",
        sa.Column(
            "failure_target", sa.String(length=64), nullable=False, server_default=sa.text("''")
        ),
    ),
    (
        "failure_reason",
        sa.Column(
            "failure_reason", sa.String(length=40), nullable=False, server_default=sa.text("''")
        ),
    ),
)

# ===== 回填规则（冻结快照：与 services/apply/failure_taxonomy.py 对齐，但刻意不 import）=====

_SELECTOR_INVALID = "selector_invalid"
_LOGIN_REQUIRED = "login_required"
_CAPTCHA_REQUIRED = "captcha_required"
_GREETING_MISSING = "greeting_missing"
_NETWORK_TIMEOUT = "network_timeout"
_FILE_UPLOAD_FAILED = "file_upload_failed"
_SITE_UNSUPPORTED = "site_unsupported"
_PROFILE_INSUFFICIENT = "profile_insufficient"
_UNCONFIRMED = "unconfirmed"

_REASON_BY_CATEGORY = {
    _LOGIN_REQUIRED: "login_required",
    _CAPTCHA_REQUIRED: "captcha_required",
    _GREETING_MISSING: "greeting_missing",
    _NETWORK_TIMEOUT: "network_timeout",
    _FILE_UPLOAD_FAILED: "upload_failed",
    _SITE_UNSUPPORTED: "site_unsupported",
    _PROFILE_INSUFFICIENT: "profile_insufficient",
    _UNCONFIRMED: "unconfirmed",
    _SELECTOR_INVALID: "selector_missing",
}


def _step_from_detail(detail: str) -> str:
    if any(k in detail for k in ("第 1 步", "打开投递入口", "岗位卡片", "页面加载", "登录页")):
        return "opening"
    if any(k in detail for k in ("第 2 步", "打招呼", "聊天输入框", "招呼语")):
        return "greeting"
    if any(k in detail for k in ("上传", "附件")):
        return "uploading"
    if any(k in detail for k in ("第 3 步", "发送", "提交前")):
        return "submitting"
    if any(k in detail for k in ("第 4 步", "确认", "核对")):
        return "verifying"
    if any(k in detail for k in ("填写", "表单", "输入框")):
        return "filling"
    return "unknown"


def _target_from_detail(detail: str) -> str:
    # 与运行时同一顺序：具体控件排在泛泛的入口词之前（诊断里两者常同时出现）。
    if any(k in detail for k in ("聊天输入框", "消息输入框")):
        return "chat_input"
    if "发送按钮" in detail:
        return "send_button"
    if "岗位卡片" in detail:
        return "job_card"
    if "搜索结果" in detail:
        return "search_results"
    if any(k in detail for k in ("立即沟通", "沟通入口", "投递入口")):
        return "apply_entry"
    if any(k in detail for k in ("上传", "简历附件")):
        return "resume_upload"
    return ""


def _reason_from_detail(category: str, detail: str) -> str:
    if category == _SELECTOR_INVALID:
        if any(k in detail for k in ("没有切换到目标地址", "没有跳转", "未跳转")):
            return "page_not_navigated"
        if any(k in detail for k in ("加载超时", "超时")):
            return "render_timeout"
        if any(k in detail for k in ("页面改版", "结构可能已变化", "页面结构已变化", "改版")):
            return "site_changed"
        return "selector_missing"
    return _REASON_BY_CATEGORY.get(category, "unknown")


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _columns() -> set[str]:
    return {column["name"] for column in _inspector().get_columns(_TABLE)}


def _backfill(bind: sa.engine.Connection) -> None:
    # 历史库可能只有部分业务表（迁移链也会在这样的库上跑）：旧列缺失时无法推导，
    # 直接跳过回填而不是让 SELECT 报 no such column（与"表不存在时跳过"同一契约）。
    if not {"failure_category", "failure_detail"}.issubset(_columns()):
        return
    table = sa.table(
        _TABLE,
        sa.column("id", sa.Integer),
        sa.column("failure_category", sa.String),
        sa.column("failure_detail", sa.Text),
        sa.column("failure_step", sa.String),
        sa.column("failure_target", sa.String),
        sa.column("failure_reason", sa.String),
    )
    rows = bind.execute(
        sa.select(table.c.id, table.c.failure_category, table.c.failure_detail).where(
            sa.or_(table.c.failure_reason == "", table.c.failure_reason.is_(None))
        )
    ).fetchall()
    for row_id, category, detail in rows:
        if not category:
            continue
        text = detail or ""
        reason = _reason_from_detail(str(category), text)
        step = _step_from_detail(text)
        # 「页面没跳到目标地址」只发生在打开岗位页这一步：诊断没写步骤时按语义补上。
        if step == "unknown" and reason == "page_not_navigated":
            step = "opening"
        bind.execute(
            table.update()
            .where(table.c.id == row_id)
            .values(
                failure_step=step,
                failure_target=_target_from_detail(text),
                failure_reason=reason,
            )
        )


def upgrade() -> None:
    if _TABLE not in set(_inspector().get_table_names()):
        return
    existing = _columns()
    for name, column in _COLUMNS:
        if name not in existing:
            op.add_column(_TABLE, column)
    _backfill(op.get_bind())


def downgrade() -> None:
    if _TABLE not in set(_inspector().get_table_names()):
        return
    existing = _columns()
    with op.batch_alter_table(_TABLE) as batch:
        for name, _column in reversed(_COLUMNS):
            if name in existing:
                batch.drop_column(name)
