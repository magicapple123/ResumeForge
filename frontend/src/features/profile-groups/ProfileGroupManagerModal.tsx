// SPDX-License-Identifier: Apache-2.0
/**
 * 组与大字段管理的**单弹层**（F6/R-52/R-53/I/J）：列表 / 组编辑 / 字段设置视图切换。
 *
 * 为什么是单弹层多视图：AGENTS 规定同一时刻 Modal/Drawer/confirm 容器 <= 1，且弹层文件内
 * 禁止 modal.confirm。所以删除确认、组编辑、字段设置全在本 Modal 内切换视图；删除结构
 * 定义用内联确认条（动作 + 条数 + 保留后果 + 恢复位置）。表单型弹层禁蒙层关闭
 * （mask.closable=false）；提交中禁 Esc/×，其余 Esc 与 × 同义（子视图先退一层）。
 */
import { App, Button, Divider, Input, Modal, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import ProfileFieldSettings from "../profile-library/ProfileFieldSettings";
import ProfileSectionSettings from "../profile-library/ProfileSectionSettings";
import type { WorkspaceOut } from "../profile-library/types";
import ProfileGroupForm from "./ProfileGroupForm";
import { useCurrentProfileGroup } from "./useCurrentProfileGroup";

type View = "groups" | "group-edit" | "sections" | "fields";

interface Props {
  open: boolean;
  onClose: () => void;
  workspace: WorkspaceOut | null;
  onChanged: () => Promise<void>;
  initialView?: "groups" | "sections";
  /**
   * 资料页是否处于编辑态。新建组成功后：非编辑态自动设为当前组（立刻能在资料页看到
   * 「全部大字段已隐藏」的效果）；编辑态不切组（R-26 未保存改动不能被绕过），
   * 只提示先保存或取消编辑。
   */
  editing?: boolean;
}

export default function ProfileGroupManagerModal({
  open,
  onClose,
  workspace,
  onChanged,
  initialView = "groups",
  editing = false,
}: Props) {
  const { message } = App.useApp();
  const groupApi = useCurrentProfileGroup(workspace, onChanged);
  const [view, setView] = useState<View>(initialView);
  const [editingGroupId, setEditingGroupId] = useState("");
  const [fieldsKey, setFieldsKey] = useState("");
  const [deletingGroupId, setDeletingGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");

  // 视图状态只在挂载时初始化：宿主只在打开时挂载本弹层（关闭即卸载），
  // 不在 effect 里 setState（react-hooks/set-state-in-effect），也避免"重新打开残留上一层视图"。

  const editingGroup = groupApi.groups.find((group) => group.group_id === editingGroupId);
  const fieldsSection = workspace?.sections.find((section) => section.key === fieldsKey);
  const atLimit = workspace ? groupApi.groups.length >= workspace.limits.max_groups : false;

  const handleCancel = () => {
    if (groupApi.busy) return;
    if (view === "group-edit") {
      setView("groups");
      setEditingGroupId("");
      return;
    }
    if (view === "fields") {
      setView("sections");
      return;
    }
    onClose();
  };

  /**
   * 新建组（F9 / Lead 补充裁决）：
   * - 创建即只含 basic_info，因此「所有大字段默认隐藏」；
   * - 非编辑态：立刻切到新组，让资料页马上只剩基本信息 +「已隐藏的大字段」入口；
   * - 编辑态：不切组（有未保存改动时切组会丢编辑，R-26），只提示先保存或取消。
   */
  const submitCreate = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    const created = await groupApi.create(name);
    if (!created) return;
    setNewGroupName("");
    if (editing) {
      message.success(t("profileGroups.manager.createdKeepEditing", { name: created.name }));
      return;
    }
    const switched = await groupApi.switchTo(created.group_id);
    if (switched) {
      setView("groups");
      message.success(t("profileGroups.manager.createdSwitched", { name: created.name }));
    }
  };

  const submitGroupEdit = async (name: string, sectionKeys: string[]): Promise<boolean> => {
    const target = editingGroup;
    if (!target) return false;
    // 改名与参与清单是两次写：改名会让服务端 revision+1，必须用 PATCH 返回的新 revision
    // 继续写 members。用 workspace 里的旧 revision 会必然 409 revision_conflict（D1）。
    let expectedRevision = target.revision;
    if (name !== target.name) {
      const renamedGroup = await groupApi.rename(target.group_id, name);
      if (!renamedGroup) return false;
      expectedRevision = renamedGroup.revision;
    }
    const membersSaved = await groupApi.setMembers(target.group_id, sectionKeys, expectedRevision);
    if (membersSaved) {
      setView("groups");
      setEditingGroupId("");
    }
    return membersSaved;
  };

  const confirmDeleteGroup = async () => {
    if (!deletingGroupId) return;
    const ok = await groupApi.remove(deletingGroupId);
    if (ok) setDeletingGroupId("");
  };

  const renderGroups = () => (
    <div className="profile-group-manager-groups">
      <div className="profile-settings-add">
        <Input
          value={newGroupName}
          maxLength={40}
          placeholder={t("profileGroups.manager.createHint")}
          aria-label={t("profileGroups.manager.nameLabel")}
          onChange={(event) => setNewGroupName(event.target.value)}
          onPressEnter={() => void submitCreate()}
          disabled={groupApi.busy || atLimit}
          style={{ maxWidth: 260 }}
        />
        <Button
          type="primary"
          loading={groupApi.busy}
          disabled={atLimit}
          onClick={() => void submitCreate()}
        >
          {t("profileGroups.manager.create")}
        </Button>
        {atLimit ? (
          <Typography.Text type="secondary">
            {t("profileGroups.manager.groupCount")}
          </Typography.Text>
        ) : null}
      </div>
      <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0" }}>
        {t("profileGroups.manager.createVisibilityHint")}
      </Typography.Paragraph>
      <Divider style={{ margin: "12px 0" }} />
      {groupApi.groups.map((group) => {
        const isCurrent = groupApi.current?.group_id === group.group_id;
        const isDeleting = deletingGroupId === group.group_id;
        return (
          <div key={group.group_id} className="profile-settings-row" data-testid="group-row">
            <span className="profile-settings-row-main">
              {group.name}
              {group.is_default ? (
                <Tag style={{ marginLeft: 8 }}>{t("profileGroups.manager.default")}</Tag>
              ) : null}
              {isCurrent ? (
                <Tag color="blue" style={{ marginLeft: 8 }}>
                  {t("profileGroups.manager.current")}
                </Tag>
              ) : null}
            </span>
            <span className="profile-settings-row-actions">
              {isCurrent ? null : (
                <Button
                  size="small"
                  disabled={groupApi.busy}
                  onClick={() => void groupApi.switchTo(group.group_id)}
                >
                  {t("profileGroups.manager.setCurrent")}
                </Button>
              )}
              <Button
                size="small"
                disabled={groupApi.busy}
                onClick={() => {
                  setEditingGroupId(group.group_id);
                  setView("group-edit");
                }}
              >
                {t("profileGroups.manager.rename")}
              </Button>
              {group.is_default ? (
                <Tooltip title={t("profileGroups.manager.defaultProtected")}>
                  <Typography.Text type="secondary">
                    {t("profileGroups.manager.defaultProtected")}
                  </Typography.Text>
                </Tooltip>
              ) : (
                <Button
                  size="small"
                  danger
                  disabled={groupApi.busy}
                  onClick={() => setDeletingGroupId(group.group_id)}
                >
                  {t("profileGroups.manager.delete")}
                </Button>
              )}
            </span>
            {isDeleting ? (
              <div className="profile-settings-confirm" role="alertdialog">
                <Typography.Text strong>
                  {t("profileGroups.manager.deleteTitle", { name: group.name })}
                </Typography.Text>
                <Typography.Paragraph>{t("profileGroups.manager.deleteBody")}</Typography.Paragraph>
                <Typography.Paragraph type="secondary">
                  {t("profileGroups.manager.deleteRestore")}
                </Typography.Paragraph>
                <div className="profile-settings-confirm-actions">
                  <Button danger loading={groupApi.busy} onClick={() => void confirmDeleteGroup()}>
                    {t("profileGroups.manager.deleteConfirm", { name: group.name })}
                  </Button>
                  <Button onClick={() => setDeletingGroupId("")}>
                    {t("profileGroups.manager.back")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  const viewTitle =
    view === "sections" || view === "fields"
      ? t("profileLibrary.sectionSettings.title")
      : view === "group-edit"
        ? t("profileGroups.manager.membersTitle")
        : t("profileGroups.manager.title");

  return (
    <Modal
      title={viewTitle}
      open={open}
      onCancel={handleCancel}
      footer={null}
      width={760}
      mask={{ closable: false }}
      keyboard={!groupApi.busy}
      closable={!groupApi.busy}
      destroyOnHidden
    >
      {view === "groups" ? renderGroups() : null}
      {view === "group-edit" && editingGroup ? (
        <ProfileGroupForm
          group={editingGroup}
          sections={workspace?.sections ?? []}
          busy={groupApi.busy}
          onSubmit={submitGroupEdit}
          onCancel={() => {
            setView("groups");
            setEditingGroupId("");
          }}
        />
      ) : null}
      {view === "group-edit" && !editingGroup ? (
        <Typography.Paragraph type="secondary">
          {t("profileLibrary.error.notFound")}
        </Typography.Paragraph>
      ) : null}
      {view === "sections" && workspace ? (
        <ProfileSectionSettings
          workspace={workspace}
          onChanged={onChanged}
          onOpenFields={(sectionKey) => {
            setFieldsKey(sectionKey);
            setView("fields");
          }}
          onSetSectionVisible={(sectionKey, visible) => {
            void groupApi.setSectionVisible(sectionKey, visible);
          }}
          visibilityBusy={groupApi.busy}
        />
      ) : null}
      {view === "fields" && workspace && fieldsSection ? (
        <ProfileFieldSettings
          section={fieldsSection}
          maxCustomFields={workspace.limits.max_custom_fields_per_section}
          workspaceRevision={workspace.workspace_revision}
          sectionVisible={groupApi.current?.participating_keys.includes(fieldsSection.key) ?? false}
          onSetSectionVisible={(visible) => {
            void groupApi.setSectionVisible(fieldsSection.key, visible);
          }}
          visibilityBusy={groupApi.busy}
          onChanged={onChanged}
          onBack={() => setView("sections")}
        />
      ) : null}
      {view === "fields" && !fieldsSection ? (
        <Typography.Paragraph type="secondary">
          {t("profileLibrary.error.notFound")}
        </Typography.Paragraph>
      ) : null}
      {view === "groups" || view === "sections" ? (
        <div className="profile-settings-confirm-actions" style={{ marginTop: 16 }}>
          <Button
            onClick={() => setView(view === "groups" ? "sections" : "groups")}
            disabled={groupApi.busy}
          >
            {view === "groups"
              ? t("profileGroups.manager.sectionsTab")
              : t("profileGroups.manager.groupsTab")}
          </Button>
          <Button onClick={handleCancel} disabled={groupApi.busy}>
            {t("profileGroups.manager.close")}
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}
