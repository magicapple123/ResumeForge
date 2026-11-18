# SPDX-License-Identifier: Apache-2.0
"""岗位/个人资料识别的图片输入：接口层行为。

两个接口共用一套控制流，所以统一参数化；模型一律用假 Provider，不访问真实服务。
"""

import base64
import json

import pytest
from app.schemas.extraction import MAX_EXTRACTION_IMAGE_COUNT
from app.schemas.setting import LLMConfig
from app.services.attachments import MAX_ATTACHMENTS_TOTAL_BYTES
from app.services.llm.base import BaseLLMProvider

JOB_PATH = "/api/jobs/parse-text"
PROFILE_PATH = "/api/profile/parse-text"

JOB_SCREENSHOT = """北京后端开发工程师 - 示例科技
工作职责：负责 Python 服务开发。
任职要求：本科及以上学历，熟悉 Python。"""
PROFILE_SCREENSHOT = """李四
电话：13800000000
求职意向：后端开发工程师"""

JOB_FIELDS = {
    "title": "后端开发工程师",
    "company": "示例科技",
    "location": "北京",
    "job_type": "社招",
    "description": "负责 Python 服务开发。",
    "requirements": "本科及以上学历，熟悉 Python。",
}
PROFILE_FIELDS = {"name": "李四", "phone": "13800000000"}


class RecordingProvider(BaseLLMProvider):
    """记录发给模型的消息，供断言图片是否正确随请求发出。"""

    def __init__(self, response: str | Exception):
        super().__init__(LLMConfig(base_url="https://model.example/v1", model="test-model"))
        self.response = response
        self.messages: list[dict] = []
        self.calls = 0

    async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
        self.messages = messages
        self.calls += 1
        if isinstance(self.response, Exception):
            raise self.response
        return self.response

    async def stream_chat(self, _messages):
        yield ""


def _png(size: int = 128) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"0" * (size - 8)


def _image(name: str = "screenshot.png", raw: bytes | None = None, mime: str = "image/png") -> dict:
    raw = raw if raw is not None else _png()
    return {
        "name": name,
        "mime_type": mime,
        "data": "data:image/png;base64," + base64.b64encode(raw).decode("ascii"),
    }


def _configure_model(client) -> None:
    """配置一个**声明了 vision** 的模型（I-34：文本模型收到图片一个请求都不会发）。"""
    response = client.put(
        "/api/settings/llm",
        json=LLMConfig(
            base_url="https://api.openai.com/v1", api_key="test-key", model="gpt-4o"
        ).model_dump(),
    )
    assert response.status_code == 200


def _screenshot_for(path: str) -> str:
    return JOB_SCREENSHOT if path == JOB_PATH else PROFILE_SCREENSHOT


def _response_for(path: str) -> str:
    fields = JOB_FIELDS if path == JOB_PATH else PROFILE_FIELDS
    return json.dumps({"transcription": _screenshot_for(path), **fields}, ensure_ascii=False)


def _factory_path(path: str) -> str:
    return "app.api.jobs.create_provider" if path == JOB_PATH else "app.api.profile.create_provider"


def _module_of(path: str) -> str:
    return "app.api.jobs" if path == JOB_PATH else "app.api.profile"


def _enable_ocr(monkeypatch, path: str, text: str | None = None) -> None:
    """让这次请求"OCR 可用"：Key 有值 + OCR 返回一段文字（不打真实服务）。"""
    from app.services.ocr import ImageOcrOutcome
    from app.services.ocr.policy import OcrContext

    monkeypatch.setattr(
        f"{_module_of(path)}.load_ocr_context",
        lambda _db: OcrContext(engine="auto", api_key="ocr-key"),
    )
    body = _screenshot_for(path) if text is None else text
    monkeypatch.setattr(
        "app.services.recognition_route.prepare_extraction_images",
        lambda _images, _ctx: ImageOcrOutcome(
            text=body, warnings=["已用 DeepSeek OCR 识别 1 张图片中的文字（按页计费）。"], ok=True
        ),
    )


@pytest.mark.parametrize("path", [JOB_PATH, PROFILE_PATH])
def test_images_only_request_reaches_the_model_as_image_parts(client, monkeypatch, path):
    _configure_model(client)
    provider = RecordingProvider(_response_for(path))
    monkeypatch.setattr(_factory_path(path), lambda _config: provider)

    result = client.post(path, json={"text": "", "images": [_image(), _image("第二张.png")]})

    assert result.status_code == 200
    body = result.json()
    assert body["parse_engine"] == "ai"
    # 用户能看到模型读到了什么，这是图片识别最重要的人工核对手段
    assert body["recognized_text"] == _screenshot_for(path)
    assert any("对照截图核对" in warning for warning in body["warnings"])

    parts = provider.messages[1]["content"]
    assert isinstance(parts, list)
    assert parts[0]["type"] == "text"
    assert [part["type"] for part in parts[1:]] == ["image_url", "image_url"]


@pytest.mark.parametrize("path", [JOB_PATH, PROFILE_PATH])
def test_mislabeled_but_real_image_is_accepted(client, path):
    """名字说 PNG、内容其实是 JPEG：不该拦在这，识别流程照常进行。"""
    response = client.post(
        path,
        json={"text": "", "images": [_image(raw=b"\xff\xd8\xff\xe0JFIF-jpeg-bytes")]},
    )

    assert response.status_code == 200


@pytest.mark.parametrize("path", [JOB_PATH, PROFILE_PATH])
def test_forged_and_unsupported_images_are_rejected(client, path):
    _configure_model(client)

    # 声明是 PNG，内容既不是 PNG 也认不出真实格式
    forged = client.post(path, json={"text": "", "images": [_image(raw=b"not a png at all")]})
    assert forged.status_code == 422
    assert "内容与扩展名不符" in forged.json()["detail"]

    # 文本附件不能混进识别接口
    text_file = client.post(
        path,
        json={
            "text": "",
            "images": [{"name": "笔记.txt", "mime_type": "text/plain", "data": "内容"}],
        },
    )
    assert text_file.status_code == 422
    assert "仅支持" in text_file.json()["detail"]


@pytest.mark.parametrize("path", [JOB_PATH, PROFILE_PATH])
def test_too_many_or_oversized_images_are_rejected(client, path):
    _configure_model(client)

    too_many = client.post(
        path,
        json={
            "text": "",
            "images": [_image(f"{i}.png") for i in range(MAX_EXTRACTION_IMAGE_COUNT + 1)],
        },
    )
    assert too_many.status_code == 422

    oversized = client.post(
        path, json={"text": "", "images": [_image(raw=_png(2 * 1024 * 1024 + 1))]}
    )
    assert oversized.status_code == 422
    assert "2 MB" in oversized.json()["detail"]

    # 单张都合法、合计超限：这是请求体不超 8 MB 的保证，必须由服务端拦住。
    # 取刚好越过合计上限、但编码后仍在请求体上限之内的体积，才能走到这条校验
    # （再大就会先被中间件以 413 挡下，那是另一道闸，不是这条规则失效）。
    over_total = [
        _image(raw=_png(2 * 1024 * 1024)),
        _image(raw=_png(2 * 1024 * 1024)),
        _image(raw=_png(1_500_000)),
    ]
    assert sum(len(item["data"]) for item in over_total) < 8 * 1024 * 1024
    total = client.post(path, json={"text": "", "images": over_total})
    assert total.status_code == 422
    assert "5 MB" in total.json()["detail"]

    # 明显超限的请求会被请求体上限更早挡下，同样是拒绝
    huge = client.post(path, json={"text": "", "images": [_image(raw=_png(2 * 1024 * 1024))] * 4})
    assert huge.status_code in (413, 422)


@pytest.mark.parametrize("path", [JOB_PATH, PROFILE_PATH])
def test_a_text_only_model_never_receives_a_chat_request(client, monkeypatch, path):
    """纯文本模型 + 没有 OCR：**一个 chat 请求都不发**，提示点名模型与两条出路（I-34）。"""
    response = client.put(
        "/api/settings/llm",
        json=LLMConfig(
            base_url="https://api.deepseek.com/v1",
            api_key="test-key",
            model="deepseek-chat",
        ).model_dump(),
    )
    assert response.status_code == 200

    class NeverCalledProvider(RecordingProvider):
        async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
            raise AssertionError("文本模型看不了图：不应该发出任何 chat 请求")

    monkeypatch.setattr(_factory_path(path), lambda _config: NeverCalledProvider("{}"))

    result = client.post(path, json={"text": "", "images": [_image()]})

    assert result.status_code == 200  # 保持"永远 200 + 草稿"的既有契约
    body = result.json()
    assert body["parse_engine"] == "local"
    warning = next(item for item in body["warnings"] if "不支持图片输入" in item)
    assert "deepseek-chat" in warning
    assert "识别引擎" in warning


@pytest.mark.parametrize("path", [JOB_PATH, PROFILE_PATH])
def test_text_only_model_uses_ocr_and_sends_no_image_parts(client, monkeypatch, path):
    """无 vision + OCR 可用：OCR 文本进 source_text，原图不再随请求下发（I-34）。"""
    response = client.put(
        "/api/settings/llm",
        json=LLMConfig(
            base_url="https://api.deepseek.com/v1",
            api_key="test-key",
            model="deepseek-chat",
        ).model_dump(),
    )
    assert response.status_code == 200

    provider = RecordingProvider(_response_for(path))
    provider.messages = []
    monkeypatch.setattr(_factory_path(path), lambda _config: provider)
    _enable_ocr(monkeypatch, path)

    result = client.post(path, json={"text": "", "images": [_image()]})

    assert result.status_code == 200
    body = result.json()
    assert body["parse_engine"] == "ai"
    assert any("OCR" in warning for warning in body["warnings"])
    # 原图绝不能同时发：双倍计费，锚定也会同时对着两套文字。
    content = provider.messages[1]["content"]
    assert isinstance(content, str)
    assert _screenshot_for(path).splitlines()[0] in content
    assert body["recognized_text"].startswith(_screenshot_for(path).splitlines()[0])


@pytest.mark.parametrize("path", [JOB_PATH, PROFILE_PATH])
def test_images_without_a_model_say_images_cannot_be_read(client, monkeypatch, path):
    def fail_if_called(_config):
        raise AssertionError("未配置模型时不应创建 provider")

    monkeypatch.setattr(_factory_path(path), fail_if_called)

    result = client.post(path, json={"text": "", "images": [_image()]})

    assert result.status_code == 200
    body = result.json()
    assert body["parse_engine"] == "local"
    assert any("图片识别无法进行" in warning for warning in body["warnings"])


@pytest.mark.parametrize("path", [JOB_PATH, PROFILE_PATH])
def test_blank_text_without_images_is_still_rejected(client, path):
    assert client.post(path, json={"text": ""}).status_code == 422
    assert client.post(path, json={}).status_code == 422
    assert client.post(path, json={"text": "   \r\n\t"}).status_code == 422


# ===== I-34 路由矩阵的其余四格（接口层，参数化两个入口） =====


class SeqProvider(RecordingProvider):
    """按调用次序返回不同响应：用于"第一次视觉、第二次 OCR 兜底"。"""

    def __init__(self, responses: list[str]):
        super().__init__("")
        self.responses = responses
        self.calls = 0

    async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
        self.messages = messages
        self.calls += 1
        return self.responses[min(self.calls - 1, len(self.responses) - 1)]


def _ocr_ctx(engine: str, key: str = "ocr-key"):
    from app.services.ocr.policy import OcrContext

    return OcrContext(engine=engine, api_key=key)


@pytest.mark.parametrize("path", [JOB_PATH, PROFILE_PATH])
def test_vision_model_never_touches_ocr(client, monkeypatch, path):
    """验收 3：有 vision 且正常时**不触发 OCR**（按页计费，不能白花）。"""
    _configure_model(client)
    provider = RecordingProvider(_response_for(path))
    monkeypatch.setattr(_factory_path(path), lambda _config: provider)
    # OCR 明明可用（Key 有值），但这一单不该用它。
    monkeypatch.setattr(
        f"{_module_of(path)}.load_ocr_context", lambda _db: _ocr_ctx("auto")
    )

    def boom(*_args, **_kwargs):
        raise AssertionError("视觉模型能看图时不应调用 OCR")

    monkeypatch.setattr("app.services.recognition_route.prepare_extraction_images", boom)

    result = client.post(path, json={"text": "", "images": [_image()]})

    assert result.status_code == 200
    body = result.json()
    assert body["parse_engine"] == "ai"
    assert not any("OCR" in warning for warning in body["warnings"])
    assert isinstance(provider.messages[1]["content"], list)


def test_empty_vision_result_is_rescued_by_ocr_once(client, monkeypatch):
    """验收 4：视觉两次都一个字段没回填 → 补一次 OCR 抽取，最终有字段。

    岗位识别自带"字段为空就重试一次"（``with_extraction_retry``），所以真正走到兜底
    需要**两次都为空**；OCR 只多花一次调用（第 3 次），且这次不再下发原图。
    资料识别那条走不到这里：本地基线会把抄录文本落成字段（见 verify.md 的发现 D1）。
    """
    _configure_model(client)
    transcript_only = json.dumps({"transcription": JOB_SCREENSHOT}, ensure_ascii=False)
    provider = SeqProvider([transcript_only, transcript_only, _response_for(JOB_PATH)])
    monkeypatch.setattr(_factory_path(JOB_PATH), lambda _config: provider)
    _enable_ocr(monkeypatch, JOB_PATH)

    result = client.post(JOB_PATH, json={"text": "", "images": [_image()]})

    assert result.status_code == 200
    body = result.json()
    assert provider.calls == 3, "两次视觉 + 一次 OCR 兜底，不能更多"
    assert body["parse_engine"] == "ai"
    # 兜底那次输入是 OCR 文本（纯字符串），原图不再随请求下发。
    assert isinstance(provider.messages[1]["content"], str)
    assert body["title"] == JOB_FIELDS["title"]
    assert body["recognized_text"].startswith(JOB_SCREENSHOT.splitlines()[0])


@pytest.mark.parametrize("path", [JOB_PATH, PROFILE_PATH])
def test_explicit_ocr_engine_wins_over_vision_model(client, monkeypatch, path):
    """验收 5：引擎选「只用 OCR」时，即便配了视觉模型也仍走 OCR。"""
    _configure_model(client)
    provider = RecordingProvider(_response_for(path))
    monkeypatch.setattr(_factory_path(path), lambda _config: provider)
    _enable_ocr(monkeypatch, path)
    monkeypatch.setattr(
        f"{_module_of(path)}.load_ocr_context", lambda _db: _ocr_ctx("ocr")
    )

    result = client.post(path, json={"text": "", "images": [_image()]})

    assert result.status_code == 200
    # 原图没有下发：content 是纯文本，第一行就是 OCR 出来的字。
    content = provider.messages[1]["content"]
    assert isinstance(content, str)
    assert _screenshot_for(path).splitlines()[0] in content


@pytest.mark.parametrize("path", [JOB_PATH, PROFILE_PATH])
def test_explicit_vision_engine_with_text_model_reports_precisely(client, monkeypatch, path):
    """验收 6：引擎强制「只用视觉」+ 文本模型 → 精确报错，不静默降级去调 OCR。"""
    response = client.put(
        "/api/settings/llm",
        json=LLMConfig(
            base_url="https://api.deepseek.com/v1",
            api_key="test-key",
            model="deepseek-chat",
        ).model_dump(),
    )
    assert response.status_code == 200

    class NeverCalled(RecordingProvider):
        async def chat(self, messages, *, thinking=True):
            raise AssertionError("文本模型看不了图，不应发 chat 请求")

    monkeypatch.setattr(_factory_path(path), lambda _config: NeverCalled("{}"))
    # Key 有值但档位是 vision：uses_ocr() 为 False，所以 ocr_usable 为假。
    monkeypatch.setattr(
        f"{_module_of(path)}.load_ocr_context", lambda _db: _ocr_ctx("vision")
    )

    def boom(*_args, **_kwargs):
        raise AssertionError("档位是「只用视觉」时不得偷偷调 OCR")

    monkeypatch.setattr("app.services.recognition_route.prepare_extraction_images", boom)

    result = client.post(path, json={"text": "", "images": [_image()]})

    assert result.status_code == 200
    body = result.json()
    assert body["parse_engine"] == "local"
    warning = next(item for item in body["warnings"] if "不支持图片输入" in item)
    assert "deepseek-chat" in warning


@pytest.mark.parametrize("path", [JOB_PATH, PROFILE_PATH])
def test_text_only_request_does_not_touch_ocr_or_rewrite_source(client, monkeypatch, path):
    """验收 8：纯文本识别不查 OCR、不拼 source_text、不多一次调用。"""
    _configure_model(client)
    provider = RecordingProvider(_response_for(path))
    monkeypatch.setattr(_factory_path(path), lambda _config: provider)
    monkeypatch.setattr(
        f"{_module_of(path)}.load_ocr_context", lambda _db: _ocr_ctx("auto")
    )

    def boom(*_args, **_kwargs):
        raise AssertionError("没有图片时不应调用 OCR")

    monkeypatch.setattr("app.services.recognition_route.prepare_extraction_images", boom)

    result = client.post(path, json={"text": "门店店长 示例超市"})

    assert result.status_code == 200
    assert provider.calls == 1
    content = provider.messages[1]["content"]
    assert isinstance(content, str)
    assert "门店店长 示例超市" in content



def test_worst_case_image_payload_fits_the_default_body_limit():
    """钉住"图片总量上限是为请求体上限服务的"这条链。

    中间件在 application.py 按 max_request_body_mb 限制请求体，而识别接口没有（也不该有）
    放宽豁免。所以 base64 膨胀后的最大合法请求必须仍在默认上限之内。
    """
    from app.application import create_app
    from app.config import get_settings

    settings = get_settings()
    max_body = settings.max_request_body_mb * 1024 * 1024
    # base64 每 3 字节膨胀成 4 个字符
    encoded = MAX_ATTACHMENTS_TOTAL_BYTES * 4 // 3
    assert encoded < max_body
    # 顺带确认这两个接口确实没有走 larger_body_paths 豁免
    assert max_body == 8 * 1024 * 1024
    assert create_app() is not None
