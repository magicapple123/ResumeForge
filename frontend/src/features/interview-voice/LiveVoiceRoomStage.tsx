// SPDX-License-Identifier: Apache-2.0
/**
 * 通话左栏（F15）：只有面试官形象与摄像头。
 *
 * 「当前问答」已经搬去主栏顶部的 `LiveVoiceRoomTurn`（见该文件头）：左栏原来同时挂着
 * 形象和问答卡，问答卡被 `flex: 1` 拉满整列，两行内容就留出大块空白；而真正该宽的
 * 对话记录被挤在 300–420px。现在左栏是窄的形象轨，主栏才是内容。
 *
 * 声波**不读 `voice.snapshot.waveform`**：那是用户麦克风的电平，画在面试官头像上语义
 * 就是错的（面试官说话时它显示的是你房间的噪声）。现在只有"播报中"的呼吸动画——
 * 不冒充音量，也不说谎。
 */
import { AudioOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { Button, Space, Typography } from "antd";
import type { RefObject } from "react";
import { formatElapsed } from "../interview/useInterviewTimer";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { CameraRecorderController } from "./useCameraRecorder";

export function LiveVoiceRoomStage({
  faceSrc,
  interviewerName,
  speaking,
  notice,
  cameraStream,
  cameraStarting,
  cameraError,
  cameraAllowed,
  capture,
  videoRef,
  onToggleCamera,
}: {
  faceSrc: string;
  interviewerName: string;
  speaking: boolean;
  /** 合成回落 / 浏览器不支持朗读时的一句说明；null 表示一切正常。 */
  notice: string | null;
  cameraStream: MediaStream | null;
  cameraStarting: boolean;
  cameraError: boolean;
  /** 设置页总开关：关闭时不申请摄像头权限。 */
  cameraAllowed: boolean;
  /** 录制 / 抽帧状态与「停止录制」；null 表示当前没有摄像头能力。 */
  capture: CameraRecorderController;
  videoRef: RefObject<HTMLVideoElement | null>;
  onToggleCamera: () => void;
}) {
  useLocale();

  return (
    <div className="interview-live-room__stage">
      <div className={`interview-live-room__portrait${speaking ? " is-speaking" : ""}`}>
        <img src={faceSrc} alt={t("interviewVoice.room.interviewer")} />
        {/* 播报中的呼吸条：9 根柱子按序号错峰，纯 CSS 动画，与麦克风电平无关。 */}
        {speaking ? (
          <span className="interview-live-room__sound-bars" aria-hidden="true">
            {Array.from({ length: 9 }, (_, index) => (
              <i key={index} style={{ animationDelay: `${index * 90}ms` }} />
            ))}
          </span>
        ) : null}
      </div>
      <Typography.Title level={4} className="interview-live-room__name">
        {interviewerName}
      </Typography.Title>
      {speaking ? (
        <span className="interview-live-room__speaking-badge">
          <AudioOutlined aria-hidden="true" /> {t("interviewVoice.room.speakingBadge")}
        </span>
      ) : null}
      {notice ? (
        <Typography.Text type="secondary" className="interview-live-room__notice">
          {notice}
        </Typography.Text>
      ) : null}

      <div className="interview-live-room__camera-wrap">
        <div className={`interview-live-room__camera${capture.recording ? " is-recording" : ""}`}>
          {cameraStream ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label={t("interviewVoice.room.cameraPreview")}
            />
          ) : (
            <button
              type="button"
              className="interview-live-room__camera-placeholder"
              onClick={onToggleCamera}
              disabled={cameraStarting || !cameraAllowed}
            >
              <VideoCameraOutlined aria-hidden="true" />
              <span>{t("interviewVoice.room.cameraOff")}</span>
            </button>
          )}
          <Typography.Text className="interview-live-room__privacy">
            {!cameraAllowed
              ? t("interviewCamera.settings.enableHint")
              : cameraError
                ? t("interviewVoice.room.cameraError")
                : t("interviewVoice.room.localPreview")}
          </Typography.Text>
        </div>
        {capture.recording ? (
          <div className="interview-live-room__camera-rec" role="status">
            <span className="interview-live-room__rec-dot" aria-hidden="true" />
            <Typography.Text strong>{t("interviewCamera.room.recording")}</Typography.Text>
            <Typography.Text type="secondary">{formatElapsed(capture.elapsed)}</Typography.Text>
            {capture.sampled > 0 ? (
              <Typography.Text type="secondary">
                {t("interviewCamera.room.frames", { count: capture.sampled })}
              </Typography.Text>
            ) : null}
            <Button size="small" onClick={capture.stop}>
              {t("interviewCamera.room.stop")}
            </Button>
          </div>
        ) : null}
        {capture.uploadState === "uploading" ? (
          <Typography.Text type="secondary">{t("interviewCamera.room.uploading")}</Typography.Text>
        ) : null}
        {capture.uploadState === "failed" ? (
          <Space size={4} wrap>
            <Typography.Text type="danger">
              {t("interviewCamera.room.uploadFailed")}
            </Typography.Text>
            <Button size="small" onClick={capture.retry}>
              {t("interviewCamera.room.retry")}
            </Button>
          </Space>
        ) : null}
      </div>
    </div>
  );
}

export default LiveVoiceRoomStage;
