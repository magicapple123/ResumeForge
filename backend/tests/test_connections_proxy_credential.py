# SPDX-License-Identifier: Apache-2.0
"""CR-11：代理口令登记进凭据清单。

代理口令此前**刻意不登记**：「外部连接」页是 A/B 两组的展示枚举，多一条会让页面多出
一行没有写入口的口令。代价是这一条真实凭据在页面上完全不可见——用户不知道它存在、
也不知道它存在哪。

现在把它登记成 ``network.proxy``，并钉住四条：

1. 声明存在且语义正确（全局文件、掩码显示、接受 ``__clear__`` 哨兵）；
2. 「外部连接」页能列出它，状态随口令有无变化；
3. 清除走 ``__clear__``、空串仍然是"保留"（两种语义不能混）；
4. 备份里不带明文（``include_api_keys=False`` 时该字段为空）。
"""

from __future__ import annotations

import json
import zipfile

from app.database import engine
from app.services import net_settings
from app.services.connections_view import build_connections
from app.services.credentials import get_source, source_ids
from app.services.credentials.semantics import CLEAR_SENTINEL
from app.services.credentials.types import CredentialScope, KeyDisplay
from app.services.data_backup import create_backup_archive

# 字符串而非常量 import：这条来源**新增**时用常量会让红变成 ImportError，
# 看不出"清单里少了一条"这个事实。
SOURCE_NETWORK_PROXY = "network.proxy"
PROXY_PASSWORD = "proxy-secret-0005"


def _proxy_item(db=None) -> dict:
    groups = build_connections(db)["groups"]
    for group in groups:
        for item in group["items"]:
            if item["id"] == SOURCE_NETWORK_PROXY:
                return item
    raise AssertionError("「外部连接」页没有列出代理口令")


def test_proxy_is_declared_as_a_persistent_masked_credential():
    assert SOURCE_NETWORK_PROXY in source_ids()
    source = get_source(SOURCE_NETWORK_PROXY)

    assert source.scope is CredentialScope.GLOBAL_FILE
    assert source.display is KeyDisplay.MASK
    assert source.supports_clear_sentinel is True
    assert "proxy_password" in source.location


def test_connections_page_shows_the_proxy_row_with_its_status(db_session):
    configured = _proxy_item(db_session)
    assert configured["status"] == "not_configured"
    assert configured["editable"] is True

    net_settings.save(
        mode="custom",
        proxy_url="http://127.0.0.1:7890",
        username="proxy-user",
        password=PROXY_PASSWORD,
    )

    item = _proxy_item(db_session)
    assert item["status"] == "saved"
    assert item["key_configured"] is True
    assert item["masked"] and PROXY_PASSWORD not in json.dumps(item)


def test_clear_sentinel_clears_while_empty_keeps_the_password():
    net_settings.save(mode="custom", proxy_url="http://127.0.0.1:7890", password=PROXY_PASSWORD)

    kept = net_settings.save(mode="custom", proxy_url="http://127.0.0.1:7890", password="")
    assert kept.password == PROXY_PASSWORD

    cleared = net_settings.save(
        mode="custom", proxy_url="http://127.0.0.1:7890", password=CLEAR_SENTINEL
    )
    assert cleared.password == ""
    assert net_settings.read().password == ""


def test_backup_never_carries_the_proxy_password(tmp_path):
    net_settings.save(mode="custom", proxy_url="http://127.0.0.1:7890", password=PROXY_PASSWORD)

    archive = create_backup_archive(
        engine, tmp_path, include_api_keys=False, include_global_llm=True
    )

    with zipfile.ZipFile(archive) as handle:
        for name in handle.namelist():
            assert PROXY_PASSWORD.encode() not in handle.read(name), name
        services = json.loads(handle.read("global_services.json"))["services"]
    assert services["network"]["proxy_password"] == ""
    # 地址与非密钥字段仍然随包走（换机后只需要补口令）。
    assert services["network"]["proxy_url"] == "http://127.0.0.1:7890"


def test_other_credential_sources_keep_their_semantics(db_session):
    """新增来源不许顺手改掉既有来源的写语义。"""
    from app.schemas.setting import LLMConfig
    from app.services.credentials import read_credential
    from app.services.settings_service import get_llm_config

    get_llm_config(db_session).model_dump()  # 读取路径本身不炸
    assert read_credential("llm.default", db=db_session) == ""
    net_settings.save(mode="custom", proxy_url="http://127.0.0.1:7890", password=PROXY_PASSWORD)
    assert read_credential(SOURCE_NETWORK_PROXY, db=db_session) == PROXY_PASSWORD
    assert LLMConfig().api_key == ""
