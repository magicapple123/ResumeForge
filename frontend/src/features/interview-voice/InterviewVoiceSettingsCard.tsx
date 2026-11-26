// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「面试语音」卡（Q1-D）：实时通话的**全量**参数 + 恢复默认。
 *
 * 房间里只放最常改的四项（音色 / 语速 / 断句 / 自动发送）；这里放全量，因为
 * "插话灵敏度""单段录音上限"这类参数调一次就不再动，不该占通话界面的位置。
 *
 * 值存在 `localStorage`（`voiceSettings`），与数据集无关，**不需要数据库迁移**。
 * 开关 / 档位 / 下拉沿用设置页既有写法（`Card` + 纵向 `Space` + `Divider`）；
 * 五个滑块另走两列网格（`voice-settings-grid.css`，见 #12 的注释）。
 *
 * 两处与"换厂商"有关的判断都在这里，因为它们都是**用户必须看见**的事实：
 * - **合成服务档位**：两档并列，音色清单跟着档位走；存的音色属于另一档时显式提示
 *   "已改用 X"（静默变声等同于"设置坏了"）。
 * - **单段录音上限**：上限定到哪里由 `/transcribe/status` 说了算（DeepSeek 因不支持
 *   流式只有 120 秒）。滑块的上界跟着它走，并且**用一句话说明原因**——静默把用户
 *   拉到 300 的值砍掉，用户只会以为录音坏了。
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
import { getTranscribeStatus, type TranscribeStatus } from "./asrApi";
import {
  TTS_PROVIDER_LABEL_KEYS,
  TTS_PROVIDER_ORDER,
  fallbackNotice,
  providerAvailable,
  providerVoicesOf,
  resolveTtsVoice,
  type TtsProvider,
  type TtsStatusPayload,
} from "./ttsVoices";
import type { BargeInSensitivity } from "./voiceSettings";
import { resetVoiceSettings, useVoiceSettings, VOICE_SETTING_RANGES } from "./voiceSettings";
import "./voice-settings-grid.css";

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

/**
 * 网格里的一格滑块（#12）：**标签左 + 值右**占一行人，滑块自己占第二行。
 *
 * 为什么不再写成 `标签 · 值` 一整串：那种写法下标签与值不可分割，读屏会把
 * 「播报语速 · 1.0 倍」当成一个字段名念出来；拆成两个节点后，滑块自己的 `aria-label`
 * 才是字段名，值是可独立更新的文本。
 *
 * 滑块不给宽度：宽度由网格列决定（`minmax(0,1fr)`），所以轨道永远不超过半宽——
 * 原来那 5 个滑块是 `width:100%`，轨道近 1000px，音量拉满时滑块头贴着右缘像滚动条。
 */
function SliderField({
  label,
  value,
  min,
  max,
  step,
  current,
  onChange,
  last = false,
}: {
  label: string;
  /** 已经格式化好的值（含单位），由调用方按各自口径给。 */
  value: string;
  min: number;
  max: number;
  step: number;
  current: number;
  onChange: (value: number) => void;
  /** 最后一格：只占左列，不拉满（两列布局里被拉满的那格看起来像另一种控件）。 */
  last?: boolean;
}) {
  return (
    <div className={`voice-setting-field${last ? " voice-setting-field--last" : ""}`}>
      <div className="voice-setting-field__head">
        <Typography.Text>{label}</Typography.Text>
        <span className="voice-setting-field__value">{value}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={onChange}
        // 标签在上一行已经可见，但读屏不看布局：滑块自己得有个名字。
        // antd 6 的 `aria-label` 不会forward到 role="slider" 的滑块上（实测 DOM 里为 null），
        // 要名字只能走 `ariaLabelForHandle`。
        ariaLabelForHandle={label}
      />
    </div>
  );
}

export function InterviewVoiceSettingsCard() {
  useLocale();
  const { message } = App.useApp();
  const [settings, patch] = useVoiceSettings();
  const [tts, setTts] = useState<TtsStatusPayload | null>(null);
  const [asr, setAsr] = useState<TranscribeStatus | null>(null);

  // 合成档位与音色清单来自后端（`/voice/tts/status`）；拿不到时用内建回退表，音色不空。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/interview/voice/tts/status", { method: "GET" });
        if (!response.ok) return;
        const payload = (await response.json()) as TtsStatusPayload;
        if (!cancelled) setTts(payload);
      } catch {
        // 离线/后端未就绪：内建回退表足够渲染下拉。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 录音上限的唯一口径：优先信服务端（它会按协议给 120 秒或 180 秒）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await getTranscribeStatus();
        if (!cancelled) setAsr(snapshot);
      } catch {
        // 探测失败：滑块保持本地区间，不拦着用户调。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const provider = settings.ttsProvider;
  const voiceOptions = providerVoicesOf(tts, provider).voices;
  const resolved = resolveTtsVoice(tts, provider, settings.voice);
  const providerMissingKey = !providerAvailable(tts, provider);
  /** 服务端给的单段上限；拿不到时用本地区间上界。 */
  const recordCap = Math.min(VOICE_SETTING_RANGES.maxRecordSeconds[1], asr?.max_seconds ?? 300);
  const recordValue = Math.min(settings.maxRecordSeconds, recordCap);

  const changeProvider = (next: TtsProvider) => {
    const target = resolveTtsVoice(tts, next, settings.voice);
    // 一次性把档位与音色一起落盘：分两次 patch 会出现"档位换了、音色还是旧的"的中间态。
    patch({ ttsProvider: next, voice: target.voice });
    if (target.fellBack) message.info(fallbackNotice(target));
  };

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
        <Row
          label={t("ttsProvider.label")}
          hint={providerMissingKey ? t("ttsProvider.missingKey") : t("ttsProvider.hint")}
        >
          <Segmented<TtsProvider>
            size="small"
            value={provider}
            onChange={(value) => changeProvider(value)}
            options={TTS_PROVIDER_ORDER.map((item) => ({
              value: item,
              label: t(TTS_PROVIDER_LABEL_KEYS[item]),
            }))}
            aria-label={t("ttsProvider.label")}
          />
        </Row>
        <Row label={t("interviewVoice.settings.voice")}>
          <Select
            value={resolved.voice}
            onChange={(value) => patch({ voice: value })}
            options={(voiceOptions.length > 0
              ? voiceOptions
              : [{ id: resolved.voice, label: resolved.voice }]
            ).map((item) => ({ value: item.id, label: item.label }))}
            popupMatchSelectWidth={false}
            style={{ minWidth: 180 }}
            aria-label={t("interviewVoice.settings.voice")}
          />
        </Row>
        {/*
          旧音色落在新档：显式说一句"已改用 X"。这不是错误（合成照样能用），
          所以用次要色而不是 danger——但它必须出现，否则用户会以为音色设置丢了。
        */}
        {resolved.fellBack ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {fallbackNotice(resolved)}
          </Typography.Text>
        ) : null}
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

        {/*
          五个滑块两列排（#12）。原来每个滑块都是**独占整行的 100% 宽**：内容区近 1000px，
          轨道就有一千像素长，音量拉满时滑块头贴着右缘、看起来更像滚动条；而 400/1500 这类
          常驻 marks 又把轨道压得更挤。

          现在：每格「标签左 + 值右」一行、滑块一行，两列等宽；**第 5 个只占左列不拉满**，
          单段上限的那句原因移出格子放到网格下方（它说的是"服务端为什么只给 120 秒"，
          不是这一格的值）。窄窗用容器查询变单列——视口断点在这里不可靠，卡片宽度由侧栏决定。
        */}
        <div className="voice-settings-sliders">
          <div className="voice-settings-grid">
            <SliderField
              label={t("interviewVoice.settings.rate")}
              value={t("interviewVoice.settings.times", { value: settings.rate.toFixed(1) })}
              min={0.7}
              max={1.5}
              step={0.1}
              current={settings.rate}
              onChange={(value) => patch({ rate: value })}
            />
            <SliderField
              label={t("interviewVoice.settings.volume")}
              value={`${Math.round(settings.volume * 100)}${t("interviewVoice.settings.volumeUnit")}`}
              min={0}
              max={1}
              step={0.05}
              current={settings.volume}
              onChange={(value) => patch({ volume: value })}
            />
            <SliderField
              label={t("interviewVoice.settings.silence")}
              value={t("interviewVoice.settings.milliseconds", {
                value: settings.endpointSilenceMs,
              })}
              min={400}
              max={1500}
              step={50}
              current={settings.endpointSilenceMs}
              onChange={(value) => patch({ endpointSilenceMs: value })}
            />
            <SliderField
              label={t("interviewVoice.settings.filler")}
              value={t("interviewVoice.settings.milliseconds", { value: settings.fillerHoldMs })}
              min={1000}
              max={2500}
              step={100}
              current={settings.fillerHoldMs}
              onChange={(value) => patch({ fillerHoldMs: value })}
            />
            <SliderField
              // 第 5 个独占左列：两列网格里被"拉满"的那一格看起来像另一种控件。
              last
              label={t("interviewVoice.settings.maxRecord")}
              value={t("interviewVoice.settings.seconds", { value: recordValue })}
              min={VOICE_SETTING_RANGES.maxRecordSeconds[0]}
              // 上界跟着服务端走：选 DeepSeek 时是 120（不支持流式），其余是 300。
              max={recordCap}
              step={30}
              current={recordValue}
              onChange={(value) => patch({ maxRecordSeconds: value })}
            />
          </div>

          {asr && asr.max_seconds < VOICE_SETTING_RANGES.maxRecordSeconds[1] ? (
            <Typography.Text type="secondary" className="voice-settings-cap">
              {/* 原因分两种：只有 DeepSeek 是"不支持流式"（上游硬限制 120 秒），
                  其它服务商只是服务端上限比滑块小。同一句话套在百炼会说假话。 */}
              {asr.protocol === "deepseek"
                ? t("voiceMemo.hint.streamLimited", { seconds: asr.max_seconds })
                : t("voiceMemo.hint.serverCap", { seconds: asr.max_seconds })}
            </Typography.Text>
          ) : null}
        </div>
      </Space>
    </Card>
  );
}

export default InterviewVoiceSettingsCard;
