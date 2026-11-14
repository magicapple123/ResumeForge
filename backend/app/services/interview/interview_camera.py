# SPDX-License-Identifier: Apache-2.0
"""面试镜头表现（F18）：本地录像索引 + 抽帧回传后的**确定性聚合**。

两条边界必须先说清楚，否则很容易写成"看起来能用、实际不可信"：

1. **分数不交给模型**。模型只逐帧回答五个是非题（面部可见 / 视线看镜头 / 头部稳定 /
   构图合适 / 光线够），聚合、权重、缺帧判定全部在 Python 里算。理由是模型直接打分
   不可复现：同一段视频两次调用会给出 78 与 84，而报告是要给用户对照进步的。
2. **原帧只在内存里**。抽帧以 data URL 进来，校验后直接拼进模型消息，函数返回时即丢弃，
   不落盘、不进备份、不写日志。落盘的只有用户显式开启的录像文件本身。

录像的生命周期也在这里：文件名固定为 ``<session_id>.webm``，旁边一份 ``.json`` 记
创建时间与保留天数（0 = 不自动删）。保留期是前端设置项，随上传一起带上来——后端不
猜用户选的是 7 天还是 30 天，否则"设置里写了不自动删、启动时照样被清掉"就成了谎言。
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from ... import config
from ..attachments import normalize_image_attachment
from ..llm.base import BaseLLMProvider
from ..llm.structured_output import parse_json_object

logger = logging.getLogger(__name__)

# 单场最多 12 帧（约每 15 秒一帧覆盖 3 分钟；再长就按上限截断，不延长会话）。
CAMERA_MAX_FRAMES = 12
# 单帧上限：480px、JPEG q0.6 实测 25–60KB，600KB 是给高噪声画面的余量。
CAMERA_MAX_FRAME_BYTES = 600 * 1024
# 少于 3 张可见脸就不出分：一两帧的"视线"没有统计意义，宁可说"画面不足"。
CAMERA_MIN_VISIBLE_FRAMES = 3
# 权重写在设置卡说明里，值与这里必须一致（前端文案有断言钉住）。
CAMERA_WEIGHTS: dict[str, float] = {
    "face_visible": 0.30,
    "gaze_at_camera": 0.30,
    "head_stable": 0.20,
    "framing_ok": 0.10,
    "lighting_ok": 0.10,
}
# 只有"看得见脸"的帧才能判视线/头部/构图/光线；总帧数只用于 face_visible。
CAMERA_VISIBLE_ONLY_METRICS = ("gaze_at_camera", "head_stable", "framing_ok", "lighting_ok")
# 计入总分时的固定权重（设置页开关默认关；说明文案里写的就是这个数）。
CAMERA_SCORE_IN_TOTAL_WEIGHT = 0.15

RECORDING_DIRNAME = "interview-recordings"
RECORDING_SUFFIX = ".webm"
RECORDING_MAX_BYTES = 200 * 1024 * 1024
RECORDING_MAX_SECONDS = 30 * 60
DEFAULT_RETENTION_DAYS = 7
_ALLOWED_RETENTION_DAYS = (0, 7, 30)
_FRAME_MIME = "image/jpeg"
_FRAME_NAME_RE = re.compile(r"^frame-\d{2}\.jpg$")


class CameraFrameError(ValueError):
    """帧校验失败（面向用户的原因，由接口层转 422）。"""


def _recordings_dir() -> Path:
    return config.DATA_DIR / RECORDING_DIRNAME


def recording_path(session_id: int) -> Path:
    return _recordings_dir() / f"{int(session_id)}{RECORDING_SUFFIX}"


def _meta_path(session_id: int) -> Path:
    return _recordings_dir() / f"{int(session_id)}.json"


def _previous_recording_path(session_id: int) -> Path:
    """上一段录像（暂停后继续录制时产生）；不参与回放，但也不删除。"""
    return _recordings_dir() / f"{int(session_id)}.prev{RECORDING_SUFFIX}"


def normalize_retention_days(value: object) -> int:
    """保留天数收敛到三档；未知值回落默认 7 天（不静默变成"永不删除"）。"""
    try:
        days = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return DEFAULT_RETENTION_DAYS
    return days if days in _ALLOWED_RETENTION_DAYS else DEFAULT_RETENTION_DAYS


def validate_frames(frames: list[str]) -> list[str]:
    """校验并规范化抽帧 data URL；任何一张不合格就整体拒绝。

    为什么整体拒绝而不是"跳过坏的那张"：帧是同一场面试的采样，静默丢帧会让
    ``visible_frames`` 与用户看到的录像长度对不上，报告里的比例就不可解释了。
    """
    if not frames:
        raise CameraFrameError("没有收到可分析的画面")
    if len(frames) > CAMERA_MAX_FRAMES:
        raise CameraFrameError(f"一场面试最多分析 {CAMERA_MAX_FRAMES} 帧画面")

    normalized: list[str] = []
    for index, item in enumerate(frames):
        data = str(item or "").strip()
        if not data.startswith("data:"):
            raise CameraFrameError("画面数据格式不正确")
        # 先按 base64 长度粗算体积：normalize 的解码上限是 2MB，而单帧预算只有 600KB。
        payload = data.split(",", 1)[-1]
        if len(payload) * 3 // 4 > CAMERA_MAX_FRAME_BYTES:
            raise CameraFrameError("单帧画面超过体积上限")
        try:
            attachment = normalize_image_attachment(f"frame-{index:02d}.jpg", "", data)
        except ValueError as exc:
            raise CameraFrameError(str(exc)) from exc
        normalized.append(str(attachment["data_url"]))
    return normalized


def _messages(data_urls: list[str]) -> list[dict[str, object]]:
    """只问"看到什么"的多模态消息：指令在前、帧在后，明确禁止评价外貌与编造。"""
    system = (
        "你是面试录像的逐帧观察员。只回答能看到的事实，不评价外貌、性格、年龄、性别或"
        "任何受保护特征，也不推测画面外的情况。严格输出 JSON，不要解释。"
    )
    instruction = (
        "以下是一次模拟面试中按时间顺序抽取的画面帧。对每一帧回答五个是非题："
        "face_visible（画面里是否有清晰可辨的人脸）、gaze_at_camera（是否看向镜头方向）、"
        "head_stable（头部是否稳定、没有大幅晃动）、framing_ok（头肩是否在画面内且不过小）、"
        "lighting_ok（面部是否看得清、没有过曝或过暗）。"
        '输出形如 {"frames":[{"face_visible":true,"gaze_at_camera":true,'
        '"head_stable":true,"framing_ok":true,"lighting_ok":true,"note":""}],'
        '"notes":["最多三条整体建议"]}。'
        "note 只在有值得说明的观察时写一句，否则留空串。"
    )
    content: list[dict[str, object]] = [{"type": "text", "text": instruction}]
    content.extend({"type": "image_url", "image_url": {"url": url}} for url in data_urls)
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": content},
    ]


def _flag(item: dict[str, Any], key: str) -> bool:
    """把模型可能返回的 true/"true"/1 统一成 bool；缺失按 False（宁可低估不虚高）。"""
    value = item.get(key)
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().casefold() in {"true", "yes", "1", "是"}


def _clean_note(value: object) -> str:
    return str(value or "").strip()[:200]


def aggregate_frames(
    frame_items: list[dict[str, Any]],
    *,
    notes: list[str] | None = None,
    model: str = "",
) -> dict[str, Any]:
    """把逐帧判定聚合成报告用的 ``camera`` 段（纯函数，可离线测边界）。"""
    items = [item for item in frame_items if isinstance(item, dict)]
    analyzed = len(items)
    visible = [item for item in items if _flag(item, "face_visible")]
    payload: dict[str, Any] = {
        "analyzed_frames": analyzed,
        "visible_frames": len(visible),
        "weights": dict(CAMERA_WEIGHTS),
        "count_in_total_weight": CAMERA_SCORE_IN_TOTAL_WEIGHT,
        "notes": [text for text in (_clean_note(item) for item in (notes or [])) if text][:3],
        "model": model,
        "analyzed_at": int(time.time()),
        "error": "",
    }
    if analyzed == 0:
        payload.update(score=None, insufficient=True, metrics={}, reason="没有可分析的画面")
        return payload
    if len(visible) < CAMERA_MIN_VISIBLE_FRAMES:
        payload.update(
            score=None,
            insufficient=True,
            metrics={},
            reason=f"只有 {len(visible)} 帧能看清面部（至少需要 {CAMERA_MIN_VISIBLE_FRAMES} 帧）",
        )
        return payload

    metrics = {"face_visible": round(len(visible) / analyzed, 4)}
    for key in CAMERA_VISIBLE_ONLY_METRICS:
        metrics[key] = round(sum(1 for item in visible if _flag(item, key)) / len(visible), 4)

    frame_notes = [text for text in (_clean_note(item.get("note")) for item in items) if text]
    if frame_notes:
        payload["notes"] = (frame_notes + payload["notes"])[:3]

    score = round(sum(CAMERA_WEIGHTS[key] * metrics[key] for key in CAMERA_WEIGHTS) * 100, 1)
    payload.update(score=score, insufficient=False, metrics=metrics, reason="")
    return payload


def apply_total_weight(
    camera: dict[str, Any], count_in_score: bool, base_score: float
) -> dict[str, Any]:
    """按开关决定是否把镜头分并入总分；不修改原 ``score`` 维度分。"""
    camera["count_in_total"] = bool(count_in_score)
    camera["combined_score"] = None
    if count_in_score and camera.get("score") is not None:
        weight = CAMERA_SCORE_IN_TOTAL_WEIGHT
        camera["combined_score"] = round(
            float(base_score) * (1 - weight) + float(camera["score"]) * weight, 1
        )
    return camera


async def analyze_frames(
    provider: BaseLLMProvider, data_urls: list[str], *, model: str = ""
) -> dict[str, Any]:
    """调视觉模型逐帧判定并聚合。模型不可用/解析失败 → 带 ``error`` 的降级结果。"""
    try:
        raw = await provider.chat(_messages(data_urls), thinking=False)
        parsed = parse_json_object(raw, label="镜头分析")
    except Exception as exc:  # noqa: BLE001 - 降级要留原因，不能把整场面试卡住
        logger.warning("镜头分析失败：%s", exc)
        return {
            "analyzed_frames": len(data_urls),
            "visible_frames": 0,
            "weights": dict(CAMERA_WEIGHTS),
            "count_in_total_weight": CAMERA_SCORE_IN_TOTAL_WEIGHT,
            "notes": [],
            "model": model,
            "analyzed_at": int(time.time()),
            "score": None,
            "insufficient": True,
            "metrics": {},
            "reason": "镜头分析暂不可用",
            "error": str(exc)[:300] or "镜头分析暂不可用",
        }
    frames = parsed.get("frames")
    items = frames if isinstance(frames, list) else []
    raw_notes = parsed.get("notes")
    notes = [str(text) for text in raw_notes] if isinstance(raw_notes, list) else []
    return aggregate_frames(items, notes=notes, model=model)


def merge_camera_report(session: Any, camera: dict[str, Any]) -> dict[str, Any]:
    """写 ``report["camera"]``，**保留报告其它键**（分数、维度、总结都不能被冲掉）。"""
    report = dict(session.report or {})
    report["camera"] = camera
    session.report = report
    return report


def has_real_report(report: dict[str, Any] | None) -> bool:
    """这份 report 是否已经生成过（只有 ``camera`` 段不算，否则报告会被跳过）。"""
    if not report:
        return False
    return bool(report.get("dimensions") or report.get("summary") or report.get("score"))


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


async def save_recording(
    session_id: int,
    chunks: AsyncIterator[bytes],
    *,
    retention_days: int = DEFAULT_RETENTION_DAYS,
) -> dict[str, Any]:
    """流式落盘（不把 200MB 读进内存）；超限时删掉半成品并抛 ``ValueError``。"""
    target = recording_path(session_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(".webm.part")
    written = 0
    try:
        with partial.open("wb") as handle:
            async for chunk in chunks:
                if not chunk:
                    continue
                written += len(chunk)
                if written > RECORDING_MAX_BYTES:
                    raise ValueError("录像超过 200 MB 上限，已停止保存")
                handle.write(chunk)
        if written == 0:
            raise ValueError("没有收到录像数据")
        # 同一场面试可能被"暂停 → 继续"切成多段：新一段替换主文件前，把上一段
        # 挪到 ``<id>.prev.webm``。静默覆盖等于把用户录过的内容删了，而多段合并
        # 成可播放文件需要转码（本机没有 ffmpeg），保留上一段是成本最低的诚实做法。
        if target.exists():
            target.replace(_previous_recording_path(session_id))
        partial.replace(target)
    except Exception:
        partial.unlink(missing_ok=True)
        raise
    meta = {
        "bytes": written,
        "created_at": int(time.time()),
        "retention_days": normalize_retention_days(retention_days),
    }
    _write_json(_meta_path(session_id), meta)
    return {"bytes": written, **meta, "expires_at": _expires_at(meta)}


def _expires_at(meta: dict[str, Any]) -> int | None:
    days = normalize_retention_days(meta.get("retention_days"))
    if days == 0:
        return None
    created = int(meta.get("created_at") or 0)
    return (created + days * 86400) if created else None


def recording_info(session_id: int) -> dict[str, Any] | None:
    path = recording_path(session_id)
    if not path.exists():
        return None
    meta = _read_json(_meta_path(session_id))
    return {
        "bytes": int(meta.get("bytes") or path.stat().st_size),
        "created_at": int(meta.get("created_at") or 0),
        "retention_days": normalize_retention_days(meta.get("retention_days")),
        "expires_at": _expires_at(meta),
    }


def delete_recording(session_id: int) -> bool:
    removed = False
    for path in (
        recording_path(session_id),
        _previous_recording_path(session_id),
        _meta_path(session_id),
    ):
        if path.exists():
            path.unlink(missing_ok=True)
            removed = True
    return removed


def cleanup_expired(now: float | None = None) -> int:
    """启动时清理到期录像；保留天数 0（不自动删）与缺失元数据的文件都不动。"""
    folder = _recordings_dir()
    if not folder.is_dir():
        return 0
    stamp = int(now if now is not None else time.time())
    removed = 0
    for path in folder.glob(f"*{RECORDING_SUFFIX}"):
        # ``<id>.prev.webm`` 也要跟着主文件一起到期：stem 里带 ``.prev``。
        try:
            session_id = int(path.stem.split(".")[0])
        except ValueError:
            continue
        meta = _read_json(_meta_path(session_id))
        expires = _expires_at(meta)
        if expires is not None and expires <= stamp:
            delete_recording(session_id)
            removed += 1
    return removed


__all__ = [
    "CAMERA_MAX_FRAMES",
    "CAMERA_MAX_FRAME_BYTES",
    "CAMERA_MIN_VISIBLE_FRAMES",
    "CAMERA_SCORE_IN_TOTAL_WEIGHT",
    "CAMERA_WEIGHTS",
    "CameraFrameError",
    "RECORDING_DIRNAME",
    "RECORDING_MAX_BYTES",
    "RECORDING_MAX_SECONDS",
    "RECORDING_SUFFIX",
    "aggregate_frames",
    "analyze_frames",
    "apply_total_weight",
    "cleanup_expired",
    "delete_recording",
    "has_real_report",
    "merge_camera_report",
    "normalize_retention_days",
    "recording_info",
    "recording_path",
    "save_recording",
    "validate_frames",
]
