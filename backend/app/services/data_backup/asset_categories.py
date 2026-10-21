# SPDX-License-Identifier: Apache-2.0
"""备份资产类别的**唯一**定义处。

资产类别（``user_files``、``referral_images``）既是磁盘上的目录名（相对数据库所在
目录），也是备份清单的段名与包内成员前缀，三处必须完全一致。此前同一份名单存在两
份：``asset_manifest`` 里的 tuple（清单/收集侧用）与 ``paths`` 里的私有 frozenset
副本（``dataset_asset_prefix`` 前缀校验用）。两份各自演进的风险是真实的——多一个
类别只加在一边，会让"能收集却不允许装包"这种只在运行期才炸的错配成为可能。

之所以单独拆成**叶子模块**（不 import 包内任何其他模块），是因为 ``paths.py`` 不
能 import ``asset_manifest.py``：``asset_manifest`` 依赖 ``asset_safety``，而
``asset_safety`` 依赖 ``paths``，于是
``paths → asset_manifest → asset_safety → paths`` 会形成循环导入，包在导入期就崩。
把常量放进一个零依赖的叶子模块，两边都向下依赖它，循环自然消失，而"单一真相源"
也真正成立。

新增/删除类别时只改这里一处即可（磁盘目录、清单段名、包内前缀都跟着走）。
"""

from __future__ import annotations

# 资产类别：目录名同时是磁盘目录名（相对数据库所在目录）与清单/包内前缀。
ASSET_CATEGORIES: tuple[str, ...] = ("user_files", "referral_images")

__all__ = ["ASSET_CATEGORIES"]
