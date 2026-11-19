# SPDX-License-Identifier: Apache-2.0
"""招聘站点采集的可复用组件（本 PR 只含与具体采集链路无耦合的三块）。

- ``scoring``        ：LLM 语义评分（五维权重 + 证据四态 + 封顶规则）；
- ``search_filters`` ：站点筛选参数编码与本地区间精筛；
- ``sites.boss_font``：BOSS 直聘列表页薪资的 PUA 字符解密。

三者都只依赖标准库（``sites.boss_font`` 另需 fontTools，用于读取字体字形轮廓），
不引用本仓库的 models / schemas / 其他 service，因此可以独立取用。
"""
