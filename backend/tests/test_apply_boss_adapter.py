"""BOSS 直聘适配器离线测试：喂静态页面快照，断言采集解析、投递结果判定与失败分类。

真实 DOM 无法联调，所以适配器把"解析与判定"抽成了纯函数，这里直接喂快照验证它们；
选择器失效时必须给出可操作诊断（含当前 URL / 标题 / 匹配控件数 / 期望）。

（拆分说明：collect_search 全流程与 DOM 兜底在 test_apply_boss_adapter_collect.py；
detail/open_apply/fill_and_submit 与网络捕获在 test_apply_boss_adapter_submit.py。
`boss()`/`ScriptedCdpClient`/常量留在本文件，供两个主题文件复用。）
"""
import pytest
from app.models.apply import (
    FAILURE_CAPTCHA_REQUIRED,
    FAILURE_LOGIN_REQUIRED,
    FAILURE_SELECTOR_INVALID,
)
from app.services.browser.cdp_client import CdpClient
from app.services.browser.page_ready import ReadyWait
from app.services.sites.base import CollectQuery, RiskProfile, SiteAdapter, SiteFailure
from app.services.sites.boss import (
    _SELECTORS,
    BOSS_DISPLAY_NAME,
    BOSS_KEY,
    BossAdapter,
    classify_submit_state,
    detect_blocker,
    parse_job_detail,
    parse_search_payload,
    selector_diagnostic,
)

FAKE_JOB = type("FakeJob", (), {"source_url": "https://www.zhipin.com/job_detail/abc.html"})()

# 等待参数：离线测试用极短超时/间隔，避免用例真的等满默认的十几秒。
FAST_WAIT = ReadyWait(timeout=0.05, poll_interval=0.001)
# 就绪探针的默认响应（页面已加载、匹配到 1 个目标控件）。
READY_STATE = {"matched": 1, "explicitly_empty": False, "ready_state": "complete"}


def boss() -> BossAdapter:
    return BossAdapter(ready_wait=FAST_WAIT)


class ScriptedCdpClient(CdpClient):
    """按表达式里的标记返回脚本化结果的假 CDP 客户端。

    复用同一标签页导航（``navigate``），因此这里同时记录 ``navigations``；``rf:readiness``
    探针默认返回"已就绪"，各用例可用 ``ready`` 覆盖成"未就绪 / 无结果 / 已定型不可用"。
    """

    def __init__(self, responses=None, *, ready=None):
        self.responses = responses or {}
        self.ready = dict(READY_STATE) if ready is None else ready
        self.expressions: list[str] = []
        self.navigations: list[str] = []
        # 兼容旧断言：new_tab 仍记录，但采集/投递路径已改为 navigate 复用标签页。
        self.tabs: list[str] = []

    def list_targets(self):
        return []

    def new_tab(self, url: str = "about:blank") -> str:
        self.tabs.append(url)
        return "TAB"

    def navigate(self, url: str, *, timeout=None):
        self.navigations.append(url)
        if isinstance(self.ready, dict) and not self.ready.get("url"):
            self.ready["url"] = url
        return {}

    def send(self, method, params=None, *, timeout=None):
        return {}

    def evaluate(self, expression, *, timeout=None):
        self.expressions.append(expression)
        if "rf:readiness" in expression:
            return self.ready
        for marker, value in self.responses.items():
            if marker in expression:
                return value
        return None

    def close(self):
        pass


def test_matches_only_boss_targets():
    adapter = BossAdapter()

    assert adapter.matches("BOSS直聘") is True
    assert adapter.matches("https://www.zhipin.com/web/geek/job") is True
    assert adapter.matches("手动添加") is False
    assert adapter.matches("https://www.lagou.com") is False


def test_risk_profile_is_conservative():
    profile = BossAdapter().risk_profile()

    assert profile.key == BOSS_KEY
    assert profile.min_interval_seconds >= 20
    assert profile.max_per_hour <= 100
    assert profile.needs_login is True


def test_every_selector_is_a_non_empty_string():
    assert _SELECTORS
    for name, selector in _SELECTORS.items():
        assert isinstance(selector, str) and selector, name


def test_build_search_url_maps_keyword_city_and_page():
    adapter = BossAdapter()

    url = adapter.build_search_url(
        CollectQuery(keywords=["后端开发"], city="杭州"), page=3
    )

    assert "query=%E5%90%8E%E7%AB%AF%E5%BC%80%E5%8F%91" in url
    assert "city=101210100" in url
    assert url.endswith("page=3")


def test_salary_experience_education_are_locally_filtered_instead_of_unmapped():
    """薪资 / 经验 / 学历**不再报成"未生效"**：它们换成"采集后按接口字段本地筛选"。

    以前这三项一律标「未生效」，用户以为自己填的条件被丢掉了。现在它们真的会生效，
    只是生效的位置从"查询参数"换成了"采集后的本地筛选"（见 ``collect_filters``）。
    适配器要**声明**这件事，否则采集器不知道可以按接口字段筛。
    岗位类型同理：原始编码来自列表接口（``extra["job_type_code"]``）。
    """
    adapter = BossAdapter()
    query = CollectQuery(keywords=["后端"], salary_min=20, experience="3-5年", education="本科")

    # 不再有"未生效"的条件——真的没有条件被丢掉了。
    assert adapter.unmapped_conditions(query) == []
    assert adapter.unmapped_conditions(CollectQuery(keywords=["后端"], city="北京")) == []
    # 声明了这四项，采集器才会执行本地筛选。
    assert adapter.post_filter_conditions == ("薪资", "经验", "学历", "岗位类型")
    assert adapter.requires_resume is False


@pytest.mark.parametrize(
    ("job_type", "expected_param"),
    [
        ("实习", "jobType=1902"),
        ("社招", "jobType=1901"),
        # 校招在 BOSS 官方筛选里没有对应档（校招是独立专区）——不传参数，
        # 由采集后的本地筛选按接口编码判定。
        ("校招", None),
        ("", None),
    ],
)
def test_job_type_maps_to_official_site_param(job_type, expected_param):
    """实习/社招映射到站点官方 jobType 参数（真实实测的编码）；校招不映射。"""
    adapter = BossAdapter()
    url = adapter.build_search_url(CollectQuery(keywords=["后端"], city="北京", job_type=job_type), 1)
    assert "query=%E5%90%8E%E7%AB%AF" in url
    if expected_param is None:
        assert "jobType" not in url
    else:
        assert expected_param in url


def test_an_adapter_without_the_capability_still_reports_conditions_as_unmapped():
    """没声明本地筛选能力的站点，行为**不能**跟着变——它仍然要如实报「未生效」。

    这条守的是"别把 BOSS 的特例当成所有站点的默认"：能力由适配器声明，
    基类默认是"不支持"。
    """

    class _PlainAdapter(SiteAdapter):
        key = "plain"
        display_name = "示例站点"
        hosts = ("example.com",)

        def risk_profile(self) -> RiskProfile:  # pragma: no cover - 本用例不采集
            return RiskProfile(key=self.key)

        def collect_search(self, client, query, page):  # pragma: no cover
            raise AssertionError

        def open_apply(self, client, job):  # pragma: no cover
            raise AssertionError

        def fill_and_submit(self, client, data, greeting):  # pragma: no cover
            raise AssertionError

    assert _PlainAdapter.post_filter_conditions == ()
    assert _PlainAdapter.requires_resume is True


def test_parse_search_payload_builds_results():
    payload = {
        "items": [
            {"title": "后端开发", "company": "示例科技", "salary": "20-30K", "location": "北京",
             "url": "https://www.zhipin.com/job_detail/1.html"},
            "not a dict",
        ],
        "has_next": True,
    }

    page = parse_search_payload(payload, page=2, unmapped_conditions=["薪资"])

    assert page.page == 2
    assert page.has_next is True
    assert page.unmapped_conditions == ["薪资"]
    assert len(page.results) == 1
    assert page.results[0].title == "后端开发"
    assert page.results[0].source == BOSS_DISPLAY_NAME


def test_parse_search_payload_rejects_a_broken_payload():
    with pytest.raises(SiteFailure) as excinfo:
        parse_search_payload("nope", page=1)
    assert excinfo.value.category == FAILURE_SELECTOR_INVALID


def test_parse_job_detail_reads_the_expected_fields():
    detail = parse_job_detail(
        {"job_title": "后端开发", "company": "示例科技", "description": "职责", "requirements": "要求"}
    )

    assert detail["job_title"] == "后端开发"
    assert detail["requirements"] == "要求"


def test_detect_blocker_prefers_captcha_over_login():
    assert detect_blocker({"captcha": True, "login_required": True}) == "captcha"
    assert detect_blocker({"login_required": True}) == "login"
    assert detect_blocker({}) is None


def test_classify_submit_state_returns_success():
    outcome = classify_submit_state({"success": True}, greeting="您好")

    assert outcome.success is True
    assert outcome.greeting_sent == "您好"


def test_classify_submit_state_maps_captcha_and_login():
    with pytest.raises(SiteFailure) as captcha:
        classify_submit_state({"captcha": True, "url": "u", "title": "t"})
    assert captcha.value.category == FAILURE_CAPTCHA_REQUIRED

    with pytest.raises(SiteFailure) as login:
        classify_submit_state({"login_required": True, "url": "u", "title": "t"})
    assert login.value.category == FAILURE_LOGIN_REQUIRED


def test_classify_submit_state_without_a_marker_is_a_selector_failure_with_diagnostics():
    with pytest.raises(SiteFailure) as excinfo:
        classify_submit_state({"url": "https://x/job", "title": "岗位详情", "matched": 0})

    failure = excinfo.value
    assert failure.category == FAILURE_SELECTOR_INVALID
    assert "https://x/job" in failure.detail
    assert "岗位详情" in failure.detail
    assert "匹配到的控件数：0" in failure.detail
    assert "期望" in failure.detail


def test_selector_diagnostic_includes_actionable_hints():
    text = selector_diagnostic(
        {"url": "https://x/job", "title": "详情", "matched": 3}, "「立即沟通 / 投递」入口"
    )

    assert "https://x/job" in text
    assert "详情" in text
    assert "匹配到的控件数：3" in text
    assert "反馈给维护者" in text
