// SPDX-License-Identifier: Apache-2.0
/**
 * 「上下文窗口」选择器（需求 #6）：预设值写回**当前模型配置**，另给自定义输入。
 *
 * 为什么写回模型配置而不是存成"这个对话的偏好"：窗口是模型的能力常数（同一个模型
 * 换了窗口只会算错），所以它属于配置；面板下方那行小字就是为了让用户知道"这一改会
 * 影响所有用这个模型的对话"。
 *
 * 保存走 `PUT /settings/llm`（`saveLLMConfig`）——那是"保存为当前生效配置"的既有
 * 端点，不是新增接口；保存成功后广播 `bumpLLMConfig`，页头的模型 chip 立刻重取。
 */

import { App, InputNumber, Select } from "antd";
import { useState } from "react";
import { getLLMConfig, saveLLMConfig } from "../../../../api/settings";
import { t } from "../../../../i18n";
import type { MessageKey } from "../../../../i18n";
import { useLocale } from "../../../../i18n/i18nContext";
import { bumpLLMConfig } from "../../../settings/llmConfigEvents";

/** 预设窗口（value = token 数，label 走语言包：预设名也是用户可见文案）。 */
const PRESETS: { value: number; labelKey: MessageKey }[] = [
  { value: 32_000, labelKey: "contextUsage.window.preset32k" },
  { value: 64_000, labelKey: "contextUsage.window.preset64k" },
  { value: 128_000, labelKey: "contextUsage.window.preset128k" },
  { value: 200_000, labelKey: "contextUsage.window.preset200k" },
  { value: 1_000_000, labelKey: "contextUsage.window.preset1m" },
];

/** 「自定义…」的哨兵值：它不是窗口大小，只是让输入框冒出来。 */
const CUSTOM = "custom";
/** 后端 `LLMConfig.context_window_tokens` 的上限；填更大值会被拒，界面先挡住。 */
const MAX_WINDOW = 2_000_000;

export interface ContextWindowSelectProps {
  /** 当前窗口；0 = 未设置。 */
  windowTokens: number;
  /** 保存成功后的新窗口（上层据此本地重算百分比）。 */
  onSaved: (windowTokens: number) => void;
}

export default function ContextWindowSelect({ windowTokens, onSaved }: ContextWindowSelectProps) {
  useLocale();
  const { message } = App.useApp();
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState<number | null>(windowTokens || null);
  const [saving, setSaving] = useState(false);

  const presetMatched = PRESETS.some((preset) => preset.value === windowTokens);
  // 三个态：命中预设 → 显示预设；有值但不命中 → 显示「自定义」；0 = 未设置 → 占位符。
  const selectValue =
    !customizing && presetMatched ? windowTokens : windowTokens > 0 ? CUSTOM : undefined;

  const save = async (next: number) => {
    if (saving || next <= 0 || next > MAX_WINDOW) return;
    setSaving(true);
    try {
      const config = await getLLMConfig();
      const saved = await saveLLMConfig({ ...config, context_window_tokens: next });
      bumpLLMConfig();
      message.success(t("contextUsage.window.saved"));
      onSaved(saved.context_window_tokens ?? next);
    } catch (error) {
      // 失败要说清"怎么办"：留在这里，用户改个值或稍后重试都能再写一次。
      message.error(error instanceof Error ? error.message : t("contextUsage.window.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="assistant-context-window">
      <div className="assistant-context-window-row">
        <span className="assistant-context-window-label">{t("contextUsage.window.label")}</span>
        <Select
          size="small"
          className="assistant-context-window-select"
          value={selectValue}
          loading={saving}
          options={[
            ...PRESETS.map((preset) => ({ value: preset.value, label: t(preset.labelKey) })),
            { value: CUSTOM, label: t("contextUsage.window.custom") },
          ]}
          onChange={(value) => {
            if (value === CUSTOM) {
              setCustomizing(true);
              setDraft(windowTokens || null);
              return;
            }
            setCustomizing(false);
            void save(Number(value));
          }}
        />
      </div>
      {customizing || !presetMatched ? (
        <InputNumber
          size="small"
          className="assistant-context-window-custom"
          min={1}
          max={MAX_WINDOW}
          value={draft}
          placeholder={t("contextUsage.window.customPlaceholder")}
          onChange={(value) => setDraft(typeof value === "number" ? value : null)}
          onPressEnter={() => draft !== null && void save(draft)}
          onBlur={() => draft !== null && draft !== windowTokens && void save(draft)}
        />
      ) : null}
      {/* 一行小字：窗口是模型级设置，不是这个对话的设置。 */}
      <p className="assistant-context-window-hint">{t("contextUsage.window.hint")}</p>
    </div>
  );
}
