# SPDX-License-Identifier: Apache-2.0
"""更新下载链的发布源白名单、逐跳重定向与 checksum 复验（RF-26 §12.5 #1-#4）。

全部离线：httpx.MockTransport + conftest 的 ``fake_public_dns`` 假 DNS（它替换
``socket.getaddrinfo``，防护本身留在被测路径上——绝不把 ``_publish_source_reason``
打成桩）。真实发出的每个请求都记进 ``requests_log``，"拒绝且不发出第二个请求"
这类断言靠它。
"""

from __future__ import annotations

import hashlib
import io
import socket
import zipfile
from types import SimpleNamespace

import httpx
import pytest
from app.services import update_download, update_sources

ZIP_URL = "https://github.com/magicapple123/ResumeForge/releases/download/v99.0.0/pkg.zip"
SHA_URL = ZIP_URL + ".sha256"
MIRROR_URL = "https://objects.githubusercontent.com/pkg.sig?x=1"


def _valid_zip_bytes() -> bytes:
    """一个能通过 `_validate_archive` 的最小 ZIP 的字节串。"""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("ResumeForge/start.cmd", "@echo off")
        archive.writestr("ResumeForge/backend/app/main.py", "app = None")
    return buffer.getvalue()


def _sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def _transport(routes: dict[str, httpx.Response], requests_log: list[str]) -> httpx.MockTransport:
    async def handler(request: httpx.Request) -> httpx.Response:
        requests_log.append(str(request.url))
        return routes.get(str(request.url), httpx.Response(404))

    return httpx.MockTransport(handler)


def _serve(monkeypatch, routes: dict[str, httpx.Response], requests_log: list[str]) -> None:
    """把 MockTransport 注入模块级 ``httpx.AsyncClient``：覆盖 `_run_download` 这类
    不接受 ``transport=`` 参数的完整下载路径（与 test_api_update.py 同一手法）。"""
    transport = _transport(routes, requests_log)
    real_client = httpx.AsyncClient

    def _client(**kwargs):
        return real_client(transport=transport, **kwargs)

    monkeypatch.setattr(update_download.httpx, "AsyncClient", _client)


def _redirect(target: str) -> httpx.Response:
    return httpx.Response(302, headers={"location": target})


@pytest.fixture
def downloads(tmp_path, monkeypatch):
    """隔离下载目录与进程内状态；target 固定为 99.0.0 的包路径。"""
    directory = tmp_path / "update-downloads"
    directory.mkdir()
    monkeypatch.setattr(update_download, "DOWNLOAD_DIRECTORY", directory)
    update_download._status = update_download._MutableStatus()
    return SimpleNamespace(
        directory=directory,
        target=directory / "ResumeForge-99.0.0.zip",
        body=_valid_zip_bytes(),
    )


def _write_sidecar(path, digest: str) -> None:
    path.with_name(path.name + ".sha256").write_text(
        f"{digest}  {path.name}\n", encoding="utf-8"
    )


# ===== 首跳校验（§12.5 #1）=====


@pytest.mark.asyncio
async def test_first_hop_outside_the_allowlist_is_rejected_before_any_request(
    downloads, fake_public_dns
):
    log: list[str] = []
    with pytest.raises(RuntimeError, match="发布源"):
        await update_download._download_archive(
            "https://evil.example.com/pkg.zip",
            None,
            downloads.target,
            SHA_URL,
            transport=_transport({}, log),
        )
    assert log == []  # 一个请求都没发出去
    assert not downloads.target.exists()


@pytest.mark.asyncio
async def test_credentials_in_the_url_are_rejected(downloads, fake_public_dns):
    log: list[str] = []
    with pytest.raises(RuntimeError, match="user:pass"):
        await update_download._download_archive(
            "https://user:pass@github.com/pkg.zip",
            None,
            downloads.target,
            SHA_URL,
            transport=_transport({}, log),
        )
    assert log == []


@pytest.mark.asyncio
async def test_non_standard_ports_are_rejected(downloads, fake_public_dns):
    log: list[str] = []
    with pytest.raises(RuntimeError, match="端口"):
        await update_download._download_archive(
            "https://github.com:8443/pkg.zip",
            None,
            downloads.target,
            SHA_URL,
            transport=_transport({}, log),
        )
    assert log == []


@pytest.mark.asyncio
async def test_allowlisted_host_resolving_to_a_private_ip_is_rejected(downloads, monkeypatch):
    """白名单域名也不许解析到内网：防白名单域被劫持/改写解析到私网地址。"""

    def _private_dns(host, port, *args, **kwargs):  # noqa: ARG001
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", port or 0))]

    monkeypatch.setattr(socket, "getaddrinfo", _private_dns)
    log: list[str] = []
    with pytest.raises(RuntimeError, match="非公网地址"):
        await update_download._download_archive(
            ZIP_URL, None, downloads.target, SHA_URL, transport=_transport({}, log)
        )
    assert log == []


@pytest.mark.asyncio
async def test_allowlisted_host_resolving_to_cgnat_space_is_rejected(downloads, monkeypatch):
    """A09 收敛收益：地址判定改为与网页抓取共用 `services/net_policy.py` 后，白名单域名
    解析到运营商级 NAT 共享段（100.64.0.0/10）也被拒绝——收敛前这段会被放行。

    `ipaddress` 对 100.64.0.0/10 既不判 private 也不判 reserved，是原两份判定链共同
    看不到的空档；判定的唯一实现在 net_policy，`tests/test_net_policy.py` 另有段边界用例。
    """

    def _cgnat_dns(host, port, *args, **kwargs):  # noqa: ARG001
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("100.64.7.9", port or 0))]

    monkeypatch.setattr(socket, "getaddrinfo", _cgnat_dns)
    log: list[str] = []
    with pytest.raises(RuntimeError, match="非公网地址"):
        await update_download._download_archive(
            ZIP_URL, None, downloads.target, SHA_URL, transport=_transport({}, log)
        )
    assert log == []  # 拒绝发生在发出请求之前
    assert not downloads.target.exists()


# ===== 重定向逐跳校验（§12.5 #2）=====


@pytest.mark.asyncio
async def test_redirect_to_a_non_allowlisted_host_is_rejected_before_requesting_it(
    downloads, fake_public_dns
):
    log: list[str] = []
    routes = {ZIP_URL: _redirect("https://evil.example.com/stolen.zip")}
    with pytest.raises(RuntimeError, match="发布源"):
        await update_download._download_archive(
            ZIP_URL, None, downloads.target, SHA_URL, transport=_transport(routes, log)
        )
    assert log == [ZIP_URL]  # 第二跳从未发出


@pytest.mark.asyncio
async def test_redirect_to_a_private_address_is_rejected(downloads, fake_public_dns):
    log: list[str] = []
    routes = {ZIP_URL: _redirect("https://10.0.0.5/pkg.zip")}
    with pytest.raises(RuntimeError, match="发布源"):
        await update_download._download_archive(
            ZIP_URL, None, downloads.target, SHA_URL, transport=_transport(routes, log)
        )
    assert log == [ZIP_URL]


@pytest.mark.asyncio
async def test_redirect_hops_beyond_the_limit_are_aborted(downloads, fake_public_dns):
    """跳数上限：整条链全在白名单内也不许无限跟随。"""
    log: list[str] = []
    routes = {
        f"https://github.com/hop/{index}": _redirect(f"https://github.com/hop/{index + 1}")
        for index in range(update_sources.MAX_REDIRECT_HOPS + 1)
    }
    with pytest.raises(RuntimeError, match="跳上限"):
        await update_download._download_archive(
            "https://github.com/hop/0",
            None,
            downloads.target,
            SHA_URL,
            transport=_transport(routes, log),
        )
    assert len(log) == update_sources.MAX_REDIRECT_HOPS + 1


@pytest.mark.asyncio
async def test_a_fully_allowlisted_redirect_chain_downloads_and_stores_the_checksum(
    downloads, fake_public_dns
):
    """GitHub 发行链的真实形态：github.com 302 到 objects.githubusercontent.com。"""
    body = downloads.body
    digest = _sha256(body)
    log: list[str] = []
    routes = {
        ZIP_URL: _redirect(MIRROR_URL),
        MIRROR_URL: httpx.Response(200, content=body),
        SHA_URL: httpx.Response(200, text=f"{digest}  pkg.zip\n"),
    }
    await update_download._download_archive(
        ZIP_URL, len(body), downloads.target, SHA_URL, transport=_transport(routes, log)
    )
    assert log == [ZIP_URL, MIRROR_URL, SHA_URL]
    assert downloads.target.is_file()
    # 摘要留在包旁边：缓存命中/恢复/安装前复验都靠它（§12.5 #3）。
    assert update_sources.stored_checksum(downloads.target) == digest


# ===== checksum 硬要求与复验（§12.5 #3/#4）=====


@pytest.mark.asyncio
async def test_a_release_without_checksum_is_a_hard_failure(downloads):
    """缺 checksum 明确失败：不能静默降级为"无摘要也安装"。"""
    log: list[str] = []
    with pytest.raises(RuntimeError, match="SHA-256"):
        await update_download._download_archive(
            ZIP_URL, None, downloads.target, "", transport=_transport({}, log)
        )
    assert log == []
    assert not downloads.target.exists()


@pytest.mark.asyncio
async def test_a_checksum_mismatch_leaves_nothing_in_place(downloads, fake_public_dns):
    log: list[str] = []
    routes = {
        ZIP_URL: httpx.Response(200, content=downloads.body),
        SHA_URL: httpx.Response(200, text="0" * 64),
    }
    with pytest.raises(RuntimeError, match="校验和不匹配"):
        await update_download._download_archive(
            ZIP_URL, None, downloads.target, SHA_URL, transport=_transport(routes, log)
        )
    assert not downloads.target.exists()
    assert not update_sources.stored_checksum(downloads.target)


def _fake_check(*, checksum_url: str):
    async def _check(*, refresh: bool = False):  # noqa: ARG001
        return SimpleNamespace(
            update_available=True,
            installable=True,
            download_url=ZIP_URL,
            download_size=None,
            latest_version="99.0.0",
            checksum_url=checksum_url,
            release_url="https://github.com/magicapple123/ResumeForge/releases",
        )

    return _check


@pytest.mark.asyncio
async def test_start_download_refuses_a_release_without_checksum(downloads, monkeypatch):
    """源码包 fallback 没有 checksum：在下载入口就明确拒绝，给出手动路径。"""
    monkeypatch.setattr(update_download, "check_for_update", _fake_check(checksum_url=""))
    with pytest.raises(RuntimeError, match="SHA-256"):
        await update_download.start_download()


@pytest.mark.asyncio
async def test_start_download_accepts_a_cached_package_only_when_checksum_matches(
    downloads, monkeypatch
):
    """缓存命中必须重新核对 SHA-256（§12.5 #3）：匹配 → ready 且零网络请求。"""
    downloads.target.write_bytes(downloads.body)
    _write_sidecar(downloads.target, _sha256(downloads.body))
    monkeypatch.setattr(update_download, "check_for_update", _fake_check(checksum_url=SHA_URL))
    log: list[str] = []
    _serve(monkeypatch, {}, log)  # 若真的发了请求会拿到 404，用例必失败

    status = await update_download.start_download()

    assert status.state == "ready"
    assert status.installable is True
    assert log == []  # 缓存命中，没碰网络


@pytest.mark.asyncio
async def test_start_download_re_downloads_when_the_cached_package_was_swapped(
    downloads, monkeypatch
):
    """缓存包被替换（内容变了、摘要还是旧的）→ 缓存不命中，走重新下载。"""
    downloads.target.write_bytes(b"swapped content")  # 摘要对不上这个
    _write_sidecar(downloads.target, _sha256(downloads.body))
    monkeypatch.setattr(update_download, "check_for_update", _fake_check(checksum_url=SHA_URL))
    log: list[str] = []
    _serve(monkeypatch, {ZIP_URL: httpx.Response(404)}, log)  # 重新下载必然失败——但这就证明了它真的重下

    await update_download.start_download()
    await update_download._download_task

    assert log == [ZIP_URL]  # 缓存被拒，真实发起了重新下载
    assert update_download._status.state == "failed"


def test_disk_restore_refuses_a_package_without_a_checksum(downloads):
    """恢复路径同样要求摘要：没有 .sha256 的本地包不能被认领为可安装。"""
    downloads.target.write_bytes(downloads.body)
    update_download._status = update_download._MutableStatus()

    status = update_download.download_status()

    assert status.state == "idle"


def test_disk_restore_refuses_a_swapped_package(downloads):
    """包在后端重启期间被替换 → 摘要对不上 → 不恢复为可安装。"""
    downloads.target.write_bytes(downloads.body)
    _write_sidecar(downloads.target, _sha256(downloads.body))
    downloads.target.write_bytes(b"replaced while the backend was down")
    update_download._status = update_download._MutableStatus()

    status = update_download.download_status()

    assert status.state == "idle"
