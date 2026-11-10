// SPDX-License-Identifier: Apache-2.0
/**
 * 语音配置弹窗里的四段字段：服务地址 / 调用协议 / 模型 / Key。
 *
 * 从旧 `AsrSettingsCard` 里整体拆出（那张卡已经 480/500 行）：卡片改成"命名配置列表"
 * 之后，这四段只在新建/编辑弹窗里出现，拆成受控组件后弹窗与测试都能单独复用。
 *
 * 模型字段自带「拉取模型列表」：「拉取失败只提示、手填照常可用」是既有承诺，不因为
 * 搬了容器而改变。Key 的三档口径由调用方（弹窗）决定提示语，这里只渲染输入框。
 */
import { App, AutoComplete, Button, Checkbox, Flex, Input, Segmented } from "antd";
import { useMemo, useState } from "react";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import SettingsField from "../settings/SettingsField";
import { fetchAsrModels, type AsrProtocol } from "./asrApi";
import { groupAsrModels, retireDateOf, type AsrPreset } from "./asrPresets";

/** 弹窗里正在编辑的那份配置（还没落盘）。 */
export interface AsrProfileFormValues {
  base_url: string;
  model: string;
  protocol: AsrProtocol;
  api_key: string;
}

const PROTOCOL_OPTIONS: { value: AsrProtocol; labelKey: MessageKey }[] = [
  { value: "openai", labelKey: "voiceInput.settings.protocol.openai" },
  { value: "dashscope", labelKey: "voiceInput.settings.protocol.dashscope" },
];

interface Props {
  value: AsrProfileFormValues;
  /** 当前命中的厂商预设；决定默认候选模型与「下线日期」提示。 */
  preset: AsrPreset | null;
  /** Key 输入框下方的提示语（新建与编辑两种口径由弹窗给）。 */
  keyHint: string;
  disabled?: boolean;
  onChange: (patch: Partial<AsrProfileFormValues>) => void;
}

export default function AsrProfileFields({ value, preset, keyHint, disabled, onChange }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [showAllModels, setShowAllModels] = useState(false);

  const patch = (changes: Partial<AsrProfileFormValues>) => {
    if (disabled) return;
    onChange(changes);
  };

  /** 拉模型列表失败只提示，不影响手填、保存与测试（与旧卡片同一口径）。 */
  const fetchModels = async () => {
    setFetching(true);
    try {
      const result = await fetchAsrModels({
        base_url: value.base_url.trim(),
        api_key: value.api_key,
        protocol: value.protocol,
      });
      const models = result.models ?? [];
      setFetchedModels(models);
      if (models.length > 0) {
        message.success(t("voiceInput.settings.model.fetched", { count: models.length }));
      } else {
        message.warning(t("voiceInput.settings.model.fetchEmpty"));
      }
    } catch {
      message.error(t("voiceInput.settings.model.fetchFailed"));
    } finally {
      setFetching(false);
    }
  };

  /** 候选模型 = 预设候选 + 拉取结果；默认只显示「疑似转写模型」，可切换看全部。 */
  const modelOptions = useMemo(() => {
    const grouped = groupAsrModels(fetchedModels);
    const shown = showAllModels ? grouped.all : grouped.transcribe;
    const names = new Set<string>([...(preset?.models.map((model) => model.id) ?? []), ...shown]);
    return [...names].map((name) => {
      const retireOn = retireDateOf(preset, name);
      return {
        value: name,
        // 括号属于文案，写在语言包里（代码里出现全角括号会被 i18n 棘轮判成新增中文）。
        label: retireOn
          ? t("voiceInput.settings.model.retiredOption", { model: name, date: retireOn })
          : name,
      };
    });
  }, [fetchedModels, preset, showAllModels]);

  const retireDate = retireDateOf(preset, value.model);

  return (
    <Flex vertical gap={16}>
      <SettingsField
        label={t("voiceInput.settings.baseUrl.label")}
        hint={t("voiceInput.settings.baseUrl.hint")}
      >
        <Input
          aria-label={t("voiceInput.settings.baseUrl.aria")}
          value={value.base_url}
          onChange={(event) => patch({ base_url: event.target.value })}
          placeholder={t("voiceInput.settings.baseUrl.placeholder")}
          autoComplete="off"
          allowClear
          disabled={disabled || undefined}
        />
      </SettingsField>

      <SettingsField
        label={t("voiceInput.settings.protocol.label")}
        hint={t("voiceInput.settings.protocol.hint")}
      >
        <Segmented
          aria-label={t("voiceInput.settings.protocol.aria")}
          value={value.protocol}
          onChange={(next) => patch({ protocol: next as AsrProtocol })}
          options={PROTOCOL_OPTIONS.map((option) => ({
            value: option.value,
            // 选项文案是协议名（技术标识的显示名），走词表。
            label: t(option.labelKey),
          }))}
          disabled={disabled || undefined}
        />
      </SettingsField>

      <SettingsField
        label={t("voiceInput.settings.model.label")}
        hint={
          retireDate
            ? t("voiceInput.settings.model.retiredHint", { date: retireDate })
            : t("voiceInput.settings.model.hint")
        }
        action={
          <Flex gap={8} align="center">
            {fetchedModels.length > 0 ? (
              <Checkbox
                checked={showAllModels}
                onChange={(event) => setShowAllModels(event.target.checked)}
                disabled={disabled || undefined}
              >
                {t("voiceInput.settings.model.showAll")}
              </Checkbox>
            ) : null}
            <Button
              size="small"
              loading={fetching}
              disabled={disabled || !value.base_url.trim() || undefined}
              onClick={() => void fetchModels()}
            >
              {t("voiceInput.settings.model.fetch")}
            </Button>
          </Flex>
        }
      >
        <AutoComplete
          aria-label={t("voiceInput.settings.model.aria")}
          style={{ width: "100%" }}
          value={value.model}
          options={modelOptions}
          onChange={(next: string) => patch({ model: next })}
          placeholder={t("voiceInput.settings.model.placeholder")}
          allowClear
          disabled={disabled || undefined}
        />
      </SettingsField>

      <SettingsField label={t("voiceInput.settings.key.label")} hint={keyHint}>
        <Input.Password
          aria-label={t("voiceInput.settings.key.aria")}
          value={value.api_key}
          onChange={(event) => patch({ api_key: event.target.value })}
          placeholder={t("voiceInput.settings.key.placeholder")}
          autoComplete="off"
          disabled={disabled || undefined}
        />
      </SettingsField>
    </Flex>
  );
}
