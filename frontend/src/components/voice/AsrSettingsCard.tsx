// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「语音转写」卡片：服务商 → 地址 / 协议 / 模型 / Key，保存 / 测试连接 / 清除 Key。
 *
 * ## 统一口径（条目 02，基准是「大模型 API 配置」卡）
 *
 * - 卡头 `extra` 放**唯一主操作**（保存）；「测试连接」留在字段区（它会打一次上游，是诊断
 *   动作而不是日常操作）；
 * - 说明改成 `Alert type="info"` 一句话，字段统一走 `SettingsField`；
 * - 状态徽标用 `Tag`（`green` = 已配置、默认 = 未配置）；
 * - 危险操作（清除已保存的 Key）收进「···」，二次确认复用 `useRowActionMenu`。
 *
 * ## 为什么要有服务商这一层（条目 03）
 *
 * 原先只有三个手填字段，用户必须先知道「地址要填到 /v1」「模型叫 whisper-large-v3」才能用。
 * 现在选一家预设就填好地址、协议与默认模型；「自定义」才需要自己填。
 *
 * ## Key 的显示口径
 *
 * 已保存时输入框里是 ********（后端回显掩码），原样保存会保留旧 Key；留空同样保留；只有
 * 「···」→「清除 Key」才真的删除（发送 __clear__ 哨兵）。换地址或换协议时后端会丢弃旧 Key
 * ——不把上一家服务商的 Key 发到新主机 / 新调用路径。
 */

import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Flex,
  Input,
  Segmented,
  Tag,
  Typography,
} from "antd";
import { MoreOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import ErrorState from "../common/ErrorState";
import LoadingBlock from "../common/LoadingBlock";
import { useRowActionMenu } from "../common/rowActionMenu";
import SettingsField from "../settings/SettingsField";
import AsrProviderGrid from "./AsrProviderGrid";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  CLEAR_ASR_KEY,
  fetchAsrModels,
  getAsrSettings,
  providerHostOf,
  saveAsrSettings,
  testAsrSettings,
  type AsrProtocol,
  type AsrSettings,
} from "./asrApi";
import {
  ASR_PRESETS,
  CUSTOM_ASR_PRESET_ID,
  asrPresetOf,
  defaultAsrModelOf,
  groupAsrModels,
  retireDateOf,
} from "./asrPresets";

const EMPTY_SETTINGS: AsrSettings = {
  base_url: "",
  api_key: "",
  model: "",
  protocol: "openai",
  configured: false,
};

const PROTOCOL_OPTIONS: { value: AsrProtocol; labelKey: MessageKey }[] = [
  { value: "openai", labelKey: "voiceInput.settings.protocol.openai" },
  { value: "dashscope", labelKey: "voiceInput.settings.protocol.dashscope" },
];

export default function AsrSettingsCard() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切到英文后这张卡仍是中文。
  useLocale();
  const { message } = App.useApp();
  const buildMenu = useRowActionMenu();
  const [form, setForm] = useState<AsrSettings>(EMPTY_SETTINGS);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [showAllModels, setShowAllModels] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    latencyMs: number | null;
  } | null>(null);

  /** 纯取数（不含 setState）：effect 与「重新读取」按钮共用同一段。 */
  const fetchSettings = useCallback(async (): Promise<
    { settings: AsrSettings } | { error: string }
  > => {
    try {
      return { settings: await getAsrSettings() };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : t("voiceInput.settings.loadFailed"),
      };
    }
  }, []);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchSettings();
      if (cancelled) return;
      if ("settings" in result) {
        setForm(result.settings);
        setLoadError("");
      } else {
        setLoadError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchSettings]);

  /** 「重新读取」：只翻 loading，不清空用户已经动过的表单。 */
  const reload = async () => {
    setLoading(true);
    const result = await fetchSettings();
    if ("settings" in result) {
      setForm(result.settings);
      setLoadError("");
    } else {
      setLoadError(result.error);
    }
    setLoading(false);
  };

  const effectivePresetId =
    presetId ?? asrPresetOf(form.base_url, form.protocol)?.id ?? CUSTOM_ASR_PRESET_ID;
  const activePreset = ASR_PRESETS.find((preset) => preset.id === effectivePresetId) ?? null;

  const patch = (changes: Partial<AsrSettings>) => {
    setForm((current) => ({ ...current, ...changes }));
    // 改了字段之后旧的连接测试结论就不作数了，别让"连接成功"停在错的地址旁边。
    setTestResult(null);
  };

  const selectPreset = (id: string) => {
    setPresetId(id);
    setTestResult(null);
    if (id === CUSTOM_ASR_PRESET_ID) return;
    const preset = ASR_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setForm((current) => ({
      ...current,
      base_url: preset.baseUrl,
      protocol: preset.protocol,
      model: defaultAsrModelOf(preset),
    }));
  };

  /** 手改协议就不再是那家预设了（同一地址下两条调用路径是两件事）。 */
  const changeProtocol = (protocol: AsrProtocol) => {
    if (activePreset && activePreset.protocol !== protocol) setPresetId(CUSTOM_ASR_PRESET_ID);
    patch({ protocol });
  };

  const payloadOf = (apiKey: string) => ({
    base_url: form.base_url.trim(),
    api_key: apiKey,
    model: form.model.trim(),
    protocol: form.protocol,
  });

  const save = async () => {
    setSaving(true);
    try {
      setForm(await saveAsrSettings(payloadOf(form.api_key)));
      message.success(t("voiceInput.settings.saved"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("voiceInput.settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testAsrSettings(payloadOf(form.api_key));
      setTestResult({
        ok: result.ok,
        message: result.message,
        latencyMs: result.latency_ms ?? null,
      });
    } catch (error) {
      setTestResult({
        ok: false,
        message: error instanceof Error ? error.message : t("voiceInput.settings.testFailed"),
        latencyMs: null,
      });
    } finally {
      setTesting(false);
    }
  };

  /** 拉模型列表失败只提示，不影响手填、保存与测试。 */
  const fetchModels = async () => {
    setFetching(true);
    try {
      const result = await fetchAsrModels({
        base_url: form.base_url.trim(),
        api_key: form.api_key,
        protocol: form.protocol,
      });
      setFetchedModels(result.models ?? []);
      if ((result.models ?? []).length > 0) {
        message.success(
          t("voiceInput.settings.model.fetched", { count: (result.models ?? []).length }),
        );
      } else {
        message.warning(t("voiceInput.settings.model.fetchEmpty"));
      }
    } catch {
      message.error(t("voiceInput.settings.model.fetchFailed"));
    } finally {
      setFetching(false);
    }
  };

  const clearKey = async () => {
    setSaving(true);
    try {
      setForm(
        await saveAsrSettings({
          base_url: form.base_url.trim(),
          api_key: CLEAR_ASR_KEY,
          model: form.model.trim(),
          protocol: form.protocol,
        }),
      );
      message.success(t("voiceInput.settings.key.cleared"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("voiceInput.settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  /** 候选模型 = 预设候选 + 拉取结果；默认只显示「疑似转写模型」，可切换看全部。 */
  const modelOptions = useMemo(() => {
    const grouped = groupAsrModels(fetchedModels);
    const shown = showAllModels ? grouped.all : grouped.transcribe;
    const names = new Set<string>([
      ...(activePreset?.models.map((model) => model.id) ?? []),
      ...shown,
    ]);
    return [...names].map((name) => {
      const retireOn = retireDateOf(activePreset, name);
      return {
        value: name,
        // 括号属于文案，写在语言包里（代码里出现全角括号会被 i18n 棘轮判成新增中文）。
        label: retireOn
          ? t("voiceInput.settings.model.retiredOption", { model: name, date: retireOn })
          : name,
      };
    });
  }, [activePreset, fetchedModels, showAllModels]);

  const retireDate = retireDateOf(activePreset, form.model);
  const host = providerHostOf(form.base_url);
  const testText = testResult
    ? testResult.ok
      ? testResult.latencyMs !== null
        ? t("voiceInput.settings.testOk", { ms: testResult.latencyMs })
        : testResult.message
      : testResult.message
    : "";

  const keyMenu = buildMenu([
    {
      key: "clear-key",
      label: t("voiceInput.settings.key.clear"),
      danger: true,
      confirm: t("voiceInput.settings.key.clearTitle"),
      confirmBody: t("voiceInput.settings.key.clearConfirm"),
      confirmOkText: t("voiceInput.settings.key.clear"),
      confirmCancelText: t("common.action.cancel"),
      onClick: () => void clearKey(),
    },
  ]);

  return (
    <Card
      title={
        <Flex align="center" gap={8}>
          <span>{t("voiceInput.settings.title")}</span>
          <Tag color={form.configured ? "green" : undefined}>
            {form.configured
              ? t("voiceInput.settings.badge.configured")
              : t("voiceInput.settings.badge.notConfigured")}
          </Tag>
        </Flex>
      }
      className="settings-card"
      extra={
        <Button type="primary" loading={saving} onClick={() => void save()}>
          {t("voiceInput.settings.save")}
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={t("voiceInput.settings.cardHint")}
      />

      {loadError ? (
        <div style={{ marginBottom: 16 }}>
          {/* Same shape as the semantic-search card: a retryable ErrorState. */}
          <ErrorState
            description={
              <>
                <div>{t("voiceInput.settings.loadErrorTitle")}</div>
                <Typography.Text type="secondary">
                  {t("voiceInput.settings.loadErrorBody", { message: loadError })}
                </Typography.Text>
              </>
            }
            onRetry={() => void reload()}
            retryLabel={t("common.retry")}
          />
        </div>
      ) : null}

      <LoadingBlock spinning={loading}>
        <Flex vertical gap={16}>
          <SettingsField
            label={t("voiceInput.settings.provider.label")}
            hint={t("voiceInput.settings.provider.hint")}
          >
            <AsrProviderGrid
              presets={ASR_PRESETS}
              selectedId={effectivePresetId}
              onSelect={selectPreset}
            />
          </SettingsField>

          <SettingsField
            label={t("voiceInput.settings.baseUrl.label")}
            hint={t("voiceInput.settings.baseUrl.hint")}
          >
            <Input
              aria-label={t("voiceInput.settings.baseUrl.aria")}
              value={form.base_url}
              onChange={(event) => patch({ base_url: event.target.value })}
              placeholder={t("voiceInput.settings.baseUrl.placeholder")}
              autoComplete="off"
              allowClear
            />
          </SettingsField>

          <SettingsField
            label={t("voiceInput.settings.protocol.label")}
            hint={t("voiceInput.settings.protocol.hint")}
          >
            <Segmented
              aria-label={t("voiceInput.settings.protocol.aria")}
              value={form.protocol}
              onChange={(value) => changeProtocol(value as AsrProtocol)}
              options={PROTOCOL_OPTIONS.map((option) => ({
                value: option.value,
                // 选项文案是协议名（技术标识的显示名），走词表。
                label: t(option.labelKey),
              }))}
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
                  >
                    {t("voiceInput.settings.model.showAll")}
                  </Checkbox>
                ) : null}
                <Button
                  size="small"
                  loading={fetching}
                  disabled={!form.base_url.trim() || undefined}
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
              value={form.model}
              options={modelOptions}
              onChange={(value: string) => patch({ model: value })}
              placeholder={t("voiceInput.settings.model.placeholder")}
              allowClear
            />
          </SettingsField>

          <SettingsField
            label={t("voiceInput.settings.key.label")}
            hint={t("voiceInput.settings.key.hint")}
            action={
              form.api_key ? (
                <Dropdown trigger={["click"]} disabled={saving} menu={{ items: keyMenu }}>
                  <Button
                    size="small"
                    icon={<MoreOutlined />}
                    aria-label={t("common.rowActions.more")}
                    disabled={saving || undefined}
                  />
                </Dropdown>
              ) : undefined
            }
          >
            <Input.Password
              aria-label={t("voiceInput.settings.key.aria")}
              value={form.api_key}
              onChange={(event) => patch({ api_key: event.target.value })}
              placeholder={t("voiceInput.settings.key.placeholder")}
              autoComplete="off"
            />
          </SettingsField>

          <Flex gap={8} wrap>
            <Button loading={testing} onClick={() => void test()}>
              {testing ? t("voiceInput.settings.testing") : t("voiceInput.settings.test")}
            </Button>
          </Flex>

          {testResult ? (
            <Alert type={testResult.ok ? "success" : "error"} showIcon title={testText} />
          ) : null}

          <div>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
              {t("voiceInput.settings.limitHint")}
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
              {t("voiceInput.settings.providerNote")}
            </Typography.Paragraph>
            {form.configured && host ? (
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {t("voiceInput.settings.privacyNote", { host })}
              </Typography.Paragraph>
            ) : null}
          </div>
        </Flex>
      </LoadingBlock>
    </Card>
  );
}
