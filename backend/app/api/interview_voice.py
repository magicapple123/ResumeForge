# SPDX-License-Identifier: Apache-2.0
"""模拟面试实时语音 P0 的服务端控制面：cancel 端点 + TTS 端点。

自 ``interview_stream.py`` 拆出（#26 P0 加 cancel/interrupted 之后那支过了 500 行预算）。
这里只挂**路由**：谁在生成、怎么取消、回答怎么按 ``client_turn_id`` 幂等落库，实现都在
``interview_units``（公共层）——RF-02 把"回答落库"划进准备段之后，控制面再留在路由模块
里就会形成"公共层回头依赖路由"的反向边。本模块按原导入路径**再导出**那几个名字，
既有调用方（``interview_stream`` 与 ``tests/test_interview_voice_stream.py``）不受影响。

## cancel 为什么是独立 HTTP 请求

现有链路是 POST SSE（前端 ``fetch` + ``consumeSSE``），同一条连接上没法再发控制帧。
插话时客户端先发 ``POST /api/interview/voice/turns/cancel`，再 abort 当前流；生成器在
下一个 delta 边界看到 ``cancelled`` 就停下并回滚。本地单用户应用不做多路复用，
cancel 不带标识时取消全部活动轮次（通常只有一条），最不容易误伤历史轮次。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from ..services.interview import interview_tts
from .interview_units import (
    TurnControl,  # noqa: F401  (re-export：interview_stream 与语音测试从本模块取)
    active_turn_count,  # noqa: F401  (re-export)
    cancel_active_turns,
    is_turn_active,  # noqa: F401  (re-export)
    record_stream_answer,  # noqa: F401  (re-export)
    register_turn,  # noqa: F401  (re-export)
    unregister_turn,  # noqa: F401  (re-export)
)

logger = logging.getLogger(__name__)


class _TurnCancelPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # 都可空：P0 前端单链路只知道"取消最近一轮"；P1 接 TTS 时带上精确播放位置。
    session_id: int | None = Field(default=None, ge=1)
    client_turn_id: str | None = Field(default=None, max_length=64)
    played_chars: int | None = Field(default=None, ge=0)


class _TurnCancelResult(BaseModel):
    cancelled: int = 0
    generated_chars: int = 0
    played_chars: int = 0
    rolled_back_chars: int = 0


class _TtsPayload(BaseModel):
    """一句待合成的文本。**按句调用**：整段一次合成要等十秒以上（见 interview_tts 文件头）。

    ``provider`` 是并列的两档（``dashscope`` 默认 / ``deepseek``）。缺省 = 默认档，
    所以未升级的前端照旧工作；前端持久化的音色字符串**不因为档位存在而失效**
    （选回百炼档时 4 个旧音色原样可用）。
    """

    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=interview_tts.MAX_TEXT_LENGTH)
    voice: str = Field(default=interview_tts.DEFAULT_VOICE, max_length=32)
    provider: str = Field(default=interview_tts.DEFAULT_PROVIDER, max_length=32)


class _TtsVoiceOption(BaseModel):
    id: str
    label: str


class _TtsProviderStatus(BaseModel):
    """一档的合成能力（`GET /voice/tts/status` 的 ``providers[]``）。

    ``available`` 是**逐档**判断的：百炼有 Key 不等于 DeepSeek 有 Key，界面要分开显示，
    否则用户会在"看着可用"的档上点了没声音。
    """

    id: str
    model: str
    default_voice: str
    available: bool
    voices: list[_TtsVoiceOption]


class _TtsStatus(BaseModel):
    """房间进来先问一次：能不能合成、有哪些音色。同时顺手预热一次。

    顶层四个字段是**旧口径**（= 默认档，向后兼容未升级前端）；``providers`` 是新口径，
    前端按它渲染档位下拉。两者内容有重叠是刻意的：改顶层字段名会让旧前端读不到音色。
    """

    available: bool
    model: str
    default_voice: str
    voices: list[_TtsVoiceOption]
    default_provider: str = interview_tts.DEFAULT_PROVIDER
    providers: list[_TtsProviderStatus] = []


def register_voice_routes(router: APIRouter) -> None:
    """把语音取消端点挂到既有的 /api/interview router 上（不新开 prefix）。"""

    @router.post("/voice/turns/cancel", response_model=_TurnCancelResult)
    def cancel_voice_turn(payload: _TurnCancelPayload | None = None) -> _TurnCancelResult:
        """插话取消：标记活动轮次，生成器在下一个 delta 边界停下并回滚。

        返回的是**这一刻**的估算（生成器随后还会再 flush 一点点），用于前端/观测；
        落库的最终 ``rolled_back_chars`` 以服务端写回的 context 为准。
        """
        body = payload or _TurnCancelPayload()
        controls = cancel_active_turns(
            session_id=body.session_id,
            client_turn_id=body.client_turn_id,
            played_chars=body.played_chars,
        )
        generated = max((len(item.sent_text) for item in controls), default=0)
        played = (
            min(int(body.played_chars), generated) if body.played_chars is not None else generated
        )
        logger.info(
            "interview_voice cancel turns=%d generated_chars=%d played_chars=%d",
            len(controls),
            generated,
            played,
        )
        return _TurnCancelResult(
            cancelled=len(controls),
            generated_chars=generated,
            played_chars=played,
            rolled_back_chars=max(0, generated - played),
        )

    @router.get("/voice/tts/status", response_model=_TtsStatus)
    def tts_status() -> _TtsStatus:
        """合成能力与音色清单（**只读配置，不发合成请求**）。

        顺手预热一次默认档：首次冷启动实测 6.4s，而进房间到面试官开口之间通常有几秒，
        正好用来把模型焐热。预热是后台线程、失败静默（见 ``interview_tts.prewarm``）。
        新档**不预热**：它可能是用户没配 Key 的那一档，预热的失败日志只会变成噪音。
        """
        default_provider = interview_tts.DEFAULT_PROVIDER
        available = interview_tts.available(default_provider)
        if available:
            interview_tts.prewarm(
                interview_tts.default_voice_of(default_provider), default_provider
            )
        providers = [
            _TtsProviderStatus.model_validate(interview_tts.provider_status(provider))
            for provider in interview_tts.PROVIDER_IDS
        ]
        return _TtsStatus(
            available=available,
            model=interview_tts.model_of(default_provider),
            default_voice=interview_tts.default_voice_of(default_provider),
            voices=[
                _TtsVoiceOption(id=key, label=label)
                for key, label in interview_tts.voices_of(default_provider)
            ],
            default_provider=default_provider,
            providers=providers,
        )

    @router.post("/voice/tts")
    def tts_synthesize(payload: _TtsPayload) -> Response:
        """合成一句，返回修好 RIFF 头的 WAV。

        失败一律 503 + 原因：前端据此回落到浏览器音色，并把原因显示在界面上——
        "合成失败"不许表现成"没声音"（那样无从排查）。

        音色不属于所选档时**不报错**：``interview_tts.synthesize`` 按该档默认音色合成
        （宁可换声也不静默无声），界面上的显式提示由前端用同一份 ``resolve_voice`` 给出。
        """
        try:
            audio = interview_tts.synthesize(payload.text, payload.voice, payload.provider)
        except interview_tts.TtsUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        return Response(
            content=audio,
            media_type="audio/wav",
            headers={"Cache-Control": "no-store"},
        )


__all__ = [
    "TurnControl",
    "active_turn_count",
    "cancel_active_turns",
    "is_turn_active",
    "record_stream_answer",
    "register_turn",
    "register_voice_routes",
    "unregister_turn",
]
