# SPDX-License-Identifier: Apache-2.0
"""W00/W20 合成样例库生成器：写出 120 份样例 + manifest，并做可重复检查。

两个子命令：

- write：把语料写到磁盘（默认仓库外临时目录），生成 manifest.json / manifest.md
  与 content/<id>.json。manifest 里没有时间戳，同一份语料跑两遍逐字节相同。
- check：**不写任何文件**。先用"重新生成的 manifest"与磁盘上的 manifest 比对
  （证明样例与 manifest 一致、语料可重复），再逐份渲染并按期望判定，最后按
  "失败数"决定退出码。

为什么样例不进 Git：120 份内容体积不小，而且它们**完全是生成器的函数**——把生成
结果提交进来，改一个字段就要同时改代码和样本两条真相。可复现的判据是"跑两遍得到
同一个 manifest"，不是"仓库里躺着 120 个 JSON"。目录在文档里写死为
<系统临时目录>/resumeforge-w20-samples。

用法（仓库根）：
    backend/.venv/Scripts/python.exe scripts/quality/generate_resume_samples.py write
    backend/.venv/Scripts/python.exe scripts/quality/generate_resume_samples.py check
    backend/.venv/Scripts/python.exe scripts/quality/generate_resume_samples.py check --limit 20
    backend/.venv/Scripts/python.exe scripts/quality/generate_resume_samples.py list
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

# 允许两种跑法：python scripts/quality/generate_resume_samples.py（直接执行）与
# import quality.generate_resume_samples（pytest 用）。直接把脚本文件跑起来时没有包
# 上下文，所以先把 scripts/ 放进 sys.path，再按顶层包 quality.* 导入。
_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from quality.sample_corpus import (  # noqa: E402
    CATEGORY_META,
    CORPUS_VERSION,
    ITERATION_SAMPLE_COUNT,
    TOTAL_SAMPLE_COUNT,
    build_corpus,
    corpus_template_names,
)
from quality.sample_render import REPO_ROOT, ensure_backend_on_path  # noqa: E402
from quality.sample_specs import CORPUS_SEED  # noqa: E402
from quality.sample_verify import verify_corpus  # noqa: E402

DEFAULT_OUTPUT_DIR = Path(tempfile.gettempdir()) / "resumeforge-w20-samples"
MANIFEST_NAME = "manifest.json"
MANIFEST_MD_NAME = "manifest.md"
SCHEMA_VERSION = 1


def _content_sha256(content: dict[str, Any]) -> str:
    """规范化内容指纹：与交付/导出的 canonical_content_sha256 同一口径。"""
    ensure_backend_on_path()
    from app.schemas.resume import ResumeContent
    from app.services.resume.resume_delivery import canonical_content_sha256

    normalized = ResumeContent.model_validate(content).model_dump()
    return canonical_content_sha256(normalized)


def build_manifest() -> dict[str, Any]:
    """完整 manifest（确定性：不含时间戳、不含机器路径）。"""
    samples = build_corpus()
    return {
        "schema_version": SCHEMA_VERSION,
        "corpus_version": CORPUS_VERSION,
        "generator": "scripts/quality/generate_resume_samples.py",
        "seed": CORPUS_SEED,
        "counts": {
            "iteration": ITERATION_SAMPLE_COUNT,
            "boundary": TOTAL_SAMPLE_COUNT - ITERATION_SAMPLE_COUNT,
            "total": TOTAL_SAMPLE_COUNT,
        },
        "categories": {
            key: {
                "kind": meta["kind"],
                "title": meta["title"],
                "count": meta["count"],
                "coverage": list(meta["coverage"]),
            }
            for key, meta in CATEGORY_META.items()
        },
        "templates_covered": corpus_template_names(),
        "samples": [
            sample.to_manifest_entry(_content_sha256(sample.content_dict())) for sample in samples
        ],
    }


def manifest_json(manifest: dict[str, Any]) -> str:
    return json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=False) + "\n"


def _expect_text(entry: dict[str, Any]) -> str:
    expect = entry.get("expect") or {}
    parts: list[str] = []
    if "max_pages" in expect:
        parts.append(f"≤{expect['max_pages']} 页")
    if "overflow" in expect:
        parts.append("溢出" if expect["overflow"] else "不溢出")
    if "photo" in expect:
        parts.append("有照片" if expect["photo"] else "无照片")
    if "bold_html" in expect:
        parts.append("HTML 加粗" if expect["bold_html"] else "HTML 不加粗")
    if "literal_markers" in expect:
        parts.append("保留 **" if expect["literal_markers"] else "去除 **")
    if expect.get("missing_glyph_probe"):
        parts.append("缺字探测")
    if expect.get("legacy_raw"):
        parts.append("旧记录")
    return "、".join(parts) or "—"


def manifest_markdown(manifest: dict[str, Any]) -> str:
    """人读版 manifest：一份样例一行，覆盖点与期望都摊开写。"""
    lines = [
        "# ResumeForge W00/W20 合成样例 manifest",
        "",
        f"- 语料版本：{manifest['corpus_version']}",
        f"- 总数：{manifest['counts']['total']}（迭代 {manifest['counts']['iteration']} + 边界 {manifest['counts']['boundary']}）",
        f"- 覆盖模板：{'、'.join(manifest['templates_covered'])}",
        "- 本文件由 generate_resume_samples.py 生成，不含时间戳；重新生成应逐字节相同。",
        "",
        "| id | 类别 | 标题 | 模板 | 字号 | 页数上限 | 覆盖点 | 期望 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for entry in manifest["samples"]:
        coverage = "；".join(entry["coverage"])
        lines.append(
            "| {id} | {category} | {title} | {template} | {font_scale} | {page_limit} | {coverage} | {expect} |".format(
                id=entry["id"],
                category=entry["category"],
                title=entry["title"],
                template=entry["template"],
                font_scale=entry["font_scale"],
                page_limit=entry["page_limit"],
                coverage=coverage,
                expect=_expect_text(entry),
            )
        )
    return "\n".join(lines) + "\n"


def content_text(sample) -> str:  # noqa: ANN001
    return json.dumps(sample.content_dict(), ensure_ascii=False, indent=2) + "\n"


def write_corpus(out_dir: Path) -> dict[str, Any]:
    """写 manifest + 全部 content 文件；返回 manifest（便于调用方打印摘要）。"""
    samples = build_corpus()
    manifest = build_manifest()
    out_dir.mkdir(parents=True, exist_ok=True)
    content_dir = out_dir / "content"
    content_dir.mkdir(exist_ok=True)
    (out_dir / MANIFEST_NAME).write_text(manifest_json(manifest), encoding="utf-8")
    (out_dir / MANIFEST_MD_NAME).write_text(manifest_markdown(manifest), encoding="utf-8")
    for sample in samples:
        (out_dir / sample.content_file).write_text(content_text(sample), encoding="utf-8")
    return manifest


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def compare_with_disk(out_dir: Path) -> list[str]:
    """重新生成的 manifest / content 与磁盘比对；返回差异描述（空 = 完全一致）。"""
    problems: list[str] = []
    manifest_path = out_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        return [f"{out_dir} 下没有 {MANIFEST_NAME}；先跑 write 子命令"]
    expected = manifest_json(build_manifest())
    actual = manifest_path.read_text(encoding="utf-8")
    if actual != expected:
        try:
            expected_obj = json.loads(expected)
            actual_obj = json.loads(actual)
        except json.JSONDecodeError as exc:
            return [f"磁盘 manifest 不是合法 JSON：{exc}"]
        problems.extend(_diff_manifest(actual_obj, expected_obj))
    for sample in build_corpus():
        path = out_dir / sample.content_file
        if not path.is_file():
            problems.append(f"缺少样例文件 {path.name}")
            continue
        if path.read_text(encoding="utf-8") != content_text(sample):
            problems.append(f"{path.name} 与生成器内容不一致")
    return problems


def _diff_manifest(actual: dict[str, Any], expected: dict[str, Any]) -> list[str]:
    """只报最关键的差异（条数/字段），不把 120 条逐字 diff 打印出来。"""
    problems: list[str] = []
    for key in ("corpus_version", "seed", "counts"):
        if actual.get(key) != expected.get(key):
            problems.append(f"manifest.{key} 期望 {expected.get(key)!r} 实际 {actual.get(key)!r}")
    actual_ids = [item.get("id") for item in actual.get("samples") or []]
    expected_ids = [item.get("id") for item in expected.get("samples") or []]
    if actual_ids != expected_ids:
        missing = sorted(set(expected_ids) - set(actual_ids))[:5]
        extra = sorted(set(actual_ids) - set(expected_ids))[:5]
        problems.append(f"manifest 样例清单不一致：缺 {missing} 多 {extra}")
        return problems
    for actual_entry, expected_entry in zip(actual["samples"], expected["samples"], strict=False):
        if actual_entry != expected_entry:
            problems.append(f"样例 {expected_entry.get('id')} 的 manifest 字段与生成器不一致")
            if len(problems) >= 5:
                break
    return problems


def _print_summary(manifest: dict[str, Any]) -> None:
    counts = manifest["counts"]
    print(f"语料版本 {manifest['corpus_version']}：共 {counts['total']} 份")
    print(f"  迭代样例：{counts['iteration']}  边界样例：{counts['boundary']}")
    print(f"  覆盖模板：{'、'.join(manifest['templates_covered'])}")
    for key, meta in manifest["categories"].items():
        print(f"    - {key:<16} {meta['count']:>3} 份  {meta['title']}")


def _cmd_write(args: argparse.Namespace) -> int:
    out_dir = Path(args.out).expanduser().resolve() if args.out else DEFAULT_OUTPUT_DIR
    manifest = write_corpus(out_dir)
    _print_summary(manifest)
    print(f"已写出：{out_dir}")
    print(f"  manifest：{out_dir / MANIFEST_NAME}（人读版 {MANIFEST_MD_NAME}）")
    return 0


def _cmd_check(args: argparse.Namespace) -> int:
    out_dir = Path(args.out).expanduser().resolve() if args.out else DEFAULT_OUTPUT_DIR
    problems = compare_with_disk(out_dir)
    if problems:
        print("样例文件 / manifest 检查失败：")
        for problem in problems:
            print(f"  - {problem}")
        print(f"提示：重跑 write 重新生成（{out_dir}）")
        return 1
    samples = build_corpus()
    report = verify_corpus(samples, limit=args.limit or None, extractor=args.extractor)
    if args.json_out:
        payload = report.summary()
        payload["corpus_version"] = CORPUS_VERSION
        Path(args.json_out).expanduser().resolve().write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"报告：{Path(args.json_out).expanduser().resolve()}")
    print(
        f"渲染并校验 {report.rendered}/{report.total} 份样例（PDF 提取器：{report.pdf_extractors}）"
    )
    for failure in report.failures[: args.max_failures]:
        print("  FAIL " + failure.as_line())
    if len(report.failures) > args.max_failures:
        print(f"  … 其余 {len(report.failures) - args.max_failures} 条见完整输出")
    if report.passed:
        print("RESULT: PASS")
        return 0
    print(f"RESULT: FAIL（{len(report.failures)} 条失败）")
    return 1


def _cmd_list(_args: argparse.Namespace) -> int:
    for sample in build_corpus():
        print(
            f"{sample.sample_id}\t{sample.category}\t{sample.template}\t{sample.font_scale}\t"
            f"{sample.page_limit}\t{sample.title}"
        )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="ResumeForge W00/W20 合成样例库生成器")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name, handler, help_text in (
        ("write", _cmd_write, "写出 120 份样例与 manifest"),
        ("check", _cmd_check, "校验磁盘样例可重复，并渲染核对期望"),
        ("list", _cmd_list, "打印样例清单（不写文件）"),
    ):
        sub = subparsers.add_parser(name, help=help_text)
        sub.set_defaults(handler=handler)
        if name != "list":
            sub.add_argument("--out", default="", help=f"输出目录（默认 {DEFAULT_OUTPUT_DIR}）")
        if name == "check":
            sub.add_argument("--limit", type=int, default=0, help="只渲染前 N 份（0 = 全部）")
            sub.add_argument(
                "--extractor",
                choices=("auto", "pdftotext", "pypdf"),
                default="auto",
                help="PDF 文本提取器；默认 auto（pdftotext 优先）",
            )
            sub.add_argument("--max-failures", type=int, default=30, help="最多打印多少条失败")
            sub.add_argument("--json-out", default="", help="把完整校验报告写成 JSON")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    print(f"仓库根：{REPO_ROOT}")
    return int(args.handler(args))


if __name__ == "__main__":
    sys.exit(main())
