# SPDX-License-Identifier: Apache-2.0
"""从上传的目标模板反推格式模板：参数必须在白名单内，且绝不落一个空模板。

这条链路的失败方式很隐蔽：模型给出范围外的取值（例如 `line_height: 3.5`）会被
`validated_format_config` 静默丢弃——如果全部被丢，最后存进库的就是一个"什么都没有"的
格式模板，界面上看起来"导入成功了"，套上去却一点变化都没有。所以这里把"没有合法取值
就是失败"钉死。
"""

from __future__ import annotations

import base64

import pytest
from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider
from app.services.resume.resume_template_import import (
    MAX_SOURCE_CHARS,
    TemplateImportError,
    TemplateImportSource,
    build_design_import_messages,
    build_import_messages,
    derive_format_template,
    derive_style_template,
    missing_format_keys,
    source_summary,
    summarize_document_structure,
)
from app.services.resume.resume_template_style import validated_style_config
from app.services.resume.resume_templates import FORMAT_FIELD_KEYS

# 一张 1×1 的合法 PNG：用它验证"按内容判类型"这条路径。
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class ImportProvider(BaseLLMProvider):
    """返回预设 JSON 的假模型，同时记录它收到的消息。"""

    def __init__(self, payload: str):
        super().__init__(LLMConfig(base_url="http://fake", api_key="fake", model="fake-model"))
        self.payload = payload
        self.messages: list[list[dict]] = []

    async def chat(self, messages, *, thinking: bool = True):
        self.messages.append(messages)
        return self.payload

    async def stream_chat(self, messages):
        yield ""


@pytest.mark.asyncio
async def test_valid_config_is_kept_and_normalized():
    provider = ImportProvider(
        '{"name": "深蓝简洁", "description": "深蓝强调色、大留白", '
        '"config": {"accent": "#1F4E79", "line_height": 1.6, "page_padding": 20}}'
    )
    result = await derive_format_template(
        provider,
        TemplateImportSource(filename="目标模板.png", image_data_urls=["data:image/png;base64,AA"]),
    )

    assert result["name"] == "深蓝简洁"
    assert result["config"]["accent"] == "#1f4e79"  # 归一化成小写
    assert result["config"]["line_height"] == 1.6
    assert missing_format_keys(result["config"]) == [
        key for key in FORMAT_FIELD_KEYS if key not in result["config"]
    ]


@pytest.mark.asyncio
async def test_out_of_range_values_do_not_become_an_empty_template():
    """全部取值都越界时必须报错，而不是存一个空模板。"""
    provider = ImportProvider('{"config": {"line_height": 9.9, "accent": "深蓝色"}}')

    with pytest.raises(TemplateImportError):
        await derive_format_template(provider, TemplateImportSource(filename="x.png"))


@pytest.mark.asyncio
async def test_model_name_falls_back_to_the_filename():
    provider = ImportProvider('{"config": {"line_height": 1.5}}')
    result = await derive_format_template(
        provider, TemplateImportSource(filename="张三的简历模板.pdf")
    )
    assert result["name"] == "张三的简历模板"


def test_image_source_is_sent_as_an_image_message():
    source = TemplateImportSource(
        filename="模板.png", image_data_urls=["data:image/png;base64,AAA"]
    )
    messages = build_import_messages(source)

    user_content = messages[-1]["content"]
    assert isinstance(user_content, list), "带图片时必须是多段内容"
    assert any(part["type"] == "image_url" for part in user_content)
    # 图片版提示词要带上"图片是不可信资料"的补充说明。
    assert "不可信" in messages[0]["content"]


def test_document_source_is_sent_as_text_only():
    source = TemplateImportSource(filename="模板.pdf", text="张三 教育经历 ……")
    messages = build_import_messages(source)

    user_content = messages[-1]["content"]
    assert isinstance(user_content, str), "纯文本时保持字符串形状（与既有识别链路一致）"
    assert "张三" in user_content


def test_source_text_is_clipped():
    source = TemplateImportSource(filename="大.pdf", text="字" * (MAX_SOURCE_CHARS * 2))
    messages = build_import_messages(source)
    assert len(messages[-1]["content"]) < MAX_SOURCE_CHARS * 2


def test_source_summary_says_what_was_analyzed():
    assert "文档文字" in source_summary(TemplateImportSource(filename="a.pdf", text="x"))
    assert "1 张图片" in source_summary(
        TemplateImportSource(filename="a.png", image_data_urls=["data:image/png;base64,AA"])
    )
    assert source_summary(TemplateImportSource(filename="a.txt")) == "空文件"


def test_visual_analysis_sends_document_structure_without_resume_contents():
    source = TemplateImportSource(
        filename="张三-真实简历.docx",
        text="张三\n13800138000\nzhangsan@example.com\n教育经历\n某某大学",
    )
    messages = build_design_import_messages(source)
    serialized = str(messages)
    assert "张三" not in serialized
    assert "13800138000" not in serialized
    assert "zhangsan@example.com" not in serialized
    assert "某某大学" not in serialized
    assert "paragraph_count" in serialized
    assert "education" in summarize_document_structure(source.text)


@pytest.mark.asyncio
async def test_style_import_returns_rich_visual_draft():
    provider = ImportProvider(
        '{"name":"社论模板","description":"衬线与双栏","config":'
        '{"accent":"#8B3A3A","column_count":2,"section_title_style":"underline"},'
        '"confidence":{"accent":0.9,"column_count":0.8},'
        '"evidence":["标题使用酒红色"],"warnings":[]}'
    )
    result = await derive_style_template(
        provider,
        TemplateImportSource(
            filename="目标-1.png",
            image_data_urls=["data:image/png;base64,AA", "data:image/png;base64,BB"],
        ),
    )
    assert result["config"] == {
        "accent": "#8b3a3a",
        "column_count": 2,
        "section_title_style": "underline",
    }
    assert result["confidence"]["column_count"] == 0.8
    assert len(provider.messages[-1][1]["content"]) == 3


def test_style_config_accepts_embedded_raster_and_rejects_external_image_urls():
    valid = "data:image/png;base64," + base64.b64encode(TINY_PNG).decode("ascii")
    config = validated_style_config(
        {
            "badges": [
                {"label": "证书", "image": valid},
                {"label": "远程图片", "image": "https://example.invalid/image.png"},
            ]
        }
    )
    assert config["badges"] == [{"image": valid, "label": "证书", "alt": "证书"}]


# ===== 接口层：这两条端点已下线 =====
#
# `/api/resume-templates/import-from-file` 与 `/api/resume-templates/analyze-from-files`
# 随「自制模板下线」（2026-11）一起**停止注册**。这里刻意不用 `skip`——skip 会变成永久
# 遗忘，而"端点确实不在了"本身值得一条守卫：路由被谁不小心加回去时，下面两条会立刻变红。
#
# 原来那 6 条接口用例（空文件 / 内容不是图片 / 未配置模型 / 落库 / 视觉草稿 / PDF 取文字）
# 已删除：它们测的是**一条不存在的路由**的输入校验与副作用，逐条改成"断言 405"只会得到
# 6 条互相重复的负向用例，读的人反而看不出重点。这些行为在服务层仍有覆盖（见上面的
# 函数级用例：图片消息形态、文档只发结构统计、全文截断、分析摘要、视觉配置白名单），
# 服务实现 `services/resume/resume_template_import.py` 也原样保留，供随时回滚。

_IMPORT_PATH = "/api/resume-templates/import-from-file"
_ANALYZE_PATH = "/api/resume-templates/analyze-from-files"


def _png_bytes() -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def test_import_endpoint_removed_from_the_api_surface(client):
    """`import-from-file` 不再是路由：OpenAPI 里没有它，POST 也不通。"""
    paths = client.get("/openapi.json").json()["paths"]
    assert _IMPORT_PATH not in paths

    response = client.post(
        _IMPORT_PATH,
        files={"file": ("a.png", _png_bytes(), "image/png")},
    )
    # 路径形状与 `/{template_id}` 相同，所以是 405（方法不匹配）而不是 404；
    # 两者都表达"这条端点不在了"，钉住集合而不是某一个值，避免路由形状微调就假红。
    assert response.status_code in (404, 405)


def test_analyze_endpoint_removed_from_the_api_surface(client):
    """`analyze-from-files`（返回视觉草稿）同样不再是路由。"""
    paths = client.get("/openapi.json").json()["paths"]
    assert _ANALYZE_PATH not in paths

    response = client.post(
        _ANALYZE_PATH,
        files={"files": ("a.png", _png_bytes(), "image/png")},
    )
    assert response.status_code in (404, 405)


def test_style_template_routes_are_not_registered_either(client):
    """顺带钉住"下线"的另一半：自制样式模板的写路径整组都不在。

    单独一条而不是散落在各处的 `assert 400`：这一组是**同一个决策**的产物，
    哪天真要恢复，一眼就知道还有哪些入口需要重新接上。
    """
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/resume-templates/builtin-source" not in paths
