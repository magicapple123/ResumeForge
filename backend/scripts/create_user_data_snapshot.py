# SPDX-License-Identifier: Apache-2.0
"""更新前的完整数据快照：用「导出全部数据集」生成整包 zip 并校验。

为什么需要它：scripts/Update-ResumeForge.ps1 的 Backup-UserData 过去只拷贝 *.db 与
几个 json 指针。数据库之外还有按引用收集的附件（user_files/、referral_images/、
export_archive/）、跨数据集共用的自定义字体与全局模型配置；只拷库会在"新版本把数据
迁坏"时丢掉这些文件。本脚本复用与「设置 → 数据集 → 导出全部数据集」完全相同的导出
链路（datasets_admin.export_all_datasets），再用 legacy_archive.verify_archive 校验
产物的可读性——更新器拿不到一份证明能恢复的快照，就不该继续覆盖程序文件。

输出协议（更新器按行解析，不要改）：

* 成功：stdout 打印 SNAPSHOT=<zip 绝对路径>，退出码 0；
* 失败：stdout 打印 SNAPSHOT_ERROR=<原因>，退出码 2。

用法（在任意目录执行都可以；解释器用项目的 backend venv）：

    python backend/scripts/create_user_data_snapshot.py --destination backend/data/pre-update/20260101-000000
    python backend/scripts/create_user_data_snapshot.py --destination ... --include-api-keys
"""

from __future__ import annotations

import argparse
import secrets
import shutil
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _one_line(message: object) -> str:
    """把异常消息压成一行：SNAPSHOT_ERROR= 行必须能被更新器逐行解析。"""
    text = " ".join(str(message).split())
    return text or "未知错误"


def _create_snapshot(destination: Path, *, include_api_keys: bool) -> Path:
    """生成并校验整包快照，返回移动到 destination 下的 zip 绝对路径。"""
    from app.database import engine
    from app.services.data_backup.legacy_archive import verify_archive
    from app.services.datasets_admin import export_all_datasets

    # 暂存目录放在 destination 里而不是系统临时目录：跨盘移动不是原子的，
    # 而同目录 rename 不会在"快照已经生成但还没落到 pre-update"时留下半个包。
    staging = destination / (".snapshot-" + secrets.token_hex(4))
    staging.mkdir(parents=True)
    try:
        archive = export_all_datasets(
            engine,
            staging,
            include_api_keys=include_api_keys,
            include_global_llm=True,
        )
        # 校验不过等于没有快照：更新器会给"没有快照"的更新亮红灯。
        verify_archive(archive)
        target = destination / archive.name
        shutil.move(str(archive), str(target))
        return target
    finally:
        # Windows 上连接池不释放时临时目录删不掉（文件被占用）。
        engine.dispose()
        shutil.rmtree(staging, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成更新前的完整数据快照。")
    parser.add_argument("--destination", required=True, type=Path, help="快照目录（不存在时创建）")
    parser.add_argument(
        "--include-api-keys",
        action="store_true",
        help="把 API Key 一起带进包（默认剥离；与导出界面的勾选项同义）",
    )
    args = parser.parse_args(argv)
    # 中文错误原因在非 UTF-8 控制台也不要因为编码再抛一次。
    sys.stdout.reconfigure(errors="replace")
    destination = args.destination.expanduser().resolve()
    try:
        destination.mkdir(parents=True, exist_ok=True)
        archive = _create_snapshot(destination, include_api_keys=args.include_api_keys)
    except Exception as exc:  # noqa: BLE001 - 任何失败都必须转成协议行 + 退出码 2
        print("SNAPSHOT_ERROR=" + _one_line(exc))
        return 2
    print("SNAPSHOT=" + str(archive))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
