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
 *
 * 问题 18 整改（2026-11-03）：行首 Checkbox 负责「参与当前方案」，改名/字段设置/删除
 * 收进 ⋯；两张卡片不再各写一遍同一句开关说明（语义图例在列表上方只出现一次），
 * 「N 个系统板块恒在」挪到系统板块卡片标题右侧的 Tag；创建区统一在列表底部。
 *
 * 需求 6（2026-11-03）：自建板块行多一行「参与岗位筛选」开关 + 一句人话说明。
 * 它是**板块级**开关（同一板块所有条目共用一个判据），与行首的「参与当前方案」是两件事，
 * 因此用 Switch + 常驻说明，而不是第二个 Checkbox。
 */
import { App, Button, Input, Tag } from "antd";
import { Fragment, useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { createSection, deleteSection, getSectionDeletionImpact, renameSection } from "./api";
import { profileErrorMessage } from "./errors";
import { profileSectionLabel } from "./profileLabels";
import { invalidateProjectionCache } from "./projectionCache";
import ParticipationCheckbox from "./participationCheckbox";
import SectionJobFilterSwitch from "./sectionJobFilterSwitch";
import SettingsMoreMenu from "./settingsMoreMenu";
import type { SectionDeletionImpactOut, WorkspaceOut } from "./types";

interface Props {
  workspace: WorkspaceOut;
  onChanged: () => Promise<void>;
  onOpenFields: (sectionKey: string) => void;
  /** 「在资料页显示」勾选：写当前组参与清单（F9）。 */
  onSetSectionVisible: (sectionKey: string, visible: boolean) => void;
  /** 需求 6：「参与岗位相关性筛选」板块级开关（自建板块才有）。 */
  onSetSectionJobFilter: (sectionKey: string, enabled: boolean) => void;
  /** 参与清单写请求进行中：禁用本视图全部勾选框，避免连续点击互相覆盖。 */
  visibilityBusy?: boolean;
}

export default function ProfileSectionSettings({
  workspace,
  onChanged,
  onOpenFields,
  onSetSectionVisible,
  onSetSectionJobFilter,
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

  /** 行首勾选：三层统一「左侧选择」的位置与形态（问题 18 的 ①）。 */
  const renderParticipation = (section: WorkspaceOut["sections"][number]) => (
    <ParticipationCheckbox
      sectionName={profileSectionLabel(section)}
      checked={section.key === "basic_info" || visibleKeys.has(section.key)}
      locked={section.key === "basic_info"}
      busy={visibilityBusy}
      onChange={(visible) => onSetSectionVisible(section.key, visible)}
    />
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
      {/* 语义图例全视图只出现一次：两张卡片各写一遍「开关控制…」正是问题 18 的重复来源。 */}
      <p className="profile-settings-legend">
        {t("profileLibrary.sectionSettings.participationLegend")}
      </p>

      <section className="profile-settings-card">
        <h3 className="profile-settings-card-title">
          {t("profileLibrary.sectionSettings.customTitle")}
        </h3>
        <p className="profile-settings-card-hint">
          {t("profileLibrary.sectionSettings.customHint")}
        </p>
        {customSections.length === 0 ? (
          <p className="profile-settings-card-hint">{t("profileLibrary.sectionSettings.empty")}</p>
        ) : null}
        <div className="profile-settings-list">
          {customSections.map((section) => (
            <div key={section.key} className="profile-settings-row profile-settings-row-stacked">
              <div className="profile-settings-row-head">
                {renderParticipation(section)}
                {renamingKey === section.key ? (
                  <Input
                    className="profile-settings-rename-input"
                    value={renameDraft}
                    maxLength={40}
                    aria-label={t("profileLibrary.sectionSettings.rename")}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onPressEnter={() => submitRename(section.key)}
                  />
                ) : (
                  renderRowMain(section)
                )}
                <span className="profile-settings-row-actions">
                  {renamingKey === section.key ? (
                    <Button
                      size="small"
                      type="primary"
                      loading={busy}
                      onClick={() => submitRename(section.key)}
                    >
                      {t("profileLibrary.sectionSettings.saveName")}
                    </Button>
                  ) : (
                    <SettingsMoreMenu
                      label={t("profileLibrary.sectionSettings.more")}
                      disabled={busy}
                      actions={[
                        {
                          key: "rename",
                          label: t("profileLibrary.sectionSettings.renameMenu"),
                          onSelect: () => {
                            setRenamingKey(section.key);
                            setRenameDraft(section.name);
                          },
                        },
                        {
                          key: "fields",
                          label: t("profileLibrary.sectionSettings.fields"),
                          onSelect: () => onOpenFields(section.key),
                        },
                        {
                          key: "delete",
                          label: t("profileLibrary.sectionSettings.deleteMenu"),
                          danger: true,
                          onSelect: () => requestDelete(section.key, profileSectionLabel(section)),
                        },
                      ]}
                    />
                  )}
                </span>
              </div>
              {/* 需求 6：板块级「参与岗位相关性筛选」——不是字段级，也不与行首的
                  「参与当前方案」勾选混用同一种控件。 */}
              <SectionJobFilterSwitch
                sectionName={profileSectionLabel(section)}
                checked={section.filter_by_job}
                busy={visibilityBusy}
                onChange={(enabled) => onSetSectionJobFilter(section.key, enabled)}
              />
            </div>
          ))}
        </div>
        {/* 创建区与「方案」页一致：放在列表底部，输入框 flex:1、按钮固定宽。 */}
        <div className="profile-settings-add profile-settings-add-bottom">
          <Input
            className="profile-settings-add-grow"
            value={newName}
            maxLength={40}
            placeholder={t("profileLibrary.sectionSettings.nameLabel")}
            onChange={(event) => setNewName(event.target.value)}
            onPressEnter={submitCreate}
          />
          <Button
            className="profile-settings-add-action"
            type="primary"
            loading={busy}
            onClick={submitCreate}
          >
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
          <Tag className="profile-settings-card-count">
            {t("profileLibrary.sectionSettings.builtinCount", { count: builtinSections.length })}
          </Tag>
        </h3>
        <p className="profile-settings-card-hint">
          {t("profileLibrary.sectionSettings.builtinHint")}
        </p>
        <div className="profile-settings-list">
          {builtinSections.map((section) => (
            <Fragment key={section.key}>
              <div className="profile-settings-row">
                {renderParticipation(section)}
                {renderRowMain(section)}
                <span className="profile-settings-row-actions">
                  <SettingsMoreMenu
                    label={t("profileLibrary.sectionSettings.more")}
                    disabled={busy}
                    actions={[
                      {
                        key: "fields",
                        label: t("profileLibrary.sectionSettings.fields"),
                        onSelect: () => onOpenFields(section.key),
                      },
                    ]}
                  />
                </span>
              </div>
            </Fragment>
          ))}
        </div>
      </section>
    </div>
  );
}
