# SPDX-License-Identifier: Apache-2.0
"""A4 证书资质：完整性 / 分页 / ATS / 隐私 / 预检链路（从 test_resume_credentials 拆出）。

拆出原因：主文件到 500 行测试文件预算。这组用例只回答"下游质量链路认不认 credentials /
扩展字段"，与主文件的序列化不变性、保存往返、身份、锁是不同的被测面。
"""

from __future__ import annotations

from app.schemas.resume import ResumeContent
from app.services.resume.resume_completeness import find_incomplete
from app.services.resume.resume_pagination import (
    SECTION_KEYS,
    resolve_pagination,
    validate_pagination_domain,
)
from app.services.resume.resume_sections import DEFAULT_SECTION_ORDER
from test_resume_credentials import CREDENTIAL_NAME, ISSUER, _content, _resume


def test_completeness_flags_unfinished_credential_fields():
    data = _content()
    data["credentials"][0]["issuer"] = "颁发机构【待补：机构全称】"
    found = find_incomplete(ResumeContent.model_validate(data))
    assert any("证书资质" in message and "颁发机构" in message for message in found)


def test_pagination_domain_accepts_credentials_section():
    assert SECTION_KEYS == DEFAULT_SECTION_ORDER
    domain = {
        "version": 1,
        "sections": {"credentials": {"break_before": "page"}},
        "entries": {"cred_12345678": {"keep_with_next": 2}},
    }
    kept = validate_pagination_domain(domain)
    assert kept is not None
    assert kept["sections"]["credentials"]["break_before"] == "page"
    plan = resolve_pagination({"pagination": domain})
    assert plan.section("credentials").break_before_page is True


def test_ats_section_texts_include_credentials():
    from app.services.ats_keywords import _SECTION_ORDER, _section_texts

    sections = _section_texts(_resume())
    assert "credentials" in sections
    assert "credentials" in _SECTION_ORDER
    assert CREDENTIAL_NAME in sections["credentials"]
    assert ISSUER in sections["credentials"]


def test_redact_masks_credential_name_and_issuer():
    from app.services.privacy import RedactionOptions, redact

    resume = _resume()
    masked = redact(
        resume,
        RedactionOptions(mask_name=True, mask_school=True, mask_project=True),
    )
    assert masked.credentials[0].name != CREDENTIAL_NAME
    assert masked.credentials[0].issuer != ISSUER
    # 原文不被改动（redact 返回新对象）。
    assert resume.credentials[0].name == CREDENTIAL_NAME


def test_preflight_maps_credential_completeness_to_section():
    from app.services.resume.preflight_rules_content import _section_for

    assert _section_for("证书资质「注册会计师」 颁发机构 里还有「【待补】」") == "credentials"
    assert _section_for("学术成果「论文 A」 题目 里还有「【待补】」") == "publications"
