// SPDX-License-Identifier: Apache-2.0
/**
 * 技能二级浮出层的键盘操作（#32）：从 `AddMenu.tsx` 抽出来的"焦点搬家"那段逻辑。
 *
 * 抽出来的直接原因是一行数预算（`frontend/src` 单文件 500 行硬闸门）：这段与 UI 结构无关，
 * 独立成 hook 后 `AddMenu.tsx` 只留一行调用。间接好处是四种按键的约定集中在一处——
 * 以前它们和安全细节（`preventDefault` / `stopPropagation`）混在 JSX 里，改一处很容易漏另一处。
 *
 * 四条约定（`AddMenu.test.tsx` 的 flyout 用例守着）：
 * 1. `Enter` / `Space` / `→` 展开；`→` 之后焦点进二级第一项（没有列表项时落搜索框）。
 * 2. 展开态再按 `Enter` / `Space` 收起。**`preventDefault` 是必须的**：不拦的话浏览器还会
 *    补发一次 click，等于开了又关。
 * 3. `Esc` 只收二级并把焦点还给「技能」行。**`stopPropagation` 也是必须的**：antd 的
 *    Dropdown 同样监听 Esc，事件一旦冒到 document 就变成"想收二级、整块面板没了"。
 * 4. `←` 从二级退回行；搜索框里按 `←` 是移光标，不能抢。
 *
 * 焦点归还（`close(restoreFocus)`）不在这里：它属于"二级的开关"而不是"按键"，与悬停收起
 * 共用同一条路径，放在 `AddMenu` 的 `closeSkills` 里才不会出现两套收起义。
 */

import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

/** 二级第一项：列表项的勾选框（技能库非空时）。 */
const FIRST_ITEM = ".assistant-skill-picker-option input";
/** 没有列表项（空技能库 / 搜索无匹配）时退到搜索框或首个按钮。 */
const FIRST_FALLBACK = "input, button";

export interface SkillFlyoutKeyboardOptions {
  /** 浮出层容器：键盘事件源，也是"第一项"的查找范围。 */
  flyoutRef: RefObject<HTMLDivElement | null>;
  /** 二级当前是否展开。 */
  skillsOpen: boolean;
  /** `compact`（投投浮窗）没有浮出层：键盘入口整体不生效，点「技能」仍是整块替换。 */
  enabled: boolean;
  /** 展开二级。 */
  open: () => void;
  /** 收起二级；`restoreFocus` 为 true 时把焦点还给「技能」行。 */
  close: (restoreFocus?: boolean) => void;
}

export interface SkillFlyoutKeyboard {
  /** 挂在「技能」行按钮上。 */
  onRowKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** 挂在浮出层容器上。 */
  onFlyoutKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

/**
 * 技能二级的键盘入口。
 *
 * `open` / `close` 由调用方给（它们是同一份状态的两个出口），本 hook 只管按键判定与焦点搬家。
 */
export function useSkillFlyoutKeyboard({
  flyoutRef,
  skillsOpen,
  enabled,
  open,
  close,
}: SkillFlyoutKeyboardOptions): SkillFlyoutKeyboard {
  /** `→` 展开后要把焦点送进二级第一项：等二级真的挂上 DOM 再找（同一次 commit 里还拿不到）。 */
  const focusFirstPending = useRef(false);

  useEffect(() => {
    if (!skillsOpen || !focusFirstPending.current) return;
    focusFirstPending.current = false;
    const node = flyoutRef.current;
    if (!node) return;
    const target =
      node.querySelector<HTMLElement>(FIRST_ITEM) ??
      node.querySelector<HTMLElement>(FIRST_FALLBACK);
    target?.focus();
  }, [skillsOpen, flyoutRef]);

  const onRowKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!enabled) return;
      if (event.key === "Escape" && skillsOpen) {
        // 只收二级：`stopPropagation` 挡住 antd 对一整块面板的那次关闭（见文件头第 3 条）。
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }
      if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowRight") return;
      // 自己接管 Enter / Space（文件头第 2 条）。
      event.preventDefault();
      if (event.key === "ArrowRight") {
        focusFirstPending.current = true;
        open();
        return;
      }
      if (skillsOpen) close(true);
      else open();
    },
    [enabled, skillsOpen, open, close],
  );

  const onFlyoutKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }
      if (event.key !== "ArrowLeft") return;
      // 搜索框里 `←` 是移光标：不抢。
      if ((event.target as HTMLElement).tagName === "INPUT") return;
      event.preventDefault();
      close(true);
    },
    [close],
  );

  return { onRowKeyDown, onFlyoutKeyDown };
}
