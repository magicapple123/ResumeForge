/** 我的资料：基础信息 + 各分区动态列表，整体保存。 */
import { App, ConfigProvider, Form, Input } from "antd";
import PageSkeleton from "../components/common/PageSkeleton";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import GenerateResumeModal from "../components/GenerateResumeModal";
import ManualResumeModal from "../components/ManualResumeModal";
import GeneralResumeSection from "../components/profile/GeneralResumeSection";
import { DEFAULT_SECTION_ORDER } from "../components/profile/ProfileSectionConfig";
import type { ProfileSectionKey } from "../components/profile/ProfileSectionConfig";
import ProfilePageHeader from "../components/profile/ProfilePageHeader";
import ProfileSectionStack from "../components/profile/ProfileSectionStack";
import ProfileTextModal from "../components/profile/ProfileTextModal";
import ProfileWorkspaceTabs, {
  type ProfileWorkspaceKey,
} from "../components/profile/ProfileWorkspaceTabs";
import WebFormProfileWorkspace, {
  type WebFormProfileWorkspaceHandle,
} from "../components/profile/WebFormProfileWorkspace";
import { updateWebFormExtraProfile } from "../api/webform";
import {
  setProfileEditControl,
  setProfileSaveControl,
} from "../features/tou-tou/profileSaveBridge";
import { useProfilePage } from "../features/profile/useProfilePage";
import type { WebFormExtraProfile } from "../types";

export default function ProfilePage() {
  const { message } = App.useApp();
  // 通用简历：名称在两个入口之间共享，用户填一次即可。
  const [generalTitle, setGeneralTitle] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [writeOpen, setWriteOpen] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<ProfileWorkspaceKey>("resume");
  // 「网申资料」：**草稿**由 `WebFormProfileWorkspace` 自己持有（击键只重渲那一棵子树），
  // 本页只留**目录**——提交时按它收窄字段，不把界面上的临时键发出去。
  //
  // 目录是 `WebFormProfileSection` 内部目录的**镜像**（加载、增删改自定义字段都同步过来），
  // 所以取消编辑**不回滚**它：那会让镜像和界面对不上——界面上新增的自定义字段还在（Section
  // 自己的 state 不跟着回滚），白名单里却没有它，用户再填一次就会静默丢掉。草稿的回滚由
  // workspace 的基线负责。
  const [extraProfile, setExtraProfile] = useState<WebFormExtraProfile | null>(null);
  const [extraSaving, setExtraSaving] = useState(false);
  const workspaceRef = useRef<WebFormProfileWorkspaceHandle | null>(null);
  // 查看态默认**全展开**：这一页是"我的资料"，用户进来就是要看/改内容的，
  // 一屏折叠标题栏既看不到内容、又要多点好几下（用户反馈"应该默认展开"）。
  // 想收起来的话，页头「全部收起」一键搞定。折叠只在非编辑态生效
  // （ProfileSectionStack 里按 `!editing` 取用）。
  const [collapsedSections, setCollapsedSections] = useState<Set<ProfileSectionKey>>(
    () => new Set(),
  );
  const allExpanded = collapsedSections.size === 0;

  const toggleSection = useCallback((sectionKey: ProfileSectionKey) => {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  }, []);

  const toggleExpandAll = useCallback(() => {
    setCollapsedSections(allExpanded ? new Set(DEFAULT_SECTION_ORDER) : new Set());
  }, [allExpanded]);
  const {
    form,
    loading,
    saving,
    editing,
    setEditing,
    photoReading,
    sectionOrder,
    sectionReorderMode,
    dragOverSection,
    profileTextOpen,
    profileText,
    profileTextWarnings,
    profileTextParsing,
    profileTextRecognized,
    profileTextSource,
    files,
    filesReading,
    addFiles,
    removeFile,
    onPasteFiles,
    photo,
    submit,
    cancelEditing,
    handleSectionPointerDown,
    toggleSectionReorderMode,
    moveSectionByOffset,
    openProfileTextModal,
    handleProfileTextChange,
    closeProfileTextModal,
    parseProfile,
  } = useProfilePage();

  // 未保存防护：这一页是整页表单、只有「保存全部资料」一个提交口，中途刷新/关闭
  // 浏览器会**静默丢掉**全部未保存编辑。dirty 时挂 beforeunload，触发浏览器原生的
  // "未保存的更改将丢失"确认；SPA 内的路由跳转不拦（超出本次范围）。
  const [dirty, setDirty] = useState(false);
  // 悬浮球那张「去改资料」提示卡本次进入是否已被关掉。放在页面 state（而不是球、也不写本地存储）：
  // 它的生命周期就是"这一次待在这一页"，离开页面即随组件一起消失，回来自然重新提醒。
  const [promptDismissed, setPromptDismissed] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome/Edge 只认 returnValue，两者都给。
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // 下面三个回调只维护**目录**（字段清单与显示名）：草稿本身由 workspace 持有，它改完自己的
  // state 后再通知这里。三个都用稳定引用，`webFormContent` 的 memo 与 memo 化的子树才不会被
  // 「每次渲染都换新」的回调打穿。
  const handleCatalogLoaded = useCallback((profile: WebFormExtraProfile) => {
    setExtraProfile(profile);
  }, []);

  /** 自定义字段改名只改显示标签，保持 key 不变，避免已记住的值失去关联。 */
  const handleCatalogFieldLabelChange = useCallback((key: string, label: string) => {
    setExtraProfile((current) => {
      if (!current) return current;
      return {
        ...current,
        fields: current.fields.map((field) => (field.key === key ? { ...field, label } : field)),
      };
    });
  }, []);

  /** 删除交给「保存全部资料」统一提交；目录里同步移除，提交白名单不会把它带回去。 */
  const handleCatalogFieldDelete = useCallback((key: string) => {
    setExtraProfile((current) => {
      if (!current) return current;
      const fields = current.fields.filter((field) => field.key !== key);
      const groups = current.groups.filter(
        (group) => group !== "自定义" || fields.some((field) => field.group === group),
      );
      return { ...current, fields, groups };
    });
  }, []);

  const handlePhotoSelect = useCallback(
    (dataUrl: string) => {
      form.setFieldValue("photo", dataUrl);
      markDirty();
    },
    [form, markDirty],
  );

  const openGenerateModal = useCallback((title: string) => {
    setGeneralTitle(title);
    setGenerateOpen(true);
  }, []);

  const openWriteModal = useCallback((title: string) => {
    setGeneralTitle(title);
    setWriteOpen(true);
  }, []);

  const handleStartEditing = useCallback(() => setEditing(true), [setEditing]);

  /**
   * 「保存全部资料」= 资料表单 + 网申资料，**两次都成功才算成功**。
   *
   * 网申资料走自己的接口（它存在独立的表里，见 `WebFormProfileSection` 的说明），
   * 所以这里必然是两个请求。不允许的形态是"第二次失败却提示成功"——那会让用户以为
   * 存上了，而实际上丢的是他刚补的那一屏。
   */
  const submitAll = async () => {
    const profileSaved = await submit();
    const draft = workspaceRef.current?.getDraft() ?? null;
    if (!extraProfile || !draft) {
      // 网申资料还没加载（用户没打开过那个分页）：只有资料表单要存，存上了才解除未保存警示。
      if (profileSaved) setDirty(false);
      return;
    }
    setExtraSaving(true);
    try {
      // 按目录收窄：只提交目录里认得的字段（界面上不该有别的键，但别赌）。
      const allowed = new Set(extraProfile.fields.map((field) => field.key));
      const payload: Record<string, string> = {};
      for (const [key, value] of Object.entries(draft.values)) {
        if (allowed.has(key)) payload[key] = value;
      }
      const repeated = Object.fromEntries(
        draft.repeatedGroups.map((group) => [
          group.key,
          group.records.map((record) => ({ id: record.id, values: record.values })),
        ]),
      );
      const saved = await updateWebFormExtraProfile(payload, draft.details, repeated);
      setExtraProfile(saved);
      workspaceRef.current?.adoptSaved(saved);
      // **两次提交都成功**才算干净：资料表单没存上（profileSaved 为 false）或网申资料
      // 失败（走下面的 catch）都保持 dirty——"存了一半"时未保存更改仍在。
      if (profileSaved) setDirty(false);
    } catch (err) {
      // 资料表单已经存进去了，所以要如实说明"存了一半"，而不是笼统说保存失败。
      message.error(
        err instanceof Error
          ? `个人资料已保存，但「网申资料」没存上：${err.message}`
          : "「网申资料」没存上，请重试",
      );
    } finally {
      setExtraSaving(false);
    }
  };

  // useProfilePage / useProfileSectionReorder 返回的处理函数每次渲染都是新引用；
  // 简历资料子树要靠「元素引用不变」跳过与网申资料击键无关的重渲（见 resumeContent
  // 的 useMemo），所以经 ref 转发——子树拿到的是稳定回调，行为不变。
  const sectionReorderHandlersRef = useRef({ handleSectionPointerDown, moveSectionByOffset });
  useEffect(() => {
    sectionReorderHandlersRef.current = { handleSectionPointerDown, moveSectionByOffset };
  });
  const handleSectionPointerDownStable = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, sectionKey: ProfileSectionKey) => {
      sectionReorderHandlersRef.current.handleSectionPointerDown(event, sectionKey);
    },
    [],
  );
  const moveSectionByOffsetStable = useCallback((sectionKey: ProfileSectionKey, offset: -1 | 1) => {
    sectionReorderHandlersRef.current.moveSectionByOffset(sectionKey, offset);
  }, []);

  // 取消编辑：顶部保存条与悬浮球桥共用同一份逻辑（放弃未保存更改 → 解除警示）。
  const cancelEditingRef = useRef(cancelEditing);
  useEffect(() => {
    cancelEditingRef.current = cancelEditing;
  });
  const handleCancelEditing = useCallback(() => {
    // 草稿回滚交给 workspace：它自己抓了「进入编辑时」的基线（面板懒挂载，页面拿不到草稿）。
    workspaceRef.current?.cancel();
    cancelEditingRef.current();
    setDirty(false);
  }, []);

  // submitAll 依赖草稿（提交那一刻从 workspace 取）与目录；桥的 onSave 经 ref 转发到
  // 最新实现，悬浮球按下的永远是当前这版草稿的保存逻辑（含两次提交与失败提示）。
  const submitAllRef = useRef(submitAll);
  useEffect(() => {
    submitAllRef.current = submitAll;
  });
  const handleBridgeSave = useCallback(() => {
    void submitAllRef.current();
  }, []);

  // 悬浮球「保存资料/取消」桥（features/tou-tou/profileSaveBridge）：页面表单脏时挂上
  // 控制块，悬浮球旁出现与顶部保存条等价的动作入口；保存/取消让 dirty 翻回 false 即
  // 自动收起，卸载时也收起。effect 只依赖 dirty/saving——击键不会反复 setProfileSaveControl。
  useEffect(() => {
    if (!dirty) {
      setProfileSaveControl(null);
      return undefined;
    }
    setProfileSaveControl({
      onSave: handleBridgeSave,
      onCancel: handleCancelEditing,
      saving: saving || extraSaving,
    });
    return () => setProfileSaveControl(null);
  }, [dirty, saving, extraSaving, handleBridgeSave, handleCancelEditing]);

  // 悬浮球「去改资料」提示卡（同一个 bridge 的另一个槽）：用户停在这一页、没在编辑、
  // 本次进入也没关掉它时，就在球旁挂上「去编辑」入口。依赖里只有真会变的几个条件，
  // 打字与击键都不会把它重算。
  useEffect(() => {
    if (loading || editing || promptDismissed) {
      setProfileEditControl(null);
      return undefined;
    }
    setProfileEditControl({
      onEdit: () => {
        // 点过它就算这一轮提醒达成（用户已经知道入口在哪了）：否则进编辑再取消时，
        // 卡片会立刻弹回来催人。页头的「编辑资料」按钮始终都在。
        setPromptDismissed(true);
        handleStartEditing();
      },
      onDismiss: () => setPromptDismissed(true),
    });
    return () => setProfileEditControl(null);
  }, [editing, handleStartEditing, loading, promptDismissed]);

  // 简历资料子树与网申资料的输入无关：用 useMemo 钉住元素引用（依赖里没有任何草稿状态），
  // 网申资料打字时 React 直接跳过这棵最重的子树。注意 ProfileWorkspaceTabs 两 tab 常驻挂载
  // （destroyOnHidden=false），这里的引用稳定化正是消除「另一 tab 无辜重渲」的那一环。
  const resumeContent = useMemo(
    () => (
      <>
        <ConfigProvider componentDisabled={false}>
          <GeneralResumeSection onGenerate={openGenerateModal} onWrite={openWriteModal} />
        </ConfigProvider>
        <ProfileSectionStack
          sectionOrder={sectionOrder}
          sectionReorderMode={sectionReorderMode}
          editing={editing}
          saving={saving}
          photo={photo}
          dragOverSection={dragOverSection}
          collapsedSections={collapsedSections}
          onToggleCollapsed={toggleSection}
          onPhotoSelect={handlePhotoSelect}
          onHandlePointerDown={handleSectionPointerDownStable}
          onMoveByOffset={moveSectionByOffsetStable}
        />
      </>
    ),
    [
      collapsedSections,
      dragOverSection,
      editing,
      handlePhotoSelect,
      handleSectionPointerDownStable,
      moveSectionByOffsetStable,
      openGenerateModal,
      openWriteModal,
      photo,
      saving,
      sectionOrder,
      sectionReorderMode,
      toggleSection,
    ],
  );

  // 网申资料的**草稿**由 workspace 自持，所以这里的依赖里没有任何随击键变化的状态：打字时
  // 这个元素引用不变，配合 memo 化的 ProfileWorkspaceTabs，Tabs 与简历资料子树整块跳过。
  const webFormContent = useMemo(
    () => (
      <WebFormProfileWorkspace
        ref={workspaceRef}
        editing={editing}
        saving={saving || extraSaving}
        onDirty={markDirty}
        onCatalogLoaded={handleCatalogLoaded}
        onCatalogFieldLabelChange={handleCatalogFieldLabelChange}
        onCatalogFieldDelete={handleCatalogFieldDelete}
      />
    ),
    [
      editing,
      extraSaving,
      handleCatalogFieldDelete,
      handleCatalogFieldLabelChange,
      handleCatalogLoaded,
      markDirty,
      saving,
    ],
  );

  /**
   * 包住两个 tab 的 `Form` 一并钉住引用：antd 的 `Form` 每次重渲都会换新 context，被它包住的
   * 每个 `Form.Item` 都会跟着重渲——简历资料那 67 个（含 12 个日期三连选，每个重渲都要重建约
   * 140 项的年份选项）。页面因为别的原因重渲时（例如编辑态第一次击键把 `dirty` 由假翻真，
   * 实测这一次在开发构建下要 170ms）不该带上这棵最重的子树。
   *
   * 未保存防护：`onValuesChange` 只对用户输入生效；照片走 `setFieldValue`，所以在
   * `onPhotoSelect` 里单独置脏。
   */
  const workspaceTabs = useMemo(
    () => (
      <Form
        form={form}
        layout="vertical"
        disabled={!editing || saving || photoReading}
        onValuesChange={markDirty}
      >
        <Form.Item name="photo" hidden>
          <Input />
        </Form.Item>
        <ProfileWorkspaceTabs
          resumeContent={resumeContent}
          webFormContent={webFormContent}
          onActiveKeyChange={setActiveWorkspace}
        />
      </Form>
    ),
    [editing, form, markDirty, photoReading, resumeContent, saving, webFormContent],
  );

  if (loading) return <PageSkeleton rows={10} />;

  return (
    <div className={`profile-page${editing ? " is-editing" : ""}`}>
      <ProfilePageHeader
        editing={editing}
        activeWorkspace={activeWorkspace}
        saving={saving}
        extraSaving={extraSaving}
        photoReading={photoReading}
        profileTextParsing={profileTextParsing}
        sectionReorderMode={sectionReorderMode}
        allExpanded={allExpanded}
        onToggleSectionReorderMode={toggleSectionReorderMode}
        onOpenProfileTextModal={openProfileTextModal}
        // 取消编辑即放弃未保存更改（表单回滚到已存值），警示随之解除。
        onCancelEditing={handleCancelEditing}
        onSubmitAll={submitAll}
        onToggleExpandAll={toggleExpandAll}
        onStartEditing={handleStartEditing}
      />

      {/* 通用简历放在资料分区之前：它不属于资料表单，以前沉在页面最底下，资料一多就得滚到底才看得到。 */}
      {workspaceTabs}

      <GenerateResumeModal
        job={null}
        open={generateOpen}
        initialTitle={generalTitle}
        onClose={() => setGenerateOpen(false)}
      />
      <ManualResumeModal
        job={null}
        open={writeOpen}
        initialTitle={generalTitle}
        onClose={() => setWriteOpen(false)}
      />

      <ProfileTextModal
        open={profileTextOpen}
        text={profileText}
        warnings={profileTextWarnings}
        parsing={profileTextParsing}
        recognizedText={profileTextRecognized}
        recognitionSource={profileTextSource}
        files={files}
        filesReading={filesReading}
        onTextChange={handleProfileTextChange}
        onAddFiles={(incoming) => void addFiles(incoming)}
        onRemoveFile={removeFile}
        onPasteFiles={onPasteFiles}
        onClose={closeProfileTextModal}
        onParse={() => void parseProfile()}
      />
    </div>
  );
}
