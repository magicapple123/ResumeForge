// SPDX-License-Identifier: Apache-2.0
/** 「快速开始」首屏的三条路径卡（数据驱动，便于测试与增删）。
 *
 * 单独成文件而不放进 UserGuideModal：组件文件只导出组件（react-refresh 约定），
 * 文案在 `userGuide.quickStart.*` 语言包里，口径与 ``userGuideSteps.ts`` 一致——lead 2–8 字、text 一句话。
 */
import { ExperimentOutlined, FileTextOutlined, ProfileOutlined } from "@ant-design/icons";
import type { ComponentType } from "react";
import type { MessageKey } from "../i18n";

export interface QuickStartPath {
  key: "existing-resume" | "from-scratch" | "sample";
  /** 短标题（扫读锚点），2–8 字。 */
  leadKey: MessageKey;
  /** 一句话说明。 */
  textKey: MessageKey;
  /** 目标路由；空串表示走"载入示例数据"既有流程。 */
  path: string;
  icon: ComponentType;
}

export const QUICK_START_PATHS: QuickStartPath[] = [
  {
    key: "existing-resume",
    leadKey: "userGuideFlow.quickStart.existingResume.lead",
    textKey: "userGuideFlow.quickStart.existingResume.text",
    path: "/profile",
    icon: FileTextOutlined,
  },
  {
    key: "from-scratch",
    leadKey: "userGuideFlow.quickStart.fromScratch.lead",
    textKey: "userGuideFlow.quickStart.fromScratch.text",
    path: "/profile",
    icon: ProfileOutlined,
  },
  {
    key: "sample",
    leadKey: "userGuideFlow.quickStart.sample.lead",
    textKey: "userGuideFlow.quickStart.sample.text",
    path: "",
    icon: ExperimentOutlined,
  },
];
