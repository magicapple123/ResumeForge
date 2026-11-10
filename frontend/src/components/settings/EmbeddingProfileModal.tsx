// SPDX-License-Identifier: Apache-2.0
/**
 * 新建/编辑一条远程命名配置的居中弹窗（宽 560）。
 *
 * 关键交互（清单 §1.5）：
 * - 主操作是「保存配置」，保存后回到列表，由用户点「使用」才生效（避免保存暗含启用）；
 * - 编辑生效项保存后不自动重探，卡片显示「有未生效改动」；
 * - 测试连接结果留在弹窗内（用编辑态那条自己的已存 key，不跨 profile）；
 * - 有提交动作的 Modal：禁掉蒙层关闭，提交中忽略 Esc / ×。
 */
import { Alert, Button, Input, Modal, Typography } from "antd";
import type {
  EmbeddingProbeResult,
  EmbeddingProfile,
  EmbeddingRemoteConfig,
} from "../../api/settings";
import { embeddingGuidanceKey } from "../../features/settings/embeddingHelpers";
import type { EmbeddingActionId } from "../../features/settings/useEmbeddingSettings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import EmbeddingPresetPicker from "./EmbeddingPresetPicker";
import EmbeddingRemoteFields from "./EmbeddingRemoteFields";
import SettingsField from "./SettingsField";

interface Props {
  open: boolean;
  editing: EmbeddingProfile | null;
  name: string;
  draft: EmbeddingRemoteConfig;
  presetId: string;
  busy: EmbeddingActionId | null;
  saving: boolean;
  probe: EmbeddingProbeResult | null;
  models: string[];
  error: string;
  onNameChange: (value: string) => void;
  onPatchDraft: (changes: Partial<EmbeddingRemoteConfig>) => void;
  onSelectPreset: (presetId: string) => void;
  onTest: () => void;
  onFetchModels: () => void;
  onSave: () => void;
  onClose: () => void;
}

export default function EmbeddingProfileModal({
  open,
  editing,
  name,
  draft,
  presetId,
  busy,
  saving,
  probe,
  models,
  error,
  onNameChange,
  onPatchDraft,
  onSelectPreset,
  onTest,
  onFetchModels,
  onSave,
  onClose,
}: Props) {
  useLocale();
  const keyConfigured = Boolean(editing?.key_configured);
  return (
    <Modal
      open={open}
      title={
        editing
          ? t("embeddingSearch.remote.modal.editTitle")
          : t("embeddingSearch.remote.modal.createTitle")
      }
      width={560}
      onOk={onSave}
      okText={t("embeddingSearch.remote.modal.save")}
      cancelText={t("common.action.cancel")}
      confirmLoading={saving}
      mask={{ closable: false }}
      closable={!saving}
      keyboard={!saving}
      onCancel={onClose}
      destroyOnHidden
    >
      <SettingsField
        label={t("embeddingSearch.remote.modal.nameLabel")}
        hint={t("embeddingSearch.remote.modal.nameHint")}
      >
        <Input
          aria-label={t("embeddingSearch.remote.modal.nameLabel")}
          value={name}
          maxLength={64}
          placeholder={t("embeddingSearch.remote.modal.namePlaceholder")}
          autoComplete="off"
          onChange={(event) => onNameChange(event.target.value)}
        />
      </SettingsField>
      <div style={{ marginTop: 16 }}>
        <EmbeddingPresetPicker value={presetId} onChange={onSelectPreset} />
      </div>
      <div style={{ marginTop: 16 }}>
        <EmbeddingRemoteFields
          value={draft}
          presetId={presetId}
          models={models}
          fetchingModels={busy === "fetchModels"}
          keyConfigured={keyConfigured}
          onChange={onPatchDraft}
          onFetchModels={onFetchModels}
        />
      </div>
      <div style={{ marginTop: 16 }}>
        <Button loading={busy === "test"} disabled={saving || undefined} onClick={onTest}>
          {t("embeddingSearch.remote.test")}
        </Button>
      </div>
      {probe ? (
        probe.ok ? (
          <Alert
            style={{ marginTop: 12 }}
            type="success"
            showIcon
            title={t("embeddingSearch.remote.testOk", { dim: probe.dim })}
            description={probe.model}
          />
        ) : (
          <Alert
            style={{ marginTop: 12 }}
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
      {error ? (
        <Alert
          style={{ marginTop: 12 }}
          type="error"
          showIcon
          title={t("embeddingSearch.remote.profile.saveFailed")}
          description={error}
        />
      ) : null}
    </Modal>
  );
}
