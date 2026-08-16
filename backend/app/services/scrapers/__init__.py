"""招聘信息抓取框架。

真实的招聘网站接口变动频繁且多有反爬与条款限制，本项目只内置
一个演示源（data/sample_jobs.json）；接入真实来源请参考
docs/scraper-guide.md，在 sources/ 下新增类即可被自动发现。
"""
from .base import JobSourceBase, ScrapedJob
from .registry import get_source, list_sources

__all__ = ["JobSourceBase", "ScrapedJob", "get_source", "list_sources"]
