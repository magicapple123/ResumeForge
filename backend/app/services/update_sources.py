# SPDX-License-Identifier: Apache-2.0
"""更新下载与本地安装包的安全边界：发布源白名单、逐跳重定向、ZIP/SHA-256 复验。

RF-26 §12.5 #1-#5。单独成模块的原因：`update_download.py` 已接近 500 行纪律上限，
而"哪些下载地址可信"与"包怎么核对"是一块自洽的安全策略，值得一份独立实现。

安全边界：
- 下载包、checksum 与重定向的**每一跳**都必须命中 `update_allowed_hosts` 白名单
  （或其子域），scheme 只允许 https、端口只允许标准 443、URL 不许携带凭据；
- 白名单主机解析出的**每一个** IP 还必须公网——防白名单域名被劫持/改写解析到内网；
- 重定向**不自动跟随**：调用方手动逐跳处理，每一跳先过校验再发请求，公网下载链
  302 到内网或陌生域时，在发出第二个请求之前就拒绝；
- 正式发布包必须提供 `.sha256`，缺摘要明确失败，不静默降级为"无摘要也安装"；
- 本地安装包每次被重新认领（缓存命中、后端重启后的磁盘恢复、安装前）都要对着下载时
  留在旁边的 `.sha256` 重算一遍——只验 ZIP 结构挡不住"包被替换/截断"。
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

import httpx

from ..config import get_settings
from .net_policy import ADDRESS_INVALID, non_public_address_reason
from .search.page_reader import _sync_resolve as _resolve_host
from .update_check import _is_newer, _version_tuple

logger = logging.getLogger(__name__)

# 手动重定向上限：初始请求 + 至多 5 次跟随。GitHub 发行链（github.com →
# objects.githubusercontent.com）通常 1～2 跳，5 是宽裕的安全网。
MAX_REDIRECT_HOPS = 5
# 更新下载只走 https 与标准端口：发行链上没有明文 HTTP 的位置。
_ALLOWED_UPDATE_SCHEMES = frozenset({"https"})
_ALLOWED_UPDATE_PORTS = frozenset({None, 443})

# 本地安装包的命名约定（写入侧见 `update_download._safe_archive_path`）：
# `ResumeForge-<版本>.zip`。用于从磁盘挑出真正的安装包。
ARCHIVE_NAME_PATTERN = re.compile(r"^ResumeForge-(?P<version>[0-9A-Za-z][0-9A-Za-z._-]*)\.zip$")


def _publish_source_reason(url: str) -> str | None:
    """发布源白名单策略的**唯一实现**：首跳与重定向的每一跳都走这一份。

    放行返回 ``None``，否则给出可读的拒绝原因。校验四件事：scheme、URL 凭据、端口、
    主机在 `update_allowed_hosts` 白名单（或其子域）内；"解析出的每个 IP 是否公网"交给
    :mod:`app.services.net_policy`（与 `page_reader._policy_reason` 同一份实现，含 CGNAT）。
    """
    try:
        parsed = urlsplit(url)
    except ValueError:
        return "URL 无法解析"
    if parsed.scheme.lower() not in _ALLOWED_UPDATE_SCHEMES:
        return f"scheme 不是 https（{parsed.scheme or '空'}）"
    if not parsed.hostname:
        return "缺少主机名"
    if parsed.username or parsed.password:
        return "URL 中携带了 user:pass@"
    try:
        port = parsed.port
    except ValueError:
        return "端口无法解析"
    if port not in _ALLOWED_UPDATE_PORTS:
        return f"非标准端口 {port}"
    host = parsed.hostname.casefold()
    allowed = get_settings().update_allowed_host_list
    if not any(host == item or host.endswith(f".{item}") for item in allowed):
        return f"主机 {host} 不在允许的发布源内"
    for address in _resolve_host(host):
        # 地址段判定只有一份实现（`services/net_policy.py`），与网页抓取共用：白名单域名
        # 解析到内网/CGNAT 段时在这里拒绝，且拒绝发生在发出请求之前。
        reason = non_public_address_reason(address)
        if reason is None:
            continue
        if reason == ADDRESS_INVALID:
            return f"解析结果 {address!r} 不是合法 IP"
        return f"主机 {host} 解析到非公网地址 {address}"
    return None


async def require_publish_source(url: str) -> None:
    """不在允许发布源内就在**发出请求之前**拒绝。

    ``getaddrinfo`` 是同步阻塞调用，照 page_reader 的做法放进工作线程执行，
    不卡事件循环。
    """
    reason = await asyncio.to_thread(_publish_source_reason, url)
    if reason is not None:
        raise RuntimeError(f"更新下载地址未通过发布源校验（{reason}），已停止下载")


def download_client(transport: httpx.AsyncBaseTransport | None) -> httpx.AsyncClient:
    """构造手动跟随重定向的下载客户端（``follow_redirects=False``）。

    ``transport=None`` 时**不要**把该键传进去：既有测试通过替换
    ``httpx.AsyncClient`` 注入 MockTransport（闭包里固定 ``transport=``），显式传
    ``transport=None`` 会与其形成重复关键字参数。
    """
    client_kwargs: dict = {"timeout": httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)}
    if transport is not None:
        client_kwargs["transport"] = transport
    return httpx.AsyncClient(**client_kwargs)


def validate_archive(path: Path) -> None:
    """ZIP 结构校验：拒绝路径穿越，并确认它是完整的 ResumeForge 安装包。"""
    try:
        with zipfile.ZipFile(path) as archive:
            names = [name.replace("\\", "/") for name in archive.namelist()]
            for name in names:
                parts = PurePosixPath(name).parts
                if PurePosixPath(name).is_absolute() or ".." in parts:
                    raise ValueError("更新包包含不安全的路径，已拒绝安装")
            if not any(name.endswith("/start.cmd") or name == "start.cmd" for name in names):
                raise ValueError("更新包缺少 start.cmd，无法确认它是 ResumeForge 安装包")
            if not any(name.endswith("/backend/app/main.py") for name in names):
                raise ValueError("更新包缺少后端入口，无法确认它是完整安装包")
            if archive.testzip() is not None:
                raise ValueError("更新包校验失败，压缩包可能已损坏")
    except zipfile.BadZipFile as exc:
        raise ValueError("下载的更新包不是有效 ZIP 文件") from exc


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stored_checksum(path: Path) -> str | None:
    """读包旁边的 `<包名>.zip.sha256` 摘要；没有或内容不可识别返回 ``None``。"""
    sidecar = path.with_name(path.name + ".sha256")
    try:
        text = sidecar.read_text(encoding="utf-8-sig")
    except OSError:
        return None
    match = re.search(r"[0-9a-fA-F]{64}", text)
    return match.group(0).lower() if match else None


def verify_checksum(path: Path) -> None:
    """缓存命中、磁盘恢复与安装前的 SHA-256 复验（RF-26 §12.5 #3）。

    **没有摘要也算失败**：无法核对的包宁可重下，也不装。
    """
    expected = stored_checksum(path)
    if expected is None:
        raise ValueError("找不到更新包的校验文件（.sha256），无法核对包完整性")
    if sha256_of(path) != expected:
        raise ValueError("更新包与下载时的校验和不一致（文件可能被替换或损坏），请重新下载")


def candidate_archives(download_dir: Path, current_version: str) -> list[tuple[str, Path]]:
    """扫下载目录，返回所有「比当前版本新且校验通过」的本地安装包（旧版本在前）。

    命名必须严格是 ``ResumeForge-<版本>.zip``，版本必须**比当前版本新**（挡降级/重装），
    并且要过 ZIP 结构与 SHA-256 双重校验（挡坏包、路径穿越与"包被替换"）。任何一项
    不满足就跳过——宁可当作没下载过，也不能把坏包摆成"可安装"。
    """
    found: list[tuple[tuple[int, ...], str, Path]] = []
    try:
        entries = list(download_dir.iterdir())
    except OSError:
        return []
    for path in entries:
        if not path.is_file():
            continue
        match = ARCHIVE_NAME_PATTERN.match(path.name)
        if match is None:
            continue
        version = match.group("version")
        if not _is_newer(version, current_version):
            continue
        try:
            validate_archive(path)
            verify_checksum(path)
        except (ValueError, OSError):
            logger.info("忽略无法校验的本地更新包：%s", path)
            continue
        found.append((_version_tuple(version), version, path))
    found.sort(key=lambda item: item[0])
    return [(version, path) for _, version, path in found]


async def fetch_expected_checksum(
    url: str, *, transport: httpx.AsyncBaseTransport | None = None
) -> str:
    """取回发布时一并上传的 `.sha256`（内容是 `<64 位十六进制>  <文件名>`）。

    重定向**不自动跟随**：手动逐跳处理（RF-26 §12.5 #2），每一跳都先过发布源校验
    再发请求——公网下载链 302 到内网或陌生域时，在发出第二个请求之前就拒绝。
    ``transport`` 仅供测试注入 MockTransport，生产调用方不传。
    """
    headers = {"Accept": "text/plain", "User-Agent": "ResumeForge-updater"}
    async with download_client(transport) as client:
        current = url
        for _hop in range(MAX_REDIRECT_HOPS + 1):
            await require_publish_source(current)
            response = await client.get(current, headers=headers)
            if response.is_redirect:
                location = response.headers.get("location", "")
                if not location:
                    raise RuntimeError("校验文件重定向缺少 Location，已停止下载")
                current = str(response.url.join(location))
                continue
            break
        else:
            raise RuntimeError(f"校验文件重定向超过 {MAX_REDIRECT_HOPS} 跳上限，已停止下载")
        if response.status_code != 200:
            raise RuntimeError(f"下载校验文件失败：HTTP {response.status_code}")
        text = response.text
    match = re.search(r"[0-9a-fA-F]{64}", text)
    if not match:
        raise RuntimeError("校验文件内容无法识别，已停止安装")
    return match.group(0).lower()


__all__ = [
    "ARCHIVE_NAME_PATTERN",
    "MAX_REDIRECT_HOPS",
    "candidate_archives",
    "download_client",
    "fetch_expected_checksum",
    "require_publish_source",
    "sha256_of",
    "stored_checksum",
    "validate_archive",
    "verify_checksum",
]
