# SPDX-License-Identifier: Apache-2.0
"""文档生命周期守卫：把「文档会不会烂」变成一条会红的检查。

为什么需要它：2026-11-17 的一次全量文档审查里，最贵的时间不是改字，而是**判断哪一句还成立**——
现役文档里混着 1.0.2 的口径、旧计划没有标记、同一件事在三处各写一遍。这些都不是写作问题，
是**缺生命周期**：没人知道一份文档上次被核实是什么时候、按什么节奏复核、过期了该归谁、
什么时候可以删。

所以这里不写规范，写三件可执行的东西：

1. **登记表** ``docs/doc-registry.json`` 是唯一真源：每篇文档的状态、复核节奏、覆盖的代码路径。
   索引页 ``docs/README.md`` 由它生成，不手写——生成物不会漂移，只会「忘了重新生成」，而 CI 会发现。
2. **时效闸门**：``current`` 超过复核窗口即报错；``historical`` 过了处置截止日也报错——不逼着人做
   决定，历史文档就会一直躺在那里假装是现状。
3. **漂移提醒**：``--drift <ref>`` 比对「改了代码但没改覆盖它的文档」，把差异打在 PR 上。这一条
   只提醒、不阻断：阻断式文档检查会在第一个 deadline 被关掉（见 ``docs/maintenance.md`` 的判据）。

判定口径见 ``docs/maintenance.md``「文档生命周期」；每条规则的反证见
``backend/tests/test_docs_registry.py``。

用法::

    python scripts/check_docs_registry.py                  # 全量校验
    python scripts/check_docs_registry.py --write-index     # 重新生成 docs/README.md
    python scripts/check_docs_registry.py --check-index     # 索引是否最新（CI 用）
    python scripts/check_docs_registry.py --drift origin/main
    python scripts/check_docs_registry.py --review docs/user-guide.md   # 登记「今天已复核」

退出码：0 干净；1 有违规；2 配置或用法错误。
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = Path("docs/doc-registry.json")
INDEX = Path("docs/README.md")
ARCHIVE_DIR = "docs-archive"
SCHEMA_VERSION = 1
STATUSES = {"current", "historical", "record"}
BANNER = re.compile(r"^>\s*\*\*(历史|归档)")
BANNER_WINDOW = 15
INDEX_SENTINEL = "<!-- 本文件由 scripts/check_docs_registry.py --write-index 生成"


@dataclass(frozen=True)
class Problem:
    where: str
    message: str

    def __str__(self) -> str:
        return f"{self.where}: {self.message}"


class ConfigError(Exception):
    """登记表本身读不了（JSON 坏、结构不对）。"""


# ---------------------------------------------------------------- 读取


def load_registry(root: Path = ROOT) -> dict:
    path = root / REGISTRY
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ConfigError(f"找不到 {REGISTRY}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigError(f"{REGISTRY} 不是合法 JSON：{exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError(f"{REGISTRY} 顶层必须是对象")
    if data.get("schema_version") != SCHEMA_VERSION:
        raise ConfigError(
            f"schema_version 必须是 {SCHEMA_VERSION}，实际 {data.get('schema_version')!r}"
        )
    if not isinstance(data.get("docs"), list):
        raise ConfigError("docs 必须是数组")
    return data


def _read_lines(root: Path, rel: str) -> list[str]:
    path = root / rel
    if not path.is_file():
        return []
    return path.read_text(encoding="utf-8", errors="replace").splitlines()


def _parse_date(value: object, where: str, problems: list[Problem]) -> dt.date | None:
    if not isinstance(value, str):
        problems.append(Problem(where, "日期必须是 YYYY-MM-DD 字符串"))
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        problems.append(Problem(where, f"日期格式不合法：{value!r}"))
        return None


# ---------------------------------------------------------------- 校验


def validate(root: Path, data: dict, today: dt.date) -> list[Problem]:
    problems: list[Problem] = []
    tier_days = data.get("tier_days")
    if not isinstance(tier_days, dict) or not tier_days:
        raise ConfigError('tier_days 必须是非空对象，例如 {"A": 90, "B": 180}')

    seen: set[str] = set()
    for entry in data["docs"]:
        if not isinstance(entry, dict):
            problems.append(Problem("docs[]", "每一项必须是对象"))
            continue
        problems.extend(_check_entry(root, entry, tier_days, today, seen))

    # 双向覆盖：磁盘上的每篇都登记了，登记表里的每篇都存在。
    on_disk = {p.relative_to(root).as_posix() for p in (root / "docs").rglob("*.md")}
    for path in sorted(on_disk - seen):
        problems.append(Problem(path, "没有登记（新增文档必须在 docs/doc-registry.json 里加一行）"))
    for path in sorted(seen - on_disk):
        problems.append(Problem(path, "登记了但文件不存在（改名或删除后忘了同步登记表）"))

    # 归档台账：只允许指向 docs-archive/ 下真实存在的文件。
    archived = data.get("archived", [])
    if not isinstance(archived, list):
        problems.append(Problem("archived", "必须是数组"))
        archived = []
    for item in archived:
        if not isinstance(item, dict) or not item.get("path"):
            problems.append(Problem("archived[]", "每项必须有 path"))
            continue
        rel = str(item["path"])
        if not rel.startswith(f"{ARCHIVE_DIR}/"):
            problems.append(
                Problem(rel, f"归档文档必须放在 {ARCHIVE_DIR}/ 下（该目录不进检索索引）")
            )
        if not (root / rel).is_file():
            problems.append(Problem(rel, "归档台账里有、磁盘上找不到"))
        if not item.get("reason"):
            problems.append(Problem(rel, "必须写归档原因（半年后没人记得为什么留着它）"))
        if (root / rel).is_file() and rel in seen:
            problems.append(Problem(rel, "已归档的文档不应再登记为现役/历史文档"))

    return problems


def _check_entry(
    root: Path,
    entry: dict,
    tier_days: dict,
    today: dt.date,
    seen: set[str],
) -> list[Problem]:
    problems: list[Problem] = []
    path = entry.get("path")
    if not isinstance(path, str) or not path.startswith("docs/") or not path.endswith(".md"):
        return [Problem(str(path), "path 必须是 docs/ 下的 .md 相对路径")]
    where = path
    if path in seen:
        problems.append(Problem(where, "重复登记"))
    seen.add(path)

    status = entry.get("status")
    if status not in STATUSES:
        problems.append(Problem(where, f"status 必须是 {sorted(STATUSES)} 之一"))
    if not entry.get("title"):
        problems.append(Problem(where, "缺 title（索引页要用）"))
    if not entry.get("note"):
        problems.append(Problem(where, "缺 note：一句话说明这篇为什么还在、什么时候该回看"))

    if status == "current":
        problems.extend(_check_current(root, entry, tier_days, today, where))
    elif status == "historical":
        retire = _parse_date(entry.get("retire_by"), where, problems)
        if retire and today > retire:
            problems.append(
                Problem(
                    where,
                    f"处置截止日 {retire} 已过：更新内容后改成 current，或移到 {ARCHIVE_DIR}/ 并记进 archived",
                )
            )
        problems.extend(_check_banner(root, path, where, must_have=True))
    elif status == "record" and "last_reviewed" in entry:
        _parse_date(entry["last_reviewed"], where, problems)

    problems.extend(_check_pairs(root, entry, where))
    problems.extend(_check_verify(root, entry, where))
    superseded = entry.get("superseded_by")
    if superseded and str(superseded) not in seen and not (root / str(superseded)).is_file():
        problems.append(Problem(where, f"superseded_by 指向的 {superseded} 不存在"))

    return problems


def _check_current(
    root: Path, entry: dict, tier_days: dict, today: dt.date, where: str
) -> list[Problem]:
    problems: list[Problem] = []
    tier = entry.get("tier")
    if tier not in tier_days:
        problems.append(Problem(where, f"current 文档必须有 tier（{sorted(tier_days)}）"))
        return problems
    reviewed = _parse_date(entry.get("last_reviewed"), where, problems)
    if reviewed is None:
        return problems
    if reviewed > today:
        problems.append(Problem(where, f"last_reviewed {reviewed} 在未来"))
        return problems
    window = int(tier_days[tier])
    expiry = reviewed + dt.timedelta(days=window)
    if today > expiry:
        problems.append(
            Problem(
                where,
                f"已超过复核窗口（上次 {reviewed}，{tier} 档 {window} 天，截止 {expiry}，"
                f"逾期 {(today - expiry).days} 天）：核实内容后跑 `--review {where}`",
            )
        )
    problems.extend(_check_banner(root, where, where, must_have=False))
    return problems


def _check_banner(root: Path, rel: str, where: str, *, must_have: bool) -> list[Problem]:
    lines = _read_lines(root, rel)
    if not lines:
        return []
    found = any(BANNER.match(line) for line in lines[:BANNER_WINDOW])
    if must_have and not found:
        return [
            Problem(where, f"historical 文档开头（前 {BANNER_WINDOW} 行）必须有 `> **历史…**` 横幅")
        ]
    if not must_have and found:
        return [Problem(where, "现役文档开头却有历史横幅：状态标错了，要么改 status，要么删横幅")]
    return []


def _check_pairs(root: Path, entry: dict, where: str) -> list[Problem]:
    problems: list[Problem] = []
    pairs = entry.get("pairs", [])
    if not isinstance(pairs, list):
        return [Problem(where, "pairs 必须是数组")]
    for pair in pairs:
        if not isinstance(pair, str) or not pair:
            problems.append(Problem(where, "pairs 的每一项必须是相对路径字符串"))
            continue
        if pair.startswith("/") or ":" in pair:
            problems.append(Problem(where, f"pairs 必须是仓库相对路径：{pair}"))
            continue
        if not (root / pair).exists():
            problems.append(Problem(where, f"pairs 指向的路径不存在：{pair}"))
    return problems


def _check_verify(root: Path, entry: dict, where: str) -> list[Problem]:
    problems: list[Problem] = []
    verify = entry.get("verify", [])
    if not isinstance(verify, list):
        return [Problem(where, "verify 必须是数组")]
    for command in verify:
        if not isinstance(command, str) or not command:
            problems.append(Problem(where, "verify 的每一项必须是非空字符串"))
            continue
        target = command.split()[0]
        if target.startswith(("scripts/", "backend/")) and not (root / target).exists():
            problems.append(Problem(where, f"verify 指向的脚本不存在：{target}"))
    return problems


# ---------------------------------------------------------------- 索引


def _cell(text: str) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ").strip()


def _link(rel: str) -> str:
    if rel.startswith(f"{ARCHIVE_DIR}/"):
        return f"../{rel}"
    return rel[len("docs/") :]


def render_index(data: dict, today: dt.date | None = None) -> str:
    """渲染索引页。``today`` 刻意不参与输出：带日期的生成物会每天变，索引比对就永远红。"""
    tier_days = {str(k): int(v) for k, v in data["tier_days"].items()}
    docs = data["docs"]
    current = [d for d in docs if d.get("status") == "current"]
    historical = [d for d in docs if d.get("status") == "historical"]
    records = [d for d in docs if d.get("status") == "record"]
    archived = data.get("archived", [])

    lines = [
        INDEX_SENTINEL + "；改口径请改 docs/doc-registry.json。 -->",
        "",
        "# 文档索引",
        "",
        "> 读之前先看状态，三类文档的可信度不同：",
        "> **现役**（`current`）必须与当前代码一致，超期未复核会打红 CI；",
        "> **过程记录**（`historical`）不保证与现状一致，到期会被处置；",
        "> **不可变记录**（`record`）是 ADR 与实测档案，只增不改。登记表在 [`doc-registry.json`](doc-registry.json)。",
        "",
        f"## 现役文档（必须与代码一致）· {len(current)} 篇",
        "",
        "复核截止 = 上次复核 + 该档窗口（"
        + " / ".join(f"{k} {v} 天" for k, v in sorted(tier_days.items()))
        + "）。",
        "",
        "| 文档 | 用途 | 上次复核 | 复核截止 |",
        "| --- | --- | --- | --- |",
    ]
    for doc in sorted(current, key=lambda d: d["path"]):
        reviewed = doc.get("last_reviewed")
        expiry = ""
        if reviewed and doc.get("tier") in tier_days:
            expiry = (
                dt.date.fromisoformat(reviewed) + dt.timedelta(days=tier_days[doc["tier"]])
            ).isoformat()
        lines.append(
            f"| [{_cell(doc['title'])}]({_link(doc['path'])}) | {_cell(doc.get('note', ''))} "
            f"| {reviewed or ''} | {expiry} |"
        )

    lines += [
        "",
        f"## 历史文档（过程记录，不保证与现状一致）· {len(historical)} 篇",
        "",
        "到期未处置会打红 CI：要么更新内容并改成 `current`，要么移进 `docs-archive/`。",
        "",
        "| 文档 | 为什么还在 | 处置截止 |",
        "| --- | --- | --- |",
    ]
    for doc in sorted(historical, key=lambda d: d["path"]):
        lines.append(
            f"| [{_cell(doc['title'])}]({_link(doc['path'])}) | {_cell(doc.get('note', ''))} "
            f"| {doc.get('retire_by', '')} |"
        )

    lines += [
        "",
        f"## 不可变记录（ADR / 实测档案）· {len(records)} 篇",
        "",
        "只增不改：被推翻的决策在原处留「后续修订」，不重写历史；实测档案重测时新增一节，不改旧数字。",
        "",
        "| 文档 | 性质 |",
        "| --- | --- |",
    ]
    for doc in sorted(records, key=lambda d: d["path"]):
        lines.append(
            f"| [{_cell(doc['title'])}]({_link(doc['path'])}) | {_cell(doc.get('note', ''))} |"
        )

    lines += [
        "",
        f"## 已归档（`{ARCHIVE_DIR}/`，不进检索索引）· {len(archived)} 篇",
        "",
    ]
    if archived:
        lines += ["| 文档 | 归档日 | 原因 | 替代 |", "| --- | --- | --- | --- |"]
        for item in archived:
            lines.append(
                f"| [{_cell(item.get('title') or item['path'])}]({_link(item['path'])}) "
                f"| {item.get('archived_on', '')} | {_cell(item.get('reason', ''))} "
                f"| {_cell(item.get('replaced_by', '—'))} |"
            )
    else:
        lines.append("（暂无）")

    lines += [
        "",
        "## 怎么维护这一页",
        "",
        "1. **新增文档**：写完 → 在 `docs/doc-registry.json` 加一行（status / tier / note）→ `--write-index`。",
        "2. **复核**：读完确认仍成立 → `python scripts/check_docs_registry.py --review <path>` → `--write-index`。",
        f"3. **归档**：文件移到 `{ARCHIVE_DIR}/`、开头加 `> **历史…**` 横幅 → 登记表里从 `docs` 挪到 `archived` → `--write-index`。",
        "4. **全量校验**：`python scripts/check_docs_registry.py --check-index`（CI 跑的就是这条）。",
        "",
        "这条流程的判据与理由见 `maintenance.md` 的「文档生命周期」一节。",
        "",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------- 漂移


def _git(root: Path, *args: str) -> str | None:
    try:
        proc = subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except (OSError, ValueError):
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout


def changed_files(root: Path, ref: str | None) -> list[str]:
    out: set[str] = set()
    diff_target = f"{ref}" if ref else "HEAD"
    diff = _git(root, "diff", "--name-only", diff_target, "--", ".")
    if diff is None and ref:
        diff = _git(root, "diff", "--name-only", f"{ref}...HEAD", "--", ".")
    if diff:
        out.update(line.strip() for line in diff.splitlines() if line.strip())
    status = _git(root, "status", "--porcelain")
    if status:
        for line in status.splitlines():
            if line.startswith("?? ") or len(line) > 3:
                out.add(line[3:].strip())
    return sorted(out)


def drift(data: dict, root: Path, ref: str | None) -> list[str]:
    changed = changed_files(root, ref)
    changed_set = set(changed)
    messages: list[str] = []
    for entry in data["docs"]:
        if entry.get("status") != "current":
            continue
        path = entry["path"]
        if path in changed_set:
            continue
        hit = sorted(
            {
                p
                for p in changed
                if any(p == pair or p.startswith(pair) for pair in entry.get("pairs", []))
            }
        )
        if hit:
            preview = "、".join(hit[:3]) + ("…" if len(hit) > 3 else "")
            messages.append(f"[DRIFT] {path} ← {preview}")
    return messages


# ---------------------------------------------------------------- CLI


def _write_index(root: Path, data: dict, today: dt.date) -> int:
    text = render_index(data, today)
    path = root / INDEX
    path.write_text(text, encoding="utf-8")
    print(
        f"已生成 {INDEX}（现役 {sum(1 for d in data['docs'] if d.get('status') == 'current')} 篇）"
    )
    return 0


def _check_index(root: Path, data: dict, today: dt.date) -> list[Problem]:
    path = root / INDEX
    if not path.is_file():
        return [Problem(str(INDEX), "索引不存在：跑 --write-index 生成")]
    actual = path.read_text(encoding="utf-8")
    if actual != render_index(data, today):
        return [
            Problem(
                str(INDEX), "索引不是最新：跑 `python scripts/check_docs_registry.py --write-index`"
            )
        ]
    return []


def _review(root: Path, data: dict, targets: list[str], today: dt.date) -> int:
    known = {entry["path"] for entry in data["docs"]}
    unknown = [t for t in targets if t not in known]
    if unknown:
        print(f"未登记，先加进 docs/doc-registry.json：{unknown}", file=sys.stderr)
        return 2
    for entry in data["docs"]:
        if entry["path"] in targets:
            if entry.get("status") != "current":
                print(
                    f"跳过 {entry['path']}（status={entry.get('status')}，只有 current 有复核日期）"
                )
                continue
            entry["last_reviewed"] = today.isoformat()
            print(f"已登记复核：{entry['path']} → {today}")
    path = root / REGISTRY
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="文档生命周期守卫（登记表 / 时效 / 索引 / 漂移）")
    parser.add_argument("--root", default=str(ROOT), help="仓库根目录（默认取脚本上一级）")
    parser.add_argument("--today", help="把「今天」固定成某个日期（YYYY-MM-DD，测试与演练用）")
    parser.add_argument("--write-index", action="store_true", help="重新生成 docs/README.md")
    parser.add_argument("--check-index", action="store_true", help="同时校验索引是否最新")
    parser.add_argument(
        "--drift", nargs="?", const="", metavar="REF", help="比对代码改动与文档覆盖（默认工作树）"
    )
    parser.add_argument("--strict", action="store_true", help="漂移也当失败（默认只提醒）")
    parser.add_argument(
        "--review", nargs="+", metavar="PATH", help="把这些文档的 last_reviewed 记为今天"
    )
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()

    try:
        data = load_registry(root)
    except ConfigError as exc:
        print(f"配置错误：{exc}", file=sys.stderr)
        return 2

    if args.review:
        return _review(root, data, list(args.review), today)
    if args.write_index:
        return _write_index(root, data, today)

    problems = validate(root, data, today)
    if args.check_index:
        problems += _check_index(root, data, today)

    drift_hits: list[str] = []
    if args.drift is not None:
        drift_hits = drift(data, root, args.drift or None)

    for problem in problems:
        print(f"[FAIL] {problem}")
    for line in drift_hits:
        print(line)

    if problems:
        print(
            f"\n{len(problems)} 处违规。口径见 docs/maintenance.md「文档生命周期」。",
            file=sys.stderr,
        )
        return 1
    if drift_hits:
        tail = "（--strict 下会失败）" if not args.strict else ""
        print(f"\n{len(drift_hits)} 处漂移提醒{tail}：改了覆盖的代码，请确认文档是否仍成立。")
        return 1 if args.strict else 0

    current = sum(1 for d in data["docs"] if d.get("status") == "current")
    print(f"OK：{len(data['docs'])} 篇已登记（现役 {current} 篇），无过期、无孤儿、索引最新。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
