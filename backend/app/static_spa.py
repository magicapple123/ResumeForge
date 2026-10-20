# SPDX-License-Identifier: Apache-2.0
"""发布形态下由后端同源提供前端生产静态资产（RF-09 方案 A）。

dev 模式前端由 Vite 独立进程提供（5173 端口 + /api 代理）；发布包携带
``frontend/dist`` 时，本模块把静态资产挂到与 API 同一个 FastAPI 应用上：
单端口同源、无 CORS、无代理，运行期不再需要 Node。

回退语义（最终口径）：以 **404 异常处理器**实现——只有请求确实未命中任何路由
（Starlette 抛 404）、且 **GET/HEAD + 路径不以 ``/api``、``/health`` 开头 +
不在 ``/assets`` 挂载点下 + Accept 含 ``text/html``** 时才回落 ``index.html``；
其余 404 维持原语义。路径存在但方法不对的请求走 Starlette 的 partial-match
**405**（含 Allow 头），不会被页面吞掉——这是用异常处理器而非 catch-all 路由的
根本原因（catch-all 对 GET 构成 FULL match，会系统性把 405 变成 404）。
``/assets/*`` 由 StaticFiles 直接服务，缺失文件返回 404 而不回退（内容哈希
文件名，回退只会掩盖"资产与页面不配套"的真实故障）。
"""

import json
import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.staticfiles import StaticFiles

logger = logging.getLogger(__name__)

# 静态响应的安全头：只加在非 /api 路径上，/api（含 SSE 流的既有头）一律不动。
_STATIC_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
}
# /assets 下是 Vite 内容哈希文件名，文件内容变了名字就变，可以永久缓存。
_ASSETS_CACHE_CONTROL = "public, max-age=31536000, immutable"


class _StaticHeadersMiddleware(BaseHTTPMiddleware):
    """给静态响应补安全头与 ``/assets`` 的不可变缓存头。

    ``/api`` 路径（含 SSE 的 ``Cache-Control: no-cache``、导出接口的
    ``Content-Disposition``）原样透传，不增不减任何响应头。setdefault 保证
    具体路由已声明的头不被覆盖。
    """

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/api"):
            return response
        if path.startswith("/assets/"):
            response.headers.setdefault("Cache-Control", _ASSETS_CACHE_CONTROL)
        for name, value in _STATIC_SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        return response


def _should_spa_fallback(request: Request) -> bool:
    """404 回退判定：只有"浏览器导航语义"的未命中请求才回落到 index.html。

    程序化请求（fetch/API 客户端）不带 text/html，按未找到处理，与未挂载
    静态时行为一致；``/api`` 与 ``/health`` 即使没有匹配到具体路由也绝不回退
    成页面；``/docs`` 与 ``/openapi.json`` 是框架装配早期注册的路由，正常匹配，
    到不了 404。
    """
    if request.method not in ("GET", "HEAD"):
        return False
    if "text/html" not in request.headers.get("accept", ""):
        return False
    path = request.url.path
    if path.startswith("/api") or path.startswith("/health"):
        return False
    # /assets 由 StaticFiles 直接服务，缺失文件必须保持 404。
    within_assets = path == "/assets" or path.startswith("/assets/")
    return not within_assets


def _install_spa_404_fallback(app: FastAPI, dist_dir: Path) -> None:
    """把 SPA 回退装成 404 异常处理器（覆盖 FastAPI 对 StarletteHTTPException
    的默认处理；非回退分支逐字复刻该默认行为，含 405 的 Allow 头透传）。"""
    index_html = dist_dir / "index.html"

    async def spa_404_handler(request: Request, exc: StarletteHTTPException):
        if exc.status_code == 404 and _should_spa_fallback(request):
            return FileResponse(
                index_html,
                media_type="text/html",
                headers={"Cache-Control": "no-cache"},
            )
        headers = getattr(exc, "headers", None)
        if headers:
            return JSONResponse(
                {"detail": exc.detail}, status_code=exc.status_code, headers=headers
            )
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    app.add_exception_handler(StarletteHTTPException, spa_404_handler)


def _check_version_pairing(dist_dir: Path, app_version: str) -> None:
    """静态资产与后端版本的配对校验：不一致记 ERROR 但继续启动。

    小版本错配通常仍可用，阻断启动会把可用的应用变成不可用（ADR §3.4-Q4）；
    version.json 缺失（如本地手工构建）只记 DEBUG 跳过。
    """
    version_file = dist_dir / "version.json"
    if not version_file.is_file():
        logger.debug("静态资产缺少 version.json，跳过版本配对校验：%s", version_file)
        return
    try:
        declared = json.loads(version_file.read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError, AttributeError):
        logger.warning("静态资产 version.json 无法解析，跳过版本配对校验：%s", version_file)
        return
    if declared != app_version:
        logger.error(
            "前端静态资产版本 (%s) 与后端版本 (%s) 不一致，发布包可能混装；"
            "应用将继续启动，如遇页面异常请重新下载完整安装包。",
            declared,
            app_version,
        )


def _mount_dist_root_files(app: FastAPI, dist_dir: Path) -> None:
    """把 dist 根目录的散文件（favicon 等 Vite ``public/`` 资产）注册为 GET 路由。

    Vite 会把 ``public/`` 里的文件原样拷到 dist 根（如 ``resumeforge-icon.png``），
    它们不在 ``/assets`` 挂载点下；不注册的话浏览器请求 favicon 只会拿到
    SPA 回退页面或 404，标签页图标永远是默认地球。逐文件注册而不挂整个根
    目录，是为了不引入 FULL-match 的 catch-all 路由、保住 405 语义（QA R1）。
    缓存用 ``no-cache``：文件名无内容哈希，靠 ETag 协商重验。
    """
    for item in sorted(dist_dir.iterdir()):
        if not item.is_file() or item.name == "index.html":
            continue
        file_path: Path = item

        async def serve_root_file(path: Path = file_path) -> FileResponse:
            return FileResponse(path, headers={"Cache-Control": "no-cache"})

        app.add_api_route(
            f"/{item.name}",
            serve_root_file,
            methods=["GET"],
            include_in_schema=False,
            name=f"spa_root_file_{item.stem}",
        )


def mount_static_spa(app: FastAPI, dist_dir: Path) -> None:
    """把 ``dist_dir`` 挂为同源静态资产；目录不存在时保持纯 API 模式。"""
    if not (dist_dir / "index.html").is_file():
        logger.info("未找到前端静态资产（%s），以纯 API 模式运行", dist_dir)
        return
    app.add_middleware(_StaticHeadersMiddleware)
    assets_dir = dist_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="spa_assets")
    _mount_dist_root_files(app, dist_dir)
    # SPA 回退以 404 异常处理器实现：与路由注册顺序无关（不与 /api 抢匹配），
    # partial-match 的 405 语义天然保留——这是 QA 回归 R1 后定下的最终机制。
    _install_spa_404_fallback(app, dist_dir)
    _check_version_pairing(dist_dir, app.version)
    logger.info("已挂载前端静态资产：%s", dist_dir)
