// SPDX-License-Identifier: Apache-2.0
/** 「+」面板里「技能」二级浮出层的状态机（从 AddMenu 拆出，压 500 行预算）。
 *
 * 管理：二级的开合与搜索词、浮出层定位（右侧不足翻到左侧、下方溢出上移、比视口
 * 还高时退回整块替换）、悬停 150ms 展开 / 300ms 收起的计时器、键盘导航接线。
 * 一级面板本身的开合与内容渲染仍在 AddMenu.tsx。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMediaQuery } from "../../../../hooks/useMediaQuery";
import { useSkillFlyoutKeyboard } from "./useSkillFlyoutKeyboard";

/** 悬停多久算"要看"：150ms 足够滤掉路过，又不至于让人觉得没反应。 */
export const SKILL_FLYOUT_OPEN_DELAY_MS = 150;
/** 移出多久才收起：比展开长一倍——斜向移进二级的途中不会闪关。 */
export const SKILL_FLYOUT_CLOSE_DELAY_MS = 300;
/** 二级面板宽度（与 `.composer-add-panel` 同宽）、与一级的间隙、贴视口的最低留白。 */
export const SKILL_FLYOUT_WIDTH = 320;
const SKILL_FLYOUT_GAP = 12;
const SKILL_FLYOUT_EDGE = 12;
/**
 * 矮视口（F35）：<560px 时二级面板在纵向没有余量，浮出层只会盖住输入框。
 * 与窄栏一起参与 `stacked`，走"整块替换一级"——`compact` 分支已经实现了这套形态。
 */
export const SHORT_VIEWPORT_QUERY = "(max-height: 559px)";

interface FlyoutPlacement {
  left: number;
  top: number;
  /** 右侧放不下时翻到一级面板左侧（`::before` 桥也跟着换边）。 */
  flipLeft: boolean;
}

interface Options {
  /** 浮窗形态：没有横向余量，技能二级走"整块替换一级"。 */
  compact: boolean;
  /** 生成中不展开——勾选框全是禁用的。 */
  sending: boolean;
}

export function useAddMenuSkillFlyout({ compact, sending }: Options) {
  /** 二级是否展开：`compact` 下是"整块替换"，其余形态是"右侧浮出"。 */
  const [skillsOpen, setSkillsOpen] = useState(false);
  /** 二级的搜索词（关掉二级就清空，下次从完整列表开始）。 */
  const [skillQuery, setSkillQuery] = useState("");
  const [placement, setPlacement] = useState<FlyoutPlacement | null>(null);
  /** 浮出层本身比视口还高时（F35）：退回"整块替换"，而不是把面板顶出屏幕。 */
  const [stackedByHeight, setStackedByHeight] = useState(false);
  const shortViewport = useMediaQuery(SHORT_VIEWPORT_QUERY);
  /** 整块替换（窄栏 / 浮窗 / 矮视口 / 浮出层放不下）：任何一条成立都不渲染浮出层。 */
  const stacked = compact || shortViewport || stackedByHeight;

  /** 浮出层的定位基准：「技能」行容器（`position: relative`）。 */
  const anchorRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const hoverOpenTimer = useRef<number | null>(null);
  const hoverCloseTimer = useRef<number | null>(null);

  /** 清掉一个悬停计时器（没有就跳过）。 */
  const stopTimer = useCallback((handle: { current: number | null }) => {
    if (handle.current === null) return;
    window.clearTimeout(handle.current);
    handle.current = null;
  }, []);

  /** 收起二级。`restoreFocus` 用于键盘路径：焦点要还给「技能」行，不能掉到 body 上。 */
  const closeSkills = useCallback(
    (restoreFocus = false) => {
      stopTimer(hoverOpenTimer);
      stopTimer(hoverCloseTimer);
      setSkillsOpen(false);
      setSkillQuery("");
      setPlacement(null);
      setStackedByHeight(false);
      if (restoreFocus) {
        anchorRef.current?.querySelector<HTMLButtonElement>(".composer-add-action")?.focus();
      }
    },
    [stopTimer],
  );

  const openSkills = useCallback(() => {
    stopTimer(hoverCloseTimer);
    setSkillsOpen(true);
  }, [stopTimer]);

  // 键盘（Enter / Space / → / ← / Esc）整段在 hook 里：`compact` 没有浮出层，整条入口关掉。
  const { onRowKeyDown, onFlyoutKeyDown } = useSkillFlyoutKeyboard({
    flyoutRef,
    skillsOpen,
    enabled: !stacked,
    open: openSkills,
    close: closeSkills,
  });

  /** 悬停展开：只在浮出形态下排 150ms 计时器。生成中不展开——勾选框全是禁用的。 */
  const scheduleHoverOpen = useCallback(() => {
    if (stacked || sending || skillsOpen) return;
    stopTimer(hoverCloseTimer);
    if (hoverOpenTimer.current !== null) return;
    hoverOpenTimer.current = window.setTimeout(() => {
      hoverOpenTimer.current = null;
      setSkillsOpen(true);
    }, SKILL_FLYOUT_OPEN_DELAY_MS);
  }, [stacked, sending, skillsOpen, stopTimer]);

  /** 指针进到二级时取消"移出收起"计时器（二级是「技能」行的子节点）。 */
  const cancelHoverClose = useCallback(() => stopTimer(hoverCloseTimer), [stopTimer]);

  /** 悬停收起：300ms 的缓冲。二级是「技能」行的子节点，指针进到二级会重新取消这个计时器。 */
  const scheduleHoverClose = useCallback(() => {
    if (stacked || !skillsOpen) return;
    stopTimer(hoverOpenTimer);
    if (hoverCloseTimer.current !== null) return;
    hoverCloseTimer.current = window.setTimeout(() => {
      hoverCloseTimer.current = null;
      closeSkills();
    }, SKILL_FLYOUT_CLOSE_DELAY_MS);
  }, [stacked, skillsOpen, stopTimer, closeSkills]);

  // 卸载时清计时器：面板被 `destroyOnHidden` 收走时，回调不该再碰已卸载的状态。
  useEffect(
    () => () => {
      stopTimer(hoverOpenTimer);
      stopTimer(hoverCloseTimer);
    },
    [stopTimer],
  );

  /**
   * 定位只在展开那一刻测一次：右侧不足 `320 + 12 + 12 = 344`px 翻到左侧，下方溢出则整体
   * 上移贴合视口（`SKILL_FLYOUT_EDGE` 留白）。逐帧测量会跟着动画抖，也会每帧重渲染。
   *
   * F35 补的两条：`top` 有下限（不许越过视口顶，`-overflowBottom` 可以为很大的负数）；
   * 浮出层比视口还高时不浮出，直接切整块替换。
   */
  useLayoutEffect(() => {
    if (!skillsOpen || stacked) {
      setPlacement(null);
      return;
    }
    const anchor = anchorRef.current;
    const flyout = flyoutRef.current;
    if (!anchor || !flyout) return;
    if (flyout.offsetHeight > window.innerHeight - SKILL_FLYOUT_EDGE * 2) {
      setStackedByHeight(true);
      setPlacement(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const rightSpace = window.innerWidth - rect.right;
    const flipLeft = rightSpace < SKILL_FLYOUT_WIDTH + SKILL_FLYOUT_GAP + SKILL_FLYOUT_EDGE;
    const overflowBottom =
      rect.top + flyout.offsetHeight - (window.innerHeight - SKILL_FLYOUT_EDGE);
    const top = Math.min(0, Math.max(SKILL_FLYOUT_EDGE - rect.top, -overflowBottom));
    setPlacement({
      left: flipLeft ? -(SKILL_FLYOUT_WIDTH + SKILL_FLYOUT_GAP) : rect.width + SKILL_FLYOUT_GAP,
      top,
      flipLeft,
    });
  }, [skillsOpen, stacked]);

  return {
    skillsOpen,
    skillQuery,
    setSkillQuery,
    stacked,
    anchorRef,
    flyoutRef,
    placement,
    stopTimer,
    closeSkills,
    openSkills,
    onRowKeyDown,
    onFlyoutKeyDown,
    scheduleHoverOpen,
    scheduleHoverClose,
    cancelHoverClose,
  };
}
