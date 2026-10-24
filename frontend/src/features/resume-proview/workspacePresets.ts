// SPDX-License-Identifier: Apache-2.0
/**
 * 工作区预设（D14）：内容撰写 / 精细排版 / 投递检查三种面板组合 + 恢复默认。
 *
 * ## 边界（为什么只有"可见性"）
 *
 * 预设切换**不许**碰文档状态：同一份内容、同一份版式、同一份草稿。所以规则层输出的
 * 只有三个布尔（参数栏 / 内容栏 / 画布），画布恒开——任何预设下看不到纸都是错的。
 *
 * ## 持久化
 *
 * 偏好（localStorage）：下次打开继续用。正文草稿仍只走 sessionStorage（见 AGENTS），
 * 这里不碰正文。storage 由调用方注入，纯解析函数可以脱离浏览器测试。
 */
import { useCallback, useState } from "react";
import type { StorageLike } from "./preferences";
import type { WorkspacePanels, WorkspacePresetId } from "./types";

/** 预设键（与 `resume.proview.preferences.v1` 分开：恢复默认布局不该顺手清掉辅助线偏好）。 */
export const WORKSPACE_PRESET_KEY = "resume.proview.workspace.v1";

/** 预设的展示顺序 = 分段控件的选项顺序（默认模式在最左）。 */
export const WORKSPACE_PRESET_IDS: readonly WorkspacePresetId[] = [
  "default",
  "writing",
  "typography",
  "delivery",
];

/** 每个预设下哪些面板可见；画布恒开。 */
const WORKSPACE_PANELS: Record<WorkspacePresetId, WorkspacePanels> = {
  default: { params: true, editor: true, canvas: true },
  writing: { params: false, editor: true, canvas: true },
  typography: { params: true, editor: false, canvas: true },
  delivery: { params: false, editor: false, canvas: true },
};

/** 某个合法预设 id 只接受已知值；旧版本残留 / 手改坏的值一律回默认。 */
export function isWorkspacePresetId(value: unknown): value is WorkspacePresetId {
  return typeof value === "string" && (WORKSPACE_PRESET_IDS as readonly string[]).includes(value);
}

/** 指定预设的面板可见性（返回只读副本，调用方不能改到模块常量）。 */
export function panelsForWorkspace(preset: WorkspacePresetId): WorkspacePanels {
  return { ...WORKSPACE_PANELS[preset] };
}

export function defaultWorkspacePreset(): WorkspacePresetId {
  return "default";
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 读一次持久化预设；坏值回默认。 */
export function readWorkspacePreset(
  storage: StorageLike | null = browserStorage(),
): WorkspacePresetId {
  if (!storage) return defaultWorkspacePreset();
  try {
    const raw = storage.getItem(WORKSPACE_PRESET_KEY);
    return isWorkspacePresetId(raw) ? raw : defaultWorkspacePreset();
  } catch {
    return defaultWorkspacePreset();
  }
}

/** 写一次持久化预设；删存储 = 恢复默认。 */
export function writeWorkspacePreset(
  preset: WorkspacePresetId,
  storage: StorageLike | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    if (preset === "default") storage.removeItem(WORKSPACE_PRESET_KEY);
    else storage.setItem(WORKSPACE_PRESET_KEY, preset);
  } catch {
    // 忽略：偏好存不下不是功能错误。
  }
}

/**
 * 工作区预设状态。
 *
 * `panels` 是给外壳（`ResumeZoomModal`）渲染三栏用的：外壳只读它决定渲染哪几栏，
 * 不复制一份预设规则——规则只有本文件一份。
 */
export function useWorkspacePreset(storage: StorageLike | null = browserStorage()) {
  const [preset, setPresetState] = useState<WorkspacePresetId>(() => readWorkspacePreset(storage));

  const setPreset = useCallback(
    (next: WorkspacePresetId) => {
      setPresetState(next);
      writeWorkspacePreset(next, storage);
    },
    [storage],
  );

  const reset = useCallback(() => {
    setPreset(defaultWorkspacePreset());
    writeWorkspacePreset("default", storage);
  }, [setPreset, storage]);

  return { preset, panels: panelsForWorkspace(preset), setPreset, reset };
}
