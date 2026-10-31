# SPDX-License-Identifier: Apache-2.0
"""数据集导入导出测试：导入校验、单份/整包导出、打包往返与越界包拒收。

2026-10-22（行数预算审计 A3）：从 ``test_api_datasets.py`` 拆出导入导出域；数据集
生命周期（列表 / 创建 / 激活 / 改名 / 删除）留在 ``test_api_datasets.py``，共享辅助
在 ``dataset_api_helpers.py``。
"""

import io
import json
import zipfile
from types import SimpleNamespace

from app.api import datasets as datasets_api
from app.services.data_backup import DATABASE_MEMBER
from dataset_api_helpers import (
    MAIN,
    _add_job,
    _archive_bytes,
    _import,
    _job_titles,
    _list_datasets,
    _stored_llm_api_key,
)
from tests.document_test_support import values


def test_import_requires_a_loopback_client(client, tmp_path, monkeypatch):
    monkeypatch.setattr("app.api.settings._is_loopback_request", lambda _request: False)

    assert _import(client, _archive_bytes(tmp_path)).status_code == 403


def test_import_requires_a_zip_content_type(client, tmp_path):
    """application/zip 不在 CORS 简单请求允许的类型里，跨站页面无法直接触发导入。"""
    response = _import(client, _archive_bytes(tmp_path), content_type="application/json")

    assert response.status_code == 415


def test_import_rejects_a_payload_that_is_not_a_zip(client):
    response = _import(client, b"definitely not a zip archive")

    assert response.status_code == 400
    assert "压缩包" in response.json()["detail"]


def test_import_rejects_a_payload_over_the_configured_limit(client, tmp_path, monkeypatch):
    # 端点在函数内 import get_settings，因此替换 app.config 上的那个即可生效。
    monkeypatch.setattr("app.config.get_settings", lambda: SimpleNamespace(max_backup_upload_mb=0))

    response = _import(client, _archive_bytes(tmp_path))

    assert response.status_code == 413
    assert "过大" in response.json()["detail"]


def test_export_downloads_a_dataset_as_a_zip(client, tmp_path):
    created = _import(client, _archive_bytes(tmp_path)).json()

    response = client.get(f"/api/settings/datasets/{created['id']}/export")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["cache-control"] == "no-store"
    assert response.content[:2] == b"PK"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    # D-A：默认随包带上密钥（格式号 3），用户可显式取消。
    assert manifest["api_key_included"] is True and manifest["format"] == 3


def test_export_includes_api_keys_by_default_and_can_opt_out(client, db_session):
    """默认随包带密钥（D-A）；显式 ``include_api_keys=false`` 才剥离，导入要如实回报。"""
    from app.schemas.setting import LLMConfig
    from app.services.settings_service import save_llm_config

    save_llm_config(
        db_session,
        LLMConfig(
            base_url="https://api.example.com/v1",
            api_key="sk-api-roundtrip-0123456789abcdef",
            model="test-model",
        ),
    )
    stored = _stored_llm_api_key()
    assert stored

    default = client.get(f"/api/settings/datasets/{MAIN}/export")
    assert default.status_code == 200
    with zipfile.ZipFile(io.BytesIO(default.content)) as archive:
        assert stored.encode() in archive.read(DATABASE_MEMBER)
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["api_key_included"] is True and manifest["format"] == 3

    # 显式取消勾选：密钥不出包。
    response = client.get(f"/api/settings/datasets/{MAIN}/export?include_api_keys=false")
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert stored.encode() not in archive.read(DATABASE_MEMBER)
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["api_key_included"] is False

    created = _import(client, default.content, name="带 Key 的备份").json()
    assert created["api_key_included"] is True


def test_a_round_trip_preserves_every_kind_of_content_including_the_trash(
    client, db_session, tmp_path
):
    """导出 → 导入 → 切过去：**每一类**内容都要原样还在，**包括"哪些东西在回收站里"**。

    现有测试只核对了岗位标题这一种实体。而一份备份要真的能"把数据带走"，就得覆盖简历
    （含正文与版式）、资料、台账、投递记录、助手会话与备选岗位。

    尤其是**回收站状态**：如果导出/导入把 `deleted_at` 丢了，用户导入备份后会发现自己
    **删掉的东西又回来了**——而这类差别不专门核对根本发现不了（列表里多一条少一条，
    谁也不会去数）。
    """
    from app.models.assistant import ChatConversation
    from app.models.claim import ClaimRecord
    from app.models.material import CandidateJob, Material
    from app.models.resume import ResumeRecord
    from app.models.tracker import ApplicationTrack

    # ① 每一类都放一条"有辨识度"的数据（用哨兵串，方便导入后核对）。
    _add_job(client, "要留下的岗位")
    trashed = client.post(
        "/api/jobs", json={"title": "要删掉的岗位", "description": "职责", "requirements": "要求"}
    ).json()

    db_session.add_all(
        [
            ResumeRecord(
                title="哨兵简历",
                content={"name": "张三", "summary": "SUMMARY_SENTINEL"},
                template="technical",
                page_limit=2,
                format_config={"accent": "#0f766e"},
            ),
            Material(title="哨兵资料", category="项目", content="MATERIAL_SENTINEL"),
            ClaimRecord(title="哨兵台账", source_fact="CLAIM_SENTINEL"),
            ApplicationTrack(title="哨兵投递", company="某公司", status="applied"),
            ChatConversation(title="哨兵会话"),
            CandidateJob(title="哨兵候选岗位", status="pending"),
        ]
    )
    db_session.commit()

    # ② 删掉一条岗位：它的"已删除"状态也必须一起被带走。
    assert client.delete(f"/api/jobs/{trashed['id']}").status_code == 204

    # ③ 导出当前数据 → 导入成新数据集 → 切过去。
    payload = _archive_bytes(tmp_path)
    created = _import(client, payload, name="闭环备份").json()
    assert client.post(f"/api/settings/datasets/{created['id']}/activate").status_code == 200

    # ④ 逐类核对：活着的还在，删掉的不在列表里、但在回收站里。
    assert _job_titles(client) == {"要留下的岗位"}
    assert "哨兵简历" in {item["title"] for item in client.get("/api/resumes").json()["items"]}
    resume_id = next(
        item["id"]
        for item in client.get("/api/resumes").json()["items"]
        if item["title"] == "哨兵简历"
    )
    rendered = client.get(f"/api/resumes/{resume_id}").json()
    # 正文与版式都要原样带过来（版式丢了的话，导入回来的简历会长得不一样）。
    assert "SUMMARY_SENTINEL" in values(rendered["content"])
    assert rendered["template"] == "technical"
    assert rendered["page_limit"] == 2
    assert rendered["format_config"] == {"accent": "#0f766e"}

    assert "哨兵资料" in {item["title"] for item in client.get("/api/materials").json()}
    assert "哨兵投递" in {item["title"] for item in client.get("/api/tracker").json()["items"]}
    assert "哨兵会话" in {
        item["title"] for item in client.get("/api/assistant/conversations").json()
    }
    assert "哨兵候选岗位" in {item["title"] for item in client.get("/api/candidate-jobs").json()}
    claim_titles = {item["title"] for item in client.get("/api/claims").json().get("items", [])}
    assert "哨兵台账" in claim_titles

    # ⑤ **回收站状态一起被带走**：删掉的那条不该复活，且仍列在回收站里。
    trashed_now = client.get("/api/trash").json()
    assert [item["title"] for item in trashed_now["items"] if item["type"] == "job"] == [
        "要删掉的岗位"
    ]

    # ⑥ 备份里不含明文 API Key（导入的那份同样是"导出产物"，这条顺带再确认一次）。
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["api_key_included"] is False


def test_import_path_is_registered():
    """中间件按 IMPORT_PATH 放宽上限；路由改名会让豁免静默失效，这里把两者绑死。"""
    from app.application import create_app

    assert datasets_api.IMPORT_PATH in set(create_app().openapi()["paths"])


# ===== 导出全部数据集（含其余数据集）=====
#
# 背景：默认导出只带**当前活动**的那一份。用户可能有好几份数据集（给不同求职方向各开一套），
# 只备份活动那份的后果是"以为备份了、其实丢了几份"，而这类故障通常很久以后才发现。


def _other_dataset_with_a_job(client, name: str, title: str) -> str:
    """建一份新数据集、切过去放一个特征岗位、再切回主数据，返回它的 id。"""
    created = client.post("/api/settings/datasets", json={"name": name}).json()
    client.post(f"/api/settings/datasets/{created['id']}/activate")
    _add_job(client, title)
    client.post(f"/api/settings/datasets/{MAIN}/activate")
    return created["id"]


def test_export_all_carries_the_other_datasets(client, tmp_path):
    _add_job(client, "主数据里的岗位")
    other_id = _other_dataset_with_a_job(client, "校招线", "校招专有岗位")

    # 关掉"随包带密钥"（默认开，D-A）后，格式号仍是 4：R16 起整包是**嵌套结构**
    # （每份数据集各是一个完整子包），≤3 的旧版本读不懂，必须明确拒收。
    response = client.get("/api/settings/datasets/export-all?include_api_keys=false")

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
        manifest = json.loads(archive.read("manifest.json"))
    # 外层只有清单、README 与逐份子包，不再有包根的事务库。
    assert names == {
        "manifest.json",
        "README.txt",
        "datasets/main.zip",
        f"datasets/{other_id}.zip",
    }
    assert manifest["format"] == 4
    # R16：整包的"类型"与"格式号"分开——前者给界面介绍用，后者决定老版本能不能读。
    assert manifest["type"] == "collection"
    assert [item["id"] for item in manifest["datasets"]] == [MAIN, other_id]
    assert manifest["datasets"][1]["name"] == "校招线"
    assert all(len(item["sha256"]) == 64 for item in manifest["datasets"])


def test_single_dataset_export_is_typed_as_dataset(client, tmp_path):
    """单份包的 type 是 dataset：界面据此说"一份备份"，不会被当成整包。"""
    _add_job(client, "主数据里的岗位")

    response = client.get(f"/api/settings/datasets/{MAIN}/export?include_api_keys=false")

    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["type"] == "dataset"
    assert manifest["format"] == 1


def test_exporting_one_dataset_stays_format_1(client, tmp_path):
    """关掉密钥随包时，只导一份的格式保持 1——老版本与旧备份的互操作不受影响。"""
    _other_dataset_with_a_job(client, "校招线", "校招专有岗位")

    response = client.get(f"/api/settings/datasets/{MAIN}/export?include_api_keys=false")

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
        manifest = json.loads(archive.read("manifest.json"))
    assert names == {"resume_forge.db", "manifest.json"}
    assert manifest["format"] == 1
    assert "datasets" not in manifest


def test_import_restores_the_packaged_datasets(client, tmp_path):
    """导入一份"全部"包：包里的每一份（含活动那份）都各落成一份新数据集。

    R16 起整包是嵌套结构，活动数据集也以子包形式随包走；导入侧对每份子包单独调用
    同一套导入链路，返回 ``{restored, skipped, failed, summary}``。
    """
    other_id = _other_dataset_with_a_job(client, "校招线", "校招专有岗位")
    payload = client.get("/api/settings/datasets/export-all").content

    response = _import(client, payload, name="整包恢复")

    assert response.status_code == 200
    created = response.json()
    assert created["summary"] == {"restored": 2, "skipped": 0, "failed": 0}
    by_source = {item["source_id"]: item for item in created["restored"]}
    assert set(by_source) == {MAIN, other_id}
    assert by_source[other_id]["name"] == "校招线"  # 名字沿用包里的，用户靠它认人
    # **新 id**：沿用包里的 id 会覆盖本机已有的那份同名 id 的数据集（不可逆）。
    assert by_source[other_id]["id"] not in {MAIN, other_id}
    assert {item["id"] for item in _list_datasets(client)} >= {
        by_source[other_id]["id"],
        other_id,
    }

    # 恢复出来的那份里确实有那个特征岗位。
    client.post(f"/api/settings/datasets/{by_source[other_id]['id']}/activate")
    assert _job_titles(client) == {"校招专有岗位"}


def test_import_rejects_a_packaged_dataset_pointing_outside_datasets(client, tmp_path):
    """**路径是可以被构造的**：改过的包能把 file 指向主库或 ../../，导入必须拒收。"""
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as archive:
        archive.writestr("resume_forge.db", b"")
        archive.writestr(
            "manifest.json",
            json.dumps(
                {
                    "format": 2,
                    "api_key_included": False,
                    "datasets": [{"id": "x", "name": "坏包", "file": "../resume_forge.db"}],
                }
            ),
        )

    response = _import(client, payload.getvalue())

    assert response.status_code == 400
    assert "路径不合法" in response.json()["detail"]
    # 整包失败：不许留下半截的数据集。
    assert {item["id"] for item in _list_datasets(client)} == {MAIN}
