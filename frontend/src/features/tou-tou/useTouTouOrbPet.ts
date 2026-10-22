// SPDX-License-Identifier: Apache-2.0
/** 投投悬浮球的「抚摸」判定：窗口期内快速划过球面够次数就换上「很舒服」的脸。 */

import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  PET_COUNT,
  PET_HOLD_MS,
  PET_STROKE_MIN_GAP_MS,
  PET_WINDOW_MS,
  clearTimer,
} from "./touTouOrbConstants";

interface Options {
  isBusyRef: RefObject<boolean>;
  setPetted: (petted: boolean) => void;
}

export function useTouTouOrbPet({ isBusyRef, setPetted }: Options) {
  const petTimerRef = useRef<number | null>(null);
  const lastStrokeAtRef = useRef<number | null>(null);
  const strokeCountRef = useRef(0);

  useEffect(() => () => clearTimer(petTimerRef), []);

  /**
   * 被抚摸：窗口期内快速划过球面够次数就换上「很舒服」的脸。
   *
   * 助手忙时（thinking/done/error 归助手所有）不触发——抚摸不能把思考脸顶掉。
   * petted 是**独立 state**，不进标语轮换 effect 的依赖数组，抚摸不会重置或重复
   * 触发标语计时。
   */
  const handlePetStroke = useCallback(() => {
    if (isBusyRef.current) return;
    const now = Date.now();
    const last = lastStrokeAtRef.current;
    lastStrokeAtRef.current = now;
    // 节流：一次划过会触发一串 mousemove，只按间隔 ≥120ms 的"一笔"计数。
    if (last !== null && now - last < PET_STROKE_MIN_GAP_MS) return;
    strokeCountRef.current =
      last !== null && now - last <= PET_WINDOW_MS ? strokeCountRef.current + 1 : 1;
    if (strokeCountRef.current < PET_COUNT) return;
    strokeCountRef.current = 0;
    setPetted(true);
    clearTimer(petTimerRef);
    petTimerRef.current = window.setTimeout(() => setPetted(false), PET_HOLD_MS);
  }, [isBusyRef, setPetted]);

  return { handlePetStroke };
}
