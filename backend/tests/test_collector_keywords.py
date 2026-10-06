"""采集编排：停止信号、多关键词全局上限、认证失败传播与详情缺失计数
（从 test_collector.py 拆出）。

``FakeCollectAdapter``/``_FakeClock``/``_task``/``_config`` 留在主文件
（test_collector.py，同时被外部消费方 import）。
"""
import pytest
from app.models.apply import (
    FAILURE_CAPTCHA_REQUIRED,
    FAILURE_LOGIN_REQUIRED,
)
from app.models.material import CandidateJob
from app.services.apply.collector import Collector
from app.services.apply.task_runner import TaskStopped
from app.services.sites.base import SearchPage, SearchResult, SiteFailure
from test_collector import FakeCollectAdapter, _config, _FakeClock, _task


def test_collector_stops_when_checkpoint_signals_stop(db_session):
    calls = {"count": 0}

    def checkpoint() -> None:
        calls["count"] += 1
        if calls["count"] >= 2:  # 用户点停止：下一步骤前抛出
            raise TaskStopped()

    pages = [
        SearchPage(
            results=[SearchResult(title="后端开发", company="A公司", url="https://example.com/1")],
            has_next=True,
        )
    ]
    task = _task(db_session)

    with pytest.raises(TaskStopped):
        Collector().run(
            session=db_session,
            task=task,
            client=object(),
            adapter=FakeCollectAdapter(pages),
            config=_config(),
            checkpoint=checkpoint,
            sleeper=lambda _seconds: None,
            clock=_FakeClock(),
        )


def test_collector_searches_all_keywords_with_one_global_limit_and_dedupes(db_session):
    """多个关键词都要实际搜索；上限与去重口径覆盖整个任务，而不是每个关键词各算一遍。"""

    class _KeywordAdapter(FakeCollectAdapter):
        def __init__(self) -> None:
            super().__init__([])
            self.searched_keywords: list[str] = []

        def collect_search(self, client, query, page):  # type: ignore[override]
            keyword = query.keywords[0] if query.keywords else ""
            self.searched_keywords.append(keyword)
            shared = SearchResult(
                title="共享岗位", company="A公司", url="https://example.com/shared"
            )
            if keyword == "后端":
                results = [
                    shared,
                    SearchResult(
                        title="后端岗位", company="B公司", url="https://example.com/backend"
                    ),
                ]
            else:
                results = [
                    shared,
                    SearchResult(
                        title="算法岗位", company="C公司", url="https://example.com/algorithm"
                    ),
                    SearchResult(
                        title="超过全局上限", company="D公司", url="https://example.com/overflow"
                    ),
                ]
            return SearchPage(results=results, page=page, has_next=False)

    adapter = _KeywordAdapter()
    task = _task(db_session)

    report = Collector().run(
        session=db_session,
        task=task,
        client=object(),
        adapter=adapter,
        config=_config(keywords=["后端", "算法"], per_task_limit=3),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )

    assert adapter.searched_keywords == ["后端", "算法"]
    assert report.collected == 3
    assert report.skipped == 1
    assert {item.title for item in db_session.query(CandidateJob).all()} == {
        "共享岗位",
        "后端岗位",
        "算法岗位",
    }


def test_collector_runs_one_blank_keyword_search_for_city_only_config(db_session):
    """只填城市也要执行一次搜索，不能因为关键词列表为空而完全跳过采集。"""

    class _CityOnlyAdapter(FakeCollectAdapter):
        def __init__(self) -> None:
            super().__init__([])
            self.keyword_lists: list[list[str]] = []

        def collect_search(self, client, query, page):  # type: ignore[override]
            self.keyword_lists.append(list(query.keywords))
            return SearchPage(
                results=[
                    SearchResult(
                        title="城市岗位", company="A公司", url="https://example.com/city"
                    )
                ],
                has_next=False,
            )

    adapter = _CityOnlyAdapter()
    task = _task(db_session)
    report = Collector().run(
        session=db_session,
        task=task,
        client=object(),
        adapter=adapter,
        config=_config(keywords=[], city="杭州"),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )

    assert adapter.keyword_lists == [[""]]
    assert report.collected == 1


@pytest.mark.parametrize("category", [FAILURE_LOGIN_REQUIRED, FAILURE_CAPTCHA_REQUIRED])
def test_collector_propagates_auth_failures_from_detail_fetch(db_session, category):
    """登录失效或验证码不是可忽略的详情缺失，必须让任务层暂停/失败并提示用户处理。"""

    class _AuthFailureAdapter(FakeCollectAdapter):
        def fetch_job_detail(self, client, url):  # type: ignore[override]
            raise SiteFailure(category, "需要用户处理")

    task = _task(db_session)
    pages = [
        SearchPage(
            results=[SearchResult(title="岗位", company="A公司", url="https://example.com/1")],
            has_next=False,
        )
    ]

    with pytest.raises(SiteFailure) as exc_info:
        Collector().run(
            session=db_session,
            task=task,
            client=object(),
            adapter=_AuthFailureAdapter(pages),
            config=_config(),
            checkpoint=lambda: None,
            sleeper=lambda _seconds: None,
            clock=_FakeClock(),
        )

    assert exc_info.value.category == category
    assert db_session.query(CandidateJob).count() == 0


# ===== 详情缺失：站点漂移唯一留下的痕迹 =====


def test_collector_counts_staged_candidates_whose_detail_is_missing(db_session):
    """能采到列表、却抓不到详情时，任务仍是"成功"的——不把这个数记下来，"站点漂移"就完全
    看不见（历史上"8 条岗位 JD 全空"就是这样发生的）。"""

    class _NoDetailAdapter(FakeCollectAdapter):
        def fetch_job_detail(self, client, url):  # type: ignore[override]
            raise SiteFailure("selector_invalid", "详情页没抓到")

    pages = [
        SearchPage(
            results=[SearchResult(title="后端开发", company="A公司", url="https://example.com/1")],
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
    assert report.detail_missing == 1
    # 收尾时写进 config，供站点健康度识别"详情普遍为空"。
    assert task.config["detail_missing"] == 1


def test_collector_does_not_count_detail_missing_when_details_are_present(db_session):
    """详情正常抓到时 ``detail_missing`` 为 0——健康度不该因为一次正常采集而报警。"""
    pages = [
        SearchPage(
            results=[SearchResult(title="后端开发", company="A公司", url="https://example.com/1")],
            has_next=False,
        )
    ]
    task = _task(db_session)

    report = Collector().run(
        session=db_session,
        task=task,
        client=object(),
        adapter=FakeCollectAdapter(pages),  # 详情返回非空正文
        config=_config(),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )

    assert report.detail_missing == 0
    assert task.config["detail_missing"] == 0
