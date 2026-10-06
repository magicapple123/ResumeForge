/** 设置页：大模型配置（含预设与连通测试）。 */
import { CloseOutlined, EditOutlined, SaveOutlined } from "@ant-design/icons";
import { App, Button, Tabs, Typography } from "antd";
import { useState } from "react";
import { useSettingsDatasets } from "../features/settings/useSettingsDatasets";
import { useSettingsSkills } from "../features/settings/useSettingsSkills";
import { useLLMSettings } from "../features/settings/useLLMSettings";
import DatasetsCard from "../components/settings/DatasetsCard";
import AssistantOrbCard from "../components/settings/AssistantOrbCard";
import LLMConfigCard from "../components/settings/LLMConfigCard";
import LLMConfigRecordsCard from "../components/settings/LLMConfigRecordsCard";
import ReminderPopupCard from "../components/settings/ReminderPopupCard";
import WebFormRelaxedModeCard from "../components/settings/WebFormRelaxedModeCard";
import SearchCard from "../components/settings/SearchCard";
import SkillsCard from "../components/settings/SkillsCard";
import UpdateCard from "../components/settings/UpdateCard";
import HelpDiagnosticsCard from "../components/settings/HelpDiagnosticsCard";
import PrivacyCard from "../components/settings/PrivacyCard";
import NavigationSettingsCard from "../components/settings/NavigationSettingsCard";
import SkillEditorModal from "../components/skills/SkillEditorModal";

/** 设置分页。三页各自装同一类东西：改模型配置不用先翻过整套数据备份。 */
type SettingsTabKey = "model" | "data" | "app";

export default function SettingsPage() {
  const { message } = App.useApp();
  const [activeTab, setActiveTab] = useState<SettingsTabKey>("model");

  const {
    form,
    saving,
    testing,
    editing,
    setEditing,
    testResult,
    apiKeyResetToken,
    records,
    recordsLoading,
    activeRecordId,
    recordModalOpen,
    setRecordModalOpen,
    recordName,
    setRecordName,
    recordSaving,
    recordApplyingId,
    recordDeletingId,
    applyPreset,
    revealSavedApiKey,
    save,
    fetchModels,
    checkThinking,
    test,
    openRecordModal,
    saveRecord,
    applyRecord,
    removeRecord,
    cancelEditing,
    resetRevealedApiKey,
  } = useLLMSettings();

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
    includeApiKeys,
    setIncludeApiKeys,
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
    <div className={`settings-page${editing ? " is-editing" : ""}`}>
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
                      简历生成、岗位解读与求职助手用的是同一套模型配置；改之前需要先点「编辑设置」。
                    </Typography.Text>
                  </div>
                  <div className="settings-section-actions">
                    {editing ? (
                      <>
                        <Button
                          icon={<CloseOutlined />}
                          disabled={saving || testing}
                          onClick={cancelEditing}
                        >
                          取消
                        </Button>
                        <Button
                          type="primary"
                          icon={<SaveOutlined />}
                          loading={saving}
                          disabled={testing}
                          onClick={() => void save()}
                        >
                          保存配置
                        </Button>
                      </>
                    ) : (
                      <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                        编辑设置
                      </Button>
                    )}
                  </div>
                </div>

                <LLMConfigCard
                  form={form}
                  editing={editing}
                  saving={saving}
                  testing={testing}
                  testResult={testResult}
                  apiKeyResetToken={apiKeyResetToken}
                  onPresetChange={applyPreset}
                  onResetApiKey={resetRevealedApiKey}
                  onRevealApiKey={revealSavedApiKey}
                  onRevealError={(error) => message.error(error)}
                  onTest={() => void test()}
                  onFetchModels={fetchModels}
                  onCheckThinking={checkThinking}
                />

                <LLMConfigRecordsCard
                  records={records}
                  recordsLoading={recordsLoading}
                  activeRecordId={activeRecordId}
                  editing={editing}
                  saving={saving}
                  testing={testing}
                  recordSaving={recordSaving}
                  recordApplyingId={recordApplyingId}
                  recordDeletingId={recordDeletingId}
                  recordModalOpen={recordModalOpen}
                  recordName={recordName}
                  onOpenRecordModal={openRecordModal}
                  onApplyRecord={(record) => void applyRecord(record)}
                  onRemoveRecord={(record) => void removeRecord(record)}
                  onRecordNameChange={setRecordName}
                  onSaveRecord={() => void saveRecord()}
                  onCloseRecordModal={() => {
                    if (!recordSaving) setRecordModalOpen(false);
                  }}
                />

                {/* 联网搜索与模型配置同页：两者一起决定助手"能查什么、查得多细"。 */}
                <SearchCard />

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
                  includeApiKeys={includeApiKeys}
                  onIncludeApiKeysChange={setIncludeApiKeys}
                  switchingId={switchingDatasetId}
                  renamingId={renamingDatasetId}
                  deletingId={deletingDatasetId}
                  renameTarget={renameTarget}
                  renameValue={renameValue}
                  creating={datasetCreating}
                  createOpen={createDatasetOpen}
                  createName={createDatasetName}
                  onExport={(dataset) => void runDatasetExport(dataset)}
                  onExportAll={() => void runExportAllDatasets()}
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
                <PrivacyCard />
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
                <NavigationSettingsCard />
                <AssistantOrbCard />
                <ReminderPopupCard />
                <WebFormRelaxedModeCard />
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
