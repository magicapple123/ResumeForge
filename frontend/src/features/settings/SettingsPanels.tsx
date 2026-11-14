// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页九组的**卡片编排**：只决定"哪张卡放在哪一组、按什么顺序、组内要不要一句说明"，
 * 不取数、不管弹窗状态。
 *
 * 为什么拆成九个小组件而不是一个巨型 `AssistantPanel`：分组从 6 页扩到 9 组后，
 * 「助手与 AI 行为」原来一页 12 张卡（现拆成助手行为 / 记忆与技能 / 语音与面试三组），要改面试音色得先翻过前面六张——所以按
 * 「模型 / 助手行为 / 记忆与技能 / 语音与面试」拆开，每组只放同一件事的卡。
 *
 * 分工约定：
 * - **props 一次算好传下来**：需要 hook 的卡片（模型配置、数据集、技能）由页面持有 hooks，
 *   这里只接已经算好的 props（`ComponentProps<typeof XxxCard>` 复用它自己的签名）。
 * - **自带取数的卡片**（语言、字体、导航、快捷键、备份、隐私、更新…）在这里直接渲染。
 * - 分组顺序与 `settingsSections.ts` 一致；组内的「子块标题」只给确实还分了两层的小组用
 *   （助手行为里的网申填表、操作习惯里的批量操作）。
 */
import type { ComponentProps } from "react";
import { Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import LLMConfigCard from "./LLMConfigCard";
import ModelWindowReferenceButton from "./ModelWindowReferenceButton";
import EmbeddingProviderCard from "./EmbeddingProviderCard";
import SettingsProvenanceSection from "./SettingsProvenanceSection";
import SearchCard from "./SearchCard";
import BatchOperationCard from "./BatchOperationCard";
import AssistantRelaxedModeCard from "./AssistantRelaxedModeCard";
import AssistantLimitCard from "./AssistantLimitCard";
import AssistantToolsCard from "../assistant/tools/AssistantToolsCard";
import AssistantMemoryCard from "./AssistantMemoryCard";
import AgentTaskEventsCard from "./AgentTaskEventsCard";
import JobPreferenceCard from "../job-preference/JobPreferenceCard";
import AsrSettingsCard from "../interview-voice/AsrSettingsCard";
import InterviewVoiceSettingsCard from "../interview-voice/InterviewVoiceSettingsCard";
import InterviewCameraSettingsCard from "../interview-voice/InterviewCameraSettingsCard";
import SkillsCard from "./SkillsCard";
import AssistantOrbCard from "./AssistantOrbCard";
import WebFormRelaxedModeCard from "./WebFormRelaxedModeCard";
import LocaleSettingsCard from "./LocaleSettingsCard";
import ResumeFontCard from "./ResumeFontCard";
import NavigationSettingsCard from "./NavigationSettingsCard";
import ShortcutSettingsCard from "./ShortcutSettingsCard";
import DatasetsCard from "./DatasetsCard";
import ExportSaveCard from "./ExportSaveCard";
import StorageStatsCard from "./StorageStatsCard";
import BackupStatusCard from "./BackupStatusCard";
import ManualBackupsCard from "./ManualBackupsCard";
import PrivacyCard from "./PrivacyCard";
import UpdateCard from "./UpdateCard";
import AnnouncementSettingsCard from "./AnnouncementSettingsCard";
import HelpDiagnosticsCard from "./HelpDiagnosticsCard";
import ReminderPopupCard from "./ReminderPopupCard";

/** 组内的子块标题：一组里确实还有两层时才用（不是每个分组都要）。 */
function SettingsGroupTitle({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="settings-group-title">
      <Typography.Text strong>{text}</Typography.Text>
      {hint && <Typography.Text type="secondary">{hint}</Typography.Text>}
    </div>
  );
}

/** AI 模型：模型配置（所有数据集共用）+ 窗口参考 + 语义检索 + 外发与用量。 */
export interface ModelPanelProps {
  llmCard: ComponentProps<typeof LLMConfigCard>;
  /** 当前生效配置的「方案 · 模型」摘要；未配置时 `undefined`（不造清单）。 */
  provenanceTarget: string | undefined;
}

export function ModelPanel({ llmCard, provenanceTarget }: ModelPanelProps) {
  // 模块级 t()：必须订阅语言变化，否则切到英文后这几句说明还是中文。
  useLocale();
  return (
    <>
      <LLMConfigCard {...llmCard} />
      {/* 窗口是手填的（服务商的 /models 不返回长度）：给一张可核对的参考表，
          别让用户凭记忆填；入口紧贴模型配置，不另起一块。 */}
      <ModelWindowReferenceButton />
      {/* 语义检索（RAG v3）：本地模型 / 远程服务二选一，默认关闭；失败自动回退关键词检索。 */}
      <EmbeddingProviderCard />
      {/* 外发与用量（R04）：目标服务取当前生效模型配置的摘要；外发预览正文只留在组件
          state，不落盘。 */}
      <SettingsProvenanceSection targetService={provenanceTarget} />
    </>
  );
}

/** 助手行为：联网怎么搜、规则放宽、运行上限、工具、求职偏好、网申边界。 */
export function AssistantBehaviorPanel() {
  useLocale();
  return (
    <>
      {/* 联网搜索与模型配置分家了：这里配的是"联网时怎么搜"，不涉及用哪个模型。 */}
      <SearchCard />
      {/* 助手的数据可见范围开关：放宽模式（默认关，开启前有明确告知）。 */}
      <AssistantRelaxedModeCard />
      {/* 运行上限（需求 #5）：轮次上限与整链时间预算，DB 优先、缺省回默认。 */}
      <AssistantLimitCard />
      <AssistantToolsCard />
      {/* 求职偏好（T14）：用户亲口设的约束，助手照着做但不当事实。 */}
      <JobPreferenceCard />
      {/* 网申填表的 AI 行为边界：与网申填表页顶部的快捷入口是同一个开关。 */}
      <SettingsGroupTitle text={t("settings.webform.title")} hint={t("settings.webform.hint")} />
      <WebFormRelaxedModeCard />
    </>
  );
}

/** 记忆与技能：助手记住什么、什么时候主动建任务卡、能读哪些技能。 */
export interface MemorySkillsPanelProps {
  skillsCard: ComponentProps<typeof SkillsCard>;
}

export function MemorySkillsPanel({ skillsCard }: MemorySkillsPanelProps) {
  useLocale();
  return (
    <>
      {/* 助手记忆（#31C/#18D）：七类求职事实的可见可改列表 + 手填画像；自动抽取默认关。 */}
      <AssistantMemoryCard />
      {/* 提醒到期自动生成任务卡（T26，默认关：只建卡、不执行写操作）。 */}
      <AgentTaskEventsCard />
      <SkillsCard {...skillsCard} />
    </>
  );
}

/** 语音与面试：转写服务、实时通话的音色语速、面试镜头。 */
export function VoicePanel() {
  useLocale();
  return (
    <>
      {/* 语音转写（T12）：独立 ASR 服务，地址与 Key 不跟大模型配置共用。 */}
      <AsrSettingsCard />
      {/* 面试语音（Q1-D）：实时通话的音色 / 语速 / 断句 / 自动发送等全量参数，存在本机。 */}
      <InterviewVoiceSettingsCard />
      {/* 面试镜头（F18）：默认关；录像不进备份，设置卡里写明。 */}
      <InterviewCameraSettingsCard />
    </>
  );
}

/**
 * 外观与语言：语言 / 简历字体 / 界面与导航**三张卡必须同级连续排列**（用户明确要求
 * "语言要单独成一张卡、和它们平级"），所以它们之间不许插分组标题或其他卡片。
 * 悬浮球排在它们之后：它是"界面上多一个球"，与前三张同类。
 */
export function AppearancePanel() {
  useLocale();
  return (
    <>
      <LocaleSettingsCard />
      <ResumeFontCard />
      <NavigationSettingsCard />
      <AssistantOrbCard />
    </>
  );
}

/** 操作习惯：按键怎么按、批量生成与批量导出用哪套参数。 */
export function InteractionPanel() {
  useLocale();
  return (
    <>
      <ShortcutSettingsCard />
      {/* 批量操作：岗位广场的批量生成与简历中心的批量导出共用这一套参数（未配置时两处会拦截）。 */}
      <SettingsGroupTitle text={t("batchOperation.title")} hint={t("batchOperation.group.hint")} />
      <BatchOperationCard />
    </>
  );
}

/** 数据与存储：数据集本身 + 导出产物落盘位置 + 存储占用。 */
export interface DataPanelProps {
  datasetsCard: ComponentProps<typeof DatasetsCard>;
}

export function DataPanel({ datasetsCard }: DataPanelProps) {
  useLocale();
  return (
    <>
      <DatasetsCard {...datasetsCard} />
      {/* 导出产物落盘位置：本质是"数据存哪里"的选择，与数据集同组。 */}
      <ExportSaveCard />
      {/* 存储占用（RF-25）：数据目录各分项的体积与文件数，只读展示。 */}
      <StorageStatsCard />
    </>
  );
}

/** 备份与隐私：自动备份、手动快照、隐私开关——语义都是"数据怎么保"。 */
export function BackupPanel() {
  useLocale();
  return (
    <>
      {/* 自动备份保护状态（RF-05）：是否被保护、最近成功、快照清单。 */}
      <BackupStatusCard />
      {/* 手动备份（RF-25）：backups/ 目录的快照清单与逐份可恢复清理。 */}
      <ManualBackupsCard />
      <PrivacyCard />
    </>
  );
}

/** 更新与帮助：版本更新、公告提醒、诊断与提醒弹窗行为。 */
export function AboutPanel() {
  useLocale();
  return (
    <>
      <UpdateCard />
      <AnnouncementSettingsCard />
      <HelpDiagnosticsCard />
      {/* 提醒弹窗是"应用行为"而不是"外观"：与版本、诊断同组更符合用户的找法。 */}
      <ReminderPopupCard />
    </>
  );
}
