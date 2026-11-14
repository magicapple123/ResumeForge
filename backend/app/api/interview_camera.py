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

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..database import get_db
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
        session = _session_or_404(db, session_id)
        try:
            frames = validate_frames(payload.frames)
        except CameraFrameError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        report = dict(session.report or {})
        base_score = float(report.get("score") or 0)
        provider, model = _require_provider(db)
        if not resolve_capabilities(provider.config).vision:
            camera: dict[str, Any] = {
                "analyzed_frames": len(frames),
                "visible_frames": 0,
                "score": None,
                "insufficient": True,
                "metrics": {},
                "notes": [],
                "weights": {},
                "count_in_total_weight": CAMERA_SCORE_IN_TOTAL_WEIGHT,
                "model": model,
                "error": _vision_unavailable_reason(provider),
            }
        else:
            camera = await analyze_frames(provider, frames, model=model)

        apply_total_weight(camera, payload.count_in_score, base_score)
        merge_camera_report(session, camera)
        db.commit()
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
        _session_or_404(db, session_id)
        content_type = (request.headers.get("content-type") or "").split(";")[0].strip()
        if content_type != "video/webm":
            raise HTTPException(status_code=415, detail="录像格式必须是 video/webm")
        # 客户端声明时长：只信任它做上限拦截，服务端仍按字节数兜底。
        try:
            seconds = int(request.headers.get("x-recording-seconds") or 0)
        except ValueError:
            seconds = 0
        if seconds > 30 * 60:
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
