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
/** 发呆时眨眼的间隔（带抖动，免得像节拍器）与眨眼时长。 */
const BLINK_MIN_MS = 6_000;
const BLINK_MAX_MS = 13_000;
const BLINK_MS = 130;

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
  status?: TouTouStatus;
}

export default function TouTouOrb({
  isWebform = false,
  onOpen,
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
  const [pressed, setPressed] = useState(false);
  const [tipVisible, setTipVisible] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const statusTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const sleepTimerRef = useRef<number | null>(null);
  const tipTimerRef = useRef<number | null>(null);
  const tipHideTimerRef = useRef<number | null>(null);
  const statusSyncedRef = useRef(false);

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
    if (!context.enabled) return;
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
  }, [context.enabled, dragging, hidden, isBusy, visualStatus]);

  useEffect(() => {
    if (hidden || dragging || isBusy) setTipVisible(false);
  }, [dragging, hidden, isBusy]);

  const handleActivate = () => {
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
    onOpen?.();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handleActivate();
  };

  useEffect(() => {
    return () => {
      clearTimer(statusTimerRef);
      clearTimer(hideTimerRef);
      clearTimer(sleepTimerRef);
      clearTimer(tipTimerRef);
      clearTimer(tipHideTimerRef);
    };
  }, []);

  if (!context.enabled) return null;

  const classes = ["tt-shell", `is-edge-${position.side}`, isWebform ? "is-webform" : ""]
    .filter(Boolean)
    .join(" ");
  const buttonClasses = [
    "tt",
    `is-${visualStatus}`,
    hidden ? "is-hidden" : "",
    dragging ? "is-dragging" : "",
    pressed ? "is-pressed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  // 眨眼借用闭眼素材闪一下；其余时候是状态对应的那张脸。
  const activeFace = blinking ? "sleep" : faceKeyFor(visualStatus);

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
        onClick={handleActivate}
        onKeyDown={handleKeyDown}
        onFocus={wake}
        onMouseEnter={wake}
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
