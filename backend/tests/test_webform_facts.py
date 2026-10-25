# SPDX-License-Identifier: Apache-2.0
"""回归：补充事实取数已退役（F5 契约 §4），网申改由新模型字段供数。

本文件原先是"补充事实接入网申"的用例。F5 起旧的 profile_fact / 事实字段偏好不再进入
data / catalog / custom_labels（旧表保留、备份继续覆盖，只是不读），因此这里迁移成回归：
1. 旧事实数据不再出现在网申取数里（含凭证编号等私密值），也不再产生 CUSTOM_FACT_ 键；
2. 新模型等价能力：证书资质标题聚合为 professional_cert；证书编号三处不出现；
   语言能力聚合为 language_other；字段隐藏后不参与取数、恢复后旧值回来；
3. 守卫：生产代码不再 import/调用 facts 的取数函数（包出口也不再暴露）。
"""

from __future__ import annotations

import json
import pathlib

from app.services.profile import entry_store, field_preferences
from app.services.webform import build_catalog, build_form_data, build_webform_view


def _seed(db, section_key: str, values: dict[str, str]) -> None:
    entry_store.upsert_entry(db, section_key, values=values)


def _create_fact(client, kind: str, payload: dict) -> dict:
    response = client.post("/api/profile/facts", json={"kind": kind, "payload": payload})
    assert response.status_code == 201, response.text
    return response.json()


def _dumped(data, catalog, labels) -> str:
    return json.dumps(
        {"data": data, "catalog": catalog, "labels": labels}, ensure_ascii=False
    )


def test_retired_facts_no_longer_feed_webform_outputs(client, db_session):
    """旧事实（含看似可映射的证书/语言/奖项）不再进入三处取数输出。"""
    _create_fact(
        client,
        "credential",
        {
            "name": "示例注册工程师",
            "issuer": "示例认证机构",
            "status": "active",
            "credential_number": "SECRET-NUMBER-123",
        },
    )
    _create_fact(
        client,
        "language",
        {"name": "英语", "level": "熟练", "certificate": "CET-6", "score": "560"},
    )
    _create_fact(client, "award", {"name": "示例技能大赛", "date": "2025-06"})

    view = build_webform_view(db_session)
    dumped = _dumped(view.data, view.catalog, view.custom_labels)

    assert "示例注册工程师" not in dumped
    assert "SECRET-NUMBER-123" not in dumped
    assert "示例技能大赛" not in dumped
    assert not [key for key in view.data if key.startswith("CUSTOM_FACT_")]
    assert not [row for row in view.catalog if row.get("group", "").startswith("补充事实")]


def test_new_credentials_feed_professional_cert_without_private_number(db_session):
    _seed(
        db_session,
        "credentials",
        {
            "credentials.title": "信息系统项目管理师",
            "credentials.issuer": "示例认证机构",
            "credentials.credential_number": "SECRET-NUMBER-456",
        },
    )

    view = build_webform_view(db_session)
    dumped = _dumped(view.data, view.catalog, view.custom_labels)

    assert "信息系统项目管理师" in view.data["professional_cert"]
    assert "SECRET-NUMBER-456" not in dumped
    assert "credential_number" not in dumped


def test_new_languages_feed_language_other(db_session):
    _seed(db_session, "languages", {"languages.language": "英语", "languages.level": "CET-6"})
    _seed(db_session, "languages", {"languages.language": "日语", "languages.level": "N2"})

    data = build_form_data(db_session)

    assert "英语" in data["language_other"] and "CET-6" in data["language_other"]
    assert "日语" in data["language_other"]


def test_hidden_field_is_not_exported_and_restores(db_session):
    """迁移自旧事实 hidden 用例：隐藏只看新模型字段偏好；值留在库内、恢复后回来。"""
    _seed(
        db_session,
        "credentials",
        {"credentials.title": "示例资格", "credentials.issuer": "示例颁发机构"},
    )
    field_preferences.patch_preference(
        db_session, "credentials.issuer", section_key="credentials", hidden=True
    )

    hidden_dump = json.dumps(build_form_data(db_session), ensure_ascii=False)
    hidden_catalog = json.dumps(build_catalog(db_session), ensure_ascii=False)
    assert "示例颁发机构" not in hidden_dump
    assert "示例颁发机构" not in hidden_catalog

    field_preferences.patch_preference(
        db_session, "credentials.issuer", section_key="credentials", hidden=False
    )
    restored = json.dumps(build_form_data(db_session), ensure_ascii=False)
    assert "示例颁发机构" in restored


def test_webform_extra_value_wins_over_new_model_aggregation(db_session):
    """网申资料里显式填过的值优先于新模型聚合值（沿用旧"已有资料优先"口径）。"""
    from app.services.webform import extra_profile

    _seed(db_session, "credentials", {"credentials.title": "新模型证书"})
    extra_profile.save_entries(db_session, {"professional_cert": "网申资料证书"})

    assert build_form_data(db_session)["professional_cert"] == "网申资料证书"


def test_production_webform_code_no_longer_references_facts():
    """守卫：生产取数代码不得 import/调用 facts 的取数函数（包出口也不再暴露）。"""
    import re

    from app.services import webform

    pattern = re.compile(
        r"(from\s+\S*facts\s+import|import\s+\S*facts\b|"
        r"(?:fact_catalog_entries|fact_custom_labels|merge_fact_data)\s*\()"
    )
    roots = [
        pathlib.Path(webform.__file__).parent,
        pathlib.Path(webform.__file__).parent.parent.parent / "api" / "webform",
    ]
    offenders: list[str] = []
    for root in roots:
        for path in root.rglob("*.py"):
            if path.name == "facts.py":
                continue
            text = path.read_text(encoding="utf-8")
            if pattern.search(text):
                offenders.append(str(path))
    assert offenders == []
    assert not hasattr(webform, "fact_catalog_entries")
    assert not hasattr(webform, "fact_custom_labels")
    assert not hasattr(webform, "merge_fact_data")
