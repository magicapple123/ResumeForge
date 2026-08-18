"""根据已保存简历与目标岗位 JD 生成可核对的修改建议。"""
import json
import logging
import re
from pathlib import Path

from ..schemas.job import JobOut
from ..schemas.profile import ProfileOut
from ..schemas.resume import ResumeContent, ResumeSuggestion
from .llm.base import BaseLLMProvider, LLMError
from .profile_relevance import build_job_prompt_text, build_profile_prompt_data

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
MAX_RESUME_CHARS = 12_000
MAX_PROFILE_CHARS = 24_000
MAX_JD_CHARS = 6_000
MAX_SUGGESTIONS = 8
_FALSE_PROJECT_ABSENCE_RE = re.compile(
    r"(?:没有|无|缺少|缺乏|未有|未体现|未展示|未呈现|不存在).{0,16}(?:项目经历|项目经验|相关项目|项目)|"
    r"(?:项目经历|项目经验|相关项目).{0,8}(?:为空|缺失|不存在)",
    re.IGNORECASE,
)

logger = logging.getLogger(__name__)


def _extract_json(text: str) -> object | None:
    """容忍模型的 Markdown 包裹与少量前后说明，提取第一个 JSON 值。"""
    if not text:
        return None
    cleaned = re.sub(r"```(?:json)?", "", text, flags=re.IGNORECASE).strip()
    starts = [index for index in (cleaned.find("{"), cleaned.find("[")) if index >= 0]
    if not starts:
        return None
    start = min(starts)
    end = max(cleaned.rfind("}"), cleaned.rfind("]"))
    if end <= start:
        return None
    try:
        return json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return None


def parse_suggestions(raw: str) -> list[ResumeSuggestion]:
    """将模型输出收敛为前端可直接展示的建议列表。"""
    data = _extract_json(raw)
    if isinstance(data, dict):
        data = data.get("suggestions", [])
    if not isinstance(data, list):
        raise LLMError("模型未返回有效的修改建议，请稍后重试")

    result: list[ResumeSuggestion] = []
    for item in data[:MAX_SUGGESTIONS]:
        if not isinstance(item, dict):
            continue
        priority = item.get("priority")
        if priority not in {"high", "medium", "low"}:
            priority = "medium"
        evidence = item.get("evidence", [])
        if isinstance(evidence, str):
            evidence = [evidence]
        if not isinstance(evidence, list):
            evidence = []
        suggestion = ResumeSuggestion(
            priority=priority,
            section=str(item.get("section") or "").strip(),
            issue=str(item.get("issue") or "").strip(),
            suggestion=str(item.get("suggestion") or "").strip(),
            evidence=[str(value).strip() for value in evidence if str(value).strip()][:4],
        )
        if suggestion.issue and suggestion.suggestion:
            result.append(suggestion)
    return result


def _load_prompt() -> str:
    return (PROMPTS_DIR / "resume_suggestions.md").read_text(encoding="utf-8")


def _protect_existing_project_facts(
    suggestions: list[ResumeSuggestion], profile: ProfileOut
) -> list[ResumeSuggestion]:
    """防止模型把简历省略的项目误判成用户没有项目经历。"""
    if not profile.projects:
        return suggestions

    project_names = [item.name.strip() for item in profile.projects if item.name.strip()]
    result: list[ResumeSuggestion] = []
    for item in suggestions:
        combined = f"{item.issue} {item.suggestion}"
        if _FALSE_PROJECT_ABSENCE_RE.search(combined):
            evidence = list(dict.fromkeys([*item.evidence, *project_names[:3]]))
            item = item.model_copy(
                update={
                    "section": "项目经历",
                    "issue": "个人资料中已有项目经历，但当前简历没有充分呈现",
                    "suggestion": "从个人资料已有项目中挑选与岗位最相关的项目，并补充真实的职责、技术栈和成果；不要新增资料中不存在的经历。",
                    "evidence": evidence[:4],
                }
            )
        result.append(item)
    return result


async def generate_suggestions(
    provider: BaseLLMProvider,
    resume: ResumeContent,
    job: JobOut,
    profile: ProfileOut,
) -> list[ResumeSuggestion]:
    """调用一次非流式模型，生成仅基于已有事实的岗位适配建议。"""
    resume_json = json.dumps(resume.model_dump(exclude_none=True), ensure_ascii=False)
    profile_data = build_profile_prompt_data(profile)
    # 项目和经历放在前面，长总结被截断时也必须保留可核对的项目事实。
    profile_data = {
        "projects": profile_data["projects"],
        "experiences": profile_data["experiences"],
        "campus_experiences": profile_data["campus_experiences"],
        "educations": profile_data["educations"],
        "skills": profile_data["skills"],
        "awards": profile_data["awards"],
        "summary": profile_data["summary"],
        "basic_info": {
            key: profile_data[key]
            for key in ("name", "job_intent", "city", "target_city", "github", "personal_website")
        },
    }
    profile_json = json.dumps(profile_data, ensure_ascii=False)
    prompt = _load_prompt().replace("{{ resume_json }}", resume_json[:MAX_RESUME_CHARS]).replace(
        "{{ job_title }}", job.title
    ).replace("{{ company }}", job.company or "-").replace(
        "{{ jd }}", build_job_prompt_text(job, MAX_JD_CHARS)
    ).replace("{{ profile_json }}", profile_json[:MAX_PROFILE_CHARS])
    raw = await provider.chat(
        [
            {"role": "system", "content": "你是严谨的中文简历审核助手，只输出 JSON。"},
            {"role": "user", "content": prompt},
        ]
    )
    suggestions = _protect_existing_project_facts(parse_suggestions(raw), profile)
    logger.info("简历岗位建议生成完成 job_id=%s count=%s", job.id, len(suggestions))
    return suggestions
