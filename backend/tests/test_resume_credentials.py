# SPDX-License-Identifier: Apache-2.0
"""A4 资格证照栏目与扩展可选字段：序列化不变性、往返、身份、锁、六格式、模板与质量链路。

**硬要求**（契约 §4）：旧记录没有 credentials / public_url / artifact_type /
experience_kind 这些键 → 序列化后也**不出现键**，否则所有历史交付记录的
source_content_sha256 会整体漂移。本文件第一组用例钉这一条。

证据分工（报告里按此引用）：
- 序列化/指纹：第 1 节；- 往返/coerce/校验：第 2 节；- 身份：第 3 节；
- 锁：第 4 节；- 标签正名：第 5 节；- 六格式与模板：第 6 节；
- 完整性/分页/ATS/隐私/预检：第 7 节；- 长 CV 误拦：第 8 节。
"""

from __future__ import annotations

import json

import pytest
from app.schemas.resume import ResumeContent, ResumeExperience, ResumeProject
from app.schemas.resume_credentials import ResumeCredential
from app.services.resume.document_identity import (
    DocumentIdentityError,
    restore_entry_identity,
    validate_document_ids,
)
from app.services.resume.resume_completeness import find_incomplete
from app.services.resume.resume_content import coerce_resume
from app.services.resume.resume_delivery import canonical_content_sha256
from app.services.resume.resume_labels import (
    credential_status_text,
    experience_kind_text,
    section_title,
)
from app.services.resume.resume_pagination import (
    SECTION_KEYS,
    resolve_pagination,
    validate_pagination_domain,
)
from app.services.resume.resume_sections import DEFAULT_SECTION_ORDER
from pydantic import ValidationError

CREDENTIAL_NAME = "注册信息安全专业人员"
ISSUER = "中国信息安全测评中心"
VERIFY_URL = "https://verify.example.org/cisp"
PROJECT_NAME = "统一网关平台"
PUBLIC_URL = "https://example.com/gateway"
ARTIFACT_TYPE = "开源工具"
LEGACY = {"name": "张三", "job_intent": "后端工程师", "experience": [{"company": "甲公司"}]}

# 旧内容（W14 + A4 之前）dump 的键集合：内容指纹的刻度，少一个多一个都不行。
_LEGACY_DUMP_KEYS = {
    "name",
    "photo",
    "gender",
    "birth_year",
    "phone",
    "email",
    "city",
    "personal_website",
    "github",
    "job_intent",
    "summary",
    "education",
    "experience",
    "campus_experience",
    "projects",
    "skills",
    "awards",
}


def _content() -> dict:
    return {
        **LEGACY,
        "experience": [
            {
                "company": "甲公司",
                "role": "后端工程师",
                "experience_kind": "contract",
                "description": ["负责交易链路"],
            }
        ],
        "projects": [
            {
                "name": PROJECT_NAME,
                "role": "负责人",
                "public_url": PUBLIC_URL,
                "artifact_type": ARTIFACT_TYPE,
                "description": ["统一接入与配额管理"],
            }
        ],
        "credentials": [
            {
                "name": CREDENTIAL_NAME,
                "issuer": ISSUER,
                "issue_date": "2021-06",
                "expiry_date": "2027-06",
                "status": "active",
                "verify_url": VERIFY_URL,
                "note": "状态以颁证机构查询结果为准",
                "id": "cred_12345678",
            }
        ],
    }


def _resume() -> ResumeContent:
    return ResumeContent.model_validate(_content())


# ===== 1. 序列化不变性（旧内容指纹逐字节不变）=====


def test_empty_credentials_list_is_not_serialized():
    dumped = ResumeContent(name="张三").model_dump()
    assert "credentials" not in dumped
    assert len(ResumeContent.model_validate(_content()).model_dump()["credentials"]) == 1


def test_legacy_content_dump_keys_are_unchanged():
    dumped = ResumeContent.model_validate(LEGACY).model_dump()
    assert set(dumped) == _LEGACY_DUMP_KEYS
    # 强断言：旧内容 dump 的**完整结构**（含旧条目字段）一个键都不多。
    assert dumped == {
        "name": "张三",
        "photo": "",
        "gender": "",
        "birth_year": "",
        "phone": "",
        "email": "",
        "city": "",
        "personal_website": "",
        "github": "",
        "job_intent": "后端工程师",
        "summary": "",
        "education": [],
        "experience": [
            {
                "company": "甲公司",
                "role": "",
                "start_date": "",
                "end_date": "",
                "description": [],
            }
        ],
        "campus_experience": [],
        "projects": [],
        "skills": [],
        "awards": [],
    }
    # 指纹与"重新序列化再哈希"一致（旧内容可反复计算，不因新增字段漂移）。
    assert canonical_content_sha256(dumped) == canonical_content_sha256(
        json.loads(json.dumps(dumped, ensure_ascii=False))
    )


def test_optional_project_and_experience_fields_omit_empty_values():
    project = ResumeProject(name="作品").model_dump()
    assert "public_url" not in project and "artifact_type" not in project
    experience = ResumeExperience(company="甲公司").model_dump()
    assert "experience_kind" not in experience
    # None 与空串都算"没设置"。
    explicit = ResumeProject(public_url="", artifact_type="").model_dump()
    assert "public_url" not in explicit and "artifact_type" not in explicit
    with_values = ResumeProject(public_url=PUBLIC_URL, artifact_type=ARTIFACT_TYPE).model_dump()
    assert with_values["public_url"] == PUBLIC_URL
    assert with_values["artifact_type"] == ARTIFACT_TYPE


def test_credential_number_is_never_part_of_the_model():
    """证号默认不进模型/纸面/导出：schema 里根本没有这个字段，未知键被丢弃。"""
    assert "credential_number" not in ResumeCredential.model_fields
    resume = ResumeContent.model_validate(
        {"credentials": [{"name": CREDENTIAL_NAME, "credential_number": "SECRET-2021-001"}]}
    )
    assert "credential_number" not in resume.credentials[0].model_dump()
    dumped = json.dumps(resume.model_dump(), ensure_ascii=False)
    assert "SECRET-2021-001" not in dumped


# ===== 2. 保存往返 / coerce / 协议校验 =====


def test_save_and_read_back_preserves_credentials_and_new_fields(client):
    created = client.post(
        "/api/resumes/manual",
        json={"title": "证照简历", "content": _content(), "job_id": None},
    )
    assert created.status_code == 201, created.text
    detail = client.get(f"/api/resumes/{created.json()['id']}").json()["content"]
    credential = detail["credentials"][0]
    assert credential["name"] == CREDENTIAL_NAME
    assert credential["issuer"] == ISSUER
    assert credential["status"] == "active"
    assert credential["verify_url"] == VERIFY_URL
    assert credential["id"] == "cred_12345678"
    assert detail["projects"][0]["public_url"] == PUBLIC_URL
    assert detail["projects"][0]["artifact_type"] == ARTIFACT_TYPE
    assert detail["experience"][0]["experience_kind"] == "contract"


def test_coerce_keeps_credentials_and_sanitizes_them():
    resume = coerce_resume(
        {
            "name": "张三",
            "credentials": [
                {
                    "name": CREDENTIAL_NAME,
                    "issuer": ISSUER,
                    "status": "active",
                    "verify_url": "javascript:alert(1)",
                    "credential_number": "SECRET-1",
                    "id": "cred_12345678",
                    "hidden": True,
                    "lock_content": True,
                },
                {"name": "已过期证书", "status": "not-a-status"},
            ],
        }
    )
    first = resume.credentials[0]
    assert first.status == "active"
    assert first.verify_url == ""  # 非 http(s) 只清空链接，不丢整条证照
    assert first.id == "cred_12345678"
    assert first.hidden is True
    assert first.lock_content is True
    # 枚举外的状态回落 unknown（不猜成"已取得"）。
    assert resume.credentials[1].status == "unknown"


def test_verify_url_and_public_url_are_http_only():
    assert ResumeCredential(name="x", verify_url="").verify_url == ""
    assert ResumeCredential(name="x", verify_url="https://ok.example/a").verify_url
    for bad in ("javascript:alert(1)", "file:///etc/passwd", "ftp://x/y"):
        with pytest.raises(ValidationError):
            ResumeCredential(name="x", verify_url=bad)
        with pytest.raises(ValidationError):
            ResumeProject(name="x", public_url=bad)


def test_experience_kind_is_whitelisted_on_coerce():
    resume = coerce_resume(
        {
            "experience": [
                {"company": "甲公司", "experience_kind": "contract"},
                {"company": "乙公司", "experience_kind": "bogus"},
            ]
        }
    )
    assert resume.experience[0].experience_kind == "contract"
    assert resume.experience[1].experience_kind == ""


def test_resume_has_content_covers_credentials_only_resumes():
    """只有证照的有效简历不能被"旧六栏"空简历判据误拦（G24 同类）。"""
    from app.services.resume.resume_content import resume_has_content

    only_credentials = ResumeContent.model_validate(
        {"credentials": [{"name": CREDENTIAL_NAME, "status": "pending"}]}
    )
    assert resume_has_content(only_credentials) is True
    assert resume_has_content(ResumeContent(name="张三")) is False


# ===== 3. 身份（W01 稳定 id）=====


def test_credentials_ids_participate_in_identity_validation():
    validate_document_ids(_content())
    broken = _content()
    broken["credentials"][0]["id"] = "bad id"
    with pytest.raises(DocumentIdentityError):
        validate_document_ids(broken)
    duplicate = _content()
    duplicate["credentials"].append({"name": "另一条", "id": "cred_12345678"})
    with pytest.raises(DocumentIdentityError):
        validate_document_ids(duplicate)


def test_restore_entry_identity_backfills_credential_ids():
    """修订/翻译后模型不回显 id 时，按位置回填——否则锁与来源锚点断链。"""
    old = _content()
    new = coerce_resume(
        {"credentials": [{"name": CREDENTIAL_NAME, "status": "active"}]}
    ).model_dump()
    restore_entry_identity(old, new)
    assert new["credentials"][0]["id"] == "cred_12345678"


# ===== 4. 标签正名与锁 =====


def test_credential_status_labels_never_claim_a_valid_qualification():
    assert credential_status_text("unknown", "zh-CN") == "待核实"
    assert credential_status_text("pending", "zh-CN") == "办理中"
    assert credential_status_text("expired", "zh-CN") == "已过期"
    # active 只表示"来源状态在有效期内"，不得写成"有效资格"这类认定。
    assert "有效资格" not in credential_status_text("active", "zh-CN")
    assert credential_status_text("bogus", "zh-CN") == "待核实"
    assert credential_status_text("unknown", "en-US") == "Unverified"
    assert credential_status_text("active", "en-US") == "Active"


def test_credential_and_new_field_labels_are_localized():
    assert section_title("credentials", "zh-CN") == "资格证照"
    assert section_title("credentials", "en-US") == "Certifications"
    assert experience_kind_text("contract", "zh-CN") == "合同制"
    assert experience_kind_text("contract", "en-US") == "Contract"
    assert experience_kind_text("bogus", "zh-CN") == ""


def test_fact_lock_kinds_for_extended_fields():
    from app.services.resume.fact_locks import infer_fact_lock_kind

    assert infer_fact_lock_kind("credentials.0.status") == "status"
    assert infer_fact_lock_kind("credentials.0.issuer") == "institution"
    assert infer_fact_lock_kind("credentials.0.verify_url") == "identifier"
    assert infer_fact_lock_kind("projects.0.public_url") == "identifier"
    assert infer_fact_lock_kind("experience.0.experience_kind") == "status"
    assert infer_fact_lock_kind("projects.0.artifact_type") == "status"


def test_credential_status_lock_rejects_an_upgrade(client, db_session):
    from app.models.resume import ResumeRecord
    from app.services.resume import fact_locks

    resume_id = client.post(
        "/api/resumes/manual", json={"title": "锁测试", "content": _content()}
    ).json()["id"]
    lock = client.post(
        f"/api/provenance/resumes/{resume_id}/fact-locks",
        json={"path": "credentials.0.status", "label": "证照状态"},
    )
    assert lock.status_code == 201, lock.text
    assert lock.json()["kind"] == "status"
    record = db_session.get(ResumeRecord, resume_id)
    upgraded = _content()
    upgraded["credentials"][0]["status"] = "expired"
    violations = fact_locks.validate_fact_locks(db_session, record, upgraded)
    assert any(item.path == "credentials.0.status" for item in violations)


# ===== 6. 完整性 / 分页 / ATS / 隐私 / 预检 =====


def test_completeness_flags_unfinished_credential_fields():
    data = _content()
    data["credentials"][0]["issuer"] = "颁发机构【待补：机构全称】"
    found = find_incomplete(ResumeContent.model_validate(data))
    assert any("资格证照" in message and "颁发机构" in message for message in found)


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

    assert _section_for("资格证照「注册会计师」 颁发机构 里还有「【待补】」") == "credentials"
    assert _section_for("论文「论文 A」 题目 里还有「【待补】」") == "publications"


# ===== 7. 长 CV 不被旧 3 页校验误拦（A4 §8.6）=====


def test_variant_layout_accepts_long_cv_page_limit():
    from app.services.resume.document_variants import _normalize_layout

    # 旧变体没有 document_mode = resume：仍是 1–3 页（旧行为不变）。
    assert _normalize_layout({"page_limit": 3}) == {"page_limit": 3}
    with pytest.raises(ValueError):
        _normalize_layout({"page_limit": 10})
    # 长 CV 变体：10 页合法。
    assert _normalize_layout({"page_limit": 10, "document_mode": "long_cv"}) == {
        "page_limit": 10,
        "document_mode": "long_cv",
    }


def test_version_restore_keeps_long_cv_page_limit(client, db_session):
    from app.models.resume import ResumeRecord

    resume_id = client.post(
        "/api/resumes/manual", json={"title": "长 CV", "content": _content()}
    ).json()["id"]
    record = db_session.get(ResumeRecord, resume_id)
    record.document_mode = "long_cv"
    record.page_limit = 10
    db_session.commit()

    version = client.post(
        f"/api/resumes/{resume_id}/versions", json={"name": "长 CV 版本"}
    )
    assert version.status_code == 201, version.text
    version_id = version.json()["id"]
    detail = client.get(f"/api/resumes/{resume_id}/versions/{version_id}").json()
    assert detail["render_context"]["page_limit"] == 10

    restored = client.post(
        f"/api/resumes/{resume_id}/versions/{version_id}/restore",
        json={"expected_revision": client.get(f"/api/resumes/{resume_id}").json()["revision"]},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["resume"]["page_limit"] == 10
    assert restored.json()["resume"]["document_mode"] == "long_cv"
    # 版本就是 content JSON：恢复回来的正文里证照栏目逐字还在（不是只恢复了版式）。
    assert restored.json()["resume"]["content"]["credentials"][0]["name"] == CREDENTIAL_NAME

# ===== 8. 来源定位（A4：profile-fact:<stable-id>）=====


def test_profile_fact_payload_text_excludes_private_credential_number():
    from app.services.resume.document_provenance_source_text import profile_fact_payload_text

    text = profile_fact_payload_text(
        {
            "name": "注册会计师",
            "issuer": "财政部",
            "credential_number": "SECRET-2021-001",
            "description": ["通过六科", "执业"],
        }
    )
    assert "注册会计师" in text and "财政部" in text and "通过六科" in text
    # 私密证号不参与来源正文（与模型/导出同一条边界）。
    assert "SECRET-2021-001" not in text


def test_profile_fact_source_text_resolves_by_stable_fact_id(db_session):
    from types import SimpleNamespace

    from app.models.profile_fact import ProfileFact
    from app.services.profile.profile_service import get_or_create_profile
    from app.services.resume.document_provenance_source_text import (
        REASON_NOT_FOUND,
        resolve_source_texts,
    )

    profile = get_or_create_profile(db_session)
    fact = ProfileFact(
        fact_id="fact_12345678",
        profile_id=profile.id,
        kind="credential",
        payload={"name": "注册会计师", "issuer": "财政部", "credential_number": "SECRET-1"},
        sort_order=0,
    )
    db_session.add(fact)
    db_session.commit()

    lookup = resolve_source_texts(
        db_session, SimpleNamespace(kind="profile", external_ref="profile-fact:fact_12345678")
    )
    assert lookup.resolvable
    assert "注册会计师" in lookup.candidates[0]
    assert "SECRET-1" not in lookup.candidates[0]

    # 软删 = 按不存在处理（不猜、不复活已删事实）。
    fact.deleted_at = fact.created_at
    db_session.commit()
    deleted = resolve_source_texts(
        db_session, SimpleNamespace(kind="profile", external_ref="profile-fact:fact_12345678")
    )
    assert not deleted.resolvable
    assert deleted.reason == REASON_NOT_FOUND

