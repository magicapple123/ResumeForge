/** 我的资料：13 个大字段（定义驱动）+ 当前组 + 网申资料分页，整体保存。 */
import { Alert, App, Button, Form } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PointerEvent as ReactPointerEvent } from "react";
import ErrorState from "../components/common/ErrorState";
import PageSkeleton from "../components/common/PageSkeleton";
import ProfilePageHeader from "../components/profile/ProfilePageHeader";
import ProfileEditActionBar from "../components/profile/ProfileEditActionBar";
import ProfileLeaveConfirmModal from "../components/profile/ProfileLeaveConfirmModal";
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
import {
  buildProfileBaseline,
  ProfileBaselineContext,
} from "../features/profile/profileBaselineContext";
import { useProfileLeaveGuard } from "../features/profile/useProfileLeaveGuard";
import { useProfilePage } from "../features/profile/useProfilePage";
import { useProfileWebFormBridge } from "../features/profile/useProfileWebFormBridge";
import { useToast } from "../hooks/useToast";
import { useFormShortcutHistory } from "../features/shortcuts/useFormShortcutHistory";
import {
  setProfileEditControl,
  setProfileSaveControl,
} from "../features/tou-tou/profileSaveBridge";
import { profileSectionLabel } from "../features/profile-library/profileLabels";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

export default function ProfilePage() {
  const locale = useLocale();
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
  const profileSetEditing = profile.setEditing;
  const profileReloadWorkspace = profile.reloadWorkspace;
  const handleStartEditing = useCallback(() => {
    if (!profile.loading && !profile.loadError) profileSetEditing(true);
  }, [profile.loadError, profile.loading, profileSetEditing]);
  const webform = useProfileWebFormBridge({
    editing: profile.editing,
    saving: profile.saving,
    onDirty: markDirty,
    onRequestEdit: handleStartEditing,
  });
  const groupApi = useCurrentProfileGroup(
    workspace,
    useCallback(async () => {
      await profileReloadWorkspace();
    }, [profileReloadWorkspace]),
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
    // t() 是模块级函数，不会自己触发重算；语言变了要重取分区展示名。
    void locale;
    const names: Record<string, string> = {};
    workspace?.sections.forEach((section) => {
      // 展示名：内置分区按界面语言取，自建/改名的分区用后端下发的名字。
      names[section.key] = profileSectionLabel(section);
    });
    return names;
    // locale 进依赖：分区名是渲染期按语言取的，切语言后这张表要重算。
  }, [workspace, locale]);
  // 包一层 useMemo：`?? []` 每次渲染都是新数组，会让下面的分区子树 memo 失效。
  const participatingKeys = useMemo(
    () => workspace?.current_group?.participating_keys ?? [],
    [workspace],
  );
  // 离开守卫（R-26）：路由离页 / 取消编辑 / 程序触发切组共用同一个出口；
  // dirty 时先出居中确认卡片，确认放弃才执行动作，继续编辑则原样留下（当前组与草稿不动）。
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
  const profileCancelEditing = profile.cancelEditing;
  const webformCancel = webform.cancel;

  /** 真正执行"取消编辑"（确认放弃后才走到这里）。 */
  const performCancelEditing = useCallback(() => {
    webformCancel();
    profileCancelEditing();
    setDirty(false);
  }, [profileCancelEditing, webformCancel]);

  /** 取消编辑入口：先过离开守卫（有未保存改动时出居中确认卡片）。 */
  const handleCancelEditing = useCallback(() => {
    leaveGuard.requestLeave("cancel", performCancelEditing);
  }, [leaveGuard, performCancelEditing]);

  // 这两个包装是 resumeContent memo 的依赖：依赖收敛到 useProfilePage 里稳定的 action，
  // 不能写成 [profile]——profile 每次页面重渲都是新对象，会把整棵简历分区子树一起重建。
  const profileHandlePointerDown = profile.handleSectionPointerDown;
  const profileMoveSectionByOffset = profile.moveSectionByOffset;
  // 简历分区子树按这些稳定切片渲染（不整包依赖 profile 对象）。
  const profileSectionOrderStore = profile.sectionOrderStore;
  const profileEditing = profile.editing;
  const profileSaving = profile.saving;
  const profilePhoto = profile.photo;
  const profileSetPhoto = profile.setPhoto;
  const profileAddEntry = profile.addEntry;
  const profileRemoveEntry = profile.removeEntry;
  const profileSetPreference = profile.setPreference;
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
  // 未保存确认卡片弹出时**必须收起**：同一屏出现两个"未保存"提示、其中一个还压在
  // 遮罩之上，用户会以为有两个不同的决定要做（2026-10-27 用户截图反馈）。
  useEffect(() => {
    if (!dirty || leaveGuard.confirmOpen) {
      setProfileSaveControl(null);
      return undefined;
    }
    setProfileSaveControl({
      onSave: () => void submitAllRef.current(),
      onCancel: handleCancelEditing,
      saving: profile.saving || webform.extraSaving,
    });
    return () => setProfileSaveControl(null);
  }, [dirty, handleCancelEditing, leaveGuard.confirmOpen, profile.saving, webform.extraSaving]);

  // 悬浮球「去改资料」提示卡：停在本页、非编辑、本次没关过时出现。确认卡片弹出时
  // 同样收起——它是"顺手去改资料"的轻提示，不该在用户正做丢弃决策时插一脚。
  useEffect(() => {
    if (
      profile.loading ||
      profile.loadError ||
      profile.editing ||
      promptDismissed ||
      leaveGuard.confirmOpen
    ) {
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
  }, [
    handleStartEditing,
    leaveGuard.confirmOpen,
    profile.editing,
    profile.loadError,
    profile.loading,
    promptDismissed,
  ]);

  // 编辑态的"已修改"标记要拿已保存的值做基线：每次工作区变化（含保存成功后的重新加载）
  // 重建，否则刚保存完的字段还挂着"已修改"。
  const baselineLookup = useMemo(() => buildProfileBaseline(workspace), [workspace]);

  const resumeContent = useMemo(
    () =>
      workspace ? (
        <ProfileBaselineContext.Provider value={baselineLookup}>
          <ProfileSectionStack
            sections={workspace.sections}
            participatingKeys={participatingKeys}
            reorderStore={profileSectionOrderStore}
            editing={profileEditing}
            saving={profileSaving}
            photo={profilePhoto}
            limits={workspace.limits}
            collapsedSections={collapsedSections}
            onToggleCollapsed={toggleSection}
            onPhotoSelect={profileSetPhoto}
            onHandlePointerDown={handleSectionPointerDown}
            onMoveByOffset={handleMoveByOffset}
            onAddEntry={profileAddEntry}
            onRemoveEntry={(sectionKey, entryKey, title) =>
              void profileRemoveEntry(sectionKey, entryKey, title)
            }
            onSetPreference={(field, patch) => void profileSetPreference(field, patch)}
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
        </ProfileBaselineContext.Provider>
      ) : null,
    [
      baselineLookup,
      collapsedSections,
      groupApi.busy,
      handleMoveByOffset,
      handleSectionPointerDown,
      handleSetSectionVisible,
      handleStartEditing,
      participatingKeys,
      // 只列真正参与渲染的稳定切片（actions/字段），不整包依赖 profile 对象：
      // 否则每次页面重渲（哪怕只是 dirty 翻转）都会重建整个分区子树。
      profileAddEntry,
      profileEditing,
      profilePhoto,
      profileRemoveEntry,
      profileSaving,
      profileSectionOrderStore,
      profileSetPhoto,
      profileSetPreference,
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
        onOpenSettings={() => {
          setManagerSectionKey("");
          setManagerView("groups");
          setManagerOpen(true);
        }}
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

      {/* 编辑且有未保存改动时，操作条常驻内容区底部（需求 6）：页头的保存/取消只在页顶，
          资料页又长，改到下面几条就够不着了。动作**复用** submitAll / handleCancelEditing，
          所以校验、冲突提示、离开守卫都还是同一条路径。
          未保存确认卡片弹出时收起：同一屏不要再摆第二组"保存/取消"——这与上面三处
          `leaveGuard.confirmOpen` 让位是同一条理由。 */}
      {leaveGuard.confirmOpen ? null : (
        <ProfileEditActionBar
          editing={profile.editing}
          dirty={dirty}
          saving={profile.saving || webform.extraSaving}
          blocked={profile.photoReading}
          onSave={() => void submitAll()}
          onCancel={handleCancelEditing}
        />
      )}

      {/* 未保存修改的确认卡片：与三个 Modal 并列挂在页面上，打开时遮罩 + 居中，
          不再挤在页面最顶部（触发它的按钮可能在页头甚至页外，用户根本看不到）。 */}
      <ProfileLeaveConfirmModal
        open={leaveGuard.confirmOpen}
        kind={leaveGuard.pendingKind}
        onDiscard={leaveGuard.confirmDiscard}
        onKeep={leaveGuard.cancelDiscard}
      />

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
