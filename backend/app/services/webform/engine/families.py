"""跨族否决：控件**自述**属于另一族时，本族字段不许认领它。

与 ``FIELD_EXCLUDE_HINTS`` 的分工：那张表是"某字段自己的排除词"、按**签名**匹配
（label + 区块 + 旁文 + aria-describedby）。签名匹配对"整表标签串"这类页面污染
**过宽**：mokahr apply 页每个控件的旁文都累积着整张表的标签（含"手机号码"），
签名级否定会把同一页上正常的日期框一并漏掉（2026-10-05 实测：普通「毕业时间」
文本框在污染页面上完全不填）。

这里只认控件**自己说**的话（``own_text()``：label / placeholder / name / aria），
旁文污染不进自述，所以能安全地把保护对象从"四个日期字段"扩展到整个日期族。

标记词全部有真机 incident 背书；无标记的控件、未登记族的字段一律不受影响。
"""
from __future__ import annotations

from .model import Control

# 字段 → 族。只登记有 incident 背书的族；未登记字段不参与族否决。
#
# 日期族：值必须是日期形状。2026-10-05 鹰角 apply 页实测——区号框旁的报错文案
# 含「毕业时间不能晚于当前日期」，``education_end`` 经旁文档命中把日期写进了
# 区号框。同一页面结构下任何日期字段都可能踩到，保护覆盖全族。
FIELD_FAMILY: dict[str, str] = {
    "birth_date": "date",
    "education_start": "date",
    "education_end": "date",
    "work_start": "date",
    "work_end": "date",
    "experience_start": "date",
    "experience_end": "date",
    "project_start": "date",
    "project_end": "date",
    "campus_start": "date",
    "campus_end": "date",
    "award_date": "date",
    "party_join_date": "date",
    "available_date": "date",
}

# 族 → 控件自述里的标记词（与 2026-10-05 鹰角页的负向保护同一组词）。
FAMILY_MARKERS: dict[str, tuple[str, ...]] = {
    "phone": ("手机", "号码", "区号", "电话"),
}


def foreign_marker(control: Control, field_name: str) -> str | None:
    """控件自述里带着**别的族**的标记词时返回那个词；否则 ``None``。

    字段未登记族、或控件自述里没有别的族标记，都不否决——保守起步，
    每加一句话都要有真机 case 说明它在修什么。
    """
    family = FIELD_FAMILY.get(field_name)
    if family is None:
        return None
    text = control.own_text()
    if not text:
        return None
    for other_family, markers in FAMILY_MARKERS.items():
        if other_family == family:
            continue
        for marker in markers:
            if marker in text:
                return marker
    return None
