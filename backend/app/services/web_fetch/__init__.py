# SPDX-License-Identifier: Apache-2.0
"""链接抓取与岗位抽取（#16/#17）。

对外入口：

- JobFetcher：双引擎（http / browser）+ 自动升级 + 限速 + 页数上限；
- extract_job_rows：规则优先、模型兜底的 JobImportRow 抽取；
- import_jobs_from_page / commit_import_rows：转 JobImportRow 并落库（去重、仅补空字段）。

模块不做任何"后台常驻"的事：所有网络请求都由一次 HTTP 请求或一次工具调用驱动。
"""

from .errors import WebExtractError, WebFetchError
from .extractor import DetailResult, ExtractionResult, extract_detail, extract_rows
from .fetcher import FetchConfig, FetchedPage, JobFetcher
from .field_rules import (
    FETCH_FAILED,
    FILLED,
    NOT_FETCHED,
    NOT_ON_PAGE,
    infer_job_type,
    infer_status,
    normalize_posted_at,
    split_jd_sections,
)
from .row import ExtractedRow
from .url_policy import UrlRejected

__all__ = [
    "DetailResult",
    "ExtractedRow",
    "ExtractionResult",
    "FETCH_FAILED",
    "FILLED",
    "FetchConfig",
    "FetchedPage",
    "JobFetcher",
    "NOT_FETCHED",
    "NOT_ON_PAGE",
    "UrlRejected",
    "WebExtractError",
    "WebFetchError",
    "extract_detail",
    "extract_rows",
    "infer_job_type",
    "infer_status",
    "normalize_posted_at",
    "split_jd_sections",
]
