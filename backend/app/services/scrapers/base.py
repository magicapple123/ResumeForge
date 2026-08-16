"""抓取源抽象：一个抓取源 = 一个继承 JobSourceBase 的类。

入库前的去重、技能标签解析由 API 层统一处理，抓取源只负责
"拿到岗位原始数据"，职责单一。
"""
from abc import ABC, abstractmethod

from pydantic import BaseModel


class ScrapedJob(BaseModel):
    """抓取到的原始岗位。"""

    title: str
    company: str = ""
    location: str = ""
    salary: str = ""
    job_type: str = "校招"
    description: str = ""
    requirements: str = ""
    source_url: str = ""
    posted_at: str = ""


class JobSourceBase(ABC):
    # 唯一标识（英文），用于 API 参数与去重
    name: str = ""
    # 界面展示名（中文）
    display_name: str = ""
    description: str = ""

    @abstractmethod
    def fetch(self, keyword: str | None = None, limit: int = 20) -> list[ScrapedJob]:
        """获取岗位列表。

        网络异常等错误允许直接抛出，由 API 层统一捕获并转为友好提示。
        """
