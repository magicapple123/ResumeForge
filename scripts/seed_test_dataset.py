# SPDX-License-Identifier: Apache-2.0
"""生成一份**内容饱满、可直接导入**的测试数据集（zip），用于逐页签试用功能。

与 ``scripts/seed_demo_data.py`` 的区别：那份是给 README/官网截图用的演示数据（内容短、
一眼能看出是示例）；这份面向"导入后把每个功能点都点一遍"——13 个内置板块的 106 个小
字段几乎都被填上，且经历里的数字与事实台账、简历正文互相对得上。

用法（在仓库根目录执行）：

    backend\\.venv\\Scripts\\python.exe scripts\\seed_test_dataset.py --check

默认把工作库写到 ``runtime/test_dataset/build-<时间戳>/``（``runtime/`` 已被 .gitignore
忽略），压缩包落在同一目录。**不会碰 ``backend/data/resume_forge.db``**：入口先把
``DATABASE_URL`` 指到工作库，再导入任何 ``app.*``。

    --out <路径>  工作库位置（必须不存在；已存在时直接拒绝，避免覆盖真实数据）
    --zip <路径>  压缩包输出位置
    --check       写完后用 TestClient 把只读接口读一遍（不起服务、不联网）
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND = REPO_ROOT / "backend"
SCRIPTS = REPO_ROOT / "scripts"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(SCRIPTS))

DEFAULT_DIR = REPO_ROOT / "runtime" / "test_dataset" / f"build-{datetime.now():%Y%m%d-%H%M%S}"


def _preparse() -> tuple[Path, Path, bool]:
    """在导入 app 之前把三个参数都读出来，并给出带时间戳的默认值。

    为什么不能交给 ``dataset_seed.cli`` 解析：``app.config`` 在**导入时**就把
    ``database_url`` 缓存成进程内单例，先导入再改环境变量等于没改，数据会写进用户
    真实的 ``backend/data/resume_forge.db``。
    """
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--out", default=str(DEFAULT_DIR / "resume_forge.db"))
    parser.add_argument("--zip", default=str(DEFAULT_DIR / "简历通测试数据集.zip"))
    parser.add_argument("--check", action="store_true")
    known, _ = parser.parse_known_args()
    return (
        Path(known.out).expanduser().resolve(),
        Path(known.zip).expanduser().resolve(),
        bool(known.check),
    )


DB_PATH, ZIP_PATH, CHECK = _preparse()
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
os.environ["DATABASE_URL"] = "sqlite:///" + DB_PATH.as_posix()

from dataset_seed.cli import main  # noqa: E402  (必须在 DATABASE_URL 定好之后)

if __name__ == "__main__":
    arguments = ["--out", str(DB_PATH), "--zip", str(ZIP_PATH)]
    if CHECK:
        arguments.append("--check")
    raise SystemExit(main(arguments))
