// SPDX-License-Identifier: Apache-2.0
/**
 * 字段设置（F6）：一个分区的默认字段（只可隐藏）+ 自定义字段（可改名/删除）。
 *
 * 结构定义删除必须二次确认（动作 + 条数 + 保留后果 + 恢复位置）；默认字段没有
 * 改名/删除入口，只能隐藏——隐藏后不显示、不进生成与导出，但值仍保留。
 * 不叠 modal.confirm：确认条就在本视图内联展示（宿主弹层是单 Modal 多视图）。
 */
import { App, Button, Input, Select, Switch, Tag, Tooltip } from "antd";
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
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
import { profileFieldLabel, profileSectionLabel } from "./profileLabels";
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
        <span className="profile-settings-card-title">
          {t("profileLibrary.fieldSettings.title")}
        </span>
      </div>

      <div className="profile-settings-row profile-field-settings-visibility">
        <span className="profile-settings-row-main">
          <span className="profile-settings-row-title">{profileSectionLabel(section)}</span>
          <span className="profile-settings-row-meta">
            {t("profileLibrary.section.visibleHint")}
          </span>
        </span>
        <span className="profile-settings-row-actions">
          <SectionVisibilitySwitch
            sectionName={profileSectionLabel(section)}
            visible={section.key === "basic_info" || sectionVisible}
            locked={section.key === "basic_info"}
            busy={visibilityBusy}
            hideLabel
            onChange={onSetSectionVisible}
          />
        </span>
      </div>

      <section className="profile-settings-card">
        <h3 className="profile-settings-card-title">
          {t("profileLibrary.fieldSettings.defaultTitle")}
        </h3>
        <p className="profile-settings-card-hint">
          {t("profileLibrary.fieldSettings.defaultHint")}
        </p>
        <div className="profile-settings-list">
          {builtinFields.map((field) => (
            <div key={field.field_id} className="profile-settings-row">
              <span className="profile-settings-row-main">
                <span className="profile-settings-row-title">{profileFieldLabel(field)}</span>
                <span className="profile-settings-row-meta">{typeLabel(field)}</span>
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
                      ? t("profileLibrary.fieldSettings.showAria", {
                          label: profileFieldLabel(field),
                        })
                      : t("profileLibrary.fieldSettings.hideAria", {
                          label: profileFieldLabel(field),
                        })
                  }
                  disabled={busy}
                  onChange={(checked) => toggleHidden(field, !checked)}
                />
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="profile-settings-card">
        <h3 className="profile-settings-card-title">
          {t("profileLibrary.fieldSettings.customTitle")}
        </h3>
        <p className="profile-settings-card-hint">{t("profileLibrary.fieldSettings.limit")}</p>
        {customFields.length === 0 ? (
          <p className="profile-settings-card-hint">{t("profileLibrary.fieldSettings.empty")}</p>
        ) : null}
        <div className="profile-settings-list">
          {customFields.map((field) => (
            <div key={field.field_id} className="profile-settings-row">
              {renamingId === field.field_id ? (
                <Input
                  value={renameDraft}
                  maxLength={40}
                  aria-label={t("profileLibrary.fieldSettings.rename")}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onPressEnter={() => submitRename(field)}
                  style={{ maxWidth: 260 }}
                />
              ) : (
                <span className="profile-settings-row-main">
                  <span className="profile-settings-row-title">{profileFieldLabel(field)}</span>
                  <span className="profile-settings-row-meta">{typeLabel(field)}</span>
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
                  <Tooltip title={t("profileLibrary.fieldSettings.rename")}>
                    <Button
                      className="profile-settings-action"
                      size="small"
                      type="text"
                      icon={<EditOutlined />}
                      aria-label={t("profileLibrary.fieldSettings.rename")}
                      onClick={() => {
                        setRenamingId(field.field_id);
                        setRenameDraft(field.label);
                      }}
                    />
                  </Tooltip>
                )}
                <Tooltip title={t("profileLibrary.fieldSettings.delete")}>
                  <Button
                    className="profile-settings-action"
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={t("profileLibrary.fieldSettings.delete")}
                    disabled={busy}
                    onClick={() => requestDelete(field)}
                  />
                </Tooltip>
              </span>
            </div>
          ))}
        </div>

        {/* 添加字段并入「自定义字段」这一张卡：不再单起「添加字段」小标题与分隔线，
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
            aria-label={t("profileLibrary.fieldSettings.type")}
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
      </section>

      {deleting ? (
        <div className="profile-settings-confirm" role="alertdialog">
          <span className="profile-settings-card-title">
            {t("profileLibrary.fieldSettings.deleteTitle", { label: deleting.field.label })}
          </span>
          <p className="profile-settings-card-hint">
            {t("profileLibrary.fieldSettings.deleteBody", {
              count: deleting.impact.affected_entries,
            })}
          </p>
          <p className="profile-settings-card-hint">
            {t("profileLibrary.fieldSettings.deleteRestore")}
          </p>
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
    </div>
  );
}
