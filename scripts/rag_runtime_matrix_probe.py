# SPDX-License-Identifier: Apache-2.0
"""rag-runtime-matrix 平台探针：在 4 个目标平台验证推理运行时可用且数值稳定。

CI 作业 ``rag-runtime-matrix`` 在 Windows x64 / Linux x64 / Linux arm64 / macOS arm64 上
临时安装 pin 版本的 onnxruntime + numpy + tokenizers（**不进 requirements.txt**，产品运行时
由 rag-runtime 资产包预解包分发），然后运行本探针。脚本只 import 这三个第三方库，
**不 import 应用代码、不碰数据库、不下载真实权重**（只用 A 产出的 tiny ONNX fixture）。

断言（任一失败 → 先写 JSON 再退出码 1，CI 红）：
- tiny ONNX 能加载并推理；
- 同一输入连续两次推理结果逐元素 ±1e-6 一致（跨机器/跨平台数值稳定性）；
- tokenizer 对固定文本两次编码的 ids 完全一致且非空；
- 输出维度 > 0（排除零维/空输出）。

输出 JSON：platform / arch / python / onnxruntime / numpy / tokenizers / dim / stable /
encode_ms（另含 fixture 文件名与输出哈希，便于跨平台对比而不落任何文本内容）。
默认落 ``runtime/rag_eval/v3_runtime_matrix_<platform>-<arch>.json``。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = REPO_ROOT / "backend" / "tests" / "fixtures" / "rag_eval" / "tiny_onnx"
#: 固定编码候选文本：tiny tokenizer 词表未知，按"非 [UNK] token 最多"确定性挑一个
#: （同一 fixture 在 4 个平台挑到同一句，因此仍可跨平台对比），保证 ids 里真的有词、
#: 而不是整句都是 [UNK]；全部失败才退出。
FIXED_TEXTS = (
    "数 据 分 析 项 目 实 习",
    "SQL Excel Python RFM 分 析",
    "ResumeForge RAG runtime matrix probe",
    "resume test 2026",
)
TOLERANCE = 1e-6


def platform_label() -> str:
    """归一化成 ``windows`` / ``macos`` / ``linux``（与资产清单的平台键同一口径）。"""
    system = platform.system().lower()
    return {"windows": "windows", "darwin": "macos", "linux": "linux"}.get(system, system)


def arch_label() -> str:
    """归一化成 ``x64`` / ``arm64``；未知架构原样返回小写值。"""
    machine = platform.machine().strip().lower()
    if machine in {"amd64", "x86_64", "x64"}:
        return "x64"
    if machine in {"arm64", "aarch64"}:
        return "arm64"
    return machine or "unknown"


def find_onnx_file(fixture_dir: Path) -> Path:
    """tiny 模型文件：优先 A 约定的 ``tiny_embed.onnx``，否则取目录里任意一个 ``*.onnx``。"""
    preferred = fixture_dir / "tiny_embed.onnx"
    if preferred.is_file():
        return preferred
    candidates = sorted(path for path in fixture_dir.glob("*.onnx") if path.is_file())
    if not candidates:
        raise SystemExit(
            f"找不到 tiny ONNX fixture：{fixture_dir}（A 负责产出；CI 里这是缺失资产，不是 flaky）"
        )
    return candidates[0]


def _encode_fixed_text(tokenizer: Any) -> tuple[str, list[int]]:
    """在固定候选文本里挑一条"非 [UNK] token 最多"的编码，返回 (文本, ids)。"""
    unk_id = tokenizer.token_to_id("[UNK]")
    best: tuple[int, str, list[int]] | None = None
    last_error: Exception | None = None
    for text in FIXED_TEXTS:
        try:
            ids = list(tokenizer.encode(text).ids)
        except Exception as exc:  # noqa: BLE001 - 词表未知时换下一句固定文本
            last_error = exc
            continue
        if not ids:
            continue
        known = sum(1 for token_id in ids if token_id != unk_id)
        if best is None or known > best[0]:
            best = (known, text, ids)
    if best is None:
        raise SystemExit(f"tiny tokenizer 无法编码任何固定文本：{last_error}")
    return best[1], best[2]


def run_probe(fixture_dir: Path) -> dict[str, Any]:
    """加载 fixture 并跑两次推理；返回待写盘的证据字典（失败即 SystemExit）。"""
    import numpy as np
    import onnxruntime as ort
    import tokenizers
    from tokenizers import Tokenizer

    onnx_file = find_onnx_file(fixture_dir)
    tokenizer_file = fixture_dir / "tokenizer.json"
    if not tokenizer_file.is_file():
        raise SystemExit(f"找不到 tiny tokenizer：{tokenizer_file}")
    tokenizer = Tokenizer.from_file(str(tokenizer_file))
    text, first_ids = _encode_fixed_text(tokenizer)
    second_ids = list(tokenizer.encode(text).ids)
    ids_stable = first_ids == second_ids

    session = ort.InferenceSession(str(onnx_file), providers=["CPUExecutionProvider"])
    input_names = [item.name for item in session.get_inputs()]
    feed: dict[str, Any] = {"input_ids": np.array([first_ids], dtype=np.int64)}
    if "attention_mask" in input_names:
        feed["attention_mask"] = np.array([[1] * len(first_ids)], dtype=np.int64)
    if "token_type_ids" in input_names:
        feed["token_type_ids"] = np.array([[0] * len(first_ids)], dtype=np.int64)

    started = time.perf_counter()
    first_outputs = session.run(None, feed)
    encode_ms = (time.perf_counter() - started) * 1000.0
    second_outputs = session.run(None, feed)

    shape_ok = len(first_outputs) == len(second_outputs)
    max_abs_diff = 0.0
    if shape_ok:
        for left, right in zip(first_outputs, second_outputs, strict=True):
            left_array = np.asarray(left, dtype=np.float64)
            right_array = np.asarray(right, dtype=np.float64)
            if left_array.shape != right_array.shape:
                shape_ok = False
                break
            if left_array.size:
                max_abs_diff = max(max_abs_diff, float(np.max(np.abs(left_array - right_array))))

    main_output = np.asarray(first_outputs[0])
    dim = int(main_output.shape[-1]) if main_output.ndim >= 1 else int(main_output.size)
    stable = bool(ids_stable and shape_ok and max_abs_diff <= TOLERANCE and dim > 0)
    model_digest = hashlib.sha256(
        np.ascontiguousarray(main_output, dtype=np.float32).tobytes()
    ).hexdigest()

    return {
        "platform": platform_label(),
        "arch": arch_label(),
        "python": platform.python_version(),
        "onnxruntime": ort.__version__,
        "numpy": np.__version__,
        "tokenizers": tokenizers.__version__,
        "model_file": onnx_file.name,
        "tokenizer_file": tokenizer_file.name,
        "fixed_text": text,
        "token_ids": first_ids,
        "dim": dim,
        "output_shape": list(main_output.shape),
        "stable": stable,
        "max_abs_diff": max_abs_diff,
        "encode_ms": round(encode_ms, 4),
        "first_output_sha256": model_digest,
        "checked_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def default_output_path(result: dict[str, Any]) -> Path:
    label = f"{result['platform']}-{result['arch']}"
    return REPO_ROOT / "runtime" / "rag_eval" / f"v3_runtime_matrix_{label}.json"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="RAG runtime matrix platform probe")
    parser.add_argument("--fixture-dir", default=str(FIXTURE_DIR))
    parser.add_argument("--output", default="", help="证据 JSON 路径（默认按平台/架构命名）")
    args = parser.parse_args(argv)

    result = run_probe(Path(args.fixture_dir))
    output = Path(args.output) if args.output else default_output_path(result)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    print(f"written: {output}")
    if not result["stable"]:
        print(
            "probe failed: ids/推理不稳定（见 stable / max_abs_diff）",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
