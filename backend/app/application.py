"""FastAPI 应用装配与生命周期配置。"""

import json
import logging
import sys
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import (
    database,
    models,  # noqa: F401 - 确保全部模型注册到 Base.metadata
)
from .api import (
    analytics,
    apply,
    assistant,
    assistant_proposals,
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
    manual_backups,
    materials,
    profile,
    referrals,
    reminders,
    resume_risk,
    resume_writing,
    resumes,
    search,
    share_packages,
    skills,
    stats,
    tracker,
    trash,
    user_files,
    webform,
)
from .api import (
    resume_templates as resume_templates_api,
)
from .api import (
    settings as settings_api,
)
from .api import (
    system as system_api,
)
from .api import (
    update as update_api,
)
from .config import BACKEND_DIR, DATA_DIR, get_settings
from .database import Base, ensure_sqlite_columns, run_sqlite_maintenance
from .database_compat import SQLITE_REQUIRED_COLUMNS
from .database_migrations import is_unversioned_legacy_database, run_database_migrations
from .middleware import (
    LoopbackOriginGuardMiddleware,
    RequestContextMiddleware,
    RequestIdFilter,
    get_request_id,
)
from .middleware.dataset_request import DatasetRequestMiddleware
from .runtime.log_context import LogContextFilter
from .runtime.log_redact import RedactExceptionFilter
from .services.apply import apply_service
from .services.apply.task_runner import get_task_runner
from .services.data_backup import cleanup_temp_directories
from .services.job.job_match_background import get_job_match_background_runner
from .services.resume.generate_recovery import fail_orphaned_generate_tasks
from .services.resume.resume_generate_runner import get_resume_generate_runner
from .services.webform import browser as webform_browser
from .services.webform import stop_live as stop_webform_live
from .static_spa import mount_static_spa

_LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] [request_id=%(request_id)s] %(message)s"
# 滚动日志的单文件上限与份数：5MB×5 足够回溯近期排障，又不会吞掉磁盘。
_LOG_FILE_MAX_BYTES = 5 * 1024 * 1024
_LOG_FILE_BACKUP_COUNT = 5

# 启动器重定向的 stdout/stderr（runtime/*.log）没有大小上限，属于无界增长的
# 已知限制（RF-20）：滚动文件日志只覆盖应用内 handler；重定向文件由启动器
# 与维护脚本治理（scripts 归 RF-21），应用侧不截断进程级 stdout。


class JsonLogFormatter(logging.Formatter):
    """可选的 JSON 行日志格式（RF-20）：每行一个对象，便于机器采集与检索。

    固定键：time/level/logger/message/task_id/dataset_id/request_id；异常走
    exc 字段。脱敏不在这里做——异常文本由 ``RedactExceptionFilter``（handler
    级兜底）在格式化之前清洗进 ``record.exc_text``；本 formatter 优先使用
    ``exc_text``，仅在没有 filter 兜底时才自行 ``formatException``。
    """

    def format(self, record: logging.LogRecord) -> str:
        from datetime import UTC, datetime

        payload = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "task_id": getattr(record, "task_id", "-"),
            "dataset_id": getattr(record, "dataset_id", "-"),
            "request_id": getattr(record, "request_id", "-"),
        }
        if record.exc_info and not record.exc_text:
            # 没有脱敏 filter 兜底时自行渲染（有 filter 时 exc_text 已清洗就位）。
            record.exc_text = self.formatException(record.exc_info)
        if record.exc_text:
            payload["exc"] = record.exc_text
        return json.dumps(payload, ensure_ascii=False)


def _build_formatter() -> logging.Formatter:
    """按配置选格式：默认保持现行文本格式逐字节不变。"""
    if get_settings().log_json_format:
        return JsonLogFormatter()
    return logging.Formatter(_LOG_FORMAT)


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

    磁盘不可写（目录建不出/文件打不开）时只放弃文件日志、保留控制台输出——
    RF-20：日志是排障辅助，绝不能让启动因它失败。
    """
    global _file_log_handler
    if _file_log_handler is not None:
        return None
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(
            log_dir / "backend.log",
            maxBytes=_LOG_FILE_MAX_BYTES,
            backupCount=_LOG_FILE_BACKUP_COUNT,
            encoding="utf-8",
        )
    except OSError:
        logging.getLogger(__name__).warning(
            "无法创建滚动日志文件（磁盘不可写？），运行日志仅保留控制台输出", exc_info=True
        )
        return None
    handler.setFormatter(_build_formatter())
    handler.addFilter(RequestIdFilter())
    handler.addFilter(LogContextFilter())
    handler.addFilter(RedactExceptionFilter())
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
    # RF-20：所有 handler 都注入后台线程的 task_id/dataset_id 关联字段
    # （LogContextFilter 与 RequestIdFilter 同一模式，缺省 "-"）。
    handler.addFilter(LogContextFilter())
    # PR-20 对称项：handler 级异常文本脱敏兜底——全仓 logger.exception 的
    # traceback 在格式化前统一清洗，未逐点接入 log_exception_redacted 的
    # 调用点（drill/resume_writing/apply task_runner 等）由此覆盖。
    handler.addFilter(RedactExceptionFilter())
    if settings.log_json_format:
        handler.setFormatter(JsonLogFormatter())
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
    # PR-03：先校验数据集指针与可用库一致（切换崩溃窗口的确定性恢复），再谈迁移
    # ——指针指向的库打不开时回退主数据，避免应用起在一份坏库上到处 500。
    startup_logger.info("启动自检：校验数据集指针")
    try:
        # 函数级导入：services.datasets 依赖链重，且 lifespan 调用时机在装配完成后。
        from .services.datasets import recover_startup_pointer

        recover_startup_pointer()
    except Exception:  # noqa: BLE001 - 指针校验失败不阻断启动（database.py 已有回落）
        startup_logger.warning("数据集指针校验失败（不阻断启动）", exc_info=True)
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
    # 应用重启后，把仍停留在"进行中"的投递/采集/匹配/简历生成任务标记为失败，
    # 避免出现幽灵进度（简历任务还会占住"只跑一个"的生成入口，见 RF-02）。
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
        try:
            fail_orphaned_generate_tasks(session)
        except Exception:  # noqa: BLE001 - 清理失败不应阻断启动
            startup_logger.warning("清理中断的简历生成任务失败", exc_info=True)
    startup_logger.info("启动自检完成，开始接收请求")
    # 自动备份放后台调度线程（RF-05）：启动时先检查一次"是否到期"，之后每个
    # check_seconds 周期再查；快照可能几百 MB，不能让它卡住"开始接收请求"这一行。
    from .services.data_backup import scheduler as auto_backup_scheduler

    auto_backup_scheduler.start_scheduler(get_settings().auto_backup_check_seconds)
    # 唤醒一次：启动时立即做首轮到期检查（与旧行为一致），之后按周期调度。
    auto_backup_scheduler.trigger_check()
    # 用户文件副本的启动回填同样放后台：扫描的是 base64 大字段，但 best-effort、
    # 幂等，失败只记日志，绝不阻断启动或请求。
    from .services.user_files import schedule_backfill

    schedule_backfill()
    try:
        yield
    finally:
        # LLM 共享连接池（AI 提速）：连接绑定在事件循环上，进程收尾时统一关闭。
        from .services.llm.client_pool import aclose_shared_clients

        await aclose_shared_clients()
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
        get_resume_generate_runner().shutdown()
    except Exception:  # noqa: BLE001 - 退出路径必须继续清理其它资源
        logging.getLogger(__name__).warning("关闭简历生成任务运行器失败", exc_info=True)
    try:
        from .services.data_backup import scheduler as auto_backup_scheduler

        auto_backup_scheduler.shutdown_scheduler()
    except Exception:  # noqa: BLE001 - 退出路径必须继续清理其它资源
        logging.getLogger(__name__).warning("关闭自动备份调度失败", exc_info=True)
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


def _frontend_dist_dir() -> Path:
    """前端生产静态资产目录：源码形态是仓库根下 ``frontend/dist``。

    PyInstaller 等冻结形态下 ``__file__`` 会落在解包临时目录，那时资产应随可执行
    文件分发；当前发布链是源码分发（git archive），冻结分支只是不把路径拼错。
    """
    if getattr(sys, "frozen", False):
        frozen_dist = Path(sys.executable).resolve().parent / "frontend" / "dist"
        if frozen_dist.is_dir():
            return frozen_dist
    return BACKEND_DIR.parent / "frontend" / "dist"


def create_app() -> FastAPI:
    """创建并装配应用；保留工厂便于离线测试和未来多实例部署。"""
    app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)
    app.add_middleware(DatasetRequestMiddleware)
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
            "X-Content-Sha256",
            "X-Render-Config-Sha256",
            # 备份导出：包里已经有"附件缺失/与登记哈希不符"时在响应头如实标出
            # （RR-03），界面要能读到才知道不该说"完整备份成功"。
            "X-Backup-Incomplete",
            "X-Backup-Asset-Warnings",
            # 交付下载（RR-04）：本次字节的哈希（X-Content-Sha256，见上）、
            # 历史产物/源内容指纹，以及"这份字节是重放生成的"标记。
            "X-Artifact-Sha256",
            "X-Delivery-Replay",
            "X-Source-Content-Sha256",
            "X-Dataset-Scope",
        ],
    )
    # add_middleware 后添加的在更外层先执行：跨站防线放在最外层，跨站发来的简单写
    # 请求（不触发 CORS 预检、会直接到达）在进入任何后续处理前就被 403 短路；OPTIONS
    # 预检不属于被拦方法，CORS 协商行为完全不受影响。CORSMiddleware 自身的
    # allow_origins 列表管的是"响应头是否放行"，与这道防线互补、职责不同。
    app.add_middleware(LoopbackOriginGuardMiddleware)
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
        assistant_proposals.router,
        trash.router,
        user_files.router,
        manual_backups.router,
    ):
        app.include_router(router)
    app.add_exception_handler(Exception, unhandled_exception)
    app.add_api_route("/api/health", health, methods=["GET"])
    # RF-09 方案 A：dist 存在时由后端同源提供前端静态资产。mount_static_spa 会把
    # SPA 回退注册成 catch-all，必须排在全部路由（含上面的 /api/health）之后。
    mount_static_spa(app, _frontend_dist_dir())
    return app


app = create_app()
