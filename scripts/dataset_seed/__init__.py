# SPDX-License-Identifier: Apache-2.0
"""测试数据集生成器的实现部分（入口是 ``scripts/seed_test_dataset.py``）。

⚠️ 与 ``scripts/demo_data/`` 同一条纪律：本包内**任何模块都不得在导入期碰数据库**
——``app.config`` 导入即缓存 ``database_url``，而入口要先解析 ``--out`` 再设环境变量。
包内 ``__init__`` 因此只放这段说明，不 import 任何子模块。
"""
