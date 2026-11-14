// SPDX-License-Identifier: Apache-2.0
/**
 * 通话设置弹层（Q1-D）：音色 / 语速 / 断句 / 自动发送。
 *
 * 房间里只放**最常改的四项**：进设置页要退出通话，而"这句话断得太早"这类问题必须在通话中
 * 立刻能调。全量参数与「恢复默认」在设置页的「面试语音」卡里（同一个 `voiceSettings` 源，
 * 两边改的是同一份值）。
 *
 * 刻意不暴露：VAD 阈值、duck 深度、预录帧数——调了只会被当成 bug。
 */
import { SoundOutlined } from "@ant-design/icons";
import { Button, Popover, Select, Slider, Switch, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useVoiceSettings } from "./voiceSettings";

export interface VoiceOption {
  id: string;
  label: string;
}

export function VoiceSettingsPopover({
  voices,
  compact = false,
}: {
  /** 后端给的音色清单；拿不到时只留当前值，不阻塞通话。 */
  voices: VoiceOption[];
  /** 紧凑模式只显示图标按钮（房间头部/底栏用）。 */
  compact?: boolean;
}) {
  useLocale();
  const [settings, patch] = useVoiceSettings();
  const content = (
    <div className="interview-voice-settings">
      <div className="interview-voice-settings__row">
        <Typography.Text>{t("interviewVoice.settings.speak")}</Typography.Text>
        <Switch
          size="small"
          checked={settings.speakInterviewer}
          onChange={(checked) => patch({ speakInterviewer: checked })}
          aria-label={t("interviewVoice.settings.speak")}
        />
      </div>
      <Typography.Text type="secondary" className="interview-voice-settings__hint">
        {t("interviewVoice.settings.speakHint")}
      </Typography.Text>

      <div className="interview-voice-settings__row">
        <Typography.Text>{t("interviewVoice.settings.voice")}</Typography.Text>
        <Select
          size="small"
          value={settings.voice}
          onChange={(value) => patch({ voice: value })}
          options={(voices.length > 0 ? voices : [{ id: settings.voice, label: settings.voice }]).map(
            (item) => ({ value: item.id, label: item.label }),
          )}
          popupMatchSelectWidth={false}
          aria-label={t("interviewVoice.settings.voice")}
        />
      </div>

      <Typography.Text className="interview-voice-settings__label">
        {t("interviewVoice.settings.rate")} ·{" "}
        {t("interviewVoice.settings.times", { value: settings.rate.toFixed(1) })}
      </Typography.Text>
      <Slider
        min={0.7}
        max={1.5}
        step={0.1}
        value={settings.rate}
        onChange={(value) => patch({ rate: value })}
        aria-label={t("interviewVoice.settings.rate")}
      />

      <Typography.Text className="interview-voice-settings__label">
        {t("interviewVoice.settings.silence")} ·{" "}
        {t("interviewVoice.settings.milliseconds", { value: settings.endpointSilenceMs })}
      </Typography.Text>
      <Slider
        min={400}
        max={1500}
        step={50}
        value={settings.endpointSilenceMs}
        onChange={(value) => patch({ endpointSilenceMs: value })}
        aria-label={t("interviewVoice.settings.silence")}
      />

      <div className="interview-voice-settings__row">
        <Typography.Text>{t("interviewVoice.settings.autoSend")}</Typography.Text>
        <Switch
          size="small"
          checked={settings.autoSend}
          onChange={(checked) => patch({ autoSend: checked })}
          aria-label={t("interviewVoice.settings.autoSend")}
        />
      </div>
      <Typography.Text type="secondary" className="interview-voice-settings__hint">
        {t("interviewVoice.settings.autoSendHint")}
      </Typography.Text>
      <Typography.Text type="secondary" className="interview-voice-settings__hint">
        {t("interviewVoice.settings.roomHint")}
      </Typography.Text>
    </div>
  );

  return (
    <Popover
      trigger={["click"]}
      placement="topRight"
      content={content}
      title={t("interviewVoice.settings.title")}
    >
      <Button
        icon={<SoundOutlined aria-hidden="true" />}
        aria-label={t("interviewVoice.room.settings")}
      >
        {compact ? null : t("interviewVoice.room.settings")}
      </Button>
    </Popover>
  );
}

export default VoiceSettingsPopover;
