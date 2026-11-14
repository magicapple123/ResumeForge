# SPDX-License-Identifier: Apache-2.0
"""申请状态回读（R-15 C）：页面识别与写回规则。

重点不在"能不能识别出面试"，而在**认错时的后果**：

- 岗位下线不是拒信（``CLOSED`` 绝不能写成 ``rejected``）；
- 门户页的埋点脚本里到处是 "interview" 这类变量名，所以匹配前必须去 script/style；
- 回读只能前进（``resolve_status``），乱序读到旧页面不能把进度打回去；
- 回读失败、没有链接、页面是 SPA 空壳时**一个字都不写**。
"""

from __future__ import annotations

import pytest
from app.models.job import Job
from app.models.tracker import (
    EVENT_SOURCE_SYSTEM,
    STATUS_APPLIED,
    STATUS_ASSESSMENT,
    STATUS_INTERVIEW,
    STATUS_OFFER,
    STATUS_REJECTED,
    STATUS_SCREENING,
    ApplicationTrack,
    normalize_key,
)
from app.services import track_probe
from app.services.track_portal import ProbeKind, detect_portal, page_text, probe_status


def _html(body: str) -> str:
    return f"<html><body>{body}</body></html>"


# ===== 页面识别 =====


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ("<p>Your application is under review.</p>", STATUS_SCREENING),
        ("<p>We would like to schedule your interview.</p>", STATUS_INTERVIEW),
        ("<p>Congratulations, we are pleased to offer you the role.</p>", STATUS_OFFER),
        ("<p>Unfortunately, we are not moving forward with your application.</p>", STATUS_REJECTED),
        ("<p>Thank you for applying. Application received.</p>", STATUS_APPLIED),
        ("<p>请参加在线测评，链接见邮件。</p>", "assessment"),
    ],
)
def test_probe_reads_the_stage_from_the_page(body, expected):
    result = probe_status("https://boards.greenhouse.io/acme/jobs/1", _html(body))
    assert result.kind == ProbeKind.STATUS
    assert result.status == expected
    assert result.evidence


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ("<p>投递记录</p><p>申请成功</p>", STATUS_APPLIED),
        ("<p>初筛</p>", STATUS_SCREENING),
        ("<p>笔试通知</p>", STATUS_ASSESSMENT),
        ("<p>面试中</p>", STATUS_INTERVIEW),
        ("<p>流程终止</p>", STATUS_REJECTED),
        ("<p>已录用</p>", STATUS_OFFER),
    ],
)
def test_moka_chinese_statuses(body, expected):
    """Moka 投递记录页的实测文案（校招最常见的国内 SaaS）。"""
    result = probe_status("https://app.mokahr.com/campus-recruitment/yutong/172567", _html(body))
    assert result.platform == "moka"
    assert result.kind == ProbeKind.STATUS
    assert result.status == expected


def test_bytedance_badge_is_read_from_the_job_page():
    """岗位页上明确的「已投递」徽标可以读。

    2026-11-13 复测：未登录时同一个页面上没有这个徽标（只有「投递」按钮），
    所以本用例只覆盖"徽标真的在页面上时读得到"；按钮文案由下面两条用例挡住。
    """
    result = probe_status(
        "https://jobs.bytedance.com/campus/position/1/detail",
        _html(
            "AI产品经理（Agent方向） - 剪映CapCut 已投递 北京、深圳 正式 产品 2027届校园招聘"
            " 职位描述 团队介绍：剪映CapCut团队"
        ),
    )
    assert result.platform == "bytedance"
    assert result.status == STATUS_APPLIED


def test_apply_button_on_a_job_page_is_not_a_status():
    """岗位详情页的「投递简历」是按钮，不是"你投过了"（真实 DOM 抓于 2026-11-13）。

    未投递的账号打开岗位页，字节渲染的是
    ``<button class="atsx-btn apply-block-applyBtn"><span>投递简历</span></button>``；
    旧规则会把「投递简历」读成已投递，把用户没投过的岗位改成已投递。
    """
    result = probe_status(
        "https://jobs.bytedance.com/campus/position/1/detail",
        _html(
            "<h1>AI产品经理（Agent方向） - 剪映CapCut</h1>"
            "<p>职位描述</p><p>1、负责剪映 Agent 产品的路线规划；</p>"
            '<button class="atsx-btn apply-block-applyBtn"><span>投递简历</span></button>'
            "<p>相关职位</p>"
        ),
    )
    assert result.kind == ProbeKind.UNKNOWN
    assert "岗位详情页" in result.note
    assert result.status == ""


def test_interview_words_in_a_job_page_are_process_copy_not_progress():
    """岗位页的「面试流程：三轮」是在介绍流程，不是你已经进面试了。"""
    result = probe_status(
        "https://jobs.bytedance.com/campus/position/1/detail",
        _html("<p>职位描述</p><p>面试流程：笔试 → 初试 → 复试 → 终试</p><p>任职要求：本科</p>"),
    )
    assert result.kind == ProbeKind.UNKNOWN
    assert result.status == ""


def test_record_page_step_named_apply_resume_still_counts():
    """同一个词在**投递记录页**上是阶段名（字节校招流程节点就叫「投递简历」），照读。"""
    result = probe_status(
        "https://jobs.bytedance.com/campus/position/application",
        _html("我的投递 字节跳动 客户端开发 投递简历 2026-09-22 投递"),
    )
    assert result.kind == ProbeKind.STATUS
    assert result.status == STATUS_APPLIED


def test_login_page_is_named_as_such():
    """停在登录页时要说"去登录"，而不是"没有可识别的状态"（真实文案抓于 2026-11-13）。"""
    result = probe_status(
        "https://jobs.bytedance.com/campus/position/application",
        _html(
            "登录 - 加入字节跳动 手机号码登录 邮箱登录 +86 获取验证码 登录 "
            "未注册的手机号码验证后将自动创建账号"
        ),
    )
    assert result.kind == ProbeKind.UNKNOWN
    assert "登录页" in result.note


def test_talent_pool_is_not_a_rejection():
    """「进入人才库」在 Moka 的招聘 Q&A 里明确写着不等于淘汰，不能写成已结束。"""
    result = probe_status(
        "https://app.mokahr.com/campus-recruitment/yutong/172567", _html("进入人才库")
    )
    assert result.kind == ProbeKind.UNKNOWN
    assert "不等于淘汰" in result.note


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ("<p>待筛选</p>", STATUS_SCREENING),
        ("<p>评估中</p>", STATUS_SCREENING),
        ("<p>待面试</p>", STATUS_INTERVIEW),
        ("<p>待入职</p>", STATUS_OFFER),
        ("<p>已淘汰</p>", STATUS_REJECTED),
    ],
)
def test_feishu_statuses(body, expected):
    """飞书招聘的候选人官网（前端渲染，状态词是这套中文阶段名）。"""
    result = probe_status("https://acme.jobs.feishu.cn/campus", _html(body))
    assert result.platform == "feishu"
    assert result.status == expected


# ===== 抓取：空壳 → 浏览器渲染 =====


def test_thin_shell_escalates_to_the_browser(monkeypatch):
    """直连只拿到 `<div id="app">` 时改用投递浏览器渲染（复用里面的登录态）。"""
    monkeypatch.setattr(track_probe, "_http_get", lambda url, cookie: "<div id='app'></div>")

    class Page:
        text = "投递记录 面试中"

    got = track_probe._fetch_html(
        "https://acme.jobs.feishu.cn/campus", "", db=object(), render=lambda db, url: Page()
    )
    assert got.engine == "browser"
    assert "面试中" in got.text


def test_browser_failure_falls_back_to_http(monkeypatch):
    """浏览器没启动不能把整次回读弄挂：退回直连结果，交给文案识别去判。"""
    monkeypatch.setattr(track_probe, "_http_get", lambda url, cookie: "<div id='app'></div>")

    def boom(db, url):
        raise RuntimeError("浏览器没开")

    got = track_probe._fetch_html(
        "https://acme.jobs.feishu.cn/campus", "", db=object(), render=boom
    )
    assert got.engine == "http"
    assert "app" in got.text


def test_content_rich_page_is_not_rendered(monkeypatch):
    """直连就拿到正文的站点不启动浏览器（慢且没必要）。"""
    body = _html("投递记录 面试中 " * 40)
    monkeypatch.setattr(track_probe, "_http_get", lambda url, cookie: body)
    rendered: list[int] = []

    got = track_probe._fetch_html(
        "https://boards.greenhouse.io/acme/jobs/1",
        "",
        db=object(),
        render=lambda db, url: rendered.append(1),
    )
    assert got.engine == "http"
    assert rendered == []


def test_closed_posting_is_not_a_rejection():
    """岗位下线只说明这条招聘关了；写成拒信会让人以为自己被刷了。"""
    result = probe_status(
        "https://jobs.lever.co/acme/1",
        _html("<p>This job is no longer accepting applications.</p>"),
    )
    assert result.kind == ProbeKind.CLOSED
    assert result.status == ""
    assert "不代表你被拒" in result.note


def test_script_text_is_ignored():
    """门户的埋点脚本里常有 `interview` 之类的变量名，不能因此判成面试。"""
    html = (
        "<html><head><script>var interviewSlot = null; var offerLetter = 1;</script></head>"
        "<body><p>Thanks for your interest.</p></body></html>"
    )
    result = probe_status("https://acme.myworkdayjobs.com/job/1", html)
    assert result.kind == ProbeKind.UNKNOWN


def test_empty_or_spa_shell_is_unreadable():
    result = probe_status("https://boards.greenhouse.io/acme/jobs/1", "<div id='root'></div>")
    assert result.kind == ProbeKind.UNKNOWN
    assert "需要登录" in result.note


def test_page_text_keeps_chinese_and_drops_markup():
    text = page_text("<div><b>面试</b>邀请<span>8 月 20 日</span></div>")
    assert "面试" in text and "<b>" not in text


def test_detect_portal_by_host():
    assert detect_portal("https://acme.wd3.myworkdayjobs.com/zh-CN/x") == "workday"
    assert detect_portal("https://boards.greenhouse.io/acme/jobs/1") == "greenhouse"
    assert detect_portal("https://jobs.lever.co/acme/abc") == "lever"
    assert detect_portal("https://careers.example.com/job/1") == ""
    # 国内校招两家 SaaS：Moka 与北森。
    assert detect_portal("https://app.mokahr.com/campus-recruitment/yutong/172567") == "moka"
    assert detect_portal("https://abc.zhiye.com/social/detail?jobAdId=1") == "beisen"
    # 字节自研校招站：岗位详情页的徽标能读（实测），列表页不拉数据（见验收记录）。
    assert detect_portal("https://jobs.bytedance.com/campus/position/1/detail") == "bytedance"


# ===== 写回 =====


def _track(
    db,
    *,
    status=STATUS_APPLIED,
    url="https://boards.greenhouse.io/acme/jobs/1",
    title="后端开发实习生",
):
    job = Job(title=title, company="示例科技", source_url=url) if url else None
    if job is not None:
        db.add(job)
        db.flush()
    record = ApplicationTrack(
        company="示例科技",
        title=title,
        company_key=normalize_key("示例科技"),
        title_key=normalize_key(title),
        status=status,
        job_id=job.id if job is not None else None,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def _fetcher(body: str):
    def fetch(url: str, cookie: str) -> str:
        assert url.startswith("https://")
        return _html(body)

    return fetch


def test_readback_advances_and_records_system_event(db_session):
    track = _track(db_session)
    outcome = track_probe.refresh_track(
        db_session, track, fetch=_fetcher("<p>Your application is under review.</p>")
    )
    assert outcome.outcome == "changed"
    assert outcome.before == STATUS_APPLIED
    assert outcome.after == STATUS_SCREENING
    assert track.status == STATUS_SCREENING
    # 事件要能分清"系统读到的"和"我自己改的"。
    from app.models.tracker import ApplicationTrackEvent

    event = db_session.query(ApplicationTrackEvent).filter_by(track_id=track.id).one()
    assert event.source == EVENT_SOURCE_SYSTEM
    assert event.user_confirmed is False
    # 回读不知道对方哪天变的，所以业务日期必须留空（否则污染阶段耗时）。
    assert event.status_date == ""
    assert "自动回读" in track.evidence


def test_readback_never_rolls_back(db_session):
    """当前已是面试，页面还停在「已收到申请」：不倒退，也不写事件。"""
    track = _track(db_session, status=STATUS_INTERVIEW)
    outcome = track_probe.refresh_track(
        db_session, track, fetch=_fetcher("<p>Application received.</p>")
    )
    assert outcome.outcome == "unchanged"
    assert track.status == STATUS_INTERVIEW


def test_rejected_is_terminal_even_if_the_page_says_offer(db_session):
    track = _track(db_session, status=STATUS_REJECTED)
    # 已结束的记录不再进入待回读队列。
    assert track not in track_probe.probe_candidates(db_session)
    outcome = track_probe.refresh_track(
        db_session, track, fetch=_fetcher("<p>We are pleased to offer you the role.</p>")
    )
    assert outcome.outcome == "unchanged"
    assert track.status == STATUS_REJECTED


def test_closed_posting_leaves_the_status_alone(db_session):
    track = _track(db_session)
    outcome = track_probe.refresh_track(
        db_session, track, fetch=_fetcher("<p>This job is no longer available.</p>")
    )
    assert outcome.outcome == "skipped"
    assert track.status == STATUS_APPLIED
    assert "不代表你被拒" in outcome.note


def test_fetch_failure_is_reported_not_swallowed(db_session):
    track = _track(db_session)

    def boom(url: str, cookie: str) -> str:
        raise TimeoutError("门户超时")

    outcome = track_probe.refresh_track(db_session, track, fetch=boom)
    assert outcome.outcome == "failed"
    assert "门户超时" in outcome.note
    assert track.status == STATUS_APPLIED


def test_track_without_a_link_is_skipped(db_session):
    track = _track(db_session, url="")
    outcome = track_probe.refresh_track(db_session, track, fetch=_fetcher("x"))
    assert outcome.outcome == "skipped"
    assert "没有关联岗位链接" in outcome.note


def test_track_url_falls_back_to_the_job_library(db_session):
    """没有 job_id 时按「公司 + 岗位」在岗位库里找回链接。"""
    db_session.add(Job(title="后端开发实习生", company="示例科技", source_url="https://x.test/1"))
    db_session.commit()
    track = _track(db_session, url="")
    assert track_probe.track_url(db_session, track) == "https://x.test/1"


# ===== 设置与补算节奏 =====


def test_settings_default_off_and_never_leak_the_cookie(db_session):
    settings = track_probe.read_settings(db_session)
    assert settings.enabled is False
    assert settings.has_cookie is False
    assert track_probe.due_for_daily(db_session) is False

    track_probe.write_settings(db_session, enabled=True, cookie="session=abc")
    settings = track_probe.read_settings(db_session)
    assert settings.enabled is True
    assert settings.has_cookie is True
    # 对外视图只有布尔：Cookie 是登录凭据，不能回传。
    assert "abc" not in str(settings)
    assert track_probe.read_cookie(db_session) == "session=abc"


def test_daily_runs_at_most_once_per_interval(db_session):
    from datetime import datetime, timedelta

    track_probe.write_settings(db_session, enabled=True, cookie="session=abc")
    now = datetime(2026, 11, 13, 9, 0, 0)
    assert track_probe.due_for_daily(db_session, now=now) is True

    track_probe.mark_ran(db_session, now=now)
    assert track_probe.due_for_daily(db_session, now=now + timedelta(hours=3)) is False
    assert track_probe.due_for_daily(db_session, now=now + timedelta(hours=21)) is True


def test_cookie_can_be_cleared(db_session):
    track_probe.write_settings(db_session, cookie="session=abc")
    track_probe.write_settings(db_session, cookie="")
    assert track_probe.read_settings(db_session).has_cookie is False


def test_batch_keeps_going_after_one_failure(db_session):
    good = _track(db_session)
    bad = _track(db_session, url="https://broken.test/1", title="算法实习生")

    def fetch(url: str, cookie: str) -> str:
        if "broken" in url:
            raise TimeoutError("超时")
        return _html("<p>We would like to schedule your interview.</p>")

    outcomes = track_probe.refresh_tracks(db_session, [good, bad], fetch=fetch)
    assert [item.outcome for item in outcomes] == ["changed", "failed"]
    assert good.status == STATUS_INTERVIEW
