# SPDX-License-Identifier: Apache-2.0
"""字段值归一与保守推断（#17C/17D/17E 的唯一实现）。

这些规则决定「写进数据库的值长什么样」，所以只放在一处：列表抽取、详情抽取、模型兜底
三路结果最后都过同一套归一，否则同一个页面在预览里和在库里会显示成两种东西。

- posted_at：只落 YYYY-MM-DD（表单是 DatePicker，存「3天前」会变 Invalid Date）；
  相对日期按**抓取日**换算并回报「按抓取日推算」；
- job_type / status：页面明确写才用，否则按 URL 频道保守推断并标 inferred；
  **绝不抓「已投递」**——那是本地状态，不是页面信息；
- JD 切分：只有页面出现明确小标题才切职责/要求，没有小标题整段进 description，
  requirements 留空（不自己造标题）。
"""

from __future__ import annotations

import re
from datetime import date, timedelta

#: 写库字段的长度上限（与 schemas.job.JobCreate 一致）。超长截断而不是报错：
#: 页面里的标题偶尔带整段筛选条件，截断比整条导入失败更合理。
FIELD_LIMITS = {
    "title": 128,
    "company": 128,
    "location": 64,
    "salary": 64,
    "job_type": 32,
    "status": 16,
    "source_url": 512,
    "posted_at": 32,
    "origin_source": 64,
}
#: 本模块归一涉及的全部可写字段（其余字段由表单/用户维护，不在这里截断）。
WRITABLE_FIELDS = (
    "title",
    "company",
    "location",
    "salary",
    "job_type",
    "status",
    "source_url",
    "posted_at",
    "description",
    "requirements",
    "additional_info",
    "origin_source",
)
#: 详情页才有的字段（17A 阶段二的目标）。
DETAIL_FIELDS = ("description", "requirements", "additional_info", "status")
#: 四态（17B）：只有 filled 会被写库。
FILLED = "filled"
NOT_ON_PAGE = "not_on_page"
NOT_FETCHED = "not_fetched"
FETCH_FAILED = "fetch_failed"
FIELD_STATES = (FILLED, NOT_ON_PAGE, NOT_FETCHED, FETCH_FAILED)

#: 职位类型的显式关键词（页面写了才用）。
_JOB_TYPE_KEYWORDS = (
    ("校招", ("校招", "校园招聘", "应届生", "应届", "2026届", "2027届")),
    ("实习", ("实习", "intern", "Intern")),
    ("社招", ("社招", "社会招聘")),
)
_CAMPUS_URL_MARKERS = ("/campus", "/campus/", "campus.", "/xiaozhao", "/graduate")
_CLOSED_MARKERS = ("已截止", "停止招聘", "已下线", "招聘结束", "职位关闭")

#: 明确小标题（只在整行匹配时才算标题，避免正文里的"要求：…"被误当段落边界）。
_DESCRIPTION_HEADINGS = (
    "岗位职责",
    "工作职责",
    "职位描述",
    "岗位描述",
    "工作内容",
    "你将做什么",
    "主要职责",
    "职责描述",
    "工作职责描述",
    "岗位工作内容",
)
_REQUIREMENTS_HEADINGS = (
    "任职要求",
    "职位要求",
    "任职资格",
    "岗位要求",
    "能力要求",
    "应聘条件",
    "我们希望你",
    "我们希望您",
    "任职条件",
    "职位需求",
    "岗位条件",
)
_ADDITIONAL_HEADINGS = (
    "福利待遇",
    "薪资福利",
    "福利",
    "招聘流程",
    "投递说明",
    "投递方式",
    "工作地点补充",
    "其他信息",
    "其他说明",
    "招聘说明",
)
_HEADING_RE = re.compile(
    r"^[\s【\[（(]*(?:[一二三四五六七八九十]+[、.．]|\d+[、.．)）]|\d+\.\d+)?[\s】\]）)]*"
)


def clean_text(value: str) -> str:
    """折叠空白，去掉控制字符；保留中文标点与换行（JD 分段要保留）。"""
    if not value:
        return ""
    lines = [re.sub(r"[ \t\r\f\v\u3000]+", " ", line).strip() for line in value.splitlines()]
    return "\n".join(line for line in lines if line)


def clip_field(field: str, value: str) -> str:
    limit = FIELD_LIMITS.get(field)
    text = (value or "").strip()
    return text if limit is None else text[:limit]


def _parse_date(raw: str) -> date | None:
    for pattern in (
        r"(?P<y>\d{4})-(?P<m>\d{1,2})-(?P<d>\d{1,2})",
        r"(?P<y>\d{4})/(?P<m>\d{1,2})/(?P<d>\d{1,2})",
        r"(?P<y>\d{4})\.(?P<m>\d{1,2})\.(?P<d>\d{1,2})",
        r"(?P<y>\d{4})年(?P<m>\d{1,2})月(?P<d>\d{1,2})日?",
    ):
        match = re.search(pattern, raw or "")
        if not match:
            continue
        try:
            parsed = date(int(match.group("y")), int(match.group("m")), int(match.group("d")))
        except ValueError:
            return None
        return parsed if 1990 <= parsed.year <= 2100 else None
    return None


def normalize_posted_at(raw: str, *, fetched_on: str) -> tuple[str, bool]:
    """把页面上的发布时间归一成 YYYY-MM-DD。

    返回 (日期, 是否按抓取日推算)。无法解析时返回 ("", False)——原文只在预览里展示，
    不落库（posted_at 只有 32 字符、表单还是日期控件）。
    """
    text = clean_text(raw or "")
    if not text:
        return "", False
    absolute = _parse_date(text)
    if absolute is not None:
        return absolute.isoformat(), False
    try:
        anchor = date.fromisoformat(fetched_on)
    except ValueError:
        anchor = date.today()
    match = re.search(r"(\d{1,3})\s*天前", text)
    if match:
        return (anchor - timedelta(days=int(match.group(1)))).isoformat(), True
    match = re.search(r"(\d{1,3})\s*周前", text)
    if match:
        return (anchor - timedelta(weeks=int(match.group(1)))).isoformat(), True
    match = re.search(r"(\d{1,3})\s*个月前", text)
    if match:
        return (anchor - timedelta(days=30 * int(match.group(1)))).isoformat(), True
    if re.search(r"刚刚|今天|今日|本日|\d+\s*小时前|\d+\s*分钟前", text):
        return anchor.isoformat(), True
    if "昨天" in text or "昨日" in text:
        return (anchor - timedelta(days=1)).isoformat(), True
    if "前天" in text:
        return (anchor - timedelta(days=2)).isoformat(), True
    if re.search(r"本周|这周|近一周|一周内", text):
        return anchor.isoformat(), True
    return "", False


def infer_job_type(*, page_url: str, text: str) -> tuple[str, bool]:
    """保守推断岗位类型：页面明确写就用，否则校招频道按站点推断，其余「其他」。"""
    haystack = text or ""
    for value, keywords in _JOB_TYPE_KEYWORDS:
        if any(keyword and keyword in haystack for keyword in keywords):
            return value, False
    lowered = (page_url or "").lower()
    if any(marker in lowered for marker in _CAMPUS_URL_MARKERS):
        return "校招", True
    return "其他", False


def infer_status(text: str) -> str:
    """状态默认开放中；页面出现截止/下线字样才是已截止。**永远不返回「已投递」**。"""
    haystack = text or ""
    return "已截止" if any(marker in haystack for marker in _CLOSED_MARKERS) else "开放中"


def _heading_of(line: str) -> str:
    """整行是段落标题时返回类别（description/requirements/additional），否则空串。"""
    bare = _HEADING_RE.sub("", clean_text(line)).strip().rstrip(":：")
    for heading in _DESCRIPTION_HEADINGS:
        if bare == heading or bare.startswith(heading):
            return "description"
    for heading in _REQUIREMENTS_HEADINGS:
        if bare == heading or bare.startswith(heading):
            return "requirements"
    for heading in _ADDITIONAL_HEADINGS:
        if bare == heading or bare.startswith(heading):
            return "additional"
    return ""


def split_jd_sections(text: str) -> dict[str, object]:
    """按明确小标题切分 JD；没有小标题时整段进 description。

    返回 {"description", "requirements", "additional_info", "split"}。split=False 表示
    页面没有可用的职责/要求小标题——预览要据此显示「未区分职责/要求」，且绝不二次推断。
    """
    lines = clean_text(text).splitlines()
    description_lines: list[str] = []
    requirements_lines: list[str] = []
    additional_lines: list[str] = []
    preamble: list[str] = []  # 第一个小标题之前的行（通常是岗位名/公司/地点）
    other_lines: list[str] = []  # 只有单边小标题时，无法归类但也不能丢的正文
    current = "preamble"
    has_requirements_heading = False
    has_description_heading = False
    for line in lines:
        heading = _heading_of(line)
        if heading:
            current = heading
            has_requirements_heading = has_requirements_heading or heading == "requirements"
            has_description_heading = has_description_heading or heading == "description"
            continue
        if current == "description":
            description_lines.append(line)
        elif current == "requirements":
            requirements_lines.append(line)
        elif current == "additional":
            additional_lines.append(line)
        elif current == "preamble":
            preamble.append(line)
        else:
            other_lines.append(line)
    if not (has_requirements_heading and has_description_heading):
        # 没有成对的职责/要求小标题：不切分。additional 小标题仍然可以单独拎出来
        # （福利/流程/投递说明本来就是独立段落）。
        description = [*preamble, *other_lines, *description_lines, *requirements_lines]
        return {
            "description": "\n".join(description).strip(),
            "requirements": "",
            "additional_info": "\n".join(additional_lines).strip(),
            "split": False,
        }
    return {
        "description": "\n".join([*preamble, *description_lines]).strip(),
        "requirements": "\n".join(requirements_lines).strip(),
        "additional_info": "\n".join(additional_lines).strip(),
        "split": True,
    }


def normalize_row_fields(
    data: dict[str, str], *, page_url: str, page_text: str, fetched_on: str
) -> dict[str, str]:
    """对一行抽取结果做统一归一（截断、日期、类型、状态）。"""
    normalized: dict[str, str] = {}
    for field in WRITABLE_FIELDS:
        value = (data.get(field) or "").strip()
        if not value:
            continue
        if field == "posted_at":
            value, _ = normalize_posted_at(value, fetched_on=fetched_on)
        elif field == "job_type":
            value, _ = infer_job_type(page_url=page_url, text=value)
        elif field == "status":
            value = infer_status(value)
        normalized[field] = clip_field(field, value)
    for field in ("description", "requirements", "additional_info"):
        value = (data.get(field) or "").strip()
        if value:
            normalized[field] = value
    return normalized


def summary_of(text: str, *, limit: int = 120) -> str:
    """原文摘要（≤120 字）：预览里每行都要显示，它是防幻觉最有效的一招。"""
    compact = re.sub(r"\s+", " ", text or "").strip()
    return compact[:limit]


#: 对外暴露「这一行是不是段落小标题」的判定（详情页主内容裁剪要用同一份）。
heading_kind = _heading_of

__all__ = [
    "DETAIL_FIELDS",
    "FETCH_FAILED",
    "heading_kind",
    "FIELD_LIMITS",
    "FIELD_STATES",
    "FILLED",
    "NOT_FETCHED",
    "NOT_ON_PAGE",
    "WRITABLE_FIELDS",
    "clean_text",
    "clip_field",
    "infer_job_type",
    "infer_status",
    "normalize_posted_at",
    "normalize_row_fields",
    "split_jd_sections",
    "summary_of",
]
