# SPDX-License-Identifier: Apache-2.0
"""识别链路的诊断与归因（T9-a）：空材料短路、图片归因、字段级警告。

这一组用例守的是**用户看到的那串提示**是否与事实一致。原来那批问题的共同形态是
"提示之间互相矛盾"：既说识别失败、又说已填入表单；既说 OCR 失败改走视觉模型、又说
模型不支持图片输入。所以断言尽量落在完整句子与调用次数上，而不是内部返回值。
"""

import base64

import pytest
from app.schemas.job import JobTextParseResult
from app.schemas.setting import LLMConfig
from app.services.job_text_parser import parse_job_text
from app.services.llm.base import BaseLLMProvider
from app.services.ocr.client import OcrError
from app.services.ocr.policy import OcrContext
from app.services.text_extraction import (
    ai_failed_warning,
    attach_image_review_warning,
    empty_material_warning,
)

JOB_PARSE = "/api/jobs/parse-text"
JOB_PARSE_MULTI = "/api/jobs/parse-multiple"

TEXT_ONLY_MODEL = LLMConfig(
    base_url="https://api.deepseek.com/v1", api_key="test-key", model="deepseek-chat"
)


class CountingProvider(BaseLLMProvider):
    """记录调用次数：短路用例的核心断言就是"一次都没调"。"""

    def __init__(self, response: str = "{}"):
        super().__init__(LLMConfig(base_url="https://model.example/v1", model="test-model"))
        self.response = response
        self.calls = 0

    async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
        self.calls += 1
        return self.response

    async def stream_chat(self, _messages):
        yield ""


def _png(size: int = 128) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"0" * (size - 8)


def _image(name: str = "screenshot.png") -> dict:
    return {
        "name": name,
        "mime_type": "image/png",
        "data": "data:image/png;base64," + base64.b64encode(_png()).decode("ascii"),
    }


def _configure_text_only_model(client) -> None:
    response = client.put("/api/settings/llm", json=TEXT_ONLY_MODEL.model_dump())
    assert response.status_code == 200


def _ocr_with_a_dead_key(monkeypatch) -> None:
    """OCR 可用（有 Key），但每一次调用都被上游 401 拒绝。"""

    def _unauthorized(*_args, **_kwargs):
        raise OcrError("unauthorized", detail="Authentication Fails")

    monkeypatch.setattr("app.services.ocr.scan.recognize_document", _unauthorized)
    monkeypatch.setattr(
        "app.api.jobs.load_ocr_context",
        lambda _db: OcrContext(engine="auto", api_key="ocr-key"),
    )


# ===== 归因：只有真的发了图才说"不支持图片输入" =====


def test_ai_failed_warning_without_images_sent_never_blames_image_input():
    """OCR 路线一个 image 块都没下发：不能把失败挂在"模型不支持图片输入"上。"""
    message = ai_failed_warning(has_images=True, detail="HTTP 500", images_sent=False)

    assert "图片输入" not in message
    assert "多模态" not in message
    assert "AI 识别暂不可用" in message
    # 原始错误仍要给出来：用户能据此判断是不是 Key / 余额 / 网络。
    assert "HTTP 500" in message


def test_ai_failed_warning_keeps_the_image_note_when_images_were_sent():
    message = ai_failed_warning(has_images=True, images_sent=True)

    assert "图片输入" in message
    assert "多模态" in message


def test_ai_failed_warning_defaults_to_the_old_behaviour():
    """未区分这一步的调用方（如资料识别）保持原样，不悄悄改变它们的文案。"""
    assert "图片输入" in ai_failed_warning(has_images=True)
    assert (
        ai_failed_warning(has_images=False) == "AI 识别暂不可用，已使用本地规则识别，请核对后保存。"
    )


def test_the_screenshot_hint_is_skipped_when_images_contributed_nothing():
    """一个字段都没识别出来时，让用户"对照截图核对"一堆空白是噪音。"""
    draft = JobTextParseResult()

    skipped = attach_image_review_warning(draft, True, contributed=False)
    kept = attach_image_review_warning(draft, True, contributed=True)

    assert not any("对照截图核对" in warning for warning in skipped.warnings)
    assert any("对照截图核对" in warning for warning in kept.warnings)


# ===== parse_job_text("") 不再产出字段级警告 =====


def test_an_empty_text_produces_no_field_level_warnings():
    """空输入不是"规则没认出来"：调用方本来就知道没材料。"""
    result = parse_job_text("")

    assert result.title == ""
    assert result.warnings == []


def test_real_material_still_reports_the_missing_fields():
    """守卫另一侧：有材料但认不出岗位名称时仍要提示，别把功能一起删掉。"""
    result = parse_job_text("本公司长期招聘各类人才，欢迎投递简历。")

    assert any("未识别到岗位名称" in warning for warning in result.warnings)


# ===== 空材料短路：一个请求都不发 =====


def test_ocr_route_never_calls_the_model_when_ocr_reads_nothing(client, monkeypatch):
    """文本模型 + OCR 全部失败 → provider 调用次数为 0（T9-a 的核心判据）。"""
    _configure_text_only_model(client)
    provider = CountingProvider()
    monkeypatch.setattr("app.api.jobs.create_provider", lambda _config: provider)
    _ocr_with_a_dead_key(monkeypatch)

    result = client.post(JOB_PARSE, json={"text": "", "images": [_image()]})

    assert result.status_code == 200
    body = result.json()
    assert provider.calls == 0, "材料为空时不该白调一次模型"
    assert body["parse_engine"] == "local"
    assert body["title"] == "" and body["description"] == ""

    joined = "\n".join(body["warnings"])
    # 1) OCR 的真实原因（含状态码来源），不是异常类名
    assert "第 1 张图片的 OCR 识别失败" in joined
    assert "DeepSeek API Key 无效（401）" in joined
    # 2) 为什么这张图被跳过：模型确实不支持图片输入（这是事实，不是失败归因）
    assert "不支持图片输入" in joined
    # 3) 两条出路都在，用户知道下一步做什么
    assert empty_material_warning() in joined
    assert "粘贴招聘信息文本" in joined and "识别引擎" in joined
    # 4) 一个字段都没识别出来时不该让用户去对照截图核对
    assert "对照截图核对" not in joined
    # 5) 空输入的字段级警告不再出现
    assert "未识别到岗位名称" not in joined


def test_multi_route_short_circuits_and_still_returns_one_draft(client, monkeypatch):
    """多份入口同样短路，且 items 非空契约不变（前端要解构 items[0]）。"""
    _configure_text_only_model(client)
    provider = CountingProvider()
    monkeypatch.setattr("app.api.jobs.create_provider", lambda _config: provider)
    _ocr_with_a_dead_key(monkeypatch)

    result = client.post(JOB_PARSE_MULTI, json={"text": "", "images": [_image()]})

    assert result.status_code == 200
    body = result.json()
    assert provider.calls == 0
    assert body["parse_engine"] == "local"
    assert len(body["items"]) == 1
    first = body["items"][0]
    assert first["title"] == ""
    joined = "\n".join(first["warnings"])
    assert "第 1 张图片的 OCR 识别失败" in joined
    assert empty_material_warning() in joined
    assert "对照截图核对" not in joined


def test_single_route_rejects_material_that_yields_no_text_and_no_images(client, monkeypatch):
    """文档一个字都提不出来：与多份入口同一口径，直接 422 而不是空跑一次模型。"""
    from app.services.document_text import ExtractedDocuments

    _configure_text_only_model(client)
    provider = CountingProvider()
    monkeypatch.setattr("app.api.jobs.create_provider", lambda _config: provider)
    monkeypatch.setattr(
        "app.api.jobs.extract_documents_text",
        lambda *_args, **_kwargs: ExtractedDocuments(text="", warnings=[], size_bytes=0),
    )

    single = client.post(
        JOB_PARSE,
        json={"text": "", "documents": [{"name": "空扫描件.pdf", "data": "JVBERi0="}]},
    )
    multi = client.post(
        JOB_PARSE_MULTI,
        json={"text": "", "documents": [{"name": "空扫描件.pdf", "data": "JVBERi0="}]},
    )

    assert single.status_code == 422
    assert multi.status_code == 422
    # 两个入口的说法必须一致，否则同一件事在两处给两种解释。
    assert single.json()["detail"] == multi.json()["detail"] == "缺少招聘信息或截图、文档"
    assert provider.calls == 0


@pytest.mark.parametrize(
    "payload",
    [
        {"text": "", "images": []},
        {"text": "   \r\n\t"},
        {},
    ],
)
def test_an_empty_request_is_rejected_before_any_work(client, payload):
    """空请求在 schema 层就被挡下：不该走到"没有可识别材料"那条分支。"""
    assert client.post(JOB_PARSE, json=payload).status_code == 422
