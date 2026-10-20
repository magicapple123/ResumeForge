# SPDX-License-Identifier: Apache-2.0
"""ATS 本地检测：词库可加载、三类结论、免责声明、接口。"""

from app.models.resume import ResumeRecord
from app.schemas.resume import ResumeContent, ResumeEducation, ResumeExperience, ResumeSkill
from app.services.ats_check import ATS_DISCLAIMER, check_ats, load_keywords


def _resume_record(db_session, **kwargs):
    record = ResumeRecord(
        title=kwargs.get("title", "张三-后端开发工程师"),
        job_title="后端开发工程师",
        company="示例公司",
        content=kwargs.get("content", {"name": "张三"}),
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def test_keyword_library_is_loadable():
    words = load_keywords()
    assert words
    assert "Python" in words
    assert "MySQL" in words


def test_ats_check_includes_disclaimer():
    result = check_ats(ResumeContent())
    assert result.disclaimer == ATS_DISCLAIMER
    assert "不代表真实 ATS 解析结果" in result.disclaimer


def test_ats_check_reports_format_issue():
    resume = ResumeContent(name="", phone="", email="")
    result = check_ats(resume)
    titles = {issue.title for issue in result.issues if issue.category == "format"}
    assert "缺少姓名" in titles
    assert "缺少联系方式" in titles


def test_ats_check_reports_position_issue():
    resume = ResumeContent(name="张三", phone="13800138000", email="a@b.com")
    result = check_ats(resume)
    titles = {issue.title for issue in result.issues if issue.category == "position"}
    assert "缺少求职意向" in titles
    assert "缺少个人总结" in titles
    assert "缺少教育经历" in titles
    assert "缺少技能清单" in titles


def test_ats_check_keyword_coverage_with_jd():
    resume = ResumeContent(name="张三", phone="13800138000", email="a@b.com")
    result = check_ats(resume, jd_text="要求熟悉 Python 和 MySQL")
    assert "Python" in result.missing_keywords
    assert "MySQL" in result.missing_keywords


def test_ats_check_matched_keyword():
    resume = ResumeContent(
        name="张三", phone="13800138000", email="a@b.com", summary="熟悉 Python 后端开发"
    )
    result = check_ats(resume, jd_text="要求熟悉 Python")
    assert "Python" in result.matched_keywords


def test_ats_check_covers_all_three_categories_for_empty_resume():
    resume = ResumeContent()
    result = check_ats(resume)
    categories = {issue.category for issue in result.issues}
    assert categories == {"format", "keyword", "position"}


def test_ats_check_score_is_bounded():
    result = check_ats(ResumeContent())
    assert 0 <= result.score <= 100


def test_ats_check_endpoint_returns_result(client, db_session):
    record = _resume_record(db_session, content={"name": "张三", "summary": "熟悉 Python"})
    response = client.post(
        f"/api/resumes/{record.id}/ats-check", json={"jd_text": "要求熟悉 Python"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["disclaimer"] == ATS_DISCLAIMER
    assert "Python" in data["matched_keywords"]


def test_ats_check_endpoint_404s_for_missing_resume(client):
    response = client.post("/api/resumes/9999/ats-check", json={"jd_text": ""})
    assert response.status_code == 404


# ===== R13：分项分数、JD 抽词、新增格式规则 =====


def _full_resume(**overrides) -> ResumeContent:
    """一份"各处都填好"的简历，便于单独验证某一条新规则，不被缺失项干扰。"""
    payload = {
        "name": "林晓样",
        "phone": "13800001234",
        "email": "linxiaoyang@example.com",
        "job_intent": "后端开发工程师",
        "summary": "3 年后端开发经验，熟悉 Python 与 MySQL",
        "education": [
            ResumeEducation(
                school="示例大学",
                major="计算机",
                degree="本科",
                start_date="2018-09",
                end_date="2022-06",
            )
        ],
        "skills": [ResumeSkill(name="Python", level="熟练")],
    }
    payload.update(overrides)
    return ResumeContent(**payload)


def _titles(result) -> set[str]:
    return {issue.title for issue in result.issues}


def test_subscores_weighted_sum_matches_total_score():
    result = check_ats(
        ResumeContent(name="", phone="138-0000-1234", email="not-an-email"),
        jd_text="熟悉 Python 与 MySQL，负责后端服务开发与性能优化",
    )
    assert set(result.subscores) == {"format", "keyword", "position"}
    expected = round(
        0.4 * result.subscores["format"]
        + 0.4 * result.subscores["keyword"]
        + 0.2 * result.subscores["position"]
    )
    # 加权和必须就是总分（四舍五入误差 ≤1）。
    assert abs(result.score - expected) <= 1


def test_subscores_are_bounded_integers():
    result = check_ats(ResumeContent())
    for value in result.subscores.values():
        assert isinstance(value, int)
        assert 0 <= value <= 100


def test_ats_check_without_jd_uses_library_keywords():
    result = check_ats(_full_resume())
    library = load_keywords()
    assert len(result.keyword_hits) == len(library)
    assert result.matched_keywords
    assert 0.0 <= result.coverage_ratio <= 1.0
    # 覆盖率就是命中数 / 目标词数（无 JD 时目标词 = 词库）。
    assert abs(result.coverage_ratio - len(result.matched_keywords) / len(library)) < 1e-9


def test_keyword_hits_report_count_and_sections():
    result = check_ats(
        _full_resume(summary="熟悉 Python 后端开发", skills=[ResumeSkill(name="Python")]),
        jd_text="要求熟悉 Python",
    )
    hit = next(item for item in result.keyword_hits if item["keyword"] == "Python")
    assert hit["matched"] is True
    assert hit["count"] == 2
    assert "summary" in hit["sections"]
    assert "skills" in hit["sections"]


def test_invalid_phone_and_email_are_reported_with_suggestions():
    result = check_ats(ResumeContent(name="林晓样", phone="138-0000-1234", email="linxiaoyang"))
    titles = _titles(result)
    assert "手机号格式可能不正确" in titles
    assert "邮箱格式可能不正确" in titles
    for issue in result.issues:
        if issue.title in {"手机号格式可能不正确", "邮箱格式可能不正确"}:
            assert issue.severity == "medium"
            assert issue.suggestion.strip()


def test_valid_phone_and_email_are_not_reported():
    result = check_ats(
        ResumeContent(name="林晓样", phone="+8613800001234", email="linxiaoyang@example.com")
    )
    titles = _titles(result)
    assert "手机号格式可能不正确" not in titles
    assert "邮箱格式可能不正确" not in titles


def test_malformed_date_is_low_and_reversed_range_is_high():
    resume = _full_resume(
        education=[
            ResumeEducation(
                school="示例大学",
                start_date="2022-06",
                end_date="2023年6月",
            )
        ],
        experience=[ResumeExperience(company="示例公司", start_date="2023-06", end_date="2022-01")],
    )
    result = check_ats(resume)
    by_title = {issue.title: issue for issue in result.issues}
    assert by_title["日期格式不统一"].severity == "low"
    assert by_title["日期格式不统一"].evidence
    assert by_title["起止时间倒置"].severity == "high"
    assert by_title["起止时间倒置"].suggestion.strip()


def test_open_ended_date_is_accepted():
    resume = _full_resume(
        experience=[ResumeExperience(company="示例公司", start_date="2023-06", end_date="至今")]
    )
    assert "日期格式不统一" not in _titles(check_ats(resume))
    assert "起止时间倒置" not in _titles(check_ats(resume))


def test_long_paragraph_without_line_break_is_reported():
    resume = _full_resume(
        experience=[
            ResumeExperience(company="示例公司", description=["负责后端服务开发与优化" * 12])
        ]
    )
    assert "单条描述过长" in _titles(check_ats(resume))


def test_short_paragraph_is_not_reported():
    resume = _full_resume(
        experience=[
            ResumeExperience(company="示例公司", description=["负责撮合引擎开发，延迟降低 40%"])
        ]
    )
    assert "单条描述过长" not in _titles(check_ats(resume))


def test_missing_quantification_is_reported_when_enough_items():
    resume = _full_resume(
        experience=[
            ResumeExperience(
                company="示例公司",
                description=["负责后端服务开发", "参与接口设计", "维护监控告警"],
            )
        ]
    )
    result = check_ats(resume)
    assert "描述缺少量化" in _titles(result)
    # 量化不足时关键词分项拿不到加分：不应因为"有描述"就白送 10 分。
    assert result.subscores["keyword"] <= 100


def test_quantified_descriptions_bonus_keyword_subscore():
    resume = _full_resume(
        experience=[
            ResumeExperience(
                company="示例公司",
                description=["接口延迟降低 40%", "支撑日均 200 万请求", "覆盖 3 个业务线"],
            )
        ]
    )
    result = check_ats(resume)
    assert "描述缺少量化" not in _titles(result)
    # 3/3 条带数字 → 量化加分拉满，关键词分项至少比"只有扣分"时高 10 分。
    assert result.subscores["keyword"] >= 90


def test_keyword_stuffing_is_reported_as_low():
    stuffed = "Python " * 8
    result = check_ats(_full_resume(summary=stuffed), jd_text="要求熟悉 Python")
    issue = next((item for item in result.issues if item.title == "关键词重复堆砌"), None)
    assert issue is not None
    assert issue.severity == "low"
    assert issue.suggestion.strip()


def test_every_issue_carries_a_suggestion():
    result = check_ats(ResumeContent(), jd_text="熟悉 Python 与 MySQL")
    assert result.issues
    for issue in result.issues:
        assert issue.suggestion.strip(), f"{issue.title} 缺少 suggestion"


def test_keyword_coverage_ratio_for_jd_path_is_fraction_of_target():
    resume = _full_resume(summary="熟悉 Python", skills=[ResumeSkill(name="Python")])
    result = check_ats(resume, jd_text="要求熟悉 Python 与 MySQL")
    assert 0.0 < result.coverage_ratio < 1.0
    assert "Python" in result.matched_keywords
    assert "MySQL" in result.missing_keywords


def test_check_ats_never_returns_negative_scores_even_with_many_issues():
    result = check_ats(ResumeContent(phone="123", email="bad"), jd_text="")
    assert result.score >= 0
    assert all(value >= 0 for value in result.subscores.values())


def test_endpoint_exposes_subscores_and_keyword_hits(client, db_session):
    record = _resume_record(
        db_session, content={"name": "林晓样", "summary": "熟悉 Python", "phone": "13800001234"}
    )
    response = client.post(
        f"/api/resumes/{record.id}/ats-check", json={"jd_text": "要求熟悉 Python"}
    )
    assert response.status_code == 200
    data = response.json()
    assert set(data["subscores"]) == {"format", "keyword", "position"}
    assert data["keyword_hits"][0]["keyword"] == "Python"
    assert data["keyword_hits"][0]["matched"] is True
