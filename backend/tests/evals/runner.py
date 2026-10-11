"""RF-15 离线评测执行器：读样本 + 读录制输出 → 跑全部规则 → 产出结果列表。

**CI 零网络依赖的关键设计**：生成输出来自 `recordings/<case_id>.json`（预先录制
的产物，见 README 的录制流程）；某个样本没有录制文件时**跳过**而不是报错——
普通 pytest 全量运行不依赖任何模型调用，评测只对已录制的内容回放规则。

录制文件格式（与 optin_real_model.py 的落盘一致）::

    {
      "case_id": "synthetic_001",
      "output_text": "……生成的简历正文……",
      "meta": {"prompt_version": "2026-10-10", "model": "deepseek-chat",
               "generated_at": "2026-10-10T12:00:00"}
    }
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import checks
from sample_schema import SyntheticSample

EVALS_DIR = Path(__file__).resolve().parent
FIXTURES_DIR = EVALS_DIR.parent / "fixtures" / "synthetic"
RECORDINGS_DIR = EVALS_DIR / "recordings"
KNOWN_BAD_DIR = RECORDINGS_DIR / "_known_bad"


@dataclass
class Recording:
    """一次真实生成的录制产物（输出正文 + 血缘元数据）。"""

    output_text: str
    prompt_version: str = "unknown"
    model: str = ""
    generated_at: str = ""


def load_index(fixtures_dir: Path | None = None) -> dict:
    """读 _index.json 汇总清单（含维度统计）。"""
    path = (fixtures_dir or FIXTURES_DIR) / "_index.json"
    return json.loads(path.read_text(encoding="utf-8"))


def load_samples(fixtures_dir: Path | None = None) -> list[SyntheticSample]:
    """加载全部合成样本并按 id 排序；schema 校验失败会直接抛错（快失败）。"""
    directory = fixtures_dir or FIXTURES_DIR
    samples = []
    for path in sorted(directory.glob("synthetic_*.json")):
        sample = SyntheticSample.model_validate_json(path.read_text(encoding="utf-8"))
        if sample.id != path.stem:
            raise ValueError(f"样本 id 与文件名不一致：{sample.id} vs {path.stem}")
        samples.append(sample)
    return samples


def load_sample(sample_id: str, fixtures_dir: Path | None = None) -> SyntheticSample | None:
    """按 id 加载单份样本；不存在返回 None。"""
    path = (fixtures_dir or FIXTURES_DIR) / f"{sample_id}.json"
    if not path.is_file():
        return None
    return SyntheticSample.model_validate_json(path.read_text(encoding="utf-8"))


def load_recording(case_id: str, recordings_dir: Path | None = None) -> Recording | None:
    """读取某个样本的录制输出；没有录制文件返回 None（调用方应跳过该样本）。"""
    path = (recordings_dir or RECORDINGS_DIR) / f"{case_id}.json"
    if not path.is_file():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    meta = raw.get("meta") or {}
    return Recording(
        output_text=str(raw.get("output_text") or ""),
        prompt_version=str(meta.get("prompt_version") or "unknown"),
        model=str(meta.get("model") or ""),
        generated_at=str(meta.get("generated_at") or ""),
    )


def evaluate_sample(sample: SyntheticSample, recording: Recording) -> dict:
    """对一份录制输出跑全部规则，返回单个样本的评测结果。"""
    return {
        "sample_id": sample.id,
        "skipped": False,
        "findings": checks.run_all_checks(sample, recording.output_text),
        "meta": {
            "prompt_version": recording.prompt_version,
            "model": recording.model,
            "generated_at": recording.generated_at,
        },
    }


def evaluate_all(
    recordings_dir: Path | None = None, fixtures_dir: Path | None = None
) -> list[dict]:
    """评测全部样本：有录制则跑规则，无录制则跳过（结果置 skipped=True）。"""
    results = []
    for sample in load_samples(fixtures_dir):
        recording = load_recording(sample.id, recordings_dir)
        if recording is None:
            results.append({"sample_id": sample.id, "skipped": True, "findings": [], "meta": {}})
            continue
        results.append(evaluate_sample(sample, recording))
    return results
