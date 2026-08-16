"""服务端配置：全部集中在此，可通过环境变量 / .env 文件覆盖。

注意：这里只放服务端自身的配置；大模型 API 等用户运行时配置
在「设置」页中填写，保存在本地数据库，二者互不混淆。
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "ResumeForge"
    app_version: str = "0.1.0"

    # SQLite 文件路径（相对 backend 目录），目录不存在时自动创建
    database_url: str = "sqlite:///./data/resume_forge.db"

    # 允许跨域的前端地址，英文逗号分隔
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """全局唯一的配置实例（进程内缓存，环境变量只在启动时读取）。"""
    return Settings()
