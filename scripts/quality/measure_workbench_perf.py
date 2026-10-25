# SPDX-License-Identifier: Apache-2.0
"""制作台本地性能基线：草稿渲染 / 精确预览 / 分页报告。

用途（plan §11）：在固定条件下记录本地耗时，不能只给一个没有条件的毫秒数。
本脚本用 FastAPI TestClient + 合成样例内容（scripts/quality 的 dense 样例）测量：

1. 草稿渲染：POST /api/resumes/render（返回 HTML，不落库）；
2. 精确预览：POST /api/resumes/{id}/preview-pdf（真实 PDF 管线；分别统计
   未命中缓存（每次改一句正文）与命中缓存（同一请求重复））；
3. 分页报告：POST /api/resumes/{id}/pagination/report（与精确预览同一条 PDF 渲染）。

口径与限制（必须与结果一起记录）：
- TestClient 进程内调用：含请求序列化/路由/渲染，不含真实浏览器、网络、前端构建；
- 冷启动 = 进程内该端点第一次调用；热态 = 先 warmup 再测；
- 字体、样例规模、设备、系统、Python 版本写入报告，绝对数字只在该环境下成立；
- 不写 backend/data，不访问网络；测试库/数据集目录由 backend/tests/conftest.py
  按 PID 隔离到系统临时目录（运行时请把 TEMP/TMP 指向仓库外且可写的位置）。

运行（Windows，仓库根目录）：

    backend\\.venv\\Scripts\\python.exe scripts/quality/measure_workbench_perf.py \\
        --json-out %TEMP%/workbench-perf.json

依赖：pypdf 仅用于读出 PDF 嵌入字体名；缺失时该字段为空，不影响计时。
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import platform
import statistics
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = REPO_ROOT / "backend"
for entry in (str(BACKEND), str(BACKEND / "tests"), str(REPO_ROOT)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

import conftest  # noqa: E402,F401  - 先建立隔离测试库/数据目录
from app.main import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from scripts.quality.sample_content_variants import dense  # noqa: E402

PREVIEW = "/api/resumes/{resume_id}/preview-pdf"
PAGINATION = "/api/resumes/{resume_id}/pagination/report"
RENDER = "/api/resumes/render"
PAGE_LIMIT = 3
TEMPLATE = "classic"


def _stats(values: list[float]) -> dict[str, float | int]:
    ordered = sorted(values)
    index = max(0, math.ceil(0.95 * len(ordered)) - 1)
    return {
        "n": len(ordered),
        "min_ms": round(ordered[0], 1),
        "p50_ms": round(statistics.median(ordered), 1),
        "p95_ms": round(ordered[index], 1),
        "max_ms": round(ordered[-1], 1),
        "mean_ms": round(statistics.fmean(ordered), 1),
    }


def _measure(call, *, n: int, warmup: int) -> tuple[dict, float]:
    """先测一次冷启动，再 warmup-1 次，最后测 n 次互不重复的调用。

    索引必须只增不减：精确预览的 payload 会带 "第 index 次" 标记，warmup 与
    测量若复用同一批索引，第二次就会被服务端预览缓存命中，测出来的是"缓存命中"
    而不是"渲染耗时"（2026-10-25 实测踩过：p50 6ms vs 真实约 600ms）。
    """
    if warmup < 1:
        raise ValueError("warmup 至少为 1（冷启动本身要算一次）")
    started = time.perf_counter()
    call(0)
    first = (time.perf_counter() - started) * 1000
    for index in range(1, warmup):
        call(index)
    values: list[float] = []
    for index in range(warmup, warmup + n):
        started = time.perf_counter()
        call(index)
        values.append((time.perf_counter() - started) * 1000)
    return _stats(values), round(first, 1)


def _pdf_fonts(pdf: bytes) -> list[str]:
    try:
        from pypdf import PdfReader
    except Exception:  # noqa: BLE001 - 字体名只是补充信息
        return []
    try:
        reader = PdfReader(io.BytesIO(pdf))
        fonts: set[str] = set()
        for page in reader.pages:
            resources = page.get("/Resources") or {}
            for font in (resources.get("/Font") or {}).values():
                get_object = getattr(font, "get_object", None)
                base = get_object() if callable(get_object) else font
                name = base.get("/BaseFont") if hasattr(base, "get") else None
                if name:
                    fonts.add(str(name))
        return sorted(fonts)
    except Exception:  # noqa: BLE001
        return []


def _copy_with_marker(content: dict, index: int) -> dict:
    """每次换一句概述，迫使精确预览缓存未命中（仍走真实渲染）。"""
    clone = json.loads(json.dumps(content, ensure_ascii=False))
    clone["summary"] = f"{content.get('summary', '')}（性能基线第 {index} 次）"
    return clone


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ResumeForge 制作台本地性能基线")
    parser.add_argument("--draft-n", type=int, default=20, help="草稿渲染测量次数")
    parser.add_argument("--preview-n", type=int, default=10, help="精确预览测量次数")
    parser.add_argument("--report-n", type=int, default=10, help="分页报告测量次数")
    parser.add_argument("--json-out", default="", help="把完整结果写成 JSON")
    args = parser.parse_args(argv)

    content = dense(2, experiences=6)
    base_body = {
        "content": content,
        "template": TEMPLATE,
        "page_limit": PAGE_LIMIT,
        "include_photo": False,
    }
    result: dict = {
        "measured_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "environment": {
            "os": platform.platform(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "cpu_count": os.cpu_count(),
            "python": sys.version.split()[0],
            "python_executable": sys.executable,
            "app_version": getattr(app, "version", "unknown"),
            "build_mode": "source + FastAPI TestClient (in-process; no browser/network)",
        },
        "sample": {
            "source": "scripts/quality/sample_content_variants.dense(2, experiences=6)",
            "template": TEMPLATE,
            "page_limit": PAGE_LIMIT,
            "include_photo": False,
            "experiences": len(content.get("experience") or []),
            "bullets": sum(
                len(item.get("description") or []) for item in content.get("experience") or []
            ),
            "content_chars": len(json.dumps(content, ensure_ascii=False)),
        },
        "protocol": {
            "warmup": 2,
            "draft_render": "POST /api/resumes/render (HTML, no DB write)",
            "exact_preview_uncached": "POST /preview-pdf, summary changed each call",
            "exact_preview_cached": "POST /preview-pdf, identical body repeated",
            "pagination_report": "POST /pagination/report (same PDF render path)",
        },
        "measurements": {},
    }

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        created = client.post(
            "/api/resumes/manual",
            json={"title": "W21 性能基线（合成）", "content": content, "job_id": None},
        )
        assert created.status_code == 201, created.text
        resume_id = created.json()["id"]
        result["sample"]["resume_id"] = resume_id

        def render_call(index: int) -> None:
            payload = {"content": content, "template": TEMPLATE, "page_limit": PAGE_LIMIT}
            response = client.post(RENDER, json=payload)
            assert response.status_code == 200, response.text

        stats, cold = _measure(render_call, n=args.draft_n, warmup=2)
        result["measurements"]["draft_render"] = {**stats, "cold_first_ms": cold}

        def preview_call(index: int) -> None:
            body = dict(base_body, content=_copy_with_marker(content, index))
            response = client.post(PREVIEW.format(resume_id=resume_id), json=body)
            assert response.status_code == 200, response.text
            assert response.content.startswith(b"%PDF"), "not a PDF"

        stats, cold = _measure(preview_call, n=args.preview_n, warmup=2)
        result["measurements"]["exact_preview_uncached"] = {**stats, "cold_first_ms": cold}

        first = client.post(PREVIEW.format(resume_id=resume_id), json=base_body)
        assert first.status_code == 200, first.text
        result["pdf_fonts"] = _pdf_fonts(first.content)

        def cached_call(_index: int) -> None:
            response = client.post(PREVIEW.format(resume_id=resume_id), json=base_body)
            assert response.status_code == 200, response.text

        stats, cold = _measure(cached_call, n=args.preview_n, warmup=2)
        result["measurements"]["exact_preview_cached"] = {**stats, "cold_first_ms": cold}

        report_response = client.post(PAGINATION.format(resume_id=resume_id), json=base_body)
        assert report_response.status_code == 200, report_response.text
        report = report_response.json()
        result["sample"].update(
            pages=report.get("pages"),
            pages_needed=report.get("pages_needed"),
            overflow=report.get("overflow"),
        )

        def report_call(index: int) -> None:
            body = dict(base_body, content=_copy_with_marker(content, index))
            response = client.post(PAGINATION.format(resume_id=resume_id), json=body)
            assert response.status_code == 200, response.text

        stats, cold = _measure(report_call, n=args.report_n, warmup=2)
        result["measurements"]["pagination_report"] = {**stats, "cold_first_ms": cold}

    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.json_out:
        path = Path(args.json_out).expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"\n报告：{path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
