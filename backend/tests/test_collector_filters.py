"""采集编排：岗位类型透传、本地筛选记账、回收站去重（从 test_collector.py 拆出）。

``FakeCollectAdapter``/``_FakeClock``/``_task``/``_config`` 留在主文件
（test_collector.py，同时被外部消费方 import）。
"""
from app.models.job import Job
from app.models.material import CandidateJob
from app.services.apply.collector import Collector
from app.services.sites.base import SearchPage, SearchResult

from test_collector import FakeCollectAdapter, _FakeClock, _config, _task


def test_collector_stamps_the_configured_job_type_on_candidates(db_session):
    """采集任务配置里的 job_type 要透传进暂存区（仅标注，不参与站点筛选/去重）。"""
    pages = [
        SearchPage(
            results=[SearchResult(title="后端开发", company="A公司", url="https://example.com/1")],
            has_next=False,
        )
    ]
    task = _task(db_session)

    Collector().run(
        session=db_session,
        task=task,
        client=object(),
        adapter=FakeCollectAdapter(pages),
        config=_config(job_type="校招"),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )

    staged = db_session.query(CandidateJob).one()
    assert staged.job_type == "校招"


def test_collector_leaves_job_type_empty_when_not_configured(db_session):
    """不选岗位类型时 job_type 应为空串（= 不限），而不是塞个默认值。"""
    pages = [
        SearchPage(
            results=[SearchResult(title="后端开发", company="A公司", url="https://example.com/1")],
            has_next=False,
        )
    ]
    task = _task(db_session)

    Collector().run(
        session=db_session,
        task=task,
        client=object(),
        adapter=FakeCollectAdapter(pages),
        config=_config(),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )

    assert db_session.query(CandidateJob).one().job_type == ""


def test_collector_records_unmapped_conditions(db_session):
    pages = [
        SearchPage(
            results=[SearchResult(title="后端开发", company="A公司", url="https://example.com/1")],
            has_next=False,
            unmapped_conditions=["薪资", "学历"],
        )
    ]
    task = _task(db_session)

    Collector().run(
        session=db_session,
        task=task,
        client=object(),
        adapter=FakeCollectAdapter(pages),
        config=_config(salary_min=20, education="本科"),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )

    assert set(task.config.get("unmapped_conditions", [])) == {"薪资", "学历"}


def test_collector_filters_by_education_and_keeps_what_it_cannot_judge(db_session):
    """填了学历 → 岗位要求高于它的被筛掉，**没写学历的保留**，并把账记清。

    这两件事必须一起做到：只筛不记账，用户不知道漏了多少；为了"筛干净"把没写学历的也
    一起排除，就会悄悄丢掉他真正想要的岗位。
    """
    pages = [
        SearchPage(
            results=[
                SearchResult(
                    title="要求硕士的岗位",
                    company="A公司",
                    url="https://example.com/1",
                    extra={"degree": "硕士"},
                ),
                SearchResult(
                    title="要求大专的岗位",
                    company="B公司",
                    url="https://example.com/2",
                    extra={"degree": "大专"},
                ),
                SearchResult(
                    title="没写学历的岗位",
                    company="C公司",
                    url="https://example.com/3",
                    extra={},
                ),
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
        config=_config(education="本科"),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )

    assert report.filtered == 1
    assert report.collected == 2
    titles = {item.title for item in db_session.query(CandidateJob).all()}
    assert titles == {"要求大专的岗位", "没写学历的岗位"}

    assert task.config["filtered_out"] == 1
    assert task.config["filter_reasons"] == ["学历"]
    # 没写学历的那条被保留，但要如实记为"未能判断"。
    assert task.config["filter_undecided"] == ["学历"]
    assert task.config["filter_undecided_count"] == 1
    assert task.config["filter_applied"] == ["学历"]


def test_collector_reports_an_unparsable_condition_as_unapplied(db_session):
    """用户填了读不懂的学历词 → 如实报「没能用上」，绝不装作筛过了。

    这正是本项目反复出现的"静默失效"：界面标着生效，代码里什么也没做。
    """
    pages = [
        SearchPage(
            results=[
                SearchResult(
                    title="岗位",
                    company="A公司",
                    url="https://example.com/1",
                    extra={"degree": "本科"},
                )
            ],
            has_next=False,
        )
    ]
    task = _task(db_session)

    Collector().run(
        session=db_session,
        task=task,
        client=object(),
        adapter=FakeCollectAdapter(pages),
        config=_config(education="管培生"),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )

    assert task.config["filter_unapplied"] == ["学历"]
    assert task.config["filtered_out"] == 0
    assert db_session.query(CandidateJob).count() == 1


def test_collector_treats_a_trashed_job_as_existing_and_says_so(db_session):
    """**回收站里的岗位也算"已存在"**，并且要单独计数。

    不算已存在的话，"删掉 → 再采集一次"会造出第二条同一岗位，而用户以为自己只是删了一条。
    单独计数则是因为这两种"跳过"对用户的含义完全不同：一种是"早就在库里了"，另一种是
    "你之前删过它"——后者不说清楚，用户会以为删除没生效。
    """
    from app.services import trash

    job = Job(title="删过的岗位", company="A公司", source_url="https://example.com/1")
    db_session.add(job)
    db_session.commit()
    trash.soft_delete(db_session, "job", job)
    db_session.commit()

    pages = [
        SearchPage(
            results=[
                SearchResult(title="删过的岗位", company="A公司", url="https://example.com/1")
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

    assert report.collected == 0
    assert report.skipped == 1
    assert report.skipped_trashed == 1
    assert task.config["skipped_trashed"] == 1
    # 没有新建第二条。
    assert db_session.query(Job).count() == 1


def test_collector_does_not_filter_when_the_adapter_does_not_declare_it(db_session):
    """适配器没声明本地筛选能力时**不筛**——不能拿"缺失的字段"当判断依据去误杀岗位。"""

    class _NoFilterAdapter(FakeCollectAdapter):
        post_filter_conditions = ()

    pages = [
        SearchPage(
            results=[
                SearchResult(
                    title="要求硕士的岗位",
                    company="A公司",
                    url="https://example.com/1",
                    extra={"degree": "硕士"},
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
        adapter=_NoFilterAdapter(pages),
        config=_config(education="本科"),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )

    assert report.filtered == 0
    assert report.collected == 1
    # 没有任何条件被本地处理过，就不该写这套账目。
    assert "filtered_out" not in (task.config or {})
