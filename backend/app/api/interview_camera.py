# SPDX-License-Identifier: Apache-2.0
"""面试镜头的四个端点（F18）：抽帧分析 / 录像上传 / 录像回放（Range）/ 录像删除。

四个端点都挂在既有的 ``/api/interview`` router 上（``register_camera_routes``），
不新开前缀：前端只认识 ``/api/interview/...`` 这一组路径，拆前缀会让代理与
桌面壳的白名单多一处要维护的地方。

## 为什么分析失败也返回 200

镜头分析依赖"当前模型是否支持图像"。用户完全可能配的是纯文本模型，这不是错误配置，
而是能力边界。此时把原因写进 ``report["camera"]["error"]`` 并返回 200，报告里显示
"镜头分析暂不可用 + 原因"；返回 4xx/5xx 会让前端把整场面试标成失败，而转录与分数
其实都好好的。

## 录像为什么不进备份

面部画面属于敏感个人信息，且单场可达 200MB。备份包里带录像会让"导出备份"变成
"把脸拷到 U 盘"，也会让包体积翻几倍。``interview-recordings`` 因此登记在
``data_backup.coverage.RUNTIME_ONLY``（显式排除 + 断言钉住），恢复后报告里标注
「录像未包含在备份中」。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..runtime.blocking import run_sync
from ..services.interview.interview_camera import (
    CAMERA_MAX_FRAMES,
    CAMERA_SCORE_IN_TOTAL_WEIGHT,
    CameraFrameError,
    analyze_frames,
    apply_total_weight,
    delete_recording,
    merge_camera_report,
    normalize_retention_days,
    recording_info,
    recording_path,
    save_recording,
    validate_frames,
)
from ..services.llm.capabilities import resolve_capabilities
from .interview_shared import _require_provider, _session_or_404


class _CameraFramePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frames: list[str] = Field(min_length=1, max_length=CAMERA_MAX_FRAMES)
    # 设置页开关的当前值：默认关，只有用户显式打开才把镜头分并入总分。
    count_in_score: bool = False


class _CameraAnalysisOut(BaseModel):
    camera: dict[str, Any]
    base_score: float = 0.0
    count_in_total_weight: float = CAMERA_SCORE_IN_TOTAL_WEIGHT


class _RecordingMetaOut(BaseModel):
    bytes: int
    created_at: int
    retention_days: int
    expires_at: int | None = None


#: 单场录像的时长上限（秒）：客户端自报的时长只用来尽早拒绝，字节数另由服务层兜底。
RECORDING_MAX_SECONDS = 30 * 60


@dataclass(frozen=True)
class _CameraAnalysisPrep:
    """抽帧分析的准备结果：校验过的帧、provider / 模型名、是否支持视觉、既有分数。

    ``base_score`` 是并入镜头分之前的总分快照：它在 worker 里读出来，模型调用之后不再
    重读"当前总分"（那会把这段时间里的并发写入混进来）。
    """

    session: Any
    frames: list[str]
    provider: Any
    model: str
    vision: bool
    base_score: float


def _prepare_camera_analysis(
    db: Session, session_id: int, frames: list[str]
) -> _CameraAnalysisPrep:
    """校验帧、解析 provider / 视觉能力、读出既有总分（一个完整工作单元）。"""
    session = _session_or_404(db, session_id)
    try:
        checked = validate_frames(frames)
    except CameraFrameError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    report = dict(session.report or {})
    base_score = float(report.get("score") or 0)
    provider, model = _require_provider(db)
    return _CameraAnalysisPrep(
        session=session,
        frames=checked,
        provider=provider,
        model=model,
        vision=bool(resolve_capabilities(provider.config).vision),
        base_score=base_score,
    )


def _persist_camera_report(
    db: Session,
    session: Any,
    camera: dict[str, Any],
    count_in_score: bool,
    base_score: float,
) -> float:
    """把镜头段并进 report 并提交（一个完整工作单元）；返回并入用的总分快照。"""
    apply_total_weight(camera, count_in_score, base_score)
    merge_camera_report(session, camera)
    db.commit()
    return base_score


def _vision_unavailable_reason(provider) -> str:
    """当前端点未声明视觉能力时给用户的解释（不阻止其它功能）。"""
    model = str(getattr(getattr(provider, "config", None), "model", "") or "")
    label = f"当前模型（{model}）" if model else "当前模型"
    return f"{label}未声明支持图像分析，已跳过镜头评分；录像与其它评分不受影响。"


def _parse_range(header: str, size: int) -> tuple[int, int] | None:
    """解析单段 ``bytes=start-end``；不合法返回 ``None``（调用方回 416）。

    只支持单段：浏览器播放视频只发单段请求，多段（``bytes=0-1,5-6``）在这里
    没有实际用途，硬要实现反而容易写出越界读取。
    """
    if not header.startswith("bytes=") or "," in header:
        return None
    spec = header[6:].strip()
    start_text, _, end_text = spec.partition("-")
    try:
        if start_text == "":
            # 后缀区间：``bytes=-500`` 表示最后 500 字节。
            length = int(end_text)
            if length <= 0:
                return None
            start = max(0, size - length)
            return start, size - 1
        start = int(start_text)
        end = int(end_text) if end_text else size - 1
    except ValueError:
        return None
    if start < 0 or start > end or start >= size:
        return None
    return start, min(end, size - 1)


def register_camera_routes(router: APIRouter) -> None:
    """把镜头相关端点挂到既有 /api/interview router 上。"""

    @router.post("/{session_id}/camera-frames", response_model=_CameraAnalysisOut)
    async def analyze_camera_frames(
        session_id: int,
        payload: _CameraFramePayload,
        db: Session = Depends(get_db),
    ) -> _CameraAnalysisOut:
        """逐帧分析并写入 ``report["camera"]``；失败降级为带原因的结果。"""
        # 准备段（存在性校验 + provider + 能力判定 + 现有分数）整体在 worker 里跑：
        # 里面是 ``db.get`` / 设置读取这类同步 IO，不该占着事件循环。
        prep = await run_sync(_prepare_camera_analysis, db, session_id, payload.frames)
        camera: dict[str, Any]
        if not prep.vision:
            camera = {
                "analyzed_frames": len(prep.frames),
                "visible_frames": 0,
                "score": None,
                "insufficient": True,
                "metrics": {},
                "notes": [],
                "weights": {},
                "count_in_total_weight": CAMERA_SCORE_IN_TOTAL_WEIGHT,
                "model": prep.model,
                "error": _vision_unavailable_reason(prep.provider),
            }
        else:
            camera = await analyze_frames(prep.provider, prep.frames, model=prep.model)

        base_score = await run_sync(
            _persist_camera_report,
            db,
            prep.session,
            camera,
            payload.count_in_score,
            prep.base_score,
        )
        return _CameraAnalysisOut(
            camera=camera,
            base_score=base_score,
            count_in_total_weight=CAMERA_SCORE_IN_TOTAL_WEIGHT,
        )

    @router.post("/{session_id}/recording", response_model=_RecordingMetaOut)
    async def upload_recording(
        session_id: int,
        request: Request,
        retention_days: int = Query(default=7),
        db: Session = Depends(get_db),
    ) -> _RecordingMetaOut:
        """流式接收录像（video/webm）。超限由服务层删半成品并报 413。"""
        await run_sync(_session_or_404, db, session_id)
        content_type = (request.headers.get("content-type") or "").split(";")[0].strip()
        if content_type != "video/webm":
            raise HTTPException(status_code=415, detail="录像格式必须是 video/webm")
        # 客户端声明时长：只信任它做上限拦截，服务端仍按字节数兜底。
        try:
            seconds = int(request.headers.get("x-recording-seconds") or 0)
        except ValueError:
            seconds = 0
        if seconds > RECORDING_MAX_SECONDS:
            raise HTTPException(status_code=413, detail="单场录像不能超过 30 分钟")
        try:
            info = await save_recording(
                session_id,
                request.stream(),
                retention_days=normalize_retention_days(retention_days),
            )
        except ValueError as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        return _RecordingMetaOut(**info)

    @router.get("/{session_id}/recording/meta", response_model=_RecordingMetaOut | None)
    def read_recording_meta(session_id: int, db: Session = Depends(get_db)) -> Any:
        """报告卡先问一次"这场有没有录像"；没有返回 null（不报错）。"""
        _session_or_404(db, session_id)
        info = recording_info(session_id)
        return _RecordingMetaOut(**info) if info else None

    @router.get("/{session_id}/recording")
    def read_recording(session_id: int, request: Request, db: Session = Depends(get_db)):
        """回放录像，支持单段 Range（``<video>`` 拖动进度条依赖它）。"""
        _session_or_404(db, session_id)
        path = recording_path(session_id)
        if not path.exists():
            raise HTTPException(status_code=404, detail="这场面试没有录像")
        size = path.stat().st_size
        header = request.headers.get("range") or ""
        status = 200
        start, end = 0, size - 1
        if header:
            parsed = _parse_range(header, size)
            if parsed is None:
                return Response(
                    status_code=416,
                    headers={"Content-Range": f"bytes */{size}", "Accept-Ranges": "bytes"},
                )
            start, end = parsed
            status = 206
        with path.open("rb") as handle:
            handle.seek(start)
            body = handle.read(end - start + 1)
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(len(body)),
            # 录像含面部画面：不要让浏览器或中间代理缓存到磁盘。
            "Cache-Control": "no-store",
        }
        if status == 206:
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        return Response(content=body, media_type="video/webm", status_code=status, headers=headers)

    @router.delete("/{session_id}/recording", status_code=204)
    def remove_recording(session_id: int, db: Session = Depends(get_db)) -> Response:
        """删录像（只删文件与元数据，不动面试记录）。"""
        _session_or_404(db, session_id)
        delete_recording(session_id)
        return Response(status_code=204)


__all__ = ["register_camera_routes"]
