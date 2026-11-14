# SPDX-License-Identifier: Apache-2.0
"""领域词表（D8）：状态取值、取值元组与纯判定函数的唯一定义处。

放在 ``app/models`` 之外，是为了断开"契约层（``app/schemas``）→ 实现层（``app/models``）"
的导入方向：schema 校验只需要一份取值清单，不需要也不该拉进 ORM 实体与数据库层。

约束：

- 本包**只允许标准库 import**，不得 import 任何 ``app.*``（守卫见
  ``tests/test_import_direction.py`` 的 ``vocabulary-stdlib-only`` 规则）；
- 词表同时被 ``app/models/*`` 与 ``app/schemas/*`` 取用：``models`` 侧保留逐个显式
  re-export，既有的 ``from app.models.x import STATUSES`` 导入路径不变；
- 只放词表（常量、元组、纯函数），不放 ORM 实体，也不放服务实现。
"""
