// SPDX-License-Identifier: Apache-2.0
/**
 * 语言包命名空间的**聚合点**。
 *
 * zh-CN.ts 是 500 行零豁免预算的硬线：每新增一个领域命名空间，如果都往主文件里加
 * import 与 spread，两条固定开销会很快把它顶过线。这里把"有哪些命名空间、按什么顺序合并"
 * 收成一处——主文件只 import 本文件并展开一次。
 *
 * 登记新命名空间时**只改本文件**（import + spread 各一行），zh-CN.ts 不动。
 * 合并顺序 = 下方展开顺序；后展开的键覆盖先展开的，因此新命名空间不要与既有 key 重名。
 */

import assets from "./zh-CN.assets";
import batchOperation from "./zh-CN.batchOperation";
import bilingual from "./zh-CN.bilingual";
import careerScenarios from "./zh-CN.careerScenarios";
import conflict from "./zh-CN.conflict";
import common from "./zh-CN.common";
import credentials from "./zh-CN.credentials";
import delivery from "./zh-CN.delivery";
import fontDownload from "./zh-CN.fontDownload";
import fonts from "./zh-CN.fonts";
import optimizer from "./zh-CN.optimizer";
import outline from "./zh-CN.outline";
import pagination from "./zh-CN.pagination";
import params from "./zh-CN.params";
import preflight from "./zh-CN.preflight";
import profileFacts from "./zh-CN.profileFacts";
import profileFactsLegacy from "./zh-CN.profileFactsLegacy";
import profileGroups from "./zh-CN.profileGroups";
import profileField from "./zh-CN.profileField";
import profileLibrary from "./zh-CN.profileLibrary";
import preview from "./zh-CN.preview";
import provenance from "./zh-CN.provenance";
import proview from "./zh-CN.proview";
import research from "./zh-CN.research";
import responsive from "./zh-CN.responsive";
import review from "./zh-CN.review";
import rich from "./zh-CN.rich";
import trial from "./zh-CN.trial";
import typography from "./zh-CN.typography";
import versions from "./zh-CN.versions";
import workbench from "./zh-CN.workbench";
import webformGroups from "./zh-CN.webformGroups";
import webformFields from "./zh-CN.webformFields";
import settingsPage from "./zh-CN.settingsPage";
import exportPanel from "./zh-CN.exportPanel";
import resumeEditor from "./zh-CN.resumeEditor";
import trash from "./zh-CN.trash";
import reminder from "./zh-CN.reminder";
import materials from "./zh-CN.materials";
import applyQueue from "./zh-CN.applyQueue";
import claimForm from "./zh-CN.claimForm";
import skills from "./zh-CN.skills";
import toolCalls from "./zh-CN.toolCalls";
import datasets from "./zh-CN.datasets";
import jobImport from "./zh-CN.jobImport";
import update from "./zh-CN.update";
import riskPanel from "./zh-CN.riskPanel";
import interview from "./zh-CN.interview";
import materialForm from "./zh-CN.materialForm";
import jobMatch from "./zh-CN.jobMatch";
import jobDetail from "./zh-CN.jobDetail";
import drill from "./zh-CN.drill";
import reminderItem from "./zh-CN.reminderItem";
import fieldPath from "./zh-CN.fieldPath";
import applyProgress from "./zh-CN.applyProgress";
import collectFilters from "./zh-CN.collectFilters";
import llmRecord from "./zh-CN.llmRecord";
import educationSection from "./zh-CN.educationSection";
import jobTable from "./zh-CN.jobTable";
import jobAnalysis from "./zh-CN.jobAnalysis";
import templateImport from "./zh-CN.templateImport";
import webFormRecords from "./zh-CN.webFormRecords";
import claimsPage from "./zh-CN.claimsPage";
import browserStatus from "./zh-CN.browserStatus";
import trackerForm from "./zh-CN.trackerForm";
import interviewExperience from "./zh-CN.interviewExperience";
import jobMatchBatch from "./zh-CN.jobMatchBatch";
import assistantComposer from "./zh-CN.assistantComposer";
import webFormPage from "./zh-CN.webFormPage";
import collectResult from "./zh-CN.collectResult";
import webFormLegacy from "./zh-CN.webFormLegacy";
import aiPolish from "./zh-CN.aiPolish";
import bulkEnqueue from "./zh-CN.bulkEnqueue";
import applySettings from "./zh-CN.applySettings";
import searchCard from "./zh-CN.searchCard";
import interviewReview from "./zh-CN.interviewReview";
import resumeSuggestions from "./zh-CN.resumeSuggestions";
import manualBackups from "./zh-CN.manualBackups";
import storageStats from "./zh-CN.storageStats";
import referralForm from "./zh-CN.referralForm";
import trackerPage from "./zh-CN.trackerPage";
import drillSession from "./zh-CN.drillSession";
import shortcutSettings from "./zh-CN.shortcutSettings";
import shortcutsCard from "./zh-CN.shortcutsCard";
import backgroundTasks from "./zh-CN.backgroundTasks";
import referenceFile from "./zh-CN.referenceFile";
import knowledgeForm from "./zh-CN.knowledgeForm";
import jobForm from "./zh-CN.jobForm";
import applyRecords from "./zh-CN.applyRecords";
import profilePhoto from "./zh-CN.profilePhoto";
import favorites from "./zh-CN.favorites";
import atsCheck from "./zh-CN.atsCheck";
import advancedParams from "./zh-CN.advancedParams";
import appHeader from "./zh-CN.appHeader";
import backupStatus from "./zh-CN.backupStatus";
import claimCard from "./zh-CN.claimCard";
import claimDraftModal from "./zh-CN.claimDraftModal";
import gallery from "./zh-CN.gallery";
import generate from "./zh-CN.generate";
import globalFileDrop from "./zh-CN.globalFileDrop";
import jobMatchBatchResult from "./zh-CN.jobMatchBatchResult";
import jobs from "./zh-CN.jobs";
import knowledgePage from "./zh-CN.knowledgePage";
import liveModeCard from "./zh-CN.liveModeCard";
import llmConfigCard from "./zh-CN.llmConfigCard";
import llmRecordView from "./zh-CN.llmRecordView";
import profileTextModal from "./zh-CN.profileTextModal";
import questionBankPanel from "./zh-CN.questionBankPanel";
import referralDetail from "./zh-CN.referralDetail";
import resume from "./zh-CN.resume";
import resumeChangeReview from "./zh-CN.resumeChangeReview";
import resumeDeliveryInfo from "./zh-CN.resumeDeliveryInfo";
import resumeFieldDiffView from "./zh-CN.resumeFieldDiffView";
import resumes from "./zh-CN.resumes";
import resumesPage from "./zh-CN.resumesPage";
import sections from "./zh-CN.sections";
import styleTemplateEditor from "./zh-CN.styleTemplateEditor";
import trackerImport from "./zh-CN.trackerImport";
import writing from "./zh-CN.writing";
import activationUi from "./zh-CN.activationUi";
import analyticsPage from "./zh-CN.analyticsPage";
import analyticsUi from "./zh-CN.analyticsUi";
import apiErrors from "./zh-CN.apiErrors";
import appConfig from "./zh-CN.appConfig";
import applyCollect from "./zh-CN.applyCollect";
import applyUi from "./zh-CN.applyUi";
import assistantHooks from "./zh-CN.assistantHooks";
import assistantUi from "./zh-CN.assistantUi";
import componentsMisc from "./zh-CN.componentsMisc";
import componentsMisc2 from "./zh-CN.componentsMisc2";
import dateFields from "./zh-CN.dateFields";
import featuresMisc from "./zh-CN.featuresMisc";
import fileUtils from "./zh-CN.fileUtils";
import generateStages from "./zh-CN.generateStages";
import globalSearch from "./zh-CN.globalSearch";
import homePage from "./zh-CN.homePage";
import hooksUi from "./zh-CN.hooksUi";
import interviewPage from "./zh-CN.interviewPage";
import jobsCandidate from "./zh-CN.jobsCandidate";
import jobsForm from "./zh-CN.jobsForm";
import jobsPage from "./zh-CN.jobsPage";
import jobsUi from "./zh-CN.jobsUi";
import llmUi from "./zh-CN.llmUi";
import navigation from "./zh-CN.navigation";
import pagesMisc from "./zh-CN.pagesMisc";
import profileUi from "./zh-CN.profileUi";
import referralUi from "./zh-CN.referralUi";
import settingsDatasets from "./zh-CN.settingsDatasets";
import settingsUi from "./zh-CN.settingsUi";
import templatesUi from "./zh-CN.templatesUi";
import touTou from "./zh-CN.touTou";
import trackerUi from "./zh-CN.trackerUi";
import userGuide from "./zh-CN.userGuide";
import userGuideFlow from "./zh-CN.userGuideFlow";
import enumsApply from "./zh-CN.enumsApply";
import enumsAssistant from "./zh-CN.enumsAssistant";
import enumsClaims from "./zh-CN.enumsClaims";
import enumsDrill from "./zh-CN.enumsDrill";
import enumsInterview from "./zh-CN.enumsInterview";
import enumsJobs from "./zh-CN.enumsJobs";
import enumsKnowledge from "./zh-CN.enumsKnowledge";
import enumsReferral from "./zh-CN.enumsReferral";
import enumsResumeCatalog from "./zh-CN.enumsResumeCatalog";
import enumsTracker from "./zh-CN.enumsTracker";

const namespaces = {
  /** 简历制作台（2026-10-23）。 */
  ...workbench,
  /** 简历预览的缩放条（2026-10-23）。 */
  ...preview,
  /** 多分辨率适配（2026-10-23）。 */
  ...responsive,
  /** 简历字体（内置思源黑体按需下载）与工作台「版式」页签。 */
  ...fonts,
  /** 字符级加粗（右键菜单）与制作台实时预览（R4 / R5）。 */
  ...rich,
  /** 字体下载/取消/删除/样张 · 板块顺序 · 精确模式字族说明。 */
  ...fontDownload,
  /** 模板一览口径 · 参数复位 · 写作增强提示 · 精确预览补页。 */
  ...params,
  /** W06「文档大纲」。 */
  ...outline,
  /** W02 保存冲突三选一。 */
  ...conflict,
  ...common,
  /** W15/D04/D05/D09/D10/D13/D14 专业视图。 */
  ...proview,
  /** W14 科研栏目与长 CV 模式。 */
  ...research,
  /** W07 局部排版。 */
  ...typography,
  /** W17 私有表达资产。 */
  ...assets,
  ...batchOperation,
  /** W11 统一检查面板。 */
  ...preflight,
  /** W18 离线对象批注。 */
  ...review,
  /** W10 当前内容试模板。 */
  ...trial,
  /** W16 双语版本与术语表。 */
  ...bilingual,
  /** W12 持久来源/事实锁/外发预览/用量。 */
  ...provenance,
  /** W08 分页控制。 */
  ...pagination,
  /** W13 命名版本与岗位变体。 */
  ...versions,
  /** W19 导出配置与交付原件。 */
  ...delivery,
  /** W09 有约束版面优化。 */
  ...optimizer,
  /** A2 职业场景（选择/编辑/本次生成披露）。 */
  ...careerScenarios,
  /** F6 资料方案与当前方案（2026-10-25）。 */
  ...profileGroups,
  /** F6 资料库 / 资料页 / 字段管理（2026-10-25）。 */
  ...profileField,
  ...profileLibrary,
  /** F6 证书资质编辑槽（2026-10-25 从补充事实文案迁移，R-70）。 */
  ...credentials,
  /**
   * 补充事实（已退役）的旧键：**临时兼容注册**。
   *
   * F6-C 已解除生产挂载/入口，但 features/profile-facts/** 的源码与测试仍在 tsconfig 内
   * （物理删除/回收站需单独授权）。保留本注册只为让该目录在迁移窗口内通过 tsc；
   * 删除 facts 目录时必须同时删掉这一行 import 与 spread（Lead 2026-10-25 裁决 B）。
   * 新代码禁止使用 profileFacts.* 任何 key。
   */
  ...profileFacts,
  /** 旧前缀兼容别名（临时；facts 目录删除时一并删除，见 zh-CN.profileFactsLegacy.ts）。 */
  ...profileFactsLegacy,
  /** 网申资料目录使用稳定分组 ID；这里是分组显示名。 */
  ...webformGroups,
  ...webformFields,
  ...settingsPage,
  ...exportPanel,
  ...resumeEditor,
  ...trash,
  ...reminder,
  ...materials,
  ...applyQueue,
  ...claimForm,
  ...skills,
  ...toolCalls,
  ...datasets,
  ...jobImport,
  ...update,
  ...riskPanel,
  ...interview,
  ...materialForm,
  ...jobMatch,
  ...jobDetail,
  ...drill,
  ...reminderItem,
  ...fieldPath,
  ...applyProgress,
  ...collectFilters,
  ...llmRecord,
  /** 个人资料「教育经历」分区（2026-10-27）。 */
  ...educationSection,
  /** 岗位列表表格与行操作（2026-10-27）。 */
  ...jobTable,
  /** 岗位需求解读弹窗（2026-10-27）。 */
  ...jobAnalysis,
  /** 导入参考模板弹窗（2026-10-27）。 */
  ...templateImport,
  /** 网申填充记录面板（2026-10-27）。 */
  ...webFormRecords,
  /** 事实台账页（2026-10-27）。 */
  ...claimsPage,
  /** 投递专用浏览器状态条（2026-10-27）。 */
  ...browserStatus,
  /** 求职进度记录表单（2026-10-27）。 */
  ...trackerForm,
  /** 面经知识库面板（2026-10-27）。 */
  ...interviewExperience,
  /** 岗位批量适配度分析面板（2026-10-27）。 */
  ...jobMatchBatch,
  /** 求职助手输入区（2026-10-27）。 */
  ...assistantComposer,
  /** 网申填表页（2026-10-27）。 */
  ...webFormPage,
  /** 「本次采集结果」面板（2026-10-27）。 */
  ...collectResult,
  /** 网申资料里沿用 UserProfile 的旧字段（2026-10-27）。 */
  ...webFormLegacy,
  /** AI 润色浮层卡片（2026-10-27）。 */
  ...aiPolish,
  /** 投递队列「直接加入队列」的聚合账目（2026-10-27）。 */
  ...bulkEnqueue,
  /** 投递设置弹窗（2026-10-27）。 */
  ...applySettings,
  /** 设置页「联网搜索」卡片（2026-10-27）。 */
  ...searchCard,
  /** 面试复盘面板（2026-10-27）。 */
  ...interviewReview,
  /** 岗位化修改建议弹窗（2026-10-27）。 */
  ...resumeSuggestions,
  /** 设置页「手动备份」卡片（2026-10-27）。 */
  ...manualBackups,
  /** 设置页「存储占用」卡片（2026-10-27）。 */
  ...storageStats,
  /** 内推表单字段与图片备注上传（2026-10-27）。 */
  ...referralForm,
  /** 求职进度页（2026-10-27）。 */
  ...trackerPage,
  ...drillSession,
  ...shortcutSettings,
  /** 首页快捷入口卡（2026-10-27）。 */
  ...shortcutsCard,
  /** 页头后台任务指示器（2026-10-27）。 */
  ...backgroundTasks,
  /** 经历参考资料字段（2026-10-27）。 */
  ...referenceFile,
  /** 知识库条目编辑弹窗（2026-10-27）。 */
  ...knowledgeForm,
  /** 岗位新增/编辑弹窗与字段（2026-10-27）。 */
  ...jobForm,
  /** 投递记录面板（2026-10-27）。 */
  ...applyRecords,
  /** 简历照片面板（2026-10-27）。 */
  ...profilePhoto,
  /** 收藏夹页（2026-10-27）。 */
  ...favorites,
  /** ATS 检测面板（2026-10-27）。 */
  ...atsCheck,
  /** 模型高级参数（2026-10-27）。 */
  ...advancedParams,
  ...appHeader,
  ...backupStatus,
  ...claimCard,
  ...claimDraftModal,
  ...gallery,
  ...generate,
  ...globalFileDrop,
  ...jobMatchBatchResult,
  ...jobs,
  ...knowledgePage,
  ...liveModeCard,
  ...llmConfigCard,
  ...llmRecordView,
  ...profileTextModal,
  ...questionBankPanel,
  ...referralDetail,
  ...resume,
  ...resumeChangeReview,
  ...resumeDeliveryInfo,
  ...resumeFieldDiffView,
  ...resumes,
  ...resumesPage,
  ...sections,
  ...styleTemplateEditor,
  ...trackerImport,
  ...writing,
  ...activationUi,
  ...analyticsPage,
  ...analyticsUi,
  ...apiErrors,
  ...appConfig,
  ...applyCollect,
  ...applyUi,
  ...assistantHooks,
  ...assistantUi,
  ...componentsMisc,
  ...componentsMisc2,
  ...dateFields,
  ...featuresMisc,
  ...fileUtils,
  ...generateStages,
  ...globalSearch,
  ...homePage,
  ...hooksUi,
  ...interviewPage,
  ...jobsCandidate,
  ...jobsForm,
  ...jobsPage,
  ...jobsUi,
  ...llmUi,
  ...navigation,
  ...pagesMisc,
  ...profileUi,
  ...referralUi,
  ...settingsDatasets,
  ...settingsUi,
  ...templatesUi,
  ...touTou,
  ...trackerUi,
  ...userGuide,
  ...userGuideFlow,
  ...enumsApply,
  ...enumsAssistant,
  ...enumsClaims,
  ...enumsDrill,
  ...enumsInterview,
  ...enumsJobs,
  ...enumsKnowledge,
  ...enumsReferral,
  ...enumsResumeCatalog,
  ...enumsTracker,
} as const;

export default namespaces;
