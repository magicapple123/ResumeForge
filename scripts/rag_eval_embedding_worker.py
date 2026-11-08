# SPDX-License-Identifier: Apache-2.0
"""Phase 1 spike 的**隔离推理进程**：只依赖 onnxruntime + tokenizers，不 import 应用。

为什么拆成独立进程：任务书 §2.5 规定 torch/onnxruntime 只能装在隔离临时 venv 或
`requirements-rag.txt`，**不能污染 backend/.venv 与首装依赖**。本脚本用隔离 venv 的
解释器运行，从 JSON 读文本、写出向量 JSON；应用侧（`rag_eval_embedding_spike.py`）
用主 venv 做排序与指标。"模型权重只在本机 runtime 目录，不进仓库/安装包"。

输入 JSON：{"model_dir","texts":[{"id","text"}],"max_length"}
输出 JSON：{"model","pooling","dim","vectors":{"id":[float,...]},"encode_ms":{"id":毫秒}}
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path


def _torch_pooling_config(model_dir: Path) -> dict:
    path = model_dir / "1_Pooling" / "config.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    from tokenizers import Tokenizer

    model_dir = Path(args.model_dir)
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    texts = payload["texts"]
    max_length = int(payload.get("max_length") or 512)
    onnx_files = sorted(model_dir.glob("*.onnx"))
    if not onnx_files:
        raise SystemExit(f"模型目录没有 .onnx：{model_dir}")
    import onnxruntime as ort

    tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
    tokenizer.enable_truncation(max_length=max_length)
    session = ort.InferenceSession(str(onnx_files[0]), providers=["CPUExecutionProvider"])
    input_names = {item.name for item in session.get_inputs()}
    output_names = [item.name for item in session.get_outputs()]
    pooling_config = _torch_pooling_config(model_dir)
    pooling = "mean"
    if pooling_config.get("pooling_mode_cls_token"):
        pooling = "cls"
    elif pooling_config.get("pooling_mode_lasttoken"):
        pooling = "last-token"

    vectors: dict[str, list[float]] = {}
    encode_ms: dict[str, float] = {}
    dim = 0
    for item in texts:
        started = time.perf_counter()
        encoding = tokenizer.encode(item["text"])
        feed: dict[str, object] = {"input_ids": [encoding.ids]}
        if "attention_mask" in input_names:
            feed["attention_mask"] = [encoding.attention_mask]
        if "token_type_ids" in input_names:
            feed["token_type_ids"] = [encoding.type_ids]
        outputs = session.run(None, feed)
        sequence = outputs[0][0]
        if pooling == "cls":
            pooled = sequence[0]
        elif pooling == "last-token":
            length = max(1, len(encoding.ids))
            pooled = sequence[length - 1]
        else:
            mask = encoding.attention_mask
            total = [0.0] * len(sequence[0])
            count = 0
            for token_index, keep in enumerate(mask):
                if not keep:
                    continue
                row = sequence[token_index]
                for position in range(len(row)):
                    total[position] += float(row[position])
                count += 1
            pooled = [value / max(1, count) for value in total]
        norm = sum(float(value) * float(value) for value in pooled) ** 0.5
        if norm <= 0:
            raise SystemExit("向量为零，模型输出异常")
        vectors[item["id"]] = [float(value) / norm for value in pooled]
        dim = len(pooled)
        encode_ms[item["id"]] = (time.perf_counter() - started) * 1000
    output = {
        "model_file": onnx_files[0].name,
        "pooling": pooling,
        "dim": dim,
        "input_names": sorted(input_names),
        "output_names": output_names,
        "vectors": vectors,
        "encode_ms": encode_ms,
    }
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False), encoding="utf-8")
    print(f"encoded {len(vectors)} texts dim={dim} pooling={pooling} file={onnx_files[0].name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
