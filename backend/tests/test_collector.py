"""采集编排离线测试：翻页、去重、限速、可暂停、未映射条件记录。

**采集不写岗位广场**（用户实测反馈后的产品决定）：采到的东西先落进「备选岗位」暂存区，
由用户勾选后才导入。这里钉住的正是这条边界——`Job` 表在采集阶段必须纹丝不动。

（拆分说明：job_type/本地过滤/回收站在 test_collector_filters.py；停止/多关键词/认证
传播/详情缺失在 test_collector_keywords.py。``_FakeClock``/``FakeCollectAdapter``/
``_task``/``_config`` 被外部消费方 import，按契约留在本文件。）
"""
from app.models.apply import (
    TASK_KIND_COLLECT,
    ApplyTask,
)
from app.models.job import Job
from app.models.material import CANDIDATE_JOB_PENDING, CandidateJob
from app.schemas.apply import CollectConfigIn
from app.services.apply.collector import Collector
from app.services.candidate_jobs import stage_candidate_job
from app.services.sites.base import (
    ApplyOutcome,
    CollectQuery,
    RiskProfile,
    SearchPage,
    SearchResult,
    SiteAdapter,
    SiteFailure,
)


class _FakeClock:
    """每次读表都大步前进，让限速循环立即结束（离线测试不真等）。"""

    def __init__(self) -> None:
        self._t = 0.0

    def __call__(self) -> float:
        self._t += 100.0
        return self._t


class FakeCollectAdapter(SiteAdapter):
    key = "fake"
    display_name = "示例站点"
    hosts = ("example.com",)
    # 声明这三项走本地筛选，与真实适配器（BOSS）的契约一致——采集器的筛选是**门控在这份
    # 声明之内**的，测试里不声明就测不到筛选行为。
    post_filter_conditions = ("薪资", "经验", "学历")

    def __init__(self, pages: list[SearchPage]) -> None:
        self._pages = pages
        self.searched_pages: list[int] = []

    def risk_profile(self) -> RiskProfile:
        return RiskProfile(key=self.key)

    def collect_search(self, client, query: CollectQuery, page: int) -> SearchPage:
        self.searched_pages.append(page)
        return self._pages[min(page - 1, len(self._pages) - 1)]

    def open_apply(self, client, job):  # pragma: no cover - 采集不用
        raise AssertionError("采集不应调用投递")

    def fill_and_submit(self, client, data, greeting) -> ApplyOutcome:  # pragma: no cover
        raise AssertionError("采集不应调用投递")

    def fetch_job_detail(self, client, url):  # type: ignore[override]
        return {"description": "岗位详情正文", "requirements": "任职要求正文"}


def _task(db_session) -> ApplyTask:
    task = ApplyTask(kind=TASK_KIND_COLLECT, status="running", total=20, config={})
    db_session.add(task)
    db_session.commit()
    return task


def _config(**overrides) -> CollectConfigIn:
    data = {
        "keywords": ["后端"],
        "city": "北京",
        "per_task_limit": 10,
        "interval_seconds": 1,
        "interval_jitter_seconds": 0,
    }
    data.update(overrides)
    return CollectConfigIn(**data)


def test_collector_pages_and_stages_candidates(db_session):
    pages = [
        SearchPage(
            results=[
                SearchResult(title="后端开发", company="A公司", url="https://example.com/1"),
                SearchResult(title="数据开发", company="B公司", url="https://example.com/2"),
            ],
            page=1,
            has_next=True,
        ),
        SearchPage(
            results=[SearchResult(title="算法工程", company="C公司", url="https://example.com/3")],
            page=2,
            has_next=False,
        ),
    ]
    adapter = FakeCollectAdapter(pages)
    task = _task(db_session)

    report = Collector().run(
        session=db_session,
        task=task,
        client=object(),
        adapter=adapter,
        config=_config(),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )

    assert report.collected == 3
    assert report.pages == 2
    assert adapter.searched_pages == [1, 2]
    # **关键边界**：采集阶段岗位广场必须还是空的——采到的东西只进暂存区。
    assert db_session.query(Job).count() == 0

    staged = db_session.query(CandidateJob).order_by(CandidateJob.id).all()
    assert [item.title for item in staged] == ["后端开发", "数据开发", "算法工程"]
    first = staged[0]
    assert first.company == "A公司"
    assert first.source == "示例站点"
    assert first.source_url == "https://example.com/1"
    # 详情抓到的 JD 两段各归各位（暂存区也保留这份结构，导入时不必重新切）。
    assert first.description == "岗位详情正文"
    assert first.requirements == "任职要求正文"
    assert first.status == CANDIDATE_JOB_PENDING
    # 批次 id 让人能"按批次回看这次采到了什么"。
    assert first.collect_task_id == task.id
    assert task.processed == 3 and task.succeeded == 3


def test_collector_dedupes_against_both_the_job_board_and_the_staging_area(db_session):
    """去重必须**两张表都看**：只看岗位广场会在暂存区堆出重复候选，只看暂存区会把
    已经在岗位广场里的岗位重新捞回来。"""
    db_session.add(Job(title="后端开发", company="A公司", source_url="https://example.com/1"))
    stage_candidate_job(
        db_session, title="旧候选", company="E公司", source_url="https://example.com/8"
    )
    db_session.commit()

    pages = [
        SearchPage(
            results=[
                SearchResult(title="后端开发", company="A公司", url="https://example.com/1"),
                SearchResult(title="旧候选", company="E公司", url="https://example.com/8"),
                SearchResult(title="新岗位", company="D公司", url="https://example.com/9"),
            ],
            has_next=False,
        )
    ]
    task = _task(db_session)

    report = Collector().run(
        session=db_session,
        task=task,
        client=object(),
        adapter=FakeCollectAdapter(pages),
        config=_config(),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )

    assert report.collected == 1
    assert report.skipped == 2
    # 采集仍然没有往岗位广场写任何东西。
    assert db_session.query(Job).count() == 1
    # 暂存区是"原有 1 条 + 新增 1 条"，没有把已有的那条再存一遍。
    assert db_session.query(CandidateJob).count() == 2
    assert (
        db_session.query(CandidateJob).filter(CandidateJob.title == "新岗位").count() == 1
    )


def test_collector_stages_a_candidate_even_when_the_detail_fetch_fails(db_session):
    """详情抓失败时仍要暂存：标题/公司/城市/薪资/链接都已经拿到了，缺的只是 JD。

    把整条丢掉，等于"因为拿不到详情，连这个岗位都不要了"——而用户在暂存区里恰恰可以
    自己判断这条值不值得导入。
    """

    class _NoDetailAdapter(FakeCollectAdapter):
        def fetch_job_detail(self, client, url):  # type: ignore[override]
            raise SiteFailure("selector_invalid", "详情页没抓到")

    pages = [
        SearchPage(
            results=[
                SearchResult(
                    title="后端开发",
                    company="A公司",
                    location="天津",
                    salary="20-30K",
                    url="https://example.com/1",
                )
            ],
            has_next=False,
        )
    ]
    task = _task(db_session)

    report = Collector().run(
        session=db_session,
        task=task,
        client=object(),
        adapter=_NoDetailAdapter(pages),
        config=_config(),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )

    assert report.collected == 1
    staged = db_session.query(CandidateJob).one()
    assert staged.title == "后端开发"
    assert staged.location == "天津"
    assert staged.salary == "20-30K"
    assert staged.description == ""


def test_collector_stops_early_when_pages_repeat(db_session):
    """从某一页起站点开始返回与前面**完全相同**的结果：连续两页全重复就提前停。

    真实场景：筛选组合下岗位总量就这么多，站点对深层翻页原样重复推送——旧行为会
    一路翻满 30 页上限，界面上表现为"卡在某一页 + 一个岗位都采不到"（已处理永远是
    0，因为进度只算新增）。账目里必须写明停在哪一页，收尾文案据此解释。
    """
    unique = [
        SearchPage(
            results=[
                SearchResult(title=f"岗位{index}", company="A公司", url=f"https://example.com/{index}")
            ],
            page=index,
            has_next=True,
        )
        for index in range(1, 4)
    ]
    repeated = SearchPage(
        results=[SearchResult(title="岗位1", company="A公司", url="https://example.com/1")],
        page=4,
        has_next=True,
    )
    adapter = FakeCollectAdapter(unique + [repeated, repeated])
    task = _task(db_session)

    report = Collector().run(
        session=db_session,
        task=task,
        client=object(),
        adapter=adapter,
        config=_config(per_task_limit=10),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )

    # 页 4、5 连续全重复 → 第 5 页停（给一页宽限，不会翻满 30 页）
    assert report.pagination_stopped_at == 5
    assert adapter.searched_pages == [1, 2, 3, 4, 5]
    assert report.collected == 3
    assert report.skipped == 2
    # 账目进 task.config，界面据此显示"提前停止翻页"的说明
    assert task.config["pagination_stopped_at"] == 5
