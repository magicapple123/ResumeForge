"""简历生成核心流程。

职责：拼装 Prompt -> 调用 LLM（流式）-> 解析/校验 JSON -> 一致性检查。
对外只产出异步事件流（dict），由 API 层负责转发为 SSE 与落库，
本模块不直接接触数据库，保持可单测。
"""
import json
import re
from collections.abc import AsyncIterator
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from ..schemas.job import JobOut
from ..schemas.profile import ProfileOut
from ..schemas.resume import GenerateOptions, ResumeContent
from .llm.base import BaseLLMProvider, LLMError

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"

# 防止超长文本撑爆上下文窗口（JD 与资料分别截断）
MAX_JD_CHARS = 8000
MAX_PROFILE_CHARS = 12000

# 不同定制风格对应的指令，与前端 GenerateOptions.tone 一一对应
TONE_GUIDES = {
    "standard": "综合均衡型：教育背景、实习经历、项目经历、技能均衡呈现，适合大多数岗位。",
    "tech": "技术突出型：强化项目技术深度、技术栈细节与工程能力，突出解决过的技术难题，弱化与岗位无关的经历。",
    "academic": "科研算法型：突出科研/竞赛/模型训练经历，强化算法能力与论文成果，适合 AI、算法类岗位。",
}

# 简历结构中的"列表字段"，宽松校验时字符串会被拆分补全
_LIST_FIELDS = {
    "education": {"str_fields": {"school", "major", "degree", "start_date", "end_date", "gpa"},
                  "list_fields": {"courses", "achievements"}},
    "experience": {"str_fields": {"company", "role", "start_date", "end_date"},
                   "list_fields": {"description"}},
    "campus_experience": {"str_fields": {"organization", "role", "start_date", "end_date"},
                           "list_fields": {"description"}},
    "projects": {"str_fields": {"name", "role", "start_date", "end_date"},
                 "list_fields": {"tech_stack", "description", "highlights"}},
}


def split_lines(text: str) -> list[str]:
    """把换行分隔的多行文本拆成列表，过滤空行。"""
    if not text:
        return []
    return [line.strip() for line in text.splitlines() if line.strip()]


def split_commas(text: str) -> list[str]:
    """把逗号/顿号分隔的文本拆成列表。"""
    return [item.strip() for item in re.split(r"[,，、]", text) if item.strip()]


def build_profile_prompt_data(profile: ProfileOut) -> dict:
    """把资料库数据整理成喂给模型的干净结构：去掉内部 id，多行文本转数组。"""
    return {
        "name": profile.name,
        "gender": profile.gender,
        "birth_year": profile.birth_year,
        "phone": profile.phone,
        "email": profile.email,
        "city": profile.city,
        "target_city": profile.target_city,
        "job_intent": profile.job_intent,
        "personal_website": profile.personal_website,
        "github": profile.github,
        "summary": profile.summary,
        "educations": [
            {
                "school": e.school,
                "major": e.major,
                "degree": e.degree,
                "start_date": e.start_date,
                "end_date": e.end_date,
                "gpa": e.gpa,
                "courses": split_lines(e.courses),
                "achievements": split_lines(e.achievements),
            }
            for e in profile.educations
        ],
        "experiences": [
            {
                "company": e.company,
                "role": e.role,
                "start_date": e.start_date,
                "end_date": e.end_date,
                "description": split_lines(e.description),
            }
            for e in profile.experiences
        ],
        "campus_experiences": [
            {
                "organization": item.organization,
                "role": item.role,
                "start_date": item.start_date,
                "end_date": item.end_date,
                "description": split_lines(item.description),
            }
            for item in profile.campus_experiences
        ],
        "projects": [
            {
                "name": p.name,
                "role": p.role,
                "start_date": p.start_date,
                "end_date": p.end_date,
                "tech_stack": split_commas(p.tech_stack),
                "description": split_lines(p.description),
                "highlights": split_lines(p.highlights),
            }
            for p in profile.projects
        ],
        "skills": [{"name": s.name, "level": s.level} for s in profile.skills],
        "awards": [{"name": a.name, "date": a.date, "description": a.description} for a in profile.awards],
    }


def extract_json(text: str) -> dict | None:
    """从模型输出中提取 JSON 对象。

    容忍：Markdown 代码块包裹、前后杂文本、外层 {"resume": {...}} 包装。
    """
    if not text:
        return None
    cleaned = re.sub(r"```(?:json)?", "", text).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return None
    # 部分模型会额外套一层 "resume" 包装
    if isinstance(data, dict) and isinstance(data.get("resume"), dict):
        data = data["resume"]
    return data if isinstance(data, dict) else None


def _string_list(value) -> list[str]:
    """宽松转字符串数组：列表取字符串元素，字符串按行拆分，其他返回空。"""
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return split_lines(value)
    return []


def _item_list(value, str_fields: set[str], list_fields: set[str]) -> list[dict]:
    if isinstance(value, dict):
        value = [value]
    if not isinstance(value, list):
        return []
    result = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        item = {field: entry.get(field) if isinstance(entry.get(field), str) else "" for field in str_fields}
        for field in list_fields:
            item[field] = _string_list(entry.get(field))
        result.append(item)
    return result


def coerce_resume(data: dict | None) -> ResumeContent:
    """宽松校验：字段缺失补默认值、类型不对尽量修正，保证格式问题永不导致崩溃。"""
    data = data or {}

    def as_str(value) -> str:
        return value if isinstance(value, str) else ""

    sections = {}
    for section, config in _LIST_FIELDS.items():
        sections[section] = _item_list(data.get(section), config["str_fields"], config["list_fields"])
    skills = [
        {"name": item.get("name", ""), "level": item.get("level", "")}
        for item in _item_list(data.get("skills"), {"name", "level"}, set())
    ]
    awards = [
        {
            "name": item.get("name", ""),
            "date": item.get("date", ""),
            "description": item.get("description", ""),
        }
        for item in _item_list(data.get("awards"), {"name", "date", "description"}, set())
    ]
    return ResumeContent(
        name=as_str(data.get("name")),
        gender=as_str(data.get("gender")),
        birth_year=as_str(data.get("birth_year")),
        phone=as_str(data.get("phone")),
        email=as_str(data.get("email")),
        city=as_str(data.get("city")),
        job_intent=as_str(data.get("job_intent")),
        summary=as_str(data.get("summary")),
        education=sections["education"],
        experience=sections["experience"],
        campus_experience=sections["campus_experience"],
        projects=sections["projects"],
        skills=skills,
        awards=awards,
    )


def _similar(a: str, b: str) -> bool:
    """双向包含判断，容忍模型对名称的轻度改写（如「XX大学（双一流）」）。"""
    return a in b or b in a


def check_consistency(resume: ResumeContent, profile: ProfileOut) -> list[str]:
    """校验生成结果是否出现资料中不存在的信息（防 AI 虚构）。

    仅当资料中已有对应条目时才比对；空值条目不参与检查。
    """
    warnings: list[str] = []
    known_schools = [e.school for e in profile.educations if e.school]
    known_companies = [e.company for e in profile.experiences if e.company]
    known_campus_organizations = [
        item.organization for item in profile.campus_experiences if item.organization
    ]
    known_projects = [p.name for p in profile.projects if p.name]

    for edu in resume.education:
        if edu.school and not any(_similar(edu.school, s) for s in known_schools):
            warnings.append(f"教育经历中出现资料中不存在的学校「{edu.school}」，请核对是否为虚构")
    for exp in resume.experience:
        if exp.company and not any(_similar(exp.company, c) for c in known_companies):
            warnings.append(f"实习/工作经历中出现资料中不存在的公司「{exp.company}」，请核对是否为虚构")
    for item in resume.campus_experience:
        if item.organization and not any(
            _similar(item.organization, organization) for organization in known_campus_organizations
        ):
            warnings.append(f"校园经历中出现资料中不存在的组织「{item.organization}」，请核对是否为虚构")
    for project in resume.projects:
        if project.name and not any(_similar(project.name, p) for p in known_projects):
            warnings.append(f"项目经历中出现资料中不存在的项目「{project.name}」，请核对是否为虚构")
    return warnings


class ResumeGenerator:
    """简历生成器：一次生成 = 一条事件流。"""

    def __init__(self, provider: BaseLLMProvider):
        self.provider = provider
        # StrictUndefined：模板变量缺失时立即报错，而不是静默渲染成空
        self._env = Environment(
            loader=FileSystemLoader(PROMPTS_DIR),
            undefined=StrictUndefined,
            autoescape=False,  # Prompt 是纯文本，无需转义
        )

    async def generate(
        self, profile: ProfileOut, job: JobOut, options: GenerateOptions
    ) -> AsyncIterator[dict]:
        """执行生成流程，依次产出事件。

        事件类型：
        - progress: {"type", "message"}   阶段提示
        - delta:    {"type", "text"}      模型流式输出片段
        - done:     {"type", "resume", "warnings"}  解析成功
        - error:    {"type", "message"}   失败（友好提示，由 API 层直接转发）
        """
        profile_data = build_profile_prompt_data(profile)
        tone_guide = TONE_GUIDES.get(options.tone, TONE_GUIDES["standard"])

        yield {"type": "progress", "message": "正在准备生成材料…"}
        system_prompt = self._load_prompt("resume_generate_system.md")
        user_prompt = self._env.get_template("resume_generate_user.md").render(
            profile_json=json.dumps(profile_data, ensure_ascii=False, indent=2)[:MAX_PROFILE_CHARS],
            job=job,
            jd=f"{job.description}\n{job.requirements}".strip()[:MAX_JD_CHARS],
            tone_guide=tone_guide,
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        yield {"type": "progress", "message": f"正在调用模型 {self.provider.config.model} 生成简历…"}
        parts: list[str] = []
        async for delta in self.provider.stream_chat(messages):
            parts.append(delta)
            yield {"type": "delta", "text": delta}

        raw = "".join(parts)
        resume = self._parse(raw)

        # 输出不是合法 JSON：用修复 Prompt 重试一次，仍然失败则降级报错
        if resume is None:
            yield {"type": "progress", "message": "输出格式不符合要求，正在自动修复…"}
            fix_prompt = self._env.get_template("resume_fix_json.md").render(raw=raw[:6000])
            try:
                fixed = await self.provider.chat([{"role": "user", "content": fix_prompt}])
            except LLMError as exc:
                yield {"type": "error", "message": f"自动修复调用失败：{exc}"}
                return
            resume = self._parse(fixed)

        if resume is None:
            yield {"type": "error", "message": "模型输出未能解析为有效 JSON，请更换模型或重试"}
            return

        # 照片不发送给 LLM，避免无意义地占用上下文；解析完成后从已校验资料注入。
        resume = resume.model_copy(update={"photo": profile.photo})
        warnings = check_consistency(resume, profile)
        yield {"type": "done", "resume": resume.model_dump(), "warnings": warnings}

    def _parse(self, raw: str) -> ResumeContent | None:
        data = extract_json(raw)
        return coerce_resume(data) if data is not None else None

    def _load_prompt(self, filename: str) -> str:
        """从 prompts/ 目录加载模板文件（模板集中管理，方便调参）。"""
        return (PROMPTS_DIR / filename).read_text(encoding="utf-8")
