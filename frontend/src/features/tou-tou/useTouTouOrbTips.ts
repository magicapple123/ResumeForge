// SPDX-License-Identifier: Apache-2.0
/** 投投悬浮球的标语轮换：首次出现（5s）、周期轮换（120s）与可见性派生。 */

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { clearTimer } from "./touTouOrbConstants";
import { TOU_TOU_TIPS } from "./touTouTips";
import type { TouTouStatus } from "./touTouTypes";

interface Options {
  enabled: boolean;
  tipsEnabled: boolean;
  hidden: boolean;
  dragging: boolean;
  isBusy: boolean;
  hasProfilePrompt: boolean;
  hiddenRef: RefObject<boolean>;
  draggingRef: RefObject<boolean>;
  isBusyRef: RefObject<boolean>;
  profilePromptRef: RefObject<boolean>;
  visualStatusRef: RefObject<TouTouStatus>;
  tipTimerRef: RefObject<number | null>;
  tipHideTimerRef: RefObject<number | null>;
  setTipVisible: (visible: boolean) => void;
  setTipIndex: Dispatch<SetStateAction<number>>;
}

export function useTouTouOrbTips({
  enabled,
  tipsEnabled,
  hidden,
  dragging,
  isBusy,
  hasProfilePrompt,
  hiddenRef,
  draggingRef,
  isBusyRef,
  profilePromptRef,
  visualStatusRef,
  tipTimerRef,
  tipHideTimerRef,
  setTipVisible,
  setTipIndex,
}: Options) {
  useEffect(() => {
    // 标语开关独立于球开关：关掉后不再弹新标语，已显示的立即收起；
    // 重新开启后 5s / 120s 的周期自然恢复，无需刷新页面。
    //
    // 依赖只留真正的开关（context.enabled/tipsEnabled）：hidden/dragging/isBusy/
    // visualStatus 是"到点了再看"的瞬态条件，放进依赖会让表情每次变化都拆掉
    // 重建 120s interval 并重排 5s 的首次出现——频繁互动时标语出现频率远高于
    // 设计值。回调里改读 ref 镜像，取到的一定是最新值。
    if (!enabled || !tipsEnabled) return;
    const showTip = () => {
      if (
        hiddenRef.current ||
        draggingRef.current ||
        isBusyRef.current ||
        profilePromptRef.current ||
        visualStatusRef.current !== "idle"
      )
        return;
      setTipVisible(true);
      clearTimer(tipHideTimerRef);
      tipHideTimerRef.current = window.setTimeout(() => setTipVisible(false), 8_000);
    };
    tipTimerRef.current = window.setTimeout(showTip, 5_000);
    const interval = window.setInterval(() => {
      setTipIndex((current) => (current + 1) % TOU_TOU_TIPS.length);
      showTip();
    }, 120_000);
    return () => {
      clearTimer(tipTimerRef);
      window.clearInterval(interval);
      clearTimer(tipHideTimerRef);
    };
  }, [
    draggingRef,
    enabled,
    hiddenRef,
    isBusyRef,
    profilePromptRef,
    setTipIndex,
    setTipVisible,
    tipHideTimerRef,
    tipTimerRef,
    tipsEnabled,
    visualStatusRef,
  ]);

  // 标语可见性是多个瞬态条件的派生函数：任何条件成立都要立即藏起标语。
  // 提示卡在场也算一条：它和标语抢同一块地方（见 profilePromptRef 的说明）。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (hidden || dragging || isBusy || hasProfilePrompt || !tipsEnabled) {
      setTipVisible(false);
    }
  }, [tipsEnabled, dragging, hasProfilePrompt, hidden, isBusy, setTipVisible]);
  /* eslint-enable react-hooks/set-state-in-effect */
}
