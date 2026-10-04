"""「补齐详情」的任务运行器侧：配置还原、目标 id 读取与收尾文案
（从 test_collect_backfill.py 拆出）。

补详情的采集器判定与 ledger 留在主文件（test_collect_backfill.py）。
"""
from __future__ import annotations

from app.models.apply import TASK_KIND_COLLECT, ApplyTask
from app.schemas.apply import DEFAULT_COLLECT_PER_TASK_LIMIT, CollectConfigIn
from app.services.apply.task_runner import TaskRunner


# ===== 任务运行器：配置还原、目标 id 读取、收尾文案 =====


def _collect_task_with_snapshot(db_session) -> ApplyTask:
    """一个"补详情"任务的配置快照：既带用户设的采集参数，也带只属于这次任务的目标 id。"""
    task = ApplyTask(
        kind=TASK_KIND_COLLECT,
        status="running",
        total=2,
        config={"per_task_limit": 7, "interval_seconds": 5, "backfill_job_ids": [1, 2]},
    )
    db_session.add(task)
    db_session.commit()
    return task


def test_load_config_keeps_user_settings_when_it_ignores_task_only_keys(db_session):
    """``ignore=("backfill_job_ids",)`` 让"只属于这次任务的编排字段"不污染配置还原，
    用户设的 ``per_task_limit`` / 限速必须原样保留。"""
    task = _collect_task_with_snapshot(db_session)

    config = TaskRunner._load_config(task, CollectConfigIn, ignore=("backfill_job_ids",))

    assert config.per_task_limit == 7
    assert config.interval_seconds == 5


def test_load_config_reverts_to_defaults_when_task_only_keys_are_not_ignored(db_session):
    """反证 ``ignore=`` 不是可有可无的：``CollectConfigIn`` 是 ``extra="forbid"``，
    多一个 ``backfill_job_ids`` 就会让整份快照 ``model_validate`` 失败，兜底**静默退回全默认值**
    ——用户设的限速一起丢，而且不报错。

    这条钉住那个坑：以后谁删掉 ``ignore=`` 参数，这里会立刻变红，而不是让限速在运行时悄悄失效。
    """
    task = _collect_task_with_snapshot(db_session)

    config = TaskRunner._load_config(task, CollectConfigIn)  # 故意不传 ignore

    assert config.per_task_limit == DEFAULT_COLLECT_PER_TASK_LIMIT  # 7 被静默丢弃
    assert config.per_task_limit != 7


def _collect_task_with_sample_flag(db_session) -> ApplyTask:
    """一个"保存站点原文"任务的配置快照：既带用户设的采集参数，也带一次性的开关。"""
    task = ApplyTask(
        kind=TASK_KIND_COLLECT,
        status="running",
        total=1,
        config={"per_task_limit": 7, "backfill_job_ids": [], "save_site_samples": True},
    )
    db_session.add(task)
    db_session.commit()
    return task


def test_load_config_ignores_the_one_off_sample_flag(db_session):
    """``save_site_samples`` 与 ``backfill_job_ids`` 同属"只属于这次任务"的一次性键，还原配置时
    必须一起 ignore——否则 ``extra="forbid"`` 会让整份快照静默退回默认值，用户设的参数一起丢。"""
    task = _collect_task_with_sample_flag(db_session)

    config = TaskRunner._load_config(
        task, CollectConfigIn, ignore=("backfill_job_ids", "save_site_samples")
    )

    assert config.per_task_limit == 7


def test_load_config_reverts_to_defaults_when_sample_flag_is_not_ignored(db_session):
    """反证：漏掉 ``save_site_samples`` 的 ignore，采样开关就会把整份配置打回默认值。"""
    task = _collect_task_with_sample_flag(db_session)

    config = TaskRunner._load_config(task, CollectConfigIn, ignore=("backfill_job_ids",))

    assert config.per_task_limit == DEFAULT_COLLECT_PER_TASK_LIMIT


def test_backfill_job_ids_reads_and_normalizes_the_snapshot(db_session):
    """目标 id 从 ``task.config`` 读出并做宽松的 int 归一：快照被外部改坏一个值，
    不该让整批补详情崩掉（真正"该不该补"的判断在采集器里）。"""
    assert TaskRunner._backfill_job_ids(
        ApplyTask(kind=TASK_KIND_COLLECT, config={"backfill_job_ids": [1, "2", "坏值", None]})
    ) == [1, 2]
    # 非补详情任务（没有这个键）→ 空列表。
    assert TaskRunner._backfill_job_ids(ApplyTask(kind=TASK_KIND_COLLECT, config={})) == []


def test_backfill_message_reports_full_success():
    """全部补齐：说清补到几条，且不该出现"跳过"字样（没有跳过就别提）。"""
    message = TaskRunner._backfill_message({"backfilled": 3, "backfill_skipped": 0})

    assert "已为 3 条岗位补齐职位描述" in message
    assert "跳过" not in message


def test_backfill_message_reports_partial_skips():
    """部分跳过：补到的与跳过的都要说，且给出"为什么跳过"的三种成因。"""
    message = TaskRunner._backfill_message({"backfilled": 2, "backfill_skipped": 1})

    assert "已为 2 条岗位补齐职位描述" in message
    assert "另有 1 条跳过" in message
    assert "已有描述" in message and "仍然抓不到" in message


def test_backfill_message_says_nothing_was_backfilled():
    """一条都没补上：必须如实说明并给出下一步（确认岗位仍在线后重试），
    绝不能只说"完成"让用户以为补上了。"""
    message = TaskRunner._backfill_message({"backfilled": 0, "backfill_skipped": 2})

    assert "没有补到新的职位描述" in message
    assert "2 条岗位已跳过" in message
    assert "重试" in message


# ===== 站点筛选的账目必须出现在收尾文案里（2026-09-21）=====
#
# 后端把「哪几条站点筛选生效 / 哪几条没能生效」写进了 task.config。写进去不等于说出去：
# 收尾文案是用户最先看到的一句话（**完成通知里带的也是它**），漏掉就等于静默失效。


def test_message_reports_site_filters_that_did_not_take_effect():
    task = ApplyTask(
        kind=TASK_KIND_COLLECT,
        succeeded=4,
        config={"site_filter_unapplied": ["公司规模"], "site_filter_applied": ["学历要求：本科"]},
    )
    message = TaskRunner._collect_message(task)
    assert "公司规模" in message
    assert "没能生效" in message


def test_message_points_at_site_filters_when_nothing_came_back():
    """一条都没采到、站点筛选又开着时，默认文案会把人往"改关键词"上引——该提的是筛选条件。"""
    task = ApplyTask(
        kind=TASK_KIND_COLLECT,
        succeeded=0,
        config={"site_filter_applied": ["学历要求：本科", "融资阶段：A轮"]},
    )
    message = TaskRunner._collect_message(task)
    assert "学历要求：本科" in message and "融资阶段：A轮" in message
    assert "没有找到匹配的岗位" in message


def test_message_does_not_mention_site_filters_when_none_were_used():
    """没配站点筛选时文案保持原样——不能凭空多出一句让人以为自己筛过的话。"""
    task = ApplyTask(kind=TASK_KIND_COLLECT, succeeded=0, config={})
    message = TaskRunner._collect_message(task)
    assert "招聘网站的条件" not in message


def test_backfill_dispatch_does_not_change_search_mode_message():
    """补详情文案是**另一个模式**的：只有 config 里带 ``backfill_job_ids`` 时才走它。
    搜索采集的文案不能被改写——否则"已暂存 N 个岗位"会被换成驴唇不对马嘴的补详情说法。"""
    search = ApplyTask(kind=TASK_KIND_COLLECT, succeeded=3)
    search_message = TaskRunner._collect_message(search)
    assert "已暂存 3 个岗位" in search_message
    assert "补齐职位描述" not in search_message

    backfill = ApplyTask(kind=TASK_KIND_COLLECT, config={"backfill_job_ids": [1], "backfilled": 3})
    assert "已为 3 条岗位补齐职位描述" in TaskRunner._collect_message(backfill)


# ===== 跨模块回归：技能标签只有一份重算实现 =====


def test_create_and_update_recompute_keywords_through_the_same_path(db_session):
    """新建、更新、补齐三处都走同一个 ``refresh_job_keywords``，行为必须一致：
    标签始终是"按当前 JD 重算"，而不是"追加"或"只算一次"。"""
    from app.schemas.job import JobCreate, JobUpdate
    from app.services.job.job_service import create_job_record, update_job_record

    job = create_job_record(
        db_session, JobCreate(title="后端", company="A", description="使用 Python 开发服务。")
    )
    assert "Python" in {tag["name"] for tag in job.keywords}

    updated = update_job_record(
        db_session, job, JobUpdate(description="维护 Kubernetes 集群。")
    )
    names = {tag["name"] for tag in updated.keywords}
    assert "Kubernetes" in names
    assert "Python" not in names  # 重算而非追加：旧 JD 里的标签应当消失


def test_keyword_recompute_has_a_single_public_entry_point():
    """静态守卫：除 ``job_service`` 自身外，没有别的模块直接调用私有的 ``_keywords_for``。

    绕过 ``refresh_job_keywords`` 自己算一份，就是"补了 JD 却没更新标签"这类漂移的入口。
    用源码扫描把"目前只有一处实现"钉住；将来多一处调用会在这里变红。
    """
    import pathlib

    app_dir = pathlib.Path(__file__).resolve().parents[1] / "app"
    offenders = [
        path.relative_to(app_dir).as_posix()
        for path in app_dir.rglob("*.py")
        if "_keywords_for" in path.read_text(encoding="utf-8") and path.name != "job_service.py"
    ]
    assert offenders == []
