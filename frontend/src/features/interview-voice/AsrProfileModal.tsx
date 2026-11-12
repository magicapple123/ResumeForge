// SPDX-License-Identifier: Apache-2.0
/**
 * 语音配置的新建/编辑弹窗：名称 + 厂商预设 + 地址/协议/模型/Key + 测试连接。
 *
 * 与旧设置卡的差别：地址/协议/模型/Key 只在弹窗里出现（首屏是配置列表）；六张厂商卡
 * 降级成弹窗内的快捷预设 —— 选中只填默认值，仍可手改。
 *
 * Key 口径（与后端按条判断一致）：
 * - 新建：Key 留空 = 这条没有 Key（不跨条继承）；
 * - 编辑：留空/掩码 = 保留这一条已存的 Key；地址或协议改了则保存时清除旧 Key，
 *   界面在保存前就用 Alert 说明（key.willClear），不让用户"保存后才发现要重填"。
 */
import { ApiOutlined } from "@ant-design/icons";
import { Alert, Button, Flex, Input, Modal, Space, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import SettingsField from "../settings/SettingsField";
import AsrProfileFields from "./AsrProfileFields";
import type { AsrProfileFormValues } from "./AsrProfileFields";
import AsrProviderGrid from "./AsrProviderGrid";
import type { AsrProfile, AsrProfilePayload, AsrProfileTestPayload, AsrTestResult } from "./asrApi";
import {
  ASR_PRESETS,
  CUSTOM_ASR_PRESET_ID,
  asrPresetOf,
  defaultAsrModelOf,
  type AsrPreset,
} from "./asrPresets";

interface Props {
  open: boolean;
  /** create = 新建（source 为空）或复制（source 为被复制的那条）；edit = 编辑 source。 */
  mode: "create" | "edit";
  source: AsrProfile | null;
  /** 当前生效配置的 id：编辑它时提示"保存后立即生效"。 */
  activeId: string;
  /** 已占用的名称（不含正在编辑的这条）：本地判重，重名就地报错。 */
  takenNames: string[];
  saving: boolean;
  testing: boolean;
  testResult: AsrTestResult | null;
  onSave: (payload: AsrProfilePayload) => Promise<void>;
  onTest: (draft: AsrProfileTestPayload) => Promise<AsrTestResult>;
  onClose: () => void;
}

/** 复制出来的名称后缀（中文由语言包提供，这里只拼字符串）。 */
const DUPLICATE_SUFFIX_KEY = "voiceInput.settings.profile.duplicateSuffix";

/** 新建弹窗的初始值（无 Form 容器，状态由本组件持有）。 */
const EMPTY_ASR_PROFILE_FORM: AsrProfileFormValues = {
  base_url: "",
  model: "",
  protocol: "openai",
  api_key: "",
};

export default function AsrProfileModal({
  open,
  mode,
  source,
  activeId,
  takenNames,
  saving,
  testing,
  testResult,
  onSave,
  onTest,
  onClose,
}: Props) {
  useLocale();
  const [name, setName] = useState("");
  const [presetId, setPresetId] = useState(CUSTOM_ASR_PRESET_ID);
  const [form, setForm] = useState<AsrProfileFormValues>(EMPTY_ASR_PROFILE_FORM);
  const [error, setError] = useState("");

  // 打开时按来源重置一次：弹窗保留上一次关闭时的内容会让"新建"带着上一条的地址。
  // 这里没有 Form 容器接管初值，重置只能在"打开"这一刻同步做一次。
  /* eslint-disable react-hooks/set-state-in-effect -- 打开瞬间按来源回填，无处可延后 */
  useEffect(() => {
    if (!open) return;
    setError("");
    if (source) {
      setName(mode === "edit" ? source.name : source.name + t(DUPLICATE_SUFFIX_KEY));
      setPresetId(source.preset_id || CUSTOM_ASR_PRESET_ID);
      setForm({
        base_url: source.base_url,
        model: source.model,
        protocol: source.protocol,
        // 复制/编辑都从"留空 = 不继承"开始：新建不跨条继承，编辑留空保留本条旧 Key。
        api_key: "",
      });
      return;
    }
    setName("");
    setPresetId(CUSTOM_ASR_PRESET_ID);
    setForm(EMPTY_ASR_PROFILE_FORM);
  }, [mode, open, source]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const effectivePresetId = useMemo(
    () => presetId || asrPresetOf(form.base_url, form.protocol)?.id || CUSTOM_ASR_PRESET_ID,
    [form.base_url, form.protocol, presetId],
  );
  const activePreset: AsrPreset | null =
    ASR_PRESETS.find((preset) => preset.id === effectivePresetId) ?? null;

  /** 手改字段：清掉上一次的保存错误（用户正在修它）。 */
  const patch = (changes: Partial<AsrProfileFormValues>) => {
    setError("");
    setForm((current) => ({ ...current, ...changes }));
  };

  const selectPreset = (id: string) => {
    setError("");
    setPresetId(id);
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
  const changeProtocol = (protocol: AsrProfileFormValues["protocol"]) => {
    if (activePreset && activePreset.protocol !== protocol) setPresetId(CUSTOM_ASR_PRESET_ID);
    patch({ protocol });
  };

  const duplicateSource = mode === "create" ? source : null;
  // 只有"编辑同一条"才谈得上沿用已存 Key；复制出来的是新配置，Key 一律不继承。
  const hasSavedKey = mode === "edit" && Boolean(source?.has_key);
  const bindingChanged =
    Boolean(source) &&
    (form.base_url.trim() !== source?.base_url || form.protocol !== source?.protocol);
  const willClearKey = mode === "edit" && hasSavedKey && !form.api_key.trim() && bindingChanged;
  const editingActive = mode === "edit" && source?.id === activeId;

  const keyHint = hasSavedKey
    ? t("voiceInput.settings.key.keepHint")
    : t("voiceInput.settings.key.createHint");

  /** 保存前置校验：名称必填/≤64/不重名，尽量在本地就说清楚（服务端仍会兜底）。 */
  const validate = (): string => {
    const cleaned = name.trim();
    if (!cleaned) return t("voiceInput.settings.validation.nameRequired");
    if (cleaned.length > 64) return t("voiceInput.settings.validation.nameTooLong");
    if (takenNames.includes(cleaned)) return t("voiceInput.settings.validation.nameConflict");
    return "";
  };

  const submit = async () => {
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    setError("");
    try {
      await onSave({
        id: mode === "edit" ? source?.id : undefined,
        name: name.trim(),
        preset_id: effectivePresetId,
        base_url: form.base_url.trim(),
        model: form.model.trim(),
        protocol: form.protocol,
        api_key: form.api_key,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("voiceInput.settings.saveFailed"));
    }
  };

  const draft = (): AsrProfileTestPayload => ({
    base_url: form.base_url.trim(),
    model: form.model.trim(),
    protocol: form.protocol,
    api_key: form.api_key,
  });

  const testText = testResult
    ? testResult.ok
      ? testResult.latency_ms != null
        ? t("voiceInput.settings.testOk", { ms: testResult.latency_ms })
        : testResult.message
      : testResult.message
    : "";

  return (
    <Modal
      title={
        mode === "edit"
          ? t("voiceInput.settings.modal.editTitle")
          : t("voiceInput.settings.modal.createTitle")
      }
      open={open}
      onCancel={onClose}
      // 表单弹层：点蒙层关掉会丢掉一屏输入，禁掉（Esc / × 仍可关）。
      mask={{ closable: false }}
      width={620}
      footer={
        <Space wrap>
          <Button
            icon={<ApiOutlined />}
            loading={testing}
            disabled={saving || undefined}
            onClick={() => void onTest(draft())}
          >
            {t("voiceInput.settings.test")}
          </Button>
          <Button disabled={saving || undefined} onClick={onClose}>
            {t("common.action.cancel")}
          </Button>
          <Button
            type="primary"
            loading={saving}
            disabled={testing || undefined}
            onClick={() => void submit()}
          >
            {t("voiceInput.settings.modal.save")}
          </Button>
        </Space>
      }
    >
      <Flex vertical gap={16}>
        {duplicateSource ? (
          <Alert type="info" showIcon title={t("voiceInput.settings.modal.duplicateHint")} />
        ) : null}
        {editingActive ? (
          <Alert type="info" showIcon title={t("voiceInput.settings.modal.activeHint")} />
        ) : null}

        <SettingsField
          label={t("voiceInput.settings.modal.name.label")}
          hint={t("voiceInput.settings.modal.name.hint")}
        >
          <Input
            aria-label={t("voiceInput.settings.modal.name.label")}
            value={name}
            maxLength={64}
            placeholder={t("voiceInput.settings.modal.name.placeholder")}
            onChange={(event) => {
              setError("");
              setName(event.target.value);
            }}
            autoComplete="off"
          />
        </SettingsField>

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

        <AsrProfileFields
          value={form}
          preset={activePreset}
          keyHint={keyHint}
          disabled={saving}
          onChange={(changes) => {
            if (changes.protocol && changes.protocol !== form.protocol) {
              changeProtocol(changes.protocol);
              return;
            }
            patch(changes);
          }}
        />

        {willClearKey ? (
          <Alert type="warning" showIcon title={t("voiceInput.settings.key.willClear")} />
        ) : null}

        {error ? <Alert type="error" showIcon title={error} /> : null}

        {testResult ? (
          <Alert type={testResult.ok ? "success" : "error"} showIcon title={testText} />
        ) : null}

        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t("voiceInput.settings.limitHint")}
        </Typography.Paragraph>
      </Flex>
    </Modal>
  );
}
