"""应用入口：装配中间件与路由、配置日志、启动时升级数据库。"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models  # noqa: F401 - 确保全部模型注册到 Base.metadata
from .api import jobs, profile, resumes, search, settings as settings_api, stats
from .config import get_settings
from .database import Base, engine, ensure_sqlite_columns

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # create_all 不会给已有表加列；本地 SQLite 用幂等兼容升级保留历史数据。
    Base.metadata.create_all(bind=engine)
    ensure_sqlite_columns(
        engine,
        {
            "job": {
                "note": "TEXT NOT NULL DEFAULT ''",
                "favorite": "BOOLEAN NOT NULL DEFAULT 0",
            },
            "user_profile": {"photo": "TEXT NOT NULL DEFAULT ''"},
        },
    )
    yield


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (jobs.router, resumes.router, profile.router, settings_api.router, search.router, stats.router):
    app.include_router(router)


@app.get("/api/health")
def health():
    return {"status": "ok", "name": settings.app_name, "version": settings.app_version}
