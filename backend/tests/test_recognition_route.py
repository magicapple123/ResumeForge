# SPDX-License-Identifier: Apache-2.0
"""I-34 识别路由的纯函数与接线守卫。

为什么单独测这一层：四条出口的判据如果散在两个路由函数里，改一处就会漏另一处；
这里把"有图 / 能看图 / 能用 OCR"钉成矩阵，路由层只负责照单执行。
"""

import inspect

import pytest
from app.services import recognition_route as route
from app.services.ocr import ImageOcrOutcome
from app.services.ocr.policy import OcrContext


@pytest.mark.parametrize(
    ("has_images", "vision", "ocr_usable", "ocr_forced", "expected"),
    [
        (False, False, False, False, "text"),
        (False, True, True, False, "text"),
        (True, True, False, False, "vision"),
        (True, True, True, False, "vision"),
        (True, False, True, False, "ocr"),
        (True, False, False, False, "blocked"),
        # 用户显式选「只用 OCR」：压过"模型能看图"，否则等于忽略他的选择（也白花视觉的钱）
        (True, True, True, True, "ocr"),
        # 选了「只用 OCR」但没配 Key：不能拿文本模型硬发图，只能本地兜底 + 说清原因
        (True, True, False, True, "blocked"),
        (True, False, False, True, "blocked"),
    ],
)
def test_route_matrix(has_images, vision, ocr_usable, ocr_forced, expected):
    assert (
        route.decide_route(
            has_images=has_images,
            vision=vision,
            ocr_usable=ocr_usable,
            ocr_forced=ocr_forced,
        )
        == expected
    )


def test_blocked_warning_does_not_advise_ocr_when_the_engine_forbids_it():
    """选了「只用视觉」时不能劝他去配 OCR——那与他的选择相反。"""
    message = route.blocked_image_warning("deepseek-flash", ocr_engine="vision")
    assert "只用视觉" in message
    assert "切回「自动」" in message
    assert "qwen-vl" in message


def test_blocked_warning_for_forced_ocr_without_a_key_asks_for_the_key():
    message = route.blocked_image_warning("deepseek-flash", ocr_engine="ocr")
    assert "只用 OCR" in message
    assert "没有配置 OCR Key" in message
    # 默认档（只是没配 Key）不能说成"只用视觉"，那是两回事。
    auto = route.blocked_image_warning("deepseek-flash")
    assert "只用视觉" not in auto
    assert "配置 OCR" in auto


def test_ocr_available_needs_both_engine_and_key():
    assert route.ocr_available(None) is False
    assert route.ocr_available(OcrContext(engine="auto", api_key="")) is False
    assert route.ocr_available(OcrContext(engine="vision", api_key="key")) is False
    assert route.ocr_available(OcrContext(engine="ocr", api_key="")) is False
    assert route.ocr_available(OcrContext(engine="auto", api_key="key")) is True
    assert route.ocr_available(OcrContext(engine="ocr", api_key="key")) is True


def test_blocked_warning_names_the_model_and_both_ways_out():
    message = route.blocked_image_warning("deepseek-flash")
    assert "deepseek-flash" in message
    assert "不支持图片输入" in message
    # 不再说"可能"：能力表已经知道答案，猜原因正是这条要修掉的体验。
    assert "可能" not in message
    assert "qwen-vl" in message
    assert "识别引擎" in message


async def test_ocr_images_passes_data_urls_as_payloads(monkeypatch):
    seen: dict[str, object] = {}

    def fake_prepare(images, ctx):
        seen["images"] = images
        seen["ctx"] = ctx
        return ImageOcrOutcome(text="页面文字", warnings=("已用 OCR",), ok=True)

    monkeypatch.setattr(route, "prepare_extraction_images", fake_prepare)
    ctx = OcrContext(engine="auto", api_key="key")
    prep = await route.ocr_images(["data:image/png;base64,AAA", "data:image/png;base64,BBB"], ctx)

    assert seen["images"] == [
        {"data_url": "data:image/png;base64,AAA", "name": "page-1.png"},
        {"data_url": "data:image/png;base64,BBB", "name": "page-2.png"},
    ]
    assert prep.text == "页面文字"
    assert prep.used_ocr is True
    assert prep.remaining == ()


async def test_ocr_images_reports_a_failed_page_without_failing_the_order(monkeypatch):
    monkeypatch.setattr(
        route,
        "prepare_extraction_images",
        lambda _images, _ctx: ImageOcrOutcome(
            text="第一张的文字", warnings=("第 2 张失败",), remaining=["data:image/png;base64,BBB"]
        ),
    )
    prep = await route.ocr_images(
        ["data:image/png;base64,AAA", "data:image/png;base64,BBB"],
        OcrContext(engine="auto", api_key="key"),
    )
    assert prep.text == "第一张的文字"
    assert len(prep.remaining) == 1


async def test_ocr_to_text_drops_the_images_and_reparses_locally(monkeypatch):
    calls: list[str] = []

    async def fake_ocr(_urls, _ctx):
        return route.OcrPrep(text="OCR 正文", remaining=("data:image/png;base64,BBB",))

    monkeypatch.setattr(route, "ocr_images", fake_ocr)
    prepared = await route.ocr_to_text(
        source_text="粘贴的正文",
        image_urls=["data:image/png;base64,AAA"],
        ctx=OcrContext(engine="auto", api_key="key"),
        parse_local=lambda text: calls.append(text) or {"text": text},
    )

    assert prepared.source_text == "粘贴的正文\n\nOCR 正文"
    assert prepared.local_draft == {"text": "粘贴的正文\n\nOCR 正文"}
    assert prepared.ocr_text == "OCR 正文"
    # 有一张没读出字：调用方要知道它被跳过了。
    assert prepared.dropped_images == 1
    assert calls == ["粘贴的正文\n\nOCR 正文"]


async def test_ocr_rescue_returns_none_without_text(monkeypatch):
    async def fake_ocr(_urls, _ctx):
        return route.OcrPrep()

    monkeypatch.setattr(route, "ocr_images", fake_ocr)
    outcome = await route.ocr_rescue(
        source_text="",
        image_urls=["data:image/png;base64,AAA"],
        ctx=OcrContext(engine="auto", api_key="key"),
        parse_local=lambda text: {"text": text},
        run_extraction=_never_called,
    )
    assert outcome is None


async def _never_called(*_args):
    raise AssertionError("OCR 没读出字时不该再跑一次抽取")


def test_filled_field_count_ignores_defaults():
    from app.schemas.job import JobTextParseResult

    empty = JobTextParseResult()
    # job_type="其他" / status="开放中" 有默认值，不能算成"回填了内容"。
    assert route.filled_field_count(empty, route.JOB_CONTENT_FIELDS) == 0
    filled = JobTextParseResult(title="后端开发工程师", company="示例科技")
    assert route.filled_field_count(filled, route.JOB_CONTENT_FIELDS) == 2


def test_prepare_extraction_images_still_has_a_live_caller():
    """静态守卫：这个函数曾经"实现了但零调用方"，不要再退回死代码。"""
    source = inspect.getsource(route)
    # 作为 run_in_threadpool 的位置参数被传进去（不是只 import）。
    assert "prepare_extraction_images," in source

    from app.api import jobs, profile

    assert jobs.ocr_to_text is route.ocr_to_text
    assert profile.ocr_to_text is route.ocr_to_text
