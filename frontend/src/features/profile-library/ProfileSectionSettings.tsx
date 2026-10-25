// SPDX-License-Identifier: Apache-2.0
/**
 * 大字段与字段管理（F6）：自建大字段 CRUD + 每个分区的字段设置入口。
 *
 * 系统 13 大字段恒在、只能改字段偏好（隐藏/展开）不能改名删除；自建大字段可改名、
 * 可删除但**条目与值保留**（删除前先取影响面，三段式确认：动作 + 条数 + 保留后果 + 恢复位置）。
 * 本组件不新开弹层：宿主是单 Modal 多视图里的 sections 视图。
 */
import { App, Button, Divider, Input, Typography } from "antd";
import { useState } from "react";
import SectionVisibilitySwitch from "../../components/profile/SectionVisibilitySwitch";
import { t } from "../../i18n";
import { createSection, deleteSection, getSectionDeletionImpact, renameSection } from "./api";
import { profileErrorMessage } from "./errors";
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

  return (
    <div className="profile-section-settings">
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t("profileLibrary.sectionSettings.customTitle")}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        {t("profileLibrary.sectionSettings.customHint")}
      </Typography.Paragraph>
      {customSections.length === 0 ? (
        <Typography.Paragraph type="secondary">
          {t("profileLibrary.sectionSettings.empty")}
        </Typography.Paragraph>
      ) : null}
      {customSections.map((section) => (
        <div key={section.key} className="profile-settings-row">
          {renamingKey === section.key ? (
            <Input
              value={renameDraft}
              maxLength={40}
              onChange={(event) => setRenameDraft(event.target.value)}
              onPressEnter={() => submitRename(section.key)}
              style={{ maxWidth: 240 }}
            />
          ) : (
            <span className="profile-settings-row-main">
              {section.name}
              <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
                {t("profileLibrary.sectionSettings.fields")} · {section.fields.length}
              </Typography.Text>
            </span>
          )}
          <span className="profile-settings-row-actions">
            <SectionVisibilitySwitch
              sectionName={section.name}
              visible={visibleKeys.has(section.key)}
              busy={visibilityBusy}
              onChange={(visible) => onSetSectionVisible(section.key, visible)}
            />
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
              <Button
                size="small"
                onClick={() => {
                  setRenamingKey(section.key);
                  setRenameDraft(section.name);
                }}
              >
                {t("profileLibrary.sectionSettings.rename")}
              </Button>
            )}
            <Button size="small" onClick={() => onOpenFields(section.key)}>
              {t("profileLibrary.sectionSettings.fields")}
            </Button>
            <Button
              size="small"
              danger
              disabled={busy}
              onClick={() => requestDelete(section.key, section.name)}
            >
              {t("profileLibrary.sectionSettings.delete")}
            </Button>
          </span>
        </div>
      ))}

      {deleting ? (
        <div className="profile-settings-confirm" role="alertdialog">
          <Typography.Text strong>
            {t("profileLibrary.sectionSettings.deleteTitle", { name: deleting.name })}
          </Typography.Text>
          <Typography.Paragraph>
            {t("profileLibrary.sectionSettings.deleteBody", {
              count: deleting.impact.entry_count,
            })}
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">
            {t("profileLibrary.sectionSettings.deleteRestore")}
          </Typography.Paragraph>
          <div className="profile-settings-confirm-actions">
            <Button danger loading={busy} onClick={confirmDelete}>
              {t("profileLibrary.sectionSettings.deleteConfirm", { name: deleting.name })}
            </Button>
            <Button onClick={() => setDeleting(null)}>{t("profileGroups.manager.back")}</Button>
          </div>
        </div>
      ) : null}

      <div className="profile-settings-add">
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

      <Divider plain>{t("profileLibrary.sectionSettings.builtin")}</Divider>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        {t("profileLibrary.sectionSettings.builtinHint")}
      </Typography.Paragraph>
      {builtinSections.map((section) => (
        <div key={section.key} className="profile-settings-row">
          <span className="profile-settings-row-main">
            {section.name}
            <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
              {t("profileLibrary.sectionSettings.fields")} · {section.fields.length}
            </Typography.Text>
          </span>
          <span className="profile-settings-row-actions">
            <SectionVisibilitySwitch
              sectionName={section.name}
              visible={section.key === "basic_info" || visibleKeys.has(section.key)}
              locked={section.key === "basic_info"}
              busy={visibilityBusy}
              onChange={(visible) => onSetSectionVisible(section.key, visible)}
            />
            <Button size="small" onClick={() => onOpenFields(section.key)}>
              {t("profileLibrary.sectionSettings.fields")}
            </Button>
          </span>
        </div>
      ))}
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 12 }}>
        {t("profileLibrary.sectionSettings.customHint")}
      </Typography.Text>
      <span hidden>{entryCountByKey.size}</span>
    </div>
  );
}
