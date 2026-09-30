"""应用内更新检查、下载状态与更新包校验的离线测试。"""

import asyncio
import json
import os
import time
import zipfile
from types import SimpleNamespace

import httpx
import pytest

from app.schemas.update import UpdateCheckResult
from app.services import update_download
from app.services.update_check import clear_cache


def _valid_archive(path):
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("ResumeForge/start.cmd", "@echo off")
        archive.writestr("ResumeForge/backend/app/main.py", "app = None")


def _release_with_platform_assets() -> dict:
    """真实发行版的资产形状：两个平台的包，各带一份 `.sha256`，**没有**全平台包。

    这段最重要的事实是**顺序**：按名字排序时 `…-macos.zip` 排在 `…-windows.zip` 前面。
    2026-10-01 之前的测试只挂了一个通用包（`ResumeForge-99.0.0.zip`），于是"按名字排序
    取第一个 .zip"这个 bug 一直没被任何用例发现——而它在真实发行版上必然选中 macOS 包。
    """
    return {
        "tag_name": "v99.0.0",
        "name": "测试更新",
        "html_url": "https://github.com/example/ResumeForge/releases/tag/v99.0.0",
        "published_at": "2026-09-24T00:00:00Z",
        "body": "修复测试",
        "zipball_url": "https://api.github.com/repos/example/ResumeForge/zipball/v99.0.0",
        "assets": [
            {
                "name": "ResumeForge-99.0.0-macos.zip",
                "browser_download_url": "https://example.com/ResumeForge-99.0.0-macos.zip",
                "size": 2000,
            },
            {
                "name": "ResumeForge-99.0.0-macos.zip.sha256",
                "browser_download_url": "https://example.com/ResumeForge-99.0.0-macos.zip.sha256",
                "size": 80,
            },
            {
                "name": "ResumeForge-99.0.0-windows.zip",
                "browser_download_url": "https://example.com/ResumeForge-99.0.0-windows.zip",
                "size": 3000,
            },
            {
                "name": "ResumeForge-99.0.0-windows.zip.sha256",
                "browser_download_url": "https://example.com/ResumeForge-99.0.0-windows.zip.sha256",
                "size": 80,
            },
        ],
    }


def _pin_platform(monkeypatch, platform: str | None, *, installable: bool = True) -> None:
    """把"本机是什么系统"钉住。

    不这么做的话，"Windows 用户会拿到 Windows 包"就变成了"跑测试的机器是 Windows
    才成立"——而 CI 的 pytest 矩阵里既有 ubuntu 也有 windows。
    """
    monkeypatch.setattr("app.services.update_check._platform_tag", lambda: platform)
    monkeypatch.setattr("app.services.update_check._install_supported", lambda: installable)


def _serve(monkeypatch, data: dict) -> None:
    async def fake_release(_repo: str) -> dict:
        return data

    monkeypatch.setattr("app.services.update_check._fetch_latest_release", fake_release)


def test_update_check_exposes_a_downloadable_release(client, monkeypatch):
    clear_cache()
    _pin_platform(monkeypatch, "windows")
    _serve(
        monkeypatch,
        {
            "tag_name": "v99.0.0",
            "name": "测试更新",
            "html_url": "https://github.com/example/ResumeForge/releases/tag/v99.0.0",
            "published_at": "2026-09-24T00:00:00Z",
            "body": "修复测试",
            "assets": [
                {
                    "name": "ResumeForge-99.0.0.zip",
                    "browser_download_url": "https://example.com/ResumeForge-99.0.0.zip",
                    "size": 1234,
                }
            ],
        },
    )
    response = client.get("/api/update/check?refresh=true")

    assert response.status_code == 200
    body = response.json()
    assert body["update_available"] is True
    # 不带平台词的通用包仍然可用（只有一个包时走这条）。
    assert body["download_url"].endswith("ResumeForge-99.0.0.zip")
    assert body["download_size"] == 1234
    assert body["installable"] is True


def test_update_check_picks_the_asset_for_the_current_platform(client, monkeypatch):
    """按平台挑包——这是 2026-10-01 那个"应用内更新必然失败"的回归守卫。

    真实发行版挂的是 macos 与 windows 两个包；按名字排序取第一个的话，Windows 用户
    永远下到 macOS 包（里面只有 start.command），校验必然报"更新包缺少 start.cmd"。
    """
    clear_cache()
    _pin_platform(monkeypatch, "windows")
    _serve(monkeypatch, _release_with_platform_assets())

    body = client.get("/api/update/check?refresh=true").json()
    assert body["download_url"].endswith("ResumeForge-99.0.0-windows.zip")
    assert body["asset_name"] == "ResumeForge-99.0.0-windows.zip"
    assert body["download_size"] == 3000
    assert body["installable"] is True
    # 旁边的 .sha256 要一并记下来，下载完用它核对。
    assert body["checksum_url"].endswith("ResumeForge-99.0.0-windows.zip.sha256")

    clear_cache()
    _pin_platform(monkeypatch, "macos")
    body = client.get("/api/update/check?refresh=true").json()
    assert body["download_url"].endswith("ResumeForge-99.0.0-macos.zip")


def test_update_check_never_selects_a_checksum_file(client, monkeypatch):
    """`.zip.sha256` 不是包：挑错了会下载到 64 个字节的文本。"""
    clear_cache()
    _pin_platform(monkeypatch, "windows")
    _serve(
        monkeypatch,
        {
            "tag_name": "v99.0.0",
            "assets": [
                {
                    "name": "ResumeForge-99.0.0-windows.zip.sha256",
                    "browser_download_url": "https://example.com/ResumeForge-99.0.0-windows.zip.sha256",
                    "size": 80,
                }
            ],
            "zipball_url": "https://api.github.com/repos/example/ResumeForge/zipball/v99.0.0",
        },
    )

    body = client.get("/api/update/check?refresh=true").json()
    assert not body["asset_name"].endswith(".sha256")
    assert body["checksum_url"] == ""


def test_update_check_says_so_when_only_another_platform_is_published(client, monkeypatch):
    """只有异构包时：退回源码包并把原因说清楚，而不是给一个必然报错的按钮。"""
    clear_cache()
    _pin_platform(monkeypatch, "windows")
    release = _release_with_platform_assets()
    release["assets"] = [item for item in release["assets"] if "macos" in item["name"]]
    _serve(monkeypatch, release)

    body = client.get("/api/update/check?refresh=true").json()
    assert body["download_url"].endswith("/zipball/v99.0.0")
    assert "macOS" in body["message"]
    assert "源码包" in body["message"]


def test_update_check_does_not_claim_installability_on_non_windows(client, monkeypatch):
    """应用内安装只有 Windows 链路：别的平台即便挑到了包也不该点亮按钮。"""
    clear_cache()
    _pin_platform(monkeypatch, "macos", installable=False)
    _serve(monkeypatch, _release_with_platform_assets())

    body = client.get("/api/update/check?refresh=true").json()
    assert body["download_url"].endswith("-macos.zip")
    assert body["installable"] is False
    # 按钮会隐藏，所以话得说明白：更新是有的，只是这个系统要换种方式装。
    assert "当前系统" in body["message"]


def test_update_check_falls_back_to_the_redirect_probe_when_the_api_is_blocked(
    client, monkeypatch
):
    """用户报的 "HTTP 403" 走的正是这条路：API 不通，但版本号照样答得出来。

    api.github.com 被限流/被网络拦掉时，「检查更新」不该只回一句错误——用户点它
    想知道的就是"有没有新版本"。备用方式不碰 API，读 github.com 的 302 拿 tag。
    """
    clear_cache()

    async def blocked(_repo: str) -> dict:
        raise RuntimeError("GitHub 拒绝了这次匿名请求（HTTP 403）")

    async def fake_tag(_repo: str) -> str:
        return "v99.0.0"

    monkeypatch.setattr("app.services.update_check._fetch_latest_release", blocked)
    monkeypatch.setattr("app.services.update_check._fetch_latest_tag_via_redirect", fake_tag)

    body = client.get("/api/update/check?refresh=true").json()
    assert body["update_available"] is True
    assert body["latest_version"] == "99.0.0"
    assert "备用方式" in body["message"]
    # 备用方式拿不到附件，所以不能声称可以一键更新。
    assert body["installable"] is False
    assert body["release_url"].endswith("/releases")


def test_update_check_says_what_403_means_when_both_paths_fail(client, monkeypatch):
    """两条路都失败时，错误信息必须能让人判断"等一会儿"还是"换网络"。"""
    clear_cache()

    async def blocked(_repo: str) -> dict:
        raise RuntimeError("GitHub 拒绝了这次匿名请求（HTTP 403）：常见原因是同一网络下匿名调用次数用完，或网络内有人拦了 api.github.com")

    async def also_blocked(_repo: str) -> str:
        raise RuntimeError("GitHub 拒绝了这次匿名请求（HTTP 403）")

    monkeypatch.setattr("app.services.update_check._fetch_latest_release", blocked)
    monkeypatch.setattr("app.services.update_check._fetch_latest_tag_via_redirect", also_blocked)

    body = client.get("/api/update/check?refresh=true").json()
    assert body["update_available"] is False
    assert "403" in body["message"]
    assert "备用方式" in body["message"]
    # 两条路都失败时也要给出"接下来怎么办"：稍后再点一次，或手动看图。
    assert "稍后再点一次" in body["message"]


def test_update_check_treats_a_missing_release_as_no_release(client, monkeypatch):
    """仓库还没发过 Release：两条路都应给出"没有 Release"而不是"检查失败"。"""
    clear_cache()

    async def missing(_repo: str) -> dict:
        raise LookupError("仓库还没有发布任何 Release")

    monkeypatch.setattr("app.services.update_check._fetch_latest_release", missing)
    body = client.get("/api/update/check?refresh=true").json()
    assert "还没有发布任何 Release" in body["message"]


def test_update_api_reports_idle_and_rejects_install_before_download(client):
    status = client.get("/api/update/download-status")
    assert status.status_code == 200
    assert status.json()["state"] == "idle"

    response = client.post("/api/update/install", json={"restart": True})
    assert response.status_code == 409
    assert "下载完成" in response.json()["detail"]


def test_update_archive_rejects_path_traversal(tmp_path):
    archive_path = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("../outside.txt", "不要写出去")
        archive.writestr("ResumeForge/start.cmd", "@echo off")
        archive.writestr("ResumeForge/backend/app/main.py", "app = None")

    with pytest.raises(ValueError, match="不安全的路径"):
        update_download._validate_archive(archive_path)


@pytest.mark.asyncio
async def test_download_task_validates_archive_and_reports_ready(tmp_path, monkeypatch):
    update_download._status = update_download._MutableStatus()
    update_download._download_task = None
    update_download._archive_path = None
    monkeypatch.setattr(update_download, "DOWNLOAD_DIRECTORY", tmp_path)

    async def fake_check_for_update():
        return UpdateCheckResult(
            current_version="0.11.0",
            latest_version="99.0.0",
            update_available=True,
            download_url="https://example.com/update.zip",
            download_size=128,
            asset_name="ResumeForge-99.0.0.zip",
            installable=True,
        )

    async def fake_download(_url: str, _size: int | None, target, _checksum_url: str = ""):
        _valid_archive(target)

    monkeypatch.setattr(update_download, "check_for_update", fake_check_for_update)
    monkeypatch.setattr(update_download, "_download_archive", fake_download)

    initial = await update_download.start_download(background=True)
    assert initial.state == "downloading"
    assert initial.background is True
    assert update_download._download_task is not None
    await asyncio.wait_for(update_download._download_task, timeout=1)

    final = update_download.download_status()
    assert final.state == "ready"
    assert final.progress == 100
    assert final.installable is True


def _serve_bytes(monkeypatch, body: bytes, status: int = 200) -> None:
    """让 `_download_archive` 真的走一遍下载代码，但不碰网络。"""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, content=body)

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        update_download.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=transport, **kwargs),
    )


@pytest.mark.asyncio
async def test_download_verifies_the_published_checksum(tmp_path, monkeypatch):
    """发布时旁边的 `.sha256` 要真拿来核对——不匹配就必须停下。"""
    update_download._status = update_download._MutableStatus()
    archive = tmp_path / "pkg.zip"
    _valid_archive(archive)
    body = archive.read_bytes()
    good = update_download._sha256_of(archive)
    _serve_bytes(monkeypatch, body)

    async def fake_checksum(_url: str) -> str:
        return good

    monkeypatch.setattr(update_download, "_fetch_expected_checksum", fake_checksum)
    # 摘要对得上：正常放行。
    await update_download._download_archive(
        "https://example.com/u.zip",
        len(body),
        tmp_path / "out.zip",
        "https://example.com/u.zip.sha256",
    )
    assert (tmp_path / "out.zip").is_file()

    async def wrong_checksum(_url: str) -> str:
        return "0" * 64

    monkeypatch.setattr(update_download, "_fetch_expected_checksum", wrong_checksum)
    with pytest.raises(RuntimeError, match="校验和不匹配"):
        await update_download._download_archive(
            "https://example.com/u.zip",
            len(body),
            tmp_path / "out2.zip",
            "https://example.com/u.zip.sha256",
        )
    assert not (tmp_path / "out2.zip").exists()


@pytest.mark.asyncio
async def test_download_skips_the_checksum_when_the_release_has_none(tmp_path, monkeypatch):
    """退回源码包时没有摘要可对——跳过而不是报错。"""
    update_download._status = update_download._MutableStatus()
    seen: list[str] = []

    async def fake_download(_url, _size, target, checksum_url=""):
        seen.append(checksum_url)
        _valid_archive(target)

    monkeypatch.setattr(update_download, "_download_archive", fake_download)
    await update_download._run_download(
        "https://example.com/a.zip", None, tmp_path / "out.zip", ""
    )

    assert seen == [""]
    assert update_download._status.state == "ready"


def test_frontend_pid_is_read_from_a_bom_prefixed_record(tmp_path, monkeypatch):
    """`runtime/*.json` 是 PS 5.1 写的，**带 UTF-8 BOM**。

    按普通 utf-8 读会抛 JSONDecodeError 并被吞掉，于是 `-StopPids` 永远不传：
    in-app 安装时 Vite 还在跑着，npm ci 覆盖 node_modules 会以 EPERM 失败。
    """
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    expected_pid = os.getpid() + 1
    (runtime / "frontend.json").write_bytes(
        b"\xef\xbb\xbf" + json.dumps({"process_id": expected_pid}).encode("utf-8")
    )
    monkeypatch.setattr(update_download, "PROJECT_ROOT", tmp_path)

    assert update_download._read_frontend_pid() == expected_pid


def test_install_result_prefers_the_installed_version_over_the_updater_state(tmp_path, monkeypatch):
    """成功与否以**现在跑的是哪个版本**为准，更新器的自述只解释失败原因。"""
    monkeypatch.setattr(update_download, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(update_download, "UPDATE_STATUS_PATH", tmp_path / "update-status.json")
    monkeypatch.setattr(update_download, "UPDATE_LOG_PATH", tmp_path / "update.log")
    monkeypatch.setattr(
        update_download, "get_settings", lambda: SimpleNamespace(app_version="0.15.0")
    )

    # 更新器写了 failed，但新版本确实已经跑起来了（例如健康检查超时）→ 算成功。
    update_download.UPDATE_STATUS_PATH.write_text(
        json.dumps({"state": "failed", "target_version": "0.15.0", "message": "健康检查超时"}),
        encoding="utf-8",
    )
    result = update_download.read_install_result()
    assert result is not None and result["state"] == "success"

    # 更新器写了 installing 但卡了很久（覆盖到一半被杀）→ 中断，绝不谎报成功。
    update_download.UPDATE_STATUS_PATH.write_text(
        json.dumps(
            {"state": "installing", "target_version": "0.16.0", "started_at": time.time() - 3600}
        ),
        encoding="utf-8",
    )
    result = update_download.read_install_result()
    assert result is not None and result["state"] == "interrupted"

    update_download.clear_install_result()
    assert update_download.read_install_result() is None


def test_install_result_endpoints(client, tmp_path, monkeypatch):
    monkeypatch.setattr(update_download, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(update_download, "UPDATE_STATUS_PATH", tmp_path / "update-status.json")
    monkeypatch.setattr(update_download, "UPDATE_LOG_PATH", tmp_path / "update.log")

    assert client.get("/api/update/install-result").json() is None

    update_download.UPDATE_STATUS_PATH.write_text(
        json.dumps(
            {
                "state": "failed",
                "from_version": "0.14.2",
                "target_version": "0.99.0",
                "message": "复制文件失败",
            }
        ),
        encoding="utf-8",
    )
    body = client.get("/api/update/install-result").json()
    assert body["state"] == "failed"
    assert body["message"] == "复制文件失败"

    assert client.delete("/api/update/install-result").status_code == 204
    assert client.get("/api/update/install-result").json() is None


@pytest.mark.asyncio
async def test_installer_that_never_starts_does_not_kill_the_backend(monkeypatch):
    """更新器没起来时**不许退出**：否则"应用关了、什么都没发生"就是全部现象。"""
    update_download._status = update_download._MutableStatus()
    update_download._status.state = "installing"
    exited: list[int] = []
    monkeypatch.setattr(update_download, "_read_status_marker", lambda: None)
    monkeypatch.setattr(update_download, "_INSTALL_HANDSHAKE_ATTEMPTS", 2)
    monkeypatch.setattr(update_download, "_INSTALL_HANDSHAKE_INTERVAL", 0.01)
    monkeypatch.setattr(update_download, "os", SimpleNamespace(_exit=exited.append))

    async def instant_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(update_download.asyncio, "sleep", instant_sleep)
    await update_download._stop_current_backend("no-such-install-id")

    assert exited == [], "更新器没起来时绝不能退出后端"
    assert update_download._status.state == "failed"
    assert "更新器没有启动" in update_download._status.message
