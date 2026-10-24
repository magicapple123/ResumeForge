// SPDX-License-Identifier: Apache-2.0
/**
 * W15「专业视图」（proview）的共享类型。
 *
 * 放在 features 下的理由（与 W00 契约 §9.1 的依赖方向一致）：
 * 画布组件（ResumePreview / ResumeWorkbenchLiveCanvas）只做装配，纯规则/纯类型放在
 * feature 层，面板组件消费它——这样「缩放档位怎么算」「预设=哪些面板」都能脱离 React 测试。
 */
import type { MessageKey } from "../../i18n";

/** 缩放口径（D04）：整页 / 适宽 / 100% 逻辑像素。 */
export type ZoomMode = "page" | "width" | "actual";

/** 辅助线开关（D05）。四类互相独立，可以只开一类。 */
export interface GuideFlags {
  margins: boolean;
  columns: boolean;
  baselines: boolean;
  paragraphs: boolean;
}

/** 全关：默认值，也是「恢复默认」时的值。 */
export const NO_GUIDES: GuideFlags = {
  margins: false,
  columns: false,
  baselines: false,
  paragraphs: false,
};

/** 当前开着几类辅助线（按钮读数用）。 */
export function enabledGuideCount(flags: GuideFlags): number {
  return (["margins", "columns", "baselines", "paragraphs"] as const).filter((key) => flags[key])
    .length;
}

/** 至少开了一类：决定要不要往纸面 iframe 里注入覆盖层。 */
export function anyGuideEnabled(flags: GuideFlags): boolean {
  return enabledGuideCount(flags) > 0;
}

/**
 * 命令面板里的一条命令（D13）。
 *
 * `label` / `keywords` 都是**已经 t() 过的文案**：command 层不 import i18n 运行时，
 * 于是纯过滤逻辑可以在测试里用任意字符串验证。
 */
export interface ProviewCommand {
  /** 稳定 id（最近使用记录按它持久化）。 */
  id: string;
  label: string;
  /** 额外可搜索词（同义词、英文、拼音片段都由调用方决定）。 */
  keywords?: string[];
  /** 视觉提示，如 `Ctrl S`；不参与匹配。 */
  shortcut?: string;
  run: () => void;
  /** 暂时不可用（例如只读宿主没有保存入口）：仍可搜索，但执行前被拦下。 */
  unavailable?: boolean;
}

/** 工作区预设（D14）：默认 / 内容撰写 / 精细排版 / 投递检查。 */
export type WorkspacePresetId = "default" | "writing" | "typography" | "delivery";

/**
 * 预设只切**面板可见性**，共用同一份文档状态。
 *
 * `canvas` 恒为真：画布是这一屏的落点，任何预设下都不能消失（否则用户无法看到改动）。
 */
export interface WorkspacePanels {
  params: boolean;
  editor: boolean;
  canvas: true;
}

/** 查看类偏好（localStorage）：辅助线开关与灰度校样。 */
export interface ProviewPreferences {
  guides: GuideFlags;
  proof: boolean;
}

/** 工作区预设的展示文案 key（与 `zh-CN.proview.ts` 一一对应）。 */
export const WORKSPACE_PRESET_LABEL_KEY: Record<WorkspacePresetId, MessageKey> = {
  default: "proview.workspace.default",
  writing: "proview.workspace.writing",
  typography: "proview.workspace.typography",
  delivery: "proview.workspace.delivery",
};
