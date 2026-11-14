// SPDX-License-Identifier: Apache-2.0
/**
 * 行内格式的两种"接线"（F22）：
 *
 * - `registerInlineMarkField`：输入框的 `onFocus` 处理器——把它登记成"最近聚焦的编辑目标"；
 * - `useInlineMarkRange`：给工具条/右键菜单提供"最近一次非空选区"的读取器。
 *
 * 监听本身住在 `lastFocusedTextarea` 的注册表里（登记时挂一次 `select/keyup/mouseup`），
 * 所以这里不再各挂一遍：六个输入框只需要一个 `onFocus`，
 * 而不是每个都写四条 `useEffect`。
 */
import { useCallback } from "react";
import type { FocusEvent } from "react";
import type { InlineRange } from "../layout/inlineMarks";
import { getRememberedRange, markFocusedField } from "./lastFocusedTextarea";

/** `onFocus` 处理器：任意 `Input` / `Input.TextArea` 都能直接挂。 */
export function registerInlineMarkField(
  event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
): void {
  markFocusedField(event.currentTarget);
}

export interface InlineMarkRangeReader {
  /** 最近一次非空选区；没有 = 按实时选区/光标处理。 */
  getRange: () => InlineRange | null;
}

export function useInlineMarkRange(): InlineMarkRangeReader {
  const getRange = useCallback(() => getRememberedRange(), []);
  return { getRange };
}
