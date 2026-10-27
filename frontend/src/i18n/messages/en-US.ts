// SPDX-License-Identifier: Apache-2.0
// Static pack only. Runtime registration and UI switching belong to stage 1.
import type { ZhCNMessages } from "./zh-CN";
import assets from "./en-US.assets";
import bilingual from "./en-US.bilingual";
import careerScenarios from "./en-US.careerScenarios";
import conflict from "./en-US.conflict";
import common from "./en-US.common";
import core from "./en-US.core";
import credentials from "./en-US.credentials";
import delivery from "./en-US.delivery";
import fontDownload from "./en-US.fontDownload";
import fonts from "./en-US.fonts";
import optimizer from "./en-US.optimizer";
import outline from "./en-US.outline";
import pagination from "./en-US.pagination";
import params from "./en-US.params";
import preflight from "./en-US.preflight";
import preview from "./en-US.preview";
import profileFacts from "./en-US.profileFacts";
import profileFactsLegacy from "./en-US.profileFactsLegacy";
import profileGroups from "./en-US.profileGroups";
import profileLibrary from "./en-US.profileLibrary";
import provenance from "./en-US.provenance";
import proview from "./en-US.proview";
import research from "./en-US.research";
import responsive from "./en-US.responsive";
import review from "./en-US.review";
import rich from "./en-US.rich";
import trial from "./en-US.trial";
import typography from "./en-US.typography";
import versions from "./en-US.versions";
import workbench from "./en-US.workbench";
import webformGroups from "./en-US.webformGroups";
import webformFields from "./en-US.webformFields";
import settingsPage from "./en-US.settingsPage";
import exportPanel from "./en-US.exportPanel";
import resumeEditor from "./en-US.resumeEditor";
import trash from "./en-US.trash";
import reminder from "./en-US.reminder";
import materials from "./en-US.materials";
import applyQueue from "./en-US.applyQueue";
import claimForm from "./en-US.claimForm";
import skills from "./en-US.skills";
import toolCalls from "./en-US.toolCalls";
import datasets from "./en-US.datasets";
import jobImport from "./en-US.jobImport";
import update from "./en-US.update";
import riskPanel from "./en-US.riskPanel";
import interview from "./en-US.interview";
import materialForm from "./en-US.materialForm";
import jobMatch from "./en-US.jobMatch";
import jobDetail from "./en-US.jobDetail";
import drill from "./en-US.drill";
import reminderItem from "./en-US.reminderItem";
import fieldPath from "./en-US.fieldPath";
import applyProgress from "./en-US.applyProgress";
import collectFilters from "./en-US.collectFilters";
import llmRecord from "./en-US.llmRecord";
import educationSection from "./en-US.educationSection";
import jobTable from "./en-US.jobTable";
import jobAnalysis from "./en-US.jobAnalysis";
import templateImport from "./en-US.templateImport";
import webFormRecords from "./en-US.webFormRecords";
import claimsPage from "./en-US.claimsPage";
import browserStatus from "./en-US.browserStatus";
import trackerForm from "./en-US.trackerForm";
import interviewExperience from "./en-US.interviewExperience";
import jobMatchBatch from "./en-US.jobMatchBatch";
import assistantComposer from "./en-US.assistantComposer";
import webFormPage from "./en-US.webFormPage";
import collectResult from "./en-US.collectResult";
import webFormLegacy from "./en-US.webFormLegacy";
import aiPolish from "./en-US.aiPolish";
import bulkEnqueue from "./en-US.bulkEnqueue";
import applySettings from "./en-US.applySettings";
import searchCard from "./en-US.searchCard";
import interviewReview from "./en-US.interviewReview";
import resumeSuggestions from "./en-US.resumeSuggestions";
import manualBackups from "./en-US.manualBackups";
import storageStats from "./en-US.storageStats";
import referralForm from "./en-US.referralForm";
import trackerPage from "./en-US.trackerPage";
import drillSession from "./en-US.drillSession";
import shortcutSettings from "./en-US.shortcutSettings";
import shortcutsCard from "./en-US.shortcutsCard";
import backgroundTasks from "./en-US.backgroundTasks";
import referenceFile from "./en-US.referenceFile";
import knowledgeForm from "./en-US.knowledgeForm";
import jobForm from "./en-US.jobForm";
import applyRecords from "./en-US.applyRecords";
import profilePhoto from "./en-US.profilePhoto";
import favorites from "./en-US.favorites";
import atsCheck from "./en-US.atsCheck";
import advancedParams from "./en-US.advancedParams";
import appHeader from "./en-US.appHeader";
import backupStatus from "./en-US.backupStatus";
import claimCard from "./en-US.claimCard";
import claimDraftModal from "./en-US.claimDraftModal";
import gallery from "./en-US.gallery";
import generate from "./en-US.generate";
import globalFileDrop from "./en-US.globalFileDrop";
import jobMatchBatchResult from "./en-US.jobMatchBatchResult";
import jobs from "./en-US.jobs";
import knowledgePage from "./en-US.knowledgePage";
import liveModeCard from "./en-US.liveModeCard";
import llmConfigCard from "./en-US.llmConfigCard";
import llmRecordView from "./en-US.llmRecordView";
import profileTextModal from "./en-US.profileTextModal";
import questionBankPanel from "./en-US.questionBankPanel";
import referralDetail from "./en-US.referralDetail";
import resume from "./en-US.resume";
import resumeChangeReview from "./en-US.resumeChangeReview";
import resumeDeliveryInfo from "./en-US.resumeDeliveryInfo";
import resumeFieldDiffView from "./en-US.resumeFieldDiffView";
import resumes from "./en-US.resumes";
import resumesPage from "./en-US.resumesPage";
import sections from "./en-US.sections";
import styleTemplateEditor from "./en-US.styleTemplateEditor";
import trackerImport from "./en-US.trackerImport";
import writing from "./en-US.writing";
import activationUi from "./en-US.activationUi";
import analyticsPage from "./en-US.analyticsPage";
import analyticsUi from "./en-US.analyticsUi";
import apiErrors from "./en-US.apiErrors";
import appConfig from "./en-US.appConfig";
import applyCollect from "./en-US.applyCollect";
import applyUi from "./en-US.applyUi";
import assistantHooks from "./en-US.assistantHooks";
import assistantUi from "./en-US.assistantUi";
import componentsMisc from "./en-US.componentsMisc";
import componentsMisc2 from "./en-US.componentsMisc2";
import dateFields from "./en-US.dateFields";
import featuresMisc from "./en-US.featuresMisc";
import fileUtils from "./en-US.fileUtils";
import generateStages from "./en-US.generateStages";
import globalSearch from "./en-US.globalSearch";
import homePage from "./en-US.homePage";
import hooksUi from "./en-US.hooksUi";
import interviewPage from "./en-US.interviewPage";
import jobsCandidate from "./en-US.jobsCandidate";
import jobsForm from "./en-US.jobsForm";
import jobsPage from "./en-US.jobsPage";
import jobsUi from "./en-US.jobsUi";
import llmUi from "./en-US.llmUi";
import navigation from "./en-US.navigation";
import pagesMisc from "./en-US.pagesMisc";
import profileUi from "./en-US.profileUi";
import referralUi from "./en-US.referralUi";
import settingsDatasets from "./en-US.settingsDatasets";
import settingsUi from "./en-US.settingsUi";
import templatesUi from "./en-US.templatesUi";
import touTou from "./en-US.touTou";
import trackerUi from "./en-US.trackerUi";
import userGuide from "./en-US.userGuide";
import userGuideFlow from "./en-US.userGuideFlow";

const enUS = {
  ...core,
  ...assets,
  ...bilingual,
  ...careerScenarios,
  ...conflict,
  ...common,
  ...credentials,
  ...delivery,
  ...fontDownload,
  ...fonts,
  ...optimizer,
  ...outline,
  ...pagination,
  ...params,
  ...preflight,
  ...preview,
  ...profileFacts,
  ...profileFactsLegacy,
  ...profileGroups,
  ...profileLibrary,
  ...provenance,
  ...proview,
  ...research,
  ...responsive,
  ...review,
  ...rich,
  ...trial,
  ...typography,
  ...versions,
  ...workbench,
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
  ...educationSection,
  ...jobTable,
  ...jobAnalysis,
  ...templateImport,
  ...webFormRecords,
  ...claimsPage,
  ...browserStatus,
  ...trackerForm,
  ...interviewExperience,
  ...jobMatchBatch,
  ...assistantComposer,
  ...webFormPage,
  ...collectResult,
  ...webFormLegacy,
  ...aiPolish,
  ...bulkEnqueue,
  ...applySettings,
  ...searchCard,
  ...interviewReview,
  ...resumeSuggestions,
  ...manualBackups,
  ...storageStats,
  ...referralForm,
  ...trackerPage,
  ...drillSession,
  ...shortcutSettings,
  ...shortcutsCard,
  ...backgroundTasks,
  ...referenceFile,
  ...knowledgeForm,
  ...jobForm,
  ...applyRecords,
  ...profilePhoto,
  ...favorites,
  ...atsCheck,
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
} as const satisfies Record<keyof ZhCNMessages, string>;

export default enUS;
