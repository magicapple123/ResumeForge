# SPDX-License-Identifier: Apache-2.0
"""桌面壳形态的更新检查与写接口守卫（2026-11-20：8.3 / 8.4）。

两条通道的分工决定了这里要钉两件事：

- **形态决定扩展名**。桌面壳要 `ResumeForge-Setup-<版本>.exe`（`desktop/updater.js`
  自己下载、sha256 校验、静默安装）；控制台与便携版要 `-windows.zip`（`update_download`
  的覆盖安装读的是压缩包）。v2.1.0 两种资产同时挂在同一个 Release 上，只按扩展名筛就
  永远命中 zip——桌面用户因此拿不到安装器直链。
- **页内写接口在桌面形态下必须拒**。它只会覆盖 `resources/payload`，`app.asar` 一个
  字节都不动，装完半新半旧。此前唯一拦住它的是 `UpdateCard.tsx` 里的一个前端布尔量。
"""

from __future__ import annotations

from app.services.update_check import clear_cache

ZIP_SIZE = 31_800_000
EXE_SIZE = 188_000_000


def _asset(name: str, size: int) -> dict:
    return {
        "name": name,
        "browser_download_url": f"https://example.com/{name}",
        "size": size,
    }


def _release(*, installer: bool = True, portable: bool = True) -> dict:
    """v2.1.0 的资产形状：便携包在前、安装器在后（顺序不该影响挑选结果）。"""
    assets: list[dict] = []
    if portable:
        assets += [
            _asset("ResumeForge-99.0.0-windows.zip", ZIP_SIZE),
            _asset("ResumeForge-99.0.0-windows.zip.sha256", 80),
        ]
    if installer:
        assets += [
            _asset("ResumeForge-Setup-99.0.0.exe", EXE_SIZE),
            _asset("ResumeForge-Setup-99.0.0.exe.sha256", 80),
        ]
    return {
        "tag_name": "v99.0.0",
        "name": "测试更新",
        "html_url": "https://github.com/example/ResumeForge/releases/tag/v99.0.0",
        "published_at": "2026-11-20T00:00:00Z",
        "body": "修复测试",
        "assets": assets,
        "zipball_url": "https://api.github.com/repos/example/ResumeForge/zipball/v99.0.0",
    }


def _pin(monkeypatch, *, desktop: bool, platform: str | None = "windows") -> None:
    """把"本机是什么系统、是不是桌面壳"都钉住。

    两个都要钉：不钉平台，"桌面拿到 exe"就变成"跑测试的机器是 Windows 才成立"；
    不钉形态，`RF_DESKTOP_SHELL` 恰好被设过时，另一批用例会连带变红。
    """
    monkeypatch.setattr("app.services.update_check._platform_tag", lambda: platform)
    monkeypatch.setattr("app.services.update_check._install_supported", lambda: True)
    monkeypatch.setattr("app.services.update_check.is_desktop_shell", lambda: desktop)
    monkeypatch.setattr("app.services.update_download.is_desktop_shell", lambda: desktop)


def _serve(monkeypatch, data: dict) -> None:
    async def fake_release(_repo: str) -> dict:
        return data

    monkeypatch.setattr("app.services.update_check._fetch_latest_release", fake_release)


def test_desktop_form_is_offered_the_setup_installer(client, monkeypatch):
    """8.3：桌面形态的 `download_url` 必须是 Setup.exe，而不是便携包。"""
    clear_cache()
    _pin(monkeypatch, desktop=True)
    _serve(monkeypatch, _release())

    body = client.get("/api/update/check?refresh=true").json()

    assert body["download_url"].endswith("ResumeForge-Setup-99.0.0.exe")
    assert body["asset_name"] == "ResumeForge-Setup-99.0.0.exe"
    assert body["download_size"] == EXE_SIZE
    # `.sha256` 按 `name + ".sha256"` 配对，对 exe 天然适用。
    assert body["checksum_url"].endswith("ResumeForge-Setup-99.0.0.exe.sha256")


def test_desktop_form_is_not_installable_in_page(client, monkeypatch):
    """8.4：桌面形态恒 `installable=false`，并说清该走哪条路。

    这一条挡的是"弹窗只看 installable"那条链：Windows 桌面上它此前恒为 true，
    点「立即更新」就去下便携包覆盖 `resources/payload`。
    """
    clear_cache()
    _pin(monkeypatch, desktop=True)
    _serve(monkeypatch, _release())

    body = client.get("/api/update/check?refresh=true").json()

    assert body["update_available"] is True
    assert body["installable"] is False
    assert "应用内更新器" in body["message"]


def test_portable_form_still_gets_the_portable_zip(client, monkeypatch):
    """非桌面形态不受 8.3 影响：仍旧拿 `-windows.zip`，并且可以页内安装。"""
    clear_cache()
    _pin(monkeypatch, desktop=False)
    _serve(monkeypatch, _release())

    body = client.get("/api/update/check?refresh=true").json()

    assert body["download_url"].endswith("ResumeForge-99.0.0-windows.zip")
    assert body["asset_name"] == "ResumeForge-99.0.0-windows.zip"
    assert body["download_size"] == ZIP_SIZE
    assert body["installable"] is True


def test_desktop_form_falls_back_to_the_zip_and_says_so(client, monkeypatch):
    """只上传了便携包时，桌面形态退到 zip（总比没有强），但必须在 message 里说明。

    退让的方向是单向的：反过来（只上传了 exe 的非桌面形态）不能选 exe——装不上。
    """
    clear_cache()
    _pin(monkeypatch, desktop=True)
    _serve(monkeypatch, _release(installer=False))

    body = client.get("/api/update/check?refresh=true").json()

    assert body["download_url"].endswith("ResumeForge-99.0.0-windows.zip")
    assert "没有上传桌面安装包" in body["message"]
    # 即便挑到了包，桌面形态仍然不许页内安装。
    assert body["installable"] is False


def test_portable_form_never_selects_the_setup_installer(client, monkeypatch):
    """形态与扩展名不能错配：没有 zip 时宁可回落源码包，也不选 exe。"""
    clear_cache()
    _pin(monkeypatch, desktop=False)
    _serve(monkeypatch, _release(portable=False))

    body = client.get("/api/update/check?refresh=true").json()

    assert ".exe" not in body["download_url"]
    assert body["download_url"].endswith("/zipball/v99.0.0")


def test_desktop_form_refuses_the_in_page_download_and_install(client, monkeypatch):
    """8.4：两个写接口在桌面形态下都是 409，且优先于"还没下载完成"这类业务错误。"""
    clear_cache()
    _pin(monkeypatch, desktop=True)

    download = client.post("/api/update/download", json={"background": True})
    assert download.status_code == 409
    assert "桌面版请使用应用内更新器" in download.json()["detail"]

    install = client.post("/api/update/install", json={"restart": False})
    assert install.status_code == 409
    assert "桌面版请使用应用内更新器" in install.json()["detail"]
