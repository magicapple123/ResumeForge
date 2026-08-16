# 抓取源扩展指南

> **合规提示**：接入任何真实网站前，请先确认其服务条款、robots.txt 是否允许抓取；
> 控制请求频率，仅用于个人求职信息收集，勿将数据对外分发。

## 原理

`backend/app/services/scrapers/` 下的框架会在启动时**自动发现** `sources/` 目录里
所有继承 `JobSourceBase` 的类。你只需要新建一个文件、写一个 `fetch` 方法，
不需要改动任何已有代码。

## 步骤

1. 在 `backend/app/services/scrapers/sources/` 新建 `my_source.py`：

```python
"""示例：接入某招聘平台。"""
import httpx

from ..base import JobSourceBase, ScrapedJob


class MySource(JobSourceBase):
    name = "my_platform"          # 唯一标识（API 参数用），英文
    display_name = "我的招聘平台"  # 界面展示名
    description = "描述这个来源提供什么数据"

    def fetch(self, keyword: str | None = None, limit: int = 20) -> list[ScrapedJob]:
        """拿到岗位列表并转成 ScrapedJob。

        - 网络异常直接抛出即可，API 层会捕获并转为友好提示。
        - 去重、技能标签解析由系统统一处理，这里不用管。
        """
        url = "https://example.com/api/jobs"
        params = {"kw": keyword, "size": limit}
        rows = httpx.get(url, params=params, timeout=30).json()

        jobs = []
        for row in rows:
            jobs.append(
                ScrapedJob(
                    title=row["title"],
                    company=row["company"],
                    location=row.get("city", ""),
                    salary=row.get("salary", ""),
                    job_type="校招",            # 校招/实习/社招/其他
                    description=row.get("jd", ""),
                    source_url=row.get("url", ""),
                    posted_at=row.get("publish_time", ""),
                )
            )
        return jobs[:limit]
```

2. 重启后端，抓取源自动出现在「设置 → 招聘信息抓取源」与「岗位广场 → 抓取岗位」下拉框中。

## 常见抓取方式

| 方式 | 适用场景 | 注意 |
| --- | --- | --- |
| 公开 JSON API | 网站自带开放接口 | 最省事，注意鉴权与限流 |
| 解析 HTML | 无接口的静态页面 | 用 `httpx` 抓取 + BeautifulSoup/lxml 解析，注意页面改版 |
| RSS / sitemap | 支持订阅的站点 | 频率低、稳定 |
| 浏览器抓取 | 强反爬站点 | 复杂度高，谨慎评估是否违反条款 |

## 建议

- **请求频率**：单次抓取间隔至少 1-3 秒，可加 `time.sleep` 或限速器。
- **超时与重试**：网络调用一律设 timeout，失败抛出即可（上层有兜底）。
- **失效处理**：网站改版导致解析失败时，抛出带说明的异常，让用户在界面上看到原因。
- **去重**：系统按「职位名 + 公司 + 来源」去重，同岗位重复抓取不会产生脏数据。
