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
import {
  revealSettingsAnchor,
  revealSettingsCard,
  scrollSettingsToTop,
} from "../features/settings/settingsFocus";
import type { SettingsIndexEntry } from "../features/settings/settingsIndex";
import {
  AboutPanel,
  AppearancePanel,
  AssistantBehaviorPanel,
  BackupPanel,
  ConnectionsPanel,
  DataPanel,
  InteractionPanel,
  MemorySkillsPanel,
  ModelPanel,
  NotificationsPanel,
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

/**
 * 深链锚点的重试预算：50 × 40ms ≈ 2s。
 *
 * 为什么要重试：#9 的落点是凭据**行**，而它要等一次 `/api/connections` 才渲染出来；
 * 一次性 `scrollIntoView` 会在数据到达前跑完，看起来就是"点了去配置、页面什么都没动"。
 * 为什么有上限：轮询不能变成页面的常驻行为——超时就退回分组顶部，如实接受"这个锚点不存在"。
 */
const HASH_ANCHOR_RETRIES = 50;
const HASH_ANCHOR_RETRY_MS = 40;

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
  /** 这一次切组是搜索命中引起的：预滚动让给 revealSettingsCard，避免连跳两段。 */
  const skipResetRef = useRef(false);

  // 本页用模块级 t() 取文案：必须订阅语言变化，否则切到英文后这一页仍是中文。
  useLocale();

  // 带锚点进来（矩阵里点「去配置」= `/settings?tab=assistant-behavior#conn-search-deepseek`）
  // 要落到**那一行**，而不是停在分组顶部。三件事决定了这里不能写成一次性 scrollIntoView：
  //
  // 1. 目标行是**异步渲染**的（凭据列表等一次 `/api/connections` 才出来），抢跑必然落空；
  // 2. 目标所在分组可能还没切过去（`?tab=` 缺失的旧链接），此时元素在 `[hidden]` 里、
  //    没有布局盒，滚也没用——`revealSettingsAnchor` 会直接拒绝，这里补一次回顶兜底；
  // 3. 锚点只处理一次：用户随后自己切组是新的意图，不该被反复拉回。
  //
  // 于是用**有界重试**（≈2s）：命中即收手；超时则退回分组顶部，不把页面永远挂在轮询上。
  useEffect(() => {
    const hash = window.location.hash;
    if (hash === "" || hash === "#") return undefined;
    let timer: number | undefined;
    let attempts = 0;
    const attempt = (): void => {
      if (revealSettingsAnchor(hash)) return;
      attempts += 1;
      if (attempts >= HASH_ANCHOR_RETRIES) {
        // 兜底：至少停在所属分组顶部（文案 `settingsUi.connections.anchor.missing`
        // 留给出提示的调用方，本页不弹 toast——它可能只是被条件隐藏了）。
        scrollSettingsToTop(contentRef.current);
        return;
      }
      timer = window.setTimeout(attempt, HASH_ANCHOR_RETRY_MS);
    };
    attempt();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

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

  // 只有真的换了分组才把内容区滚回顶部，而且**只在内容顶已经滚出视口时**才滚：
  // 原来无条件 `scrollIntoView` 会把"只滚了半屏"也拉回顶部，用户看到的是切组时闪一下。
  // 搜索命中后由 revealSettingsCard 负责一次滚动，这里不预滚（否则连跳两段）。
  useEffect(() => {
    if (prevSectionRef.current === null) {
      prevSectionRef.current = activeSection;
      return;
    }
    if (prevSectionRef.current === activeSection) return;
    prevSectionRef.current = activeSection;
    if (skipResetRef.current) return;
    scrollSettingsToTop(contentRef.current);
  }, [activeSection, pendingJump]);

  // 搜索命中：先切分组，等这一帧把目标卡渲染出来后再滚动 + 高亮。
  // 找不到目标卡（索引与 DOM 漂移）时兜底回到分组顶部，别让用户停在原地不知所措。
  useEffect(() => {
    if (pendingJump === null) return;
    skipResetRef.current = false;
    if (!revealSettingsCard(pendingJump.title)) {
      scrollSettingsToTop(contentRef.current);
    }
  }, [pendingJump]);

  const handleJump = (entry: SettingsIndexEntry) => {
    // 先占位再切组：切组 effect 与命中 effect 在同一批更新里跑，顺序由声明位置决定。
    skipResetRef.current = true;
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
      case "connections":
        // 外部连接（T11/T12）：识别引擎 + A/B 组凭据 + C 组下载源，三张卡同属一组。
        return <ConnectionsPanel />;
      case "appearance":
        return <AppearancePanel />;
      case "interaction":
        return <InteractionPanel />;
      case "notifications":
        return <NotificationsPanel />;
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
