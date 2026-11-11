// SPDX-License-Identifier: Apache-2.0
/**
 * 26A / 26B / 26G 的界面：常开指示（红点 + 实时波形）+ 一键关闭 + 双模式切换。
 *
 * 纯渲染：状态机在 ``voiceSession.ts``、麦克风在 ``capture.ts``、React 接线在
 * ``useInterviewVoice.ts``。这里只把快照翻成一句中文状态与一个波形。
 *
 * 常开麦克风必须有指示（26A 验收）且一键可关：总开关就是同一颗按钮，点第二次立即
 * 释放轨道；隐私提示常驻在状态行旁边。
 */
import { AudioMutedOutlined, AudioOutlined } from "@ant-design/icons";
import { Alert, Button, Segmented, Space } from "antd";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { EndpointMode } from "./endpoint";
import type { InterviewVoiceController, VoiceErrorCode } from "./useInterviewVoice";
import "./interviewVoice.css";

const ERROR_KEYS: Record<VoiceErrorCode, MessageKey> = {
  unsupported: "interviewVoice.error.unsupported",
  "microphone-denied": "interviewVoice.error.microphoneDenied",
  "microphone-missing": "interviewVoice.error.microphoneMissing",
  "microphone-busy": "interviewVoice.error.microphoneBusy",
  "microphone-failed": "interviewVoice.error.microphoneFailed",
  "transcribe-failed": "interviewVoice.error.transcribeFailed",
  empty: "interviewVoice.error.empty",
};

function statusKey(voice: InterviewVoiceController): MessageKey {
  if (voice.starting) return "interviewVoice.status.starting";
  if (!voice.enabled) return "interviewVoice.status.off";
  if (voice.snapshot.ducked) return "interviewVoice.status.bargeIn";
  if (voice.snapshot.thinking) return "interviewVoice.status.thinking";
  if (voice.snapshot.phase === "waiting-asr") return "interviewVoice.status.waitingAsr";
  if (voice.snapshot.phase === "extended") return "interviewVoice.status.extended";
  return "interviewVoice.status.listening";
}

export function InterviewVoiceBar({
  voice,
  mode,
  onModeChange,
  disabled = false,
}: {
  voice: InterviewVoiceController;
  mode: EndpointMode;
  onModeChange: (mode: EndpointMode) => void;
  /** 生成中/结束等场景由上层整体禁用（录音中仍可切换模式则不受影响）。 */
  disabled?: boolean;
}) {
  useLocale();
  if (!voice.supported) return null;
  const hintKey: MessageKey | null = voice.snapshot.ducked
    ? "interviewVoice.hint.interrupted"
    : voice.snapshot.thinking
      ? "interviewVoice.hint.thinking"
      : voice.enabled
        ? "interviewVoice.hint.privacy"
        : null;

  return (
    <div className="interview-voice-bar">
      <Space size={8} align="center" wrap>
        <Button
          size="small"
          icon={voice.enabled ? <AudioMutedOutlined /> : <AudioOutlined />}
          onClick={voice.toggle}
          loading={voice.starting}
          disabled={disabled && !voice.enabled}
        >
          {voice.enabled ? t("interviewVoice.action.stop") : t("interviewVoice.action.start")}
        </Button>
        <Segmented<EndpointMode>
          size="small"
          value={mode}
          onChange={(value) => onModeChange(value)}
          disabled={!voice.enabled}
          options={[
            { value: "always-on", label: t("interviewVoice.mode.alwaysOn") },
            { value: "push-to-talk", label: t("interviewVoice.mode.pushToTalk") },
          ]}
        />
        <span className="interview-voice-bar__status" role="status" aria-live="polite">
          <span
            className={
              voice.enabled
                ? "interview-voice-bar__dot"
                : "interview-voice-bar__dot interview-voice-bar__dot--idle"
            }
          />
          {t(statusKey(voice))}
        </span>
        {voice.enabled ? (
          <span
            className="interview-voice-bar__waveform"
            role="img"
            aria-label={t("interviewVoice.waveform.label")}
          >
            {Array.from({ length: 24 }, (_, index) => {
              const level = voice.snapshot.waveform[index] ?? 0;
              return (
                <span
                  key={index}
                  className="interview-voice-bar__bar"
                  style={{ height: `${Math.round(3 + level * 13)}px` }}
                />
              );
            })}
          </span>
        ) : null}
        {voice.enabled && mode === "push-to-talk" ? (
          <Button
            size="small"
            className="interview-voice-bar__hold"
            onPointerUp={voice.releasePushToTalk}
            onClick={voice.releasePushToTalk}
          >
            {t("interviewVoice.action.hold")}
          </Button>
        ) : null}
      </Space>
      {hintKey ? <span className="interview-voice-bar__hint">{t(hintKey)}</span> : null}
      {voice.error ? (
        <Alert
          className="interview-voice-bar__error"
          type="warning"
          showIcon
          closable
          title={t(ERROR_KEYS[voice.error])}
          onClose={voice.clearError}
        />
      ) : null}
    </div>
  );
}

export default InterviewVoiceBar;
