// SPDX-License-Identifier: Apache-2.0
/**
 * 专业视图的**宿主能力注入**（W15）：只有 Provider 组件。
 *
 * 挂载策略（避免让 shell 承担渲染工作）：
 * - 纯 UI（缩放/页导航/辅助线/灰度/命令面板/工作区预设/照片裁剪）由
 *   `components/resume/proview/**` 渲染，挂载点是本团队拥有的
 *   `ResumeWorkbenchLiveCanvas` → `ResumePreview`；
 * - 宿主（`ResumeZoomModal`）只需要通过 `ProviewProvider` 注入**能力与回调**
 *   （保存/导出等命令、工作区预设状态、照片移除通道）。没有注入的能力对应的按钮
 *   一律不渲染——不做"点了没反应"的空按钮。
 *
 * Context 与 `useProviewConfig` 在 `proviewShellContext.ts`（组件文件只导出组件，
 * 否则 React Fast Refresh 会整文件失效）；类型从本文件 `export type` 转发，
 * 既有 `import type { ProviewShellConfig } from ".../ProviewContext"` 不用改。
 */
import type { ReactNode } from "react";
import { ProviewContext } from "./proviewShellContext";
import type { ProviewShellConfig } from "./proviewShellContext";

/** 兼容 re-export：宿主 hook（`useWorkbenchProview`）从这里取命令类型即可，不必再引 types。 */
export type { ProviewCommand } from "./types";
export type {
  ProviewPhotoConfig,
  ProviewShellConfig,
  ProviewWorkspaceConfig,
} from "./proviewShellContext";

/** 只在制作台画布子树里提供；主预览（列表页）不包 Provider，零行为变化。 */
export function ProviewProvider({
  config,
  children,
}: {
  config: ProviewShellConfig;
  children: ReactNode;
}) {
  return <ProviewContext.Provider value={config}>{children}</ProviewContext.Provider>;
}
