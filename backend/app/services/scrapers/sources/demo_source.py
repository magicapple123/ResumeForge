"""内置演示源：读取 data/sample_jobs.json 中的示例岗位。

作用：让新用户在没有配置任何真实抓取源的情况下，也能完整体验
「抓取 -> 选岗 -> AI 生成简历 -> 导出」的闭环。
接入真实招聘信息来源请参考 docs/scraper-guide.md。
"""
import json
from pathlib import Path

from ..base import JobSourceBase, ScrapedJob

SAMPLE_PATH = Path(__file__).resolve().parents[3] / "data" / "sample_jobs.json"


class DemoSource(JobSourceBase):
    name = "demo"
    display_name = "内置示例"
    description = "内置演示岗位数据（2026 秋招示例），无网络请求，用于快速体验完整流程"

    def fetch(self, keyword: str | None = None, limit: int = 20) -> list[ScrapedJob]:
        jobs = [ScrapedJob.model_validate(item) for item in json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))]
        if keyword:
            kw = keyword.lower()
            jobs = [j for j in jobs if kw in f"{j.title}{j.company}{j.description}".lower()]
        return jobs[:limit]
