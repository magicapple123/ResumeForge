"""版本号单源校验：``backend/app/config.py`` 的 ``app_version`` 是唯一事实来源。

发布打包（``Build-Release.ps1``）、应用内更新器与启动器都用同一条正则从 config.py
读版本号；前端 ``package.json`` 的 ``version`` 是纯元数据，历史上靠发版时人工同步，
漂移了没有任何东西会报错。这个脚本在 CI 与发版前核对两处一致，把"漂移"从
"上线后才发现"提前到"合并前就失败"。

用法：``python scripts/check_version_sync.py``（仓库内任意位置；退出码 0 = 一致）。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_CONFIG = ROOT / "backend" / "app" / "config.py"
_PACKAGE = ROOT / "frontend" / "package.json"

# 与 Build-Release.ps1 / Update-ResumeForge.ps1 / ResumeForge.Python.ps1 保持
# 同一条正则：三处消费方怎么读，校验就怎么读，避免"校验器和消费方各读各的"。
_VERSION_RE = re.compile(r'app_version:\s*str\s*=\s*"([^"]+)"')


def config_version() -> str:
    content = _CONFIG.read_text(encoding="utf-8")
    match = _VERSION_RE.search(content)
    if match is None:
        raise SystemExit(f"FAIL: {_CONFIG} 里找不到 app_version 字面量（发布链依赖它）")
    return match.group(1)


def package_version() -> str:
    data = json.loads(_PACKAGE.read_text(encoding="utf-8"))
    version = data.get("version")
    if not isinstance(version, str) or not version:
        raise SystemExit(f"FAIL: {_PACKAGE} 缺少 version 字段")
    return version


def main() -> int:
    expected = config_version()
    actual = package_version()
    if expected != actual:
        print(
            "FAIL: 版本号漂移——"
            f"config.py app_version={expected}，frontend/package.json version={actual}。"
            "发版时请同步修改两处（config.py 是唯一事实来源）。"
        )
        return 1
    print(f"OK: 版本一致（{expected}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
