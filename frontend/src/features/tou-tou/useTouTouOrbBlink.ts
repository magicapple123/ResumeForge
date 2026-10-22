// SPDX-License-Identifier: Apache-2.0
/** 投投悬浮球的眨眼 effect：只在「正常」状态下偶尔眨一下眼。 */

import { useEffect } from "react";
import { BLINK_MAX_MS, BLINK_MIN_MS, BLINK_MS } from "./touTouOrbConstants";
import type { TouTouStatus } from "./touTouTypes";

interface Options {
  prefersReducedMotion: boolean;
  hidden: boolean;
  dragging: boolean;
  visualStatus: TouTouStatus;
  setBlinking: (blinking: boolean) => void;
}

/**
 * 发呆时偶尔眨一下眼。
 *
 * 眨眼目前**借用睡着的闭眼素材**闪一下（130ms，人眼读作眨眼），有了专门的眨眼
 * 素材后在 `touTouFaces.ts` 里把它指过去即可。只在"正常"状态下眨：思考、出错、
 * 睡着时眨眼没有意义，收纳成细边或正在拖拽时也看不见。
 */
export function useTouTouOrbBlink({
  prefersReducedMotion,
  hidden,
  dragging,
  visualStatus,
  setBlinking,
}: Options) {
  useEffect(() => {
    if (prefersReducedMotion || hidden || dragging || visualStatus !== "idle") return;
    let blinkTimer = 0;
    let openTimer = 0;
    const scheduleBlink = () => {
      const delay = BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
      blinkTimer = window.setTimeout(() => {
        setBlinking(true);
        openTimer = window.setTimeout(() => {
          setBlinking(false);
          scheduleBlink();
        }, BLINK_MS);
      }, delay);
    };
    scheduleBlink();
    return () => {
      window.clearTimeout(blinkTimer);
      window.clearTimeout(openTimer);
      setBlinking(false);
    };
  }, [dragging, hidden, prefersReducedMotion, setBlinking, visualStatus]);
}
