# SPDX-License-Identifier: Apache-2.0
"""Built-in resume template catalog and lookup helpers."""

from pathlib import Path

TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / "templates"
DEFAULT_TEMPLATE = "classic"
DEFAULT_PAGE_LIMIT = 1

# 「选择模板」里列出的 5 套（2026-11 收敛：8 套太多，用户挑不出来）。
#
# 其余三套（technical / editorial / split）**仍然保留在 RESUME_TEMPLATES 里**，理由：
# 已经用它生成过的简历，记录里存的就是这三个名字，`template_spec` 必须还能解析到对应
# 的 `.j2` 文件——否则老简历重开预览会静默变成经典款，等于偷改用户的成品外观。
#
# scholar（2026-10 新增）：按一份学术简历的参考版式移植——纯黑白、加粗标题 + 整宽细线、
# 短条目三列并排。它是**可见**的第 6 套，与前面"收敛到 5 套"不冲突：那次收敛是拿掉
# 风格雷同的两套，这里补的是一套明显不同的版式（学术/科研场景）。
VISIBLE_TEMPLATE_NAMES: tuple[str, ...] = (
    "classic",
    "modern",
    "compact",
    "elegant",
    "minimal",
    "scholar",
)

RESUME_TEMPLATES: dict[str, dict] = {
    "classic": {
        "name": "classic",
        "label": "经典",
        "file": "resume.html.j2",
        "description": "深蓝标题与左侧色条，稳重的通用款式",
        "serif_heading": False,
    },
    "modern": {
        "name": "modern",
        "label": "现代",
        "file": "resume_modern.html.j2",
        "description": "青绿配色与圆角标签，适合互联网岗位",
        "serif_heading": False,
    },
    "compact": {
        "name": "compact",
        "label": "精简",
        "file": "resume_compact.html.j2",
        "description": "细线分隔、排版紧凑，适合内容多、想压在一页",
        "serif_heading": False,
    },
    "elegant": {
        "name": "elegant",
        "label": "优雅",
        "file": "resume_elegant.html.j2",
        "description": "居中标题与衬线字，留白舒展，适合文商科与管理岗位",
        "serif_heading": True,
    },
    "technical": {
        "name": "technical",
        "label": "技术",
        "file": "resume_technical.html.j2",
        "description": "色块标题与等宽辅助信息，信息密度高，适合研发岗位",
        "serif_heading": False,
    },
    "minimal": {
        "name": "minimal",
        "label": "极简",
        "file": "resume_minimal.html.j2",
        "description": "只用黑灰与字号层级，没有任何色块与装饰",
        "serif_heading": False,
    },
    "scholar": {
        "name": "scholar",
        "label": "学术",
        "file": "resume_scholar.html.j2",
        "description": "纯黑白、加粗标题配细线，短条目三列并排，适合科研与学术岗位",
        "serif_heading": False,
    },
    "editorial": {
        "name": "editorial",
        "label": "社论",
        "file": "resume_editorial.html.j2",
        "description": "衬线字体与细线分隔，适合文商科、内容与管理岗位",
        "serif_heading": True,
    },
    "split": {
        "name": "split",
        "label": "分栏",
        "file": "resume_split.html.j2",
        "description": "正文双栏、信息密度高，适合经历与技能较多的简历",
        "serif_heading": False,
    },
}


def template_spec(name: str) -> dict:
    return RESUME_TEMPLATES.get((name or "").strip()) or RESUME_TEMPLATES[DEFAULT_TEMPLATE]


def template_options() -> list[dict]:
    """列出**可选**模板（决策类 UI 用），顺序固定为 ``VISIBLE_TEMPLATE_NAMES``。

    与 ``RESUME_TEMPLATES`` 的区别是这里的清单会**少于**字典条目：下线的三套仍可渲染，
    但不再出现在"挑一个模板"的列表里。

    每个条目都带上 ``serif_heading``：前端据此只在"标题字族真的和精确预览不同"的模板上
    给那句字族说明，而不是对所有模板都摆一条与事实无关的提示。
    """
    options: list[dict] = []
    for name in VISIBLE_TEMPLATE_NAMES:
        item = RESUME_TEMPLATES.get(name)
        if item is None:  # 名字表写错时宁可少一项，也不要在这里抛异常
            continue
        options.append(
            {
                "name": item["name"],
                "label": item["label"],
                "description": item["description"],
                "serif_heading": bool(item.get("serif_heading", False)),
            }
        )
    return options


def template_options_with_custom(custom: list[dict]) -> list[dict]:
    """内置模板 + 用户自制模板（自制排在后面，用 ``custom`` 标记区分）。

    自制模板的 ``serif_heading`` **恒为 False**：自制的 HTML/CSS 由用户自己写，后端无从
    知道标题用了什么字族；猜一个 ``True`` 会让精确模式在纯黑体模板上也提示"字族不同"。
    """
    options = [
        {**item, "custom": False, "id": None} for item in template_options()
    ]
    for item in custom:
        options.append(
            {
                "name": item["name"],
                "id": item.get("id"),
                "label": item.get("label") or item["name"],
                "description": item.get("description", ""),
                "custom": True,
                "serif_heading": False,
            }
        )
    return options


__all__ = ["DEFAULT_PAGE_LIMIT", "DEFAULT_TEMPLATE", "RESUME_TEMPLATES", "TEMPLATES_DIR", "VISIBLE_TEMPLATE_NAMES", "template_options", "template_options_with_custom", "template_spec"]
