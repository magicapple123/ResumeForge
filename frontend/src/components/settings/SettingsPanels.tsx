// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页六个页签的**卡片编排**：只决定"哪张卡放在哪一页、按什么顺序、上面压一句什么说明"，
 * 不取数、不管弹窗状态。
 *
 * 为什么从 `SettingsPage` 拆出来：那个文件原本 350 行、3 个页签、21 张卡全挤在 `app` 里。
 * 拆成六页后，如果卡片编排还留在页面文件里，页面会立刻顶到 500 行预算并且没法再加东西。
 * 现在页面只留 hooks + `<Tabs>` 外壳，卡片顺序全部在这里，读起来就是"页面结构表"。
 *
 * 分工约定：
 * - **props 一次算好传下来**：需要 hook 的卡片（模型配置、数据集、技能）由页面持有 hooks，
 *   这里只接已经算好的 props（`ComponentProps<typeof XxxCard>` 复用它自己的签名，避免
 *   在两层各写一份 props 类型然后慢慢漂）。
 * - **自带取数的卡片**（语言、字体、导航、快捷键、备份、隐私、更新…）在这里直接渲染，
 *   它们各自管理自己的请求，页面不必知道。
 * - 页签顺序按用户心智：先 AI 怎么配（model → assistant），再界面怎么用（appearance），
 *   再数据怎么存怎么保（data → backup），最后应用本身（about）。
 */
import type { ComponentProps } from "react";
import { Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import LLMConfigCard from "./LLMConfigCard";
import SettingsProvenanceSection from "./SettingsProvenanceSection";
import SearchCard from "./SearchCard";
import BatchOperationCard from "./BatchOperationCard";
import AssistantRelaxedModeCard from "./AssistantRelaxedModeCard";
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

/** 页签内分组标题：卡片多了之后，每页再按「管什么」分层，扫一眼就能对号入座。 */
export function SettingsGroupTitle({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="settings-group-title">
      <Typography.Text strong>{text}</Typography.Text>
      {hint && <Typography.Text type="secondary">{hint}</Typography.Text>}
    </div>
  );
}

/** 每个页签顶部那句说明：先告诉用户"这一页管什么"，再看卡片。 */
function TabIntro({ text }: { text: string }) {
  return (
    <div className="settings-section-head">
      <div className="settings-section-titles">
        <Typography.Text type="secondary">{text}</Typography.Text>
      </div>
    </div>
  );
}

/** AI 模型页：模型配置（所有数据集共用）+ 外发与用量（紧跟它说明的对象）。 */
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
      <SettingsGroupTitle
        text={t("settings.model.group.title")}
        hint={t("settings.model.group.hint")}
      />
      <LLMConfigCard {...llmCard} />
      {/* 外发与用量（R04）：目标服务取当前生效模型配置的摘要；外发预览正文只留在组件
          state，不落盘。 */}
      <SettingsProvenanceSection targetService={provenanceTarget} />
    </>
  );
}

/** 助手与 AI 行为页：联网怎么搜、规则放宽、能读哪些技能、悬浮球、网申填表。 */
export interface AssistantPanelProps {
  skillsCard: ComponentProps<typeof SkillsCard>;
}

export function AssistantPanel({ skillsCard }: AssistantPanelProps) {
  useLocale();
  return (
    <>
      <SettingsGroupTitle
        text={t("settings.assistant.group.title")}
        hint={t("settings.assistant.group.hint")}
      />
      {/* 联网搜索与模型配置分家了：这里配的是"联网时怎么搜"，不涉及用哪个模型。 */}
      <SearchCard />
      {/* 助手的数据可见范围开关：放宽模式（默认关，开启前有明确告知）。 */}
      <AssistantRelaxedModeCard />
      <SkillsCard {...skillsCard} />
      <AssistantOrbCard />
      {/* 网申填表的 AI 行为边界：与网申填表页顶部的快捷入口是同一个开关。 */}
      <SettingsGroupTitle text={t("settings.webform.title")} hint={t("settings.webform.hint")} />
      <WebFormRelaxedModeCard />
    </>
  );
}

/**
 * 外观与交互页：语言 / 简历字体 / 界面与导航**三张卡必须同级连续排列**（用户明确要求
 * "语言要单独成一张卡、和它们平级"），所以它们之间不许插分组标题或其他卡片。
 */
export function AppearancePanel() {
  useLocale();
  return (
    <>
      <SettingsGroupTitle
        text={t("settings.appearance.group.title")}
        hint={t("settings.appearance.group.hint")}
      />
      <LocaleSettingsCard />
      <ResumeFontCard />
      <NavigationSettingsCard />
      <ShortcutSettingsCard />
      {/* 批量操作：岗位广场的批量生成与简历中心的批量导出共用这一套参数（未配置时两处会拦截）。 */}
      <SettingsGroupTitle text={t("batchOperation.title")} hint={t("batchOperation.group.hint")} />
      <BatchOperationCard />
    </>
  );
}

/** 数据与导出页：数据集本身 + 导出产物落盘位置 + 存储占用。 */
export interface DataPanelProps {
  datasetsCard: ComponentProps<typeof DatasetsCard>;
}

export function DataPanel({ datasetsCard }: DataPanelProps) {
  useLocale();
  return (
    <>
      <TabIntro text={t("settings.data.intro")} />
      <DatasetsCard {...datasetsCard} />
      {/* 导出产物落盘位置：本质是"数据存哪里"的选择，与数据集放同一页签。 */}
      <ExportSaveCard />
      {/* 存储占用（RF-25）：数据目录各分项的体积与文件数，只读展示。 */}
      <StorageStatsCard />
    </>
  );
}

/** 备份与隐私页：自动备份、手动快照、隐私开关——语义都是"数据怎么保"。 */
export function BackupPanel() {
  useLocale();
  return (
    <>
      <TabIntro text={t("settings.backup.intro")} />
      {/* 自动备份保护状态（RF-05）：是否被保护、最近成功、快照清单。 */}
      <BackupStatusCard />
      {/* 手动备份（RF-25）：backups/ 目录的快照清单与逐份可恢复清理。 */}
      <ManualBackupsCard />
      <PrivacyCard />
    </>
  );
}

/** 更新与帮助页：版本更新、公告提醒、诊断与提醒弹窗行为。 */
export function AboutPanel() {
  useLocale();
  return (
    <>
      <TabIntro text={t("settings.about.intro")} />
      <UpdateCard />
      <AnnouncementSettingsCard />
      <HelpDiagnosticsCard />
      {/* 提醒弹窗是"应用行为"而不是"外观"：与版本、诊断同页更符合用户的找法。 */}
      <ReminderPopupCard />
    </>
  );
}
