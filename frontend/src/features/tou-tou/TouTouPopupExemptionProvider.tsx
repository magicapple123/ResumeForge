// SPDX-License-Identifier: Apache-2.0
/**
 * `TouTouPopupExemptionContext` 的 Provider（T11）：包在投投浮窗的子树外面。
 *
 * 本文件只导出组件（与 `TouTouProvider.tsx` 同一惯例）：常量与 hook 在
 * `touTouPopupExemption.ts`，那里是"非组件导出"的家。
 */

import type { ReactNode } from "react";
import { TouTouPopupExemptionContext } from "./touTouPopupExemption";

export interface TouTouPopupExemptionProviderProps {
  children: ReactNode;
  /** 显式关掉（测试与将来"两种形态同树"的场景用）；默认开。 */
  enabled?: boolean;
}

/** 卡片外壳里包一层：其子树内的 `AddMenu` 会给自己的浮层挂豁免标记。 */
export function TouTouPopupExemptionProvider({
  children,
  enabled = true,
}: TouTouPopupExemptionProviderProps) {
  return (
    <TouTouPopupExemptionContext.Provider value={enabled}>
      {children}
    </TouTouPopupExemptionContext.Provider>
  );
}
