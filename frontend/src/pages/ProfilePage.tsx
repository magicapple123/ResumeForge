/** 我的资料：基础信息 + 各分区动态列表，整体保存。 */
import { App, ConfigProvider, Form, Input, Skeleton } from "antd";
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
import WebFormProfileSection from "../components/profile/WebFormProfileSection";
import { updateWebFormExtraProfile } from "../api/webform";
import { setProfileSaveControl } from "../features/tou-tou/profileSaveBridge";
import { useProfilePage } from "../features/profile/useProfilePage";
import type { WebFormExtraEntry, WebFormExtraProfile, WebFormRepeatedGroup } from "../types";

export default function ProfilePage() {
  const { message } = App.useApp();
  // 通用简历：名称在两个入口之间共享，用户填一次即可。
  const [generalTitle, setGeneralTitle] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [writeOpen, setWriteOpen] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<ProfileWorkspaceKey>("resume");
  // 「网申资料」：值由本页持有，这样它能和资料表单**一起**提交。
  // 目录也存下来：提交时按它收窄字段，不把界面上的临时键发出去。
  const [extraProfile, setExtraProfile] = useState<WebFormExtraProfile | null>(null);
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  // 每条的来源与档位（手录的/学到的、下次还填不填）。与 extraValues 一起提交，
  // 这样用户在界面上改档位之后，下次预填就按新的来。
  const [extraDetails, setExtraDetails] = useState<Record<string, WebFormExtraEntry>>({});
  const [extraRepeatedGroups, setExtraRepeatedGroups] = useState<WebFormRepeatedGroup[]>([]);
  const [extraSaving, setExtraSaving] = useState(false);
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

  // setExtraValues 与 setDirty(true) 是两次 setState：React 18 自动批处理把它们合成
  // **一次**渲染，且 dirty 已为 true 时 setDirty 直接跳过——所以击键路径上没有多余的
  // 重复渲染；这里再给 onChange 一个稳定引用，让网申资料子树能凭 memo 跳过无关重渲。
  const handleExtraChange = useCallback(
    (key: string, value: string) => {
      setExtraValues((current) => ({ ...current, [key]: value }));
      markDirty();
    },
    [markDirty],
  );

  /** 自定义字段改名只改显示标签，保持 key 不变，避免已记住的值失去关联。 */
  const handleExtraFieldLabelChange = useCallback(
    (key: string, label: string) => {
      setExtraDetails((current) => ({
        ...current,
        [key]: {
          value: current[key]?.value ?? "",
          source: current[key]?.source ?? "manual",
          reuse: current[key]?.reuse ?? "general",
          label,
        },
      }));
      setExtraProfile((current) => {
        if (!current) return current;
        return {
          ...current,
          fields: current.fields.map((field) => (field.key === key ? { ...field, label } : field)),
        };
      });
      markDirty();
    },
    [markDirty],
  );

  /** 删除交给「保存全部资料」统一提交；父组件同步移除，提交白名单不会把它带回去。 */
  const handleExtraFieldDelete = useCallback(
    (key: string) => {
      setExtraValues((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setExtraDetails((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setExtraProfile((current) => {
        if (!current) return current;
        const fields = current.fields.filter((field) => field.key !== key);
        const groups = current.groups.filter(
          (group) => group !== "自定义" || fields.some((field) => field.group === group),
        );
        return { ...current, fields, groups };
      });
      markDirty();
    },
    [markDirty],
  );

  const handleExtraLoaded = useCallback((profile: WebFormExtraProfile) => {
    setExtraProfile(profile);
    // 后端只回有值的项；这里补全成"每个字段都有一个键"，输入框才不会从非受控变受控。
    setExtraValues(profile.values);
    setExtraDetails(profile.details ?? {});
    setExtraRepeatedGroups(profile.repeated_groups ?? []);
  }, []);

  // 重复经历编辑同样走「改数组 + 置脏」两级 setState（批处理下一次渲染）；
  // 稳定引用让 memo 化的 WebFormProfileRecords 在打字时整棵跳过。
  const handleRepeatedGroupsChange = useCallback(
    (groups: WebFormRepeatedGroup[]) => {
      setExtraRepeatedGroups(groups);
      markDirty();
    },
    [markDirty],
  );

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
    if (!extraProfile) {
      // 只有资料表单要存：存上了才解除未保存警示。
      if (profileSaved) setDirty(false);
      return;
    }
    setExtraSaving(true);
    try {
      // 按目录收窄：只提交目录里认得的字段（界面上不该有别的键，但别赌）。
      const allowed = new Set(extraProfile.fields.map((field) => field.key));
      const payload: Record<string, string> = {};
      for (const [key, value] of Object.entries(extraValues)) {
        if (allowed.has(key)) payload[key] = value;
      }
      const repeated = Object.fromEntries(
        extraRepeatedGroups.map((group) => [
          group.key,
          group.records.map((record) => ({ id: record.id, values: record.values })),
        ]),
      );
      const saved = await updateWebFormExtraProfile(payload, extraDetails, repeated);
      setExtraProfile(saved);
      setExtraValues(saved.values);
      setExtraDetails(saved.details ?? {});
      setExtraRepeatedGroups(saved.repeated_groups ?? []);
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
    cancelEditingRef.current();
    setDirty(false);
  }, []);

  // submitAll 依赖 extraValues 等每次击键都会变的状态；桥的 onSave 经 ref 转发到
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

  // 简历资料子树与网申资料的输入无关：用 useMemo 钉住元素引用（依赖里没有
  // extraValues/extraDetails），网申资料打字时 React 直接跳过这棵最重的子树。
  // 注意 ProfileWorkspaceTabs 两 tab 常驻挂载（destroyOnHidden=false），这里的
  // 引用稳定化正是消除「另一 tab 无辜重渲」的那一环。
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

  // 网申资料子树的值就来自本页 state：打字时它本来就要重渲（输入值在这里），
  // 这里 useMemo 的意义是把「其余原因引起的整页重渲」挡在这一子树之外。
  const webFormContent = useMemo(
    () => (
      <WebFormProfileSection
        editing={editing}
        saving={saving || extraSaving}
        values={extraValues}
        details={extraDetails}
        onChange={handleExtraChange}
        onFieldLabelChange={handleExtraFieldLabelChange}
        onFieldDelete={handleExtraFieldDelete}
        repeatedGroups={extraRepeatedGroups}
        onRepeatedGroupsChange={handleRepeatedGroupsChange}
        onLoaded={handleExtraLoaded}
      />
    ),
    [
      editing,
      extraDetails,
      extraRepeatedGroups,
      extraSaving,
      extraValues,
      handleExtraChange,
      handleExtraFieldDelete,
      handleExtraFieldLabelChange,
      handleExtraLoaded,
      handleRepeatedGroupsChange,
      saving,
    ],
  );

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;

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
      {/* 未保存防护：onValuesChange 只对用户输入生效；照片走 setFieldValue，
          所以在 onPhotoSelect 里单独置脏。 */}
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
