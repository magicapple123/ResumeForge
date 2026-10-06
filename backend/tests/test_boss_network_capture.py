"""详情响应解析与网络事件/响应体捕获（从 test_boss_network.py 拆出）。

``_search_payload``/``_response_event``/``_body_event`` 定义在主文件（它们同时被
collect 文件与外部消费方 test_sample_recorder 复用），本文件与 collect 文件共用它们。
"""
from app.services.browser.network_capture import (
    MAX_BODY_BYTES,
    collect_bodies,
    first_json_with,
    response_urls,
)
from app.services.sites.boss_network import (
    DETAIL_MARKERS,
    SEARCH_MARKER,
    SEARCH_MARKERS,
    api_error,
    looks_like_detail,
    looks_like_search,
    parse_detail_response,
)
from test_boss_network import _body_event, _response_event, _search_payload

# ===== 详情响应解析 =====


def _detail_payload() -> dict:
    return {
        "zpData": {
            "jobInfo": {
                "jobName": "后端开发实习生",
                "encryptJobId": "abc123",
                "postDescription": "<p>负责接口开发<br>参与联调</p>",
                "jobDegree": "本科",
                "jobExperience": "在校/应届",
                "skills": ["Python", "Redis"],
            },
            "bossInfo": {"activeTimeDesc": "今日活跃", "name": "张女士", "title": "HR"},
            "brandInfo": {"brandName": "示例科技", "brandIndustry": "互联网"},
        }
    }


def test_detail_response_strips_html_and_keeps_the_full_jd():
    parsed = parse_detail_response(_detail_payload())
    assert parsed is not None
    assert parsed["job_title"] == "后端开发实习生"
    assert parsed["company"] == "示例科技"
    # HTML 标签要变成换行，不能把标签本身喂给匹配分析。
    assert "<p>" not in parsed["description"]
    assert "负责接口开发" in parsed["description"]
    assert "参与联调" in parsed["description"]


def test_detail_response_keeps_hr_activity_for_the_filter():
    """HR 活跃时间是"过滤不活跃 HR"唯一可靠的依据，DOM 里拿不到。"""
    parsed = parse_detail_response(_detail_payload())
    assert parsed["extra"]["hr_active_time"] == "今日活跃"
    assert parsed["extra"]["skills"] == ["Python", "Redis"]


def test_detail_response_does_not_duplicate_the_description_into_requirements():
    """接口没有把"任职要求"单列出来；为了凑字段把描述复制一份会让匹配分析读到两份同样文本。"""
    parsed = parse_detail_response(_detail_payload())
    assert parsed["requirements"] == ""


def test_detail_without_a_description_is_not_a_detail():
    """描述为空时这份数据没有价值——如实返回 None，让上层退回 DOM。"""
    payload = {"zpData": {"jobInfo": {"jobName": "岗位", "postDescription": ""}}}
    assert parse_detail_response(payload) is None
    assert looks_like_detail(payload) is False
    assert looks_like_detail({"zpData": {"jobInfo": {"postDescription": "有内容"}}}) is True


def test_detail_parser_accepts_field_aliases():
    """详情侧同样只对**字段**放宽：`postDescription`→`jobDescription`、`activeTimeDesc`→
    `activeDesc` 等仍能读到，但容器（`zpData` / `jobInfo`）与列表侧一样只认原名。"""
    payload = {
        "zpData": {
            "jobInfo": {
                "jobTitle": "后端工程师",
                "encryptId": "detail123",
                "jobDescription": "<p>负责服务端开发</p>",
                "degreeName": "本科",
            },
            "recruiterInfo": {"activeDesc": "刚刚活跃", "recruiterName": "李女士"},
            "brandInfo": {"brandName": "示例公司"},
        }
    }
    parsed = parse_detail_response(payload)
    assert parsed is not None
    assert parsed["job_title"] == "后端工程师"
    assert parsed["company"] == "示例公司"
    assert parsed["description"] == "负责服务端开发"
    assert parsed["extra"]["hr_active_time"] == "刚刚活跃"
    assert looks_like_detail(payload) is True


def test_detail_parser_accepts_brand_com_info():
    payload = {
        "zpData": {
            "jobInfo": {"jobName": "后端工程师", "postDescription": "负责接口开发"},
            "brandComInfo": {"brandName": "新版公司容器"},
        }
    }

    parsed = parse_detail_response(payload)

    assert parsed is not None
    assert parsed["company"] == "新版公司容器"


def test_api_error_recognises_nonzero_code_and_message():
    assert api_error({"code": 19, "message": "参数值错误"}) == ("19", "参数值错误")
    assert api_error({"code": 0, "message": "Success"}) is None
    assert api_error({"data": {"jobs": []}}) is None


# ===== 事件与响应体 =====


def test_response_urls_filter_by_markers_and_keep_order():
    events = [
        _response_event("1", "https://www.zhipin.com/img/logo.png"),
        _response_event("2", f"https://www.zhipin.com{SEARCH_MARKER}?page=1"),
        _response_event("3", f"https://www.zhipin.com{SEARCH_MARKER}?page=2"),
    ]
    urls = response_urls(events, markers=SEARCH_MARKERS)
    # 顺序有意义：页面上同一接口会被调用多次，先回来的通常是我们正要的那份。
    assert urls == [
        f"https://www.zhipin.com{SEARCH_MARKER}?page=1",
        f"https://www.zhipin.com{SEARCH_MARKER}?page=2",
    ]
    assert response_urls(events, markers=DETAIL_MARKERS) == []


def test_loose_markers_survive_an_api_path_rename():
    """站点给接口路径加版本后缀（``joblist.json`` → ``joblistV2.json``）时仍要认得出来。

    以前只认整串路径，改一次命名整条"网络优先"通路就**静默失效**（失败方式是退回 DOM，
    从外面完全看不出来），而 DOM 恰好是最容易被改版打穿的那一层。
    """
    exact = f"https://www.zhipin.com{SEARCH_MARKER}?page=1"
    renamed = "https://www.zhipin.com/wapi/zpgeek/search/joblistV2.json?page=1"
    events = [_response_event("1", exact), _response_event("2", renamed)]

    # 原路径与改版后的路径都要认得出来，且保持出现顺序。
    assert response_urls(events, markers=SEARCH_MARKERS) == [exact, renamed]
    # 两套候选**不能重叠**：列表响应绝不能被当成详情去解析（结构完全不同）。
    assert response_urls(events, markers=DETAIL_MARKERS) == []


def test_collect_bodies_decodes_base64_payloads():
    events = [
        _response_event("1", "https://x" + SEARCH_MARKER),
        _body_event("1", _search_payload(), base64_encoded=True),
    ]
    captured = collect_bodies(events)
    assert len(captured) == 1
    assert captured[0].body["zpData"]["jobList"]


def test_non_json_bodies_are_skipped_silently():
    """抓到 HTML（被风控换成验证页）时不该报错，只是没有可用数据。"""
    events = [
        _response_event("1", "https://x" + SEARCH_MARKER),
        {"method": "Network.getResponseBody", "requestId": "1", "result": {"body": "<html>验证</html>"}},
    ]
    assert collect_bodies(events) == []


def test_oversized_bodies_are_rejected():
    """被注入的探针或图片会返回巨大响应体，解它只会占内存。"""
    huge = "x" * (MAX_BODY_BYTES + 10)
    events = [
        _response_event("1", "https://x" + SEARCH_MARKER),
        {"method": "Network.getResponseBody", "requestId": "1", "result": {"body": huge}},
    ]
    assert collect_bodies(events) == []


def test_first_json_with_takes_the_first_matching_body():
    events = [
        _response_event("1", "https://x" + SEARCH_MARKER),
        _body_event("1", {"无关": True}),
        _response_event("2", "https://x" + SEARCH_MARKER),
        _body_event("2", _search_payload()),
    ]
    captured = collect_bodies(events)
    found = first_json_with(captured, looks_like_search)
    assert found is not None and found["zpData"]["jobList"]
    assert first_json_with(captured, looks_like_detail) is None


def test_a_failing_predicate_does_not_break_the_capture():
    """判定函数自己出错时只是跳过那一条，不该让整次采集挂掉。"""

    def explode(_payload):
        raise RuntimeError("判定函数写错了")

    events = [
        _response_event("1", "https://x" + SEARCH_MARKER),
        _body_event("1", _search_payload()),
    ]
    assert first_json_with(collect_bodies(events), explode) is None
