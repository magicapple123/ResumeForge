"""网申匹配语料跑分报告：逐 case 表 + 合计 + 错填/漏填明细。

用法（在 backend 目录，PYTHONUTF8=1）：
    .venv\\Scripts\\python.exe scripts\\webform_match_report.py
    .venv\\Scripts\\python.exe scripts\\webform_match_report.py --update-baseline

``--update-baseline`` 会把当前结果写进 ``tests/fixtures/webform/baseline.json``——
这是回归门槛的数据源，**写完要人工复核报告里的数字**再提交。pytest 侧
（``tests/test_webform_match_corpus.py``）用同一份跑分实现做回归断言。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(BACKEND_DIR / "tests"))

from webform_corpus_support import (  # noqa: E402
    format_report,
    load_baseline,
    load_match_cases,
    run_match_case,
    save_baseline,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="网申匹配语料跑分")
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="把当前结果写入 baseline.json（请复核后提交）",
    )
    args = parser.parse_args()

    cases = load_match_cases()
    if not cases:
        print("语料为空：tests/fixtures/webform/pages/ 下没有 case。")
        return 1

    results = [run_match_case(case) for case in cases]
    print(format_report(results))

    total_wrong = sum(result.wrong for result in results)
    total_missing = sum(len(result.missing) for result in results)
    print(f"\n合计：{len(results)} 个 case，错填 {total_wrong}，漏填 {total_missing}。")
    if total_wrong == 0 and total_missing == 0:
        print("全部 case 与期望完全一致。")

    if args.update_baseline:
        save_baseline(results)
        print("\n已更新 tests/fixtures/webform/baseline.json（请复核上面的数字后提交）。")
    else:
        baseline = load_baseline().get("cases", {})
        if not baseline:
            print("提示：还没有基线文件，确认数字无误后可用 --update-baseline 生成。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
