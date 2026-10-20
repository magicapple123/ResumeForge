# SPDX-License-Identifier: Apache-2.0
"""RF-13：待审变更预检接口（POST /api/resumes/{id}/review/prepare）。

verdict 三态 ok / fact_check_needed / blocked，三把闸门**唯一出自既有实现**
（models/claim 的占位符闸门、grounding helpers 的量化值闸门、services/claims 的
基线闸门）——这里绝不复制第二份准入逻辑。全离线，不调模型。
"""
import inspect

from app.models.claim import ClaimRecord


def _prepare_review(client, resume_id: int, changes: list[dict]):
    return client.post(f"/api/resumes/{resume_id}/review/prepare", json={"changes": changes})


def _create_manual_resume(client) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={
            "title": "预检用简历",
            "content": {
                "name": "张三",
                "summary": "后端开发工程师",
                "experience": [],
                "education": [],
                "campus_experience": [],
                "projects": [],
                "skills": [],
                "awards": [],
            },
        },
    )
    assert response.status_code in (200, 201), response.text
    return response.json()["id"]


def test_review_prepare_requires_existing_resume(client):
    response = _prepare_review(client, 99999, [])
    assert response.status_code == 404


def test_review_verdict_ok_for_plain_text(client):
    resume_id = _create_manual_resume(client)
    response = _prepare_review(
        client,
        resume_id,
        [{"path": "summary", "before": "", "after": "熟悉 Python 与 FastAPI"}],
    )
    assert response.status_code == 200
    results = response.json()["results"]
    assert results[0]["verdict"] == "ok"
    assert results[0]["reasons"] == []


def test_review_flags_unsupported_quantified_value(client):
    """闸门 2：量化结果不在来源资料证据中 → fact_check_needed。"""
    resume_id = _create_manual_resume(client)
    response = _prepare_review(
        client,
        resume_id,
        [{"path": "summary", "before": "", "after": "把转化率提升了 37%"}],
    )
    results = response.json()["results"]
    assert results[0]["verdict"] == "fact_check_needed"
    assert any("37%" in reason for reason in results[0]["reasons"])


def test_review_flags_value_beyond_confirmed_baseline(client, db_session):
    """闸门 3：台账已确认基线里没有的量化结果 → fact_check_needed（即使资料里有）。"""
    resume_id = _create_manual_resume(client)
    db_session.add(
        ClaimRecord(
            title="性能优化",
            subject="某科技公司",
            category="实习/工作",
            source_fact="负责接口性能优化",
            candidate_wording="负责接口性能优化",
            verification_status="已确认",
        )
    )
    db_session.commit()

    response = _prepare_review(
        client,
        resume_id,
        [{"path": "experience.0.description", "before": "", "after": "性能提升 30%"}],
    )
    results = response.json()["results"]
    assert results[0]["verdict"] == "fact_check_needed"
    assert any("基线" in reason for reason in results[0]["reasons"])


def test_review_flags_blocked_wording_from_pending_claim(client, db_session):
    """闸门 3：命中台账未确认的候选表述 → fact_check_needed。"""
    resume_id = _create_manual_resume(client)
    db_session.add(
        ClaimRecord(
            title="夸张表述",
            subject="简历通",
            category="项目经历",
            source_fact="开发了一个简历工具",
            candidate_wording="主导支撑百万级用户的系统架构",
            verification_status="待确认",
        )
    )
    db_session.commit()

    response = _prepare_review(
        client,
        resume_id,
        [
            {
                "path": "projects.0.description",
                "before": "",
                "after": "主导支撑百万级用户的系统架构",
            }
        ],
    )
    results = response.json()["results"]
    assert results[0]["verdict"] == "fact_check_needed"
    assert any("未确认" in reason for reason in results[0]["reasons"])


def test_review_blocks_placeholder(client):
    """闸门 1：含【待补】未完成标记 → blocked（终稿绝对进不去）。"""
    resume_id = _create_manual_resume(client)
    response = _prepare_review(
        client,
        resume_id,
        [{"path": "summary", "before": "", "after": "负责【待补】项目"}],
    )
    results = response.json()["results"]
    assert results[0]["verdict"] == "blocked"
    assert results[0]["reasons"]


def test_review_blocked_outranks_fact_check(client):
    """占位符与量化问题同时存在时，blocked 优先。"""
    resume_id = _create_manual_resume(client)
    response = _prepare_review(
        client,
        resume_id,
        [{"path": "summary", "before": "", "after": "提升了 42%，【待核实】"}],
    )
    results = response.json()["results"]
    assert results[0]["verdict"] == "blocked"


def test_review_gates_are_imported_not_copied():
    """三把闸门唯一出自既有实现：review 路由 import 原函数，不带第二份判定逻辑。"""
    import app.api.resumes.review_routes as module

    source = inspect.getsource(module)
    assert "from ...models.claim import has_placeholder" in source
    assert "from ...services.claims import build_baseline" in source
    # 量化值闸门同样只允许 import 自 grounding helpers（ruff 排序可能合并 import 行，
    # 所以这里按两个片段断言，不钉整行写法）。
    assert "resume_grounding_helpers import" in source
    assert "_unsupported_quantified_values" in source
    # 不允许把判定规则抄进来：正则、标记清单都只能来自原模块。
    assert "_QUANTIFIED_VALUE_RE" not in source
    assert "PLACEHOLDER_MARKERS" not in source
    assert "re.compile" not in source
