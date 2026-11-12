// SPDX-License-Identifier: Apache-2.0
/**
 * 远程配置的受控字段区（地址/模型/密钥/高级），供「新建/编辑配置」弹窗复用。
 *
 * 从原 `EmbeddingRemoteBlock` 拆出：列表化之后弹窗与（未来）其它入口需要同一套字段，
 * 表单状态由调用方持有（`onPatch` 受控），这里不保存任何配置。
 */
import { useMemo } from "react";
import { Button, Flex, Input, Select, Typography } from "antd";
import type { EmbeddingRemoteConfig } from "../../api/settings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import EmbeddingAdvancedFields from "./EmbeddingAdvancedFields";
import SettingsField from "./SettingsField";
import { EMBEDDING_REMOTE_PRESETS } from "./embeddingRemotePresets";

interface Props {
  value: EmbeddingRemoteConfig;
  presetId: string;
  models: string[];
  fetchingModels: boolean;
  keyConfigured: boolean;
  onChange: (changes: Partial<EmbeddingRemoteConfig>) => void;
  onFetchModels: () => void;
}

export default function EmbeddingRemoteFields({
  value,
  presetId,
  models,
  fetchingModels,
  keyConfigured,
  onChange,
  onFetchModels,
}: Props) {
  useLocale();
  /** 候选模型 = 预设候选 + 后端拉到的列表（同一批只显示一次）。 */
  const modelOptions = useMemo(() => {
    const preset = EMBEDDING_REMOTE_PRESETS.find((item) => item.id === presetId);
    const names = new Set<string>(preset?.models ?? []);
    for (const name of models) names.add(name);
    return [...names].map((name) => ({ value: name }));
  }, [presetId, models]);

  return (
    <Flex vertical gap={16}>
      <SettingsField
        label={t("embeddingSearch.remote.baseUrl.label")}
        hint={t("embeddingSearch.remote.baseUrl.hint")}
      >
        <Input
          aria-label={t("embeddingSearch.remote.baseUrl.label")}
          value={value.base_url}
          placeholder={t("embeddingSearch.remote.baseUrl.placeholder")}
          autoComplete="off"
          allowClear
          onChange={(event) => onChange({ base_url: event.target.value })}
        />
      </SettingsField>

      <SettingsField
        label={t("embeddingSearch.remote.model.label")}
        hint={t("embeddingSearch.remote.model.hint")}
        action={
          <Button
            size="small"
            loading={fetchingModels}
            disabled={!value.base_url.trim() || fetchingModels || undefined}
            onClick={onFetchModels}
          >
            {t("embeddingSearch.remote.fetchModels")}
          </Button>
        }
      >
        <Input
          aria-label={t("embeddingSearch.remote.model.label")}
          value={value.model}
          placeholder={t("embeddingSearch.remote.model.placeholder")}
          autoComplete="off"
          onChange={(event) => onChange({ model: event.target.value })}
        />
        {modelOptions.length > 0 ? (
          <Select
            style={{ width: "100%", marginTop: 8 }}
            aria-label={t("embeddingSearch.remote.modelCandidate.label")}
            value={value.model || undefined}
            placeholder={t("embeddingSearch.remote.model.placeholder")}
            options={modelOptions}
            onChange={(name: string) => onChange({ model: name })}
          />
        ) : null}
      </SettingsField>

      <SettingsField
        label={t("embeddingSearch.remote.key.label")}
        hint={t("embeddingSearch.remote.key.hint")}
      >
        <Input.Password
          aria-label={t("embeddingSearch.remote.key.label")}
          value={value.api_key}
          placeholder={t("embeddingSearch.remote.key.placeholder")}
          autoComplete="off"
          onChange={(event) => onChange({ api_key: event.target.value })}
        />
        {keyConfigured ? (
          <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
            {t("embeddingSearch.remote.profile.keyKept")}
          </Typography.Paragraph>
        ) : null}
      </SettingsField>

      <EmbeddingAdvancedFields value={value} onChange={onChange} />
    </Flex>
  );
}
