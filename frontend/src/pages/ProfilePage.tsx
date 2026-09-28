/** 我的资料：基础信息 + 各分区动态列表，整体保存。 */
import {
  CloseOutlined,
  DownOutlined,
  EditOutlined,
  FileSearchOutlined,
  HolderOutlined,
  SaveOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { App, Button, Form, Input, Skeleton, Typography } from "antd";
import { useCallback, useState } from "react";
import GenerateResumeModal from "../components/GenerateResumeModal";
import ManualResumeModal from "../components/ManualResumeModal";
import GeneralResumeSection from "../components/profile/GeneralResumeSection";
import { DEFAULT_SECTION_ORDER } from "../components/profile/ProfileSectionConfig";
import type { ProfileSectionKey } from "../components/profile/ProfileSectionConfig";
import ProfileSectionStack from "../components/profile/ProfileSectionStack";
import ProfileTextModal from "../components/profile/ProfileTextModal";
import WebFormProfileSection from "../components/profile/WebFormProfileSection";
import { updateWebFormExtraProfile } from "../api/webform";
import { useProfilePage } from "../features/profile/useProfilePage";
import type { WebFormExtraEntry, WebFormExtraProfile } from "../types";

export default function ProfilePage() {
  const { message } = App.useApp();
  // 通用简历：名称在两个入口之间共享，用户填一次即可。
  const [generalTitle, setGeneralTitle] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [writeOpen, setWriteOpen] = useState(false);
  // 「网申资料」：值由本页持有，这样它能和资料表单**一起**提交。
  // 目录也存下来：提交时按它收窄字段，不把界面上的临时键发出去。
  const [extraProfile, setExtraProfile] = useState<WebFormExtraProfile | null>(null);
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  // 每条的来源与档位（手录的/学到的、下次还填不填）。与 extraValues 一起提交，
  // 这样用户在界面上改档位之后，下次预填就按新的来。
  const [extraDetails, setExtraDetails] = useState<Record<string, WebFormExtraEntry>>({});
  const [extraSaving, setExtraSaving] = useState(false);
  // 查看态默认**全展开**：这一页是"我的资料"，用户进来就是要看/改内容的，
  // 一屏折叠标题栏既看不到内容、又要多点好几下（用户反馈"应该默认展开"）。
  // 想收起来的话，页头「全部收起」一键搞定。折叠只在非编辑态生效
  // （ProfileSectionStack 里按 `!editing` 取用）。
  const [collapsedSections, setCollapsedSections] = useState<Set<ProfileSectionKey>>(
    () => new Set(),
  );
  const allExpanded = collapsedSections.size === 0;

  const toggleSection = (sectionKey: ProfileSectionKey) => {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  };

  const toggleExpandAll = () => {
    setCollapsedSections(allExpanded ? new Set(DEFAULT_SECTION_ORDER) : new Set());
  };
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

  const handleExtraChange = useCallback((key: string, value: string) => {
    setExtraValues((current) => ({ ...current, [key]: value }));
  }, []);

  /** 改某一条的档位（通用/场景/本次）。来源不改——它记的是"当初怎么来的"，是历史。 */
  const handleExtraReuseChange = useCallback((key: string, reuse: WebFormExtraEntry["reuse"]) => {
    setExtraDetails((current) => ({
      ...current,
      [key]: { value: current[key]?.value ?? "", source: current[key]?.source ?? "manual", reuse },
    }));
  }, []);

  /** 自定义字段改名只改显示标签，保持 key 不变，避免已记住的值失去关联。 */
  const handleExtraFieldLabelChange = useCallback((key: string, label: string) => {
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
  }, []);

  /** 删除交给「保存全部资料」统一提交；父组件同步移除，提交白名单不会把它带回去。 */
  const handleExtraFieldDelete = useCallback((key: string) => {
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
  }, []);

  const handleExtraLoaded = useCallback((profile: WebFormExtraProfile) => {
    setExtraProfile(profile);
    // 后端只回有值的项；这里补全成"每个字段都有一个键"，输入框才不会从非受控变受控。
    setExtraValues(profile.values);
    setExtraDetails(profile.details ?? {});
  }, []);

  /**
   * 「保存全部资料」= 资料表单 + 网申资料，**两次都成功才算成功**。
   *
   * 网申资料走自己的接口（它存在独立的表里，见 `WebFormProfileSection` 的说明），
   * 所以这里必然是两个请求。不允许的形态是"第二次失败却提示成功"——那会让用户以为
   * 存上了，而实际上丢的是他刚补的那一屏。
   */
  const submitAll = async () => {
    await submit();
    if (!extraProfile) return;
    setExtraSaving(true);
    try {
      // 按目录收窄：只提交目录里认得的字段（界面上不该有别的键，但别赌）。
      const allowed = new Set(extraProfile.fields.map((field) => field.key));
      const payload: Record<string, string> = {};
      for (const [key, value] of Object.entries(extraValues)) {
        if (allowed.has(key)) payload[key] = value;
      }
      const saved = await updateWebFormExtraProfile(payload, extraDetails);
      setExtraProfile(saved);
      setExtraValues(saved.values);
      setExtraDetails(saved.details ?? {});
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

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;

  return (
    <div className={`profile-page${editing ? " is-editing" : ""}`}>
      <div className="profile-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            我的资料
          </Typography.Title>
          <Typography.Text type="secondary">维护生成简历时使用的个人信息与经历</Typography.Text>
        </div>
        <div className="profile-page-header-actions">
          {editing ? (
            <>
              <Button
                icon={<HolderOutlined />}
                disabled={saving || photoReading || profileTextParsing}
                onClick={toggleSectionReorderMode}
              >
                {sectionReorderMode ? "完成模块排序" : "调整模块顺序"}
              </Button>
              <Button
                icon={<FileSearchOutlined />}
                disabled={saving || photoReading || profileTextParsing}
                onClick={openProfileTextModal}
              >
                粘贴文本识别
              </Button>
              <Button
                icon={<CloseOutlined />}
                disabled={saving || photoReading}
                onClick={cancelEditing}
              >
                取消
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={saving || extraSaving}
                disabled={photoReading}
                onClick={() => void submitAll()}
              >
                保存全部资料
              </Button>
            </>
          ) : (
            <>
              {/* 资料分区默认折叠，这里给一个一键开关；标签随当前状态翻转。 */}
              <Button
                icon={allExpanded ? <UpOutlined /> : <DownOutlined />}
                onClick={toggleExpandAll}
              >
                {allExpanded ? "全部收起" : "全部展开"}
              </Button>
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                编辑资料
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 通用简历放在资料分区之前：它不属于资料表单，以前沉在页面最底下，资料一多就得滚到底才看得到。 */}
      <GeneralResumeSection
        onGenerate={(title) => {
          setGeneralTitle(title);
          setGenerateOpen(true);
        }}
        onWrite={(title) => {
          setGeneralTitle(title);
          setWriteOpen(true);
        }}
      />

      <Form form={form} layout="vertical" disabled={!editing || saving || photoReading}>
        <Form.Item name="photo" hidden>
          <Input />
        </Form.Item>

        <ProfileSectionStack
          sectionOrder={sectionOrder}
          sectionReorderMode={sectionReorderMode}
          editing={editing}
          saving={saving}
          photo={photo}
          dragOverSection={dragOverSection}
          collapsedSections={collapsedSections}
          onToggleCollapsed={toggleSection}
          onPhotoSelect={(dataUrl) => form.setFieldValue("photo", dataUrl)}
          onHandlePointerDown={handleSectionPointerDown}
          onMoveByOffset={moveSectionByOffset}
        />
      </Form>

      {/* 「网申资料」在资料表单**之外**：它存在独立的表里、走自己的接口，也不参与分区排序
          （后端会按 PROFILE_SECTION_KEYS 丢掉不认识的 section_order 键）。 */}
      <WebFormProfileSection
        editing={editing}
        saving={saving || extraSaving}
        values={extraValues}
        details={extraDetails}
        onChange={handleExtraChange}
        onReuseChange={handleExtraReuseChange}
        onFieldLabelChange={handleExtraFieldLabelChange}
        onFieldDelete={handleExtraFieldDelete}
        onLoaded={handleExtraLoaded}
      />

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
