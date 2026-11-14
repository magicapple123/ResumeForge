# SPDX-License-Identifier: Apache-2.0
"""从 ``boss_filters_catalog`` 拆出：筛选目录的数据模型、实测能力表与站点键表。

纯数据与类型定义（无 I/O、无日志）：``FilterOption`` / ``FilterGroup`` / ``GroupSpec``、
``GROUP_SPECS``（2026-11-09 用投递专用浏览器逐组实测的能力表）以及两份站点键表。
``boss_filters_catalog`` 里 re-export，原有导入路径不变。
"""

from __future__ import annotations

from dataclasses import dataclass

from .base import SOURCE_UNAVAILABLE


@dataclass(frozen=True)
class FilterOption:
    """一个可选项。``group`` 只用于界面分组（行业有 15 个一级分组），其余为空。"""

    code: str
    label: str
    group: str = ""


@dataclass(frozen=True)
class FilterGroup:
    """界面上的一个下拉框：站点筛选栏里的一格。"""

    key: str
    param: str
    label: str
    options: tuple[FilterOption, ...] = ()
    source: str = SOURCE_UNAVAILABLE
    note: str = ""
    # 该分组在站点筛选栏里的标题可能不止一种写法（站点改过文案时按任意一种都能认出来）。
    aliases: tuple[str, ...] = ()
    # 站点侧是否支持多选（2026-11-09 专用浏览器逐组实测，见 GROUP_SPECS 的注释）。
    # **由后端随清单下发、前端不写死**：站点能力变了只改这一处。
    multi: bool = True
    # 联动规则：控制组的当前编码必须落在白名单里这一组才可见（空 = 无联动）。
    # 元组的第二项是"允许的编码集合"，包含空串表示"没选控制组时也可见"。
    visible_when: tuple[str, tuple[str, ...]] | None = None

    def option(self, code: str) -> FilterOption | None:
        for item in self.options:
            if item.code == code:
                return item
        return None

    def titles(self) -> tuple[str, ...]:
        return (self.label, *self.aliases)


# 分组定义：``key`` 是内部标识，``param`` 是**实测得到的查询参数名**，``titles`` 是筛选栏标题。
#
# 每条 param 的实测记录（2026-09-20，登录会话，点一下读一次地址栏）：
#   求职类型 → jobType=1901（返回 15/15 条 jobType=0）
#   薪资待遇 → salary=402
#   工作经验 → experience=108
#   学历要求 → degree=209
#   公司规模 → scale=301
#   融资阶段 → stage=801
#   公司行业 → industry=100028（点「人工智能」，另点「电子/半导体/集成电路」得 101407）
@dataclass(frozen=True)
class GroupSpec:
    key: str
    param: str
    label: str
    titles: tuple[str, ...]
    # 页面筛选栏里的编码能不能当真实编码用。
    #
    # **只有行业是 False，而且必须是 False**：短清单的 ka 后缀就是真实编码
    # （实测 sel-job-rec-degree-203 → degree=203），行业的 ka 后缀却是**渲染序号**
    # （sel-industry-23 对应的真实编码是 101407，点一下读地址栏才知道）。照抄序号会
    # 发一个"合法但不相干"的编码出去，站点照样返回结果——那是最坏的一种错：用户以为筛了。
    dom_codes: bool = True
    # 站点是否接受多个值（2026-11-09 实测：见 GROUP_SPECS 注释）。单选组多给时只保留第一个。
    multi: bool = True
    # 联动：控制组当前编码在白名单里才可见。第二项含空串 = "控制组未选时也可见"。
    visible_when: tuple[str, tuple[str, ...]] | None = None


GROUP_SPECS: tuple[GroupSpec, ...] = (
    # 2026-11-09 用投递专用浏览器（CDP，已登录）逐组实测的能力表，**照抄即可**：
    #   多选：experience / degree / industry / scale / payType / partTime / stage
    #   单选：jobType / salary（多值只取第一个）
    # 兼职（jobType=1903）时「薪资待遇」整组消失、换成「结算方式 + 兼职时间」；
    # 反向不成立（全职下传 payType 站点不认），所以 payType/partTime 只在兼职下可见。
    # 「薪资待遇」的白名单带上空串/「不限」：没选求职类型时它仍然可用（站点默认不限类型）。
    GroupSpec("jobType", "jobType", "求职类型", ("求职类型",), multi=False),
    GroupSpec(
        "salary",
        "salary",
        "薪资待遇",
        ("薪资待遇", "薪资"),
        multi=False,
        visible_when=("jobType", ("", "0", "1901", "1902")),
    ),
    GroupSpec(
        "payType",
        "payType",
        "结算方式",
        ("结算方式",),
        multi=True,
        visible_when=("jobType", ("1903",)),
    ),
    GroupSpec(
        "partTime",
        "partTime",
        "兼职时间",
        ("兼职时间",),
        multi=True,
        visible_when=("jobType", ("1903",)),
    ),
    GroupSpec("experience", "experience", "工作经验", ("工作经验", "经验要求")),
    GroupSpec("degree", "degree", "学历要求", ("学历要求", "学历")),
    GroupSpec("industry", "industry", "公司行业", ("公司行业", "行业"), dom_codes=False),
    GroupSpec("scale", "scale", "公司规模", ("公司规模",)),
    GroupSpec("stage", "stage", "融资阶段", ("融资阶段", "融资")),
)

# 页面筛选栏里读得到、但**编码不可信**的分组（见 ``GroupSpec.dom_codes``）。这些分组只从
# 接口取选项，页面的那份只用来发现"站点改版了"（标题都变了说明筛选栏动过）。
_DOM_CODE_KEYS = frozenset(spec.key for spec in GROUP_SPECS if spec.dom_codes)

# conditions.json 里 6 个短清单的键 → 分组 key。
_CONDITION_KEYS: tuple[tuple[str, str], ...] = (
    ("jobTypeList", "jobType"),
    ("salaryList", "salary"),
    ("payTypeList", "payType"),
    ("partTimeList", "partTime"),
    ("experienceList", "experience"),
    ("degreeList", "degree"),
    ("scaleList", "scale"),
    ("stageList", "stage"),
)
