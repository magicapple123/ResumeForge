# SPDX-License-Identifier: Apache-2.0
r"""生成 CI / 单测用的 tiny ONNX fixture（不下载 123.5MB 真实权重）。

产物（``backend/tests/fixtures/rag_eval/tiny_onnx/``，进 git）：
- ``tiny_embed.onnx``：input_ids int64 [batch, seq] + attention_mask int64 [batch, seq]
  （声明但模型不使用）→ last_hidden_state float32 [batch, seq, 8]。每个 token 位置的输出
  都是"全 token 词嵌入均值"，因此 cls / last-token / mean 三种池化都得到同一条 8 维向量；
  文本不同向量不同、结果确定性（权重由固定公式生成）。
- ``tokenizer.json``：WordLevel + TemplateProcessing（``[CLS] $A [SEP]``），含
  ``[UNK]/[PAD]``，预分词按"每个汉字 / 连续字母数字 / 单个其它符号"切开。

为什么要它：CI 不得下载真实权重，但本地 provider 的"加载 → 批内 padding → session.run →
池化"路径必须有真 ONNX 才验证得到；本 fixture 同时服务 ``rag-runtime-matrix``` 的
"加载 tiny 模型推理"步骤。

依赖不进 backend requirements（在隔离 venv 里跑）：
    python -m venv .venv-tiny
    .venv-tiny\Scripts\pip install onnx tokenizers==0.23.3 numpy==2.5.4
    .venv-tiny\Scripts\python scripts/make_tiny_onnx_fixture.py

生成结果**确定性**：embedding 权重由 ``(i*7 + j*3) % 13`` 的固定公式给出，同一版本
onnx 库下重复生成字节一致；fixture 本身提交进 git，本脚本只用于重新生成/审阅。
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from onnx import TensorProto, helper, numpy_helper
from tokenizers import Tokenizer, models, pre_tokenizers, processors

DIM = 8
_VOCAB_TOKENS = (
    ["[PAD]", "[UNK]", "[CLS]", "[SEP]"]
    + list("数据增长分析用户产品运营项目经历实习上海北京会员留存渠道实验看板模型指标策略召回")
    + ["SQL", "Python", "Excel", "RFM", "AB"]
)
# 幂等去重后作为 token → id（顺序固定，重跑生成同一个 tokenizer）。
VOCAB: dict[str, int] = {token: index for index, token in enumerate(dict.fromkeys(_VOCAB_TOKENS))}
DEFAULT_OUTPUT = (
    Path(__file__).resolve().parents[1]
    / "backend"
    / "tests"
    / "fixtures"
    / "rag_eval"
    / "tiny_onnx"
)


def build_tokenizer() -> Tokenizer:
    tokenizer = Tokenizer(models.WordLevel(vocab=VOCAB, unk_token="[UNK]"))
    # 按空白切词：fixture 的测试文本用"空格分隔的词"（中文词也在词表里），不引入
    # Rust regex 的 unicode 转义差异（tokenizers 的 Split 走 Rust regex，与 Python re
    # 语法并不完全一致——这里刻意只用最稳的 Whitespace）。
    tokenizer.pre_tokenizer = pre_tokenizers.Whitespace()
    tokenizer.post_processor = processors.TemplateProcessing(
        single="[CLS] $A [SEP]",
        special_tokens=[("[CLS]", VOCAB["[CLS]"]), ("[SEP]", VOCAB["[SEP]"])],
    )
    return tokenizer


def _embedding_table(vocab_size: int) -> np.ndarray:
    values = np.array(
        [
            [((row * 7 + column * 3) % 13) / 13.0 - 0.5 for column in range(DIM)]
            for row in range(vocab_size)
        ],
        dtype=np.float32,
    )
    return values


def build_model(vocab_size: int) -> object:
    embeddings = numpy_helper.from_array(_embedding_table(vocab_size), name="embeddings")
    initializers = [
        embeddings,
        numpy_helper.from_array(np.array([0], dtype=np.int64), name="batch_index"),
        numpy_helper.from_array(np.array([1], dtype=np.int64), name="seq_index"),
        numpy_helper.from_array(np.array([DIM], dtype=np.int64), name="hidden_dim"),
    ]
    nodes = [
        helper.make_node("Gather", ["embeddings", "input_ids"], ["token_vectors"], axis=0),
        helper.make_node("ReduceMean", ["token_vectors"], ["mean_vector"], axes=[1], keepdims=1),
        helper.make_node("Shape", ["input_ids"], ["input_shape"]),
        helper.make_node("Gather", ["input_shape", "batch_index"], ["batch_dim"], axis=0),
        helper.make_node("Gather", ["input_shape", "seq_index"], ["seq_dim"], axis=0),
        # Gather 的 indices 是 [0]/[1]，输出已是 rank-1 的 [1]（不再 Unsqueeze，否则 Concat
        # 的 rank 对不上：ONNX Concat 要求所有输入同 rank）。
        helper.make_node(
            "Concat", ["batch_dim", "seq_dim", "hidden_dim"], ["target_shape"], axis=0
        ),
        helper.make_node("Expand", ["mean_vector", "target_shape"], ["last_hidden_state"]),
    ]
    inputs = [
        helper.make_tensor_value_info("input_ids", TensorProto.INT64, ["batch", "seq"]),
        helper.make_tensor_value_info("attention_mask", TensorProto.INT64, ["batch", "seq"]),
    ]
    outputs = [
        helper.make_tensor_value_info("last_hidden_state", TensorProto.FLOAT, ["batch", "seq", DIM])
    ]
    graph = helper.make_graph(nodes, "tiny_embedding", inputs, outputs, initializers)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 9  # 固定在 onnxruntime 1.31 支持范围内，避免随 onnx 库漂移
    return model


def main() -> int:
    parser = argparse.ArgumentParser(description="生成 tiny ONNX embedding fixture")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    import onnx

    output: Path = args.output
    output.mkdir(parents=True, exist_ok=True)
    tokenizer_path = output / "tokenizer.json"
    model_path = output / "tiny_embed.onnx"

    tokenizer = build_tokenizer()
    tokenizer.save(str(tokenizer_path))
    onnx.save(build_model(len(VOCAB)), str(model_path))

    summary = {
        "dim": DIM,
        "vocab_size": len(VOCAB),
        "tokenizer": {
            "file": tokenizer_path.name,
            "bytes": tokenizer_path.stat().st_size,
            "sha256": hashlib.sha256(tokenizer_path.read_bytes()).hexdigest(),
        },
        "model": {
            "file": model_path.name,
            "bytes": model_path.stat().st_size,
            "sha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
        },
    }
    (output / "tiny_fixture.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
