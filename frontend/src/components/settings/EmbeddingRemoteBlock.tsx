// SPDX-License-Identifier: Apache-2.0
/**
 * 远程服务块（RAG v3）：预设 + base_url/model/key + 拉取模型列表 + 测试连接 + 启用；
 * 「高级」折叠里放自定义端点模板（任务书 §4.7 路径 A）。
 *
 * 预设只填地址与候选模型，**不是免校验**：点启用仍由后端做一次真实探测（HTTP 200 +
 * 维度自检），探测通过才写配置。维度由后端自动探测，界面不出现 dim 输入框。
 */
import { useMemo, useState } from "react";
import { Alert, Button, Flex, Input, Select, Typography } from "antd";
import type {
  EmbeddingMaskedConfig,
  EmbeddingProbeResult,
  EmbeddingRemoteConfig,
  EmbeddingRemoteStatus,
} from "../../api/settings";
import {
  embeddingGuidanceKey,
  remoteConfigFromStatus,
} from "../../features/settings/embeddingHelpers";
import { CUSTOM_PRESET_ID, EMBEDDING_REMOTE_PRESETS, presetOf } from "./embeddingRemotePresets";
import type { EmbeddingActionId } from "../../features/settings/useEmbeddingSettings";
import EmbeddingAdvancedFields from "./EmbeddingAdvancedFields";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  remote: EmbeddingRemoteStatus;
  /** /status 顶层的掩码配置：只用于回填表单，api_key 恒为空串。 */
  savedConfig?: EmbeddingMaskedConfig | null;
  busy: EmbeddingActionId | null;
  probe: EmbeddingProbeResult | null;
  models: string[];
  onTest: (config: EmbeddingRemoteConfig) => void;
  onFetchModels: (config: EmbeddingRemoteConfig) => void;
  onEnable: (config: EmbeddingRemoteConfig) => void;
  onClearProbe: () => void;
}

export default function EmbeddingRemoteBlock({
  remote,
  savedConfig,
  busy,
  probe,
  models,
  onTest,
  onFetchModels,
  onEnable,
  onClearProbe,
}: Props) {
  useLocale();
  const [form, setForm] = useState<EmbeddingRemoteConfig>(() =>
    remoteConfigFromStatus(remote, savedConfig),
  );
  const [presetId, setPresetId] = useState<string>(
    () => presetOf(remoteConfigFromStatus(remote, savedConfig).base_url)?.id ?? CUSTOM_PRESET_ID,
  );

  const patch = (changes: Partial<EmbeddingRemoteConfig>) => {
    setForm((current) => ({ ...current, ...changes }));
    // 改了字段之后旧的连接测试结论就不作数了，别让"连接成功"停在错的地址旁边。
    onClearProbe();
  };

  const changePreset = (id: string) => {
    setPresetId(id);
    if (id === CUSTOM_PRESET_ID) return;
    const preset = EMBEDDING_REMOTE_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    patch({
      base_url: preset.baseUrl,
      model: preset.models[0] ?? form.model,
      allow_private: preset.allowPrivate,
      endpoint_mode: "openai",
    });
  };

  /** 候选模型 = 预设候选 + 后端拉到的列表（同一批只显示一次）。 */
  const modelOptions = useMemo(() => {
    const preset = EMBEDDING_REMOTE_PRESETS.find((item) => item.id === presetId);
    const names = new Set<string>(preset?.models ?? []);
    for (const name of models) names.add(name);
    return [...names].map((name) => ({ value: name }));
  }, [presetId, models]);

  const presetOptions = [
    ...EMBEDDING_REMOTE_PRESETS.map((preset) => ({
      value: preset.id,
      label: t(preset.labelKey),
    })),
    { value: CUSTOM_PRESET_ID, label: t("embeddingSearch.remote.preset.custom") },
  ];

  return (
    <Flex vertical gap={16}>
      <div>
        <Typography.Text strong>{t("embeddingSearch.remote.preset.label")}</Typography.Text>
        <Select
          style={{ width: "100%" }}
          aria-label={t("embeddingSearch.remote.preset.label")}
          value={presetId}
          onChange={(id: string) => changePreset(id)}
          options={presetOptions}
        />
        <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
          {t("embeddingSearch.remote.preset.hint")}
        </Typography.Paragraph>
      </div>

      <div>
        <Typography.Text strong>{t("embeddingSearch.remote.baseUrl.label")}</Typography.Text>
        <Input
          aria-label={t("embeddingSearch.remote.baseUrl.label")}
          value={form.base_url}
          placeholder={t("embeddingSearch.remote.baseUrl.placeholder")}
          autoComplete="off"
          allowClear
          onChange={(event) => patch({ base_url: event.target.value })}
        />
        <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
          {t("embeddingSearch.remote.baseUrl.hint")}
        </Typography.Paragraph>
      </div>

      <div>
        <Typography.Text strong>{t("embeddingSearch.remote.model.label")}</Typography.Text>
        <Flex gap={8} wrap>
          <Input
            aria-label={t("embeddingSearch.remote.model.label")}
            value={form.model}
            placeholder={t("embeddingSearch.remote.model.placeholder")}
            autoComplete="off"
            onChange={(event) => patch({ model: event.target.value })}
          />
          <Button
            loading={busy === "fetchModels"}
            disabled={!form.base_url.trim() || busy !== null || undefined}
            onClick={() => onFetchModels(form)}
          >
            {t("embeddingSearch.remote.fetchModels")}
          </Button>
        </Flex>
        {modelOptions.length > 0 ? (
          <Select
            style={{ width: "100%", marginTop: 8 }}
            aria-label={t("embeddingSearch.remote.model.label")}
            value={form.model || undefined}
            placeholder={t("embeddingSearch.remote.model.placeholder")}
            options={modelOptions}
            onChange={(name: string) => patch({ model: name })}
          />
        ) : null}
        <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
          {t("embeddingSearch.remote.model.hint")}
        </Typography.Paragraph>
      </div>

      <div>
        <Typography.Text strong>{t("embeddingSearch.remote.key.label")}</Typography.Text>
        <Input.Password
          aria-label={t("embeddingSearch.remote.key.label")}
          value={form.api_key}
          placeholder={t("embeddingSearch.remote.key.placeholder")}
          autoComplete="off"
          onChange={(event) => patch({ api_key: event.target.value })}
        />
        <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
          {t("embeddingSearch.remote.key.hint")}
        </Typography.Paragraph>
        {remote.configured ? (
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {t("embeddingSearch.remote.savedHint")}
          </Typography.Paragraph>
        ) : null}
      </div>

      <EmbeddingAdvancedFields value={form} onChange={patch} />

      <Flex gap={8} wrap>
        <Button
          loading={busy === "test"}
          disabled={busy !== null || undefined}
          onClick={() => onTest(form)}
        >
          {t("embeddingSearch.remote.test")}
        </Button>
        <Button
          type="primary"
          loading={busy === "enable"}
          disabled={busy !== null || undefined}
          onClick={() => onEnable(form)}
        >
          {t("embeddingSearch.remote.enable")}
        </Button>
      </Flex>

      {probe ? (
        probe.ok ? (
          <Alert
            type="success"
            showIcon
            title={t("embeddingSearch.remote.testOk", { dim: probe.dim })}
            description={probe.model}
          />
        ) : (
          <Alert
            type="error"
            showIcon
            title={t("embeddingSearch.remote.testFailed")}
            description={
              <>
                <div>{probe.error || t("embeddingSearch.guidance.retry")}</div>
                <Typography.Text type="secondary">
                  {t(embeddingGuidanceKey(probe.error))}
                </Typography.Text>
              </>
            }
          />
        )
      ) : null}
    </Flex>
  );
}
