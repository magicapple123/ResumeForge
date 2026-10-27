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
} as const satisfies Record<keyof ZhCNMessages, string>;

export default enUS;
