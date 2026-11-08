# SPDX-License-Identifier: Apache-2.0
"""RAG v2 备份/迁移验收（计划 §8「备份和迁移测试」清单）。

本批的 RAG 只新增**进程内**向量缓存，不新增数据库表、迁移、资产目录或旁车文件。这里
把"没有新增持久结构"与"没有它也能活"钉成守卫：

1. 表覆盖快照 / 模型注册表 / 资产类别 / RUNTIME_ONLY / uncovered 扫描里都没有 RAG 结构，
   编码之后数据目录里的顶层项也不增加（向量不落盘）；
2. 没有向量结构时导出→导入一次真实往返仍可用，且导入出的数据集里没有向量表；
3. RAG 开启（fake provider）且没有任何模型/缓存文件时，仍能完成一次候选构造；模型不可
   用（未知 provider）时自动回退关键词链，候选与"从未启用 RAG"逐字节一致；
4. 索引是进程内缓存：清空或换一个新索引（等价于进程重启）后重新编码即可恢复，不依赖
   任何持久化文件。

全部使用 fake embedding provider：不联网、不调真实 LLM、不读写真实 data/**。
"""

from __future__ import annotations

import json
import sqlite3
import zipfile
from pathlib import Path
from typing import Any

from app.config import Settings
from app.database import engine
from app.database_migrations import application_tables
from app.dataset_registry import dataset_database_file
from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.services.data_backup import (
    MANIFEST_MEMBER,
    asset_categories,
    create_backup_archive,
    database_path,
)
from app.services.data_backup.coverage import COVERED_DIRECTORIES, RUNTIME_ONLY
from app.services.datasets import import_dataset, list_datasets
from app.services.llm.embeddings import (
    FakeEmbeddingProvider,
    create_embedding_provider,
    resolve_embedding_spec,
)
from app.services.profile.profile_relevance import build_targeted_consumed_profile_context
from app.services.rag.rag_index import RagIndex
from app.services.rag.rag_seam import selection_scope
from app.services.rag.rag_service import prepare_selection_boost
from tests.test_profile_relevance import make_job

TABLE_SNAPSHOT = Path(__file__).parent / "fixtures" / "backup_table_snapshot.json"
# 粗粒度的"RAG 结构"识别词：本批任何持久结构都不该命中这些前缀/词根。
_RAG_TOKENS = ("rag", "vector", "embedding")


def _looks_like_rag(name: Any) -> bool:
    lowered = str(name or "").casefold()
    return any(token in lowered for token in _RAG_TOKENS)


def _data_root() -> Path:
    return database_path(engine).parent


def _root_listing() -> list[str]:
    """数据目录顶层项（只 stat 名字）：用来证明编码不往盘上写任何东西。"""
    return sorted(path.name for path in _data_root().iterdir())


def _read_manifest(archive: Path) -> dict:
    with zipfile.ZipFile(archive) as handle:
        return json.loads(handle.read(MANIFEST_MEMBER))


# ===== 纯 DTO 资料 =====


def _spec(
    field_id: str,
    key: str,
    label: str,
    *,
    field_type: str = "single_line",
) -> ConsumedFieldSpec:
    return ConsumedFieldSpec(field_id, key, label, field_type, 1, True, True, False, True)


def _entry(entry_id: str, values: dict[str, str]) -> ConsumedEntry:
    return ConsumedEntry(entry_id, 0, values)


def _section(
    key: str,
    name: str,
    fields: list[ConsumedFieldSpec],
    entries: list[ConsumedEntry],
) -> ConsumedSection:
    return ConsumedSection(key, name, "multi", None, False, None, tuple(fields), tuple(entries))


def _profile() -> ConsumedProfile:
    experiences = _section(
        "experiences",
        "实习/工作经历",
        [
            _spec("experiences.company", "company", "公司"),
            _spec("experiences.description", "description", "描述", field_type="multi_line"),
        ],
        [
            _entry(
                "e1",
                {
                    "experiences.company": "甲公司",
                    "experiences.description": "负责后端服务与检索接口开发",
                },
            ),
            _entry(
                "e2",
                {"experiences.company": "乙公司", "experiences.description": "负责活动策划与运营"},
            ),
        ],
    )
    projects = _section(
        "projects",
        "项目经历",
        [
            _spec("projects.name", "name", "项目名"),
            _spec("projects.description", "description", "描述", field_type="multi_line"),
        ],
        [
            _entry("p1", {"projects.name": "检索平台", "projects.description": "实现检索与缓存"}),
            _entry("p2", {"projects.name": "活动页面", "projects.description": "策划活动页面"}),
        ],
    )
    skills = _section(
        "skills",
        "专业技能",
        [_spec("skills.name", "name", "技能")],
        [_entry("s1", {"skills.name": "Python"})],
    )
    section_list = (experiences, projects, skills)
    return ConsumedProfile(
        group_id="g-backup",
        group_name="备份测试组",
        is_default=False,
        participating_keys=tuple(section.key for section in section_list),
        section_order=tuple(section.key for section in section_list),
        workspace_revision=5,
        sections={section.key: section for section in section_list},
    )


def _job() -> Any:
    return make_job("后端开发工程师", "负责后端服务与检索接口开发。", "熟悉 Python 与缓存。")


def _settings(**overrides: Any) -> Settings:
    return Settings(
        rag_retrieval_enabled=True,
        rag_embedding_provider="fake",
        rag_embedding_model="fake-embedding-v1",
        rag_embedding_dim=8,
        **overrides,
    )


# ===== 1. 没有新增表 / 资产目录 / 磁盘结构 =====


async def test_rag_adds_no_tables_or_disk_directories(tmp_path):
    root_before = _root_listing()
    scope = await prepare_selection_boost(
        _profile(), _job(), settings=_settings(), index=RagIndex()
    )
    assert scope.fallback_reason == "" and scope.boost  # 前置：确实完成了一次编码
    # 向量是进程内缓存：编码之后数据目录顶层项一个都没多出来。
    assert _root_listing() == root_before

    # 冻结表快照（独立于模型的第二份事实）与模型注册表都不含 RAG/向量表。
    frozen = json.loads(TABLE_SNAPSHOT.read_text(encoding="utf-8"))
    assert frozen["tables"], "前置：冻结快照必须非空"
    assert not [name for name in frozen["tables"] if _looks_like_rag(name)]
    assert not [name for name in application_tables() if _looks_like_rag(name)]
    # v3 起本地权重/运行时是**按需下载、可重建**的运行产物，必须显式登记进
    # RUNTIME_ONLY（不进备份、也不落 uncovered 噪音）；资产类别/覆盖目录仍不得含 RAG。
    assert {"rag-model", "rag-runtime"} <= set(RUNTIME_ONLY)
    assert not [name for name in asset_categories.ASSET_CATEGORIES if _looks_like_rag(name)]
    assert not [name for name in COVERED_DIRECTORIES if _looks_like_rag(name)]

    archive = create_backup_archive(engine, tmp_path / "staging")
    manifest = _read_manifest(archive)
    assert not [name for name in manifest["tables"] if _looks_like_rag(name)]
    uncovered = [item["name"] for item in manifest["uncovered"]]
    assert not [name for name in uncovered if _looks_like_rag(name)]
    # 数据目录里也不存在"既未登记也未被兜底扫描报出"的 RAG 结构。
    assert not [name for name in _root_listing() if _looks_like_rag(name)]


# ===== 2. 无向量结构时导出/导入仍可用 =====


def test_export_and_import_work_without_vector_structure(tmp_path):
    archive = create_backup_archive(engine, tmp_path / "staging")
    manifest = _read_manifest(archive)
    assert manifest["tables"], "前置：备份清单必须带表行数快照"
    assert not [name for name in manifest["tables"] if _looks_like_rag(name)]

    result = import_dataset(archive, "无向量索引恢复", engine, tmp_path / "import")
    assert result["id"]
    assert result["id"] in {item["id"] for item in list_datasets()}

    imported = dataset_database_file(result["id"])
    assert imported.exists()
    connection = sqlite3.connect(imported)
    try:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    finally:
        connection.close()
    # 恢复出来的库与导出侧一样：没有向量表/索引（本批不新增任何持久结构）。
    assert not [name for name in tables if _looks_like_rag(name)]


# ===== 3. 模型不可用时启动/回退 =====


async def test_rag_enabled_without_model_or_cache_files_still_builds_candidates():
    consumed = _profile()
    job = _job()
    settings = _settings()
    root_before = _root_listing()
    # fake provider 是确定性 hash 向量：不需要下载/加载任何模型文件。
    spec = resolve_embedding_spec(settings)
    assert spec is not None and spec.provider == "fake"
    assert isinstance(create_embedding_provider(spec), FakeEmbeddingProvider)

    scope = await prepare_selection_boost(consumed, job, settings=settings, index=RagIndex())
    assert scope.fallback_reason == "" and scope.boost
    with selection_scope(scope):
        selection = build_targeted_consumed_profile_context(consumed, job)
    assert selection.data["experiences"] and selection.data["projects"]
    assert _root_listing() == root_before  # 没有模型/索引文件落盘

    # 模型不可用（未知 provider）→ 自动回退关键词链，候选与"从未启用 RAG"逐字节一致。
    unavailable = Settings(
        rag_retrieval_enabled=True,
        rag_embedding_provider="unknown",
        rag_embedding_model="unknown",
    )
    fallback = await prepare_selection_boost(consumed, job, settings=unavailable, index=RagIndex())
    assert fallback.fallback_reason == "not_configured" and not fallback.boost
    plain = build_targeted_consumed_profile_context(consumed, job)
    with selection_scope(fallback):
        degraded = build_targeted_consumed_profile_context(consumed, job)
    assert degraded.serialized == plain.serialized


# ===== 4. 索引是进程内缓存，可重建 =====


async def test_in_process_index_is_rebuilt_after_clear_and_restart():
    consumed = _profile()
    job = _job()
    settings = _settings()
    root_before = _root_listing()
    index = RagIndex()
    first = await prepare_selection_boost(consumed, job, settings=settings, index=index)
    stats = index.stats()
    assert first.boost and stats.size > 0 and stats.puts > 0

    index.clear()
    assert index.stats().size == 0
    after_clear = await prepare_selection_boost(consumed, job, settings=settings, index=index)
    assert after_clear.boost == first.boost
    assert index.stats().puts == 2 * stats.puts  # 清空后重新编码，不依赖持久化文件

    # 新索引 = 进程重启：从零重建后结果与第一次逐条一致。
    restarted = await prepare_selection_boost(consumed, job, settings=settings, index=RagIndex())
    assert restarted.boost == first.boost
    assert _root_listing() == root_before
