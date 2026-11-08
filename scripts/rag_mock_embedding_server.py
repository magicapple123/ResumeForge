# SPDX-License-Identifier: Apache-2.0
"""本地 mock embedding 端点（RAG v3 远程 E2E 用；**不进产品、不进安装包**）。

只用于验证协议与失败路径：纯标准库（http.server），不联网、不需要真实 key、不引入任何
依赖。真实 DashScope 本机缺 EMBEDDING_API_KEY，因此远程链路的可复现证据以本 mock 为准。

启动（端口默认随机，避免与开发机其它服务冲突）：

    python scripts/rag_mock_embedding_server.py [--port 0] [--dim 16] [--max-batch 25]
                                                [--require-key] [--slow-seconds 0.05]

stdout 首行打印一行 JSON（供脚本读取真实地址）：

    {"base_url": "http://127.0.0.1:<port>/v1", "dim": 16, "max_batch": 25, "require_key": false}

端点（base 即上面的 base_url）：

    GET  {base}/models           OpenAI 模型列表（data[].id）
    POST {base}/embeddings       OpenAI 形状 {"data": [{"embedding": [...]}, ...]}
    POST {base}/template         二维数组形状 {"embeddings": [[...], ...]}
    POST {base}/fail/401|429|500 直接返回对应状态码（失败矩阵/重试用）
    POST {base}/badjson          200 + 非法 JSON（坏响应用例）
    POST {base}/slow             等 --slow-seconds 后返回正常 OpenAI 形状（超时用例）
    GET  {base}/badjson          同上（GET 版本）

--require-key 时没有 Bearer 头一律 401（任何非空 Bearer 都接受，避免在代码里落任何 key）。
向量由「mock: + 文本」的 sha256 确定性派生并 L2 归一，且**正相关**（各分量≈1 + 微小扰动）：
同文本同向量、不同文本可区分，任意 chunk×query 余弦≈0.999——E2E 才能观察到
candidates>0；纯随机向量会让 cosine≈0、boost 为空，看不出接线。**请求体与文本永不
打印/落盘**（只记 method + path + status）。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

DEFAULT_DIM = 16
DEFAULT_MAX_BATCH = 25
DEFAULT_HOST = "127.0.0.1"


def deterministic_vector(text: str, dim: int) -> list[float]:
    """确定性向量（同文本同向量）：正相关——各分量≈1 + 微小确定性扰动，再 L2 归一。

    为什么不是随机向量：E2E 要证明 provider=openai-http 后 candidates>0。随机向量的
    cosine≈0，RRF 融合分几乎不可用、boost 稀疏；正相关向量让任意 chunk×query 的余弦
    ≈0.999，候选覆盖与真实语义端点一致（仍然确定性、可复现）。
    """
    if dim <= 0:
        raise ValueError("dim 必须为正数")
    seed = ("mock:" + str(text)).encode("utf-8")
    values: list[float] = []
    for index in range(dim):
        digest = hashlib.sha256(seed + b":" + str(index).encode()).digest()
        jitter = (digest[0] % 7 - 3) / 500.0  # ±0.006：不同文本可区分，cosine 仍≈0.999
        values.append(1.0 + jitter)
    norm = math.sqrt(sum(value * value for value in values)) or 1.0
    return [round(value / norm, 6) for value in values]


def _texts_from_body(body: Any) -> list[str]:
    if not isinstance(body, dict):
        raise ValueError("请求体必须是 JSON 对象")
    raw = body.get("input", body.get("texts"))
    if not isinstance(raw, list) or not all(isinstance(item, str) for item in raw):
        raise ValueError("input/texts 必须是字符串数组")
    return raw


class _MockServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(
        self,
        address: tuple[str, int],
        *,
        dim: int,
        max_batch: int,
        require_key: bool,
        slow_seconds: float,
    ) -> None:
        super().__init__(address, _MockHandler)
        self.dim = dim
        self.max_batch = max_batch
        self.require_key = require_key
        self.slow_seconds = slow_seconds


class _MockHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    @property
    def server_config(self) -> _MockServer:
        return self.server  # type: ignore[return-value]

    def log_message(self, format: str, *args: Any) -> None:
        # 只记请求行/状态：请求体与文本绝不打印。
        sys.stderr.write("[mock] " + (format % args) + "\n")

    # ---- 响应工具 ----
    def _send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_bad_json(self) -> None:
        body = b'{"object": "list", "data": ['
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> Any:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b"{}"
        return json.loads(raw or b"{}")

    def _authorized(self) -> bool:
        if not self.server_config.require_key:
            return True
        auth = self.headers.get("Authorization") or ""
        return auth.startswith("Bearer ") and len(auth) > len("Bearer ")

    def _vectors(self, texts: list[str]) -> list[list[float]]:
        return [deterministic_vector(text, self.server_config.dim) for text in texts]

    # ---- 路由 ----
    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler 的固定命名
        path = self.path.split("?", 1)[0]
        if path == "/v1/models":
            self._send_json(
                200,
                {
                    "object": "list",
                    "data": [
                        {"id": "mock-embedding-v1", "object": "model"},
                        {"id": "mock-embedding-large", "object": "model"},
                    ],
                },
            )
        elif path == "/v1/badjson":
            self._send_bad_json()
        else:
            self._send_json(404, {"error": {"message": "not found"}})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path in {"/v1/fail/401", "/v1/fail/429", "/v1/fail/500"}:
            status = int(path.rsplit("/", 1)[-1])
            self._send_json(status, {"error": {"message": f"mock failure {status}"}})
            return
        if path == "/v1/badjson":
            self._send_bad_json()
            return
        if path == "/v1/slow":
            time.sleep(max(0.0, self.server_config.slow_seconds))
        try:
            body = self._read_json()
            texts = _texts_from_body(body)
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": {"message": "invalid request body"}})
            return
        if len(texts) > self.server_config.max_batch:
            # 与 DashScope 实测文案同形：为"第 26 条必须另起一片"提供可观测证据。
            self._send_json(
                400,
                {
                    "error": {
                        "message": "batch size is invalid, it should not be larger "
                        f"than {self.server_config.max_batch}"
                    }
                },
            )
            return
        if not self._authorized():
            self._send_json(401, {"error": {"message": "invalid api key"}})
            return
        vectors = self._vectors(texts)
        if path == "/v1/template":
            self._send_json(200, {"embeddings": [list(vector) for vector in vectors]})
            return
        if path == "/v1/embeddings":
            self._send_json(
                200,
                {
                    "object": "list",
                    "model": body.get("model", ""),
                    "data": [
                        {"object": "embedding", "index": index, "embedding": list(vector)}
                        for index, vector in enumerate(vectors)
                    ],
                },
            )
            return
        self._send_json(404, {"error": {"message": "not found"}})


def build_server(
    *,
    host: str = DEFAULT_HOST,
    port: int = 0,
    dim: int = DEFAULT_DIM,
    max_batch: int = DEFAULT_MAX_BATCH,
    require_key: bool = False,
    slow_seconds: float = 0.05,
) -> _MockServer:
    """构造（未启动的）mock 服务；测试可自行起线程后读 server_address 拿真实端口。"""
    return _MockServer(
        (host, port),
        dim=dim,
        max_batch=max_batch,
        require_key=require_key,
        slow_seconds=slow_seconds,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="RAG v3 远程 embedding mock 端点")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=0, help="0 = 随机端口（默认）")
    parser.add_argument("--dim", type=int, default=DEFAULT_DIM)
    parser.add_argument("--max-batch", type=int, default=DEFAULT_MAX_BATCH)
    parser.add_argument("--require-key", action="store_true")
    parser.add_argument("--slow-seconds", type=float, default=0.05)
    args = parser.parse_args(argv)
    server = build_server(
        host=args.host,
        port=args.port,
        dim=args.dim,
        max_batch=args.max_batch,
        require_key=args.require_key,
        slow_seconds=args.slow_seconds,
    )
    host, port = server.server_address[:2]
    payload = {
        "base_url": f"http://{host}:{port}/v1",
        "dim": args.dim,
        "max_batch": args.max_batch,
        "require_key": args.require_key,
    }
    print(json.dumps(payload, ensure_ascii=False), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
