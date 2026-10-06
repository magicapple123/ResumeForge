"""备份导出与备份包校验测试。

导入/切换数据集的往返验证在 ``test_datasets.py``；这里只管"导出物是否安全"和
"坏包是否被挡住"。
"""
import json
import sqlite3
import zipfile
from contextlib import closing, contextmanager
from pathlib import Path

import pytest
from app.database import engine
from app.models.job import Job
from app.models.setting import LLMConfigRecord
from app.schemas.setting import LLMConfig
from app.services.data_backup import (
    BACKUP_FORMAT_MULTI_DATASET,
    BACKUP_FORMAT_WITH_KEYS,
    DATABASE_MEMBER,
    MANIFEST_MEMBER,
    BackupError,
    ExtraDatabase,
    build_manifest,
    create_backup_archive,
    database_path,
    inspect_archive,
)
from app.services.settings_service import get_llm_config, save_llm_config

# 足够长，保证在几 MB 的文件里做子串搜索不会误命中。
SECRET = "sk-backup-canary-0123456789abcdef"

# 技能表出现之前的那一版 revision，用来伪造一份"旧版本导出的备份"。
PREVIOUS_REVISION = "0006_chat_conversation_flags"


def _database_bytes(archive_path: Path) -> bytes:
    with zipfile.ZipFile(archive_path) as archive:
        return archive.read(DATABASE_MEMBER)


def _manifest(archive_path: Path) -> dict:
    with zipfile.ZipFile(archive_path) as archive:
        return json.loads(archive.read(MANIFEST_MEMBER))


def _config_api_key(archive_path: Path, tmp_path: Path) -> str:
    extracted = tmp_path / "read-config.db"
    extracted.write_bytes(_database_bytes(archive_path))
    with _tweaked_sqlite(extracted) as connection:
        row = connection.execute(
            "SELECT value FROM app_setting WHERE key = 'llm_config'"
        ).fetchone()
    return "" if row is None else json.loads(row[0]).get("api_key", "")


def _export(tmp_path: Path) -> Path:
    return create_backup_archive(engine, tmp_path / "staging")


@contextmanager
def _tweaked_sqlite(database: Path):
    """打开测试库做改动，退出时提交、checkpoint 并**真正关闭**连接。

    备份快照继承生产库的 WAL 文件头（journal_mode=WAL 持久化在文件里），而 WAL
    模式下 ``with sqlite3.connect(...)`` 的语义只是提交不关闭——未 checkpoint 的
    改动仍留在 ``-wal`` 文件里，随后裸读 ``.db`` 字节做篡改会拿到旧内容。
    """
    connection = sqlite3.connect(database)
    try:
        with connection:
            yield connection
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        connection.close()


def _set_revision(database: Path, revision: str) -> None:
    """给测试库补上 ``alembic_version`` 并指定版本。

    测试库是 ``create_all`` 建出来的，没有这张表；而真实导出物里它是存在的，伪造
    旧备份时必须补上，否则"版本"这个维度根本没参与校验。
    """
    with _tweaked_sqlite(database) as connection:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL)"
        )
        connection.execute("DELETE FROM alembic_version")
        connection.execute("INSERT INTO alembic_version VALUES (?)", (revision,))


def _settings_with_key(session, api_key: str = SECRET) -> None:
    save_llm_config(
        session,
        LLMConfig(base_url="https://api.example.com/v1", api_key=api_key, model="test-model"),
    )


def _stored_llm_api_key() -> str:
    """读测试库里 ``llm_config`` 中 Key 的**存储原值**（Windows 上是 DPAPI 密文）。

    勾选"包含 API Key"的导出随包带走的就是这个原值，而不是解密后的明文——按它断言
    有无，在加密与非加密平台上都成立。
    """
    database = database_path(engine)
    with closing(sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)) as connection:
        row = connection.execute(
            "SELECT value FROM app_setting WHERE key = 'llm_config'"
        ).fetchone()
    return "" if row is None else json.loads(row[0]).get("api_key", "")


def test_export_excludes_the_saved_api_key(db_session, tmp_path):
    _settings_with_key(db_session)
    archive = _export(tmp_path)

    assert SECRET.encode() not in _database_bytes(archive)
    # 导出的副本被清空不能影响本机正在用的配置。
    db_session.expire_all()
    assert get_llm_config(db_session).api_key == SECRET


def test_export_excludes_a_key_left_by_a_deleted_config_record(db_session, tmp_path):
    """删除配置记录后，密钥会残留在 SQLite 空闲页里；只 UPDATE 清不掉。

    这是「备份不含密钥」这条承诺的回归闸门：清空必须配合 VACUUM 重建文件。
    """
    record = LLMConfigRecord(name="临时记录", base_url="https://api.example.com/v1", api_key=SECRET)
    db_session.add(record)
    db_session.commit()
    db_session.delete(record)
    db_session.commit()

    archive = _export(tmp_path)

    assert SECRET.encode() not in _database_bytes(archive)


def test_export_blanks_a_masked_record_reference(db_session, tmp_path):
    """配置里保存的是记录引用占位符时，导出应落成空串而不是把占位符带走。"""
    record = LLMConfigRecord(name="引用", base_url="https://api.example.com/v1", api_key="")
    db_session.add(record)
    db_session.commit()
    _settings_with_key(db_session, api_key=f"********:record:{record.id}")

    archive = _export(tmp_path)

    assert _config_api_key(archive, tmp_path) == ""


def test_export_keeps_api_keys_when_the_user_opts_in(db_session, tmp_path):
    """显式勾选"包含 API Key"时，密钥按**存储原值**随包走，格式号升到 3。

    带走的是存储原值（Windows 上是 DPAPI 密文，绑定当前用户与机器），不是解密后的
    明文——备份包是用户可能长期保存或转发的东西，导出不该新造出一份明文密钥。
    """
    _settings_with_key(db_session)
    archive = create_backup_archive(engine, tmp_path / "staging-keys", include_api_keys=True)

    stored = _stored_llm_api_key()
    assert stored
    assert stored.encode() in _database_bytes(archive)
    manifest = _manifest(archive)
    assert manifest["api_key_included"] is True
    assert manifest["format"] == BACKUP_FORMAT_WITH_KEYS

    # 同一份库，默认导出仍然剥离：选择权在用户，默认安全不变。
    default = _export(tmp_path)
    assert stored.encode() not in _database_bytes(default)
    assert _manifest(default)["api_key_included"] is False


def test_export_writes_a_manifest_describing_the_data(db_session, tmp_path):
    db_session.add(Job(title="后端开发", description="职责", requirements="要求"))
    db_session.commit()

    manifest = _manifest(_export(tmp_path))

    # **只带一份数据集的包保持格式 1**：老版本与旧备份的互操作不能因为"加上导出全部数据集"
    # 这件事受影响。带其余数据集时才升到 2（见 test_manifest_marks_the_format_when_datasets_ride_along）。
    assert manifest["format"] == 1
    assert manifest["api_key_included"] is False
    assert manifest["tables"]["job"] == 1
    assert manifest["alembic_revision"]
    # 只有活动数据集时不该出现这一段——它正是"包里还有别的数据集"的声明。
    assert "datasets" not in manifest


def test_manifest_marks_the_format_when_datasets_ride_along(tmp_path):
    """带上其余数据集时必须升到多数据集格式（2）。

    格式号是**给老版本看的信号**：它读不懂 ``datasets/`` 这一段，若还按格式 1 放行，用户会
    以为"恢复成功"，实际那几份数据集根本没被恢复——而这类故障通常很久以后才发现。
    """
    extra = tmp_path / "extra.db"
    extra.write_bytes(b"")

    manifest = build_manifest(
        engine,
        datasets=[
            ExtraDatabase(dataset_id="a" * 16, name="校招线", source=extra).manifest_entry(1)
        ],
    )

    assert manifest["format"] == BACKUP_FORMAT_MULTI_DATASET
    assert manifest["datasets"][0]["name"] == "校招线"
    assert manifest["datasets"][0]["file"] == f"datasets/{'a' * 16}.db"


def test_manifest_marks_the_format_when_keys_ride_along(tmp_path):
    """勾选包含 API Key 的包格式号必须是 3：不认识这个选项的老版本必须明确拒收。

    含密钥的优先级高于"带其余数据集"——两者同时出现时，老版本无论如何都该拿到
    "请先升级"的信号，而不是按自己读得懂的那部分误处理。
    """
    extra = tmp_path / "extra.db"
    extra.write_bytes(b"")

    manifest = build_manifest(
        engine,
        datasets=[
            ExtraDatabase(dataset_id="a" * 16, name="校招线", source=extra).manifest_entry(1)
        ],
        api_key_included=True,
    )

    assert manifest["format"] == BACKUP_FORMAT_WITH_KEYS
    assert manifest["api_key_included"] is True
    assert manifest["datasets"][0]["name"] == "校招线"


def test_inspect_rejects_a_payload_that_is_not_a_zip(tmp_path):
    broken = tmp_path / "broken.zip"
    broken.write_bytes(b"this is not a zip archive")

    with pytest.raises(BackupError, match="不是有效的压缩包"):
        inspect_archive(broken, engine, tmp_path / "staging")


def test_inspect_rejects_an_archive_without_a_manifest(db_session, tmp_path):
    stripped = tmp_path / "no-manifest.zip"
    with zipfile.ZipFile(stripped, "w") as archive:
        archive.writestr(DATABASE_MEMBER, b"sqlite")

    with pytest.raises(BackupError, match="缺少必要内容"):
        inspect_archive(stripped, engine, tmp_path / "staging")


def test_inspect_accepts_an_opt_in_export_with_keys(db_session, tmp_path):
    """勾选包含密钥的导出是合法输入：清单显式声明 true，校验照常通过。"""
    _settings_with_key(db_session)
    archive = create_backup_archive(engine, tmp_path / "staging-keys", include_api_keys=True)

    preview = inspect_archive(archive, engine, tmp_path / "staging")

    assert preview["manifest"]["api_key_included"] is True
    assert preview["manifest"]["format"] == BACKUP_FORMAT_WITH_KEYS


def test_inspect_rejects_a_manifest_without_a_key_declaration(db_session, tmp_path):
    """fail-closed 保留：清单缺了密钥声明就拒收。

    旧的规则是"见到 true 就拒收"；现在 true 是导入侧明确处理的合法声明，但
    **缺失或乱值**仍然拒收——不给"将来格式变更后静默放行读不懂的声明"留门。
    """
    archive = _export(tmp_path)
    tampered = tmp_path / "no-declaration.zip"

    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(tampered, "w") as target:
        for name in source.namelist():
            if name == MANIFEST_MEMBER:
                manifest = json.loads(source.read(name))
                del manifest["api_key_included"]
                target.writestr(name, json.dumps(manifest))
            else:
                target.writestr(name, source.read(name))

    with pytest.raises(BackupError, match="未声明密钥状态"):
        inspect_archive(tampered, engine, tmp_path / "staging")


def test_inspect_rejects_a_database_with_unknown_tables(db_session, tmp_path):
    archive = _export(tmp_path)
    foreign = tmp_path / "foreign.db"
    foreign.write_bytes(_database_bytes(archive))
    with _tweaked_sqlite(foreign) as connection:
        connection.execute("CREATE TABLE cookies (value TEXT)")

    tampered = _replace_member(archive, DATABASE_MEMBER, foreign.read_bytes(), tmp_path / "foreign.zip")

    with pytest.raises(BackupError, match="不认识的数据表"):
        inspect_archive(tampered, engine, tmp_path / "staging")


def test_inspect_rejects_a_newer_revision(db_session, tmp_path):
    archive = _export(tmp_path)
    database = tmp_path / "newer.db"
    database.write_bytes(_database_bytes(archive))
    with _tweaked_sqlite(database) as connection:
        connection.execute("CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32))")
        connection.execute("DELETE FROM alembic_version")
        connection.execute("INSERT INTO alembic_version VALUES ('9999_from_the_future')")

    tampered = _replace_member(archive, DATABASE_MEMBER, database.read_bytes(), tmp_path / "newer.zip")

    with pytest.raises(BackupError, match="更新版本"):
        inspect_archive(tampered, engine, tmp_path / "staging")


def test_inspect_accepts_a_backup_exported_before_the_skill_tables(db_session, tmp_path):
    """旧备份必须仍然能导入。

    备份校验要求包里**包含全部应用表**，所以每加一张表都会悄悄拒收所有旧备份——一次
    加表就等于一次不兼容改动。这里把一份备份改回"技能功能之前"的样子（少两张表、
    revision 退回上一版、清单同步改旧）来钉住校验前的迁移。
    """
    db_session.add(Job(title="旧数据里的岗位", description="职责", requirements="要求"))
    db_session.commit()
    archive = _export(tmp_path)

    old_database = tmp_path / "old.db"
    old_database.write_bytes(_database_bytes(archive))
    with _tweaked_sqlite(old_database) as connection:
        connection.execute("DROP TABLE assistant_skill_file")
        connection.execute("DROP TABLE assistant_skill")
    _set_revision(old_database, PREVIOUS_REVISION)

    manifest = _manifest(archive)
    manifest["alembic_revision"] = PREVIOUS_REVISION
    manifest["tables"].pop("assistant_skill")
    manifest["tables"].pop("assistant_skill_file")
    old_archive = _rebuild_archive(
        archive,
        tmp_path / "old.zip",
        {
            DATABASE_MEMBER: old_database.read_bytes(),
            MANIFEST_MEMBER: json.dumps(manifest).encode(),
        },
    )

    preview = inspect_archive(old_archive, engine, tmp_path / "staging")

    assert preview["database"]["tables"]["job"] == 1
    # 两张新表由迁移补齐（空的），否则表集合校验会把它判成"不是 ResumeForge 的备份"
    assert preview["database"]["tables"]["assistant_skill"] == 0
    assert preview["database"]["tables"]["assistant_skill_file"] == 0


def test_inspecting_an_archive_leaves_no_files_behind(db_session, tmp_path):
    """校验是只读的：临时副本要删掉，迁移前备份更不能落在 staging 里。

    一份待导入的备份会被校验多次，任何残留都会按次数累积成用户磁盘上的垃圾。
    """
    staging = tmp_path / "inspect"

    inspect_archive(_export(tmp_path), engine, staging)

    assert list(staging.iterdir()) == []


def test_inspect_rejects_a_database_that_disagrees_with_its_manifest(db_session, tmp_path):
    """库里写着旧版本、清单却声称是新版本：这包被人动过，不能恢复。"""
    archive = _export(tmp_path)
    database = tmp_path / "rewound.db"
    database.write_bytes(_database_bytes(archive))
    _set_revision(database, PREVIOUS_REVISION)

    tampered = _replace_member(
        archive, DATABASE_MEMBER, database.read_bytes(), tmp_path / "rewound.zip"
    )

    with pytest.raises(BackupError, match="清单与实际数据库内容不一致"):
        inspect_archive(tampered, engine, tmp_path / "staging")


def test_export_rejects_a_memory_database(tmp_path):
    from sqlalchemy import create_engine

    memory_engine = create_engine("sqlite://")
    try:
        with pytest.raises(BackupError, match="不是本地 SQLite 文件"):
            create_backup_archive(memory_engine, tmp_path / "staging")
    finally:
        memory_engine.dispose()


def _replace_member(archive: Path, member: str, payload: bytes, destination: Path) -> Path:
    """一次成型重建压缩包，避免出现重名成员。"""
    return _rebuild_archive(archive, destination, {member: payload})


def _rebuild_archive(archive: Path, destination: Path, replacements: dict[str, bytes]) -> Path:
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(destination, "w") as target:
        for name in source.namelist():
            target.writestr(name, replacements.get(name, source.read(name)))
    return destination
