// SPDX-License-Identifier: Apache-2.0
/**
 * #8 / #10：字段 chip「单击选中、双击展开」的手势判定。
 *
 * ## 为什么要自己判定，而不是只听 `dblclick`
 *
 * 只依赖浏览器 `dblclick` 有两个已经踩过的问题：
 * 1. 两次按下之间**动了几像素**，浏览器就不发 `dblclick`，但第二下 `click` 照样发——
 *    它会被当成"再点一次"，翻转选中（看起来就是"双击没展开、还把选中取消了"）；
 * 2. 连续第二组双击的 clickCount 是 3/4，Chromium 只在 count=2 时发 `dblclick`，
 *    "已展开后立刻再双击收起"因此收不到任何 dblclick（本轮返工的 ④）。
 *
 * ## 判定规则（默认浏览器行为 + 时间窗兜底）
 *
 * - **detail 为偶数** = 同一次双击手势的第二下（1/2、3/4…），直接按"第二下"消费；
 * - **detail 为奇数且 >1**（3/5/7…）= 紧接着上一组双键的新手势起点：只记录起点状态、
 *   确保选中，不再翻转选中（否则第二组双键会先把选中点掉）；
 * - **detail=1** = 普通单击；但如果和本 chip 上一次单击在 `PAIR_WINDOW_MS` 内（浏览器
 *   因为鼠标微动把连击计数重置成 1 的情形），也按同手势第二下消费。
 * - 第二下的展开目标是**确定值**而不是 toggle：`!pairStartExpanded`。手势开始时本来就
 *   展开 → 第二下保持收起；否则展开。这样"已展开再双击收起"不会被 `select()` 里
 *   无条件清空展开态的逻辑带偏。
 * - 同一手势随后可能还会送来一次 `dblclick`：`pairConsumedRef` 标记让 `dblclick` 只清
 *   标记、不再 toggle（否则展开后又被收起 / 收起后又被弹开）。
 *
 * 单击依旧**立即**选中，不引入"等一下看是不是双击"的延迟。
 */

import { useCallback, useRef } from "react";
import { useDocumentExpand } from "./documentExpandContext";

/**
 * 浏览器双击阈值同量级（Windows 默认 500ms）。只用于兜底"鼠标微动导致 detail 重置为 1"
 * 的情形；正常连击由 detail 的奇偶判定。
 */
const PAIR_WINDOW_MS = 500;

export interface ChipExpandGesture {
  /** 本 chip 是否正在展开（字段编辑器可见）。 */
  expanded: boolean;
  /**
   * `click` 里调用：返回 true 表示这一下已经被当作双击手势的一部分消费（展开/收起或
   * 手势起点），调用方**不要**再翻转选中。
   */
  consumePairSecondClick: (detail: number) => boolean;
  /** `dblclick` 里调用：与 click 判定同一个手势，只生效一次。 */
  handleDoubleClick: () => void;
  /** 键盘 F2：独立手势，不走手势去重。 */
  toggleFromKeyboard: () => void;
  /** Esc 收编辑器用：把展开态设成确定值（null = 全部收起）。 */
  setExpanded: (path: string | null) => void;
}

export function useChipExpandGesture(
  path: string,
  onSelect: (path: string | null) => void,
): ChipExpandGesture {
  const { expandedPath, toggleExpand, setExpanded } = useDocumentExpand();
  // 本 chip 上一次"普通单击"的时间；0 = 上一次点击已经被当成手势第二下消费过。
  const lastClickAtRef = useRef(0);
  // 手势起点（第一下 click 之前）本 chip 是不是已经展开着。
  const pairStartExpandedRef = useRef(false);
  // 本次手势的展开/收起是否已经由 click 处理：随后而来的 dblclick 只清标记。
  const pairConsumedRef = useRef(false);

  const startGesture = useCallback(() => {
    pairStartExpandedRef.current = expandedPath === path;
    pairConsumedRef.current = false;
  }, [expandedPath, path]);

  const applySecondClick = useCallback(() => {
    // 第二下先确保选中：第一下 click 可能刚把选中翻掉（新建页眉字段自动选中后直接双击
    // 就是这条路径），而 `select()` 会清空展开态，所以必须先选中、再设展开。
    onSelect(path);
    setExpanded(pairStartExpandedRef.current ? null : path);
    pairConsumedRef.current = true;
  }, [onSelect, path, setExpanded]);

  const consumePairSecondClick = useCallback(
    (detail: number) => {
      // `fireEvent.click` 没带 detail（=0）时按普通单击处理，保持单测与旧行为一致。
      if (detail <= 0) {
        lastClickAtRef.current = 0;
        startGesture();
        return false;
      }
      const now = Date.now();
      if (detail > 1 && detail % 2 === 0) {
        lastClickAtRef.current = 0;
        applySecondClick();
        return true;
      }
      if (detail > 1) {
        // 连续第二组双击的第一下（count=3/5…）：新手势起点，只确保选中，不翻转。
        lastClickAtRef.current = 0;
        startGesture();
        onSelect(path);
        return true;
      }
      // detail === 1：普通单击；500ms 内同 chip 的上一下才按"同一次双击"兜底。
      if (lastClickAtRef.current && now - lastClickAtRef.current < PAIR_WINDOW_MS) {
        lastClickAtRef.current = 0;
        applySecondClick();
        return true;
      }
      lastClickAtRef.current = now;
      startGesture();
      return false;
    },
    [applySecondClick, onSelect, path, startGesture],
  );

  const handleDoubleClick = useCallback(() => {
    // 已经由 click 判定处理过的同一手势：只清标记，避免"展开后又被收起"。
    if (pairConsumedRef.current) {
      pairConsumedRef.current = false;
      return;
    }
    toggleExpand(path);
  }, [path, toggleExpand]);

  const toggleFromKeyboard = useCallback(() => toggleExpand(path), [path, toggleExpand]);

  return {
    expanded: expandedPath === path,
    consumePairSecondClick,
    handleDoubleClick,
    toggleFromKeyboard,
    setExpanded,
  };
}
