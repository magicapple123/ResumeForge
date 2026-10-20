// SPDX-License-Identifier: Apache-2.0
/** 「快速开始」首屏的三条路径卡（数据驱动，便于测试与增删）。
 *
 * 单独成文件而不放进 UserGuideModal：组件文件只导出组件（react-refresh 约定），
 * 文案数据沿用 ``userGuideSteps.ts`` 的口径——lead 2–8 字、text 一句话。
 */
import { ExperimentOutlined, FileTextOutlined, ProfileOutlined } from "@ant-design/icons";
import type { ComponentType } from "react";

export interface QuickStartPath {
  key: "existing-resume" | "from-scratch" | "sample";
  /** 短标题（扫读锚点），2–8 字。 */
  lead: string;
  /** 一句话说明。 */
  text: string;
  /** 目标路由；空串表示走"载入示例数据"既有流程。 */
  path: string;
  icon: ComponentType;
}

export const QUICK_START_PATHS: QuickStartPath[] = [
  {
    key: "existing-resume",
    lead: "我有一份现成简历",
    text: "粘贴或上传 pdf/docx，识别成资料草稿",
    path: "/profile",
    icon: FileTextOutlined,
  },
  {
    key: "from-scratch",
    lead: "从零开始填写",
    text: "手动录入经历，全程不需要模型",
    path: "/profile",
    icon: ProfileOutlined,
  },
  {
    key: "sample",
    lead: "先体验示例数据",
    text: "载入一份完整示例，与你的真实资料相互独立",
    path: "",
    icon: ExperimentOutlined,
  },
];
