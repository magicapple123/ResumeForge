// SPDX-License-Identifier: Apache-2.0
/**
 * 远程服务块（RAG v3，条目 03 改版）：厂商卡片网格 + 字段区 + 拉取模型列表 + 测试连接，
 * 「高级」折叠里放自定义端点模板（任务书 §4.7 路径 A）。
 *
 * ## 为什么从 Select 改成卡片网格
 *
 * `Select` 只给出一个厂商名；用户看不出「这家要什么地址、要不要 Key、当前是不是生效中」。
 * 网格每张卡显示 厂商名 + host + 状态（生效中 / 已配置 / 未配置），选中态用主色边框，
 * 选中后下方展开字段区——这是「大模型 API 配置」卡的呈现方式（条目 02 的基准）。
 *
 * ## 为什么表单状态由父组件持有
 *
 * 卡头右上那颗「启用 / 关闭」是整张卡的**唯一主操作**（统一口径），它要用到当前草稿配置；
 * 草稿留在本组件里，卡头就只能再复制一份状态。所以 `draft` / `presetId` 由
 * `EmbeddingProviderCard` 持有，这里只做受控渲染（`onPatch` / `onSelectPreset`）。
 *
 * ## 预设不是免校验
 *
 * 预设只填地址与候选模型；点启用仍由后端做一次真实探测（HTTP 200 + 维度自检），探测通过
 * 才写配置。维度由后端自动探测，界面不出现 dim 输入框。
 */
import { useMemo } from "react";
import { Alert, Button, Flex, Input, Select, Tag, Typography, theme } from "antd";
import type {
  EmbeddingMaskedConfig,
  EmbeddingProbeResult,
  EmbeddingRemoteConfig,
  EmbeddingRemoteStatus,
} from "../../api/settings";
import { embeddingGuidanceKey } from "../../features/settings/embeddingHelpers";
import type { EmbeddingActionId } from "../../features/settings/useEmbeddingSettings";
import {
  CUSTOM_PRESET_ID,
  CUSTOM_PRESET_NOTE_KEY,
  EMBEDDING_REMOTE_PRESETS,
  presetHostOf,
} from "./embeddingRemotePresets";
import EmbeddingAdvancedFields from "./EmbeddingAdvancedFields";
import SettingsField from "./SettingsField";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  remote: EmbeddingRemoteStatus;
  /** /status 顶层的掩码配置：只用于回填表单，api_key 恒为空串。 */
  savedConfig?: EmbeddingMaskedConfig | null;
  busy: EmbeddingActionId | null;
  probe: EmbeddingProbeResult | null;
  models: string[];
  /** 当前草稿配置（父组件持有，卡头的主操作要用它）。 */
  draft: EmbeddingRemoteConfig;
  /** 当前选中的厂商 id（含 `custom`）。 */
  presetId: string;
  onPatch: (changes: Partial<EmbeddingRemoteConfig>) => void;
  onSelectPreset: (id: string) => void;
  onTest: (config: EmbeddingRemoteConfig) => void;
  onFetchModels: (config: EmbeddingRemoteConfig) => void;
}

type PresetState = "active" | "configured" | "empty";

/** 一张厂商卡的状态：生效中（正被使用）> 已配置（存过配置）> 未配置。 */
function presetState(remote: EmbeddingRemoteStatus, host: string): PresetState {
  if (!host) return "empty";
  if (remote.enabled && remote.host === host) return "active";
  if (remote.configured && remote.host === host) return "configured";
  return "empty";
}

const STATE_STYLE: Record<PresetState, { color?: string; key: string }> = {
  active: { color: "blue", key: "embeddingSearch.remote.preset.state.active" },
  configured: { color: "green", key: "embeddingSearch.remote.preset.state.configured" },
  empty: { key: "embeddingSearch.remote.preset.state.empty" },
} as const;

export default function EmbeddingRemoteBlock({
  remote,
  busy,
  probe,
  models,
  draft,
  presetId,
  onPatch,
  onSelectPreset,
  onTest,
  onFetchModels,
}: Props) {
  useLocale();
  const { token } = theme.useToken();

  /** 候选模型 = 预设候选 + 后端拉到的列表（同一批只显示一次）。 */
  const modelOptions = useMemo(() => {
    const preset = EMBEDDING_REMOTE_PRESETS.find((item) => item.id === presetId);
    const names = new Set<string>(preset?.models ?? []);
    for (const name of models) names.add(name);
    return [...names].map((name) => ({ value: name }));
  }, [presetId, models]);

  // Selected state: brand tint background + 1.5px brand border (rationale documented in SearchCard).
  //
  // Colours come from the `--rf-*` CSS variables so dark mode stays readable: the light-theme
  // `palette.brandTint` literal left the card white while the label turned light in dark mode.
  // `borderWidth` is set on its own because a `${1.5}px` value inside the `border` shorthand
  // is normalised.
  const cardStyle = (selected: boolean) => ({
    textAlign: "left" as const,
    cursor: "pointer",
    backgroundColor: selected ? "var(--rf-brand-tint)" : "transparent",
    borderStyle: "solid",
    borderWidth: selected ? "1.5px" : "1px",
    borderColor: selected ? "var(--rf-brand)" : "var(--rf-border)",
    borderRadius: token.borderRadiusLG,
    padding: "8px 10px",
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 2,
    width: "100%",
  });

  return (
    <Flex vertical gap={16}>
      <SettingsField
        label={t("embeddingSearch.remote.preset.label")}
        hint={t("embeddingSearch.remote.preset.hint")}
      >
        <div
          role="radiogroup"
          aria-label={t("embeddingSearch.remote.preset.aria")}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 8,
          }}
        >
          {EMBEDDING_REMOTE_PRESETS.map((preset) => {
            const host = presetHostOf(preset.baseUrl);
            const state = presetState(remote, host);
            const selected = presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={t(preset.labelKey)}
                onClick={() => onSelectPreset(preset.id)}
                style={cardStyle(selected)}
              >
                <Flex align="center" justify="space-between" gap={8}>
                  <Typography.Text strong>{t(preset.labelKey)}</Typography.Text>
                  <Tag color={STATE_STYLE[state].color} style={{ marginInlineEnd: 0 }}>
                    {t(STATE_STYLE[state].key as Parameters<typeof t>[0])}
                  </Tag>
                </Flex>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {host}
                </Typography.Text>
                {preset.noteKey ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t(preset.noteKey)}
                  </Typography.Text>
                ) : null}
              </button>
            );
          })}

          <button
            type="button"
            role="radio"
            aria-checked={presetId === CUSTOM_PRESET_ID}
            aria-label={t("embeddingSearch.remote.preset.custom")}
            onClick={() => onSelectPreset(CUSTOM_PRESET_ID)}
            style={cardStyle(presetId === CUSTOM_PRESET_ID)}
          >
            <Typography.Text strong>{t("embeddingSearch.remote.preset.custom")}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t(CUSTOM_PRESET_NOTE_KEY)}
            </Typography.Text>
          </button>
        </div>
      </SettingsField>

      <SettingsField
        label={t("embeddingSearch.remote.baseUrl.label")}
        hint={t("embeddingSearch.remote.baseUrl.hint")}
      >
        <Input
          aria-label={t("embeddingSearch.remote.baseUrl.label")}
          value={draft.base_url}
          placeholder={t("embeddingSearch.remote.baseUrl.placeholder")}
          autoComplete="off"
          allowClear
          onChange={(event) => onPatch({ base_url: event.target.value })}
        />
      </SettingsField>

      <SettingsField
        label={t("embeddingSearch.remote.model.label")}
        hint={t("embeddingSearch.remote.model.hint")}
        action={
          <Button
            size="small"
            loading={busy === "fetchModels"}
            disabled={!draft.base_url.trim() || busy !== null || undefined}
            onClick={() => onFetchModels(draft)}
          >
            {t("embeddingSearch.remote.fetchModels")}
          </Button>
        }
      >
        <Input
          aria-label={t("embeddingSearch.remote.model.label")}
          value={draft.model}
          placeholder={t("embeddingSearch.remote.model.placeholder")}
          autoComplete="off"
          onChange={(event) => onPatch({ model: event.target.value })}
        />
        {modelOptions.length > 0 ? (
          <Select
            style={{ width: "100%", marginTop: 8 }}
            aria-label={t("embeddingSearch.remote.modelCandidate.label")}
            value={draft.model || undefined}
            placeholder={t("embeddingSearch.remote.model.placeholder")}
            options={modelOptions}
            onChange={(name: string) => onPatch({ model: name })}
          />
        ) : null}
      </SettingsField>

      <SettingsField
        label={t("embeddingSearch.remote.key.label")}
        hint={t("embeddingSearch.remote.key.hint")}
      >
        <Input.Password
          aria-label={t("embeddingSearch.remote.key.label")}
          value={draft.api_key}
          placeholder={t("embeddingSearch.remote.key.placeholder")}
          autoComplete="off"
          onChange={(event) => onPatch({ api_key: event.target.value })}
        />
        {remote.configured ? (
          <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
            {t("embeddingSearch.remote.savedHint")}
          </Typography.Paragraph>
        ) : null}
      </SettingsField>

      <EmbeddingAdvancedFields value={draft} onChange={onPatch} />

      <Flex gap={8} wrap>
        <Button
          loading={busy === "test"}
          disabled={busy !== null || undefined}
          onClick={() => onTest(draft)}
        >
          {t("embeddingSearch.remote.test")}
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
