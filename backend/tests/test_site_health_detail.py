"""站点健康度：site_key / failure_category 记录层、detail missing 台账与浏览器错误归因
（从 test_site_health.py 拆出）。

替身来自 test_apply_collect_guard / test_collector（import 原样保留）；
``_task`` helper 从 test_site_health_records.py 导入。
"""
from __future__ import annotations

from app.models.apply import FAILURE_SELECTOR_INVALID, FAILURE_UNKNOWN, TASK_KIND_COLLECT, ApplyTask
from app.models.job import Job
from app.services.apply.collector import Collector
from app.services.apply.task_runner import TaskRunner
from app.services.browser.cdp_client import CdpError
from app.services.site_health import STATUS_OK, site_health_overview
from app.services.sites.base import SearchPage, SearchResult, SiteFailure

# 复用既有替身与运行器辅助：采集/运行器路径的替身散落在别处已是仓库惯例
# （``test_collect_backfill`` 也这样 import），另一份实现只会与真流程漂移。
from test_apply_collect_guard import CollectAdapter, FakeCdp, _collect_task, _registry, _wait
from test_collector import FakeCollectAdapter, _FakeClock, _config
from test_site_health_records import _task


def test_a_backfill_batch_never_feeds_the_health_judgement(db_session):
    """补详情批次不进窗口：它是用户点名的一次性修补，账目与正常采集不同，混进来会搅乱判据。"""
    _task(db_session, site_key="boss", status="completed", succeeded=3)
    _task(
        db_session,
        site_key="boss",
        status="failed",
        failure_category=FAILURE_SELECTOR_INVALID,
        backfill=True,
    )

    overview = site_health_overview(db_session)

    assert overview[0].sampled == 1
    assert overview[0].status == STATUS_OK


# ===== 记录层：site_key / failure_category 的取值 =====


def test_collect_site_key_reads_the_selected_site(db_session):
    from app.schemas.apply import ApplyConfigIn
    from app.services.apply import apply_service

    apply_service.save_apply_config(db_session, ApplyConfigIn(site_key="boss"))
    db_session.commit()

    assert TaskRunner._collect_site_key(db_session) == "boss"


def test_collect_site_key_stays_empty_when_it_cannot_be_read(db_session, monkeypatch):
    """配置读取失败 → 留空，**不**回退到"注册表第一个站点"。

    编造一个默认站点会把别站点的问题算到它头上——"站点归因指向错误站点"比"归因不到"更糟，
    用户会照着错误的告警去排查一个根本没问题的站点。
    """

    def boom(_session):
        raise RuntimeError("配置损坏")

    monkeypatch.setattr("app.services.apply.apply_service.get_apply_config", boom)

    assert TaskRunner._collect_site_key(db_session) == ""


def test_collect_site_key_does_not_fall_back_to_the_first_registered_site(db_session, monkeypatch):
    """配置里站点为空串时也留空——不得用 ``adapters[0].key`` 顶上。"""
    from app.schemas.apply import ApplyConfigIn

    monkeypatch.setattr(
        "app.services.apply.apply_service.get_apply_config",
        lambda _session: ApplyConfigIn(site_key=""),
    )

    assert TaskRunner._collect_site_key(db_session) == ""


def test_record_failure_category_falls_back_to_unknown():
    """非 ``SiteFailure`` 的失败路径（无适配器 / 连不上浏览器 / CdpError）没有分类可取，
    必须落 ``unknown`` 而不是留空或 ``None``——留空会让前端/判据去猜。"""
    task = ApplyTask(kind=TASK_KIND_COLLECT, config={})

    TaskRunner._record_failure_category(task, "")

    assert task.config["failure_category"] == FAILURE_UNKNOWN


def test_record_failure_category_keeps_a_real_category():
    """能取到分类时原样保留——健康度靠 ``selector_invalid`` 区分"站点改版"与"环境/用户侧"。"""
    task = ApplyTask(kind=TASK_KIND_COLLECT, config={})

    TaskRunner._record_failure_category(task, FAILURE_SELECTOR_INVALID)

    assert task.config["failure_category"] == FAILURE_SELECTOR_INVALID


# ===== 采集器：detail_missing 的计数口径与写入模式 =====


def _one_result_pages(url: str = "https://example.com/1") -> list[SearchPage]:
    return [
        SearchPage(
            results=[SearchResult(title="后端开发", company="A公司", url=url)],
            has_next=False,
        )
    ]


class _FailingDetailAdapter(FakeCollectAdapter):
    """详情页抛 ``SiteFailure``（采集器内部拿不到详情 → 返回 ``{}``）。"""

    def fetch_job_detail(self, client, url):  # type: ignore[override]
        raise SiteFailure(FAILURE_SELECTOR_INVALID, "详情页没抓到")


class _NoDetailCapabilityAdapter(FakeCollectAdapter):
    """适配器没有详情能力：把 ``fetch_job_detail`` 显式置 ``None``，等价于"从未实现该方法"。

    采集器用 ``getattr(adapter, "fetch_job_detail", None)`` 取能力，取到 ``None`` 时返回 ``{}``。
    这种情况同样算"没拿到详情"——否则一个只采列表、不读详情的站点永远不会被识别成漂移。
    """

    fetch_job_detail = None  # type: ignore[assignment]


def _run_collect(db_session, task, adapter, *, backfill_job_ids=None):
    return Collector().run(
        session=db_session,
        task=task,
        client=object(),
        adapter=adapter,
        config=_config(),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
        backfill_job_ids=backfill_job_ids,
    )


def test_detail_missing_counts_a_failing_detail_fetch(db_session):
    """详情页抛 ``SiteFailure`` → 计入 ``detail_missing``（本条仍然暂存）。"""
    report = _run_collect(db_session, _task(db_session), _FailingDetailAdapter(_one_result_pages()))

    assert report.collected == 1  # 拿不到详情也要暂存，缺的只是 JD
    assert report.detail_missing == 1


def test_detail_missing_counts_when_the_adapter_has_no_detail_capability(db_session):
    """适配器没有详情能力 → 同样计入 ``detail_missing``。"""
    report = _run_collect(
        db_session, _task(db_session), _NoDetailCapabilityAdapter(_one_result_pages())
    )

    assert report.collected == 1
    assert report.detail_missing == 1


def test_detail_missing_is_zero_when_the_detail_body_is_present(db_session):
    """详情拿到了正文 → 不计缺失，健康度不该因为一次正常采集而报警。"""
    report = _run_collect(db_session, _task(db_session), FakeCollectAdapter(_one_result_pages()))

    assert report.collected == 1
    assert report.detail_missing == 0


def test_detail_missing_ledger_is_written_only_in_search_mode(db_session):
    """``detail_missing`` 只由**搜索采集**写进 ``task.config``；补详情模式不写这个键。

    两套口径刻意分开：补详情有自己的账目（backfilled / backfill_skipped）。若混用，用户一次
    "点名补详情"就会把站点的漂移计数搅乱——健康度于是报出一个与实际采集无关的 degraded。
    """
    search_task = _task(db_session)
    _run_collect(db_session, search_task, _FailingDetailAdapter(_one_result_pages()))
    assert search_task.config["detail_missing"] == 1

    job = Job(title="后端开发", company="A公司", description="", source_url="https://example.com/1")
    db_session.add(job)
    db_session.commit()
    backfill_task = _task(db_session)
    _run_collect(
        db_session,
        backfill_task,
        _FailingDetailAdapter([]),
        backfill_job_ids=[job.id],
    )

    assert "detail_missing" not in (backfill_task.config or {})


# ===== 运行器：非 SiteFailure 的三条失败路径都落明确分类 =====


def _cannot_connect(_config):
    raise RuntimeError("无法连接投递专用浏览器")


class _CdpErrorAdapter(CollectAdapter):
    def collect_search(self, client, query, page):  # type: ignore[override]
        raise CdpError("CDP 连接中断")


def _run_runner(db_session, task, registry, client_factory):
    runner = TaskRunner(
        registry=registry,
        client_factory=client_factory,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
        poll_interval=0.01,
    )
    runner.start(task.id)
    _wait(runner)
    runner.shutdown()
    db_session.expire_all()
    return db_session.get(ApplyTask, task.id)


def test_collect_browser_connection_failure_records_unknown(db_session):
    """连不上浏览器（非 ``SiteFailure``）→ ``failure_category`` 落 ``unknown``。"""
    task = _collect_task(db_session)

    stored = _run_runner(
        db_session,
        task,
        _registry(CollectAdapter(page=SearchPage(results=[], has_next=False))),
        _cannot_connect,
    )

    assert stored.status == "failed"
    assert stored.config["failure_category"] == FAILURE_UNKNOWN


def test_collect_cdp_error_records_unknown(db_session):
    """``CdpError`` 路径 → ``failure_category`` 落 ``unknown``。"""
    task = _collect_task(db_session)

    stored = _run_runner(
        db_session,
        task,
        _registry(_CdpErrorAdapter(page=SearchPage(results=[], has_next=False))),
        lambda _config: FakeCdp(),
    )

    assert stored.status == "failed"
    assert stored.config["failure_category"] == FAILURE_UNKNOWN
