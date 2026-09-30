"""检查是否有新版本：只读 GitHub Releases API，不做任何自动更新。

设计取舍：
- 只发一个匿名 GET，不带任何用户数据，也不上报本地版本之外的任何信息；
- 结果缓存一段时间，避免用户反复点「检查更新」把 GitHub 的匿名限额用完；
- 任何网络/解析失败都降级为一句可读提示，不影响其它功能。
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import unquote

import httpx

from ..config import get_settings
from ..schemas.update import UpdateCheckResult

logger = logging.getLogger(__name__)

DEFAULT_REPOSITORY = "magicapple123/ResumeForge"
REPOSITORY_ENV_VAR = "RESUMEFORGE_UPDATE_REPO"
RELEASES_API = "https://api.github.com/repos/{repo}/releases/latest"
# 备用探测：github.com 的 `releases/latest` 会 302 到具体 tag。
# 它**不经过 api.github.com**，所以匿名限额用完、或者网络里只拦了 API 域名时照样能用
# （用户报的 "HTTP 403" 就是这一类：本机实测 API 正常、他那条网络返回 403）。
# 代价是只拿得到版本号，拿不到更新说明与附件下载地址——够用来回答"有没有新版本"。
RELEASES_REDIRECT = "https://github.com/{repo}/releases/latest"
RELEASES_PAGE = "https://github.com/{repo}/releases"
_TAG_MARKER = "/releases/tag/"

_CACHE_SECONDS = 900
_MAX_RESPONSE_BYTES = 512 * 1024
_TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0)
_USER_AGENT = "ResumeForge-update-check"

_cache: dict[str, tuple[float, UpdateCheckResult]] = {}


def repository() -> str:
    return os.environ.get(REPOSITORY_ENV_VAR, "").strip() or DEFAULT_REPOSITORY


def _version_tuple(value: str) -> tuple[int, ...]:
    """把 ``v0.6.0`` / ``0.6`` 这样的标签变成可比较的元组；无法解析时返回空元组。"""
    cleaned = value.strip().lstrip("vV")
    parts: list[int] = []
    for chunk in cleaned.replace("-", ".").split("."):
        digits = "".join(char for char in chunk if char.isdigit())
        if not digits:
            break
        parts.append(int(digits))
    return tuple(parts)


def _is_newer(latest: str, current: str) -> bool:
    latest_tuple = _version_tuple(latest)
    current_tuple = _version_tuple(current)
    if not latest_tuple or not current_tuple:
        return False
    size = max(len(latest_tuple), len(current_tuple))
    return latest_tuple + (0,) * (size - len(latest_tuple)) > current_tuple + (0,) * (
        size - len(current_tuple)
    )


_PLATFORM_TOKENS: dict[str, frozenset[str]] = {
    "windows": frozenset({"windows", "win", "win32", "win64"}),
    "macos": frozenset({"macos", "mac", "osx", "darwin"}),
    "linux": frozenset({"linux"}),
}
_PLATFORM_LABELS = {"windows": "Windows", "macos": "macOS", "linux": "Linux"}


def _platform_tag() -> str | None:
    """本机对应的平台词；认不出来时 ``None``。

    单独成一个函数是为了让测试能替换它：pytest 矩阵里既有 ubuntu 也有 windows，
    "Windows 用户会拿到 Windows 包"这条断言不能取决于跑测试的是哪台机器。
    """
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    if sys.platform.startswith("linux"):
        return "linux"
    return None


def _install_supported() -> bool:
    """这台机器能不能走"应用内下载并覆盖安装"。

    只有 Windows 那条链路（`update_download.schedule_install` 用 PowerShell 更新器
    覆盖文件并重启），所以别的平台即便挑到了包也不该点亮按钮。单独成函数同样是为了
    让测试能替换：否则"Windows 上可安装"会变成"跑测试的机器是 Windows 才成立"。
    """
    return os.name == "nt"


@dataclass(frozen=True)
class _AssetChoice:
    """从 Release 的附件里挑出来的那个安装包。"""

    url: str
    name: str
    size: int | None
    checksum_url: str
    installable: bool
    reason: str


def _asset_platform(name: str) -> str | None:
    """附件名里的平台词 → 平台；没有平台词时 ``None``（通用包）。"""
    stem = name.lower()
    if stem.endswith(".zip"):
        stem = stem[: -len(".zip")]
    tokens = {token for token in re.split(r"[-_.]+", stem) if token}
    for key, aliases in _PLATFORM_TOKENS.items():
        if tokens & aliases:
            return key
    return None


def _checksum_url_for(assets: object, name: str) -> str:
    """同名的 ``.sha256`` 附件地址（发布脚本会一并生成）。"""
    if not isinstance(assets, list):
        return ""
    wanted = f"{name}.sha256"
    for item in assets:
        if not isinstance(item, dict) or str(item.get("name") or "") != wanted:
            continue
        url = str(item.get("browser_download_url") or "")
        if url.startswith("https://"):
            return url[:1024]
    return ""


def _select_asset(data: dict) -> _AssetChoice:
    """挑出**适用于当前平台**的安装包，不看附件列表的顺序。

    发行版挂的是 `ResumeForge-<版本>-windows.zip` 与 `…-macos.zip` 两个包（各带一份
    `.sha256`）。这里原先按文件名排序取第一个 `.zip`——`macos` < `windows`，于是
    Windows 用户永远下到 macOS 包，而那个包里只有 `start.command`、没有 `start.cmd`，
    校验必然失败：按钮摆在那里，一点就报错（2026-10-01 实测确认）。
    """
    platform = _platform_tag()
    wanted = _PLATFORM_TOKENS.get(platform or "", frozenset())
    assets = data.get("assets")

    best_rank = 0
    best_name = ""
    best_item: dict | None = None
    foreign: set[str] = set()

    if isinstance(assets, list):
        for item in assets:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "")
            url = str(item.get("browser_download_url") or "")
            # `.zip.sha256` 不以 `.zip` 结尾，天然被排除。
            if not name.lower().endswith(".zip") or not url.startswith("https://"):
                continue
            asset_platform = _asset_platform(name)
            if asset_platform is not None and asset_platform in wanted:
                rank = 2
            elif asset_platform is None and name.lower().startswith("resumeforge"):
                # 不带平台词的通用包（以后若只挂一个包，走这条）。
                rank = 1
            else:
                if asset_platform is not None:
                    foreign.add(asset_platform)
                continue
            if rank > best_rank or (rank == best_rank and name < best_name):
                best_rank, best_item, best_name = rank, item, name

    if best_item is not None:
        size = best_item.get("size")
        return _AssetChoice(
            url=str(best_item.get("browser_download_url") or ""),
            name=best_name[:256],
            size=int(size) if isinstance(size, int) and size >= 0 else None,
            checksum_url=_checksum_url_for(assets, best_name),
            installable=True,
            reason="",
        )

    if foreign:
        labels = "、".join(sorted(_PLATFORM_LABELS.get(key, key) for key in foreign))
        reason = f"这个版本只上传了 {labels} 安装包，没有适用于当前系统的"
    else:
        reason = "这个版本没有上传安装包"

    # 最后一条出路：GitHub 给每个 tag 自带一份源码包，它同样含 `start.cmd` 与
    # `backend/app/main.py`，校验与安装都过得去。保留它是有意的——去掉它会让"维护者
    # 忘了传某个平台的包"从"照常更新"直接变成"更新按钮彻底不可用"。
    source_url = str(data.get("zipball_url") or "")
    if source_url.startswith("https://"):
        return _AssetChoice(
            url=source_url,
            name="GitHub 源码包.zip",
            size=None,
            checksum_url="",
            installable=True,
            reason=f"{reason}，这次用源码包更新" if foreign else "",
        )
    return _AssetChoice(url="", name="", size=None, checksum_url="", installable=False, reason=reason)


def _github_error_message(status_code: int, repo: str) -> str:
    """把 GitHub 的状态码翻译成用户能判断"该等一下还是该换网络"的一句话。

    「检查更新失败：GitHub 返回了 HTTP 403」这种原文对用户毫无用处：403 既可能是
    匿名调用限额用完（等一会儿就好），也可能是网络里有人拦了 api.github.com
    （等多久都没用，得走备用方式或手动看）。这里把它们分开说。
    """
    if status_code == 403:
        return (
            "GitHub 拒绝了这次匿名请求（HTTP 403）：常见原因是同一网络下匿名调用次数"
            "用完，或网络内有人拦了 api.github.com"
        )
    if status_code == 429:
        return "GitHub 提示请求过于频繁（HTTP 429），稍后再试即可"
    if status_code >= 500:
        return f"GitHub 服务暂时不可用（HTTP {status_code}），稍后再试"
    return f"GitHub 返回了 HTTP {status_code}"


async def _fetch_latest_release(repo: str) -> dict:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": _USER_AGENT,
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
        async with client.stream("GET", RELEASES_API.format(repo=repo), headers=headers) as response:
            if response.status_code == 404:
                raise LookupError("仓库还没有发布任何 Release")
            if response.status_code != 200:
                raise RuntimeError(_github_error_message(response.status_code, repo))
            body = bytearray()
            async for chunk in response.aiter_bytes():
                if len(body) + len(chunk) > _MAX_RESPONSE_BYTES:
                    raise RuntimeError("GitHub 响应过大，已停止读取")
                body.extend(chunk)
    data = json.loads(body)
    if not isinstance(data, dict):
        raise RuntimeError("GitHub 响应格式不符合预期")
    return data


async def _fetch_latest_tag_via_redirect(repo: str) -> str:
    """备用探测：跟着 github.com 的 302 拿到最新 tag，全程不碰 api.github.com。

    返回形如 ``v0.12.0``；拿不到就抛错，由调用方决定怎么措辞。
    """
    url = RELEASES_REDIRECT.format(repo=repo)
    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
        response = await client.get(url, headers={"User-Agent": _USER_AGENT})
    if response.status_code == 404:
        raise LookupError("仓库还没有发布任何 Release")
    if response.status_code not in (301, 302, 303, 307, 308):
        raise RuntimeError(_github_error_message(response.status_code, repo))
    location = str(response.headers.get("location") or "")
    if _TAG_MARKER not in location:
        # 没有 Release 时 GitHub 会重定向到 /releases 列表页（没有 tag 段）。
        raise LookupError("仓库还没有发布任何 Release")
    return unquote(location.split(_TAG_MARKER, 1)[1]).strip("/")


async def check_for_update(*, refresh: bool = False) -> UpdateCheckResult:
    """返回当前版本与最新版本的对比结果。"""
    current = get_settings().app_version
    repo = repository()
    cached = _cache.get(repo)
    if not refresh and cached is not None and time.time() - cached[0] < _CACHE_SECONDS:
        return cached[1]

    api_failure = ""
    try:
        data = await _fetch_latest_release(repo)
    except LookupError:
        return _remember(repo, _no_release_result(current, repo))
    except (httpx.TimeoutException, httpx.RequestError) as exc:
        logger.info("检查更新失败（网络）：%s", exc)
        return _remember(repo, _unreachable_result(current, repo))
    except (RuntimeError, ValueError) as exc:
        # 主路径失败（限流、被拦、响应异常）不直接认输：先用不碰 API 的备用方式问一次
        # "到底有没有新版本"。用户点「检查更新」想知道的就是这一件事，
        # 而"接口不可用"不该等于"回答不了"。
        api_failure = str(exc)
        logger.info("检查更新主路径失败，改用备用探测：%s", api_failure)
        try:
            tag = await _fetch_latest_tag_via_redirect(repo)
        except LookupError:
            return _remember(repo, _no_release_result(current, repo))
        except (RuntimeError, httpx.HTTPError) as fallback_exc:
            logger.info("检查更新备用探测也失败：%s", fallback_exc)
            return _remember(
                repo,
                UpdateCheckResult(
                    current_version=current,
                    message=(
                        f"检查更新失败：{api_failure}。备用方式这次也没成功"
                        f"（{fallback_exc}），稍后再点一次通常就好了；"
                        f"也可以到 {RELEASES_PAGE.format(repo=repo)} 手动查看"
                    )[:1000],
                ),
            )
        latest = tag.lstrip("vV") or current
        available = _is_newer(tag or latest, current)
        return _remember(
            repo,
            UpdateCheckResult(
                current_version=current,
                latest_version=latest,
                update_available=available,
                release_name=tag[:256],
                release_url=RELEASES_PAGE.format(repo=repo),
                message=(
                    f"检测到新版本 {latest}（GitHub 接口这次不可用，已用备用方式确认）；"
                    f"更新说明与安装包请在 Release 页查看"
                    if available
                    else f"已是最新版本（{current}）"
                ),
            ),
        )
    else:
        tag = str(data.get("tag_name") or "").strip()
        latest = tag.lstrip("vV") or current
        available = _is_newer(tag or latest, current)
        notes = str(data.get("body") or "").strip()
        choice = _select_asset(data)
        installable = choice.installable and available and _install_supported()
        if not available:
            message = f"已是最新版本（{current}）"
        elif not choice.installable:
            message = f"有新版本 {latest}，但{choice.reason}；请到发布页手动下载"
        elif choice.reason:
            message = f"有新版本 {latest} 可用（{choice.reason}）"
        else:
            message = f"有新版本 {latest} 可用"
        result = UpdateCheckResult(
            current_version=current,
            latest_version=latest,
            update_available=available,
            release_name=str(data.get("name") or tag)[:256],
            release_url=str(data.get("html_url") or RELEASES_PAGE.format(repo=repo))[:512],
            published_at=str(data.get("published_at") or "")[:64],
            notes=notes[:4000],
            download_url=choice.url[:1024],
            download_size=choice.size,
            asset_name=choice.name,
            checksum_url=choice.checksum_url,
            installable=installable,
            message=message,
        )
    return _remember(repo, result)


def _no_release_result(current: str, repo: str) -> UpdateCheckResult:
    return UpdateCheckResult(
        current_version=current,
        message=f"仓库还没有发布任何 Release，可以到 {RELEASES_PAGE.format(repo=repo)} 查看",
    )


def _unreachable_result(current: str, repo: str) -> UpdateCheckResult:
    return UpdateCheckResult(
        current_version=current,
        message="无法连接 GitHub 检查更新，请确认网络后重试",
    )


def _remember(repo: str, result: UpdateCheckResult) -> UpdateCheckResult:
    """记下这次结果（含失败）并打上时间戳。"""
    result.checked_at = datetime.now(timezone.utc)
    _cache[repo] = (time.time(), result)
    return result


def clear_cache() -> None:
    """测试用：清掉进程内缓存。"""
    _cache.clear()


__all__ = ["check_for_update", "clear_cache", "repository"]
