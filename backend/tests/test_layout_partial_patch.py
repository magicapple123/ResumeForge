# SPDX-License-Identifier: Apache-2.0
"""``PATCH /api/resumes/{id}/layout`` 的**局部更新**语义。

## 为什么单独一个文件

``ResumeLayoutUpdate`` 的 ``template`` / ``format_name`` / ``page_limit`` / ``font_scale``
都是**带默认值的必填**（``page_limit`` 默认 1）。旧实现无条件拿这四个值拼 ``values``，
于是"只改一项"的请求会把另外三项悄悄写回默认：用户拖一下字号滑杆，``page_limit`` 从
0（不限）变成 1，``format_name`` 从 ``spacious`` 变成空串，界面上没有任何提示。

修复后的判据是 Pydantic v2 的 ``model_fields_set``（"这次请求体解析出了哪些键"）：
**只有带了的键才进 UPDATE**。下面每一条都只断言一件事——没带的字段一个字节都不许变，
带了的字段必须照写（包括显式 0 与显式空串这两个合法的 falsy 值）。
"""

from __future__ import annotations

import pytest

PAGE_LIMIT_UNLIMITED = 0


def _create(client) -> int:
    """建一份手写简历（版式取新建默认值，下面的用例自己设定基线）。"""
    response = client.post(
        "/api/resumes/manual",
        json={
            "title": "局部 PATCH 用例",
            "content": {"name": "张三", "summary": "软件工程本科生。"},
            "job_id": None,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _layout(client, resume_id: int, body: dict):
    return client.patch(f"/api/resumes/{resume_id}/layout", json=body)


def _detail(client, resume_id: int) -> dict:
    response = client.get(f"/api/resumes/{resume_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _baseline(client, resume_id: int) -> dict:
    """把基线版式一次性写全：不限页数 + ``spacious`` 版式 + 标准字号 + classic 模板。

    ``page_limit=0`` 是必需的基线值：它既是"合法的 falsy"，也是这次缺陷最容易暴露的位置
    （旧实现会把它重置成默认的 1）。
    """
    response = _layout(
        client,
        resume_id,
        {
            "template": "classic",
            "format_name": "spacious",
            "page_limit": PAGE_LIMIT_UNLIMITED,
            "font_scale": "standard",
        },
    )
    assert response.status_code == 200, response.text
    body = _detail(client, resume_id)
    # 基线自身成立（否则后面的"没被重置"断言毫无意义）。
    assert body["page_limit"] == PAGE_LIMIT_UNLIMITED
    assert body["format_name"] == "spacious"
    assert body["font_scale"] == "standard"
    assert body["template"] == "classic"
    return body


def test_patching_only_font_scale_keeps_the_other_three(client):
    """缺陷 A 的主用例：只发字号，页数/版式/模板必须原样不动。"""
    resume_id = _create(client)
    _baseline(client, resume_id)

    response = _layout(client, resume_id, {"font_scale": "large"})
    assert response.status_code == 200, response.text

    body = _detail(client, resume_id)
    assert body["font_scale"] == "large"  # 带了的那一项真的写了
    assert body["page_limit"] == PAGE_LIMIT_UNLIMITED  # 旧实现在这里变成 1
    assert body["format_name"] == "spacious"  # 旧实现在这里被清成 ""
    assert body["template"] == "classic"
    # 响应体与库内同源：前端据响应更新本地草稿，两处不能对不上。
    assert response.json()["page_limit"] == PAGE_LIMIT_UNLIMITED


def test_patching_only_page_limit_keeps_template_format_and_font(client):
    resume_id = _create(client)
    _baseline(client, resume_id)

    response = _layout(client, resume_id, {"page_limit": 2})
    assert response.status_code == 200, response.text

    body = _detail(client, resume_id)
    assert body["page_limit"] == 2
    assert body["template"] == "classic"
    assert body["format_name"] == "spacious"
    assert body["font_scale"] == "standard"


def test_explicit_zero_page_limit_still_lands_as_unlimited(client):
    """显式 0 必须照写：不能因为"0 是 falsy"就被当成"没带"。"""
    resume_id = _create(client)
    _layout(client, resume_id, {"page_limit": 2})
    assert _detail(client, resume_id)["page_limit"] == 2

    response = _layout(client, resume_id, {"page_limit": PAGE_LIMIT_UNLIMITED})
    assert response.status_code == 200, response.text
    assert response.json()["page_limit"] == PAGE_LIMIT_UNLIMITED
    assert _detail(client, resume_id)["page_limit"] == PAGE_LIMIT_UNLIMITED


def test_explicit_empty_format_name_still_clears_it(client):
    """显式空串是"清空版式名"，与"没带这个键"是两件事。"""
    resume_id = _create(client)
    _baseline(client, resume_id)

    response = _layout(client, resume_id, {"format_name": ""})
    assert response.status_code == 200, response.text
    assert response.json()["format_name"] == ""
    body = _detail(client, resume_id)
    assert body["format_name"] == ""
    # 清版式名不该顺手动页数与字号。
    assert body["page_limit"] == PAGE_LIMIT_UNLIMITED
    assert body["font_scale"] == "standard"


def test_document_mode_is_written_only_when_sent(client):
    """``document_mode`` 同理：没带就不写库，带了才写。"""
    resume_id = _create(client)
    _baseline(client, resume_id)

    _layout(client, resume_id, {"font_scale": "large"})
    assert _detail(client, resume_id)["document_mode"] == "resume"

    response = _layout(client, resume_id, {"document_mode": "long_cv"})
    assert response.status_code == 200, response.text
    body = _detail(client, resume_id)
    assert body["document_mode"] == "long_cv"
    # 只切模式不重报页数时不动 ``page_limit``（越界值由渲染侧按模式夹紧）。
    assert body["page_limit"] == PAGE_LIMIT_UNLIMITED


def test_expected_revision_mismatch_leaves_every_field_untouched(client):
    """版本不匹配 → 409，且一个字节都不动（含本次"带了的"那一项）。"""
    resume_id = _create(client)
    before = _baseline(client, resume_id)
    stale_revision = int(before["revision"])

    # 先推进一版，让手里的版本号过期。
    _layout(client, resume_id, {"page_limit": 2})
    current = _detail(client, resume_id)
    assert current["page_limit"] == 2

    response = _layout(
        client,
        resume_id,
        {"font_scale": "large", "expected_revision": stale_revision},
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "resume_revision_conflict"

    after = _detail(client, resume_id)
    assert after["font_scale"] == "standard"  # 冲突请求里带的字段也没落
    assert after["page_limit"] == 2
    assert after["revision"] == current["revision"]  # 版本没被推进


def test_expected_revision_match_writes_only_the_sent_field(client):
    """版本匹配时照常局部写：不要为了"安全"退化成整份覆盖。"""
    resume_id = _create(client)
    before = _baseline(client, resume_id)

    response = _layout(
        client,
        resume_id,
        {"font_scale": "small", "expected_revision": int(before["revision"])},
    )
    assert response.status_code == 200, response.text

    body = _detail(client, resume_id)
    assert body["font_scale"] == "small"
    assert body["page_limit"] == PAGE_LIMIT_UNLIMITED
    assert body["format_name"] == "spacious"
    assert int(body["revision"]) == int(before["revision"]) + 1


@pytest.mark.parametrize("body", [{"page_limit": 1}, {"page_limit": 3}])
def test_partial_patch_never_touches_language(client, body):
    """语言这条既有语义不能被"局部 PATCH"改坏：没带就保持。"""
    resume_id = _create(client)
    _layout(client, resume_id, {"language": "en-US"})

    response = _layout(client, resume_id, body)
    assert response.status_code == 200, response.text
    assert _detail(client, resume_id)["language"] == "en-US"
