// SPDX-License-Identifier: Apache-2.0
/** 设置页：大模型配置（单区块：记录卡列表 + 新增/编辑共用弹窗）。 */
import { Tabs, Typography } from "antd";
import { useState } from "react";
import { useSettingsDatasets } from "../features/settings/useSettingsDatasets";
import { useSettingsSkills } from "../features/settings/useSettingsSkills";
import { useLLMSettings } from "../features/settings/useLLMSettings";
import { useLLMRecordTools } from "../features/settings/useLLMRecordTools";
import DatasetsCard from "../components/settings/DatasetsCard";
import BackupStatusCard from "../components/settings/BackupStatusCard";
import ManualBackupsCard from "../components/settings/ManualBackupsCard";
import StorageStatsCard from "../components/settings/StorageStatsCard";
import AssistantOrbCard from "../components/settings/AssistantOrbCard";
import LLMConfigCard from "../components/settings/LLMConfigCard";
import ReminderPopupCard from "../components/settings/ReminderPopupCard";
import WebFormRelaxedModeCard from "../components/settings/WebFormRelaxedModeCard";
import ExportSaveCard from "../components/settings/ExportSaveCard";
import SearchCard from "../components/settings/SearchCard";
import AssistantRelaxedModeCard from "../components/settings/AssistantRelaxedModeCard";
import SkillsCard from "../components/settings/SkillsCard";
import UpdateCard from "../components/settings/UpdateCard";
import HelpDiagnosticsCard from "../components/settings/HelpDiagnosticsCard";
import PrivacyCard from "../components/settings/PrivacyCard";
import NavigationSettingsCard from "../components/settings/NavigationSettingsCard";
import ResumeFontCard from "../components/settings/ResumeFontCard";
import ShortcutSettingsCard from "../components/settings/ShortcutSettingsCard";
import SkillEditorModal from "../components/skills/SkillEditorModal";

/** 设置分页。三页各自装同一类东西：改模型配置不用先翻过整套数据备份。 */
type SettingsTabKey = "model" | "data" | "app";

/** 页签内分组标题：卡片多了之后，每页再按「管什么」分层，扫一眼就能对号入座。 */
function SettingsGroupTitle({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="settings-group-title">
      <Typography.Text strong>{text}</Typography.Text>
      {hint && <Typography.Text type="secondary">{hint}</Typography.Text>}
    </div>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTabKey>("model");

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

  const {
    skills,
    skillsLoading,
    skillImporting,
    skillTogglingId,
    skillDeletingId,
    loadSkillList,
    importSkillFile,
    toggleSkill,
    removeSkill,
  } = useSettingsSkills();
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

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            设置
          </Typography.Title>
          <Typography.Text type="secondary">
            配置简历生成、岗位需求解读和求职助手等 AI 功能使用的模型服务
          </Typography.Text>
        </div>
      </div>

      {/* 设置项按"你改的是什么"分成三页，而不是全部平铺一页。
          功能变多之后一整页排下来找起来很费劲：想改数据备份得先翻过整套模型参数。
          分页之后每页只装同一类东西，「编辑设置」跟着**它真正控制的那一页**走——
          此前它在页面顶部，却只管模型配置，而其余几组一直是可编辑的。 */}
      <Tabs
        className="settings-tabs"
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as SettingsTabKey)}
        items={[
          {
            key: "model",
            label: "AI 模型",
            children: (
              <>
                <div className="settings-section-head">
                  <div className="settings-section-titles">
                    <Typography.Text type="secondary">
                      简历生成、岗位解读与求职助手用的是同一套模型配置，所有数据集共用；
                      已保存的配置以记录卡片展示，点「新增配置」或记录卡上的「编辑」在弹窗中填写。
                    </Typography.Text>
                  </div>
                </div>

                <SettingsGroupTitle
                  text="大模型 API 配置（所有数据集共用）"
                  hint="保存即对所有数据集生效；记录卡片可随时切换「使用中」"
                />
                <LLMConfigCard
                  records={records}
                  recordsLoading={recordsLoading}
                  activeRecordId={activeRecordId}
                  configSummary={configSummary}
                  recordApplyingId={recordApplyingId}
                  recordDeletingId={recordDeletingId}
                  recordTestingId={recordTestingId}
                  recordTestResults={recordTestResults}
                  recordForm={recordForm}
                  recordModalOpen={recordModalOpen}
                  editingRecord={editingRecord}
                  recordSaving={recordEditSaving}
                  draftTesting={draftTesting}
                  draftTestResult={draftTestResult}
                  checkingThinking={checkingThinking}
                  thinkingResult={thinkingResult}
                  showingCustomEffort={showingCustomEffort}
                  effortOptions={effortOptions}
                  onProbeThinking={() => probeThinking()}
                  onLoadThinkingOptions={() => checkThinking(false)}
                  onBackToEffortPresets={backToEffortPresets}
                  onEffortCustom={handleEffortCustom}
                  onClearThinkingResult={clearThinkingResult}
                  onOpenCreate={openCreate}
                  onOpenRecordEdit={openRecordEdit}
                  onSaveRecord={() => void handleSaveRecord()}
                  onCloseRecordModal={closeRecordModal}
                  onApplyRecord={(record) => void applyRecord(record)}
                  onRemoveRecord={(record) => void removeRecord(record)}
                  onTestRecord={(record) => void testRecord(record)}
                  onTestDraft={() => void testDraft()}
                  onPresetChange={applyRecordPreset}
                  onFetchDraftModels={fetchDraftModels}
                />

                {/* 联网搜索与模型配置同页：两者一起决定助手"能查什么、查得多细"。 */}
                <SettingsGroupTitle text="助手能力" hint="助手能查什么、会什么、能读什么" />
                <SearchCard />

                {/* 助手的数据可见范围开关：放宽模式（默认关，开启前有明确告知）。 */}
                <AssistantRelaxedModeCard />

                <SkillsCard
                  skills={skills}
                  loading={skillsLoading}
                  importing={skillImporting}
                  togglingId={skillTogglingId}
                  deletingId={skillDeletingId}
                  onImport={(file) => void importSkillFile(file)}
                  onToggle={(skill, enabled) => void toggleSkill(skill, enabled)}
                  onDelete={(skill) => void removeSkill(skill)}
                  onOpen={(skill) => {
                    setSkillEditorId(skill.id);
                    setSkillEditorOpen(true);
                  }}
                />
              </>
            ),
          },
          {
            key: "data",
            label: "数据",
            children: (
              <>
                <div className="settings-section-head">
                  <div className="settings-section-titles">
                    <Typography.Text type="secondary">
                      岗位、简历与资料都存放在当前数据集里，可以整份导出备份或切换。
                    </Typography.Text>
                  </div>
                </div>
                <DatasetsCard
                  datasets={datasets}
                  loading={datasetsLoading}
                  exporting={datasetExporting}
                  importing={datasetImporting}
                  includeGlobalLLM={includeGlobalLLM}
                  onIncludeGlobalLLMChange={setIncludeGlobalLLM}
                  switchingId={switchingDatasetId}
                  renamingId={renamingDatasetId}
                  deletingId={deletingDatasetId}
                  renameTarget={renameTarget}
                  renameValue={renameValue}
                  creating={datasetCreating}
                  createOpen={createDatasetOpen}
                  createName={createDatasetName}
                  onExport={(dataset, filename) => void runDatasetExport(dataset, filename)}
                  onExportAll={(filename) => void runExportAllDatasets(filename)}
                  onImport={(file, name) => void importDatasetFile(file, name)}
                  onActivate={(dataset) => void switchDataset(dataset)}
                  onOpenRename={(dataset) => {
                    setRenameTarget(dataset);
                    setRenameValue(dataset.name);
                  }}
                  onRenameValueChange={setRenameValue}
                  onConfirmRename={() => void confirmDatasetRename()}
                  onCancelRename={() => {
                    if (renamingDatasetId === null) setRenameTarget(null);
                  }}
                  onDelete={(dataset) => void removeDataset(dataset)}
                  onOpenCreate={() => {
                    setCreateDatasetName("");
                    setCreateDatasetOpen(true);
                  }}
                  onCreateNameChange={setCreateDatasetName}
                  onConfirmCreate={() => void createEmptyDataset()}
                  onCancelCreate={() => {
                    if (!datasetCreating) setCreateDatasetOpen(false);
                  }}
                />
                {/* 自动备份保护状态（RF-05）：是否被保护、最近成功、快照清单。 */}
                <BackupStatusCard />
                {/* 手动备份（RF-25）：backups/ 目录的快照清单与逐份可恢复清理。 */}
                <ManualBackupsCard />
                {/* 导出产物落盘位置：本质是"数据存哪里"的选择，与数据集放同一页签。 */}
                <ExportSaveCard />
                <PrivacyCard />
                {/* 存储占用（RF-25）：数据目录各分项的体积与文件数，只读展示。 */}
                <StorageStatsCard />
              </>
            ),
          },
          {
            key: "app",
            label: "应用",
            children: (
              <>
                <div className="settings-section-head">
                  <div className="settings-section-titles">
                    <Typography.Text type="secondary">
                      应用本身的版本、更新与提醒行为。
                    </Typography.Text>
                  </div>
                </div>
                <SettingsGroupTitle
                  text="界面与提醒"
                  hint="导航入口、快捷键、悬浮球与近期提醒的行为"
                />
                {/* 主题切换已上移到页头（A3）：设置页只留一句说明，避免两处控件各说一套。 */}
                <Typography.Paragraph type="secondary" className="settings-theme-note">
                  主题在页面右上角切换；深色只作用于应用界面，简历预览、导出 PDF 与打印结果
                  仍是白纸。
                </Typography.Paragraph>
                <ResumeFontCard />
                <NavigationSettingsCard />
                <ShortcutSettingsCard />
                <AssistantOrbCard />
                <ReminderPopupCard />

                {/* 网申填表的 AI 行为边界：与网申填表页顶部的快捷入口是同一个开关。 */}
                <SettingsGroupTitle text="网申填表" hint="网申填表时 AI 能多做多少" />
                <WebFormRelaxedModeCard />

                <SettingsGroupTitle text="更新与帮助" hint="版本更新、诊断与反馈入口" />
                <UpdateCard />
                <HelpDiagnosticsCard />
              </>
            ),
          },
        ]}
      />

      {/* 设置页里点技能名查看详情，与技能工作台共用同一个编辑弹窗。 */}
      <SkillEditorModal
        open={skillEditorOpen}
        skillId={skillEditorId}
        onClose={() => setSkillEditorOpen(false)}
        onSaved={() => void loadSkillList()}
      />
    </div>
  );
}
