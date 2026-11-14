# SPDX-License-Identifier: Apache-2.0
"""generate 两条路径（定向岗位 / 通用简历）的规范化 JSON 金标（D4 残留）。

为什么不给 PDF 字节做金标：PDF 的字体嵌入/子集化结果跨平台不同，字节级金标在
CI 的 ubuntu 与 windows runner 之间必然假红。generate 的输出（v2 文档 + 警告 /
覆盖度 / 事实标注 / 生成说明 / 标题）与平台无关，规范化掉非确定性因素后可以
跨平台比对。

流程：真实生成链（后台生成任务 -> FakeProvider -> 落库的简历详情）跑两条路径，
把生成结果规范化成 JSON，sort_keys + 固定 separators + UTF-8 后取 sha256。
fixtures/generate_golden/manifest.json 不存在时写入 case->sha256 与规则版本；
存在时逐条比对，任何一条对不上就点名该 case 的期望值/实际值。

**规范化规则（版本 1）**：递归处理整份载荷，只抹掉与时间/环境有关的部分。
- id：键名匹配 (^|_)id$ / (^|_)ids$ 且值是自动生成 id（整数、>=16 位十六进制、
  hd_/ob_/it_/pt_ 前缀的内容哈希）-> "<id>"。语义 id 保留：source.field_id ==
  "projects.name" 这类 schema 字段键不是随机 id，抹掉会丢掉"字段映射"这一层
  金标信号。
- 时间戳：键名匹配 (^|_)(at|time|timestamp)$ -> "<timestamp>"；ISO 8601 形状的
  字符串同样替换；简历标题尾部的 12 位 YYYYMMDDHHMM -> <timestamp>。
- 耗时：键名含 elapsed / duration / took（如 RAG 回执的 elapsed_ms）-> "<duration>"。
- 路径：file:// URL、Windows 盘符绝对路径、以 / 开头的 posix 绝对路径、含系统
  临时目录前缀的文本 -> "<path>"（生成链目前不产生路径，这条是防回归）。
- 其余值原样保留。

改到 generate 的可见输出（提示词、后处理、文档转换、覆盖度/事实标注）后，先
人工审阅差异，再删掉 fixtures/generate_golden/manifest.json 重跑本文件重新生成
——直接改 manifest 里的 sha256 等价于关掉金标。
"""

from __future__ import annotations

import hashlib
import json
import re
import tempfile
from pathlib import Path
from typing import Any

import pytest
from app.services.resume.resume_generate_runner import reset_resume_generate_runner
from tests.resume_generate_task_support import (
    SuccessfulProvider,
    _configure,
    _job,
    _seed_profile,
    _wait_terminal,
)

# 规范化规则版本：规则一改必须 +1，让 manifest 报"规则版本不符"而不是只报 sha 变化。
RULES_VERSION = 1
MANIFEST_PATH = Path(__file__).resolve().parent / "fixtures" / "generate_golden" / "manifest.json"

_CASES: tuple[tuple[str, bool], ...] = (("job_targeted", True), ("general", False))

_OPAQUE_ID = re.compile(r"^(?:[0-9a-f]{16,}|(?:hd|ob|it|pt)_[0-9a-f]{8,})$")
_ISO_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$"
)
_WINDOWS_ABSOLUTE_PATH = re.compile(r"^[A-Za-z]:[\\/]")
_ID_KEY = re.compile(r"(?:^|_)(?:id|ids)$")
_TIMESTAMP_KEY = re.compile(r"(?:^|_)(?:at|time|timestamp)$")
_ELAPSED_KEY = re.compile(r"(?:elapsed|duration|took)", re.IGNORECASE)
_TITLE_TIMESTAMP = re.compile(r"-\d{12}$")
_TEMP_DIR_MARKERS = tuple(
    dict.fromkeys(
        marker
        for marker in (
            tempfile.gettempdir(),
            tempfile.gettempdir().replace("\\", "/"),
            "/tmp/",
            "/var/tmp/",
            "\\Temp\\",
        )
        if marker
    )
)


def _normalize(value: Any, key: str | None = None) -> Any:
    """按模块 docstring 的规则递归规范化；纯函数，方便单独推演。"""
    if isinstance(value, dict):
        return {name: _normalize(item, name) for name, item in value.items()}
    if isinstance(value, list):
        return [_normalize(item, key) for item in value]
    if key is not None:
        if (
            value is not None
            and _ID_KEY.search(key)
            and (isinstance(value, int) or (isinstance(value, str) and _OPAQUE_ID.match(value)))
        ):
            return "<id>"
        if _TIMESTAMP_KEY.search(key):
            return "<timestamp>" if value is not None else None
        if _ELAPSED_KEY.search(key):
            return "<duration>" if value is not None else None
    if isinstance(value, str):
        if _ISO_TIMESTAMP.match(value):
            return "<timestamp>"
        if value.startswith("file://"):
            return "<path>"
        if _WINDOWS_ABSOLUTE_PATH.match(value) or value.startswith("/"):
            return "<path>"
        if any(marker in value for marker in _TEMP_DIR_MARKERS):
            return "<path>"
        if key == "title":
            return _TITLE_TIMESTAMP.sub("-<timestamp>", value)
    return value


def _canonical_json(payload: Any) -> bytes:
    """规范化后的稳定字节表示：键排序、固定分隔符、UTF-8。"""
    normalized = _normalize(payload)
    return json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )


def _payload_sha256(payload: Any) -> str:
    return hashlib.sha256(_canonical_json(payload)).hexdigest()


def _golden_payload(record: dict[str, Any]) -> dict[str, Any]:
    """金标只覆盖"生成了什么"：正文 + 选材/事实说明 + 两条路径的标题差异。

    id / 时间戳 / profile_usage 这类记录元数据与本次生成内容无关（且含自动 id），
    不进载荷——它们在规范化规则里另有兜底，防止将来被顺手加进来。
    """
    return {
        "content": record["content"],
        "warnings": record["warnings"],
        "coverage_notes": record["coverage_notes"],
        "rationale": record["rationale"],
        "fact_annotations": record["fact_annotations"],
        "title": record["title"],
        "company": record["company"],
        "job_title": record["job_title"],
    }


def _generate_record(client, monkeypatch, *, with_job: bool) -> dict[str, Any]:
    """跑一次真实生成链：后台任务 + 假 Provider，读回落库的简历详情。"""
    _seed_profile(client)
    _configure(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: SuccessfulProvider(resolved),
    )
    body: dict[str, Any] = {}
    if with_job:
        body["job_id"] = _job(client)["id"]
    started = client.post("/api/resumes/generate/tasks", json=body)
    assert started.status_code == 201, started.text
    final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "completed", final
    record = client.get(f"/api/resumes/{final['resume_id']}")
    assert record.status_code == 200, record.text
    return record.json()


def _load_manifest() -> dict[str, Any] | None:
    if not MANIFEST_PATH.exists():
        return None
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def _write_manifest(digests: dict[str, str]) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "rules_version": RULES_VERSION,
        "normalization": "见 backend/tests/test_resume_generate_golden.py 模块 docstring（版本 1）",
        "cases": dict(sorted(digests.items())),
    }
    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


@pytest.fixture(autouse=True)
def _isolate_runner():
    """后台生成运行器是进程内单例：用例前后都释放，避免线程跨用例残留。"""
    reset_resume_generate_runner()
    yield
    reset_resume_generate_runner()


def test_generate_paths_match_golden_manifest(client, monkeypatch):
    """两条生成路径各跑一次，与 fixtures/generate_golden/manifest.json 比对。"""
    digests: dict[str, str] = {}
    for case, with_job in _CASES:
        record = _generate_record(client, monkeypatch, with_job=with_job)
        digests[case] = _payload_sha256(_golden_payload(record))

    manifest = _load_manifest()
    if manifest is None:
        _write_manifest(digests)
        return

    assert manifest["rules_version"] == RULES_VERSION, (
        "规范化规则版本不符：manifest 为 "
        f"{manifest['rules_version']}，当前为 {RULES_VERSION}；"
        "规则变化时必须审阅并重新生成 manifest.json"
    )
    expected = manifest["cases"]
    assert sorted(expected) == sorted(digests), (
        f"manifest 与用例集合不一致：manifest={sorted(expected)} 用例={sorted(digests)}"
    )
    mismatches = [
        f"  {case}: manifest={expected[case]} generated={digests[case]}"
        for case, _ in _CASES
        if expected[case] != digests[case]
    ]
    assert not mismatches, (
        "generate 规范化金标不匹配（若为有意的输出变更，请审阅差异后删除 "
        f"{MANIFEST_PATH} 重新生成）：\n" + "\n".join(mismatches)
    )
