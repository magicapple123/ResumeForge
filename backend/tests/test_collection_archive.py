# SPDX-License-Identifier: Apache-2.0
"""嵌套整包（R16，格式 4）：导出结构、逐份完整性、坏子包隔离与旧格式回归。

钉住的行为：

- ``export_all_datasets`` 的产物是 ``manifest.json + README.txt + datasets/<id>.zip``，
  每份子包是**完整单数据集包**（含自己的清单与库），外层逐份记 sha256/大小；
- 导入整包时逐份核对子包，坏一份只跳过那一份，其余照常恢复；
- 全部子包都坏才整体报错；
- 子包再嵌套（格式 4 套格式 4）直接记错，不递归；
- 格式 2 的旧整包仍走原路径导入（回归）。
"""

import hashlib
import json
import zipfile
from pathlib import Path

import pytest
from app import database
from app.dataset_registry import dataset_database_file
from app.services.data_backup import (
    BACKUP_FORMAT_NESTED_COLLECTION,
    MANIFEST_MEMBER,
    README_MEMBER,
    BackupError,
    ExtraDatabase,
    create_backup_archive,
)
from app.services.data_backup.collection_import import is_nested_collection
from app.services.datasets import export_all_datasets, import_dataset, list_datasets

MAIN = "main"


def _add_job(client, title: str) -> None:
    response = client.post(
        "/api/jobs", json={"title": title, "description": "职责", "requirements": "要求"}
    )
    assert response.status_code in (200, 201)


def _job_titles(client) -> set[str]:
    response = client.get("/api/jobs")
    assert response.status_code == 200
    return {item["title"] for item in response.json()["items"]}


def _two_datasets(client) -> str:
    """主数据一条岗位 + 另一份数据集一条岗位，返回后者的 id。"""
    _add_job(client, "主数据岗位")
    created = client.post("/api/settings/datasets", json={"name": "数据集B"}).json()
    assert client.post(f"/api/settings/datasets/{created['id']}/activate").status_code == 200
    _add_job(client, "数据集B岗位")
    assert client.post("/api/settings/datasets/main/activate").status_code == 200
    return created["id"]


def _outer_manifest(archive_path: Path) -> dict:
    with zipfile.ZipFile(archive_path) as archive:
        return json.loads(archive.read(MANIFEST_MEMBER))


def _import(archive_path: Path, tmp_path: Path) -> dict:
    return import_dataset(archive_path, "整包导入", database.engine, tmp_path / "staging-import")


def _repack(
    source: Path,
    target: Path,
    *,
    replace: dict[str, bytes] | None = None,
    drop: set[str] | None = None,
    update_manifest: bool = True,
) -> Path:
    """重写外层包：替换/删除成员，可选按键同步清单里的 sha256 与大小。

    ``update_manifest=False`` 时清单保持原样——这正是"子包被改动过"的场景。
    """
    replace = replace or {}
    drop = drop or set()
    with zipfile.ZipFile(source) as src:
        manifest = json.loads(src.read(MANIFEST_MEMBER))
        if update_manifest:
            for entry in manifest.get("datasets") or []:
                payload = replace.get(entry["file"])
                if payload is not None:
                    entry["size_bytes"] = len(payload)
                    entry["sha256"] = hashlib.sha256(payload).hexdigest()
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as dst:
            for name in src.namelist():
                if name in drop or name == MANIFEST_MEMBER:
                    continue
                dst.writestr(name, replace.get(name, src.read(name)))
            dst.writestr(MANIFEST_MEMBER, json.dumps(manifest, ensure_ascii=False, indent=2))
    return target


def _sub_member(manifest: dict, dataset_id: str) -> dict:
    return next(item for item in manifest["datasets"] if item["id"] == dataset_id)


# ---------------------------------------------------------------------------
# 导出结构
# ---------------------------------------------------------------------------


def test_export_all_is_a_nested_collection_with_checksums(client, tmp_path):
    extra_id = _two_datasets(client)

    archive = export_all_datasets(database.engine, tmp_path / "staging")

    with zipfile.ZipFile(archive) as outer:
        names = set(outer.namelist())
        manifest = json.loads(outer.read(MANIFEST_MEMBER))
        readme = outer.read(README_MEMBER).decode("utf-8")
        assert names == {
            MANIFEST_MEMBER,
            README_MEMBER,
            "datasets/main.zip",
            f"datasets/{extra_id}.zip",
        }
        assert manifest["format"] == BACKUP_FORMAT_NESTED_COLLECTION == 4
        assert manifest["type"] == "collection"
        assert manifest["app"] and manifest["app_version"] and manifest["exported_at"]
        assert {item["id"] for item in manifest["datasets"]} == {MAIN, extra_id}
        for entry in manifest["datasets"]:
            payload = outer.read(entry["file"])
            assert entry["size_bytes"] == len(payload)
            assert entry["sha256"] == hashlib.sha256(payload).hexdigest()
            assert entry["alembic_revision"]
            assert entry["api_key_included"] is False
            # 子包必须是**完整的单数据集包**（自带清单与库），不是裸库。
            sub_path = tmp_path / f"sub-{entry['id']}.zip"
            sub_path.write_bytes(payload)
            with zipfile.ZipFile(sub_path) as sub:
                assert {MANIFEST_MEMBER, "resume_forge.db"} <= set(sub.namelist())
    assert "数据集B" in readme and "主数据" in readme
    assert "如何导入" in readme
    assert "不包含 API Key" in readme


def test_export_all_marks_api_key_inclusion_when_requested(client, tmp_path):
    _two_datasets(client)

    archive = export_all_datasets(database.engine, tmp_path / "staging", include_api_keys=True)

    manifest = _outer_manifest(archive)
    assert all(item["api_key_included"] is True for item in manifest["datasets"])
    with zipfile.ZipFile(archive) as outer:
        assert "包含 API Key" in outer.read(README_MEMBER).decode("utf-8")


# ---------------------------------------------------------------------------
# 往返与坏子包隔离
# ---------------------------------------------------------------------------


def test_collection_roundtrip_restores_every_dataset(client, tmp_path):
    _two_datasets(client)
    archive = export_all_datasets(database.engine, tmp_path / "staging")

    assert is_nested_collection(archive) is True
    result = _import(archive, tmp_path)

    assert result["summary"] == {"restored": 2, "skipped": 0, "failed": 0}
    # 兼容旧界面的单数据集形状：主数据集 = 导出时活动的那份（这里是 main），
    # 其余成功项进 restored_datasets，界面据此说"另外恢复了 N 份"。
    by_source = {item["source_id"]: item for item in result["restored"]}
    assert result["id"] == by_source["main"]["id"]
    assert result["name"] == "主数据"
    assert [item["name"] for item in result["restored_datasets"]] == ["数据集B"]
    assert result["api_key_included"] is False
    assert result["backup_asset_warnings"] == []
    assert result["asset_issues"] == []
    assert result["assets_incomplete"] is False
    assert result["failed"] == []
    assert {item["source_id"] for item in result["restored"]} == {"main"} | _extra_ids(archive)

    titles = set()
    for item in result["restored"]:
        assert client.post(f"/api/settings/datasets/{item['id']}/activate").status_code == 200
        titles |= _job_titles(client)
    assert titles == {"主数据岗位", "数据集B岗位"}
    # 导入只新增数据集，不覆盖原有那份。
    assert len(list_datasets()) == 4


def _extra_ids(archive: Path) -> set[str]:
    return {item["id"] for item in _outer_manifest(archive)["datasets"]} - {"main"}


def test_collection_result_keeps_lists_and_counts_apart(client, tmp_path):
    """顶层 ``restored/skipped/failed`` 是条目列表，``summary`` 里是**计数**。

    两处字段同名但不是同一种类型：前端按 ``summary`` 报总数、按顶层列表点明细。
    这条断言钉住契约，防止以后有人"统一"成一种类型时静默改掉。
    """
    extra_id = _two_datasets(client)
    archive = export_all_datasets(database.engine, tmp_path / "staging")
    entry = _sub_member(_outer_manifest(archive), extra_id)
    with zipfile.ZipFile(archive) as outer:
        original = outer.read(entry["file"])
    broken = _repack(
        archive,
        tmp_path / "one-broken.zip",
        replace={entry["file"]: b"0" * len(original)},
        update_manifest=False,
    )

    result = _import(broken, tmp_path)

    for key in ("restored", "skipped", "failed"):
        assert isinstance(result[key], list), f"顶层 {key} 必须是条目列表"
        assert type(result["summary"][key]) is int, f"summary.{key} 必须是计数"
        assert result["summary"][key] == len(result[key])
    assert len(result["restored"]) == 1
    assert len(result["failed"]) == 1


def test_tampered_subpackage_fails_alone(client, tmp_path):
    extra_id = _two_datasets(client)
    archive = export_all_datasets(database.engine, tmp_path / "staging")
    manifest = _outer_manifest(archive)
    entry = _sub_member(manifest, extra_id)
    with zipfile.ZipFile(archive) as outer:
        original = outer.read(entry["file"])
    tampered = _repack(
        archive,
        tmp_path / "tampered.zip",
        replace={entry["file"]: b"0" * len(original)},
        update_manifest=False,
    )

    result = _import(tampered, tmp_path)

    assert result["summary"]["restored"] == 1
    assert result["summary"]["failed"] == 1
    assert [item["id"] for item in result["failed"]] == [extra_id]
    assert "SHA-256" in result["failed"][0]["error"]
    assert [item["source_id"] for item in result["restored"]] == ["main"]


def test_missing_subpackage_fails_alone(client, tmp_path):
    extra_id = _two_datasets(client)
    archive = export_all_datasets(database.engine, tmp_path / "staging")
    entry = _sub_member(_outer_manifest(archive), extra_id)
    partial = _repack(
        archive,
        tmp_path / "missing.zip",
        drop={entry["file"]},
        update_manifest=False,
    )

    result = _import(partial, tmp_path)

    assert result["summary"] == {"restored": 1, "skipped": 0, "failed": 1}
    assert result["failed"][0]["id"] == extra_id
    assert "缺少" in result["failed"][0]["error"]


def test_all_subpackages_broken_raises(client, tmp_path):
    _two_datasets(client)
    archive = export_all_datasets(database.engine, tmp_path / "staging")
    manifest = _outer_manifest(archive)
    with zipfile.ZipFile(archive) as outer:
        replace = {
            entry["file"]: b"0" * len(outer.read(entry["file"])) for entry in manifest["datasets"]
        }
    broken = _repack(archive, tmp_path / "broken.zip", replace=replace, update_manifest=False)

    with pytest.raises(BackupError) as excinfo:
        _import(broken, tmp_path)

    assert "全部恢复失败" in str(excinfo.value)
    # 一份也没落盘。
    assert len(list_datasets()) == 2


def test_nested_subpackage_is_rejected_without_recursion(client, tmp_path):
    _two_datasets(client)
    archive = export_all_datasets(database.engine, tmp_path / "staging")
    entry = _sub_member(_outer_manifest(archive), "main")
    # 子包内容换成**整包自身**（又是格式 4），并同步清单里的 sha256/大小。
    doubled = _repack(
        archive,
        tmp_path / "doubled.zip",
        replace={entry["file"]: archive.read_bytes()},
        update_manifest=True,
    )

    result = _import(doubled, tmp_path)

    assert result["summary"]["restored"] == 1
    assert [item["id"] for item in result["failed"]] == ["main"]
    assert "不支持嵌套的嵌套" in result["failed"][0]["error"]


# ---------------------------------------------------------------------------
# 旧格式回归
# ---------------------------------------------------------------------------


def test_legacy_format_two_archive_still_imports(client, tmp_path):
    """格式 2（活动库 + datasets/<id>.db 平铺）继续走原路径。"""
    extra_id = _two_datasets(client)
    extra_file = dataset_database_file(extra_id)
    legacy = create_backup_archive(
        database.engine,
        tmp_path / "legacy",
        extra_databases=[ExtraDatabase(dataset_id=extra_id, name="数据集B", source=extra_file)],
    )

    assert is_nested_collection(legacy) is False
    assert _outer_manifest(legacy)["format"] == 2
    result = _import(legacy, tmp_path)

    assert result["id"]
    assert [item["name"] for item in result.get("restored_datasets", [])] == ["数据集B"]


def test_old_collection_without_sha256_still_imports(client, tmp_path):
    """更早版本导出的整包清单里没有 ``sha256``：视为"无校验"，照样能恢复。

    这份备份是用户手上唯一的一份数据，因为"我们后来给清单补了个字段"就拒收，等于让
    他永远打不开自己的备份。但只要清单**写了**摘要，就必须核对——所以这条用例同时钉住
    "没有摘要"与"摘要写错"是两种完全不同的处置。
    """
    extra_id = _two_datasets(client)
    archive = export_all_datasets(database.engine, tmp_path / "staging")
    with zipfile.ZipFile(archive) as outer:
        manifest = json.loads(outer.read(MANIFEST_MEMBER))
        payloads = {entry["file"]: outer.read(entry["file"]) for entry in manifest["datasets"]}
    for entry in manifest["datasets"]:
        # 模拟"摘要字段还没有被引入"的那一版清单。
        entry.pop("sha256", None)
    legacy = tmp_path / "no-sha256.zip"
    with zipfile.ZipFile(legacy, "w", zipfile.ZIP_DEFLATED) as dst:
        for name, payload in payloads.items():
            dst.writestr(name, payload)
        dst.writestr(MANIFEST_MEMBER, json.dumps(manifest, ensure_ascii=False, indent=2))

    result = _import(legacy, tmp_path)

    assert result["summary"] == {"restored": 2, "skipped": 0, "failed": 0}
    assert {item["source_id"] for item in result["restored"]} == {"main", extra_id}


def test_malformed_sha256_is_still_rejected(client, tmp_path):
    """"没有摘要"放行，但"摘要写错了"必须拒收——两者不是同一件事。"""
    _two_datasets(client)
    archive = export_all_datasets(database.engine, tmp_path / "staging")
    with zipfile.ZipFile(archive) as outer:
        manifest = json.loads(outer.read(MANIFEST_MEMBER))
        payloads = {entry["file"]: outer.read(entry["file"]) for entry in manifest["datasets"]}
    manifest["datasets"][0]["sha256"] = "not-a-digest"
    broken = tmp_path / "bad-digest.zip"
    with zipfile.ZipFile(broken, "w", zipfile.ZIP_DEFLATED) as dst:
        for name, payload in payloads.items():
            dst.writestr(name, payload)
        dst.writestr(MANIFEST_MEMBER, json.dumps(manifest, ensure_ascii=False, indent=2))

    with pytest.raises(Exception, match="校验字段不合法"):
        _import(broken, tmp_path)


def test_restored_subpackages_survive_a_later_failure(client, tmp_path):
    """E19：坏子包隔离的**另一半**——已恢复的那一份不能被后来的失败收回。

    上一条只断言"返回值里有 main"。返回值是服务层生成的，和"数据真的留在库里"是两件事：
    旧的 ``discard_created_datasets()`` 式全量回滚会让返回值说成功、库里却没有
    （或反过来）。这里把已恢复的数据集**真的切过去读一次**，钉住"成功就是成功"。
    """
    extra_id = _two_datasets(client)
    archive = export_all_datasets(database.engine, tmp_path / "staging")
    before_ids = {item["id"] for item in list_datasets()}
    entry = _sub_member(_outer_manifest(archive), extra_id)
    with zipfile.ZipFile(archive) as outer:
        original = outer.read(entry["file"])
    tampered = _repack(
        archive,
        tmp_path / "wrong-size.zip",
        replace={entry["file"]: b"0" * (len(original) - 1)},
        update_manifest=False,
    )

    result = _import(tampered, tmp_path)

    assert result["summary"] == {"restored": 1, "skipped": 0, "failed": 1}
    restored_id = result["restored"][0]["id"]
    # 真的存在、真的可用：切到它之后能读到主数据里那条岗位。
    assert restored_id in {item["id"] for item in list_datasets()}
    assert client.post(f"/api/settings/datasets/{restored_id}/activate").status_code == 200
    assert _job_titles(client) == {"主数据岗位"}
    # 失败的那一份没有留下半个数据集：新增的 id 只有成功那一份。
    after_ids = {item["id"] for item in list_datasets()}
    assert after_ids - before_ids == {restored_id}
    assert result["failed"][0]["name"] == "数据集B"
    assert result["failed"][0]["error"]


# ---------------------------------------------------------------------------
# QA 补第二轮：老包（清单里没有 sha256）的**容差边界**
# ---------------------------------------------------------------------------


def _repack_manifest(source: Path, target: Path, mutate) -> Path:
    """重写外层包，让用例直接改清单条目（成员字节由 ``mutate`` 决定）。"""
    with zipfile.ZipFile(source) as src:
        manifest = json.loads(src.read(MANIFEST_MEMBER))
        payloads = {name: src.read(name) for name in src.namelist() if name != MANIFEST_MEMBER}
    mutate(manifest, payloads)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as dst:
        for name, payload in payloads.items():
            dst.writestr(name, payload)
        dst.writestr(MANIFEST_MEMBER, json.dumps(manifest, ensure_ascii=False, indent=2))
    return target


def test_old_collection_without_sha256_still_checks_the_size(client, tmp_path):
    """"没有摘要"只免掉**内容**核对，字节数照样要核。

    放宽 sha256 的那次改动很容易顺手把大小核对一起放过（"反正没摘要，就都不管了"），
    而大小是唯一还能挡住"文件被截断/换错了一份"的东西：截断的子包解出来会是一份坏 zip，
    报错点会飘到子包内部（"元信息已损坏"），用户根本看不出是哪一步出的问题。
    """
    extra_id = _two_datasets(client)
    archive = export_all_datasets(database.engine, tmp_path / "staging")
    with zipfile.ZipFile(archive) as outer:
        manifest = json.loads(outer.read(MANIFEST_MEMBER))
        entry = _sub_member(manifest, extra_id)
        original = outer.read(entry["file"])

    def mutate(mf: dict, payloads: dict[str, bytes]) -> None:
        for item in mf["datasets"]:
            item.pop("sha256", None)  # 更早版本导出的清单
        payloads[entry["file"]] = original[:-64]  # 但这一份内容被截短了

    legacy = _repack_manifest(archive, tmp_path / "legacy-truncated.zip", mutate)

    result = _import(legacy, tmp_path)

    assert result["summary"] == {"restored": 1, "skipped": 0, "failed": 1}
    assert [item["id"] for item in result["failed"]] == [extra_id]
    assert "字节数" in result["failed"][0]["error"] or "大小" in result["failed"][0]["error"]
    assert [item["source_id"] for item in result["restored"]] == ["main"]


def test_empty_sha256_string_counts_as_no_digest(client, tmp_path):
    """``"sha256": ""``（字段在、值为空）与"字段不存在"同处置。

    导出侧从来不会写空串，但手工拼过的包、或者某次 JSON 序列化把 ``None`` 写成 ``""``
    的第三方工具会产生这种清单。把它判成"摘要格式错误"会让整包被拒收——而整包拒收是
    "用户打不开自己唯一的备份"那个后果，代价远高于"这一份不做内容校验"。
    """
    _two_datasets(client)
    archive = export_all_datasets(database.engine, tmp_path / "staging")

    def mutate(mf: dict, _payloads: dict[str, bytes]) -> None:
        for item in mf["datasets"]:
            item["sha256"] = ""

    legacy = _repack_manifest(archive, tmp_path / "empty-digest.zip", mutate)

    result = _import(legacy, tmp_path)

    assert result["summary"] == {"restored": 2, "skipped": 0, "failed": 0}
    assert result["failed"] == []


def test_old_collection_still_requires_size_bytes(client, tmp_path):
    """``size_bytes`` 从第一个版本就有：放宽 sha256 时不能把它一起放宽掉。

    大小是"清单说了多少字节"的唯一登记，没有它连"文件被换过"都发现不了。缺字段属于
    清单不合法 → 整包拒收，且**一份也不写**（此时还在写任何数据之前）。
    """
    _two_datasets(client)
    archive = export_all_datasets(database.engine, tmp_path / "staging")

    def mutate(mf: dict, _payloads: dict[str, bytes]) -> None:
        for item in mf["datasets"]:
            item.pop("sha256", None)
            item.pop("size_bytes", None)

    legacy = _repack_manifest(archive, tmp_path / "no-size.zip", mutate)

    with pytest.raises(BackupError, match="成员路径或校验字段不合法"):
        _import(legacy, tmp_path)
    assert len(list_datasets()) == 2, "清单不合法时不该写入任何数据集"
