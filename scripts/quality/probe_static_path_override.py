# SPDX-License-Identifier: Apache-2.0
"""A00/F1 隔离探针：dist 根文件的 ?path=/?file= 不能改变实际读取的文件。

只用临时目录与内存对象，不读真实数据、不启动服务。运行：

    backend\\.venv\\Scripts\\python.exe scripts/quality/probe_static_path_override.py

退出码 0 表示所有断言成立；任何越界读取都会打印 LEAKED: True 并非零退出。
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = REPO_ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.static_spa import mount_static_spa  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

ICON = b"ICON-BYTES"
CANARY = "CANARY-CONTENT"


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="rf-static-path-probe-") as tmp:
        root = Path(tmp)
        dist = root / "dist"
        (dist / "assets").mkdir(parents=True)
        (dist / "index.html").write_text("<html>INDEX</html>", encoding="utf-8")
        (dist / "resumeforge-icon.png").write_bytes(ICON)
        canary = root / "canary.txt"
        canary.write_text(CANARY, encoding="utf-8")

        app = FastAPI()
        mount_static_spa(app, dist)
        leaked = False
        with TestClient(app) as client:
            for params in (
                {"path": str(canary)},
                {"file": str(canary)},
                {"path": "../../canary.txt"},
            ):
                response = client.get("/resumeforge-icon.png", params=params)
                body = response.content
                print(
                    f"GET /resumeforge-icon.png params={params} -> "
                    f"{response.status_code} bytes={body!r}"
                )
                assert response.status_code == 200, response.text
                assert body == ICON, "查询参数改变了返回内容（越界读取）"
                leaked = leaked or CANARY.encode() in body

            root_response = client.get("/", headers={"accept": "text/html"})
            print(f"GET / -> {root_response.status_code} index={b'INDEX' in root_response.content}")
            assert root_response.status_code == 200 and b"INDEX" in root_response.content

            deep = client.get("/resumes/42", headers={"accept": "text/html"})
            print(
                f"GET /resumes/42 (accept html) -> {deep.status_code} index={b'INDEX' in deep.content}"
            )
            assert deep.status_code == 200 and b"INDEX" in deep.content

            missing = client.get("/assets/missing-abc.js")
            print(f"GET /assets/missing-abc.js -> {missing.status_code}")
            assert missing.status_code == 404

            post = client.post("/resumeforge-icon.png")
            print(f"POST /resumeforge-icon.png -> {post.status_code}")
            assert post.status_code == 405

        print(f"LEAKED: {leaked}")
        print("STATIC PATH OVERRIDE PROBE: PASS")
        return 1 if leaked else 0


if __name__ == "__main__":
    raise SystemExit(main())
