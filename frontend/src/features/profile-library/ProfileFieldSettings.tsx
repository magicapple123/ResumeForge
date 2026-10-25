// SPDX-License-Identifier: Apache-2.0
/**
 * 字段设置（F6）：一个分区的默认字段（只可隐藏）+ 自定义字段（可改名/删除）。
 *
 * 结构定义删除必须二次确认（动作 + 条数 + 保留后果 + 恢复位置）；默认字段没有
 * 改名/删除入口，只能隐藏——隐藏后不显示、不进生成与导出，但值仍保留。
 * 不叠 modal.confirm：确认条就在本视图内联展示（宿主弹层是单 Modal 多视图）。
 */
import { App, Button, Divider, Input, Select, Switch, Tag, Typography } from "antd";
import { useState } from "react";
import SectionVisibilitySwitch from "../../components/profile/SectionVisibilitySwitch";
import { t } from "../../i18n";
import {
  createField,
  deleteField,
  getFieldDeletionImpact,
  patchFieldPreference,
  updateField,
} from "./api";
import { profileErrorMessage } from "./errors";
import { invalidateProjectionCache } from "./projectionCache";
import type { CustomFieldType, FieldDeletionImpactOut, FieldOut, SectionOut } from "./types";

interface Props {
  section: SectionOut;
  maxCustomFields: number;
  /** 新建自定义字段的 expected_revision：后端校验的是 workspace state revision。 */
  workspaceRevision: number;
  /** 该大字段是否在当前组参与清单里（F9「在资料页显示」开关）。 */
  sectionVisible: boolean;
  onSetSectionVisible: (visible: boolean) => void;
  /** 参与清单写请求进行中：禁用开关，避免连续点击互相覆盖。 */
  visibilityBusy?: boolean;
  onChanged: () => Promise<void>;
  onBack: () => void;
}

function typeLabel(field: FieldOut): string {
  if (field.field_type === "multi_line") return t("profileLibrary.fieldSettings.typeMulti");
  if (field.field_type === "date_text") return t("profileLibrary.fieldSettings.typeDate");
  return t("profileLibrary.fieldSettings.typeSingle");
}

export default function ProfileFieldSettings({
  section,
  maxCustomFields,
  workspaceRevision,
  sectionVisible,
  onSetSectionVisible,
  visibilityBusy = false,
  onChanged,
  onBack,
}: Props) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addType, setAddType] = useState<CustomFieldType>("single_line");
  const [renamingId, setRenamingId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [deleting, setDeleting] = useState<{
    field: FieldOut;
    impact: FieldDeletionImpactOut;
  } | null>(null);

  const builtinFields = section.fields.filter((field) => field.is_builtin);
  const customFields = section.fields.filter((field) => !field.is_builtin);

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      invalidateProjectionCache();
      await onChanged();
    } catch (err) {
      message.error(profileErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const toggleHidden = (field: FieldOut, hidden: boolean) => {
    void run(async () => {
      await patchFieldPreference(field.field_id, {
        section_key: section.key,
        hidden,
        expected_revision: field.preference_revision,
      });
    });
  };

  const submitAdd = () => {
    const label = addLabel.trim();
    if (!label) {
      message.warning(t("profileLibrary.fieldSettings.label"));
      return;
    }
    void run(async () => {
      // 后端 create_custom_field 的 expected_revision 校验的是 workspace state revision，
      // 不是 SectionOut.revision（内置分区恒为 0）——传错必 409 revision_conflict。
      await createField(section.key, label, addType, workspaceRevision);
      setAddLabel("");
    });
  };

  const submitRename = (field: FieldOut) => {
    const label = renameDraft.trim();
    if (!label) return;
    void run(async () => {
      await updateField(section.key, field.field_id, {
        label,
        expected_revision: field.revision,
      });
      setRenamingId("");
    });
  };

  const requestDelete = (field: FieldOut) => {
    void run(async () => {
      const impact = await getFieldDeletionImpact(section.key, field.field_id);
      setDeleting({ field, impact });
    });
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const target = deleting.field;
    void run(async () => {
      await deleteField(section.key, target.field_id, target.revision, true);
      setDeleting(null);
    });
  };

  return (
    <div className="profile-field-settings">
      <div className="profile-settings-header">
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          {t("profileLibrary.fieldSettings.title")} · {section.name}
        </Typography.Title>
        <Button onClick={onBack}>{t("profileGroups.manager.back")}</Button>
      </div>

      <div className="profile-settings-row profile-field-settings-visibility">
        <span className="profile-settings-row-main">
          <Typography.Text strong>{section.name}</Typography.Text>
          <Typography.Text type="secondary" style={{ display: "block" }}>
            {t("profileLibrary.section.visibleHint")}
          </Typography.Text>
        </span>
        <SectionVisibilitySwitch
          sectionName={section.name}
          visible={section.key === "basic_info" || sectionVisible}
          locked={section.key === "basic_info"}
          busy={visibilityBusy}
          onChange={onSetSectionVisible}
        />
      </div>

      <Divider plain>{t("profileLibrary.fieldSettings.defaultTitle")}</Divider>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        {t("profileLibrary.fieldSettings.defaultHint")}
      </Typography.Paragraph>
      {builtinFields.map((field) => (
        <div key={field.field_id} className="profile-settings-row">
          <span className="profile-settings-row-main">
            {field.label}
            <Tag style={{ marginLeft: 8 }}>{typeLabel(field)}</Tag>
            {field.private ? <Tag color="gold">{t("profileLibrary.field.private")}</Tag> : null}
          </span>
          <span className="profile-settings-row-actions">
            <Typography.Text type="secondary" style={{ marginRight: 8 }}>
              {field.hidden
                ? t("profileLibrary.fieldSettings.show")
                : t("profileLibrary.fieldSettings.hide")}
            </Typography.Text>
            <Switch
              size="small"
              checked={!field.hidden}
              disabled={busy}
              onChange={(checked) => toggleHidden(field, !checked)}
            />
          </span>
        </div>
      ))}

      <Divider plain>{t("profileLibrary.fieldSettings.customTitle")}</Divider>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        {t("profileLibrary.fieldSettings.limit")}
      </Typography.Paragraph>
      {customFields.length === 0 ? (
        <Typography.Paragraph type="secondary">
          {t("profileLibrary.fieldSettings.empty")}
        </Typography.Paragraph>
      ) : null}
      {customFields.map((field) => (
        <div key={field.field_id} className="profile-settings-row">
          {renamingId === field.field_id ? (
            <Input
              value={renameDraft}
              maxLength={40}
              onChange={(event) => setRenameDraft(event.target.value)}
              onPressEnter={() => submitRename(field)}
              style={{ maxWidth: 260 }}
            />
          ) : (
            <span className="profile-settings-row-main">
              {field.label}
              <Tag style={{ marginLeft: 8 }}>{typeLabel(field)}</Tag>
            </span>
          )}
          <span className="profile-settings-row-actions">
            {renamingId === field.field_id ? (
              <Button
                size="small"
                type="primary"
                loading={busy}
                onClick={() => submitRename(field)}
              >
                {t("profileLibrary.fieldSettings.saveName")}
              </Button>
            ) : (
              <Button
                size="small"
                onClick={() => {
                  setRenamingId(field.field_id);
                  setRenameDraft(field.label);
                }}
              >
                {t("profileLibrary.fieldSettings.rename")}
              </Button>
            )}
            <Button size="small" danger disabled={busy} onClick={() => requestDelete(field)}>
              {t("profileLibrary.fieldSettings.delete")}
            </Button>
          </span>
        </div>
      ))}

      {deleting ? (
        <div className="profile-settings-confirm" role="alertdialog">
          <Typography.Text strong>
            {t("profileLibrary.fieldSettings.deleteTitle", { label: deleting.field.label })}
          </Typography.Text>
          <Typography.Paragraph>
            {t("profileLibrary.fieldSettings.deleteBody", {
              count: deleting.impact.affected_entries,
            })}
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">
            {t("profileLibrary.fieldSettings.deleteRestore")}
          </Typography.Paragraph>
          <div className="profile-settings-confirm-actions">
            <Button danger loading={busy} onClick={confirmDelete}>
              {t("profileLibrary.fieldSettings.deleteConfirm", {
                label: deleting.field.label,
              })}
            </Button>
            <Button onClick={() => setDeleting(null)}>{t("profileGroups.manager.back")}</Button>
          </div>
        </div>
      ) : null}

      <Divider plain>{t("profileLibrary.fieldSettings.add")}</Divider>
      <div className="profile-settings-add">
        <Input
          value={addLabel}
          maxLength={40}
          placeholder={t("profileLibrary.fieldSettings.label")}
          onChange={(event) => setAddLabel(event.target.value)}
          onPressEnter={submitAdd}
          style={{ maxWidth: 240 }}
          disabled={customFields.length >= maxCustomFields}
        />
        <Select
          value={addType}
          style={{ width: 140 }}
          disabled={customFields.length >= maxCustomFields}
          onChange={(value) => setAddType(value as CustomFieldType)}
          options={[
            { value: "single_line", label: t("profileLibrary.fieldSettings.typeSingle") },
            { value: "multi_line", label: t("profileLibrary.fieldSettings.typeMulti") },
            { value: "date_text", label: t("profileLibrary.fieldSettings.typeDate") },
          ]}
        />
        <Button
          type="primary"
          loading={busy}
          disabled={customFields.length >= maxCustomFields}
          onClick={submitAdd}
        >
          {t("profileLibrary.fieldSettings.create")}
        </Button>
      </div>
    </div>
  );
}
