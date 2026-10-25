# SPDX-License-Identifier: Apache-2.0
"""职业场景服务层（A1）。

- `catalog`：内置快捷场景目录的加载/校验/缓存（失败不阻断旧生成）。
- `store`：当前数据集已保存场景的 CRUD、限额、条件更新与归档。
- `resolve`：把本次生成请求解析成冻结的上下文快照（server-owned、只读 DB）。
"""
