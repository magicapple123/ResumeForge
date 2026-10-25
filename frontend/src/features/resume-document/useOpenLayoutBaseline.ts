// SPDX-License-Identifier: Apache-2.0
/**
 * 「打开制作台那一刻」的版式基线：左栏每个参数右侧那颗 ↺ 恢复的就是它。
 *
 * 与"随模板"（删掉覆盖、回到模板默认）是**两件事**：用户要的是"我刚才调坏了，退回我进来时
 * 看到的那个样子"。所以这里存着一份完整 layout，且在每次打开时重取（保存后再打开，基线就是
 * 保存后的那一版）。
 *
 * 从 `ResumeZoomModal` 拆出的原因只有行数预算（外壳同时装所有挂载点）；状态机逐字未改。
 */
import { useState } from "react";
import type { ResumeLayout } from "../../types/resume";

export function useOpenLayoutBaseline(open: boolean, layout?: ResumeLayout): ResumeLayout | null {
  const [baseline, setBaseline] = useState<ResumeLayout | null>(layout ?? null);
  const [previousOpen, setPreviousOpen] = useState(open);
  if (previousOpen !== open) {
    setPreviousOpen(open);
    if (open) setBaseline(layout ?? null);
  }
  return baseline;
}
