# SPDX-License-Identifier: Apache-2.0
"""求职偏好档的枚举映射与目录选项（纯数据，无归一化逻辑）。

从 job_preference_catalog 拆出来的原因只有一个：catalog 已经贴住
test_file_size_budget 的 500 行硬闸门，而 ruff format 会把这些多条目字典展开成
一行一条。映射与选项是目录数据，不参与校验逻辑，拆到这里不改变任何行为，也让
catalog 为后续新增偏好类别留出余量。

两类数据成对维护：*_MAP 是归一化输入别名（协议值 + 常见中文写法），
*_OPTIONS 是目录与前端共用的展示顺序（顺序本身是行为契约）。
"""

from __future__ import annotations

CHINESE_NUMBERS: dict[str, int] = {
    "一": 1,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
}

WORK_MODE_MAP: dict[str, str] = {
    "onsite": "onsite",
    "现场": "onsite",
    "坐班": "onsite",
    "线下": "onsite",
    "hybrid": "hybrid",
    "混合": "hybrid",
    "混合办公": "hybrid",
    "半远程": "hybrid",
    "remote": "remote",
    "远程": "remote",
    "线上": "remote",
    "居家": "remote",
}
OVERTIME_MAP: dict[str, str] = {
    "accept": "accept",
    "接受": "accept",
    "可以": "accept",
    "没问题": "accept",
    "不限": "accept",
    "limited": "limited",
    "少量": "limited",
    "偶尔": "limited",
    "有限": "limited",
    "尽量少": "limited",
    "reject": "reject",
    "不接受": "reject",
    "拒绝": "reject",
    "不加班": "reject",
    "不能加班": "reject",
}
TONE_MAP: dict[str, str] = {
    "professional": "professional",
    "专业": "professional",
    "正式": "professional",
    "稳重": "professional",
    "plain": "plain",
    "平实": "plain",
    "朴实": "plain",
    "简洁": "plain",
    "warm": "warm",
    "温和": "warm",
    "亲切": "warm",
    "有温度": "warm",
}
# 用工形式：外包既不是行业也不是工作方式（现场/远程），必须单列一类，否则「不投外包」
# 只能被就近塞进「排除行业」，模型自己都会向用户承认"分类是就近选择"。
EMPLOYMENT_TYPE_MAP: dict[str, str] = {
    "full_time": "full_time",
    "fulltime": "full_time",
    "正式": "full_time",
    "全职": "full_time",
    "正职": "full_time",
    "internship": "internship",
    "intern": "internship",
    "实习": "internship",
    "outsourcing": "outsourcing",
    "outsourced": "outsourcing",
    "外包": "outsourcing",
    "驻场": "outsourcing",
    "part_time": "part_time",
    "parttime": "part_time",
    "兼职": "part_time",
    "dispatch": "dispatch",
    "labor_dispatch": "dispatch",
    "劳务派遣": "dispatch",
    "派遣": "dispatch",
}

# ===== 枚举选项（目录与前端共用） =====

WORK_MODE_OPTIONS: tuple[tuple[str, str], ...] = (
    ("onsite", "现场"),
    ("hybrid", "混合"),
    ("remote", "远程"),
)
OVERTIME_OPTIONS: tuple[tuple[str, str], ...] = (
    ("accept", "接受"),
    ("limited", "尽量少"),
    ("reject", "不接受"),
)
REDLINE_TONE_OPTIONS: tuple[tuple[str, str], ...] = (
    ("professional", "专业"),
    ("plain", "平实"),
    ("warm", "温和"),
)
EMPLOYMENT_TYPE_OPTIONS: tuple[tuple[str, str], ...] = (
    ("full_time", "正职"),
    ("internship", "实习"),
    ("outsourcing", "外包"),
    ("part_time", "兼职"),
    ("dispatch", "劳务派遣"),
)

__all__ = [
    "CHINESE_NUMBERS",
    "EMPLOYMENT_TYPE_MAP",
    "EMPLOYMENT_TYPE_OPTIONS",
    "OVERTIME_MAP",
    "OVERTIME_OPTIONS",
    "REDLINE_TONE_OPTIONS",
    "TONE_MAP",
    "WORK_MODE_MAP",
    "WORK_MODE_OPTIONS",
]
