// SPDX-License-Identifier: Apache-2.0
/**
 * 通话底栏（Q1-B → I-27 收敛为一条呼叫条）。
 *
 * I-27 的三处收敛：
 * - 左：`常开 / 按住说话`；中：**唯一一颗麦克风**（外圈画 `voice.snapshot.waveform` 的电平）；
 *   右：摄像头（开关 + 状态二合一）、设置、暂停。
 * - **状态不再重复**：原来「麦克风 · 未开启」和按钮文案说同一件事，现在状态只在在场条的
 *   胶囊里说一次（胶囊读的是同一条优先级阶梯）。
 * - 摄像头只留这一颗按钮（左轨占位框随左轨一起删了），总开关关着时用悬停标题说原因
 *   （I-26：置灰的按钮点不动，也就永远看不到"为什么打不开"）。
 */
import {
  AudioMutedOutlined,
  AudioOutlined,
  PauseCircleOutlined,
  VideoCameraOutlined,
  VideoCameraAddOutlined,
} from "@ant-design/icons";
import { Button, Segmented } from "antd";
import type { CSSProperties } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { EndpointMode } from "./endpoint";
import type { InterviewVoiceController } from "./useInterviewVoice";
import { VoiceSettingsPopover, type VoiceOption } from "./VoiceSettingsPopover";

/** 波形 → 0..1 的电平：只取均值，不做峰值保持（峰值保持会一直亮着，像"还在说"）。 */
function levelOf(waveform: readonly number[]): number {
  if (waveform.length === 0) return 0;
  const sum = waveform.reduce((total, value) => total + Math.max(0, value), 0);
  return Math.min(1, sum / waveform.length);
}

export function LiveVoiceRoomControls({
  voice,
  mode,
  onModeChange,
  cameraStream,
  cameraStarting,
  cameraNotice,
  onToggleCamera,
  voices,
  onPause,
}: {
  voice: InterviewVoiceController;
  mode: EndpointMode;
  onModeChange: (mode: EndpointMode) => void;
  cameraStream: MediaStream | null;
  cameraStarting: boolean;
  /**
   * 「为什么打不开摄像头」：与点击后的轻提示**同一句话**（I-26）。
   * 这里挂成按钮的悬停提示，让用户在点之前就能看见原因。
   */
  cameraNotice: string | null;
  onToggleCamera: () => void;
  voices: VoiceOption[];
  onPause?: () => void;
}) {
  useLocale();
  const level = voice.enabled ? levelOf(voice.snapshot.waveform) : 0;
  return (
    <footer className="interview-live-room__controls">
      <div className="interview-live-room__controls-left">
        <Segmented<EndpointMode>
          value={mode}
          onChange={onModeChange}
          options={[
            { value: "always-on", label: t("interviewVoice.mode.alwaysOn") },
            { value: "push-to-talk", label: t("interviewVoice.mode.pushToTalk") },
          ]}
          aria-label={t("interviewVoice.mode.label")}
        />
        {mode === "push-to-talk" && voice.enabled ? (
          <Button
            type="primary"
            onPointerUp={voice.releasePushToTalk}
            onClick={voice.releasePushToTalk}
          >
            {t("interviewVoice.action.hold")}
          </Button>
        ) : null}
      </div>

      <div className="interview-live-room__controls-middle">
        {/* 电平环：波形是**用户麦克风**的电平，从这里读才是对的（头像上的柱子是装饰）。 */}
        <span
          className={`interview-live-room__mic-ring${voice.enabled ? " is-live" : ""}`}
          style={{ "--mic-level": level } as CSSProperties}
          aria-hidden="true"
        />
        <Button
          type={voice.enabled ? "default" : "primary"}
          shape="circle"
          size="large"
          icon={
            voice.enabled ? (
              <AudioMutedOutlined aria-hidden="true" />
            ) : (
              <AudioOutlined aria-hidden="true" />
            )
          }
          loading={voice.starting}
          onClick={voice.toggle}
          aria-label={
            voice.enabled ? t("interviewVoice.room.micOff") : t("interviewVoice.room.micOn")
          }
        />
      </div>

      <div className="interview-live-room__controls-right">
        <Button
          icon={
            cameraStream ? (
              <VideoCameraOutlined aria-hidden="true" />
            ) : (
              <VideoCameraAddOutlined aria-hidden="true" />
            )
          }
          loading={cameraStarting && !cameraStream}
          onClick={onToggleCamera}
          // 不打 disabled：置灰的按钮点不动，也就永远看不到"为什么打不开"。
          title={cameraNotice ?? undefined}
          aria-description={cameraNotice ?? undefined}
        >
          {cameraStream ? t("interviewVoice.room.cameraStop") : t("interviewVoice.room.cameraOn")}
        </Button>
        <VoiceSettingsPopover voices={voices} compact />
        {onPause ? (
          <Button icon={<PauseCircleOutlined aria-hidden="true" />} onClick={onPause}>
            {t("interviewPage.paused.action")}
          </Button>
        ) : null}
      </div>
    </footer>
  );
}

export default LiveVoiceRoomControls;
