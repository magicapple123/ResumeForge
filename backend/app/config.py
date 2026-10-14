"""服务端配置：全部集中在此，可通过环境变量 / .env 文件覆盖。

注意：这里只放服务端自身的配置；大模型 API 等用户运行时配置
在「设置」页中填写，保存在本地数据库，二者互不混淆。
"""

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
# 数据目录：数据库、备份、导出、样例等本地产物都落在它下面。其它模块一律从这里推导子目录，
# 不各自去拼相对路径（拼错一处就会写到仓库里、被误提交）。
#
# RF_DATA_DIR（ADR-0004）：桌面打包形态下 backend 目录位于安装目录内的 resources/payload，
# 安装目录可能只读、更新时会被替换——桌面壳启动后端时把 RF_DATA_DIR 指到用户数据目录
# （%APPDATA%/ResumeForge/data），数据库/附件/导出/备份因此全部落用户目录。未设置该变量时
# 保持原默认（backend/data），控制台流程与开发流程不受影响。
DATA_DIR = (
    Path(os.environ["RF_DATA_DIR"]) if os.environ.get("RF_DATA_DIR") else BACKEND_DIR / "data"
)
DEFAULT_DATABASE_URL = f"sqlite:///{(DATA_DIR / 'resume_forge.db').as_posix()}"


def captures_dir() -> Path:
    """站点原文样例的根目录：``<数据目录>/captures``。

    与 ``DEFAULT_DATABASE_URL`` 同源推导（都从 ``DATA_DIR`` 来），而不是在别处再拼一个
    相对路径。``backend/data/`` 已被 ``.gitignore`` 忽略，样例因此天然**不进仓库、不进备份**，
    也**不属于任何 dataset 目录**——它是排查产物，不该跟着数据集切换，更不该和投递浏览器的
    登录态（``backend/data/browser-profile/``）混在一起。
    """
    return DATA_DIR / "captures"


# 投递专用浏览器的 CDP 调试端口默认值。这是**唯一**的常量来源：
# schemas 的配置出厂默认与 browser_manager 的兜底默认都从这里取，避免两处各写一个 9333
# 而在改端口时漏改一处。运行期真正生效的端口由 ApplyConfig.browser_port 驱动。
DEFAULT_BROWSER_PORT = 9333

# 网申填表专用浏览器使用固定的另一条调试端口，不与投递台共享进程或用户目录。
# 这个端口不暴露为投递配置项，避免用户误把两类浏览器配置成同一个实例。
DEFAULT_WEBFORM_BROWSER_PORT = 9334


class Settings(BaseSettings):
    app_name: str = "ResumeForge"
    app_version: str = "0.18.0"

    # SQLite 文件路径（相对 backend 目录），目录不存在时自动创建
    database_url: str = DEFAULT_DATABASE_URL

    # 允许跨域的前端地址，英文逗号分隔
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    max_request_body_mb: int = Field(default=8, ge=1, le=64)

    # 备份上传单独放宽：恢复用的压缩包体积随用户数据增长，而请求体是流式落盘的，
    # 内存占用与包大小无关。其余接口仍受 max_request_body_mb 约束。
    max_backup_upload_mb: int = Field(default=512, ge=1, le=4096)
    max_backup_uncompressed_mb: int = Field(default=4096, ge=1, le=65536)

    # 文件日志：在数据目录 logs/ 下追加一份 5MB×5 的滚动日志，防止长期挂机时
    # 启动器重定向的 stdout/stderr（runtime/*.log）无限膨胀。不想落盘的场景
    # （如测试）用环境变量 LOG_FILE_ENABLED=false 关闭。
    log_level: str = "INFO"
    log_file_enabled: bool = True
    # 可选：日志按 JSON 行输出（控制台与文件 handler 共用）。默认关闭，保持
    # 人类可读的现行格式逐字节不变；开启后每行为 time/level/logger/message/
    # task_id/dataset_id/request_id 等结构化字段，便于机器采集（RF-20）。
    log_json_format: bool = False

    # 自动备份：启动后在后台检查"距上次自动备份是否已到间隔"，到期就滚动快照一份
    # 数据库并只保留最近 N 份。手动导出的备份包不受影响；全部可用环境变量调整。
    # check_seconds 是常驻调度线程的检查周期（RF-05：长期不重启也会到期检查，
    # 失败按 1h/6h/24h 退避重试，不再等满整个成功间隔）。
    auto_backup_enabled: bool = True
    auto_backup_interval_days: int = Field(default=7, ge=1, le=365)
    auto_backup_keep: int = Field(default=5, ge=1, le=50)
    auto_backup_check_seconds: int = Field(default=21600, ge=60, le=604800)

    # 简历生成任务的总预算（秒）：覆盖从模型流式输出到结果落库的全程，到期即断流
    # 收尾为 failed，防止模型端挂起时任务无限占用生成入口（RF-02）。
    resume_generate_budget_seconds: int = Field(default=600, ge=1, le=86400)

    # 求职助手一次回复的整链预算（秒）：覆盖全部工具轮次与模型流式输出，到期即在
    # 下一个事件边界收尾为 error（RF-14 §2.1.b）。运行中的工具不强制中断（协作式，
    # 与 RF-02 同一约定）；它只防"挂死/无限拖"，不做用户取消语义。
    assistant_stream_budget_seconds: int = Field(default=600, ge=1, le=86400)

    # 可选：OpenAI 兼容流式请求发送 stream_options.include_usage 以获取 token 用量。
    # 该开关**会改变默认请求体**，默认关闭（RF-14 §2.2：默认路径请求体逐字节不变的
    # 纪律，与思考参数同一条）；关闭时只读取服务商自带的 usage 帧。
    llm_stream_include_usage: bool = False

    # 可选：token 估算遥测（RF-14 §2.5）。默认关闭——现状字符口径完全不变；开启后
    # 只写 estimated_* 命名的遥测字段，不改任何请求体、不作为截断依据（按 token 截断
    # 属于 RF-13/RF-17 的产品决策）。
    llm_token_estimate_enabled: bool = False

    # 应用内更新允许的发布源主机名（英文逗号分隔）。下载包、checksum 与重定向的
    # **每一跳**都必须命中这里的主机或其子域，否则在发出请求前就拒绝（RF-26 §12.5）。
    # 默认只放行 GitHub Releases 发行链上的域名；自托管发行源在这里追加。
    update_allowed_hosts: str = (
        "github.com,objects.githubusercontent.com,release-assets.githubusercontent.com,"
        "codeload.github.com,api.github.com"
    )

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("database_url")
    @classmethod
    def resolve_relative_sqlite_path(cls, value: str) -> str:
        prefix = "sqlite:///"
        if not value.startswith(prefix):
            return value
        database = value.removeprefix(prefix)
        if database == ":memory:" or database.startswith("file:"):
            return value
        path = Path(database)
        if path.is_absolute():
            return value
        return f"{prefix}{(BACKEND_DIR / path).resolve().as_posix()}"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def update_allowed_host_list(self) -> list[str]:
        return [
            host.strip().casefold() for host in self.update_allowed_hosts.split(",") if host.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    """全局唯一的配置实例（进程内缓存，环境变量只在启动时读取）。"""
    return Settings()
