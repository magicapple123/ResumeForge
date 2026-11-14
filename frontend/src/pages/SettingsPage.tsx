// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页外壳：左侧九组导航 + 右侧单组内容。
 *
 * 三件事：持有需要跨组共享的 hooks、算好各卡片的 props、根据当前分组渲染对应的面板。
 * "哪张卡放在哪一组"全部在 `features/settings/SettingsPanels.tsx`；"哪一组叫什么、
 * 属于哪一档、深链怎么解析"全部在 `settingsSections.ts`。
 *
 * 为什么不再用 antd `Tabs`：九组之后页签横排一行放不下，而设置项是"目录式"的浏览
 * 而不是"一层里切页"，左侧竖向导航能一次看到全部九个分组。`?tab=` 深链仍然可用，
 * 旧键 `assistant` 会映射到 `assistant-behavior`。
 */
import { Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { useSearchParams } from "react-router-dom";
import { useSettingsDatasets } from "../features/settings/useSettingsDatasets";
import { useSettingsSkills } from "../features/settings/useSettingsSkills";
import { useLLMSettings } from "../features/settings/useLLMSettings";
import { useLLMRecordTools } from "../features/settings/useLLMRecordTools";
import LLMConfigCard from "../features/settings/LLMConfigCard";
import DatasetsCard from "../features/settings/DatasetsCard";
import SkillsCard from "../features/settings/SkillsCard";
import SettingsNav from "../features/settings/SettingsNav";
import SettingsSearch from "../features/settings/SettingsSearch";
import { parseSettingsSection, settingsSection } from "../features/settings/settingsSections";
import type { SettingsSectionKey } from "../features/settings/settingsSections";
import { revealSettingsCard } from "../features/settings/settingsFocus";
import type { SettingsIndexEntry } from "../features/settings/settingsIndex";
import {
  AboutPanel,
  AppearancePanel,
  AssistantBehaviorPanel,
  BackupPanel,
  DataPanel,
  InteractionPanel,
  MemorySkillsPanel,
  ModelPanel,
  VoicePanel,
} from "../features/settings/SettingsPanels";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import SkillEditorModal from "../features/skills/SkillEditorModal";

/** 搜索选中后要定位的那张卡：`nonce` 让"同一张卡连点两次"也能再触发一次 effect。 */
interface PendingJump {
  title: string;
  nonce: number;
}

export default function SettingsPage() {
  const [searchParams] = useSearchParams();
  const initialSection = parseSettingsSection(searchParams.get("tab"));
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>(initialSection);
  // 去过的分组不卸载：切回来时输入到一半的表单、已取到的数据都还在（原来 antd Tabs 的行为）。
  const [visited, setVisited] = useState<SettingsSectionKey[]>([initialSection]);
  const [pendingJump, setPendingJump] = useState<PendingJump | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** 上一次已渲染的分组：用来区分"用户切了组"和"首次挂载"。 */
  const prevSectionRef = useRef<SettingsSectionKey | null>(null);

  // 本页用模块级 t() 取文案：必须订阅语言变化，否则切到英文后这一页仍是中文。
  useLocale();

  // 带锚点进来（例如批量操作未配置时从岗位广场跳来）要落到那张卡，而不是停在分组顶部。
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    let target: Element | null;
    try {
      target = document.querySelector(hash);
    } catch {
      return;
    }
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [activeSection]);

  const {
    records,
    setRecords,
    recordsLoading,
    activeRecordId,
    configSummary,
    recordApplyingId,
    recordDeletingId,
    applyRecord,
    removeRecord,
  } = useLLMSettings();

  // 记录卡动作（卡上测试连接 / 新增与编辑共用弹窗）拆在独立 hook：保持 useLLMSettings 精简。
  const {
    recordTestingId,
    recordTestResults,
    testRecord,
    recordForm,
    modalOpen: recordModalOpen,
    editingRecord,
    recordSaving: recordEditSaving,
    draftTesting,
    draftTestResult,
    openCreate,
    openRecordEdit,
    closeRecordModal,
    applyRecordPreset,
    testDraft,
    submitRecord,
    fetchDraftModels,
    checkingThinking,
    thinkingResult,
    effortOptions,
    showingCustomEffort,
    clearThinkingResult,
    handleEffortCustom,
    backToEffortPresets,
    probeThinking,
    checkThinking,
  } = useLLMRecordTools(setRecords);

  /** 编辑的是当前生效的那条记录时，保存后同步为当前配置，保持「使用中」匹配。 */
  const handleSaveRecord = async () => {
    const updated = await submitRecord();
    if (updated && activeRecordId !== null && updated.id === activeRecordId) {
      await applyRecord(updated);
    }
  };

  // 这里只读技能摘要：技能的新建 / 导入 / 启用停用 / 删除全在工作台（/skills）。
  const { skills, skillsLoading, loadSkillList } = useSettingsSkills();
  const [skillEditorOpen, setSkillEditorOpen] = useState(false);
  const [skillEditorId, setSkillEditorId] = useState<number | null>(null);

  const {
    datasets,
    datasetsLoading,
    datasetExporting,
    datasetImporting,
    includeGlobalLLM,
    setIncludeGlobalLLM,
    switchingDatasetId,
    renamingDatasetId,
    deletingDatasetId,
    renameTarget,
    renameValue,
    datasetCreating,
    createDatasetOpen,
    createDatasetName,
    runDatasetExport,
    runExportAllDatasets,
    importDatasetFile,
    switchDataset,
    confirmDatasetRename,
    removeDataset,
    createEmptyDataset,
    setRenameTarget,
    setRenameValue,
    setCreateDatasetOpen,
    setCreateDatasetName,
  } = useSettingsDatasets();

  // 三组卡片 props 在这里一次算好：Panels 里不再重复取数，也不会出现"同一份数据两个来源"。
  const llmCard: ComponentProps<typeof LLMConfigCard> = {
    records,
    recordsLoading,
    activeRecordId,
    configSummary,
    recordApplyingId,
    recordDeletingId,
    recordTestingId,
    recordTestResults,
    recordForm,
    recordModalOpen,
    editingRecord,
    recordSaving: recordEditSaving,
    draftTesting,
    draftTestResult,
    checkingThinking,
    thinkingResult,
    showingCustomEffort,
    effortOptions,
    onProbeThinking: () => probeThinking(),
    onLoadThinkingOptions: () => checkThinking(false),
    onBackToEffortPresets: backToEffortPresets,
    onEffortCustom: handleEffortCustom,
    onClearThinkingResult: clearThinkingResult,
    onOpenCreate: openCreate,
    onOpenRecordEdit: openRecordEdit,
    onSaveRecord: () => void handleSaveRecord(),
    onCloseRecordModal: closeRecordModal,
    onApplyRecord: (record) => void applyRecord(record),
    onRemoveRecord: (record) => void removeRecord(record),
    onTestRecord: (record) => void testRecord(record),
    onTestDraft: () => void testDraft(),
    onPresetChange: applyRecordPreset,
    onFetchDraftModels: fetchDraftModels,
  };

  const skillsCard: ComponentProps<typeof SkillsCard> = {
    skills,
    loading: skillsLoading,
    onOpen: (skill) => {
      setSkillEditorId(skill.id);
      setSkillEditorOpen(true);
    },
  };

  const datasetsCard: ComponentProps<typeof DatasetsCard> = {
    datasets,
    loading: datasetsLoading,
    exporting: datasetExporting,
    importing: datasetImporting,
    includeGlobalLLM,
    onIncludeGlobalLLMChange: setIncludeGlobalLLM,
    switchingId: switchingDatasetId,
    renamingId: renamingDatasetId,
    deletingId: deletingDatasetId,
    renameTarget,
    renameValue,
    creating: datasetCreating,
    createOpen: createDatasetOpen,
    createName: createDatasetName,
    onExport: (dataset, filename) => void runDatasetExport(dataset, filename),
    onExportAll: (filename) => void runExportAllDatasets(filename),
    onImport: (file, name) => void importDatasetFile(file, name),
    onActivate: (dataset) => void switchDataset(dataset),
    onOpenRename: (dataset) => {
      setRenameTarget(dataset);
      setRenameValue(dataset.name);
    },
    onRenameValueChange: setRenameValue,
    onConfirmRename: () => void confirmDatasetRename(),
    onCancelRename: () => {
      if (renamingDatasetId === null) setRenameTarget(null);
    },
    onDelete: (dataset) => void removeDataset(dataset),
    onOpenCreate: () => {
      setCreateDatasetName("");
      setCreateDatasetOpen(true);
    },
    onCreateNameChange: setCreateDatasetName,
    onConfirmCreate: () => void createEmptyDataset(),
    onCancelCreate: () => {
      if (!datasetCreating) setCreateDatasetOpen(false);
    },
  };

  const activeMeta = settingsSection(activeSection);

  /** 切分组：记进 visited，并把右侧内容滚回顶部（首次挂载不滚，避免进页面就跳一下）。 */
  const handleSectionChange = (next: SettingsSectionKey) => {
    setActiveSection(next);
    if (!visited.includes(next)) setVisited((prev) => [...prev, next]);
  };

  // 只有真的换了分组才把内容区滚回顶部：首次挂载不滚（否则页头会被顶出视口）。
  // 用"上一次分组"而不是 mounted 布尔量判断——StrictMode 下 effect 会跑两次，
  // 布尔量在第二次已经把挂载期当成切换期，页面一进就上滚一屏。
  useEffect(() => {
    if (prevSectionRef.current === null) {
      prevSectionRef.current = activeSection;
      return;
    }
    if (prevSectionRef.current === activeSection) return;
    prevSectionRef.current = activeSection;
    contentRef.current?.scrollIntoView?.({ block: "start", behavior: "auto" });
  }, [activeSection]);

  // 搜索命中：先切分组，等这一帧把目标卡渲染出来后再滚动 + 高亮。
  useEffect(() => {
    if (pendingJump === null) return;
    revealSettingsCard(pendingJump.title);
  }, [pendingJump]);

  const handleJump = (entry: SettingsIndexEntry) => {
    handleSectionChange(entry.section);
    setPendingJump({ title: t(entry.titleKey), nonce: Date.now() });
  };

  const provenanceTarget = configSummary
    ? t(configSummary.presetLabelKey) + " · " + configSummary.model
    : undefined;

  const panelFor = (key: SettingsSectionKey) => {
    switch (key) {
      case "model":
        return <ModelPanel llmCard={llmCard} provenanceTarget={provenanceTarget} />;
      case "assistant-behavior":
        return <AssistantBehaviorPanel />;
      case "memory-skills":
        return <MemorySkillsPanel skillsCard={skillsCard} />;
      case "voice":
        return <VoicePanel />;
      case "appearance":
        return <AppearancePanel />;
      case "interaction":
        return <InteractionPanel />;
      case "data":
        return <DataPanel datasetsCard={datasetsCard} />;
      case "backup":
        return <BackupPanel />;
      case "about":
        return <AboutPanel />;
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {t("settings.page.title")}
          </Typography.Title>
          <Typography.Text type="secondary">{t("settings.page.subtitle")}</Typography.Text>
        </div>
      </div>

      {/* 九组的分法与顺序见 settingsSections.ts：AI 与助手 → 界面与操作 → 数据与应用。 */}
      <div className="settings-shell">
        <div className="settings-sidebar">
          <SettingsSearch onJump={handleJump} />
          <SettingsNav active={activeSection} onChange={handleSectionChange} />
        </div>

        <div className="settings-body" ref={contentRef}>
          <div className="settings-section-intro">
            <Typography.Title level={4} style={{ margin: 0 }}>
              {t(activeMeta.titleKey)}
            </Typography.Title>
            <Typography.Text type="secondary">{t(activeMeta.introKey)}</Typography.Text>
          </div>
          {visited.map((key) => (
            <div key={key} className="settings-section" hidden={key !== activeSection}>
              {panelFor(key)}
            </div>
          ))}
        </div>
      </div>

      {/* 设置页里点技能名只读查看详情：技能的改动统一在工作台做，弹窗不给保存。 */}
      <SkillEditorModal
        open={skillEditorOpen}
        skillId={skillEditorId}
        readOnly
        onClose={() => setSkillEditorOpen(false)}
        onSaved={() => void loadSkillList()}
      />
    </div>
  );
}
