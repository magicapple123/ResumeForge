/** 投投悬浮球：全局助手入口、拖拽吸附、贴边收纳与低打扰小贴士。 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTouTou } from "./touTouContext";
import { TOU_TOU_TIPS } from "./touTouTips";
import type { TouTouStatus } from "./touTouTypes";
import TouTouTip from "./TouTouTip";
import { TOU_TOU_FACE_SOURCES, faceKeyFor } from "./touTouFaces";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { useTouTouOrbDrag } from "./useTouTouOrbDrag";
import "./tou-tou.css";
import "./tou-tou-accessibility.css";

const HIDE_AFTER_MS = 12_000;
const SLEEP_AFTER_MS = 60_000;
const CURIOUS_MS = 1_500;
const DONE_MS = 2_400;
/** 单击 / 双击的判窗：两次激活落在这个间隔内算双击（开剪贴板）。 */
const DOUBLE_CLICK_WINDOW_MS = 280;
/** 发呆时眨眼的间隔（带抖动，免得像节拍器）与眨眼时长。 */
const BLINK_MIN_MS = 6_000;
const BLINK_MAX_MS = 13_000;
const BLINK_MS = 130;
/** 抚摸判定：节流间隔、计数窗口、触发次数与持续时长。 */
const PET_STROKE_MIN_GAP_MS = 120;
const PET_WINDOW_MS = 700;
const PET_COUNT = 3;
const PET_HOLD_MS = 1_500;

/**
 * 助手的表情优先于本地小动作。
 *
 * 拖拽会切到「好奇」，松手 1.5s 后回到「正常」——如果这时助手正在思考或刚出错，
 * 这两个本地动作会把助手的表情顶掉，而且不会再恢复。这三个状态归助手所有。
 */
const ASSISTANT_OWNED_STATUSES: ReadonlySet<TouTouStatus> = new Set(["thinking", "done", "error"]);

function clearTimer(timerRef: { current: number | null }) {
  if (timerRef.current !== null) {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

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
  const [tipVisible, setTipVisible] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const statusTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const sleepTimerRef = useRef<number | null>(null);
  const tipTimerRef = useRef<number | null>(null);
  const tipHideTimerRef = useRef<number | null>(null);
  const petTimerRef = useRef<number | null>(null);
  const lastStrokeAtRef = useRef<number | null>(null);
  const strokeCountRef = useRef(0);
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
  isBusyRef.current = isBusy;
  visualStatusRef.current = visualStatus;

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

  const wake = useCallback(() => {
    resetInactivity();
    setTipVisible(false);
  }, [resetInactivity]);

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
  }, []);

  const { buttonRef, dragging, handlePointerDown, position, shellStyle, suppressClickRef } =
    useTouTouOrbDrag({ scheduleIdle, setVisualStatus: requestVisualStatus, wake });

  /**
   * 发呆时偶尔眨一下眼。
   *
   * 眨眼目前**借用睡着的闭眼素材**闪一下（130ms，人眼读作眨眼），有了专门的眨眼
   * 素材后在 `touTouFaces.ts` 里把它指过去即可。只在"正常"状态下眨：思考、出错、
   * 睡着时眨眼没有意义，收纳成细边或正在拖拽时也看不见。
   */
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
  }, [dragging, hidden, prefersReducedMotion, visualStatus]);

  useEffect(() => {
    context.setEdge(position.side);
  }, [context, position.side]);

  useEffect(() => {
    // 标语开关独立于球开关：关掉后不再弹新标语，已显示的立即收起；
    // 重新开启后 5s / 120s 的周期自然恢复，无需刷新页面。
    if (!context.enabled || !context.tipsEnabled) return;
    const showTip = () => {
      if (hidden || dragging || isBusy || visualStatus !== "idle") return;
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
  }, [context.enabled, context.tipsEnabled, dragging, hidden, isBusy, visualStatus]);

  useEffect(() => {
    if (hidden || dragging || isBusy || !context.tipsEnabled) setTipVisible(false);
  }, [context.tipsEnabled, dragging, hidden, isBusy]);

  const handleActivate = (options: { immediate?: boolean } = {}) => {
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
      clearTimer(tipTimerRef);
      clearTimer(tipHideTimerRef);
      clearTimer(petTimerRef);
      clearTimer(singleOpenTimerRef);
    };
  }, []);

  if (!context.enabled) return null;

  const classes = ["tt-shell", `is-edge-${position.side}`, isWebform ? "is-webform" : ""]
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
      {tipVisible ? (
        <TouTouTip text={TOU_TOU_TIPS[tipIndex]} onClose={() => setTipVisible(false)} />
      ) : null}
      {visualStatus === "sleep" ? (
        // 收纳成细边之后，闭着的眼睛太小了；一个飘着的 Zzz 才看得出"它睡着了"。
        <span className="tt-zzz" aria-hidden="true">
          Zzz
        </span>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        className={buttonClasses}
        aria-label="打开求职助手"
        title="打开求职助手"
        onPointerDown={handlePointerDown}
        onClick={() => handleActivate()}
        onKeyDown={handleKeyDown}
        onFocus={wake}
        onMouseEnter={wake}
        onMouseMove={handlePetStroke}
      >
        <span className="tt-hide">
          <span className="tt-scale">
            <span className="tt-float">
              <span className="tt-breathe">
                <span className="tt-turn">
                  {Object.entries(TOU_TOU_FACE_SOURCES).map(([key, src]) => (
                    <img
                      key={key}
                      className={`tt-face${key === activeFace ? " is-active" : ""}`}
                      src={src}
                      alt=""
                    />
                  ))}
                </span>
              </span>
            </span>
          </span>
        </span>
      </button>
    </div>
  );
}
