// SPDX-License-Identifier: Apache-2.0
/**
 * 摄像头 PIP（I-27）：`LiveVoiceRoomStage` 拆掉左轨之后留下的**唯一**内容。
 *
 * 三条与原 Stage 的差别：
 * 1. **关闭时不渲染任何东西**（原来会留一块 4:3 空框，写着两行 11px 灰字）——
 *    "关着"这个状态由底栏那颗按钮自己说，不需要一块空占位；
 * 2. 开启时是时间线右下角的 160×120 浮层（`position: absolute`），带"本机预览"角标；
 * 3. 录制 HUD（计时 / 抽帧数 / 停止 / 上传失败重试）贴在 PIP 底部——它属于这一路画面，
 *    搬进在场条会把 48px 撑成两行。
 *
 * 隐私口径不变：画面只在本机显示，录制与抽帧由 `useCameraRecorder` 决定，组件不发起任何请求。
 */
import { Space, Typography } from "antd";
import type { RefObject } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { formatElapsed } from "../interview/useInterviewTimer";
import type { CameraRecorderController } from "./useCameraRecorder";

export function LiveVoiceRoomCameraPip({
  videoRef,
  capture,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  capture: CameraRecorderController;
}) {
  useLocale();
  return (
    <div
      className={`interview-live-room__pip${capture.recording ? " is-recording" : ""}`}
      data-testid="camera-pip"
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label={t("interviewVoice.room.cameraPreview")}
      />
      <span className="interview-live-room__pip-badge">
        {t("interviewVoice.room.localPreview")}
      </span>
      {capture.recording ? (
        <div className="interview-live-room__pip-rec" role="status">
          <span className="interview-live-room__rec-dot" aria-hidden="true" />
          <Typography.Text strong>{t("interviewCamera.room.recording")}</Typography.Text>
          <Typography.Text type="secondary">{formatElapsed(capture.elapsed)}</Typography.Text>
          {capture.sampled > 0 ? (
            <Typography.Text type="secondary">
              {t("interviewCamera.room.frames", { count: capture.sampled })}
            </Typography.Text>
          ) : null}
          <button type="button" className="interview-live-room__pip-stop" onClick={capture.stop}>
            {t("interviewCamera.room.stop")}
          </button>
        </div>
      ) : null}
      {capture.uploadState === "uploading" ? (
        <Typography.Text type="secondary" className="interview-live-room__pip-note">
          {t("interviewCamera.room.uploading")}
        </Typography.Text>
      ) : null}
      {capture.uploadState === "failed" ? (
        <Space size={4} wrap className="interview-live-room__pip-note">
          <Typography.Text type="danger">{t("interviewCamera.room.uploadFailed")}</Typography.Text>
          <button type="button" className="interview-live-room__pip-stop" onClick={capture.retry}>
            {t("interviewCamera.room.retry")}
          </button>
        </Space>
      ) : null}
    </div>
  );
}

export default LiveVoiceRoomCameraPip;
