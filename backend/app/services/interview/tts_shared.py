# SPDX-License-Identifier: Apache-2.0
"""语音合成的两档共用件：异常类型与 WAV 头修复。

为什么单独一个文件：`interview_tts`（百炼档）与 `interview_tts_deepseek`（DeepSeek 档）
互相不能 import —— 前者要分发到后者，后者又需要同一个 ``TtsUnavailable`` 与同一份
``normalize_wav``。把这两样下沉到这里，两个 provider 文件之间就不存在循环依赖，调用方
（``interview_tts``）继续 re-export，既有 import 路径与测试都不用改。

``normalize_wav`` 的口径不变：**只重写 RIFF / data 两个长度字段，采样数据一个字节都不动**。
两个上游给的占位长度不一样（百炼实测 ``0x7FFFFF9B``，DeepSeek 实测 ``0x7FFFFFFF``），
所以这里按"声明的长度明显不成立"判断，而不是认某一个具体常量。
"""

from __future__ import annotations

import struct

#: 上游流式占位长度：两家实测值不同，都当成"头里的长度不可信"。
_PLACEHOLDER_SIZES = frozenset({0xFFFFFFFF, 0x7FFFFFFF, 0x7FFFFF9B})


class TtsUnavailable(RuntimeError):
    """合成不可用（没配 Key / 上游报错 / 超时 / 下载失败）。

    带一句**可直接展示**的原因：界面上要说明"为什么这次是浏览器音色"，
    静默无声比音色不对更难排查。
    """


def normalize_wav(raw: bytes) -> bytes:
    """把流式 WAV 的占位长度改写成真实长度。

    只重写 ``RIFF`` 与 ``data`` 两个长度字段，**不动采样数据一个字节**：上游是 24kHz /
    单声道 / 16bit，重采样只会掉质量。找不到 ``data`` 块时原样返回（不是 WAV 的话交给
    播放器报错，比在这里猜格式更诚实）。
    """
    if len(raw) < 44 or raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
        return raw
    pos = 12
    while pos + 8 <= len(raw):
        chunk_id = raw[pos : pos + 4]
        size = struct.unpack("<I", raw[pos + 4 : pos + 8])[0]
        if chunk_id == b"data":
            payload = len(raw) - (pos + 8)
            header = bytearray(raw[: pos + 8])
            header[4:8] = struct.pack("<I", len(raw) - 8)
            header[pos + 4 : pos + 8] = struct.pack("<I", payload)
            return bytes(header) + raw[pos + 8 :]
        # 其它块按声明长度跳过；声明长度明显超出文件时停下，避免死循环。
        if size in _PLACEHOLDER_SIZES or pos + 8 + size > len(raw):
            return raw
        pos += 8 + size + (size % 2)
    return raw


def wav_duration_seconds(raw: bytes) -> float:
    """按真实字节数算出 WAV 时长（毫秒级精度）。

    为什么需要它：上游只返回音频，**不返回时长**；而"头里的 ``nframes`` 是假的"这件事
    必须由我们自己算一遍才能确认头部修复成功（否则只能靠播放器显示 89478 秒才发现）。
    采样率/声道/位深取 ``fmt `` 块，取不到时返回 0（调用方当"未知"处理，不编数字）。
    """
    if len(raw) < 44 or raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
        return 0.0
    pos = 12
    channels = 0
    rate = 0
    bits = 0
    data_size = 0
    while pos + 8 <= len(raw):
        chunk_id = raw[pos : pos + 4]
        size = struct.unpack("<I", raw[pos + 4 : pos + 8])[0]
        body = pos + 8
        if chunk_id == b"fmt " and size >= 16:
            channels = struct.unpack("<H", raw[body + 2 : body + 4])[0]
            rate = struct.unpack("<I", raw[body + 4 : body + 8])[0]
            bits = struct.unpack("<H", raw[body + 14 : body + 16])[0]
        elif chunk_id == b"data":
            # 头部已修好时按 data 块声明长度；未修好时（占位值）按剩余字节数兜底。
            available = len(raw) - body
            data_size = available if size in _PLACEHOLDER_SIZES else min(size, available)
            break
        if size in _PLACEHOLDER_SIZES or body + size > len(raw):
            break
        pos = body + size + (size % 2)
    frame_bytes = channels * max(bits // 8, 1)
    if not rate or not frame_bytes:
        return 0.0
    return data_size / float(rate * frame_bytes)


__all__ = ["TtsUnavailable", "normalize_wav", "wav_duration_seconds"]
