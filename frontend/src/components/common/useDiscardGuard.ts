// SPDX-License-Identifier: Apache-2.0
/**
 * 关闭语义的分级实现（L0–L3，见 `AGENTS.md` 的「弹层形态与关闭语义」）。
 *
 * 为什么不用 antd 的 `keyboard`：它只会"关"，不会"按分级处理"。所以 Esc 由本 hook 在
 * `document` 上接管，`FormModal` 里固定 `keyboard={false}`——**一个入口一个答案**。
 *
 * 判定顺序（与方案 §3.5 的四级表一一对应）：
 * 1. `submitting` → 忽略（L3）；
 * 2. 已在确认条上 → 回到编辑（L2 的"再按一次 Esc"）；
 * 3. `dirty && !hasDraft` → 出内联确认条，**不关闭**（L2）；
 * 4. 其余（无脏值 / 有草稿）→ 直接关（L0 / L1）。
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface DiscardGuardApi {
  /** 当前是否显示"放弃未保存的修改"内联确认条。 */
  confirming: boolean;
  /** 关闭入口（× / Esc 统一走这里）。 */
  requestClose: () => void;
  /** 确认条上的「放弃修改」。 */
  confirmDiscard: () => void;
  /** 确认条上的「继续编辑」。 */
  keepEditing: () => void;
}

export interface DiscardGuardOptions {
  open: boolean;
  submitting: boolean;
  dirty: boolean;
  /** 有草稿时关闭是无损的，不再询问。 */
  hasDraft: boolean;
  onCancel: () => void;
}

export function useDiscardGuard({
  open,
  submitting,
  dirty,
  hasDraft,
  onCancel,
}: DiscardGuardOptions): DiscardGuardApi {
  const [confirming, setConfirming] = useState(false);

  // Esc 监听只在 open 变化时重挂；其余判据必须读到最新值，否则"改了字再按 Esc"会走旧分支。
  const latest = useRef({ submitting, dirty, hasDraft, onCancel, confirming });
  useEffect(() => {
    latest.current = { submitting, dirty, hasDraft, onCancel, confirming };
  });

  // 关闭后确认条不该留着：下次打开是一张干净的弹窗。
  // 用"渲染期比较上一次的 `open`"来做，而不是 effect：effect 里同步 setState 会多一轮
  // 级联渲染（`react-hooks/set-state-in-effect`），而"入参变了就重置派生状态"正是 React
  // 给这类场景的推荐做法。守卫条件保证它只发生一次，不会自我循环。
  const [lastOpen, setLastOpen] = useState(open);
  if (lastOpen !== open) {
    setLastOpen(open);
    if (!open && confirming) setConfirming(false);
  }

  const keepEditing = useCallback(() => setConfirming(false), []);

  const requestClose = useCallback(() => {
    const state = latest.current;
    if (state.submitting) return;
    if (state.confirming) {
      setConfirming(false);
      return;
    }
    if (state.dirty && !state.hasDraft) {
      setConfirming(true);
      return;
    }
    state.onCancel();
  }, []);

  const confirmDiscard = useCallback(() => {
    setConfirming(false);
    latest.current.onCancel();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      // 下拉/日期面板已接管的那一次 Esc 不算我们要处理的（antd 会 preventDefault）。
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (latest.current.submitting) return;
      requestClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, requestClose]);

  return { confirming, requestClose, confirmDiscard, keepEditing };
}
