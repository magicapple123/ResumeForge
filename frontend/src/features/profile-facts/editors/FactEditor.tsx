// SPDX-License-Identifier: Apache-2.0
/**
 * 补充事实编辑器（新建与编辑共用）：页面内视图切换，**不开 Modal / Drawer**。
 *
 * 为什么不用弹层：九类字段差异大（作者列表、多行贡献），弹层会把长表单塞进小窗口；
 * 而且「编辑一条事实」本来就是这一页的事，内联展开对键盘与读屏用户也更直接。
 *
 * 字段设置（schema）驱动两件事：
 * 1. 默认字段里被隐藏的不渲染（旧值由服务端保留，契约 §3）；
 * 2. 自定义字段按定义渲染输入，值随 payload.custom_fields 一起保存（契约 §2）。
 *
 * 错误处理：409（`profile_fact_revision_conflict`）单独识别——不覆盖别人刚存的内容，
 * 提示刷新后重新编辑；其余失败用项目统一的 `formatErrorGuidance`（原因 + 建议 + 编号）。
 * 提交中禁用取消与表单，避免半截写入。
 */
import { Alert, Button, Card, Form, Select, Space } from "antd";
import { useMemo, useState } from "react";
import { formatErrorGuidance } from "../../../api/errorGuidance";
import { t } from "../../../i18n";
import { FACT_KINDS, FACT_KIND_LABEL_KEYS, FACT_SAVE_LABEL_KEYS } from "../constants";
import { isRevisionConflict } from "../errors";
import { emptyFormValues, formToPayload, payloadToForm } from "../factModel";
import type { FactKind, FactPayload, ProfileFact, ProfileFactKindSchema } from "../types";
import AwardFields from "./AwardFields";
import CredentialFields from "./CredentialFields";
import CustomFieldInputs from "./CustomFieldInputs";
import LanguageFields from "./LanguageFields";
import PatentFields from "./PatentFields";
import PracticeFields from "./PracticeFields";
import PublicationFields from "./PublicationFields";
import ResearchProjectFields from "./ResearchProjectFields";
import TrainingFields from "./TrainingFields";
import WorkProjectFields from "./WorkProjectFields";

interface KindFieldsProps {
  kind: FactKind;
  hiddenFields: readonly string[];
}

/** 九类字段组的选择点：新增时 `kind` 可变，所以这里按当前 kind 渲染。 */
function KindFields({ kind, hiddenFields }: KindFieldsProps) {
  switch (kind) {
    case "publication":
      return <PublicationFields hiddenFields={hiddenFields} />;
    case "research_project":
      return <ResearchProjectFields hiddenFields={hiddenFields} />;
    case "patent":
      return <PatentFields hiddenFields={hiddenFields} />;
    case "credential":
      return <CredentialFields hiddenFields={hiddenFields} />;
    case "work_project":
      return <WorkProjectFields hiddenFields={hiddenFields} />;
    case "practice":
      return <PracticeFields hiddenFields={hiddenFields} />;
    case "award":
      return <AwardFields hiddenFields={hiddenFields} />;
    case "training":
      return <TrainingFields hiddenFields={hiddenFields} />;
    case "language":
      return <LanguageFields hiddenFields={hiddenFields} />;
  }
}

const KIND_OPTIONS = FACT_KINDS.map((kind) => ({
  value: kind,
  label: t(FACT_KIND_LABEL_KEYS[kind]),
}));

interface Props {
  mode: "create" | "edit";
  /** 新建时的默认类型；编辑时就是该事实的类型。 */
  initialKind: FactKind;
  /** 编辑态的原始事实：提供初始值与 `expected_revision`（由调用方的保存实现使用）。 */
  fact?: ProfileFact;
  /** 新建时的草稿（例如"从资料箱选入"映射出的初始值）；用户仍需核对后保存。 */
  draft?: FactPayload;
  /** 九类字段设置（缺失 prefs 行时调用方已用兜底 schema 补齐）。 */
  schemaByKind: Record<FactKind, ProfileFactKindSchema>;
  /** 自定义字段值的字符上限（契约 §4：2000）。 */
  maxCustomFieldValueChars: number;
  onSave: (kind: FactKind, payload: FactPayload) => Promise<void>;
  onCancel: () => void;
  /** 409 后由调用方刷新列表并退出编辑（刷新后重试，而不是拿旧 revision 覆盖）。 */
  onConflictRefresh: () => void;
}

export default function FactEditor({
  mode,
  initialKind,
  fact,
  draft,
  schemaByKind,
  maxCustomFieldValueChars,
  onSave,
  onCancel,
  onConflictRefresh,
}: Props) {
  const [kind, setKind] = useState<FactKind>(initialKind);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [form] = Form.useForm();

  // 初始值只算一次：调用方用 key 保证"编辑另一条 / 重新打开"时整块重新挂载。
  const initialValues = useMemo(() => {
    if (mode === "edit" && fact) return payloadToForm(fact.payload);
    if (draft) return payloadToForm(draft);
    return emptyFormValues(initialKind);
  }, [mode, fact, initialKind, draft]);
  const kindSchema = schemaByKind[kind];
  const hiddenFields = kindSchema?.hidden_fields ?? [];
  const customDefs = kindSchema?.custom_fields ?? [];
  const previousCustomFields =
    mode === "edit" && fact && Array.isArray(fact.payload.custom_fields)
      ? fact.payload.custom_fields
      : [];
  const label = t(FACT_KIND_LABEL_KEYS[kind]);
  const title = t(
    mode === "create" ? "profileFacts.editor.createTitle" : "profileFacts.editor.editTitle",
    { label },
  );

  const submit = async () => {
    let values: Record<string, unknown>;
    try {
      values = (await form.validateFields()) as Record<string, unknown>;
    } catch {
      // 校验不过：antd 已把错误标在字段上，这里不重复提示。
      return;
    }
    setSaving(true);
    setConflict(false);
    setErrorText(null);
    try {
      await onSave(
        kind,
        formToPayload(kind, values, {
          customDefs,
          previousCustomFields,
        }),
      );
    } catch (caught) {
      if (isRevisionConflict(caught)) {
        setConflict(true);
      } else {
        setErrorText(formatErrorGuidance(caught, t("profileFacts.editor.saveFailedFallback")));
      }
    } finally {
      setSaving(false);
    }
  };

  const switchKind = (next: FactKind) => {
    setKind(next);
    setConflict(false);
    setErrorText(null);
    form.resetFields();
    form.setFieldsValue(emptyFormValues(next));
  };

  return (
    <Card size="small" className="profile-facts-editor" title={title} style={{ marginBottom: 16 }}>
      {conflict ? (
        <Alert
          type="warning"
          showIcon
          title={t("profileFacts.editor.conflict")}
          action={
            <Button size="small" onClick={onConflictRefresh}>
              {t("profileFacts.editor.refresh")}
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}
      {errorText ? (
        <Alert
          type="error"
          showIcon
          title={t("profileFacts.editor.saveFailedTitle", { label })}
          description={errorText}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Form
        form={form}
        layout="vertical"
        className="profile-facts-form"
        initialValues={initialValues}
        disabled={saving || undefined}
      >
        {mode === "create" ? (
          <Form.Item label={t("profileFacts.editor.kind")}>
            <Select
              aria-label={t("profileFacts.editor.kind")}
              value={kind}
              options={KIND_OPTIONS}
              onChange={(next) => switchKind(next as FactKind)}
            />
          </Form.Item>
        ) : null}
        <KindFields kind={kind} hiddenFields={hiddenFields} />
        <CustomFieldInputs defs={customDefs} maxLength={maxCustomFieldValueChars} />
      </Form>
      <Space className="profile-facts-editor-actions">
        <Button type="primary" loading={saving} onClick={() => void submit()}>
          {t(FACT_SAVE_LABEL_KEYS[kind])}
        </Button>
        <Button onClick={onCancel} disabled={saving || undefined}>
          {t("profileFacts.editor.cancel")}
        </Button>
      </Space>
    </Card>
  );
}
