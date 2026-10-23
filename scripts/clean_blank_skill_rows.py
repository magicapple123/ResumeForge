# SPDX-License-Identifier: Apache-2.0
"""清理 ``skill`` 表里"名字去空白后为空"的行（存量脏数据）。

## 为什么会有这种行

``SkillIn.name`` 曾经允许空串（``Field(default="", max_length=64)``），于是界面上一行
没填名字的技能被提交后就会落库成一条**永远显示不出来**的空标签——用户看到两个空白标签，
既不知道那是什么，也点不掉。写入侧现在已在 ``profile_service._writable_section_items()``
加守卫（空白名字整行跳过，见那里的注释），本脚本只负责清理**已经写进去的**那些行。

## 为什么删它是安全的

一行的内容只有 ``name`` / ``level``：``name`` 为空时 ``level`` 是一段孤立的"熟练/精通"，
没有任何别的字段能把它还原成有意义的信息。也就是说"删"与"留"的信息量相同，而留下的代价
是界面上多两个说不清的空标签。脚本**只删这一类行**，其它行一个字都不动。

脚本是**幂等**的：第二次跑会报告"删了 0 行"。默认只报告（``--dry-run`` 是默认行为），
要真删必须显式加 ``--apply``。

## 用法（在仓库根目录执行）

```bash
python scripts/clean_blank_skill_rows.py                 # 当前活动数据集，只报告
python scripts/clean_blank_skill_rows.py --apply         # 当前活动数据集，真删
python scripts/clean_blank_skill_rows.py --dataset 38d2d633da114ac0 --apply
python scripts/clean_blank_skill_rows.py --db backend/data/resume_forge.db --apply
```

**动手前先备份**：把目标 ``.db`` 复制一份，或用应用内「数据备份」导出一份。本脚本不做备份，
也不会自动寻找备份——删数据这件事必须由使用者显式发起。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "backend" / "data"
ACTIVE_FILE = DATA_DIR / "active.json"
LEGACY_DB = DATA_DIR / "resume_forge.db"

# 空判定与写入侧守卫同一口径：去空白后为空即视为空。SQLite 的 `trim()` 只去 ASCII
# 空格，所以先把全角空格（U+3000）替换掉再 trim——`" 　 "` 这种也要算空。
_BLANK_WHERE = "trim(replace(coalesce(name, ''), char(12288), '')) = ''"


def resolve_db_path(db: str | None, dataset: str | None) -> Path:
    """按 ``--db`` > ``--dataset`` > 当前活动数据集 > 单库形态 的顺序定位数据库。"""
    if db:
        return Path(db).expanduser().resolve()
    if dataset:
        return (DATA_DIR / "datasets" / f"{dataset}.db").resolve()
    if ACTIVE_FILE.is_file():
        payload = json.loads(ACTIVE_FILE.read_text(encoding="utf-8"))
        active = str(payload.get("dataset_id") or "").strip()
        if active:
            candidate = DATA_DIR / "datasets" / f"{active}.db"
            if candidate.is_file():
                return candidate.resolve()
    return LEGACY_DB.resolve()


def _connect(path: Path, *, writable: bool) -> sqlite3.Connection:
    if not path.is_file():
        raise SystemExit(f"找不到数据库：{path}")
    mode = "rw" if writable else "ro"
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode={mode}", uri=True)
    connection.row_factory = sqlite3.Row
    tables = {
        row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    if "skill" not in tables:
        connection.close()
        raise SystemExit(f"{path} 里没有 skill 表——不像 ResumeForge 数据集，已停止")
    return connection


def find_blank_rows(connection: sqlite3.Connection) -> list[sqlite3.Row]:
    """列出所有名字为空白的技能行（只读，给"删什么"一个可核对的清单）。"""
    return list(
        connection.execute(
            f"SELECT id, profile_id, level FROM skill WHERE {_BLANK_WHERE} ORDER BY id"
        )
    )


def delete_blank_rows(connection: sqlite3.Connection) -> int:
    """删掉名字为空白的技能行，返回删除条数。"""
    cursor = connection.execute(f"DELETE FROM skill WHERE {_BLANK_WHERE}")
    connection.commit()
    return cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="清理 skill 表里名字为空白的行（幂等；默认只报告）",
    )
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--db", help="直接指定 .db 路径（写相对路径时按当前目录解析）")
    target.add_argument("--dataset", help="数据集 id（对应 backend/data/datasets/<id>.db）")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="真的删除；不加这个参数只打印将被删除的行",
    )
    args = parser.parse_args(argv)

    path = resolve_db_path(args.db, args.dataset)
    connection = _connect(path, writable=args.apply)
    try:
        rows = find_blank_rows(connection)
        print(f"[clean_blank_skill_rows] 目标库：{path}")
        if not rows:
            print("没有名字为空白的技能行（已清理过，或从未出现过）——什么都没做。")
            return 0
        for row in rows:
            print(f"  id={row['id']} profile_id={row['profile_id']} level={row['level']!r}")
        if not args.apply:
            print(f"待删除 {len(rows)} 行。确认无误后加 --apply 执行（建议先备份该 .db）。")
            return 0
        deleted = delete_blank_rows(connection)
        print(f"已删除 {deleted} 行。再次运行应报告 0 行。")
        return 0
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
