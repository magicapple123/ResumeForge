# SPDX-License-Identifier: Apache-2.0
"""招聘站点采集的解析辅助（本 PR 只含 BOSS 薪资字体解密）。

``sites.boss_font`` 只依赖标准库与 fontTools（读字体字形轮廓），不引用本仓库的
models / schemas / 其他 service，可以单独取用。
"""
