# SPDX-License-Identifier: Apache-2.0
"""清单第 16 条：旧写路径收口守卫（防回归）。

第 1 条之后，常规切换必须只走 `POST /profiles/{id}/activate`（先探后写、只改 active）。
`activate_local()` 与 `enable_remote()` 这两条「新建整段配置」的旧写路径只允许留在：

- `POST /local/enable`：本地首次启用（下载完成后同步 profile）；
- `POST /remote/enable`：旧版兼容入口（内部 upsert「默认配置」+ 走同一 _commit 写路径）。

这里用源码字符串断言钉住，避免以后有人顺手把切换改回旧路径（两套写路径并存会让
「切本地把远程配置覆盖掉」以另一种形式复现）。
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_frontend_switch_only_calls_activate_endpoint() -> None:
    card = _read("frontend/src/components/settings/EmbeddingProviderCard.tsx")
    ready = _read("frontend/src/components/settings/EmbeddingReadyPanel.tsx")
    assert "activateEmbeddingProfile" in card
    # 常规切换不能再调用「启用远程」这条整段写入路径。
    assert "enableEmbeddingRemote" not in card
    assert "enableEmbeddingRemote" not in ready
    # 本地切换优先 activate；只有「还没有本地 profile」时回退到首次启用流程。
    local_block = card.split("const switchToLocal")[1].split("const clearActiveKey")[0]
    assert "activateEmbeddingProfile(localId)" in local_block
    assert "settings.enableLocal()" in local_block


def test_backend_legacy_write_paths_are_confined() -> None:
    api = _read("backend/app/api/settings_embedding.py")
    profiles_api = _read("backend/app/api/settings_embedding_profiles.py")
    activation = _read("backend/app/services/llm/embedding_activation.py")
    local_setup = _read("backend/app/services/rag/rag_local_setup.py")

    # 两条旧写路径各只保留一个兼容入口。
    assert api.count("_local_api().activate_local()") == 1
    assert api.count("enable_remote_legacy") == 1
    # activate 路由自身不直接写扁平镜像（写只经 _commit_*，profiles 与镜像同批写）。
    activate_route = profiles_api.split('@router.post("/profiles/{profile_id}/activate")')[1]
    activate_route = activate_route.split("@router")[0]
    assert "write_active_embedding_config" not in activate_route
    assert "write_embedding_config" not in activate_route
    assert "write_active_embedding_config" not in activation
    assert "write_embedding_config" not in activation
    assert "_commit_remote_activation" in activation and "_commit_local_activation" in activation
    # 本地分支写镜像必须用「不沿用远程密钥」的本地版函数。
    assert "write_local_embedding_config(" in local_setup
    assert "write_embedding_config(" not in local_setup


def test_migration_is_the_only_place_replaying_legacy_flat_section() -> None:
    store = _read("backend/app/services/llm/embedding_profiles_store.py")
    assert "def migrate_legacy_once" in store
    # 迁移只从旧扁平段搬一次，且以「embedding_profiles 键已存在」为幂等判据。
    migration = store.split("def migrate_legacy_once")[1]
    assert "if isinstance(state.get(PROFILES_KEY), dict):" in migration
    assert "_CONFIG_KEYS" in migration
