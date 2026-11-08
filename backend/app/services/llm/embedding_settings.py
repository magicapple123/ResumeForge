# SPDX-License-Identifier: Apache-2.0
"""语义检索 embedding provider 的持久化配置（默认关闭；密钥按机加密）。

存在哪里：``DATA_DIR/global_settings.json`` 的顶层 ``embedding`` 段，与 ``llm`` /
``theme`` 并列。选这个位置有两个原因：

1. **跨数据集**：换一份数据集不该重新填一次 provider 配置；
2. **不进备份**：``global_settings.json`` 不在任何备份成员里（``data_backup/coverage.py``
   的 ``KNOWN_FILES`` 只把它算作"已知不覆盖"），于是权重、运行时、密钥都不会被
   备份包带走——这正是本轮"备份不变大、密钥不出本机"的要求。模型配置记录
   （``global_llm.json``）需要跨机恢复，这里不需要：换机后重新选一次 provider 即可。

密钥策略复用 ``api_key_crypto``（Windows DPAPI；其它平台沿用既有明文 + 备份剥离策略，
而本文件本来就不进备份）。**明文密钥只在进程内短暂存在**：``read_embedding_config(reveal_key=True)``
用于构造 provider，HTTP 响应一律走 ``mask_embedding_config``。

状态机错误（下载失败 / 401 / 维度不符）通过 ``last_error`` 落盘并在设置页可见，
**不允许**把失败伪装成已启用：
``enabled`` 只由真正校验通过后的 ``write_embedding_config`` 置 true。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from ..api_key_crypto import ApiKeyEncryptionError, decrypt_key, encrypt_key
from ..global_settings import load_state, mutate_state
from .embeddings import EmbeddingModelSpec

logger = logging.getLogger(__name__)

EMBEDDING_SECTION = "embedding"
SECTION_VERSION = 1
KEY_MASK = "********"
#: 只允许三个值；``fake`` 仍受 RAG_EMBEDDING_ALLOW_FAKE 守卫，不因存在这里而放宽。
EMBEDDING_PROVIDERS = ("fake", "local-onnx", "openai-http")
MAX_HEADERS = 20
MAX_HEADER_CHARS = 1024
MAX_BASE_URL_CHARS = 512
MAX_MODEL_CHARS = 128
REMOTE_PRESETS: dict[str, dict[str, Any]] = {
    # 只提供默认值与可选模型；**不新增代码路径**（预设 = 预填表单，启用仍要真实探测）。
    "dashscope": {
        "label": "阿里云百炼",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "models": ["qwen3.7-text-embedding-flash"],
        "needs_prefix": False,
    },
    "openai": {
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "models": ["text-embedding-3-small", "text-embedding-3-large"],
        "needs_prefix": False,
    },
    "zhipu": {
        "label": "智谱 AI",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "models": ["embedding-3"],
        "needs_prefix": False,
    },
    "siliconflow": {
        "label": "SiliconFlow",
        "base_url": "https://api.siliconflow.cn/v1",
        "models": [],
        "needs_prefix": False,
    },
    "ollama": {
        "label": "本机 Ollama / LM Studio",
        "base_url": "http://localhost:11434/v1",
        "models": [],
        "needs_prefix": False,
    },
}


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@dataclass(frozen=True)
class EmbeddingProviderConfig:
    """一份已解析的 provider 配置（``api_key`` 在 reveal 时为明文）。"""

    provider: str = ""
    enabled: bool = False
    model: str = ""
    dim: int = 0
    pooling: str = "cls"
    query_prefix: str = ""
    doc_prefix: str = ""
    normalize: bool = True
    variant: str = ""
    base_url: str = ""
    api_key: str = ""
    batch_size: int = 25
    endpoint_mode: str = "openai"
    request_url: str = ""
    headers: tuple[dict[str, str], ...] = ()
    body_template: str = ""
    response_path: str = "data[*].embedding"
    allow_private: bool = False
    confirmed_hosts: tuple[str, ...] = ()
    last_error: str = ""
    updated_at: str = ""

    def host(self) -> str:
        return endpoint_host(
            self.request_url if self.endpoint_mode == "template" else self.base_url
        )

    def public_dict(self) -> dict[str, Any]:
        return mask_embedding_config(self)


def encrypt_secret(value: str) -> str:
    """加密一个待落盘的密钥；空串原样返回。"""
    if not value:
        return ""
    return encrypt_key(value)


def endpoint_host(value: str) -> str:
    """从 base_url / request_url 取 host（小写、去端口与凭据段）。

    允许用户只填主机名（高级模板常见）：没有 scheme 时按 host 解析。解析失败返回
    空串而不是抛异常——调用方据此给出"地址不合法"的可读错误。
    """
    raw = (value or "").strip()
    if not raw:
        return ""
    candidate = raw if "://" in raw else "//" + raw
    try:
        parsed = urlsplit(candidate)
        host = parsed.hostname or ""
    except ValueError:
        return ""
    return host.strip().strip(".").casefold()


def sanitize_url(value: str) -> str:
    """去掉 URL 里的 userinfo（``https://user:pass@host`` 的 ``user:pass``）。

    凭据只能经 ``api_key`` / ``{api_key}`` 占位走 header；把用户名密码塞进 URL 会
    让它们原样出现在设置页响应、备份与日志的边角里，也绕过了"密钥只进加密字段"的
    约束。写盘前与读回时各清理一次（老文件也能被纠正）。
    """
    raw = (value or "").strip()
    if "://" not in raw:
        return raw
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError:
        return raw
    if "@" not in parts.netloc:
        return raw
    host = parts.hostname or ""
    if not host:
        return raw
    netloc = f"{host}:{port}" if port else host
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def _clean_headers(raw: Any) -> tuple[dict[str, str], ...]:
    if not isinstance(raw, (list, tuple)):
        return ()
    cleaned: list[dict[str, str]] = []
    for item in raw[:MAX_HEADERS]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        value = str(item.get("value") or "").strip()
        if not name or len(name) > 128 or len(value) > MAX_HEADER_CHARS:
            continue
        # header 值里只允许 ``{api_key}`` 占位或普通字面量；不会在此处渲染（渲染由
        # transport 层做，且渲染结果绝不进日志）。
        cleaned.append({"name": name, "value": value})
    return tuple(cleaned)


def _as_int(value: Any, default: int, *, low: int, high: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, parsed))


def _clean_hosts(raw: Any) -> tuple[str, ...]:
    if not isinstance(raw, (list, tuple)):
        return ()
    hosts: list[str] = []
    for item in raw:
        host = endpoint_host(str(item))
        if host and host not in hosts:
            hosts.append(host)
    return tuple(hosts[:50])


def _decode_section(section: dict[str, Any], *, reveal_key: bool) -> EmbeddingProviderConfig | None:
    provider = str(section.get("provider") or "").strip().casefold()
    if provider not in EMBEDDING_PROVIDERS:
        return None
    encrypted = str(section.get("api_key") or "")
    api_key = decrypt_key(encrypted) if (encrypted and reveal_key) else ""
    if encrypted and not reveal_key:
        # 调用方不需要明文时也不要谎报"未配置"：把占位符写回，让 mask 统一处理。
        api_key = KEY_MASK
    return EmbeddingProviderConfig(
        provider=provider,
        enabled=bool(section.get("enabled")),
        model=str(section.get("model") or "")[:MAX_MODEL_CHARS],
        dim=_as_int(section.get("dim"), 0, low=0, high=8192),
        pooling=str(section.get("pooling") or "cls").strip().casefold()[:32],
        query_prefix=str(section.get("query_prefix") or "")[:512],
        doc_prefix=str(section.get("doc_prefix") or "")[:512],
        normalize=bool(section.get("normalize", True)),
        variant=str(section.get("variant") or "")[:64],
        base_url=sanitize_url(str(section.get("base_url") or ""))[:MAX_BASE_URL_CHARS],
        api_key=api_key,
        batch_size=_as_int(section.get("batch_size"), 25, low=1, high=2048),
        endpoint_mode="template"
        if str(section.get("endpoint_mode") or "openai").strip().casefold() == "template"
        else "openai",
        request_url=sanitize_url(str(section.get("request_url") or ""))[:1024],
        headers=_clean_headers(section.get("headers")),
        body_template=str(section.get("body_template") or "")[:16384],
        response_path=str(section.get("response_path") or "data[*].embedding")[:512],
        allow_private=bool(section.get("allow_private")),
        confirmed_hosts=_clean_hosts(section.get("confirmed_hosts")),
        last_error=str(section.get("last_error") or "")[:500],
        updated_at=str(section.get("updated_at") or "")[:64],
    )


def read_embedding_config(*, reveal_key: bool = False) -> EmbeddingProviderConfig | None:
    """读取当前 provider 配置；没有配置或结构损坏时返回 None（不抛异常）。

    ``reveal_key=True`` 只给构造 provider 的进程内路径用；HTTP/日志/报告一律走
    ``mask_embedding_config``。
    """
    state = load_state()
    if state is None:
        return None
    section = state.get(EMBEDDING_SECTION)
    if not isinstance(section, dict) or not section:
        return None
    try:
        return _decode_section(section, reveal_key=reveal_key)
    except ApiKeyEncryptionError:
        logger.warning("语义检索密钥解密失败，按未配置处理")
        return None
    except Exception:  # noqa: BLE001 - 配置损坏按未配置处理，设置页可重新配置
        logger.warning("语义检索配置解析失败，按未配置处理")
        return None


def _existing_section() -> dict[str, Any]:
    state = load_state()
    section = state.get(EMBEDDING_SECTION) if state else None
    return dict(section) if isinstance(section, dict) else {}


def _write_section(section: dict[str, Any]) -> None:
    def mutate(state: dict[str, Any]) -> None:
        state[EMBEDDING_SECTION] = section

    mutate_state(mutate)


def write_embedding_config(config: EmbeddingProviderConfig) -> EmbeddingProviderConfig:
    """写入 provider 配置；``api_key`` 为空或掩码时沿用已存密钥（与 LLM 配置同语义）。

    ``enabled=True`` 只应由"真实探测/下载校验通过"的调用方设置；本函数不做可用性判断
    （可用性由 route/服务层保证），但会拒绝非法 provider 名。
    """
    provider = config.provider.strip().casefold()
    if provider not in EMBEDDING_PROVIDERS:
        raise ValueError(f"不支持的 embedding provider：{config.provider}")
    previous = _existing_section()
    stored_key = str(previous.get("api_key") or "")
    incoming_key = config.api_key or ""
    if incoming_key and incoming_key != KEY_MASK:
        encrypted = encrypt_secret(incoming_key)
    elif incoming_key == KEY_MASK or not incoming_key:
        encrypted = stored_key
    else:  # pragma: no cover - 上面两种已覆盖全部输入
        encrypted = stored_key
    section: dict[str, Any] = {
        "version": SECTION_VERSION,
        "provider": provider,
        "enabled": bool(config.enabled),
        "model": config.model[:MAX_MODEL_CHARS],
        "dim": _as_int(config.dim, 0, low=0, high=8192),
        "pooling": config.pooling[:32],
        "query_prefix": config.query_prefix[:512],
        "doc_prefix": config.doc_prefix[:512],
        "normalize": bool(config.normalize),
        "variant": config.variant[:64],
        "base_url": sanitize_url(config.base_url)[:MAX_BASE_URL_CHARS],
        "api_key": encrypted,
        "batch_size": _as_int(config.batch_size, 25, low=1, high=2048),
        "endpoint_mode": "template" if config.endpoint_mode == "template" else "openai",
        "request_url": sanitize_url(config.request_url)[:1024],
        "headers": [dict(item) for item in _clean_headers(config.headers)],
        "body_template": config.body_template[:16384],
        "response_path": config.response_path[:512],
        "allow_private": bool(config.allow_private),
        "confirmed_hosts": list(_clean_hosts(config.confirmed_hosts)),
        "last_error": config.last_error[:500],
        "updated_at": _now(),
    }
    _write_section(section)
    return _decode_section(section, reveal_key=False) or config


def clear_embedding_config() -> None:
    """删除整个 ``embedding`` 段（含密钥与确认记录），回到从未配置。"""
    if not _existing_section():
        return

    def mutate(state: dict[str, Any]) -> None:
        state.pop(EMBEDDING_SECTION, None)

    mutate_state(mutate)


def set_embedding_error(message: str) -> None:
    """记录一条用户可见的失败原因（不改变 provider/enabled）。"""
    section = _existing_section()
    if not section:
        return
    section["last_error"] = (message or "")[:500]
    section["updated_at"] = _now()
    _write_section(section)


def mark_host_confirmed(host: str) -> list[str]:
    cleaned = endpoint_host(host)
    if not cleaned:
        raise ValueError("base_url 不包含可识别的主机名")
    section = _existing_section()
    hosts = list(_clean_hosts(section.get("confirmed_hosts")))
    if cleaned not in hosts:
        hosts.append(cleaned)
    section["confirmed_hosts"] = hosts
    section.pop("last_error", None)
    section["updated_at"] = _now()
    _write_section(section)
    return hosts


def revoke_host_confirmed(host: str) -> list[str]:
    cleaned = endpoint_host(host)
    section = _existing_section()
    hosts = [item for item in _clean_hosts(section.get("confirmed_hosts")) if item != cleaned]
    section["confirmed_hosts"] = hosts
    section["updated_at"] = _now()
    _write_section(section)
    return hosts


def configured_hosts() -> list[str]:
    """已确认隐私范围的 host 列表（即使还没有完整 provider 配置也可读）。"""
    return list(_clean_hosts(_existing_section().get("confirmed_hosts")))


def is_host_confirmed(config: EmbeddingProviderConfig) -> bool:
    host = config.host()
    return bool(host) and host in config.confirmed_hosts


def config_to_spec(config: EmbeddingProviderConfig) -> EmbeddingModelSpec:
    """provider 配置 → 缓存指纹用的模型描述（换任一项即新索引）。"""
    return EmbeddingModelSpec(
        provider=config.provider,
        model=config.model,
        dim=config.dim,
        pooling=config.pooling,
        query_prefix=config.query_prefix,
        doc_prefix=config.doc_prefix,
        normalize=config.normalize,
    )


def mask_embedding_config(config: EmbeddingProviderConfig) -> dict[str, Any]:
    """对外 JSON：密钥换成掩码（有密钥才给掩码），不含任何密文/明文。"""
    key_present = bool(config.api_key)
    return {
        "provider": config.provider,
        "enabled": config.enabled,
        "model": config.model,
        "dim": config.dim,
        "pooling": config.pooling,
        "query_prefix": config.query_prefix,
        "doc_prefix": config.doc_prefix,
        "normalize": config.normalize,
        "variant": config.variant,
        "base_url": config.base_url,
        "api_key": KEY_MASK if key_present else "",
        "batch_size": config.batch_size,
        "endpoint_mode": config.endpoint_mode,
        "request_url": config.request_url,
        "headers": [dict(item) for item in config.headers],
        "body_template": config.body_template,
        "response_path": config.response_path,
        "allow_private": config.allow_private,
        "confirmed_hosts": list(config.confirmed_hosts),
        "host": config.host(),
        "last_error": config.last_error,
        "updated_at": config.updated_at,
    }


def replace_config(config: EmbeddingProviderConfig, **changes: Any) -> EmbeddingProviderConfig:
    """dataclass 的 replace 语义别名（调用方少 import 一个名字）。"""
    return replace(config, **changes)


__all__ = [
    "EMBEDDING_PROVIDERS",
    "EMBEDDING_SECTION",
    "EmbeddingProviderConfig",
    "KEY_MASK",
    "REMOTE_PRESETS",
    "clear_embedding_config",
    "config_to_spec",
    "configured_hosts",
    "encrypt_secret",
    "endpoint_host",
    "is_host_confirmed",
    "mark_host_confirmed",
    "mask_embedding_config",
    "read_embedding_config",
    "replace_config",
    "sanitize_url",
    "revoke_host_confirmed",
    "set_embedding_error",
    "write_embedding_config",
]
