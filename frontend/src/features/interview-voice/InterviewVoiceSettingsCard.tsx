// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「面试语音」卡（Q1-D）：实时通话的**全量**参数 + 恢复默认。
 *
 * 房间里只放最常改的四项（音色 / 语速 / 断句 / 自动发送）；这里放全量，因为
 * "插话灵敏度""单段录音上限"这类参数调一次就不再动，不该占通话界面的位置。
 *
 * 值存在 `localStorage`（`voiceSettings`），与数据集无关，**不需要数据库迁移**。
 * 布局沿用设置页既有写法（`Card` + 纵向 `Space` + `Divider`），不新增 CSS 类。
 */
import {
  App,
  Button,
  Card,
  Divider,
  Segmented,
  Select,
  Slider,
  Space,
  Switch,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { BargeInSensitivity } from "./voiceSettings";
import { resetVoiceSettings, useVoiceSettings } from "./voiceSettings";

interface VoiceOption {
  id: string;
  label: string;
}

/** 一行「标签 + 控件」：设置页既有的卡片都是这个形态，不另造样式类。 */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Typography.Text>{label}</Typography.Text>
        {hint ? (
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {hint}
            </Typography.Text>
          </div>
        ) : null}
      </div>
      <div style={{ flex: "0 0 auto" }}>{children}</div>
    </div>
  );
}

export function InterviewVoiceSettingsCard() {
  useLocale();
  const { message } = App.useApp();
  const [settings, patch] = useVoiceSettings();
  const [voices, setVoices] = useState<VoiceOption[]>([]);

  // 音色清单来自后端（`/voice/tts/status`）；拿不到时下拉只显示当前值，不影响其它参数。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/interview/voice/tts/status", { method: "GET" });
        if (!response.ok) return;
        const payload = (await response.json()) as { voices?: VoiceOption[] };
        if (!cancelled) setVoices(payload.voices ?? []);
      } catch {
        // 离线/后端未就绪：保留当前音色即可。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markers = (range: [number, number]) => ({
    [range[0]]: `${range[0]}`,
    [range[1]]: `${range[1]}`,
  });

  return (
    <Card
      title={t("interviewVoice.settings.cardTitle")}
      className="settings-card"
      extra={
        <Button
          onClick={() => {
            resetVoiceSettings();
            message.success(t("interviewVoice.settings.resetDone"));
          }}
        >
          {t("interviewVoice.settings.reset")}
        </Button>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t("interviewVoice.settings.cardHint")}
      </Typography.Paragraph>

      <Space orientation="vertical" size={10} style={{ width: "100%" }}>
        <Row
          label={t("interviewVoice.settings.speak")}
          hint={t("interviewVoice.settings.speakHint")}
        >
          <Switch
            checked={settings.speakInterviewer}
            onChange={(checked) => patch({ speakInterviewer: checked })}
            aria-label={t("interviewVoice.settings.speak")}
          />
        </Row>
        <Row label={t("interviewVoice.settings.voice")}>
          <Select
            value={settings.voice}
            onChange={(value) => patch({ voice: value })}
            options={(voices.length > 0
              ? voices
              : [{ id: settings.voice, label: settings.voice }]
            ).map((item) => ({ value: item.id, label: item.label }))}
            popupMatchSelectWidth={false}
            style={{ minWidth: 180 }}
            aria-label={t("interviewVoice.settings.voice")}
          />
        </Row>
        <Row
          label={t("interviewVoice.settings.autoSend")}
          hint={t("interviewVoice.settings.autoSendHint")}
        >
          <Switch
            checked={settings.autoSend}
            onChange={(checked) => patch({ autoSend: checked })}
            aria-label={t("interviewVoice.settings.autoSend")}
          />
        </Row>
        <Row label={t("interviewVoice.settings.bargeIn")}>
          <Segmented<BargeInSensitivity>
            value={settings.bargeIn}
            onChange={(value) => patch({ bargeIn: value })}
            options={[
              { value: "slow", label: t("interviewVoice.settings.bargeInSlow") },
              { value: "normal", label: t("interviewVoice.settings.bargeInNormal") },
              { value: "fast", label: t("interviewVoice.settings.bargeInFast") },
            ]}
            aria-label={t("interviewVoice.settings.bargeIn")}
          />
        </Row>

        <Divider style={{ margin: "6px 0" }} />

        <div>
          <Typography.Text>
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
        </div>
        <div>
          <Typography.Text>
            {t("interviewVoice.settings.volume")} · {Math.round(settings.volume * 100)}
            {t("interviewVoice.settings.volumeUnit")}
          </Typography.Text>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(value) => patch({ volume: value })}
            aria-label={t("interviewVoice.settings.volume")}
          />
        </div>
        <div>
          <Typography.Text>
            {t("interviewVoice.settings.silence")} ·{" "}
            {t("interviewVoice.settings.milliseconds", { value: settings.endpointSilenceMs })}
          </Typography.Text>
          <Slider
            min={400}
            max={1500}
            step={50}
            value={settings.endpointSilenceMs}
            marks={markers([400, 1500])}
            onChange={(value) => patch({ endpointSilenceMs: value })}
            aria-label={t("interviewVoice.settings.silence")}
          />
        </div>
        <div>
          <Typography.Text>
            {t("interviewVoice.settings.filler")} ·{" "}
            {t("interviewVoice.settings.milliseconds", { value: settings.fillerHoldMs })}
          </Typography.Text>
          <Slider
            min={1000}
            max={2500}
            step={100}
            value={settings.fillerHoldMs}
            onChange={(value) => patch({ fillerHoldMs: value })}
            aria-label={t("interviewVoice.settings.filler")}
          />
        </div>
        <div>
          <Typography.Text>
            {t("interviewVoice.settings.maxRecord")} ·{" "}
            {t("interviewVoice.settings.seconds", { value: settings.maxRecordSeconds })}
          </Typography.Text>
          <Slider
            min={60}
            max={300}
            step={30}
            value={settings.maxRecordSeconds}
            onChange={(value) => patch({ maxRecordSeconds: value })}
            aria-label={t("interviewVoice.settings.maxRecord")}
          />
        </div>
      </Space>
    </Card>
  );
}

export default InterviewVoiceSettingsCard;
