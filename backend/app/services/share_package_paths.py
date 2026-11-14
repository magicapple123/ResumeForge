# SPDX-License-Identifier: Apache-2.0
"""从 ``share_package`` 拆出：分享包目录的定位规则（按数据集隔离）。

分享包落在数据目录下（与 captures 同级），天然不进仓库、不进备份；文件型 SQLite 时
进一步落到数据库同目录，测试库（临时目录）自动隔离。非主数据额外带一层库文件名，
避免多个数据集的自增 id 撞进同一个目录（见 ``share_root`` 的说明）。
"""

from __future__ import annotations

from pathlib import Path

from ..config import DATA_DIR
from ..dataset_registry import configured_database_file

# 分享包落在数据目录下（与 captures 同级），天然不进仓库、不进备份。文件型 SQLite
# 时进一步落到数据库同目录：测试库（临时目录）自动隔离，不会写进仓库的 backend/data。
SHARE_PACKAGES_DIR = DATA_DIR / "share_packages"


def _is_main_database(path: Path) -> bool:
    """这个文件是不是 ``DATABASE_URL`` 指向的主数据。

    判不出来时按"是"处理：那只会退回旧的路径规则，不会凭空改掉既有分享包的位置。
    """
    try:
        return path == configured_database_file()
    except Exception:  # noqa: BLE001 - 拿不到配置时保持既有行为
        return True


def share_root(bind) -> Path:
    """分享包根目录：文件型 SQLite 落在数据库同目录，其余回退到数据目录。

    **非主数据额外带一层库文件名。** 多个数据集共用 ``data/datasets/`` 这一个目录，而分享包
    的 id 是每个库各自自增的——一律用 ``<库目录>/share_packages/<id>`` 的话，数据集 A 的第 1 份
    与数据集 B 的第 1 份会落到同一个目录里，后建的那份把先建的**覆盖掉**（同一个坑在导出
    备份那边也踩过一次：多份数据集共用一个文件系统命名空间）。

    主数据保持原路径不变：它下面可能已经有用户的分享包，平白迁走等于让那些文件消失。
    路径改变对非主数据是安全的——文件缺了会按库里的快照重新生成（见 ``ensure_package_files``）。
    """
    url = getattr(bind, "url", None)
    database = getattr(url, "database", None)
    if database and database != ":memory:" and Path(database).is_absolute():
        resolved = Path(database).resolve()
        root = resolved.parent / "share_packages"
        return root if _is_main_database(resolved) else root / resolved.stem
    return SHARE_PACKAGES_DIR


def package_directory(bind, share_id: int) -> Path:
    """某个分享包的本地目录：``<share_root>/<id>``（见 ``share_root`` 的数据集隔离规则）。"""
    return share_root(bind) / str(share_id)
