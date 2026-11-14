// SPDX-License-Identifier: Apache-2.0
/**
 * 通话底栏（Q1-B）：左侧「模式 + 麦克风 + 麦克风状态」，右侧「摄像头 + 设置 + 暂停」。
 *
 * 两条改动的理由：
 * - 状态行原来挂在面试官名字下面（"实时语音未开启"读起来像面试官的状态），现在移到底栏
 *   左侧并明确写成「麦克风 · …」；
 * - 主操作只有一个 primary（未开麦时是「开启麦克风」），其余 ghost/默认，视觉上不再一排
 *   按钮一样重。
 */
import {
  AudioMutedOutlined,
  AudioOutlined,
  PauseCircleOutlined,
  VideoCameraOutlined,
  VideoCameraAddOutlined,
} from "@ant-design/icons";
import { Button, Segmented } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { EndpointMode } from "./endpoint";
import type { InterviewVoiceController } from "./useInterviewVoice";
import { VoiceSettingsPopover, type VoiceOption } from "./VoiceSettingsPopover";

export function LiveVoiceRoomControls({
  voice,
  mode,
  onModeChange,
  statusLabel,
  cameraStream,
  cameraStarting,
  onToggleCamera,
  voices,
  onPause,
}: {
  voice: InterviewVoiceController;
  mode: EndpointMode;
  onModeChange: (mode: EndpointMode) => void;
  /** 已本地化的麦克风状态（底栏左侧那一段）。 */
  statusLabel: string;
  cameraStream: MediaStream | null;
  cameraStarting: boolean;
  onToggleCamera: () => void;
  voices: VoiceOption[];
  onPause?: () => void;
}) {
  useLocale();
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
        <Button
          type={voice.enabled ? "default" : "primary"}
          icon={
            voice.enabled ? (
              <AudioMutedOutlined aria-hidden="true" />
            ) : (
              <AudioOutlined aria-hidden="true" />
            )
          }
          loading={voice.starting}
          onClick={voice.toggle}
        >
          {voice.enabled ? t("interviewVoice.room.micOff") : t("interviewVoice.room.micOn")}
        </Button>
        {mode === "push-to-talk" && voice.enabled ? (
          <Button type="primary" onPointerUp={voice.releasePushToTalk} onClick={voice.releasePushToTalk}>
            {t("interviewVoice.action.hold")}
          </Button>
        ) : null}
        {/* 状态行：明确说是"麦克风"，不再挂在面试官名字下面。 */}
        <span className="interview-live-room__mic-status" role="status">
          <span
            className={`interview-live-room__mic-dot${voice.enabled ? " is-live" : ""}`}
            aria-hidden="true"
          />
          {t("interviewVoice.room.micStatus")} · {statusLabel}
        </span>
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
