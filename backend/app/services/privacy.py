# SPDX-License-Identifier: Apache-2.0
"""简历脱敏变换：把可识别身份的字段替换成占位符，供导出 / 分享 / 脱敏预览复用。

这是全仓库脱敏规则的**唯一实现处**。默认遮罩姓名 / 手机 / 邮箱 / 公司名，以及
**GitHub 与个人主页**这两个"能顺着找到人"的链接字段；学校 / 项目 / 产品名可配置。
脱敏是"导出时变换"，**不回写真实数据**：输入一份 ``ResumeContent``，返回一份全新的
``ResumeContent``，原对象不被改动（deep copy）。

``mask_github`` / ``mask_website`` 默认开启（2026-10-21 补）：这两个字段此前不在脱敏范围
里，于是"脱敏导出"的联系方式行里会原样留着 ``github.com/<用户名>`` 与个人域名——一个
handle 就足以反查到人，与"遮住姓名和手机"的目的直接矛盾。它们能被 HTML / Markdown / Word
渲染出来，PDF 自 2026-10-21 起也会渲染（页头联系方式补齐字段），所以必须一并遮。

**A4 资格证照的证号（credential_number）不在 ResumeCredential 模型里**：证号是私密值，
解析层（coerce_resume / ResumeContent 校验）会直接丢弃未知键，因此脱敏、导出、日志与
模型上下文这几条链路**根本拿不到它**——"不输出"由数据形状保证，而不是靠这里再遮一次。
本模块只处理确实存在于模型里的字段。

``mask_product`` 的语义说明：``ResumeContent`` 里没有独立的"产品名"字段，产品名通常就是
项目名 / 公司名，并以叙事文本的形式出现在总结与描述里。所以这里做**正文级替换**——把
已知的项目名与公司名在总结 / 描述文本里遮罩，避免产品名从正文漏出。更细的产品名词表
留到 R-17 完整实现时再扩展。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..schemas.resume import ResumeContent
from .resume.resume_rich_text import strip_markers

# 遮罩占位符：三颗星足够醒目又不会泄露长度信息。
MASK = "***"


@dataclass(frozen=True)
class RedactionOptions:
    """脱敏选项。默认遮罩可直接识别身份的六项，其余按需开启。"""

    mask_name: bool = True
    mask_phone: bool = True
    mask_email: bool = True
    mask_company: bool = True
    mask_school: bool = False
    mask_project: bool = False
    mask_product: bool = False
    # 链接类字段：一个 GitHub handle 或个人域名足以反查到人，默认遮。
    mask_github: bool = True
    mask_website: bool = True


def _mask(value: str) -> str:
    """非空值替换为占位符，空值保持为空。"""
    return MASK if value else ""


# 照片是 base64 data URL，不是"文字"：脱敏时不碰它（也不该被标记剥离改写）。
_PLAIN_SKIP_FIELDS = frozenset({"photo"})


def _strip_plain(value):
    """递归剥掉字符串里的字符级加粗标记；其它类型原样返回。"""
    if isinstance(value, str):
        return strip_markers(value)
    if isinstance(value, list):
        return [_strip_plain(item) for item in value]
    if isinstance(value, dict):
        return {key: _strip_plain(item) for key, item in value.items()}
    return value


def plain_text_content(resume: ResumeContent) -> ResumeContent:
    """把简历里所有文本字段的 ``**`` 加粗标记剥掉，返回新对象。

    脱敏预览是**纯文本**消费方：显示 ``**李**四`` 既不是用户想要的加粗，也不是他
    想看到的脱敏结果。逐字段剥离而不是整份 JSON 替换，是因为 ``photo`` 这类字段
    里的内容不该被改动。
    """
    data = resume.model_dump()
    for key in list(data):
        if key in _PLAIN_SKIP_FIELDS:
            continue
        data[key] = _strip_plain(data[key])
    return ResumeContent.model_validate(data)


def _mask_tokens(text: str, tokens: set[str]) -> str:
    for token in tokens:
        if token and token in text:
            text = text.replace(token, MASK)
    return text


def redact(resume_content: ResumeContent, options: RedactionOptions | None = None) -> ResumeContent:
    """按选项脱敏一份简历内容，返回新对象，不改动输入。"""
    opts = options or RedactionOptions()
    # 先收集正文级"产品名" token：mask_company / mask_project 会把字段改成占位符，
    # 若在遮罩之后才收集，就只剩 "***"，正文里的原始公司 / 项目名会漏网。
    product_tokens = {project.name for project in resume_content.projects if project.name}
    product_tokens |= {
        experience.company for experience in resume_content.experience if experience.company
    }
    resume = resume_content.model_copy(deep=True)

    if opts.mask_name:
        resume.name = _mask(resume.name)
        # W14 科研：作者/发明人姓名按同一 mask_name 口径处理（合同 §5.6）。
        for publication in resume.publications:
            for author in publication.authors:
                author.name = _mask(author.name)
        for patent in resume.patents:
            for inventor in patent.inventors:
                inventor.name = _mask(inventor.name)
    if opts.mask_phone:
        resume.phone = _mask(resume.phone)
    if opts.mask_email:
        resume.email = _mask(resume.email)
    if opts.mask_github:
        resume.github = _mask(resume.github)
    if opts.mask_website:
        resume.personal_website = _mask(resume.personal_website)
    if opts.mask_company:
        for experience in resume.experience:
            experience.company = _mask(experience.company)
    if opts.mask_school:
        for education in resume.education:
            education.school = _mask(education.school)
        # W14 科研：期刊/会议与实验室同样可能反查身份（合同 §5.6）。
        for publication in resume.publications:
            publication.venue = _mask(publication.venue)
        for research in resume.research_projects:
            research.organization = _mask(research.organization)
        # A4 证照：颁发机构同样可能反查身份（与学校/实验室同一口径）。
        for credential in resume.credentials:
            credential.issuer = _mask(credential.issuer)
    if opts.mask_project:
        for project in resume.projects:
            project.name = _mask(project.name)
        # W14：论文/科研项目/专利标题按"项目名"口径遮（合同 §5.6）。
        for publication in resume.publications:
            publication.title = _mask(publication.title)
        for research in resume.research_projects:
            research.name = _mask(research.name)
        for patent in resume.patents:
            patent.title = _mask(patent.title)
        # A4 证照名称按"项目名"口径遮；证号本来就不在模型里（见下方说明）。
        for credential in resume.credentials:
            credential.name = _mask(credential.name)
    if opts.mask_product:
        resume.summary = _mask_tokens(resume.summary, product_tokens)
        for experience in resume.experience:
            experience.description = [
                _mask_tokens(line, product_tokens) for line in experience.description
            ]
        for project in resume.projects:
            project.description = [
                _mask_tokens(line, product_tokens) for line in project.description
            ]
            project.highlights = [_mask_tokens(line, product_tokens) for line in project.highlights]

    return plain_text_content(resume)


# ===== v2 文档（字段级模型）的脱敏：与 v1 同一份掩码规则，按 item/header 遍历 =====
#
# v2 是存储/渲染/导出的唯一格式（D12），所以导出与脱敏预览的输入会越来越常见是一份
# ResumeDocument JSON。v1 的 redact 仍保留给未迁移的分析/分享调用方；v2 侧新增下面两个
# 函数，**掩码规则仍是本模块同一份**（MASK、_mask_tokens），不复制第二套。

#: 页眉字段 -> 对应脱敏开关（photo 不脱敏：它不是文字，且遮成占位符会破坏导出）。
_HEADER_MASK_FLAGS: tuple[tuple[str, str], ...] = (
    ("name", "mask_name"),
    ("phone", "mask_phone"),
    ("email", "mask_email"),
    ("github", "mask_github"),
    ("personal_website", "mask_website"),
)

#: (分区 key, item key) -> 脱敏开关。与 v1 redact 的"遮哪一块"口径逐项对应。
_SECTION_MASK_FLAGS: tuple[tuple[tuple[str, str], str], ...] = (
    (("education", "school"), "mask_school"),
    (("experience", "company"), "mask_company"),
    (("projects", "name"), "mask_project"),
    (("publications", "title"), "mask_project"),
    (("publications", "venue"), "mask_school"),
    (("research_projects", "name"), "mask_project"),
    (("research_projects", "organization"), "mask_school"),
    (("patents", "title"), "mask_project"),
    (("credentials", "name"), "mask_project"),
    (("credentials", "issuer"), "mask_school"),
)

#: 产品名 token 的来源（v1 的 product_tokens = 项目名 + 公司名）。
_PRODUCT_TOKEN_SOURCES: tuple[tuple[str, str], ...] = (
    ("projects", "name"),
    ("experience", "company"),
)

#: 正文级文本（做产品名 token 遮罩的对象）：text 块与 body/lead/trail 的 field 值。
_TEXT_PLACEMENTS = frozenset({"body", "lead", "trail"})


def _iter_document_items(document: dict):
    for section in document.get("sections") or []:
        key = str(section.get("key") or "")
        for entry in section.get("entries") or []:
            for item in entry.get("items") or []:
                yield key, item


def _mask_header_document(document: dict, opts: RedactionOptions) -> None:
    for item in (document.get("header") or {}).get("items") or []:
        for key, flag in _HEADER_MASK_FLAGS:
            if item.get("key") == key and getattr(opts, flag):
                item["value"] = _mask(str(item.get("value") or ""))
                break


def _mask_document_fields(document: dict, opts: RedactionOptions) -> None:
    for section_key, item in _iter_document_items(document):
        kind = item.get("kind")
        if kind == "authors":
            if opts.mask_name:
                for author in item.get("authors") or []:
                    author["name"] = _mask(str(author.get("name") or ""))
            continue
        key = str(item.get("key") or "")
        for (section, field), flag in _SECTION_MASK_FLAGS:
            if section_key == section and key == field and getattr(opts, flag):
                if kind == "list":
                    item["values"] = [_mask(str(value)) for value in item.get("values") or []]
                else:
                    item["value"] = _mask(str(item.get("value") or ""))
                break


def _product_tokens_document(document: dict) -> set[str]:
    tokens: set[str] = set()
    for section_key, item in _iter_document_items(document):
        for section, key in _PRODUCT_TOKEN_SOURCES:
            if section_key == section and item.get("key") == key and item.get("kind") == "field":
                value = str(item.get("value") or "").strip()
                if value:
                    tokens.add(value)
    return tokens


def _mask_product_tokens_document(document: dict, tokens: set[str]) -> None:
    if not tokens:
        return
    for _section, item in _iter_document_items(document):
        kind = item.get("kind")
        if kind == "text":
            item["text"] = _mask_tokens(str(item.get("text") or ""), tokens)
            continue
        if item.get("placement") in _TEXT_PLACEMENTS and kind == "field":
            item["value"] = _mask_tokens(str(item.get("value") or ""), tokens)


def _strip_document_markers(document: dict) -> None:
    for item in (document.get("header") or {}).get("items") or []:
        if item.get("key") != "photo":
            item["label"] = strip_markers(str(item.get("label") or ""))
            item["value"] = strip_markers(str(item.get("value") or ""))
    for _section, item in _iter_document_items(document):
        kind = item.get("kind")
        item["label"] = strip_markers(str(item.get("label") or ""))
        if kind == "text":
            item["text"] = strip_markers(str(item.get("text") or ""))
        elif kind == "list":
            item["values"] = [strip_markers(str(value)) for value in item.get("values") or []]
        elif kind == "authors":
            for author in item.get("authors") or []:
                author["name"] = strip_markers(str(author.get("name") or ""))
        else:
            item["value"] = strip_markers(str(item.get("value") or ""))


def plain_text_document(document: dict) -> dict:
    """v2 文档：剥掉所有文本里的字符级加粗标记（照片字段不动），返回深拷贝。"""
    import copy

    doc = copy.deepcopy(document)
    _strip_document_markers(doc)
    return doc


def redact_document(document: dict, options: RedactionOptions | None = None) -> dict:
    """v2 文档脱敏：返回新的 v2 dict，输入不被改动（与 v1 redact 同一套掩码规则）。

    覆盖：页眉 PII 字段、各分区结构字段（公司/学校/项目/论文/科研/专利/证照）、作者姓名、
    以及 ``mask_product`` 时的正文级产品名 token（遮所有 text/正文类 field 值，比 v1 只遮
    总结/描述更严格——v2 的字段位置是数据，正文可能在任意抽屉里）。
    """
    opts = options or RedactionOptions()
    import copy

    doc = copy.deepcopy(document)
    tokens = _product_tokens_document(doc) if opts.mask_product else set()
    _mask_header_document(doc, opts)
    _mask_document_fields(doc, opts)
    _mask_product_tokens_document(doc, tokens)
    return plain_text_document(doc)


# ===== 敏感信息与合规风险的「识别」模式（R-08 与 R-17 共用） =====
# 简历上不该出现、或需要格外注意的敏感/合规内容。上面 ``redact`` 是「遮罩」变换，
# 这里是「识别」模式——R-08 风险扫描用它提示用户，R-17 完整隐私功能也会复用同一套
# 名单，避免两处各写一份而漂移（共享知识第 8 条：规则只有一份实现）。
#
# 每项是 (规则名, 正则表达式)。关键词类（只能靠字面命中、没有数字规律的）见
# ``SENSITIVE_KEYWORDS`` 与 ``COMPLIANCE_KEYWORDS``。
SENSITIVE_PATTERNS: tuple[tuple[str, str], ...] = (
    # 18 位中国居民身份证号（含末位 X/x）。
    (
        "身份证号",
        r"\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b",
    ),
    # 银行卡号：16~19 位纯数字（与身份证号重叠的部分由调用方按片段去重）。
    ("银行卡号", r"\b\d{16,19}\b"),
    # 精确出生日期（年-月-日），区别于仅写出生年份（birth_year）。
    ("精确出生日期", r"(?:19|20)\d{2}\s*[-年/.]\s*\d{1,2}\s*[-月/.]\s*\d{1,2}\s*日?"),
)

# 敏感关键词：命中即提示（偏「建议注意」，不一定是硬违规）。
SENSITIVE_KEYWORDS: tuple[tuple[str, str], ...] = (
    ("身份证", "身份证"),
    ("家庭住址", "家庭住址"),
    ("现住址", "现住址"),
    ("政治面貌", "政治面貌"),
    ("婚姻状况", "婚姻状况"),
    ("生育状况", "生育状况"),
    ("薪资", "薪资"),
    ("期望薪资", "期望薪资"),
    ("月薪", "月薪"),
    ("年薪", "年薪"),
)

# 出站自由文本的兜底遮罩模式（**只用于出站**，见 ``mask_outbound_text``）。
# 与上面的 ``SENSITIVE_PATTERNS`` 分开放：那一份是「识别」模式（本地风险扫描拿它
# 给用户提示"你这儿有个身份证号"），出站遮罩则要连联系方式、链接与内嵌图片一起
# 抹掉——两者的用途相反，共用一份名单会让本地提示莫名多出"邮箱"这类条目。
OUTBOUND_FREETEXT_PATTERNS: tuple[tuple[str, str], ...] = (
    # 邮箱：结构化字段由 ``redact`` 负责，这里是正文里写死的联系方式兜底。
    ("邮箱", r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+"),
    # 链接与内嵌资源：``data:`` URI 里是 base64 的照片/附件（体积大且是个人资料），
    # http(s) 链接可能是内部系统地址；远端风险复核不需要它们。
    ("链接", r"(?:https?|ftp)://[^\s\"'<>()\[\]]+"),
    ("内嵌数据", r"data:[^\s\"'<>()\[\]]+"),
)


def mask_outbound_text(text: str) -> str:
    """出站自由文本的统一兜底遮罩（全仓库唯一实现）。

    依次抹掉：邮箱、链接/内嵌 data URI、``SENSITIVE_PATTERNS``（身份证号/银行卡号/
    精确出生日期）与 7 位以上长数字串（手机号/证件号/编号）。**只用于将要离开本机
    的文本**：本地扫描必须保留原文才能发现敏感项，所以在源头不能遮。

    遮罩不等于可证明的匿名化——任意自由文本里仍可能出现没被模式覆盖的第三方信息，
    所以调用方必须先做**结构最小化**（不发原文），这里只是最后一道兜底。
    """
    # 出站文本同样只发**可见文本**：`**` 是本地排版标记，没有出站的必要。
    masked = strip_markers(text)
    for _label, pattern in (*OUTBOUND_FREETEXT_PATTERNS, *SENSITIVE_PATTERNS):
        masked = re.sub(pattern, MASK, masked)
    return re.sub(r"\d{7,}", MASK, masked)


# 合规/保密风险词（R-09 与 R-17 共用）：命中提示可能涉及未公开 / 保密信息。
COMPLIANCE_KEYWORDS: tuple[str, ...] = (
    "保密协议",
    "保密项目",
    "涉密",
    "机密",
    "绝密",
    "商业机密",
    "内部数据",
    "未公开",
    "未发布",
    "未上线",
    "客户名单",
    "核心算法",
    "竞品数据",
    "NDA",
)


__all__ = [
    "COMPLIANCE_KEYWORDS",
    "MASK",
    "OUTBOUND_FREETEXT_PATTERNS",
    "RedactionOptions",
    "SENSITIVE_KEYWORDS",
    "SENSITIVE_PATTERNS",
    "mask_outbound_text",
    "plain_text_document",
    "redact",
    "redact_document",
]
