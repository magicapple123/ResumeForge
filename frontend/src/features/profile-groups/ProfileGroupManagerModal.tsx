// SPDX-License-Identifier: Apache-2.0
/**
 * 组与大字段管理的**单弹层**（F6/R-52/R-53/I/J）：列表 / 组编辑 / 字段设置视图切换。
 *
 * 为什么是单弹层多视图：AGENTS 规定同一时刻 Modal/Drawer/confirm 容器 <= 1，且弹层文件内
 * 禁止 modal.confirm。所以删除确认、组编辑、字段设置全在本 Modal 内切换视图；删除结构
 * 定义用内联确认条（动作 + 条数 + 保留后果 + 恢复位置）。表单型弹层禁蒙层关闭
 * （mask.closable=false）；提交中禁 Esc/×，其余 Esc 与 × 同义（子视图先退一层）。
 */
import { App, Button, Input, Modal, Popconfirm, Tabs, Tag, Tooltip, Typography } from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Fragment, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { profileGroupDisplayName } from "../../utils/displayNames";
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
   * 从资料页某张卡的齿轮进来时带上该大字段 key：弹层直接落到「字段设置」视图。
   * 只在挂载时消费一次（宿主关闭即卸载），所以不需要在 effect 里同步。
   */
  initialSectionKey?: string;
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
  initialSectionKey,
  editing = false,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  const groupApi = useCurrentProfileGroup(workspace, onChanged);
  // 带着大字段 key 进来时直接落到「字段设置」（齿轮入口），否则按调用方给的初始视图。
  const [view, setView] = useState<View>(initialSectionKey ? "fields" : initialView);
  const [editingGroupId, setEditingGroupId] = useState("");
  const [fieldsKey, setFieldsKey] = useState(initialSectionKey ?? "");
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
      {/* 与「板块与字段」视图同一套卡片外观（.profile-settings-card）：同一个弹层里
          两个视图的容器形态不该不一样。此处不再给卡片标题——弹层标题已经是「方案」。 */}
      <section className="profile-settings-card">
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
            <span className="profile-settings-row-meta">
              {t("profileGroups.manager.groupCount")}
            </span>
          ) : null}
        </div>
        <p className="profile-settings-card-hint" style={{ marginTop: 8 }}>
          {t("profileGroups.manager.createVisibilityHint")}
        </p>
        {/* 一行一个方案：名称/Tag 在左，动作按钮在右（.profile-settings-* 见 profile-layout.css）。
          删除确认是行**之外**的兄弟节点——行本身是 flex 横排，塞第三个子元素会被压扁。
          动作簇与「板块与字段」视图共用同一套类名：24×24 图标按钮 + Tooltip + aria-label。 */}
        <div className="profile-settings-list">
          {groupApi.groups.map((group) => {
            const isCurrent = groupApi.current?.group_id === group.group_id;
            const isDeleting = deletingGroupId === group.group_id;
            return (
              <Fragment key={group.group_id}>
                <div className="profile-settings-row" data-testid="group-row">
                  <span className="profile-settings-row-main">
                    <span className="profile-settings-row-title">
                      {profileGroupDisplayName(group)}
                    </span>
                    {/* 名字已经被翻成「默认方案」时不再重复挂一个同名 Tag；改过名的
                        默认组名字是用户数据，保留 Tag 说明它仍是默认组。 */}
                    {group.is_default && !group.name_is_default ? (
                      <span className="profile-settings-row-meta">
                        {t("profileGroups.manager.default")}
                      </span>
                    ) : null}
                    {isCurrent ? (
                      <Tag color="blue">{t("profileGroups.manager.current")}</Tag>
                    ) : null}
                  </span>
                  <span className="profile-settings-row-actions">
                    {isCurrent ? null : (
                      <Button
                        size="small"
                        type="text"
                        disabled={groupApi.busy}
                        onClick={() => void groupApi.switchTo(group.group_id)}
                      >
                        {t("profileGroups.manager.setCurrent")}
                      </Button>
                    )}
                    <Tooltip title={t("profileGroups.manager.rename")}>
                      <Button
                        className="profile-settings-action"
                        size="small"
                        type="text"
                        icon={<EditOutlined />}
                        aria-label={t("profileGroups.manager.rename")}
                        disabled={groupApi.busy}
                        onClick={() => {
                          setEditingGroupId(group.group_id);
                          setView("group-edit");
                        }}
                      />
                    </Tooltip>
                    {group.is_default ? (
                      <Tooltip title={t("profileGroups.manager.defaultProtected")}>
                        <span className="profile-settings-row-meta">
                          {t("profileGroups.manager.defaultProtected")}
                        </span>
                      </Tooltip>
                    ) : (
                      <Popconfirm
                        open={isDeleting}
                        title={t("profileGroups.manager.deleteTitle", { name: group.name })}
                        description={
                          <div>
                            <p className="profile-settings-card-hint">
                              {t("profileGroups.manager.deleteBody")}
                            </p>
                            <p className="profile-settings-card-hint">
                              {t("profileGroups.manager.deleteRestore")}
                            </p>
                          </div>
                        }
                        okText={t("profileGroups.manager.deleteConfirm", { name: group.name })}
                        okButtonProps={{ danger: true, loading: groupApi.busy }}
                        cancelText={t("profileGroups.manager.back")}
                        onConfirm={() => void confirmDeleteGroup()}
                        onCancel={() => setDeletingGroupId("")}
                      >
                        {/* 删除按钮不叠 Tooltip：确认气泡本身就是说明（Tooltip 与 Popconfirm
                          共用同一个 trigger，叠在一起会互相抢悬停）。 */}
                        <Button
                          className="profile-settings-action"
                          size="small"
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={t("profileGroups.manager.delete")}
                          disabled={groupApi.busy}
                          onClick={() => setDeletingGroupId(group.group_id)}
                        />
                      </Popconfirm>
                    )}
                  </span>
                </div>
              </Fragment>
            );
          })}
        </div>
      </section>
    </div>
  );

  // 页签负责区分「方案 / 板块与字段」，所以两个列表视图共用同一个弹层标题；
  // 下钻层（编辑方案 / 字段设置）各有自己的标题与返回入口。
  const viewTitle =
    view === "fields"
      ? t("profileLibrary.sectionSettings.title")
      : view === "group-edit"
        ? t("profileGroups.manager.editTitle")
        : t("profileGroups.manager.title");

  return (
    <Modal
      title={viewTitle}
      open={open}
      onCancel={handleCancel}
      footer={null}
      width={820}
      mask={{ closable: false }}
      keyboard={!groupApi.busy}
      closable={!groupApi.busy}
      destroyOnHidden
    >
      {/* 视图切换从底部按钮挪到顶部页签：底部那一排按钮（含「关闭」）看起来像页脚动作，
          实际是导航；页签把「方案 / 板块与字段」的层级关系说清楚，关闭交给右上角 ×。
          「编辑方案」与「字段设置」是下钻层，带自己的返回入口，不出页签。 */}
      {view === "groups" || view === "sections" ? (
        <Tabs
          className="profile-settings-tabs"
          activeKey={view}
          onChange={(key) => setView(key === "sections" ? "sections" : "groups")}
          items={[
            { key: "groups", label: t("profileGroups.manager.groupsTab") },
            { key: "sections", label: t("profileGroups.manager.sectionsTab") },
          ]}
        />
      ) : null}
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
    </Modal>
  );
}
