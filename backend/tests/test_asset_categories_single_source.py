# SPDX-License-Identifier: Apache-2.0
"""资产类别单一真相源（T1）：三处引用的必须是**同一个对象**，不是相等的三份副本。

回归动机：``ASSET_CATEGORIES`` 此前有两份定义——``asset_manifest.ASSET_CATEGORIES``
（tuple，收集/清单侧）与 ``paths._ASSET_CATEGORIES``（frozenset，包内前缀校验侧）。
两份名单各自演进时，加一个类别只改一边就会造成"能收集却装不进包"这类只在运行期
才暴露的错配，而且 ``is`` 断言会立刻失败、指向真正的病根。

这里钉住的行为：

- ``paths`` / ``asset_manifest`` / 包 ``app.services.data_backup`` 暴露的是同一个
  tuple 对象（同一性，而非相等）；
- 唯一性：``paths`` 里不再留私有影子副本 ``_ASSET_CATEGORIES``；
- ``dataset_asset_prefix`` 的校验真的走这份共享名单（合法放行、非法抛 BackupError）。
"""

import pytest
from app.services import data_backup as data_backup_package
from app.services.data_backup import (
    BackupError,
    dataset_asset_prefix,
)
from app.services.data_backup import asset_categories as asset_categories_module
from app.services.data_backup import asset_manifest as asset_manifest_module
from app.services.data_backup import paths as paths_module


def test_asset_categories_is_one_shared_object() -> None:
    """三个导入面拿到的是同一个对象——单一真相源的**同一性**断言。"""
    assert paths_module.ASSET_CATEGORIES is asset_manifest_module.ASSET_CATEGORIES
    assert asset_manifest_module.ASSET_CATEGORIES is asset_categories_module.ASSET_CATEGORIES
    assert data_backup_package.ASSET_CATEGORIES is asset_categories_module.ASSET_CATEGORIES


def test_asset_categories_shape_is_a_tuple_of_known_categories() -> None:
    """形状固定为 tuple 且内容就是两个已知类别（改动需同步磁盘目录与清单段名）。"""
    assert isinstance(asset_categories_module.ASSET_CATEGORIES, tuple)
    # 0059（W19）：新增数据集资产目录 export_archive（交付原件归档，进备份）。
    assert asset_categories_module.ASSET_CATEGORIES == (
        "user_files",
        "referral_images",
        "export_archive",
    )
    assert asset_categories_module.__all__ == ["ASSET_CATEGORIES"]


def test_paths_has_no_private_shadow_copy() -> None:
    """私有影子副本已删除：``paths`` 只从叶子模块取，不再自己再存一份。"""
    assert not hasattr(paths_module, "_ASSET_CATEGORIES")


def test_dataset_asset_prefix_accepts_valid_category() -> None:
    """活动数据集仍用包根扁平前缀，随包数据集用命名空间前缀。"""
    assert dataset_asset_prefix(None, "user_files") == "user_files/"
    assert dataset_asset_prefix(None, "referral_images") == "referral_images/"
    assert dataset_asset_prefix("main", "user_files") == "datasets/main/user_files/"


@pytest.mark.parametrize("category", ["", "user_file", "USER_FILES", "../user_files", "other"])
def test_dataset_asset_prefix_rejects_unknown_category(category: str) -> None:
    """非法类别明确抛出 BackupError（fail-closed，不返回可疑前缀）。"""
    with pytest.raises(BackupError):
        dataset_asset_prefix(None, category)


def test_dataset_asset_prefix_rejects_invalid_dataset_id() -> None:
    """数据集标识校验不受本次重构影响（同一道防线仍在）。"""
    with pytest.raises(BackupError):
        dataset_asset_prefix("../escape", "user_files")
