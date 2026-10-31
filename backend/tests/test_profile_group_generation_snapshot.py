# SPDX-License-Identifier: Apache-2.0
"""F3-B 快照冻结验收（E / R-24 / R-33）：冻结、追溯行、与组变更隔离。

覆盖：
- freeze_generation_snapshot 冻结当前组 scope + 消费快照 + layout（参与分区/条目数/顺序）；
- profile_usage_snapshot 追溯行：组名/参与清单/顺序/两枚修订/layout；task_id 幂等；
  完成时 resume_id 同事务回写、可按 resume 反查；
- 冻结后切组/改名/删组不改本次快照：旧快照的组名/参与清单/条目值保持创建态，
  重新冻结才看到新当前组（R-24/R-33）；
- E（端到端，见文件末尾）：排队/运行中切组、组改名/删除不改变最终正文 hash。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import threading

from app.services.llm.base import BaseLLMProvider
from app.services.resume.generate_snapshot import (
    attach_snapshot_resume,
    build_snapshot_layout,
    consumed_has_content,
    freeze_generation_snapshot,
    persist_generation_snapshot,
    snapshot_for_resume,
    snapshot_for_task,
)
from tests.document_test_support import has_custom_field, legacy_of

WORKSPACE_API = "/api/profile/workspace"
GROUPS_API = "/api/profile/groups"
SECTIONS_API = "/api/profile/sections"
ENTRIES_API = "/api/profile/sections/{section_key}/entries"
CURRENT_GROUP_API = "/api/profile/current-group"


def _post_entry(client, section_key: str, values: dict) -> dict:
    response = client.post(ENTRIES_API.format(section_key=section_key), json={"values": values})
    assert response.status_code == 201, response.text
    return response.json()


def _seed_profile(client) -> dict:
    """用新资料模型造一份最小可生成资料（basic_info + projects + 自建分区）。

    projects 上额外挂一个自定义小字段（C5-B 生成后要补回承载区）；自建分区用来验证
    C2：生成结果里自建大字段独立成栏，不交给模型自由生成。
    """
    _post_entry(
        client,
        "basic_info",
        {"basic_info.name": "张三", "basic_info.phone": "13800000000"},
    )
    mentor = client.post(
        f"{SECTIONS_API}/projects/fields",
        json={"label": "导师姓名", "field_type": "single_line"},
    ).json()
    _post_entry(
        client,
        "projects",
        {
            "projects.name": "简历通",
            "projects.description": "开发简历生成接口",
            mentor["field_id"]: "张伟",
        },
    )
    section = client.post(SECTIONS_API, json={"name": "开源贡献"}).json()
    field = client.post(
        f"{SECTIONS_API}/{section['key']}/fields",
        json={"label": "仓库地址", "field_type": "single_line"},
    ).json()
    _post_entry(client, section["key"], {field["field_id"]: "https://example.com/repo"})
    return {
        "section_key": section["key"],
        "field_id": field["field_id"],
        "mentor_field_id": mentor["field_id"],
    }


def _groups(client) -> dict:
    response = client.get(GROUPS_API)
    assert response.status_code == 200, response.text
    return response.json()


def test_freeze_snapshot_captures_scope_consumed_and_layout(client, db_session):
    custom = _seed_profile(client)
    frozen = freeze_generation_snapshot(db_session)
    consumed = frozen.consumed
    groups = _groups(client)
    default = groups["items"][0]
    assert consumed.group_id == default["group_id"]
    assert consumed.group_name == "默认组"
    assert consumed.is_default is True
    # 自建分区创建时加入当前组，因此参与清单是 13 内置 + 1 自建。
    assert len(consumed.participating_keys) == 14
    assert custom["section_key"] in consumed.participating_keys
    assert consumed.sections.keys() == set(consumed.participating_keys)
    assert len(consumed.section("projects").entries) == 1
    assert len(consumed.section(custom["section_key"]).entries) == 1
    assert consumed_has_content(consumed) is True

    layout = frozen.layout
    assert layout == build_snapshot_layout(consumed)
    assert layout["group_name"] == "默认组"
    assert layout["section_order"] == list(consumed.section_order)
    by_key = {item["key"]: item for item in layout["participating"]}
    assert by_key["projects"]["entry_count"] == 1
    assert by_key[custom["section_key"]]["entry_count"] == 1
    assert by_key[custom["section_key"]]["name"] == "开源贡献"
    # definition_revision 来自 workspace revision；data_revision 是条目 revision 之和。
    assert frozen.definition_revision == consumed.workspace_revision
    assert frozen.data_revision > 0


def test_persist_snapshot_row_is_traceable_and_idempotent(client, db_session):
    _seed_profile(client)
    frozen = freeze_generation_snapshot(db_session)
    row = persist_generation_snapshot(db_session, frozen, task_id=101)
    db_session.commit()
    assert row.group_name == "默认组"
    assert row.group_id == frozen.consumed.group_id
    assert [item["key"] for item in row.participating] == list(frozen.consumed.participating_keys)
    assert row.section_order == list(frozen.consumed.section_order)
    assert row.definition_revision == frozen.definition_revision
    assert row.data_revision == frozen.data_revision
    assert row.layout == frozen.layout
    assert row.resume_id is None
    # 同一 task_id 重复写不新增第二行（结构 UNIQUE 的语义）。
    again = persist_generation_snapshot(db_session, frozen, task_id=101)
    assert again.id == row.id
    # 完成时回写 resume_id，可按 resume 反查；重复回写不再改写。
    assert attach_snapshot_resume(db_session, snapshot_id=row.id, resume_id=42, commit=True)
    assert snapshot_for_resume(db_session, 42).id == row.id
    assert not attach_snapshot_resume(db_session, snapshot_id=row.id, resume_id=43)
    db_session.expire_all()
    assert snapshot_for_task(db_session, 101).resume_id == 42


def test_frozen_snapshot_is_isolated_from_group_changes(client, db_session):
    _seed_profile(client)
    frozen = freeze_generation_snapshot(db_session)
    old_keys = frozen.consumed.participating_keys
    old_values = dict(frozen.consumed.section("projects").entries[0].values)

    # 冻结之后再切组、改名、增删参与清单、改资料：都不应改变已冻结快照。
    groups = _groups(client)
    default_id = groups["default_group_id"]
    created = client.post(GROUPS_API, json={"name": "社招"}).json()
    response = client.put(
        f"{GROUPS_API}/{created['group_id']}/members",
        json={"section_keys": ["projects"], "expected_revision": created["revision"]},
    )
    assert response.status_code == 200, response.text
    workspace = client.get(WORKSPACE_API).json()
    switched = client.put(
        CURRENT_GROUP_API,
        json={
            "group_id": created["group_id"],
            "expected_revision": workspace["workspace_revision"],
        },
    )
    assert switched.status_code == 200, switched.text
    renamed = client.patch(
        f"{GROUPS_API}/{default_id}",
        json={"name": "我的默认组", "expected_revision": groups["items"][0]["revision"]},
    )
    assert renamed.status_code == 200, renamed.text
    _post_entry(client, "projects", {"projects.name": "冻结后的新项目"})

    assert frozen.consumed.group_name == "默认组"  # 冻结时的组名
    assert frozen.consumed.participating_keys == old_keys
    assert dict(frozen.consumed.section("projects").entries[0].values) == old_values
    assert len(frozen.consumed.section("projects").entries) == 1

    # 重新冻结才反映当前组（社招：basic_info + projects，2 个分区）。
    new_frozen = freeze_generation_snapshot(db_session)
    assert new_frozen.consumed.group_id == created["group_id"]
    assert new_frozen.consumed.group_name == "社招"
    assert len(new_frozen.consumed.participating_keys) == 2
    assert len(new_frozen.consumed.section("projects").entries) == 2

    # 追溯行按冻结时的元数据写：组名仍是旧值。
    row = persist_generation_snapshot(db_session, frozen, task_id=None)
    db_session.commit()
    assert row.group_name == "默认组"
    assert [item["key"] for item in row.participating] == list(old_keys)
    assert row.layout["group_name"] == "默认组"


# ===== E：排队/运行中切组、组改名/删除不改变最终正文 hash（R-24/R-33）=====

_FAST_PAYLOAD = {
    "summary": "具备 Python 后端开发经验。",
    "projects": [
        {
            "name": "简历通",
            "role": "核心开发",
            "description": ["开发简历生成接口"],
        }
    ],
    "skills": [{"name": "Python", "level": "熟练"}],
}


class _FastProvider(BaseLLMProvider):
    """立刻产出合法 JSON 的假 Provider（基线生成用）。"""

    async def chat(self, _messages, *, thinking: bool = True):
        raise AssertionError("合法流式 JSON 不应触发修复调用")

    async def stream_chat(self, _messages):
        yield json.dumps(_FAST_PAYLOAD, ensure_ascii=False)


class _GatedProvider(BaseLLMProvider):
    """先停住、等测试完成切组/改名/删组后再产出结果的假 Provider。"""

    started = threading.Event()
    release = threading.Event()

    @classmethod
    def reset(cls) -> None:
        cls.started.clear()
        cls.release.clear()

    async def chat(self, _messages, *, thinking: bool = True):
        raise AssertionError("合法流式 JSON 不应触发修复调用")

    async def stream_chat(self, _messages):
        type(self).started.set()
        while not type(self).release.is_set():
            await asyncio.sleep(0.01)
        yield json.dumps(_FAST_PAYLOAD, ensure_ascii=False)


def _record_content_hash(client, resume_id: int) -> str:
    record = client.get(f"/api/resumes/{resume_id}")
    assert record.status_code == 200, record.text
    content = record.json()["content"]
    return hashlib.sha256(
        json.dumps(content, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def _start_task(client, job_id: int | None) -> dict:
    body = {"job_id": job_id} if job_id is not None else {}
    response = client.post("/api/resumes/generate/tasks", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_group_changes_during_generation_do_not_change_result_or_snapshot(
    client, db_session, monkeypatch
):
    from app.services.resume import resume_generate_runner as runner_module
    from tests.resume_generate_task_support import _configure, _wait_terminal

    _seed_profile(client)
    _configure(client)
    # 用通用简历（不按岗位筛选）保证所有参与分区都进候选，正文内容只由资料与模型输出
    # 决定——这样"切组不改变正文 hash"的断言才是在验证冻结，而不是验证岗位关键词。
    frozen_keys = freeze_generation_snapshot(db_session).consumed.participating_keys

    expected_entry_ids = {item["entry_id"] for item in client.get(WORKSPACE_API).json()["entries"]}
    baseline_calls: list[set[str] | None] = []
    original_baseline = runner_module.build_baseline

    def _recording_baseline(db, *, source_entry_ids=None):
        baseline_calls.append(None if source_entry_ids is None else set(source_entry_ids))
        return original_baseline(db, source_entry_ids=source_entry_ids)

    monkeypatch.setattr(runner_module, "build_baseline", _recording_baseline)
    monkeypatch.setattr(
        runner_module,
        "create_provider",
        lambda resolved: _FastProvider(resolved),
    )
    baseline_task = _start_task(client, None)
    baseline_final = _wait_terminal(client, baseline_task["id"])
    assert baseline_final["status"] == "completed"
    baseline_hash = _record_content_hash(client, baseline_final["resume_id"])

    # 第二次生成：主生成流被闸门停住，期间切组 + 给默认组改名 + 删除当前组。
    _GatedProvider.reset()
    monkeypatch.setattr(
        runner_module,
        "create_provider",
        lambda resolved: _GatedProvider(resolved),
    )
    task = _start_task(client, None)
    assert _GatedProvider.started.wait(timeout=10), "生成线程未在 10s 内开始调用模型"

    groups = _groups(client)
    default_id = groups["default_group_id"]
    created = client.post(GROUPS_API, json={"name": "社招"}).json()
    members = client.put(
        f"{GROUPS_API}/{created['group_id']}/members",
        json={"section_keys": ["projects"], "expected_revision": created["revision"]},
    )
    assert members.status_code == 200, members.text
    workspace = client.get(WORKSPACE_API).json()
    switched = client.put(
        CURRENT_GROUP_API,
        json={
            "group_id": created["group_id"],
            "expected_revision": workspace["workspace_revision"],
        },
    )
    assert switched.status_code == 200, switched.text
    renamed = client.patch(
        f"{GROUPS_API}/{default_id}",
        json={"name": "我的默认组", "expected_revision": groups["items"][0]["revision"]},
    )
    assert renamed.status_code == 200, renamed.text
    # 改过参与清单后组 revision 已推进：删除要用最新 revision。
    deleted = client.request(
        "DELETE",
        f"{GROUPS_API}/{created['group_id']}",
        json={"expected_revision": members.json()["revision"]},
    )
    assert deleted.status_code == 200, deleted.text
    _GatedProvider.release.set()

    final = _wait_terminal(client, task["id"])
    assert final["status"] == "completed"
    # 切组/改名/删组发生在运行中：最终正文逐字节相同（R-33 只影响此后新建）。
    assert _record_content_hash(client, final["resume_id"]) == baseline_hash
    # 再次打开（重新读取）仍逐字节相同。
    assert _record_content_hash(client, final["resume_id"]) == baseline_hash

    record = client.get(f"/api/resumes/{final['resume_id']}").json()
    # D6/§17.3：自定义字段位置以 hint 为准（短字段 trail），在任意 placement 找到即可。
    assert has_custom_field(record["content"], "导师姓名", "张伟"), "生成结果缺少自定义字段"
    legacy = legacy_of(record["content"])
    # C2/R-79：自建大字段独立成栏，内容由服务端确定性写入。
    assert [section.title for section in legacy.custom_sections] == ["开源贡献"]
    # F3 契约 §4：后台任务入口的台账基线带本次快照 entry_id 集合（组外/旧资料不自动带入）。
    assert baseline_calls and all(call == expected_entry_ids for call in baseline_calls), (
        baseline_calls
    )

    # 追溯行来自创建任务时的冻结元数据：旧组名/参与清单，resume_id 已回写。
    db_session.expire_all()
    snapshot = snapshot_for_task(db_session, task["id"])
    assert snapshot is not None
    assert snapshot.resume_id == final["resume_id"]
    assert snapshot.group_name == "默认组"
    assert [item["key"] for item in snapshot.participating] == list(frozen_keys)
    assert snapshot.layout["group_name"] == "默认组"
