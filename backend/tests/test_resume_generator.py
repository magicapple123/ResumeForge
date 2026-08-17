"""简历生成核心流程测试（使用假 Provider，不发起真实网络请求）。"""
import json

import pytest

from app.schemas.job import JobOut
from app.schemas.profile import ProfileOut
from app.schemas.resume import GenerateOptions
from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider
from app.services.resume_generator import (
    ResumeGenerator,
    build_profile_prompt_data,
    check_consistency,
    coerce_resume,
    extract_json,
    split_commas,
    split_lines,
)

PHOTO_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl2kAAAAASUVORK5CYII="
)

# 一份符合要求的模型输出示例
GOOD_RESUME = {
    "name": "张三",
    "gender": "男",
    "birth_year": "2004",
    "phone": "13800000000",
    "email": "zhangsan@example.com",
    "city": "天津",
    "job_intent": "后端开发工程师",
    "summary": "计算机专业应届生，具备扎实的工程能力。",
    "education": [
        {
            "school": "天津工业大学",
            "major": "软件工程",
            "degree": "本科",
            "start_date": "2022.09",
            "end_date": "2026.06",
            "gpa": "3.8/4.0",
            "courses": ["数据结构", "操作系统"],
            "achievements": ["获校级奖学金"],
        }
    ],
    "experience": [
        {
            "company": "某科技公司",
            "role": "后端实习生",
            "start_date": "2025.06",
            "end_date": "2025.09",
            "description": ["负责 XX 服务开发，性能提升 30%"],
        }
    ],
    "projects": [
        {
            "name": "简历通",
            "role": "核心开发",
            "start_date": "2025.09",
            "end_date": "2026.08",
            "tech_stack": ["Python", "FastAPI", "React"],
            "description": ["AI 定制化简历生成平台"],
            "highlights": ["开源项目，已开源"],
        }
    ],
    "skills": [{"name": "Python", "level": "熟练"}],
    "awards": [{"name": "校级奖学金", "date": "2024.10", "description": ""}],
}


class FakeProvider(BaseLLMProvider):
    """按脚本回放的假模型：stream 文本可选分块，chat 依次返回队列内容。"""

    def __init__(self, stream_text: str = "", chat_replies: list[str] | None = None, chunk_size: int = 40):
        super().__init__(LLMConfig(base_url="http://fake", api_key="k", model="fake-model"))
        self.stream_text = stream_text
        self.chat_replies = chat_replies or []
        self.chunk_size = chunk_size

    async def chat(self, messages):
        if not self.chat_replies:
            raise AssertionError("FakeProvider 没有可用的 chat 回复")
        return self.chat_replies.pop(0)

    async def stream_chat(self, messages):
        for i in range(0, len(self.stream_text), self.chunk_size):
            yield self.stream_text[i : i + self.chunk_size]


def make_profile(**overrides) -> ProfileOut:
    data = {
        "id": 1,
        "name": "张三",
        "email": "zhangsan@example.com",
        "educations": [{"id": 1, "school": "天津工业大学", "major": "软件工程", "degree": "本科"}],
        "experiences": [{"id": 1, "company": "某科技公司", "role": "后端实习生"}],
        "projects": [{"id": 1, "name": "简历通", "tech_stack": "Python, FastAPI", "description": "AI 简历平台"}],
        "skills": [{"id": 1, "name": "Python", "level": "熟练"}],
        "awards": [],
        **overrides,
    }
    return ProfileOut.model_validate(data)


def make_job() -> JobOut:
    from datetime import datetime

    now = datetime.now()
    return JobOut.model_validate(
        {
            "id": 1,
            "title": "后端开发工程师",
            "company": "示例公司",
            "location": "北京",
            "description": "负责后端服务开发",
            "created_at": now,
            "updated_at": now,
        }
    )


async def collect_events(generator):
    return [event async for event in generator]


async def test_generate_success_stream_and_parse():
    provider = FakeProvider(stream_text=json.dumps(GOOD_RESUME, ensure_ascii=False), chunk_size=25)
    generator = ResumeGenerator(provider)
    events = await collect_events(generator.generate(make_profile(), make_job(), GenerateOptions()))
    types = [event["type"] for event in events]
    assert "progress" in types and "delta" in types and "done" in types
    done = next(event for event in events if event["type"] == "done")
    assert done["resume"]["name"] == "张三"
    assert done["resume"]["education"][0]["school"] == "天津工业大学"
    assert done["warnings"] == []


async def test_generate_injects_profile_photo_without_sending_it_to_llm():
    profile = make_profile(photo=PHOTO_DATA_URL)
    prompt_data = build_profile_prompt_data(profile)
    provider = FakeProvider(stream_text=json.dumps(GOOD_RESUME, ensure_ascii=False))

    events = await collect_events(ResumeGenerator(provider).generate(profile, make_job(), GenerateOptions()))
    done = next(event for event in events if event["type"] == "done")

    assert "photo" not in prompt_data
    assert PHOTO_DATA_URL not in json.dumps(prompt_data, ensure_ascii=False)
    assert done["resume"]["photo"] == PHOTO_DATA_URL


async def test_generate_repairs_broken_json_once():
    # 首次流式输出不是 JSON，修复对话返回合法 JSON
    provider = FakeProvider(
        stream_text="抱歉，我无法生成：xxx",
        chat_replies=[json.dumps(GOOD_RESUME, ensure_ascii=False)],
    )
    events = await collect_events(ResumeGenerator(provider).generate(make_profile(), make_job(), GenerateOptions()))
    done = next(event for event in events if event["type"] == "done")
    assert done["resume"]["name"] == "张三"


async def test_generate_fails_gracefully():
    provider = FakeProvider(stream_text="彻底乱码", chat_replies=["仍然乱码"])
    events = await collect_events(ResumeGenerator(provider).generate(make_profile(), make_job(), GenerateOptions()))
    assert events[-1]["type"] == "error"
    assert "JSON" in events[-1]["message"]


async def test_generate_uses_tone_guide():
    provider = FakeProvider(stream_text=json.dumps(GOOD_RESUME, ensure_ascii=False))
    events = await collect_events(
        ResumeGenerator(provider).generate(make_profile(), make_job(), GenerateOptions(tone="tech"))
    )
    assert events[-1]["type"] == "done"


def test_extract_json_tolerates_wrappers():
    assert extract_json("```json\n{\"a\": 1}\n```") == {"a": 1}
    assert extract_json("前置说明 {\"a\": 1} 后置说明") == {"a": 1}
    assert extract_json("{\"resume\": {\"a\": 1}}") == {"a": 1}
    assert extract_json("") is None
    assert extract_json("没有任何花括号") is None


def test_coerce_resume_fills_defaults():
    resume = coerce_resume({"name": "李四", "education": [{"school": "某大学", "courses": "数学\n英语"}]})
    assert resume.name == "李四"
    assert resume.summary == ""
    assert resume.education[0].courses == ["数学", "英语"]
    assert resume.projects == []
    assert coerce_resume({"photo": PHOTO_DATA_URL}).photo == ""  # 不信任模型回传的照片


def test_coerce_resume_handles_garbage():
    resume = coerce_resume(None)
    assert resume.name == "" and resume.skills == []
    resume = coerce_resume({"education": "不是列表", "projects": [123]})
    assert resume.education == [] and resume.projects == []


def test_check_consistency_detects_hallucination():
    resume = coerce_resume(
        {
            "education": [{"school": "北京大学"}],  # 资料里没有
            "experience": [{"company": "某科技公司"}],  # 资料里有
            "projects": [{"name": "简历通（开源项目）"}],  # 轻度改写，应视为一致
        }
    )
    warnings = check_consistency(resume, make_profile())
    assert len(warnings) == 1
    assert "北京大学" in warnings[0]


def test_split_helpers():
    assert split_lines("第一行\n第二行\n\n第三行\n") == ["第一行", "第二行", "第三行"]
    assert split_commas("Python, FastAPI、React") == ["Python", "FastAPI", "React"]
