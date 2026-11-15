# SPDX-License-Identifier: Apache-2.0
"""凭据 registry 适配层：三种写入语义 / 三种状态 / 两种平台保护标注 / 备份白名单派生。

这是 T05 的验收文件，守四件**会静默失效**的事：

1. **写入语义逐条一致**——空串=清除、掩码=保持不变、其它=新值加密。registry 的语义函数
   必须与既有实现（``asr_profiles._resolve_key`` 的按条判断、``web_search_settings``
   的三分支）逐值等价；这里直接拿既有两个实现当"标准答案"对拍，避免"顺手改好"。
2. **三种状态都在**——已保存 / 未配置 / 仅本次会话，且纯内存来源永远报告
   ``memory_only``（不能对"没落盘的密钥"回答"明文还是密文"）。
3. **两种平台保护标注**——Windows 是 DPAPI、其它平台按设计是明文（Q19）。两条分支都显式
   验，不靠跑在哪个系统上。
4. **备份白名单真的是派生的**——正反两向：registry 声明的每个前缀都在 WHERE 里；
   往清单里塞一个假来源，白名单与**真的剥离动作**立刻跟上。没有反向用例，
   "派生"和"抄了两份碰巧长得一样"就分不开。

不出网、不碰真实用户数据：全局设置文件由 conftest 的 autouse 夹具逐例清空。
"""

from __future__ import annotations

import sqlite3
from contextlib import closing

import pytest
from app.schemas.setting import SearchConfig
from app.services import api_key_session
from app.services.api_key_crypto import decrypt_key, encrypt_key
from app.services.credentials import (
    CLEAR_SENTINEL,
    CREDENTIAL_SOURCES,
    ENCRYPTING_PLATFORMS,
    CredentialScope,
    CredentialSource,
    CredentialStatus,
    KeyDisplay,
    ProtectionKind,
    apply_stored_key,
    credential_state,
    credential_states,
    disk_protection,
    get_source,
    mask_value,
    read_credential,
    resolve_stored_key,
    secret_app_setting_prefixes,
    secret_app_setting_where,
    source_ids,
    storage_protection,
)
from app.services.llm_key_refs import API_KEY_MASK, PROFILE_API_KEY_PREFIX
from app.services.web_search_settings import (
    get_search_config_with_secrets,
    save_search_config,
)
from tests.api_key_at_rest import IS_WINDOWS, assert_key_at_rest

SEARCH_KEY = "sk-registry-canary-0123456789"

# 备份剥离白名单原本手写的四条前缀（``data_backup/api_keys.py`` 的历史形态）。
# 派生版必须一条不少地覆盖它们，否则"不含 API Key"的勾选对某个来源就失效了。
LEGACY_APP_SETTING_PREFIXES = (
    "asr_api_key",
    "search_deepseek_api_key",
    "search_tavily_api_key",
    "search_jina_api_key",
)


@pytest.fixture(autouse=True)
def clean_session_key():
    """会话密钥是进程级模块变量：不清会让"未配置"的用例按上一个用例的残留变绿。"""
    api_key_session.clear_session_key()
    yield
    api_key_session.clear_session_key()


def _save_search_key(db_session, value: str = SEARCH_KEY) -> None:
    save_search_config(db_session, SearchConfig(deepseek_api_key=value))


# ===== 1. 清单：五种存储都在 =====


def test_registry_declares_all_five_storages():
    groups = {source.group for source in CREDENTIAL_SOURCES}
    assert groups == {"web_search", "llm", "asr", "embedding", "session"}

    search_fields = {
        source.storage_field for source in CREDENTIAL_SOURCES if source.group == "web_search"
    }
    assert search_fields == {"deepseek_api_key", "tavily_api_key", "jina_api_key"}

    # 纯内存那一条必须登记为"不落盘"，否则「外部连接」页会对它显示加密/明文。
    session_source = get_source("llm.session")
    assert session_source.scope is CredentialScope.MEMORY
    assert session_source.persistent is False

    ids = [source.source_id for source in CREDENTIAL_SOURCES]
    assert len(ids) == len(set(ids)), "source_id 必须唯一"


def test_unknown_source_is_rejected_loudly():
    with pytest.raises(KeyError):
        get_source("nope.unknown")


# ===== 2. 写入语义：空串 / 掩码 / 新值 =====


def test_new_value_is_encrypted_for_this_platform():
    stored = resolve_stored_key(SEARCH_KEY)
    assert stored is not None
    assert_key_at_rest(stored, secret=SEARCH_KEY)
    assert decrypt_key(stored) == SEARCH_KEY


def test_mask_always_means_keep():
    assert resolve_stored_key(API_KEY_MASK, existing_stored="stored-value") is None
    assert apply_stored_key(API_KEY_MASK, existing_stored="stored-value") == "stored-value"
    assert (
        apply_stored_key(API_KEY_MASK, existing_stored="stored-value", empty_clears=True)
        == "stored-value"
    )


def test_empty_clears_only_where_the_caller_asks_for_it():
    """空串的两套语义是**既有差异**（Q16），不是本层要"统一"的东西。

    联网搜索（整块重写）：输入框清空 = 用户显式移除这把 Key；
    语音 / 语义检索（按条编辑）：留空 = 这一条没改，沿用本条旧 Key（跨条绝不继承）。
    两个页面都有人用着，任选一个统一都会改掉另一个的行为。
    """
    assert apply_stored_key("", existing_stored="stored-value", empty_clears=True) == ""
    assert apply_stored_key("", existing_stored="stored-value") == "stored-value"
    assert resolve_stored_key("", existing_stored="stored-value") is None


def test_binding_change_turns_mask_and_empty_into_clear():
    assert resolve_stored_key(API_KEY_MASK, existing_stored="old", invalidated=True) == ""
    assert resolve_stored_key("", existing_stored="old", invalidated=True) == ""


def test_clear_sentinel_only_applies_where_declared():
    assert (
        resolve_stored_key(
            CLEAR_SENTINEL,
            existing_stored="old",
            clear_sentinel=CLEAR_SENTINEL,
        )
        == ""
    )
    # 联网搜索没声明哨兵支持：`__clear__` 按普通字符串加密，与既有行为一致
    # （不能替它"补上"哨兵，那是改语义）。
    stored = resolve_stored_key(CLEAR_SENTINEL, existing_stored="old")
    assert stored is not None
    assert decrypt_key(stored) == CLEAR_SENTINEL


def test_semantics_match_the_asr_profile_resolver():
    """拿 ``asr_profiles._resolve_key`` 当标准答案逐值对拍（按条判断那条路径）。

    比对的是**解密后的值**而不是密文：``encrypt_key`` 在 Windows 上走 DPAPI，每次加密
    都带新的随机熵，同一明文两次加密的密文必然不同（macOS/Linux 的明文分支又会相同）。
    比密文等于在断言"随机数不随机"，只会得到一条永远红的假失败。
    """
    from app.services.asr_profiles import _resolve_key

    stored = encrypt_key("sk-stored-asr-0123456789")
    profile = {"base_url": "https://api.example.test/v1", "protocol": "openai", "api_key": stored}
    cases = [
        (CLEAR_SENTINEL, False),
        ("", False),
        ("", True),
        (API_KEY_MASK, False),
        (API_KEY_MASK, True),
        ("sk-typed-new-0123456789", False),
        ("sk-typed-new-0123456789", True),
    ]
    for raw, binding_changed in cases:
        base_url = "https://other.example.test/v1" if binding_changed else profile["base_url"]
        expected = _resolve_key(profile, raw, base_url, "openai")
        actual = resolve_stored_key(
            raw,
            existing_stored=stored,
            clear_sentinel=CLEAR_SENTINEL,
            invalidated=binding_changed,
        )
        assert _same_secret(actual, expected), f"raw={raw!r} changed={binding_changed}"


def _same_secret(left, right):
    """两份"存储值"是否代表同一个密钥（空值等价、密文按解密后比较）。"""
    if not left or not right:
        return (not left) == (not right)
    return decrypt_key(left) == decrypt_key(right)


def test_clear_sentinel_literals_agree_across_modules():
    from app.services.asr_profiles import CLEAR_API_KEY
    from app.services.llm.embedding_profiles import CLEAR_SENTINEL as EMBEDDING_CLEAR

    assert CLEAR_SENTINEL == CLEAR_API_KEY == EMBEDDING_CLEAR


def test_web_search_save_goes_through_the_shared_semantics(db_session):
    """接上 registry 之后，三分支行为必须与改造前一致（这条是"没顺手改好"的证据）。"""
    _save_search_key(db_session)
    assert get_search_config_with_secrets(db_session).deepseek_api_key == SEARCH_KEY

    # 掩码回传 = 保持不变
    save_search_config(db_session, SearchConfig(deepseek_api_key=API_KEY_MASK))
    assert get_search_config_with_secrets(db_session).deepseek_api_key == SEARCH_KEY

    # 空串 = 清除
    save_search_config(db_session, SearchConfig(deepseek_api_key=""))
    assert get_search_config_with_secrets(db_session).deepseek_api_key == ""


# ===== 3. 三种状态 =====


def test_persisted_source_goes_from_unconfigured_to_saved(db_session):
    before = credential_state("web_search.deepseek", db=db_session)
    assert before.status is CredentialStatus.NOT_CONFIGURED
    assert before.masked == ""
    assert before.key_configured is False
    assert before.status_label == "未配置"

    _save_search_key(db_session)
    after = credential_state("web_search.deepseek", db=db_session)
    assert after.status is CredentialStatus.SAVED
    assert after.masked == API_KEY_MASK
    assert after.key_configured is True
    assert after.status_label == "已保存"
    assert SEARCH_KEY not in repr(after)


def test_session_only_status_is_expressible(db_session):
    assert credential_state("llm.session", db=db_session).status is CredentialStatus.NOT_CONFIGURED

    api_key_session.set_session_key("sk-session-0123456789")
    memory_state = credential_state("llm.session", db=db_session)
    assert memory_state.status is CredentialStatus.SESSION_ONLY
    assert memory_state.status_label == "仅本次会话"
    assert memory_state.masked == API_KEY_MASK

    # 会话密钥会覆盖已保存的大模型 Key（get_llm_config 的既有行为）：
    # 生效的是内存里那一份，状态必须如实说"仅本次会话"，不能谎报"已保存"。
    assert credential_state("llm.default", db=db_session).status is CredentialStatus.SESSION_ONLY


def test_boolean_sources_never_return_a_mask(db_session):
    source = get_source("embedding.default")
    assert source.display is KeyDisplay.BOOLEAN
    state = credential_state(source.source_id, db=db_session)
    assert state.masked == ""
    assert state.key_configured is False


def test_states_never_carry_the_real_key(db_session):
    _save_search_key(db_session)
    states = credential_states(db=db_session)
    assert [item.source_id for item in states] == list(source_ids())
    assert all(SEARCH_KEY not in repr(item) for item in states)
    assert SEARCH_KEY not in repr(states)


def test_read_credential_is_runtime_only_and_needs_a_session(db_session):
    with pytest.raises(ValueError):
        read_credential("web_search.deepseek")

    _save_search_key(db_session)
    assert read_credential("web_search.deepseek", db=db_session) == SEARCH_KEY


def test_mask_value_never_returns_the_key():
    assert mask_value("") == ""
    assert mask_value(SEARCH_KEY) == API_KEY_MASK
    reference = f"{PROFILE_API_KEY_PREFIX}p_abc123"
    assert mask_value(SEARCH_KEY, reference=reference) == reference


# ===== 4. 存储保护标注（两种平台都要能验）=====


def test_disk_protection_marks_both_platforms():
    windows = disk_protection("win32")
    assert windows.value == ProtectionKind.DPAPI.value == "dpapi"
    assert "DPAPI" in windows.description

    for other in ("linux", "darwin"):
        protection = disk_protection(other)
        assert protection.value == ProtectionKind.PLAINTEXT.value == "plaintext"
        assert "明文" in protection.description


def test_default_protection_matches_the_real_platform_and_encrypt_key():
    expected = "dpapi" if IS_WINDOWS else "plaintext"
    assert disk_protection().value == expected
    assert frozenset({"win32"}) == ENCRYPTING_PLATFORMS
    # 与 encrypt_key 的真实行为对齐：判据只有一处实现，标注不能与它不一致。
    stored = encrypt_key(SEARCH_KEY)
    if IS_WINDOWS:
        assert stored.startswith("dpapi:v1:")
    else:
        assert stored == SEARCH_KEY


def test_memory_source_is_marked_memory_only():
    assert storage_protection(get_source("llm.session")).value == "memory_only"
    # 持久化来源跟随整台机器的落盘方式
    assert storage_protection(get_source("web_search.deepseek")).value == disk_protection().value


# ===== 5. 备份白名单：派生 + 反证 =====


def test_whitelist_covers_every_declared_prefix():
    declared = secret_app_setting_prefixes()
    for prefix in LEGACY_APP_SETTING_PREFIXES:
        assert prefix in declared, f"原有的 {prefix} 丢了：备份会把明文 Key 带出去"

    where = secret_app_setting_where()
    for prefix in declared:
        assert f"key LIKE '{prefix}%'" in where


def test_backup_module_uses_the_derived_whitelist_not_a_hand_written_copy():
    from app.services.data_backup.api_keys import _SECRET_APP_SETTING_WHERE

    assert secret_app_setting_where() == _SECRET_APP_SETTING_WHERE
    for prefix in LEGACY_APP_SETTING_PREFIXES:
        assert prefix in _SECRET_APP_SETTING_WHERE


def test_whitelist_and_stripping_follow_a_newly_declared_source(monkeypatch, tmp_path):
    """反证：随便加一个假 secret 来源，白名单与真实剥离都必须自动包含它。

    没有这条，``test_whitelist_covers_every_declared_prefix`` 只能证明"两份名单碰巧
    一样长"，证不了"派生"。
    """
    from app.services import credentials as credentials_pkg

    fake = CredentialSource(
        source_id="fake.provider",
        group="fake",
        label="假来源",
        scope=CredentialScope.DATABASE,
        location="app_setting.fake_provider_api_key",
        app_setting_key_prefixes=("fake_provider_api_key",),
    )
    import app.services.credentials.registry as registry

    monkeypatch.setattr(registry, "CREDENTIAL_SOURCES", (*registry.CREDENTIAL_SOURCES, fake))

    derived = credentials_pkg.secret_app_setting_where()
    assert "fake_provider_api_key" in derived
    assert "fake_provider_api_key" in credentials_pkg.secret_app_setting_prefixes()
    assert "fake.provider" in credentials_pkg.protected_source_ids()

    # 真的跑一遍剥离：证明派生结果被生产代码用到（而不是只在测试里算了一遍）。
    from app.services.data_backup.api_keys import _plaintext_api_keys_in, _strip_api_keys

    database = tmp_path / "backup-copy.db"
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("CREATE TABLE app_setting (key TEXT PRIMARY KEY, value TEXT)")
        connection.execute(
            "INSERT INTO app_setting (key, value)"
            " VALUES ('fake_provider_api_key', 'fp-plaintext-0123456789')"
        )
        connection.commit()

    assert _plaintext_api_keys_in(database) == ["fp-plaintext-0123456789"]
    _strip_api_keys(database)
    assert _plaintext_api_keys_in(database) == []
