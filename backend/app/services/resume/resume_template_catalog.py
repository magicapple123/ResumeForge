"""Built-in resume template catalog and lookup helpers."""

from pathlib import Path

TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / "templates"
DEFAULT_TEMPLATE = "classic"
DEFAULT_PAGE_LIMIT = 1

RESUME_TEMPLATES: dict[str, dict] = {
    "classic": {
        "name": "classic",
        "label": "经典",
        "file": "resume.html.j2",
        "description": "深蓝标题与左侧色条，稳重的通用款式",
    },
    "modern": {
        "name": "modern",
        "label": "现代",
        "file": "resume_modern.html.j2",
        "description": "青绿配色与圆角标签，适合互联网岗位",
    },
    "compact": {
        "name": "compact",
        "label": "精简",
        "file": "resume_compact.html.j2",
        "description": "细线分隔、排版紧凑，适合内容多、想压在一页",
    },
    "elegant": {
        "name": "elegant",
        "label": "优雅",
        "file": "resume_elegant.html.j2",
        "description": "居中标题与衬线字，留白舒展，适合文商科与管理岗位",
    },
    "technical": {
        "name": "technical",
        "label": "技术",
        "file": "resume_technical.html.j2",
        "description": "色块标题与等宽辅助信息，信息密度高，适合研发岗位",
    },
    "minimal": {
        "name": "minimal",
        "label": "极简",
        "file": "resume_minimal.html.j2",
        "description": "只用黑灰与字号层级，没有任何色块与装饰",
    },
    "editorial": {
        "name": "editorial",
        "label": "社论",
        "file": "resume_editorial.html.j2",
        "description": "衬线字体与细线分隔，适合文商科、内容与管理岗位",
    },
    "split": {
        "name": "split",
        "label": "分栏",
        "file": "resume_split.html.j2",
        "description": "正文双栏、信息密度高，适合经历与技能较多的简历",
    },
}


def template_spec(name: str) -> dict:
    return RESUME_TEMPLATES.get((name or "").strip()) or RESUME_TEMPLATES[DEFAULT_TEMPLATE]


def template_options() -> list[dict]:
    """列出可选样式模板。"""
    return [
        {
            "name": item["name"],
            "label": item["label"],
            "description": item["description"],
        }
        for item in RESUME_TEMPLATES.values()
    ]


def template_options_with_custom(custom: list[dict]) -> list[dict]:
    """内置模板 + 用户自制模板（自制排在后面，用 ``custom`` 标记区分）。"""
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
            }
        )
    return options


__all__ = ["DEFAULT_PAGE_LIMIT", "DEFAULT_TEMPLATE", "RESUME_TEMPLATES", "TEMPLATES_DIR", "template_options", "template_options_with_custom", "template_spec"]
