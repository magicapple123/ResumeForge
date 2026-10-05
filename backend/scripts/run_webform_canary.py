"""自起临时 headless 浏览器（9333）串行跑网申 canary——无浏览器也能本地真机验证。

**为什么必须串行**：canary 用例共用同一个浏览器、每个用例都要把标签页拉到前台；
并行 worker 一激活别的用例就把页面挤到后台，Chrome 对后台标签节流，面板跟踪类
用例会偶发假失败。所以 canary 家族在 xdist 下刻意 skip（见
``tests/webform_canary_support.py``），由本脚本负责串行补跑。

行为：

- 9333 上已有浏览器 → 直接复用；那是应用或用户起的，跑完**不关**；
- 没有 → 从常见路径找 Chrome/Edge，用 ``runtime/webform-canary-profile/`` 的
  临时 profile 起 ``--headless=new``，跑完只杀**自己起的**进程；profile 留下复用。

用法（backend 目录，PYTHONUTF8=1）：

    .venv\\Scripts\\python.exe scripts\\run_webform_canary.py
    .venv\\Scripts\\python.exe scripts\\run_webform_canary.py --browser "C:\\...\\chrome.exe"
    .venv\\Scripts\\python.exe scripts\\run_webform_canary.py --keep   # 排障：跑完不关
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
PROFILE_DIR = REPO_ROOT / "runtime" / "webform-canary-profile"
PORT = 9333

_BROWSER_CANDIDATES = (
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
)


def _port_alive() -> bool:
    try:
        response = httpx.get(f"http://127.0.0.1:{PORT}/json/version", timeout=1.5)
    except httpx.HTTPError:
        return False
    return response.status_code == 200


def _find_browser(explicit: str | None) -> Path | None:
    if explicit:
        path = Path(explicit)
        return path if path.exists() else None
    for candidate in _BROWSER_CANDIDATES:
        if Path(candidate).exists():
            return Path(candidate)
    return None


def _launch(browser: Path) -> subprocess.Popen:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen(
        [
            str(browser),
            "--headless=new",
            f"--remote-debugging-port={PORT}",
            f"--user-data-dir={PROFILE_DIR}",
            "--remote-allow-origins=*",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--disable-backgrounding-occluded-windows",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if _port_alive():
            return process
        if process.poll() is not None:
            break
        time.sleep(0.3)
    process.terminate()
    raise RuntimeError(f"浏览器起来了但 {PORT} 端口没有应答（{browser}）")


def _canary_files() -> list[Path]:
    return sorted((BACKEND_DIR / "tests").glob("test_webform_js_canary*.py"))


def main() -> int:
    parser = argparse.ArgumentParser(description="串行跑网申 canary（必要时自起 headless 浏览器）")
    parser.add_argument("--browser", help="Chrome/Edge 可执行文件路径")
    parser.add_argument("--keep", action="store_true", help="跑完不关闭自己起的浏览器")
    args = parser.parse_args()

    files = _canary_files()
    if not files:
        print("没有找到 canary 用例（tests/test_webform_js_canary*.py）。")
        return 1

    process: subprocess.Popen | None = None
    if _port_alive():
        print(f"复用 {PORT} 上已在运行的浏览器（跑完不会关闭它）。")
    else:
        browser = _find_browser(args.browser)
        if browser is None:
            print("没有找到 Chrome/Edge：请用 --browser 指定可执行文件路径。")
            return 1
        print(f"启动临时 headless 浏览器：{browser}")
        process = _launch(browser)

    env = dict(os.environ, PYTHONUTF8="1")
    try:
        print(f"串行运行 {len(files)} 个 canary 文件（不要加 -n）……")
        completed = subprocess.run(
            [sys.executable, "-m", "pytest", "-q", *[str(path) for path in files]],
            cwd=BACKEND_DIR,
            env=env,
        )
        return completed.returncode
    finally:
        if process is not None and not args.keep:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            print(f"已关闭临时浏览器；profile 留在 {PROFILE_DIR}")


if __name__ == "__main__":
    raise SystemExit(main())
