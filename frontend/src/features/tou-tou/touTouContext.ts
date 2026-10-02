/** 投投运行态上下文；与 Provider 分开，避免热更新把非组件导出当成组件模块。 */

import { createContext, useContext } from "react";
import type { TouTouEdge, TouTouStatus } from "./touTouTypes";

export interface TouTouContextValue {
  enabled: boolean;
  /** 悬浮球是否弹出轮换提示标语；与 `enabled` 分开——关标语不该连助手入口一起关掉。 */
  tipsEnabled: boolean;
  edge: TouTouEdge;
  status: TouTouStatus;
  setEdge: (edge: TouTouEdge) => void;
  setStatus: (status: TouTouStatus) => void;
}

export const defaultTouTouContext: TouTouContextValue = {
  enabled: true,
  tipsEnabled: true,
  edge: "right",
  status: "idle",
  setEdge: () => undefined,
  setStatus: () => undefined,
};

export const TouTouContext = createContext<TouTouContextValue>(defaultTouTouContext);

export function useTouTou(): TouTouContextValue {
  return useContext(TouTouContext);
}
