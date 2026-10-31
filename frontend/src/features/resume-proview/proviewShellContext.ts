// SPDX-License-Identifier: Apache-2.0
/**
 * 专业视图宿主能力的 **Context 与读取 hook**（从 ProviewContext.tsx 拆出）。
 *
 * 为什么拆：`ProviewContext.tsx` 只应导出组件（React Fast Refresh 要求组件文件只导出
 * 组件）；把 createContext 与 useProviewConfig 放在这里，provider 组件仍留原文件，
 * 现有 import 路径全部保持可用（类型走 `export type` 转发）。
 */
import { createContext, useContext } from "react";
import type { PhotoCropParams } from "./photoCrop";
import type { ProviewCommand, WorkspacePresetId } from "./types";

/** 照片裁剪能力：宿主存在内容保存链路时才注入。 */
export interface ProviewPhotoConfig {
  /** 原图 data URL（`content.photo`）；空串 = 这份简历没有照片。 */
  photo: string;
  /**
   * 已保存的裁剪参数（未来从 `format_config.photo_crop` 读）。
   * 不传时退回 `photoCropStore` 的会话级桥。
   */
  crop?: PhotoCropParams | null;
  /** 裁剪参数变化（宿主可并入 layout 保存；未接入时由本地桥持久化）。 */
  onCropChange?: (params: PhotoCropParams | null) => void;
  /** 移除照片（走宿主已有的内容保存链路；不传 = 不提供移除按钮）。 */
  onRemovePhoto?: () => void;
}

/** 工作区预设状态：由 shell 持有（面板显隐只有 shell 能改），UI 在这里渲染。 */
export interface ProviewWorkspaceConfig {
  value: WorkspacePresetId;
  onChange: (next: WorkspacePresetId) => void;
  onReset: () => void;
}

/** 宿主注入的能力集合。 */
export interface ProviewShellConfig {
  /** 工作台已有的动作（保存/导出…）：命令面板把它们与内置视图命令合并。 */
  commands?: ProviewCommand[];
  workspace?: ProviewWorkspaceConfig;
  photo?: ProviewPhotoConfig;
  /** 当前简历 id（裁剪参数按简历隔离）。 */
  resumeId?: number;
}

export const ProviewContext = createContext<ProviewShellConfig | null>(null);

/** 读宿主能力；不在 Provider 下返回 `null`（= 专业视图整体不渲染）。 */
export function useProviewConfig(): ProviewShellConfig | null {
  return useContext(ProviewContext);
}
