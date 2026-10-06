"""FastAPI 应用装配与生命周期配置。"""

import logging
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import models  # noqa: F401 - 确保全部模型注册到 Base.metadata
from .api import (
    analytics,
    apply,
    assistant,
    ats,
    candidate_jobs,
    claims,
    datasets,
    drill,
    interview,
    interview_experiences,
    interview_history,
    job_match,
    jobs,
    knowledge,
    materials,
    profile,
    referrals,
    reminders,
    resume_risk,
    resume_templates as resume_templates_api,
    resume_writing,
    resumes,
    search,
    settings as settings_api,
    share_packages,
    skills,
    stats,
    system as system_api,
    tracker,
    trash,
    update as update_api,
    webform,
)
from . import database
from .config import DATA_DIR, get_settings
from .database import Base, ensure_sqlite_columns, run_sqlite_maintenance
from .database_compat import SQLITE_REQUIRED_COLUMNS
from .database_migrations import is_unversioned_legacy_database, run_database_migrations
from .middleware import RequestContextMiddleware, RequestIdFilter, get_request_id
from .services.apply import apply_service
from .services.apply.task_runner import get_task_runner
from .services.data_backup import cleanup_temp_directories
from .services.job.job_match_background import get_job_match_background_runner
from .services.webform import browser as webform_browser
from .services.webform import stop_live as stop_webform_live


_LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] [request_id=%(request_id)s] %(message)s"
# 滚动日志的单文件上限与份数：5MB×5 足够回溯近期排障，又不会吞掉磁盘。
_LOG_FILE_MAX_BYTES = 5 * 1024 * 1024
_LOG_FILE_BACKUP_COUNT = 5


def _log_level(name: str) -> int:
    """把配置里的日志级别名转成常量；无法识别时退回 INFO 而不是启动失败。"""
    level = logging.getLevelName(str(name).upper())
    return level if isinstance(level, int) else logging.INFO


_file_log_handler: logging.Handler | None = None


def attach_file_log_handler(log_dir: Path) -> logging.Handler | None:
    """把滚动文件日志挂到根 logger（幂等；已挂过时返回 None）。

    运行日志原先只有启动器重定向的 stdout/stderr（``runtime/*.log``），没有大小
    上限，长期挂机会无限膨胀。这里在数据目录下追加一份滚动文件；幂等保证测试里
    多次装配应用不会挂出一把 handlers。
    """
    global _file_log_handler
    if _file_log_handler is not None:
        return None
    log_dir.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        log_dir / "backend.log",
        maxBytes=_LOG_FILE_MAX_BYTES,
        backupCount=_LOG_FILE_BACKUP_COUNT,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter(_LOG_FORMAT))
    handler.addFilter(RequestIdFilter())
    logging.getLogger().addHandler(handler)
    _file_log_handler = handler
    return handler


settings = get_settings()
logging.basicConfig(level=_log_level(settings.log_level), format=_LOG_FORMAT)
# HTTPX 的 INFO 摘要包含完整 URL，可能暴露助手联网搜索词。
# 业务层会另行记录不含查询参数的主机、状态码和请求 ID。
logging.getLogger("httpx").setLevel(logging.WARNING)
for handler in logging.getLogger().handlers:
    handler.addFilter(RequestIdFilter())
if settings.log_file_enabled:
    attach_file_log_handler(DATA_DIR / "logs")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 只有早期未版本化数据库需要兼容建表/补列；空库与后续升级均由
    # Alembic 独立管理，避免 create_all 提前创建结构而掩盖 revision。
    # 用属性访问而不是按值导入：切换数据集会重建 engine，按值引用会指向旧库。
    # 每一步都留一行日志。启动阶段是最容易"静默卡住"的地方：进程活着、端口没人监听、
    # 日志停在上一行——没有分段日志就只能靠猜（CI 的 macOS 作业上真发生过）。
    startup_logger = logging.getLogger(__name__)
    bind = database.engine
    startup_logger.info("启动自检：检查数据库版本")
    if is_unversioned_legacy_database(bind):
        Base.metadata.create_all(bind=bind)
        ensure_sqlite_columns(bind, SQLITE_REQUIRED_COLUMNS)
    run_database_migrations(bind)
    # WAL 截断与统计刷新都可能因并发读者失败：维护是保险不是门槛，绝不阻断启动。
    startup_logger.info("启动自检：SQLite 例行维护")
    try:
        run_sqlite_maintenance(bind)
    except Exception:  # noqa: BLE001 - 维护失败不应阻断启动
        startup_logger.warning("SQLite 例行维护失败", exc_info=True)
    job_match_runner = get_job_match_background_runner()
    # 上次运行若中途退出，可能留下未应用的备份包与导出产物，它们不会再用到。
    startup_logger.info("启动自检：清理临时目录")
    cleanup_temp_directories(bind)
    # 应用重启后，把仍停留在"进行中"的投递/采集任务标记为失败，避免出现幽灵进度。
    startup_logger.info("启动自检：清理中断的投递任务")
    with database.SessionLocal() as session:
        try:
            apply_service.fail_orphaned_tasks(session)
        except Exception:  # noqa: BLE001 - 清理失败不应阻断启动
            startup_logger.warning("清理中断的投递任务失败", exc_info=True)
        try:
            job_match_runner.fail_orphaned_task(session)
        except Exception:  # noqa: BLE001 - 清理失败不应阻断启动
            startup_logger.warning("清理中断的岗位匹配任务失败", exc_info=True)
    startup_logger.info("启动自检完成，开始接收请求")
    try:
        yield
    finally:
        _shutdown_runtime_services(job_match_runner)


async def unhandled_exception(_request: Request, exc: Exception):
    """将未处理异常转换为不泄露内部细节的统一响应。"""
    request_id = get_request_id()
    logging.getLogger(__name__).exception("未处理的请求异常", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "服务器处理请求时发生内部错误，请查看后端日志",
            "request_id": request_id,
        },
    )


def health():
    return {"status": "ok", "name": settings.app_name, "version": settings.app_version}


def _shutdown_runtime_services(job_match_runner: object) -> None:
    """退出前收拢应用拥有的线程、监听器和专用浏览器。"""
    # 先停后台任务，避免浏览器关闭后工作线程还在发 CDP 请求。
    try:
        get_task_runner().shutdown()
    except Exception:  # noqa: BLE001 - 退出路径必须继续清理其它资源
        logging.getLogger(__name__).warning("关闭投递/采集任务运行器失败", exc_info=True)
    try:
        job_match_runner.shutdown()
    except Exception:  # noqa: BLE001 - 退出路径必须继续清理其它资源
        logging.getLogger(__name__).warning("关闭岗位匹配后台任务失败", exc_info=True)
    try:
        stop_webform_live()
    except Exception:  # noqa: BLE001 - 退出路径必须继续清理其它资源
        logging.getLogger(__name__).warning("关闭网申实时填表监听失败", exc_info=True)
    try:
        # 两个管理器都只会停止自己持有的浏览器句柄，不会按 PID 猜测或触碰外部窗口。
        apply_service.reset_browser_manager()
    except Exception:  # noqa: BLE001 - 退出路径必须继续清理其它资源
        logging.getLogger(__name__).warning("关闭投递专用浏览器失败", exc_info=True)
    try:
        webform_browser.reset_browser_manager()
    except Exception:  # noqa: BLE001 - 退出路径必须继续清理其它资源
        logging.getLogger(__name__).warning("关闭网申专用浏览器失败", exc_info=True)


def create_app() -> FastAPI:
    """创建并装配应用；保留工厂便于离线测试和未来多实例部署。"""
    app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)
    app.add_middleware(
        RequestContextMiddleware,
        max_body_bytes=settings.max_request_body_mb * 1024 * 1024,
        # 备份上传的体积随用户数据增长，且是流式落盘；其余接口维持原上限。
        larger_body_paths={
            datasets.IMPORT_PATH: settings.max_backup_upload_mb * 1024 * 1024,
            skills.IMPORT_PATH: settings.max_backup_upload_mb * 1024 * 1024,
        },
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
        # 默认只有简单响应头能被前端读到：导出 PDF 的页数/上限、以及附件文件名都靠
        # 自定义头回传，不在这里放行的话跨源部署下前端永远读到 null。
        expose_headers=[
            resumes.PDF_PAGES_HEADER,
            resumes.PDF_PAGE_LIMIT_HEADER,
            "Content-Disposition",
        ],
    )
    for router in (
        # 批量匹配的 `/match-batches` 是岗位路由下的字面量路径，必须先于 jobs.router
        # 的 `/{job_id}` 参数路径注册，否则 FastAPI 会把它尝试解析成整数并返回 422。
        job_match.router,
        jobs.router,
        resumes.router,
        resume_writing.router,
        resume_risk.router,
        ats.router,
        resume_templates_api.router,
        profile.router,
        materials.router,
        knowledge.router,
        candidate_jobs.router,
        claims.router,
        drill.router,
        # 历史路由必须排在 interview.router 之前：它用 /question-banks、/reviews 字面量段，
        # 排在后面会被 interview 的 /{session_id} 参数段抢走。
        interview_history.router,
        interview.router,
        interview_experiences.router,
        reminders.router,
        referrals.router,
        analytics.router,
        apply.router,
        apply.collect_router,
        webform.router,
        tracker.router,
        settings_api.router,
        datasets.router,
        skills.router,
        search.router,
        share_packages.router,
        stats.router,
        system_api.router,
        update_api.router,
        assistant.router,
        trash.router,
    ):
        app.include_router(router)
    app.add_exception_handler(Exception, unhandled_exception)
    app.add_api_route("/api/health", health, methods=["GET"])
    return app


app = create_app()
