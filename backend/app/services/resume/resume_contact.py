# SPDX-License-Identifier: Apache-2.0
"""页眉联系方式的唯一实现：字段顺序、文案、强制换行与「按字段不折行」。

## 为什么单独成文件

页眉联系方式在**四个渲染器**里都要出现：HTML（`_resume_sections.j2` 的 `.contact`）、
服务端 PDF、Word、以及前端草稿预览（草稿预览用的就是同一个 HTML 模板）。字段表、文案、
换行规则若各写一份，就会回到 W05 之前那种"预览有、Word 没有"的分叉——2026-10 用户反馈的
Word 缺 GitHub / 个人主页正是这么来的（PDF 早已补齐，Word 还是旧的四字段）。

所以：**字段顺序与展示文案只在这里定义一次**，三个渲染器只负责"怎么摆"。

## `format_config.contact_breaks` 契约（W 批 #3）

```text
contact_breaks = ["email", "github"]   # 键取自 CONTACT_FIELDS；在列出的字段前强制换行
```

* 白名单校验：未知键丢弃、重复去重、顺序按 `CONTACT_FIELDS`（字段顺序固定，用户只选位置）；
* 空列表 = 没有这个键（默认行为：字段之间自动换行，每个字段整体不折行）；
* 旧简历没有这个键 → 输出与"只有字段间自动换行"完全一致，不产生额外标记。

## 折行口径

* **字段整体不折行**：一个联系方式（含「GitHub：」这种前缀）是一个不可再分的单元，
  网址因此不会被从中间劈成两行；HTML 侧由模板 CSS 的 `white-space: nowrap` 表达，
  PDF / Word 侧由"按字段整组排版、绝不按字符拆"表达。
* **字段之间可以自动换行**：HTML 用 `<wbr>` 提供断点（`<span>` 之间没有空白字符，
  浏览器本来没有断点）；PDF 由 `pack_contact_lines` 的贪心装行决定；Word 由普通空格断点
  控制。三者都是"整字段换行"，不会拆开字段内部。
"""

from __future__ import annotations

from ...schemas.resume import ResumeContent

#: `format_config` 里的键名（与前端 `CONTACT_BREAKS_KEY` 逐字一致）。
CONTACT_BREAKS_KEY = "contact_breaks"

#: 页眉联系方式的字段顺序。HTML / PDF / Word 三处都读这一份；新增字段只改这里。
CONTACT_FIELDS: tuple[str, ...] = (
    "phone",
    "email",
    "city",
    "birth_year",
    "github",
    "personal_website",
)

#: 展示时带「标签：」前缀的字段 → `resume_labels.field_labels` 里的键。
#: 前四个是纯值（手机号 / 邮箱 / 城市 / 出生年份），网址类带标签才看得懂。
LABELLED_FIELDS: dict[str, str] = {
    "github": "github",
    "personal_website": "website",
}

#: PDF 同一行里字段之间的分隔符（与历史输出一致：四个半角空格）。
PDF_SEPARATOR = "    "
#: Word 同一行里字段之间的分隔符（与历史输出一致：两个全角空格）。
WORD_SEPARATOR = "\u3000\u3000"


def validate_contact_breaks(raw: object) -> list[str]:
    """把用户输入白名单化成字段键列表（未知键丢弃、去重、按字段顺序）。

    `format_config` 是用户可以随手改的 JSON，任何形状都不该让渲染 500：非列表一律当
    "没有设置"。返回空列表 = 空域（调用方据此不写这个键，与"从未设置"逐字节等价）。
    """
    if isinstance(raw, str):
        # 兼容查询串 / 手写 JSON 的逗号写法（与 `section_order` 的宽松度一致）。
        candidates: list[object] = raw.split(",")
    elif isinstance(raw, (list, tuple)):
        candidates = list(raw)
    else:
        return []
    wanted = {str(item).strip() for item in candidates}
    # 按字段顺序输出，而不是用户输入顺序：字段顺序是固定的，用户只决定"在哪一行开始"。
    return [key for key in CONTACT_FIELDS if key in wanted]


def contact_entries(resume: ResumeContent, labels: dict[str, str]) -> list[tuple[str, str]]:
    """按固定顺序取出有值的联系方式：`[(字段键, 展示文本), …]`。

    空字段直接跳过（不留下空 span / 多余分隔符），与 `_resume_sections.j2` 原来的
    `{% if resume.phone %}` 口径一致。`labels` 是 `resume_labels.field_labels(language)`。
    """
    entries: list[tuple[str, str]] = []
    for key in CONTACT_FIELDS:
        value = str(getattr(resume, key, "") or "").strip()
        if not value:
            continue
        label_key = LABELLED_FIELDS.get(key)
        text = f"{labels[label_key]}：{value}" if label_key else value
        entries.append((key, text))
    return entries


def contact_items(
    resume: ResumeContent,
    labels: dict[str, str],
    breaks: object = None,
) -> list[dict]:
    """HTML 模板用的字段列表：`[{key, text, break_before}, …]`。

    `break_before` 描述"这个字段之前要不要强制换行"：第一个可见字段永远为 `False`
    （在它前面换行没有意义），其余字段看 `contact_breaks` 白名单。模板据此渲染
    `<br>`（强制换行）/ `<wbr>`（字段之间的自动换行点）。
    """
    wanted = set(validate_contact_breaks(breaks))
    items: list[dict] = []
    for index, (key, text) in enumerate(contact_entries(resume, labels)):
        items.append(
            {
                "key": key,
                "text": text,
                "break_before": index > 0 and key in wanted,
            }
        )
    return items


def contact_groups(items: list[dict]) -> list[list[str]]:
    """按 `break_before` 把字段切成"必须各自成行"的若干组（组内可自动装行）。

    HTML / PDF / Word 的强制换行语义都从这里来：同一组是同一行内的候选，组与组之间
    一定换行。返回的是展示文本（不是字段键），渲染器直接拼装。
    """
    groups: list[list[str]] = []
    for item in items:
        text = str(item.get("text", ""))
        if not text:
            continue
        if item.get("break_before") or not groups:
            groups.append([text])
        else:
            groups[-1].append(text)
    return groups


def contact_lines(items: list[dict], separator: str) -> list[str]:
    """按强制换行分组后直接拼成行文本（Word 用；不需要再按宽度装行）。"""
    return [separator.join(group) for group in contact_groups(items)]


__all__ = [
    "CONTACT_BREAKS_KEY",
    "CONTACT_FIELDS",
    "LABELLED_FIELDS",
    "PDF_SEPARATOR",
    "WORD_SEPARATOR",
    "contact_entries",
    "contact_groups",
    "contact_items",
    "contact_lines",
    "validate_contact_breaks",
]
