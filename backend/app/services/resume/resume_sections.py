# SPDX-License-Identifier: Apache-2.0
"""简历正文的分区（板块）定义与顺序。

**为什么要有这个模块**：正文的七个分区在四处独立渲染——HTML 模板（预览、HTML 导出、
浏览器打印）、服务端 PDF、Word、Markdown。顺序一旦被写死在四处，用户改了一处看到的效果
就只对那一处生效，另外三处会**悄悄地**保持旧顺序——而"导出的和预览的不一样"是那种
用户会怀疑整个工具的问题。所以顺序在这里定义一次，四个渲染器都从这里取。

存储位置：简历的 `format_config`（按简历的版式覆盖）里的 `section_order`。
放在版式配置里而不是新增数据库列，是因为它本来就是"内容怎么排"的一部分，而且
`format_config` 已经是按简历存的一份 JSON 覆盖，不需要迁移。

一条刻意的约束：**存下来的顺序永远是七个键的一个完整排列**（`normalized_section_order`
负责补齐）。这样渲染器不必处理"某个分区不在列表里"这种状态——那种状态只有一种解释
（忘记写了），而它的表现是"某个板块凭空消失"，是最难被发现的一类 bug。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

# `default_section_order_config` 需要读「我的资料」那一行。放在模块级是因为依赖方向
# 是单向的（profile_service 不 import 本模块，见它的 import 清单），不会成环。
from ..profile.profile_service import get_or_create_profile
from .resume_labels import DEFAULT_RESUME_LANGUAGE, SECTION_TITLES, section_title

# 默认顺序（2026-10 起）= 「教育优先」：教育 → 实习/工作 → 项目 → 专业技能 →
# 校园 → 荣誉 → 个人总结。与资料页的 ``schemas/profile.py::PROFILE_SECTION_KEYS``
# 逐项对齐，**两处必须同批改**。
#
# 为什么改成这一版：默认值只有一份可见语义——"新建的简历长什么样"。校招场景下读者
# 先确认学历与专业，再往工作/项目看；「个人总结」是概括性文字，读完经历再看更顺。
#
# **老数据不受影响**：已保存简历读的是自己那条 ``format_config.section_order``
# （显式 JSON），只有"没有这个键"的简历才跟随默认值——它们本来就该跟着默认走。
# 改默认值不是迁移：不得回填或覆盖任何已有记录的 ``section_order``。
DEFAULT_SECTION_ORDER: tuple[str, ...] = (
    "education",
    "experience",
    "projects",
    # W14 科研三栏目插在项目之后、技能之前（空板块所有渲染器都不产生节点，旧产物不变）。
    "publications",
    "research_projects",
    "patents",
    "skills",
    "campus_experience",
    "awards",
    "summary",
)

# 分区标题的唯一来源是 ``resume_labels.SECTION_TITLES``（按语言分组的一张表）。
# 这里保留 ``SECTION_LABELS`` 这个名字，是因为它被模板清单接口（``templates_routes``）
# 与 ``normalized_section_order`` 的键校验直接消费；内容与默认语言逐字相同，
# 所以默认语言的产物零变化。**不要再往这个文件里写字面量**——渲染器取标题一律走
# ``resume_labels``，这里只是默认语言的一个别名。
SECTION_LABELS: dict[str, str] = SECTION_TITLES[DEFAULT_RESUME_LANGUAGE]

# 「我的资料」那边的分区名 -> 简历正文的分区名。
#
# 两边的键名本来就不一样（资料页是复数形式的子表名，正文是单数形式的分区键），
# 而生成界面的"默认顺序"应当等于用户在资料页排好的顺序——所以在两者之间必须有一份
# 显式的映射，不能靠"去掉 s"之类的字符串魔法（`summary` 就没有复数形式）。
#
# `basic_info` 刻意**不在**映射里：姓名、联系方式、照片是页眉，不参与正文分区排序
# （见上面的说明），资料页把它排在哪一位都不该影响简历。
PROFILE_SECTION_TO_RESUME: dict[str, str] = {
    "educations": "education",
    "experiences": "experience",
    "campus_experiences": "campus_experience",
    "projects": "projects",
    "skills": "skills",
    "awards": "awards",
    "summary": "summary",
}

# 页眉（姓名 / 求职意向 / 联系方式 / 照片）不在可排序的七个分区里，它永远在最前面。
# 这里显式写下来，是为了让"为什么列表里没有它"这个问题有一个能搜到的答案。


def section_label(key: str, language: str | None = None) -> str:
    """取单个分区标题。

    ``language`` 缺省（``None``）时用默认语言，行为与加这个参数之前**逐字一致**，
    因此既有调用方（``templates_routes``）不用改。未知语言/未知键由
    ``resume_labels`` 收口：前者回落默认语言，后者回落成键名本身。
    """
    return section_title(key, language)


def normalized_section_order(raw: object) -> list[str]:
    """把任意输入归一化成"七个键齐全、无重复、只含已知键"的顺序。

    未出现在输入里的键按默认顺序补在后面：用户只调了前两项，不应该让其余五项消失。
    """
    if isinstance(raw, (list, tuple)):
        candidates = raw
    elif isinstance(raw, str):
        # 查询串里传过 "summary,education" 这种写法；按逗号拆开照样认。
        candidates = raw.split(",")
    else:
        return list(DEFAULT_SECTION_ORDER)

    ordered: list[str] = []
    for item in candidates:
        key = str(item).strip()
        if key in SECTION_LABELS and key not in ordered:
            ordered.append(key)
    for key in DEFAULT_SECTION_ORDER:
        if key not in ordered:
            ordered.append(key)
    return ordered


def resolved_section_order(format_config: dict | None) -> list[str]:
    """从版式覆盖里取分区顺序；没设过就用默认顺序。"""
    if not isinstance(format_config, dict):
        return list(DEFAULT_SECTION_ORDER)
    if "section_order" not in format_config:
        return list(DEFAULT_SECTION_ORDER)
    return normalized_section_order(format_config.get("section_order"))


def profile_order_to_section_order(profile_keys: list[str]) -> list[str]:
    """把「我的资料」的分区键表翻译成简历正文的分区顺序（七个键的完整排列）。

    两条规则，缺一不可：

    1. **只保留有对应项的键**：资料里的 ``basic_info``（页眉）与其他未知键直接丢弃——
       页眉不参与正文排序，而"未知键"只能是资料页那边加了新分区，简历这边还没跟上。
    2. **缺失的简历板块按内置默认的相对顺序补在末尾**：用户只在资料页拖了「项目经历」，
       不能因此让「教育」「技能」等板块凭空消失。为什么补在**末尾**而不是补在"原地"：
       资料顺序是用户唯一表达过的偏好，翻译过来的那几项就是他心里真实的前后关系；
       而没被资料覆盖到的板块，用户根本没有表达过它们该排哪儿——把"没有意见"塞进
       用户已经排好的队列中间，等于替用户做了一次他没做过的决定。补在末尾是**唯一
       不覆盖已有偏好**的选择，且与 ``normalized_section_order`` 对垃圾输入的兜底
       完全同向（那里也是"缺的按默认顺序补在后面"）。

    纯函数：不读 DB、不改入参、不抛异常（`format_config` 与资料页的 `section_order`
    都是用户可以随手改的 JSON，抛异常会让整份配置失效）。
    """
    ordered: list[str] = []
    for item in profile_keys:
        key = PROFILE_SECTION_TO_RESUME.get(str(item).strip())
        if key is not None and key not in ordered:
            ordered.append(key)
    # 补齐成完整排列：缺失项落在末尾，顺序取自内置默认（见 docstring 第 2 条）。
    return normalized_section_order(ordered)


def default_section_order_config(db: Session) -> dict | None:
    """新建简历时应当落库的默认板块顺序片段：``{"section_order": [...]}``。

    **为什么"等于内置默认就返回 ``None``"**：沿用 ``buildSectionOrderConfig``（前端）的
    口径——"用户没调过就不写这个键"。写一个恰好等于默认值的键，会让未来某次默认顺序调整
    对这批简历**失效**（它们被钉在旧默认上），而它们本来应该跟着默认走。

    **为什么缺失项补在末尾**：见 ``profile_order_to_section_order`` 的 docstring。这里额外
    说明"为什么要在**创建时**物化"：卡片（「调整板块顺序」）与四个渲染器必须读同一份
    ``format_config.section_order``。靠前端 UI 的默认值临时生效，就会出现"卡片显示资料
    顺序、PDF 按内置默认排"的两套结果；落库之后两者只有一个来源，不可能分叉。
    """
    profile = get_or_create_profile(db)
    order = profile_order_to_section_order(list(profile.section_order or []))
    if order == list(DEFAULT_SECTION_ORDER):
        return None
    return {"section_order": order}


def profile_to_resume_order(raw: object) -> list[str]:
    """把「我的资料」存的分区顺序翻译成简历正文的分区顺序。

    生成界面的默认板块顺序取这里的结果：用户在资料页把「项目经历」拖到最前面，
    生成出来的简历就应当也是项目在前——但**只作为默认值**，不影响已保存简历的外观
    （老简历读的是自己 `format_config.section_order`，没有则仍是内置默认顺序）。

    非列表 / 未知键 / 重复键都不报错：`format_config` 与资料页的 `section_order` 都是
    用户可以随手改的 JSON，抛异常会让整份配置失效。垃圾输入一律回落到内置默认顺序，
    而"少写了几项"由 ``profile_order_to_section_order`` 补齐成完整排列（翻译规则只有
    那一份实现，这里只负责"入参不是列表"的兜底）。
    """
    if not isinstance(raw, (list, tuple)):
        return list(DEFAULT_SECTION_ORDER)
    return profile_order_to_section_order([str(item) for item in raw])


__all__ = [
    "DEFAULT_SECTION_ORDER",
    "PROFILE_SECTION_TO_RESUME",
    "SECTION_LABELS",
    "default_section_order_config",
    "normalized_section_order",
    "profile_order_to_section_order",
    "profile_to_resume_order",
    "resolved_section_order",
    "section_label",
]
