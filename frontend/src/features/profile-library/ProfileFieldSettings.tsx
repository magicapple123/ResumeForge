// SPDX-License-Identifier: Apache-2.0
/**
 * 字段设置（F6）：一个分区的默认字段（只可隐藏）+ 自定义字段（可改名/删除）。
 *
 * 结构定义删除必须二次确认（动作 + 条数 + 保留后果 + 恢复位置）；默认字段没有
 * 改名/删除入口，只能隐藏——隐藏后不显示、不进生成与导出，但值仍保留。
 * 不叠 modal.confirm：确认条就在本视图内联展示（宿主弹层是单 Modal 多视图）。
 */
import { App, Button, Divider, Input, Select, Switch, Tag, Typography } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useState } from "react";
import SectionVisibilitySwitch from "../../components/profile/SectionVisibilitySwitch";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
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
  useLocale();
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
        <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={onBack}>
          {t("profileGroups.manager.back")}
        </Button>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {t("profileLibrary.fieldSettings.title")}
        </Typography.Title>
      </div>

      <div className="profile-settings-row profile-field-settings-visibility">
        <span className="profile-settings-row-main">
          <span className="profile-settings-row-title">{section.name}</span>
          <span className="profile-settings-row-meta">
            {t("profileLibrary.section.visibleHint")}
          </span>
        </span>
        <SectionVisibilitySwitch
          sectionName={section.name}
          visible={section.key === "basic_info" || sectionVisible}
          locked={section.key === "basic_info"}
          busy={visibilityBusy}
          hideLabel
          onChange={onSetSectionVisible}
        />
      </div>

      <Divider plain>{t("profileLibrary.fieldSettings.defaultTitle")}</Divider>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        {t("profileLibrary.fieldSettings.defaultHint")}
      </Typography.Paragraph>
      <div className="profile-settings-list">
        {builtinFields.map((field) => (
          <div key={field.field_id} className="profile-settings-row">
            <span className="profile-settings-row-main">
              <span className="profile-settings-row-title">{field.label}</span>
              <Tag>{typeLabel(field)}</Tag>
              {field.private ? <Tag color="gold">{t("profileLibrary.field.private")}</Tag> : null}
            </span>
            <span className="profile-settings-row-actions">
              {/* 行尾不再重复「隐藏 / 恢复显示」文字：开关方向与 aria-label 已经说明状态，
                  13 个默认字段各带一段文字会把动作列撑成两行。 */}
              <Switch
                size="small"
                checked={!field.hidden}
                aria-label={
                  field.hidden
                    ? t("profileLibrary.fieldSettings.showAria", { label: field.label })
                    : t("profileLibrary.fieldSettings.hideAria", { label: field.label })
                }
                disabled={busy}
                onChange={(checked) => toggleHidden(field, !checked)}
              />
            </span>
          </div>
        ))}
      </div>

      <Divider plain>{t("profileLibrary.fieldSettings.customTitle")}</Divider>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        {t("profileLibrary.fieldSettings.limit")}
      </Typography.Paragraph>
      {customFields.length === 0 ? (
        <Typography.Paragraph type="secondary">
          {t("profileLibrary.fieldSettings.empty")}
        </Typography.Paragraph>
      ) : null}
      <div className="profile-settings-list">
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
                <span className="profile-settings-row-title">{field.label}</span>
                <Tag>{typeLabel(field)}</Tag>
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
                  type="text"
                  onClick={() => {
                    setRenamingId(field.field_id);
                    setRenameDraft(field.label);
                  }}
                >
                  {t("profileLibrary.fieldSettings.rename")}
                </Button>
              )}
              <Button
                size="small"
                type="text"
                danger
                disabled={busy}
                onClick={() => requestDelete(field)}
              >
                {t("profileLibrary.fieldSettings.delete")}
              </Button>
            </span>
          </div>
        ))}
      </div>

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

      {/* 添加字段并入「自定义字段」这一段：不再单起「添加字段」小标题与分隔线，
          否则同一个模块被切成两段，用户要滚动两次才看清「这里能加字段」。 */}
      <div className="profile-settings-add" style={{ marginTop: 12 }}>
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
