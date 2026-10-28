// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页外壳：只做三件事——持有需要跨页签共享的 hooks、算好各卡片的 props、渲染六个页签。
 *
 * 页签内"哪张卡放哪一页"全部在 `components/settings/SettingsPanels.tsx`（那份文件就是
 * 页面结构表）。这样拆的原因：设置项从 21 张卡、3 个页签扩到 6 个页签后，如果编排还留在
 * 这里，本文件会顶到 500 行预算并且再也没法加东西。
 *
 * 默认停留在 `model`：多数人进设置页是为了改模型或看用量，切页签不改变任何已存设置。
 */
import { Tabs, Typography } from "antd";
import { useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { useSearchParams } from "react-router-dom";
import { useSettingsDatasets } from "../features/settings/useSettingsDatasets";
import { useSettingsSkills } from "../features/settings/useSettingsSkills";
import { useLLMSettings } from "../features/settings/useLLMSettings";
import { useLLMRecordTools } from "../features/settings/useLLMRecordTools";
import LLMConfigCard from "../components/settings/LLMConfigCard";
import DatasetsCard from "../components/settings/DatasetsCard";
import SkillsCard from "../components/settings/SkillsCard";
import {
  AboutPanel,
  AppearancePanel,
  AssistantPanel,
  BackupPanel,
  DataPanel,
  ModelPanel,
} from "../components/settings/SettingsPanels";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import SkillEditorModal from "../components/skills/SkillEditorModal";

/** 设置分页：六页各自装同一类东西——改模型配置不用先翻过整套数据备份。 */
export type SettingsTabKey = "model" | "assistant" | "appearance" | "data" | "backup" | "about";

const SETTINGS_TAB_KEYS: SettingsTabKey[] = [
  "model",
  "assistant",
  "appearance",
  "data",
  "backup",
  "about",
];

/** 深链 `?tab=` 的解析：不在清单里就回默认页（不报错，也不接受任意字符串）。 */
function parseSettingsTab(value: string | null): SettingsTabKey {
  return SETTINGS_TAB_KEYS.find((key) => key === value) ?? "model";
}

export default function SettingsPage() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<SettingsTabKey>(() =>
    parseSettingsTab(searchParams.get("tab")),
  );

  // 带锚点进来（例如批量操作未配置时从岗位广场跳来）要落到那张卡，而不是停在页签顶部。
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
  }, [activeTab]);

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

  // 本页用模块级 t() 取文案：必须订阅语言变化，否则切到英文后这一页仍是中文。
  useLocale();

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
  // useSettingsSkills 已收成只读 hook（A2 收权），写路径在本页没有消费方，所以已删除。
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

      {/* 设置项按"你改的是什么"分页，而不是全部平铺一页：功能变多之后一整页排下来找起来
          很费劲（想改数据备份得先翻过整套模型参数）。六页的分法与顺序见 SettingsPanels
          的文件头说明。 */}
      <Tabs
        className="settings-tabs"
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as SettingsTabKey)}
        items={[
          {
            key: "model",
            label: t("settings.tab.model"),
            children: (
              <ModelPanel
                llmCard={llmCard}
                provenanceTarget={
                  configSummary
                    ? t(configSummary.presetLabelKey) + " · " + configSummary.model
                    : undefined
                }
              />
            ),
          },
          {
            key: "assistant",
            label: t("settings.tab.assistant"),
            children: <AssistantPanel skillsCard={skillsCard} />,
          },
          {
            key: "appearance",
            label: t("settings.tab.appearance"),
            children: <AppearancePanel />,
          },
          {
            key: "data",
            label: t("settings.tab.data"),
            children: <DataPanel datasetsCard={datasetsCard} />,
          },
          {
            key: "backup",
            label: t("settings.tab.backup"),
            children: <BackupPanel />,
          },
          {
            key: "about",
            label: t("settings.tab.about"),
            children: <AboutPanel />,
          },
        ]}
      />

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
