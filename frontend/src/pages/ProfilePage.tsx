/** 我的资料：13 个大字段（定义驱动）+ 当前组 + 网申资料分页，整体保存。 */
import { Alert, App, Button, Form, Space } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PointerEvent as ReactPointerEvent } from "react";
import ErrorState from "../components/common/ErrorState";
import PageSkeleton from "../components/common/PageSkeleton";
import ProfilePageHeader from "../components/profile/ProfilePageHeader";
import ProfilePageModals from "../components/profile/ProfilePageModals";
import ProfileSectionStack from "../components/profile/ProfileSectionStack";
import ProfileWorkspaceTabs, {
  type ProfileWorkspaceKey,
} from "../components/profile/ProfileWorkspaceTabs";
import ProfileGroupControl from "../features/profile-groups/ProfileGroupControl";
import ProfileGroupManagerModal from "../features/profile-groups/ProfileGroupManagerModal";
import { useCurrentProfileGroup } from "../features/profile-groups/useCurrentProfileGroup";
import ProfilePlacementGuide from "../features/profile-library/ProfilePlacementGuide";
import ProfileUpgradeNotice from "../features/profile-library/ProfileUpgradeNotice";
import { useProfileLeaveGuard } from "../features/profile/useProfileLeaveGuard";
import { useProfilePage } from "../features/profile/useProfilePage";
import { useProfileWebFormBridge } from "../features/profile/useProfileWebFormBridge";
import { useToast } from "../hooks/useToast";
import { useFormShortcutHistory } from "../features/shortcuts/useFormShortcutHistory";
import {
  setProfileEditControl,
  setProfileSaveControl,
} from "../features/tou-tou/profileSaveBridge";
import { t } from "../i18n";

export default function ProfilePage() {
  const { message } = App.useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [activeWorkspace, setActiveWorkspace] = useState<ProfileWorkspaceKey>("resume");
  const [dirty, setDirty] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);
  const activateResumeWorkspace = useCallback(() => setActiveWorkspace("resume"), []);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  const [guideOpen, setGuideOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerView, setManagerView] = useState<"groups" | "sections">("groups");
  // 点某一卡的齿轮时要直达那个大字段的「字段设置」：key 只在弹层挂载时被消费，
  // 所以它不进 resumeContent 的依赖数组（改它不重建分区子树，只影响弹层初始视图）。
  const [managerSectionKey, setManagerSectionKey] = useState("");
  const [promptDismissed, setPromptDismissed] = useState(false);

  const profile = useProfilePage({
    activateResumeWorkspace,
    onProfileParsed: markDirty,
    onDirty: markDirty,
  });
  const workspace = profile.workspace;
  const webform = useProfileWebFormBridge({
    editing: profile.editing,
    saving: profile.saving,
    onDirty: markDirty,
  });
  const groupApi = useCurrentProfileGroup(
    workspace,
    useCallback(async () => {
      await profile.reloadWorkspace();
    }, [profile.reloadWorkspace]),
  );
  // 资料页「已隐藏的大字段」里的「显示」：写当前组参与清单，成功后 hook 内部已重取
  // workspace，这里不再进编辑态（Lead 裁决 3：查看态也能恢复）。
  const groupSetSectionVisible = groupApi.setSectionVisible;
  const handleSetSectionVisible = useCallback(
    (sectionKey: string, visible: boolean) => {
      void groupSetSectionVisible(sectionKey, visible);
    },
    [groupSetSectionVisible],
  );

  const sectionNames = useMemo(() => {
    const names: Record<string, string> = {};
    workspace?.sections.forEach((section) => {
      names[section.key] = section.name;
    });
    return names;
  }, [workspace]);
  const participatingKeys = workspace?.current_group?.participating_keys ?? [];
  // 离开守卫（R-26）：路由离页 / 取消编辑 / 程序触发切组共用同一个出口；
  // dirty 时先出内联确认条，确认放弃才执行动作，继续编辑则原样留下（当前组与草稿不动）。
  const leaveGuard = useProfileLeaveGuard({ dirty });

  const allExpanded = collapsedSections.size === 0;
  const toggleSection = useCallback((sectionKey: string) => {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  }, []);
  const toggleExpandAll = useCallback(() => {
    const keys = workspace?.sections.map((section) => section.key) ?? [];
    setCollapsedSections(allExpanded ? new Set(keys) : new Set());
  }, [allExpanded, workspace]);

  const submitAllRef = useRef<() => Promise<void>>(async () => undefined);
  const formHistory = useFormShortcutHistory(profile.form, {
    onSave: () => void submitAllRef.current(),
    onChange: markDirty,
    historyEnabled: profile.editing,
    resetKey: profile.loading,
  });

  const submitAll = useCallback(async () => {
    if (profile.loading || profile.loadError) return;
    const outcome = await profile.submit();
    if (outcome === "invalid") {
      message.warning(t("profileLibrary.save.invalid"));
      return;
    }
    if (outcome === "conflict") {
      toast.error(profile.saveError ?? t("profileLibrary.save.conflict"), {
        action: {
          label: t("profileLibrary.action.refreshCompare"),
          onClick: () => {
            profile.resetSaveError();
            void profile.reloadWorkspace();
          },
        },
      });
      return;
    }
    if (outcome !== "saved") {
      if (profile.saveError) message.error(profile.saveError);
      return;
    }
    const webOutcome = await webform.submit();
    if (webOutcome === "failed") return;
    setDirty(false);
    formHistory.reset();
  }, [formHistory, message, profile, toast, webform]);

  useEffect(() => {
    submitAllRef.current = submitAll;
  }, [submitAll]);

  // 依赖只列真正用到的稳定切片：写成 [profile] 会让本回调每次页面重渲都换引用，
  // 进而把 resumeContent（依赖它作为 onRequestEdit）的 memo 打穿。
  const profileSetEditing = profile.setEditing;
  const profileCancelEditing = profile.cancelEditing;
  const webformCancel = webform.cancel;
  const handleStartEditing = useCallback(() => {
    if (!profile.loading && !profile.loadError) profileSetEditing(true);
  }, [profile.loadError, profile.loading, profileSetEditing]);

  /** 真正执行"取消编辑"（确认放弃后才走到这里）。 */
  const performCancelEditing = useCallback(() => {
    webformCancel();
    profileCancelEditing();
    setDirty(false);
  }, [profileCancelEditing, webformCancel]);

  /** 取消编辑入口：先过离开守卫（有未保存改动时出内联确认条）。 */
  const handleCancelEditing = useCallback(() => {
    leaveGuard.requestLeave("cancel", performCancelEditing);
  }, [leaveGuard, performCancelEditing]);

  // 这两个包装是 resumeContent memo 的依赖：依赖收敛到 useProfilePage 里稳定的 action，
  // 不能写成 [profile]——profile 每次页面重渲都是新对象，会把整棵简历分区子树一起重建。
  const profileHandlePointerDown = profile.handleSectionPointerDown;
  const profileMoveSectionByOffset = profile.moveSectionByOffset;
  const handleSectionPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, sectionKey: string) => {
      profileHandlePointerDown(event, sectionKey);
    },
    [profileHandlePointerDown],
  );
  const handleMoveByOffset = useCallback(
    (sectionKey: string, offset: -1 | 1) => {
      profileMoveSectionByOffset(sectionKey, offset);
    },
    [profileMoveSectionByOffset],
  );

  // 悬浮球「保存资料/取消」桥：dirty 时挂上与本页保存条等价的动作入口。
  useEffect(() => {
    if (!dirty) {
      setProfileSaveControl(null);
      return undefined;
    }
    setProfileSaveControl({
      onSave: () => void submitAllRef.current(),
      onCancel: handleCancelEditing,
      saving: profile.saving || webform.extraSaving,
    });
    return () => setProfileSaveControl(null);
  }, [dirty, handleCancelEditing, profile.saving, webform.extraSaving]);

  // 悬浮球「去改资料」提示卡：停在本页、非编辑、本次没关过时出现。
  useEffect(() => {
    if (profile.loading || profile.loadError || profile.editing || promptDismissed) {
      setProfileEditControl(null);
      return undefined;
    }
    setProfileEditControl({
      onEdit: () => {
        setPromptDismissed(true);
        handleStartEditing();
      },
      onDismiss: () => setPromptDismissed(true),
    });
    return () => setProfileEditControl(null);
  }, [handleStartEditing, profile.editing, profile.loadError, profile.loading, promptDismissed]);

  const resumeContent = useMemo(
    () =>
      workspace ? (
        <ProfileSectionStack
          sections={workspace.sections}
          participatingKeys={participatingKeys}
          reorderStore={profile.sectionOrderStore}
          editing={profile.editing}
          saving={profile.saving}
          photo={profile.photo}
          limits={workspace.limits}
          collapsedSections={collapsedSections}
          onToggleCollapsed={toggleSection}
          onPhotoSelect={profile.setPhoto}
          onHandlePointerDown={handleSectionPointerDown}
          onMoveByOffset={handleMoveByOffset}
          onAddEntry={profile.addEntry}
          onRemoveEntry={(sectionKey, entryKey, title) =>
            void profile.removeEntry(sectionKey, entryKey, title)
          }
          onSetPreference={(field, patch) => void profile.setPreference(field, patch)}
          onOpenFieldSettings={(sectionKey) => {
            setManagerSectionKey(sectionKey);
            setManagerView("sections");
            setManagerOpen(true);
          }}
          onOpenGuide={() => setGuideOpen(true)}
          onRequestEdit={handleStartEditing}
          onOpenGroupManager={() => {
            setManagerView("groups");
            setManagerOpen(true);
          }}
          onSetSectionVisible={handleSetSectionVisible}
          sectionVisibilityBusy={groupApi.busy}
        />
      ) : null,
    [
      collapsedSections,
      groupApi.busy,
      handleMoveByOffset,
      handleSectionPointerDown,
      handleSetSectionVisible,
      handleStartEditing,
      participatingKeys,
      // 只列真正参与渲染的切片（actions/字段），不整包依赖 profile 对象：
      // 否则每次页面重渲（哪怕只是 dirty 翻转）都会重建整个分区子树。
      profile.addEntry,
      profile.editing,
      profile.photo,
      profile.removeEntry,
      profile.saving,
      profile.sectionOrderStore,
      profile.setPhoto,
      profile.setPreference,
      toggleSection,
      workspace,
    ],
  );

  const workspaceTabs = useMemo(
    () => (
      <Form
        form={profile.form}
        layout="vertical"
        disabled={!profile.editing || profile.saving || profile.photoReading}
        onValuesChange={formHistory.handleValuesChange}
      >
        <ProfileWorkspaceTabs
          resumeContent={resumeContent}
          webFormContent={webform.content}
          activeKey={activeWorkspace}
          onActiveKeyChange={setActiveWorkspace}
        />
      </Form>
    ),
    [
      activeWorkspace,
      formHistory.handleValuesChange,
      profile.editing,
      profile.form,
      profile.photoReading,
      profile.saving,
      resumeContent,
      webform.content,
    ],
  );

  if (profile.loading) return <PageSkeleton rows={10} />;
  if (profile.loadError) {
    return (
      <ErrorState
        description={t("profileLibrary.load.error", { detail: profile.loadError })}
        onRetry={profile.retryLoad}
      />
    );
  }

  return (
    <div className={"profile-page" + (profile.editing ? " is-editing" : "")}>
      {leaveGuard.confirmOpen ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title={t("profileGroups.leave.title")}
          description={t(
            leaveGuard.pendingKind === "switch-group"
              ? "profileGroups.leave.body.switchGroup"
              : leaveGuard.pendingKind === "navigate"
                ? "profileGroups.leave.body.navigate"
                : "profileGroups.leave.body.cancel",
          )}
          action={
            <Space>
              <Button danger onClick={() => leaveGuard.confirmDiscard()}>
                {t("profileGroups.leave.discard")}
              </Button>
              <Button onClick={() => leaveGuard.cancelDiscard()}>
                {t("profileGroups.leave.keep")}
              </Button>
            </Space>
          }
        />
      ) : null}
      <ProfilePageHeader
        editing={profile.editing}
        activeWorkspace={activeWorkspace}
        saving={profile.saving}
        extraSaving={webform.extraSaving}
        photoReading={profile.photoReading}
        profileTextParsing={profile.recognition.parsing}
        allExpanded={allExpanded}
        groupControl={
          <ProfileGroupControl
            groups={groupApi.groups}
            currentGroupId={groupApi.current?.group_id ?? null}
            editing={profile.editing}
            busy={groupApi.busy}
            sectionNames={sectionNames}
            onSwitch={(groupId) =>
              leaveGuard.requestLeave("switch-group", () => {
                void groupApi.switchTo(groupId);
              })
            }
            onManage={() => {
              setManagerView("groups");
              setManagerOpen(true);
            }}
          />
        }
        onOpenProfileTextModal={profile.recognition.openModal}
        onOpenWebFormParse={webform.openWebFormParse}
        onCancelEditing={handleCancelEditing}
        onSubmitAll={submitAll}
        onToggleExpandAll={toggleExpandAll}
        onStartEditing={handleStartEditing}
        onOpenGuide={() => setGuideOpen(true)}
      />

      {workspace?.pending_notice ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title={workspace.pending_notice.message ?? t("profileGroups.notice.fallback")}
          action={
            <Button
              size="small"
              onClick={() => void groupApi.acknowledge(workspace.pending_notice?.notice_id ?? "")}
            >
              {t("profileGroups.notice.ack")}
            </Button>
          }
        />
      ) : null}
      {workspace ? (
        <ProfileUpgradeNotice
          hasLegacyData={workspace.upgrade.has_legacy_data}
          newProfileHasEntries={workspace.upgrade.new_profile_has_entries}
          onOpenBackup={() => navigate("/settings")}
          onStartFill={handleStartEditing}
        />
      ) : null}

      {workspaceTabs}

      <ProfilePageModals
        profileText={profile.recognition.modal}
        webformText={webform.webformTextModal}
      />

      {managerOpen ? (
        <ProfileGroupManagerModal
          open
          onClose={() => {
            setManagerOpen(false);
            setManagerSectionKey("");
          }}
          workspace={workspace}
          onChanged={profile.reloadWorkspace}
          initialView={managerView}
          initialSectionKey={managerSectionKey}
          editing={profile.editing}
        />
      ) : null}
      <ProfilePlacementGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
