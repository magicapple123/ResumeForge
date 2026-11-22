# SPDX-License-Identifier: Apache-2.0
"""检查是否有新版本：只读 GitHub Releases API，不做任何自动更新。

设计取舍：
- 只发一个匿名 GET，不带任何用户数据，也不上报本地版本之外的任何信息；
- 结果缓存一段时间，避免用户反复点「检查更新」把 GitHub 的匿名限额用完；
- 任何网络/解析失败都降级为一句可读提示，不影响其它功能。

两层节流（缺一不可，因为它们的失效方式不同）：

1. **15 分钟结果缓存**：`refresh=false`（界面上的「检查更新」首次点击）命中缓存就不发
   网络请求。它保证"正常路径下第二次点击不打上游"。
2. **60 秒最小间隔**：`refresh=true`（「重新检查」）在两分钟内连着点也只打一次上游。
   缓存层挡不住刷新，而前端的倒计时按钮只是体验——用户可以绕过它，所以后端也要挡。

降级文案的口径在 `update_check_degrade.py`：结论（有没有新版本）在前，原因与恢复时间在
括号里。日志用 `warning` 而不是 `info`——桌面壳与便携启动器默认 `--log-level warning`，
`info` 会被整条吞掉，出问题时日志里就查不到"这次为什么降级了"。
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
from datetime import UTC, datetime
from urllib.parse import unquote

import httpx

from ..config import get_settings, is_desktop_shell
from ..schemas.update import UpdateCheckResult

# 从 net_proxy 的 re-export 取工厂，**不要**写成 `from .net_client import build_async_client`：
# `net_client` 顶层就 `from . import net_proxy`，而 `net_proxy` 末尾又 re-export 工厂——两者
# 互相 import。只有从 `net_proxy` 侧进入（net_proxy 先跑完、末尾再去 import net_client）
# 才保证 net_client 已经完整执行；直取那个名字会让 `import app.services.update_check` 当场
# ImportError（2.2.2 改走工厂时引入，`update_sources` 同批同款）。
from .net_proxy import build_async_client
from .update_check_assets import _AssetChoice, select_asset
from .update_check_degrade import build_api_error, degraded_available_message

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
# 「重新检查」的最小间隔：连点 5 次只应该产生 1 次上游请求。缓存层挡不住 refresh，
# 所以这里单独设一道闸；界面上同时有倒计时按钮，但那只算体验，不能当约束。
_MIN_REFRESH_INTERVAL_SECONDS = 60
_MAX_RESPONSE_BYTES = 512 * 1024
_TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0)
_USER_AGENT = "ResumeForge-update-check"

# 更新说明（Release body）在界面上要渲染成 markdown 子集，太长的正文没必要全带回去：
# 一来设置页那个滚动区看不了那么远，二来响应体越小越不容易出岔子。`UpdateCheckResult`
# 里 `notes` 的 schema 上限是 4000，所以**截断后的总长必须 ≤ 4000**——提示语的长度要
# 从预算里扣掉，否则拼上去就超限，构造结果时会直接抛 ValidationError。
NOTES_BUDGET = 4000
NOTES_TRUNCATED_HINT = "……（完整说明见发布页）"
# 硬截会给用户看半句话或半行表格，只有"最后一个换行"退得太靠前（留存不足预算的
# 60%，等于白丢一半正文）时才认输硬截。
_NOTES_MIN_RETAIN_RATIO = 0.6

_cache: dict[str, tuple[float, UpdateCheckResult]] = {}


def repository() -> str:
    """检查更新时查询的 ``owner/repo``。

    优先级：环境变量（开发/自建部署的显式覆盖）→ 设置页「外部连接 → 更新源」→
    内置默认。设置页那一档让用户不必改环境变量就能换自托管发行源。
    """
    explicit = os.environ.get(REPOSITORY_ENV_VAR, "").strip()
    if explicit:
        return explicit
    from .system_sources import update_repository

    return update_repository()


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


def _select_asset(data: dict) -> _AssetChoice:
    """挑出**适用于当前平台与形态**的安装包（实现与平台词表在 ``update_check_assets``）。

    形态决定扩展名：桌面壳要的是 `ResumeForge-Setup-<版本>.exe`（下载、校验、静默安装
    都在壳里），控制台与便携版要的是 `-windows.zip`（`update_download` 覆盖安装读的就是
    压缩包）。这个错配的代价不对称——桌面拿到 zip 只会覆盖 `resources/payload`，
    `app.asar` 一个字节都不动，装完半新半旧（2026-11-20 实机确认）。
    """
    prefer = "installer" if is_desktop_shell() else "zip"
    return select_asset(data, _platform_tag(), prefer)


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
    url = RELEASES_API.format(repo=repo)
    # 走 net_client 的工厂，不自己建客户端：代理只由它决定（设置里的 proxy_mode → 环境
    # 变量 → 系统代理）。此前直接 `httpx.AsyncClient(trust_env)` 只认环境变量，用户开着
    # 系统代理、或在设置页选了代理，这条"检查更新"照样裸奔直连。
    async with (
        build_async_client(url=url, timeout=_TIMEOUT, follow_redirects=False) as client,
        client.stream("GET", url, headers=headers) as response,
    ):
        if response.status_code == 404:
            raise LookupError("仓库还没有发布任何 Release")
        if response.status_code != 200:
            # 把状态码与限额头一起带出去：降级文案要据此说"等一会儿"还是"换网络"。
            raise build_api_error(response, _github_error_message(response.status_code, repo))
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
    # 同 `_fetch_latest_release`：备用探测也要走同一条出网口径，否则「API 被拦、改走
    # github.com」这条出路在代理环境里同样是直连。
    async with build_async_client(url=url, timeout=_TIMEOUT, follow_redirects=False) as client:
        response = await client.get(url, headers={"User-Agent": _USER_AGENT})
    if response.status_code == 404:
        raise LookupError("仓库还没有发布任何 Release")
    if response.status_code not in (301, 302, 303, 307, 308):
        raise build_api_error(response, _github_error_message(response.status_code, repo))
    location = str(response.headers.get("location") or "")
    if _TAG_MARKER not in location:
        # 没有 Release 时 GitHub 会重定向到 /releases 列表页（没有 tag 段）。
        raise LookupError("仓库还没有发布任何 Release")
    return unquote(location.split(_TAG_MARKER, 1)[1]).strip("/")


def _truncate_notes(notes: str, limit: int = NOTES_BUDGET) -> str:
    """按行截断更新说明，末尾补一句「完整说明见发布页」。

    为什么不直接 ``notes[:4000]``：v2.0.0 的公告里有表格，硬切会把最后一行表格切成
    半行（前端渲染出来就是一行缺列的残缺表格），也会把句子从中间截断。这里按行退：
    先取前 ``limit`` 个字符，再退到最后一个换行处；只有换行退得太靠前（保留不足
    60% 预算）时才认输硬截——那是"整段只有一行"的情况，退回去等于什么都不显示。

    恰好 ``limit`` 或更短时原样返回，不追加提示：没被截断就不该暗示用户去看发布页。
    """
    text = notes or ""
    if len(text) <= limit:
        return text
    suffix = f"\n\n{NOTES_TRUNCATED_HINT}"
    # 提示语占的字符要从预算里让出来，总长才停得在 schema 的 4000 以内。
    budget = max(limit - len(suffix), 1)
    head = text[:budget]
    cut = head.rfind("\n")
    floor = int(budget * _NOTES_MIN_RETAIN_RATIO)
    body = head[:cut] if cut >= floor else head
    # 行尾空格与 ``\r`` 一起清掉，避免留下"看不见的半截"。
    return f"{body.rstrip()}{suffix}"


async def check_for_update(*, refresh: bool = False) -> UpdateCheckResult:
    """返回当前版本与最新版本的对比结果。

    两层节流见模块文档：``refresh=False`` 走 15 分钟缓存，``refresh=True`` 受 60 秒
    最小间隔约束。命中任何一层时返回的结果带 ``cached=True``，方便界面与用例区分
    "这次真的问了 GitHub"和"这次是旧结果"。
    """
    current = get_settings().app_version
    repo = repository()
    cached = _cache.get(repo)
    if cached is not None:
        age = time.time() - cached[0]
        if not refresh and age < _CACHE_SECONDS:
            return _cached_result(cached)
        if refresh and age < _MIN_REFRESH_INTERVAL_SECONDS:
            return _cached_result(cached)

    api_failure = ""
    failure: Exception | None = None
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
        failure = exc
        # warning 而不是 info：启动器与桌面壳默认 --log-level warning，info 会被吞掉，
        # 出问题时日志里就查不到"这次为什么降级"。状态码与是否限额必须写进日志——
        # 那是唯一能区分"等一会儿"和"换网络"的证据。
        logger.warning(
            "检查更新主路径失败（status=%s rate_limited=%s），改用备用探测：%s",
            getattr(exc, "status_code", 0),
            getattr(exc, "rate_limited", False),
            api_failure,
        )
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
                    # 这一条必须标出来：它和"上游确实没给版本号"在 `latest_version`
                    # 上长得一样（都是空串），但界面该说的话完全不同——"本次没能确认"
                    # 而不是「未提供」。桌面壳可能同时刻查到新版并弹窗，不能让设置页
                    # 用一句「未提供」去和它唱反调。
                    degraded=True,
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
                # 结论前置：先回答"有没有新版本"，再说"更新说明这次没取到、为什么、
                # 什么时候恢复"。措辞与换算都在 update_check_degrade 里。
                message=(
                    degraded_available_message(
                        latest=latest,
                        release_page=RELEASES_PAGE.format(repo=repo),
                        failure=failure,
                    )
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
        desktop = is_desktop_shell()
        # 桌面形态恒不可安装（2026-11-20）：壳有一套完整链路（updater.js 下载 Setup.exe +
        # sha256 + 静默安装），页内那套只会覆盖 `resources/payload`。之前这里只看系统不看
        # 形态，Windows 桌面上 `installable` 恒为 true，界面弹窗于是把用户引到半更新那条路。
        installable = choice.installable and available and _install_supported() and not desktop
        if not available:
            message = f"已是最新版本（{current}）"
        elif not choice.installable:
            message = f"有新版本 {latest}，但{choice.reason}；请到发布页手动下载"
        elif desktop:
            # 前端凭 `installable=false` 把主按钮换成「去更新」（走壳）。这里说清原因，
            # 免得用户以为是按钮坏了；形态退让（只有便携包）也一并带出去。
            extra = f"；{choice.reason}" if choice.reason else ""
            message = f"有新版本 {latest} 可用；桌面版请使用应用内更新器{extra}"
        elif not _install_supported():
            # 挑得到包、但这台机器不走应用内安装（目前只有 Windows 那条链路）。按钮会
            # 隐藏，所以得在这里说清"更新是有的，只是要换种方式"，否则界面看起来像没反应。
            message = f"有新版本 {latest} 可用；当前系统请用 update 脚本或到发布页手动下载"
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
            notes=_truncate_notes(notes),
            # `release_body` 承载**完整原文**，前端靠它挑语言段（`selectReleaseNotes`）。
            # 以前只在 `len(notes) > NOTES_BUDGET` 时才填，理由是"没截断就不用第二份"——
            # 但那让"挑语言"这件事取决于一张与语言无关的截断开关：任何一次调整
            # `NOTES_BUDGET`（或放开 `_truncate_notes` 的行数策略）都会让中文段落在截断点
            # 之后，`notes` 里没有、`release_body` 又是空的，中文模式静默退回英文。
            # 现在无条件填：131072 远大于任何正常公告，`notes` 的 4000 截断照旧留给
            # 老客户端与数据库字段。
            release_body=notes[:131072],
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
        # 连不上同样"没得出有没有新版本的结论"，与上面备用探测失败同属一类：
        # 界面要说的是"本次没能确认"，不是「未提供」。
        degraded=True,
    )


def _remember(repo: str, result: UpdateCheckResult) -> UpdateCheckResult:
    """记下这次结果（含失败）并打上时间戳。"""
    result.checked_at = datetime.now(UTC)
    _cache[repo] = (time.time(), result)
    return result


def _cached_result(entry: tuple[float, UpdateCheckResult]) -> UpdateCheckResult:
    """命中节流时把 ``cached=True`` 标出来。

    用 ``model_copy`` 而不是原地改缓存里那一份：它是所有调用方共享的对象，就地改会把
    "这次是旧结果"永久写进缓存，之后真正发过一次网络请求的调用也会被标成缓存命中。
    """
    return entry[1].model_copy(update={"cached": True})


def clear_cache() -> None:
    """测试用：清掉进程内缓存。"""
    _cache.clear()


__all__ = ["check_for_update", "clear_cache", "repository"]
