// SPDX-License-Identifier: Apache-2.0
/**
 * 麦克风按钮三态（计划 §6 T12）：
 *
 * - 空闲：麦克风图标按钮，hover 提示单段上限；
 * - 录音中：**不是 Button**——红色脉冲点 + mm:ss。同一行里往往已经有 danger 的
 *   「停止本轮」，再来一颗红 Button 会让人分不清哪个是哪个；
 * - 转写中：转圈 +「识别中」，此时点它没有意义（loading 天然挡住点击）。
 *
 * 下方 12px 提示行只在 inline 形态出现：录音中显示「音频会发送到 <host>」（隐私告知），
 * 未配置时显示「未配置语音服务 / 去哪里配」，出错时显示对应错误文案。compact 形态
 * （面试追问的 Space.Compact 里）只给控件本身，提示与错误由所在卡片排版——紧凑容器里
 * 塞不下一行提示。
 *
 * R06-C：inline 形态的空间提示行是**绝对定位**的（见 `styles/voice-input.css`），不再
 * 参与 `.voice-input` 的高度计算——此前它作为第二行子元素把整个包裹撑高，而工具栏是
 * `align-items: center`，于是麦克风被顶得比同级控件高出一截。
 *
 * 父组件需要联动（例如录音中禁用「提交回答」）时，自己调 useVoiceInput 并把结果作为
 * voice 注入；不注入时组件内部自己持有一个 controller（助手输入框就是这种用法）。
 */

import { AudioOutlined, StopOutlined } from "@ant-design/icons";
import { Button, Tooltip, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useVoiceInput, type VoiceController } from "../../hooks/useVoiceInput";
import { formatVoiceSeconds } from "./voiceFormat";
import "../../styles/voice-input.css";

/** 提示行：错误优先，其次录音中的隐私告知，最后是"未配置"的指路。 */
function VoiceHint({ voice }: { voice: VoiceController }) {
  if (voice.error) {
    return (
      <Typography.Text type="danger" className="voice-input-hint">
        {voice.error.message}
      </Typography.Text>
    );
  }
  if (voice.status === "recording") {
    if (!voice.providerHost) return null;
    return (
      <Typography.Text type="secondary" className="voice-input-hint">
        {t("voiceInput.hint.privacy", { host: voice.providerHost })}
      </Typography.Text>
    );
  }
  if (voice.configured === false) {
    return (
      <Typography.Text type="secondary" className="voice-input-hint">
        {t("voiceInput.hint.notConfigured")} · {t("voiceInput.hint.notConfiguredHelp")}
      </Typography.Text>
    );
  }
  return null;
}

export interface VoiceButtonProps {
  /** 转写成功后的文字；只回调，绝不替调用方提交。 */
  onTranscribed: (text: string) => void;
  maxSeconds?: number;
  disabled?: boolean;
  /** inline = 自带提示行（答题框/助手输入区）；compact = 只给控件（Space.Compact 内）。 */
  variant?: "inline" | "compact";
  /** 外层已持有 controller 时注入（面试页要据此禁用提交 / 拦截 Enter）。 */
  voice?: VoiceController;
}

export function VoiceButton({
  onTranscribed,
  maxSeconds = 180,
  disabled,
  variant = "inline",
  voice,
}: VoiceButtonProps) {
  useLocale();
  const ownVoice = useVoiceInput({
    maxSeconds,
    onTranscribed,
    probeStatus: !voice,
  });
  const active = voice ?? ownVoice;
  const recording = active.status === "recording";
  const transcribing = active.status === "transcribing";

  if (recording) {
    const recordingButton = (
      <button
        type="button"
        className={
          variant === "compact"
            ? "voice-recording-button voice-recording-button--compact"
            : "voice-recording-button"
        }
        aria-label={t("voiceInput.aria.stop")}
        title={t("voiceInput.aria.stop")}
        onClick={active.stop}
      >
        <span className="voice-recording-dot" aria-hidden="true" />
        <span className="voice-recording-time">{formatVoiceSeconds(active.seconds)}</span>
        <StopOutlined className="voice-recording-stop" aria-hidden="true" />
      </button>
    );
    if (variant === "compact") return recordingButton;
    return (
      <span className="voice-input">
        {recordingButton}
        <VoiceHint voice={active} />
      </span>
    );
  }

  const button = (
    <Tooltip title={t("voiceInput.tooltip.start", { seconds: maxSeconds })}>
      <Button
        // 空闲态是**文字型**控件（无边框、透明底，hover 才给浅底）：工具栏右侧它挨着
        // 无边框的 chip 与圆形发送键，带边框的按钮在那排里显得格格不入。
        // 录音态刻意不动——那颗红描边胶囊是"正在录音"的唯一视觉信号。
        // compact 形态（面试追问的 Space.Compact）保持默认按钮：紧凑条本身负责拼接边框。
        type={variant === "compact" ? "default" : "text"}
        className={
          variant === "compact"
            ? "voice-input-button voice-input-button--compact"
            : "voice-input-button"
        }
        icon={<AudioOutlined />}
        loading={transcribing}
        disabled={disabled || undefined}
        aria-label={t("voiceInput.aria.start")}
        onClick={() => {
          if (active.configured === false) active.clearError();
          active.start();
        }}
      >
        {transcribing ? t("voiceInput.status.transcribing") : null}
      </Button>
    </Tooltip>
  );
  if (variant === "compact") return button;
  return (
    <span className="voice-input">
      {button}
      <VoiceHint voice={active} />
    </span>
  );
}

export default VoiceButton;
