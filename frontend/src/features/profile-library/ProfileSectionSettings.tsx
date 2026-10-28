// SPDX-License-Identifier: Apache-2.0
/**
 * 大字段与字段管理（F6）：自建大字段 CRUD + 每个分区的字段设置入口。
 *
 * 系统 13 大字段恒在、只能改字段偏好（隐藏/恢复）不能改名删除；自建大字段可改名、
 * 可删除但**条目与值保留**（删除前先取影响面，三段式确认：动作 + 条数 + 保留后果 + 恢复位置）。
 * 本组件不新开弹层：宿主是单 Modal 多视图里的 sections 视图。
 *
 * 层级（2026-10-27 整改）：弹层标题 > 卡片标题 > 行标题 > 说明。此前「自建板块」与
 * 「系统板块」都是 20px 粗体的 Typography.Title 紧贴 24px 的弹层标题，看起来像三个
 * 并列标题；现在每一组是一张卡，卡片标题 14px/600 + 12px 说明（样式在 profile-card.css）。
 */
import { App, Button, Input, Tooltip } from "antd";
import { DeleteOutlined, EditOutlined, SettingOutlined } from "@ant-design/icons";
import { useState } from "react";
import SectionVisibilitySwitch from "../../components/profile/SectionVisibilitySwitch";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { createSection, deleteSection, getSectionDeletionImpact, renameSection } from "./api";
import { profileErrorMessage } from "./errors";
import { profileSectionLabel } from "./profileLabels";
import { invalidateProjectionCache } from "./projectionCache";
import type { SectionDeletionImpactOut, WorkspaceOut } from "./types";

interface Props {
  workspace: WorkspaceOut;
  onChanged: () => Promise<void>;
  onOpenFields: (sectionKey: string) => void;
  /** 「在资料页显示」开关：写当前组参与清单（F9）。 */
  onSetSectionVisible: (sectionKey: string, visible: boolean) => void;
  /** 参与清单写请求进行中：禁用本视图全部开关，避免连续点击互相覆盖。 */
  visibilityBusy?: boolean;
}

export default function ProfileSectionSettings({
  workspace,
  onChanged,
  onOpenFields,
  onSetSectionVisible,
  visibilityBusy = false,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingKey, setRenamingKey] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [deleting, setDeleting] = useState<{
    sectionKey: string;
    name: string;
    impact: SectionDeletionImpactOut;
  } | null>(null);

  const builtinSections = workspace.sections.filter((section) => section.is_builtin);
  const customSections = workspace.sections.filter((section) => !section.is_builtin);
  const visibleKeys = new Set(workspace.current_group?.participating_keys ?? []);
  const entryCountByKey = new Map<string, number>();
  workspace.entries.forEach((entry) => {
    entryCountByKey.set(entry.section_key, (entryCountByKey.get(entry.section_key) ?? 0) + 1);
  });

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

  const submitCreate = () => {
    const name = newName.trim();
    if (!name) {
      message.warning(t("profileLibrary.sectionSettings.nameHint"));
      return;
    }
    void run(async () => {
      await createSection(name, workspace.workspace_revision);
      setNewName("");
    });
  };

  const submitRename = (sectionKey: string) => {
    const name = renameDraft.trim();
    const section = workspace.sections.find((item) => item.key === sectionKey);
    if (!name || !section) return;
    void run(async () => {
      await renameSection(sectionKey, name, section.revision);
      setRenamingKey("");
    });
  };

  const requestDelete = (sectionKey: string, name: string) => {
    void run(async () => {
      const impact = await getSectionDeletionImpact(sectionKey);
      setDeleting({ sectionKey, name, impact });
    });
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const target = deleting;
    void run(async () => {
      await deleteSection(target.sectionKey, target.impact.revision);
      setDeleting(null);
    });
  };

  /** 行内右侧的动作组：自建大字段（显示开关 / 改名 / 字段设置 / 删除）与系统大字段（开关 / 字段设置）共用。 */
  const renderActions = (section: WorkspaceOut["sections"][number]) => (
    <span className="profile-settings-row-actions">
      <SectionVisibilitySwitch
        sectionName={profileSectionLabel(section)}
        visible={section.key === "basic_info" || visibleKeys.has(section.key)}
        locked={section.key === "basic_info"}
        busy={visibilityBusy}
        hideLabel
        onChange={(visible) => onSetSectionVisible(section.key, visible)}
      />
      {!section.is_builtin ? (
        renamingKey === section.key ? (
          <Button
            size="small"
            type="primary"
            loading={busy}
            onClick={() => submitRename(section.key)}
          >
            {t("profileLibrary.sectionSettings.saveName")}
          </Button>
        ) : (
          <Tooltip title={t("profileLibrary.sectionSettings.rename")}>
            <Button
              className="profile-settings-action"
              size="small"
              type="text"
              icon={<EditOutlined />}
              aria-label={t("profileLibrary.sectionSettings.rename")}
              onClick={() => {
                setRenamingKey(section.key);
                setRenameDraft(section.name);
              }}
            />
          </Tooltip>
        )
      ) : null}
      <Tooltip title={t("profileLibrary.sectionSettings.fields")}>
        <Button
          className="profile-settings-action"
          size="small"
          type="text"
          icon={<SettingOutlined />}
          aria-label={t("profileLibrary.sectionSettings.fields")}
          onClick={() => onOpenFields(section.key)}
        />
      </Tooltip>
      {!section.is_builtin ? (
        <Tooltip title={t("profileLibrary.sectionSettings.delete")}>
          <Button
            className="profile-settings-action"
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            aria-label={t("profileLibrary.sectionSettings.delete")}
            disabled={busy}
            onClick={() => requestDelete(section.key, profileSectionLabel(section))}
          />
        </Tooltip>
      ) : null}
    </span>
  );

  const renderRowMain = (section: WorkspaceOut["sections"][number]) => (
    <span className="profile-settings-row-main">
      <span className="profile-settings-row-title">{profileSectionLabel(section)}</span>
      <span className="profile-settings-row-meta">
        {t("profileLibrary.sectionSettings.fieldsCount", { count: section.fields.length })}
      </span>
      <span className="profile-settings-row-meta">
        {t("profileLibrary.sectionSettings.entriesCount", {
          count: entryCountByKey.get(section.key) ?? 0,
        })}
      </span>
    </span>
  );

  return (
    <div className="profile-section-settings">
      <section className="profile-settings-card">
        <h3 className="profile-settings-card-title">
          {t("profileLibrary.sectionSettings.customTitle")}
        </h3>
        <p className="profile-settings-card-hint">
          {t("profileLibrary.sectionSettings.customHint")}
        </p>
        {/* 每行只剩开关后「在资料页显示」这句话没了着落：收成一条图例，两个列表各一次。 */}
        <div className="profile-settings-legend">
          {t("profileLibrary.sectionSettings.visibilityLegend")}
        </div>
        {customSections.length === 0 ? (
          <p className="profile-settings-card-hint">{t("profileLibrary.sectionSettings.empty")}</p>
        ) : null}
        <div className="profile-settings-list">
          {customSections.map((section) => (
            <div key={section.key} className="profile-settings-row">
              {renamingKey === section.key ? (
                <Input
                  value={renameDraft}
                  maxLength={40}
                  aria-label={t("profileLibrary.sectionSettings.rename")}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onPressEnter={() => submitRename(section.key)}
                  style={{ maxWidth: 240 }}
                />
              ) : (
                renderRowMain(section)
              )}
              {renderActions(section)}
            </div>
          ))}
        </div>
        <div className="profile-settings-add" style={{ marginTop: 12 }}>
          <Input
            value={newName}
            maxLength={40}
            placeholder={t("profileLibrary.sectionSettings.nameLabel")}
            onChange={(event) => setNewName(event.target.value)}
            onPressEnter={submitCreate}
            style={{ maxWidth: 240 }}
          />
          <Button type="primary" loading={busy} onClick={submitCreate}>
            {t("profileLibrary.sectionSettings.create")}
          </Button>
        </div>
      </section>

      {deleting ? (
        <div className="profile-settings-confirm" role="alertdialog">
          <span className="profile-settings-card-title">
            {t("profileLibrary.sectionSettings.deleteTitle", { name: deleting.name })}
          </span>
          <p className="profile-settings-card-hint">
            {t("profileLibrary.sectionSettings.deleteBody", {
              count: deleting.impact.entry_count,
            })}
          </p>
          <p className="profile-settings-card-hint">
            {t("profileLibrary.sectionSettings.deleteRestore")}
          </p>
          <div className="profile-settings-confirm-actions">
            <Button danger loading={busy} onClick={confirmDelete}>
              {t("profileLibrary.sectionSettings.deleteConfirm", { name: deleting.name })}
            </Button>
            <Button onClick={() => setDeleting(null)}>{t("profileGroups.manager.back")}</Button>
          </div>
        </div>
      ) : null}

      <section className="profile-settings-card">
        <h3 className="profile-settings-card-title">
          {t("profileLibrary.sectionSettings.builtin")}
        </h3>
        <p className="profile-settings-card-hint">
          {t("profileLibrary.sectionSettings.builtinHint")}
        </p>
        <div className="profile-settings-legend">
          {t("profileLibrary.sectionSettings.visibilityLegend")}
        </div>
        <div className="profile-settings-list">
          {builtinSections.map((section) => (
            <div key={section.key} className="profile-settings-row">
              {renderRowMain(section)}
              {renderActions(section)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
