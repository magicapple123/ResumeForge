# SPDX-License-Identifier: Apache-2.0
"""W00/W20 合成样例库的**数据契约**：样例类型、期望与虚构数据底座。

这里只定义"一份样例由什么组成"，不定义任何具体样例（见 sample_corpus_*），
也不做渲染（见 sample_verify）。三条硬约束：

1. **纯虚构**：姓名 / 公司 / 学校 / 链接全部来自本模块的 EXAMPLE_* 常量或
   「示例」前缀；手机号固定 138-0000-0000，域名只用 example.com /
   example.org。样例会被复制到仓库外临时目录、被脚本反复渲染，真实个人资料
   一个字段都不许进来。
2. **可重复**：内容由固定常量与固定顺序拼出，文件里没有"当前时间"或随机数；
   random.Random(CORPUS_SEED) 只用于需要列表变化的少数样例，且 seed 固定。
   生成器跑两遍得到的 manifest 必须逐字节相同（check 命令会真的比对）。
3. **期望先于实现**：Expect 描述"这份样例应当呈现什么"，不是"渲染器现在
   给出什么"。check 命令拿渲染结果去对照它；对不上就是缺陷，**不许改期望转绿**。
"""

from __future__ import annotations

import base64
import copy
import json
from dataclasses import dataclass, field
from functools import lru_cache
from io import BytesIO
from typing import Any

# 语料版本：样例集合或期望语义变化时递增，manifest 里带版本号便于比对。
CORPUS_VERSION = "2026-10-24.1"
# 需要"列表变化"时用的固定 seed。语料确定性靠它 + 排序固定，不靠 time/env。
CORPUS_SEED = 20261024

# ===== 虚构数据底座（全仓库只此一份）=====
PHONE = "138-0000-0000"
EMAIL = "sample.a@example.com"
EMAIL_ALT = "sample.b@example.org"
CITY = "示例市"
PERSONAL_WEBSITE = "https://portfolio.example.com/sample-a"
GITHUB = "https://github.example.com/sample-a"
SCHOOL = "示例大学"
COMPANY = "示例科技有限公司"
COMPANY_ALT = "示例文化传播有限公司"
ORGANIZATION = "示例大学学生会"
JOB_INTENT = "示例岗位"


@lru_cache(maxsize=8)
def synthetic_photo_data_url(width: int = 120, height: int = 160, fmt: str = "jpeg") -> str:
    """确定性的**虚构**头像（纯色底 + 几何图形），不是任何真人照片。

    用固定几何图形而不是随机噪声：同一 Pillow 版本下字节稳定，且不会因为"随机
    像素"让两份样例的 content_sha256 在复跑时漂移。宽高可调，用来构造
    wide（400x60）与 tall（60x400）两档极端比例。
    """
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (width, height), (214, 222, 232))
    draw = ImageDraw.Draw(image)
    # 一个居中的圆 + 一条底边带：任何形状都行，它不是脸。
    radius = max(4, min(width, height) // 3)
    center_x, center_y = width // 2, height // 2
    draw.ellipse(
        (center_x - radius, center_y - radius, center_x + radius, center_y + radius),
        fill=(120, 144, 168),
    )
    draw.rectangle((0, height - max(2, height // 12), width, height), fill=(70, 92, 110))
    buffer = BytesIO()
    if fmt.lower() == "png":
        image.save(buffer, format="PNG", optimize=False)
        mime = "image/png"
    else:
        image.save(buffer, format="JPEG", quality=85, optimize=False)
        mime = "image/jpeg"
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def education(**overrides: Any) -> dict[str, Any]:
    """一条教育经历（虚构）；overrides 覆盖单个字段。"""
    item: dict[str, Any] = {
        "school": SCHOOL,
        "major": "示例专业",
        "degree": "本科",
        "start_date": "2019.09",
        "end_date": "2023.06",
        "gpa": "3.7/4.0",
        "courses": ["示例课程一", "示例课程二"],
        "achievements": ["示例奖学金一次", "示例竞赛二等奖"],
    }
    item.update(overrides)
    return item


def experience(**overrides: Any) -> dict[str, Any]:
    item: dict[str, Any] = {
        "company": COMPANY,
        "role": "示例岗位",
        "start_date": "2023.07",
        "end_date": "至今",
        "description": [
            "负责示例业务模块，把示例流程从 10 天压到 4 天。",
            "维护示例台账，示例指标环比提升 18%。",
        ],
    }
    item.update(overrides)
    return item


def project(**overrides: Any) -> dict[str, Any]:
    item: dict[str, Any] = {
        "name": "示例项目",
        "role": "项目负责人",
        "start_date": "2023.09",
        "end_date": "2024.03",
        "tech_stack": ["示例工具", "示例方法"],
        "description": ["从 0 到 1 完成示例项目，覆盖 3 个示例场景。"],
        "highlights": ["示例成果一次，节省 20% 时间。"],
    }
    item.update(overrides)
    return item


def skill(name: str = "示例技能", level: str = "熟练") -> dict[str, Any]:
    return {"name": name, "level": level}


def award(name: str = "示例奖学金", date: str = "2021.10") -> dict[str, Any]:
    return {"name": name, "date": date, "description": ""}


def base_content() -> dict[str, Any]:
    """覆盖 ResumeContent 全部字段的虚构基础内容（一次一页的量级）。"""
    return {
        "name": "示例甲",
        "photo": "",
        "gender": "女",
        "birth_year": "2000",
        "phone": PHONE,
        "email": EMAIL,
        "city": CITY,
        "personal_website": PERSONAL_WEBSITE,
        "github": GITHUB,
        "job_intent": JOB_INTENT,
        "summary": "示例概述：3 年示例领域经验，习惯把一次性经验沉淀成可复用的流程。",
        "education": [education()],
        "experience": [experience()],
        "campus_experience": [
            {
                "organization": ORGANIZATION,
                "role": "副部长",
                "start_date": "2021.09",
                "end_date": "2022.06",
                "description": ["统筹 6 场示例活动，累计触达 3000 余人次。"],
            }
        ],
        "projects": [project()],
        "skills": [skill("示例技能一"), skill("示例技能二", "掌握"), skill("Excel", "熟练")],
        "awards": [award()],
    }


def with_photo(content: dict[str, Any], *, kind: str = "standard") -> dict[str, Any]:
    """给内容装上虚构照片；kind 决定宽高比（standard / wide / tall / large）。"""
    sizes = {
        "standard": (120, 160, "jpeg"),
        "wide": (400, 60, "png"),
        "tall": (60, 400, "png"),
        "large": (600, 750, "jpeg"),
    }
    width, height, fmt = sizes[kind]
    result = copy.deepcopy(content)
    result["photo"] = synthetic_photo_data_url(width, height, fmt)
    return result


@dataclass(frozen=True)
class Expect:
    """一份样例**声明**的预期行为；None / 空 = 该维度不检查。

    max_pages 对照的是 PDF 的 pages_needed（自然页数，未截断）——"这份内容按这套
    参数应当排进几页"是样例要守的性质。overflow 对照 build_resume_pdf 的溢出标记，
    只对"故意超页"的样例声明。text_tokens 在 Markdown / TXT / HTML / Word 四种
    **确定性文本产物**里查（PDF 文本提取另有 pdf_text_tokens，因为提取结果依赖
    外部工具与字体轮廓格式）。
    """

    max_pages: int | None = None
    overflow: bool | None = None
    photo: bool | None = None
    text_tokens: tuple[str, ...] = ()
    pdf_text_tokens: tuple[str, ...] = ()
    # HTML 产物的"转义/保留"断言：正文里的 <script> 字样必须以实体形式出现，
    # 原始标签一个都不能进 DOM（模板自己的脚本标签不算，用整段 token 断言）。
    html_contains: tuple[str, ...] = ()
    html_excludes: tuple[str, ...] = ()
    # HTML 是最早的转义层：正文里的 & < > 会被 Jinja 自动转义，所以带这些字符的
    # token 不能要求"在 HTML 里原样出现"。设 False 时 html 不参与 text_tokens 检查，
    # 转义本身另由 html_contains / html_excludes 断言。
    html_text_tokens: bool = True
    bold_html: bool | None = None
    literal_markers: bool | None = None
    missing_glyph_probe: bool = False
    legacy_raw: bool = False

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {}
        for key in ("max_pages", "overflow", "photo", "bold_html", "literal_markers"):
            value = getattr(self, key)
            if value is not None:
                data[key] = value
        for key in ("text_tokens", "pdf_text_tokens", "html_contains", "html_excludes"):
            value = getattr(self, key)
            if value:
                data[key] = list(value)
        if not self.html_text_tokens:
            data["html_text_tokens"] = False
        if self.missing_glyph_probe:
            data["missing_glyph_probe"] = True
        if self.legacy_raw:
            data["legacy_raw"] = True
        return data


@dataclass(frozen=True)
class Sample:
    """一份合成样例：内容 + 渲染参数 + 覆盖点 + 期望。"""

    sample_id: str
    kind: str  # "iteration" | "boundary"
    category: str
    title: str
    coverage: tuple[str, ...]
    content: dict[str, Any]
    template: str = "classic"
    font_scale: str = "standard"
    page_limit: int = 1
    language: str = "zh-CN"
    format_config: dict[str, Any] | None = None
    include_photo: bool = True
    expect: Expect = field(default_factory=Expect)

    @property
    def content_file(self) -> str:
        return f"content/{self.sample_id}.json"

    def content_dict(self) -> dict[str, Any]:
        """内容的深拷贝（样例不可被 check 过程改到）。"""
        return json.loads(json.dumps(self.content, ensure_ascii=False))

    def to_manifest_entry(self, content_sha256: str) -> dict[str, Any]:
        return {
            "id": self.sample_id,
            "kind": self.kind,
            "category": self.category,
            "title": self.title,
            "template": self.template,
            "font_scale": self.font_scale,
            "page_limit": self.page_limit,
            "language": self.language,
            "format_config": self.format_config,
            "include_photo": self.include_photo,
            "coverage": list(self.coverage),
            "expect": self.expect.to_dict(),
            "content_file": self.content_file,
            "content_sha256": content_sha256,
        }


__all__ = [
    "CORPUS_SEED",
    "CORPUS_VERSION",
    "EMAIL",
    "EMAIL_ALT",
    "GITHUB",
    "JOB_INTENT",
    "PERSONAL_WEBSITE",
    "PHONE",
    "Expect",
    "Sample",
    "award",
    "base_content",
    "education",
    "experience",
    "project",
    "skill",
    "synthetic_photo_data_url",
    "with_photo",
]
