// SPDX-License-Identifier: Apache-2.0
/**
 * 字段设置视图（契约 §2/§3/§4）：每种类型勾选隐藏默认字段、增删自定义字段、恢复默认。
 *
 * 页面内视图切换，不新增弹层（与事实编辑器同一交互口径）。保存/恢复默认都带
 * `expected_revision` 条件写：409 不静默覆盖，提示刷新字段设置后重试。
 *
 * 「恢复默认」不可撤销（契约：reset = 删除该类型 prefs 行），所以按 AGENTS 的二次确认
 * 规则变体处理：footer 换态成**内联确认条**，不叠 Modal。注意已录内容不受影响——
 * reset 只重置字段定义，事实 payload 里的旧值仍在（若字段重新可见会重新显示）。
 */
import { Alert, Button, Checkbox, Input, Select, Space, Tag, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { formatErrorGuidance } from "../../api/errorGuidance";
import { t } from "../../i18n";
import { FACT_KINDS, FACT_KIND_LABEL_KEYS } from "./constants";
import { isSchemaRevisionConflict } from "./errors";
import {
  MAX_CUSTOM_FIELD_LABEL_CHARS,
  fieldSettingsIssueText,
  hiddenFieldsFromVisible,
  validateCustomFieldDefs,
} from "./factFieldSchema";
import { defaultFieldLabel } from "./factFieldLabels";
import type {
  FactCustomFieldInput,
  FactKind,
  ProfileFactKindSchema,
  ProfileFactKindSchemaUpdate,
  ProfileFactSchema,
} from "./types";

interface Buffer {
  visible: string[];
  customDefs: FactCustomFieldInput[];
  revision: number;
}

function bufferFrom(kindSchema: ProfileFactKindSchema): Buffer {
  const hidden = new Set(kindSchema.hidden_fields);
  return {
    visible: kindSchema.default_fields.filter((key) => !hidden.has(key)),
    customDefs: kindSchema.custom_fields.map((field) => ({ key: field.key, label: field.label })),
    revision: kindSchema.revision,
  };
}

interface Props {
  /** 九类 schema（顺序 = FACT_KINDS；缺失 prefs 行时已是全默认兜底）。 */
  kindSchemas: Record<FactKind, ProfileFactKindSchema>;
  onSave: (kind: FactKind, input: ProfileFactKindSchemaUpdate) => Promise<ProfileFactKindSchema>;
  onReset: (kind: FactKind, expectedRevision: number) => Promise<ProfileFactKindSchema>;
  /** 409 后重新拉取 schema；返回最新整份 schema 供本视图刷新缓冲。 */
  onRefresh: () => Promise<ProfileFactSchema | null>;
  onBack: () => void;
}

export default function FieldSettingsView({
  kindSchemas,
  onSave,
  onReset,
  onRefresh,
  onBack,
}: Props) {
  const [kind, setKind] = useState<FactKind>(FACT_KINDS[0]);
  const [buffer, setBuffer] = useState<Buffer>(() => bufferFrom(kindSchemas[FACT_KINDS[0]]));
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [validationText, setValidationText] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);

  const currentSchema = kindSchemas[kind];
  const label = t(FACT_KIND_LABEL_KEYS[kind]);
  const maxCustomFields = currentSchema?.max_custom_fields ?? 20;
  const fieldOptions = useMemo(
    () =>
      (currentSchema?.default_fields ?? []).map((key) => ({
        label: defaultFieldLabel(kind, key),
        value: key,
      })),
    [currentSchema, kind],
  );

  const applySchema = (next: ProfileFactKindSchema) => {
    setBuffer(bufferFrom(next));
    setResetConfirm(false);
    setConflict(false);
    setErrorText(null);
    setValidationText(null);
  };

  const selectKind = (next: FactKind) => {
    setKind(next);
    setBuffer(bufferFrom(kindSchemas[next]));
    setConflict(false);
    setErrorText(null);
    setValidationText(null);
    setResetConfirm(false);
  };

  const handleFailure = (caught: unknown) => {
    if (isSchemaRevisionConflict(caught)) {
      setConflict(true);
      return;
    }
    setErrorText(formatErrorGuidance(caught, t("profileFacts.settings.failedFallback")));
  };

  const save = async () => {
    const issue = validateCustomFieldDefs(buffer.customDefs);
    if (issue) {
      setValidationText(fieldSettingsIssueText(issue));
      return;
    }
    setValidationText(null);
    setSaving(true);
    setErrorText(null);
    try {
      const updated = await onSave(kind, {
        hidden_fields: hiddenFieldsFromVisible(currentSchema?.default_fields ?? [], buffer.visible),
        custom_fields: buffer.customDefs.map((def) =>
          def.key ? { key: def.key, label: def.label.trim() } : { label: def.label.trim() },
        ),
        expected_revision: buffer.revision,
      });
      applySchema(updated);
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    setErrorText(null);
    try {
      const updated = await onReset(kind, buffer.revision);
      applySchema(updated);
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setSaving(false);
    }
  };

  const refreshAfterConflict = async () => {
    setSaving(true);
    try {
      const loaded = await onRefresh();
      const fresh = loaded?.kinds.find((item) => item.kind === kind);
      if (fresh) applySchema(fresh);
      else setConflict(false);
    } finally {
      setSaving(false);
    }
  };

  const updateCustomLabel = (index: number, value: string) => {
    setBuffer((current) => ({
      ...current,
      customDefs: current.customDefs.map((def, itemIndex) =>
        itemIndex === index ? { ...def, label: value } : def,
      ),
    }));
  };

  const removeCustomField = (index: number) => {
    setBuffer((current) => ({
      ...current,
      customDefs: current.customDefs.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const addCustomField = () => {
    setBuffer((current) => ({ ...current, customDefs: [...current.customDefs, { label: "" }] }));
  };

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Space wrap>
        <Typography.Text strong>{t("profileFacts.settings.kind")}</Typography.Text>
        <Tag>
          {buffer.revision > 0
            ? t("profileFacts.settings.revision", { revision: buffer.revision })
            : t("profileFacts.settings.revisionDefault")}
        </Tag>
      </Space>
      <Select
        aria-label={t("profileFacts.settings.kind")}
        value={kind}
        options={FACT_KINDS.map((item) => ({
          value: item,
          label: t(FACT_KIND_LABEL_KEYS[item]),
        }))}
        onChange={(next) => selectKind(next as FactKind)}
        style={{ maxWidth: 280 }}
      />
      <Typography.Text type="secondary">{t("profileFacts.settings.hint")}</Typography.Text>

      {conflict ? (
        <Alert
          type="warning"
          showIcon
          title={t("profileFacts.settings.conflict", { label })}
          action={
            <Button size="small" onClick={() => void refreshAfterConflict()}>
              {t("profileFacts.settings.refresh")}
            </Button>
          }
        />
      ) : null}
      {errorText ? (
        <Alert
          type="error"
          showIcon
          title={t("profileFacts.settings.failedTitle")}
          description={errorText}
        />
      ) : null}
      {validationText ? (
        <Alert
          type="error"
          showIcon
          title={t("profileFacts.settings.validationTitle")}
          description={validationText}
        />
      ) : null}

      <Typography.Text strong>{t("profileFacts.settings.defaultFields")}</Typography.Text>
      <Checkbox.Group
        value={buffer.visible}
        options={fieldOptions}
        onChange={(values) => setBuffer((current) => ({ ...current, visible: values as string[] }))}
      />
      <Typography.Text type="secondary">{t("profileFacts.settings.defaultHint")}</Typography.Text>

      <Typography.Text strong>{t("profileFacts.settings.customFields")}</Typography.Text>
      <Typography.Text type="secondary">
        {t("profileFacts.settings.customHint", { max: maxCustomFields })}
      </Typography.Text>
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        {buffer.customDefs.map((def, index) => (
          <Space key={def.key ?? `new-${index}`} align="start" wrap>
            <Input
              value={def.label}
              maxLength={MAX_CUSTOM_FIELD_LABEL_CHARS}
              aria-label={t("profileFacts.settings.customAria", { index: index + 1 })}
              placeholder={t("profileFacts.settings.customPlaceholder")}
              onChange={(event) => updateCustomLabel(index, event.target.value)}
              style={{ width: 260 }}
            />
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label={t("profileFacts.settings.removeCustomAria", {
                label: def.label || t("profileFacts.settings.customFallback", { index: index + 1 }),
              })}
              onClick={() => removeCustomField(index)}
            />
          </Space>
        ))}
      </Space>
      <Button
        type="dashed"
        icon={<PlusOutlined />}
        disabled={buffer.customDefs.length >= maxCustomFields || undefined}
        onClick={addCustomField}
      >
        {t("profileFacts.settings.addCustom")}
      </Button>

      {resetConfirm ? (
        <Alert
          type="warning"
          showIcon
          title={t("profileFacts.settings.resetConfirmTitle", { label })}
          description={t("profileFacts.settings.resetConfirmBody")}
          action={
            <Space>
              <Button size="small" danger loading={saving} onClick={() => void reset()}>
                {t("profileFacts.settings.resetConfirm")}
              </Button>
              <Button size="small" onClick={() => setResetConfirm(false)}>
                {t("profileFacts.settings.cancelConfirm")}
              </Button>
            </Space>
          }
        />
      ) : null}

      <Space wrap>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          {t("profileFacts.settings.save")}
        </Button>
        <Button danger onClick={() => setResetConfirm(true)}>
          {t("profileFacts.settings.reset")}
        </Button>
        <Button onClick={onBack}>{t("profileFacts.settings.back")}</Button>
      </Space>
    </Space>
  );
}
