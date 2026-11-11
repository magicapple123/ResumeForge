// SPDX-License-Identifier: Apache-2.0
/** 投投悬浮球：全局助手入口、拖拽吸附、贴边收纳与低打扰小贴士。 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTouTou } from "./touTouContext";
import type { TouTouStatus } from "./touTouTypes";
import TouTouTip from "./TouTouTip";
import TouTouSaveCard from "./TouTouSaveCard";
import TouTouProfilePromptCard from "./TouTouProfilePromptCard";
import TouTouActionPanel from "./TouTouActionPanel";
import TouTouProposalCard from "./TouTouProposalCard";
import TouTouSelectionMenu from "./TouTouSelectionMenu";
import { faceKeyFor } from "./touTouFaces";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { useTouTouOrbDrag } from "./useTouTouOrbDrag";
import { useTouTouOrbBlink } from "./useTouTouOrbBlink";
import { useTouTouOrbFeatures } from "./useTouTouOrbFeatures";
import { useTouTouOrbPet } from "./useTouTouOrbPet";
import { TouTouOrbButton } from "./TouTouOrbButton";
import {
  ASSISTANT_OWNED_STATUSES,
  CURIOUS_MS,
  DONE_MS,
  DOUBLE_CLICK_WINDOW_MS,
  HIDE_AFTER_MS,
  SLEEP_AFTER_MS,
  clearTimer,
} from "./touTouOrbConstants";
import {
  getProfileEditControl,
  getProfileSaveControl,
  subscribeProfileEditControl,
  subscribeProfileSaveControl,
} from "./profileSaveBridge";
import "./tou-tou.css";
import "./tou-tou-accessibility.css";

export interface TouTouOrbProps {
  isWebform?: boolean;
  onOpen?: () => void;
  /** 双击悬浮球时打开剪贴板；未传时双击退化为两次单击（各开一次助手）。 */
  onOpenClipboard?: () => void;
  status?: TouTouStatus;
}

export default function TouTouOrb({
  isWebform = false,
  onOpen,
  onOpenClipboard,
  status: statusProp,
}: TouTouOrbProps) {
  const context = useTouTou();
  const externalStatus = statusProp ?? context.status;
  const prefersReducedMotion = usePrefersReducedMotion();
  // 出场先"好奇"一下，别一上来就是一张平静的脸。
  const [visualStatus, setVisualStatus] = useState<TouTouStatus>(
    externalStatus === "idle" || externalStatus === "curious" ? "curious" : externalStatus,
  );
  const [hidden, setHidden] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [petted, setPetted] = useState(false);
  const [pressed, setPressed] = useState(false);
  const statusTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const sleepTimerRef = useRef<number | null>(null);
  const statusSyncedRef = useRef(false);
  /** 上一次激活（单击落点）的时间戳，配合定时器区分单击与双击。 */
  const lastActivateRef = useRef(0);
  const singleOpenTimerRef = useRef<number | null>(null);

  const isBusy =
    externalStatus === "thinking" ||
    externalStatus === "error" ||
    visualStatus === "thinking" ||
    visualStatus === "done" ||
    visualStatus === "error";

  const isBusyRef = useRef(isBusy);
  const visualStatusRef = useRef(visualStatus);
  // 标语轮换 effect 只留开关依赖，瞬态条件经 ref 镜像在回调里读取。
  // ref 写入放 effect（Compiler 禁止渲染期写 ref）：这些镜像只在定时回调里被读。
  useEffect(() => {
    isBusyRef.current = isBusy;
    visualStatusRef.current = visualStatus;
  });

  /** 「好奇」是过渡态：到点自己回到正常，别一直瞪着。 */
  const scheduleIdle = useCallback((delay: number) => {
    clearTimer(statusTimerRef);
    statusTimerRef.current = window.setTimeout(() => {
      statusTimerRef.current = null;
      // 思考 / 出错必须保持到助手自己改口；`done` 到点就该回落。
      const current = visualStatusRef.current;
      if (current === "thinking" || current === "error") return;
      setVisualStatus("idle");
    }, delay);
  }, []);

  /**
   * 本地小动作（拖拽、松手回弹）请求换表情。
   *
   * 助手正在思考 / 刚完成 / 出错时一律不接：拖动一下就把思考脸顶掉、而且不会恢复，
   * 是这个组件之前的真实缺陷。`scheduleIdle` 不走这道闸——它正是把 `done` 收回
   * `idle` 的那条路。
   */
  const requestVisualStatus = useCallback((status: TouTouStatus) => {
    if (
      (status === "idle" || status === "curious") &&
      ASSISTANT_OWNED_STATUSES.has(visualStatusRef.current)
    ) {
      return;
    }
    setVisualStatus(status);
  }, []);

  useEffect(() => {
    if (visualStatus !== "curious") return;
    if (externalStatus !== "idle" && externalStatus !== "curious") return;
    const initialTimer = window.setTimeout(() => setVisualStatus("idle"), CURIOUS_MS);
    return () => window.clearTimeout(initialTimer);
  }, [externalStatus, visualStatus]);

  useEffect(() => {
    if (!statusSyncedRef.current) {
      statusSyncedRef.current = true;
      return;
    }
    clearTimer(statusTimerRef);
    // 表情状态机：随外部状态切换可视表情并调度回 idle 定时器——定时器副作用与
    // 状态迁移在此耦合，拆开反而引入中间态。按书面理由豁免 Compiler 规则。
    /* eslint-disable react-hooks/set-state-in-effect */
    if (externalStatus === "done") {
      setVisualStatus("done");
      scheduleIdle(DONE_MS);
      return;
    }
    if (
      externalStatus === "thinking" ||
      externalStatus === "error" ||
      externalStatus === "sleep" ||
      externalStatus === "curious"
    ) {
      setVisualStatus(externalStatus);
      return;
    }
    setVisualStatus("idle");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [externalStatus, scheduleIdle]);

  const scheduleInactivity = useCallback(() => {
    clearTimer(hideTimerRef);
    clearTimer(sleepTimerRef);
    if (!context.enabled || isBusyRef.current) return;
    hideTimerRef.current = window.setTimeout(() => setHidden(true), HIDE_AFTER_MS);
    sleepTimerRef.current = window.setTimeout(() => setVisualStatus("sleep"), SLEEP_AFTER_MS);
  }, [context.enabled]);

  const resetInactivity = useCallback(() => {
    clearTimer(hideTimerRef);
    clearTimer(sleepTimerRef);
    setHidden(false);
    if (visualStatusRef.current === "sleep" && !isBusyRef.current) setVisualStatus("idle");
    scheduleInactivity();
  }, [scheduleInactivity]);

  // 忙碌态直接显示并取消隐藏/休眠定时器；空闲态调度休眠。定时器副作用与状态
  // 迁移耦合，按书面理由豁免 Compiler 规则。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isBusy) {
      clearTimer(hideTimerRef);
      clearTimer(sleepTimerRef);
      setHidden(false);
    } else {
      scheduleInactivity();
    }
    return () => {
      clearTimer(hideTimerRef);
      clearTimer(sleepTimerRef);
    };
  }, [isBusy, scheduleInactivity]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const wake = useCallback(() => {
    resetInactivity();
  }, [resetInactivity]);

  const { handlePetStroke } = useTouTouOrbPet({ isBusyRef, setPetted });

  const { buttonRef, dragging, handlePointerDown, position, shellStyle, suppressClickRef } =
    useTouTouOrbDrag({ scheduleIdle, setVisualStatus: requestVisualStatus, wake });
  const draggingRef = useRef(dragging);
  useEffect(() => {
    draggingRef.current = dragging;
  });

  /**
   * 简历资料编辑页的「保存资料 / 取消」控制块（profileSaveBridge）。
   * 页面在表单变脏时 set，保存/取消后清空；有值才在球正上方渲染小卡。
   */
  const profileSaveControl = useSyncExternalStore(
    subscribeProfileSaveControl,
    getProfileSaveControl,
  );

  /**
   * 「我的资料」的「去改资料」提示卡控制块（同一个 bridge 的另一个槽）。
   * 页面在「已加载 + 非编辑 + 本次进入还没关掉」时 set；有值才在球旁渲染提示卡。
   *
   * 「提示标语」开关是球上主动提示的总开关（设置里也是这么写的），所以关掉后这张卡
   * 一并闭嘴——页面侧不需要知道这个开关。
   */
  const profileEditControl = useSyncExternalStore(
    subscribeProfileEditControl,
    getProfileEditControl,
  );
  const profilePromptControl = context.tipsEnabled ? profileEditControl : null;
  // 提示卡在场时压掉信号气泡：两者都贴在球的正上方，底边吸附时更是同一竖带，
  // 而气泡层级更高且可点——不压掉就会盖住卡片、吃掉它的按钮。
  const hasProfilePrompt = profilePromptControl !== null;

  useTouTouOrbBlink({ prefersReducedMotion, hidden, dragging, visualStatus, setBlinking });

  useEffect(() => {
    context.setEdge(position.side);
  }, [context, position.side]);

  /**
   * #27 六项的编排：页面上下文、信号 pulse、中断预算气泡、划词动作、动作面板、
   * 侧问与提案卡。逻辑全在 hook 里（本文件只剩渲染与拖拽/表情状态机）。
   */
  const features = useTouTouOrbFeatures({
    enabled: context.enabled,
    tipsEnabled: context.tipsEnabled,
    suppressAnnouncement: hasProfilePrompt,
    onOpenAssistant: onOpen,
    onOpenClipboard,
  });
  // 长按与拖拽共用一个 pointerdown：按下后**移动超过阈值**才算拖、取消长按；
  // 不能用 dragging 状态取消——拖拽 hook 一按下就置 dragging，那会让长按永远不成立。
  const cancelOrbLongPress = features.cancelLongPress;
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);

  const handleActivate = (options: { immediate?: boolean } = {}) => {
    // 长按已经打开了动作面板：松手后的这次 click 不是"单击"，吞掉。
    if (features.consumeLongPress()) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    wake();
    // 点一下先"竖起耳朵"（同时也是清掉粘住的出错脸）。助手正在回答时不动它的表情——
    // 以前这里无条件写 idle，流式途中点一下球，思考脸就没了。
    if (!isBusyRef.current) context.setStatus("curious");
    setPressed(true);
    window.setTimeout(() => setPressed(false), 320);
    // 键盘激活没有"双击"的手势语义，立即打开，不进判窗（无障碍优先）。
    if (options.immediate) {
      lastActivateRef.current = 0;
      clearTimer(singleOpenTimerRef);
      onOpen?.();
      return;
    }
    // 单击开助手、双击开剪贴板：第一次点击先挂起，等双击判窗过去再打开；
    // 第二次点击落进窗口就取消挂起的打开、改开剪贴板。代价是单击有约 280ms
    // 延迟（与按压动画同量级），换来两个入口共享同一颗球。
    const now = Date.now();
    if (now - lastActivateRef.current <= DOUBLE_CLICK_WINDOW_MS) {
      lastActivateRef.current = 0;
      clearTimer(singleOpenTimerRef);
      if (onOpenClipboard) {
        onOpenClipboard();
        return;
      }
      // 没配剪贴板入口时退化为老行为：第二次点击照常打开助手。
      onOpen?.();
      return;
    }
    lastActivateRef.current = now;
    clearTimer(singleOpenTimerRef);
    singleOpenTimerRef.current = window.setTimeout(() => {
      singleOpenTimerRef.current = null;
      onOpen?.();
    }, DOUBLE_CLICK_WINDOW_MS);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handleActivate({ immediate: true });
  };

  useEffect(() => {
    return () => {
      clearTimer(statusTimerRef);
      clearTimer(hideTimerRef);
      clearTimer(sleepTimerRef);
      clearTimer(singleOpenTimerRef);
    };
  }, []);

  if (!context.enabled) return null;

  const classes = [
    "tt-shell",
    `is-edge-${position.side}`,
    isWebform ? "is-webform" : "",
    // 有信号才 pulse（#27B）：没信号的页面球保持原样，不做"会动所以看得见"的噪声。
    features.pulsing ? "has-signals" : "",
  ]
    .filter(Boolean)
    .join(" ");
  // 眨眼借用闭眼素材闪一下；其余时候是状态对应的那张脸。
  // 探头张望（hidden 且没在拖）是**展示层**的选择：换脸不改 visualStatus，
  // 展开（hover/点击）后立即还原助手的表情。睡着时保持睡脸——睡着的探头还是闭眼。
  const activeFace =
    hidden && !dragging
      ? visualStatus === "sleep"
        ? "sleep"
        : "curious"
      : petted && !isBusy
        ? "done"
        : blinking
          ? "sleep"
          : faceKeyFor(visualStatus);

  const buttonClasses = [
    "tt",
    `is-${visualStatus}`,
    hidden ? "is-hidden" : "",
    dragging ? "is-dragging" : "",
    petted && !prefersReducedMotion ? "is-petted" : "",
    pressed ? "is-pressed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} style={shellStyle}>
      {features.tip ? (
        <TouTouTip
          text={features.tip.text}
          params={features.tip.params}
          actionLabel={features.tip.actionLabel}
          onAction={features.tip.onAction}
          muteLabel={features.tip.muteLabel}
          onMute={features.tip.onMute}
          onClose={features.onTipClose}
        />
      ) : null}
      {/* #27A 划词浮条：全局唯一一份，选中文本后原地浮出。 */}
      <TouTouSelectionMenu
        enabled={features.selectionEnabled}
        onAction={features.onSelectionAction}
      />
      {/* #27C 动作面板：只在打开时挂载，内部状态随卸载复位。 */}
      {features.panelProps ? (
        <TouTouActionPanel key={features.panelKey ?? "tt-panel"} {...features.panelProps} />
      ) : null}
      {/* #27F 提案卡：没有提案时自身渲染 null。 */}
      <TouTouProposalCard proposal={features.proposal} onDismiss={features.onProposalDismiss} />
      {/* 卡片自带入场/退场动画，故即使 control 为 null 也要常驻（内部渲染 null）。
          脏状态提示点已从球上挪进卡片标题行，见 TouTouSaveCard。 */}
      <TouTouSaveCard control={profileSaveControl} />
      {/* 同样是常驻挂载（内部渲染 null），退场动画才播得完。 */}
      <TouTouProfilePromptCard control={profilePromptControl} />
      {visualStatus === "sleep" ? (
        // 收纳成细边之后，闭着的眼睛太小了；一个飘着的 Zzz 才看得出"它睡着了"。
        <span className="tt-zzz" aria-hidden="true">
          Zzz
        </span>
      ) : null}
      <TouTouOrbButton
        buttonRef={buttonRef}
        buttonClasses={buttonClasses}
        activeFace={activeFace}
        onPointerDown={(event) => {
          // 长按与拖拽共用 pointerdown：两个都启动，谁先成立谁生效（见 cancelOrbLongPress）。
          longPressOriginRef.current = { x: event.clientX, y: event.clientY };
          features.startLongPress();
          handlePointerDown(event);
        }}
        onPointerMove={(event) => {
          const origin = longPressOriginRef.current;
          if (!origin) return;
          if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 4) {
            // 移动超过 4px = 用户在拖，不是长按。
            longPressOriginRef.current = null;
            cancelOrbLongPress();
          }
        }}
        onPointerUp={() => {
          longPressOriginRef.current = null;
          cancelOrbLongPress();
        }}
        onPointerLeave={cancelOrbLongPress}
        onPointerCancel={cancelOrbLongPress}
        onClick={() => handleActivate()}
        onKeyDown={handleKeyDown}
        onFocus={wake}
        onMouseEnter={wake}
        onMouseMove={handlePetStroke}
      />
    </div>
  );
}
