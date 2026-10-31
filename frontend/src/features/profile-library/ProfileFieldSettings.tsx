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
import { Fragment, useState } from "react";
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
import {
  catalogPlacementOf,
  invalidateFieldPlacementCatalog,
  PLACEMENT_LABEL_KEYS,
  profilePlacementLabel,
  PROFILE_PLACEMENT_OPTIONS,
  useFieldPlacementCatalog,
} from "./fieldPlacement";
import type { DocumentFieldCatalog, Placement } from "../../types/resumeDocument";
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
  // 纸面位置（0069）：空串 = 按字段类型自动（后端默认：单行/日期 trail、多行 body）。
  const [addPlacement, setAddPlacement] = useState<Placement | "">("");
  const [addMaterialOnly, setAddMaterialOnly] = useState(false);
  const placementCatalog = useFieldPlacementCatalog();
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
      // 新建/删除自定义字段会改变字段位置目录 → 丢掉会话缓存，下次读回新位置。
      invalidateFieldPlacementCatalog();
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
      await createField(section.key, label, addType, workspaceRevision, {
        // 仅素材字段恒 hidden（与后端 D6 同一口径）；否则显式值优先、null = 按类型自动。
        defaultPlacement: addMaterialOnly ? "hidden" : addPlacement || null,
        materialOnly: addMaterialOnly,
      });
      setAddLabel("");
      setAddPlacement("");
      setAddMaterialOnly(false);
    });
  };

  /** 自定义字段的纸面位置/仅素材行内编辑（只写 0069 的两个定义列，不碰值）。 */
  const renderPlacementEditor = (field: FieldOut) => {
    const materialOnly = field.material_only === true;
    const placement = (field.effective_placement ?? field.default_placement ?? "") as
      Placement | "";
    return (
      <div className="profile-field-placement" style={{ margin: "4px 0 8px 0" }}>
        <Select
          size="small"
          style={{ minWidth: 132 }}
          value={materialOnly ? "hidden" : (field.default_placement ?? "")}
          aria-label={t("structure.profile.editPlacement")}
          disabled={busy || materialOnly}
          onChange={(value) => {
            void run(async () => {
              await updateField(section.key, field.field_id, {
                default_placement: value === "" ? null : (value as string),
                expected_revision: field.revision,
              });
            });
          }}
          options={[
            { value: "", label: t("structure.profile.placementAuto") },
            ...PROFILE_PLACEMENT_OPTIONS.map((value) => ({
              value,
              label: t(PLACEMENT_LABEL_KEYS[value]),
            })),
          ]}
        />
        <Switch
          size="small"
          checked={materialOnly}
          aria-label={t("structure.profile.materialOnlyToggle")}
          disabled={busy}
          onChange={(checked) => {
            void run(async () => {
              await updateField(section.key, field.field_id, {
                material_only: checked,
                // 仅素材恒 hidden；恢复素材时回到"按类型自动"，避免沿用旧的 hidden 显式值。
                default_placement: checked ? "hidden" : null,
                expected_revision: field.revision,
              });
            });
          }}
        />
        <span
          className={materialOnly ? "profile-field-material-hint" : "profile-field-placement-hint"}
        >
          {materialOnly
            ? t("structure.profile.materialOnlyHint")
            : t("structure.profile.placementBadge", {
                placement: profilePlacementLabel(placement),
              })}
        </span>
      </div>
    );
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

  /** 删除确认条：跟着被点的那一行走（2026-10-29 用户反馈"确认藏在卡片下面看不见"）。 */
  const renderDeleteConfirm = () => {
    if (!deleting) return null;
    return (
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
    );
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
                <BuiltinPlacementBadge
                  catalog={placementCatalog.catalog}
                  section={section}
                  field={field}
                />
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
            <Fragment key={field.field_id}>
              <div className="profile-settings-row">
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
                    <Tag>
                      {profilePlacementLabel(field.effective_placement ?? field.default_placement)}
                    </Tag>
                    {field.material_only ? (
                      <Tag color="red">{t("structure.profile.materialOnlyShort")}</Tag>
                    ) : null}
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
              {renderPlacementEditor(field)}
              {deleting?.field.field_id === field.field_id ? renderDeleteConfirm() : null}
            </Fragment>
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
          <Select
            value={addMaterialOnly ? "hidden" : addPlacement}
            style={{ width: 150 }}
            aria-label={t("structure.profile.placement")}
            disabled={customFields.length >= maxCustomFields || addMaterialOnly}
            onChange={(value) => setAddPlacement(value as Placement | "")}
            options={[
              { value: "", label: t("structure.profile.placementAuto") },
              ...PROFILE_PLACEMENT_OPTIONS.map((value) => ({
                value,
                label: t(PLACEMENT_LABEL_KEYS[value]),
              })),
            ]}
          />
          <Tooltip title={t("structure.profile.materialOnlyToggle")}>
            <Switch
              size="small"
              checked={addMaterialOnly}
              aria-label={t("structure.profile.materialOnlyToggle")}
              disabled={customFields.length >= maxCustomFields}
              onChange={(checked) => {
                setAddMaterialOnly(checked);
                if (checked) setAddPlacement("hidden");
              }}
            />
          </Tooltip>
          <Button
            type="primary"
            loading={busy}
            disabled={customFields.length >= maxCustomFields}
            onClick={submitAdd}
          >
            {t("profileLibrary.fieldSettings.create")}
          </Button>
        </div>
        {addMaterialOnly ? (
          <p className="profile-field-material-hint" style={{ marginTop: 4 }}>
            {t("structure.profile.materialOnlyHint")}
          </p>
        ) : null}
      </section>
    </div>
  );
}

/** 内置字段的纸面位置徽标（只读）：位置来自字段目录，找不到目录项时不显示。 */
function BuiltinPlacementBadge({
  catalog,
  section,
  field,
}: {
  catalog: DocumentFieldCatalog | null;
  section: SectionOut;
  field: FieldOut;
}) {
  const catalogField = catalogPlacementOf(catalog, section, field);
  if (!catalogField) return null;
  if (catalogField.material_only) {
    return (
      <Tooltip title={t("structure.profile.materialOnlyHint")}>
        <Tag color="red">{t("structure.profile.materialOnlyShort")}</Tag>
      </Tooltip>
    );
  }
  const label = profilePlacementLabel(catalogField.default_placement);
  return (
    <Tooltip title={t("structure.profile.badgeTitle", { placement: label })}>
      <Tag>{label}</Tag>
    </Tooltip>
  );
}
