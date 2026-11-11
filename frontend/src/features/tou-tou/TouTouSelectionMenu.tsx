// SPDX-License-Identifier: Apache-2.0
/**
 * 投投划词浮条（#27A）：选中页面/输入框文本后就地浮出动作条。
 *
 * 事件与时机（详册要求逐条落地）：
 * - `selectionchange` + **200ms debounce**：键盘（Shift+方向键）扩选只会在停下来后浮出一次；
 * - `mouseup` 后**一帧**（`requestAnimationFrame`）再定位：不抢原生选择菜单，也不在
 *   拖选过程中闪；
 * - 距选区 **8px**（`selectionMenuPosition`，含视口翻转与夹取）；
 * - `Escape` / 点别处 / 滚动 / 缩放 收起；
 * - **不拦截原生右键菜单**：不监听也不 preventDefault `contextmenu`；浮条自身
 *   `pointer-events` 只覆盖自己的区域。
 *
 * 「复制」在浮条内部完成（复制成功/失败需要就地反馈）；其余动作交给宿主
 * （球）——它们要开面板、发侧问或写库。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { copyTextToClipboard } from "./touTouClipboard";
import {
  REGION_LABEL_KEYS,
  SELECTION_MENU_GAP,
  SELECTION_VIEWPORT_MARGIN,
  readActiveSelection,
  selectionActionLabelKey,
  selectionActionsForRegion,
  selectionMenuPosition,
  type DomSelectionSnapshot,
  type TouTouSelectionActionId,
} from "./touTouSelection";
import "./tou-tou-selection.css";

/** 键盘扩选停下来的判定时间。 */
export const SELECTION_DEBOUNCE_MS = 200;
/** 复制结果在浮条里的停留时间。 */
const COPY_FEEDBACK_MS = 1_600;

interface Props {
  enabled: boolean;
  /** 非本地动作（改写 / 侧问 / 存资料库…）交给宿主执行。 */
  onAction: (action: TouTouSelectionActionId, snapshot: DomSelectionSnapshot) => void;
}

export default function TouTouSelectionMenu({ enabled, onAction }: Props) {
  useLocale();
  const [snapshot, setSnapshot] = useState<DomSelectionSnapshot | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [feedback, setFeedback] = useState<"copied" | "copy-failed" | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setSnapshot(null);
    setPosition(null);
    setFeedback(null);
  }, []);

  const refresh = useCallback(() => {
    const next = readActiveSelection(window);
    if (!next) {
      close();
      return;
    }
    // 浮条自己里面的选区不触发新浮条（点击按钮时的瞬时选区）。
    const active = window.getSelection();
    const anchor = active?.anchorNode ?? null;
    if (anchor) {
      const element =
        anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
      if (element?.closest(".tt-selection-bar")) return;
    }
    setSnapshot(next);
  }, [close]);

  useEffect(() => {
    if (!enabled) return;
    let debounce: number | null = null;
    let frame: number | null = null;
    const schedule = () => {
      if (debounce !== null) window.clearTimeout(debounce);
      debounce = window.setTimeout(refresh, SELECTION_DEBOUNCE_MS);
    };
    const onSelectionChange = () => schedule();
    const onMouseUp = (event: MouseEvent) => {
      // 点浮条自身不重算（按钮点击会先折叠选区再触发 selectionchange）。
      if (barRef.current?.contains(event.target as Node)) return;
      if (frame !== null) window.cancelAnimationFrame(frame);
      // 一帧后再定位：先让浏览器把选择菜单/滚动定下来。
      frame = window.requestAnimationFrame(refresh);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (barRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onViewportChange = () => close();
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      if (debounce !== null) window.clearTimeout(debounce);
      if (frame !== null) window.cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [close, enabled, refresh]);

  // 浮条尺寸量出来之后才算最终落点；量不到（jsdom / 首帧）时退回"选区下方 8px 左对齐"。
  useLayoutEffect(() => {
    if (!snapshot) return;
    const bar = barRef.current;
    const rect = bar?.getBoundingClientRect();
    const menu = { width: rect?.width ?? 0, height: rect?.height ?? 0 };
    if (menu.width <= 0 || menu.height <= 0) {
      const fallbackTop = Math.max(
        SELECTION_VIEWPORT_MARGIN,
        snapshot.rect.bottom + SELECTION_MENU_GAP,
      );
      setPosition({
        top: fallbackTop,
        left: Math.max(SELECTION_VIEWPORT_MARGIN, snapshot.rect.left),
      });
      return;
    }
    const next = selectionMenuPosition(
      snapshot.rect,
      { width: window.innerWidth, height: window.innerHeight },
      menu,
    );
    setPosition({ top: next.top, left: next.left });
  }, [snapshot]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(close, COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [close, feedback]);

  const runAction = (action: TouTouSelectionActionId) => {
    if (!snapshot) return;
    if (action === "copy") {
      void copyTextToClipboard(snapshot.text).then((copied) => {
        setFeedback(copied ? "copied" : "copy-failed");
      });
      return;
    }
    const captured = snapshot;
    close();
    onAction(action, captured);
  };

  if (!enabled || !snapshot) return null;
  const actions = selectionActionsForRegion(snapshot.region);

  return createPortal(
    <div
      ref={barRef}
      className="tt-selection-bar"
      style={position ? { top: position.top, left: position.left } : undefined}
      role="toolbar"
      aria-label={t("touTou.selection.bar")}
      // 点浮条不能把页面选区弄没：mousedown 默认行为就是折叠选区。
      onMouseDown={(event) => event.preventDefault()}
    >
      <span className="tt-selection-region">{t(REGION_LABEL_KEYS[snapshot.region])}</span>
      <span className="tt-selection-actions">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            className="tt-selection-action"
            onClick={() => runAction(action)}
          >
            {t(selectionActionLabelKey(action))}
          </button>
        ))}
      </span>
      {feedback ? (
        <span className="tt-selection-feedback" role="status">
          {feedback === "copied" ? t("touTou.selection.copied") : t("touTou.selection.copyFailed")}
        </span>
      ) : null}
    </div>,
    document.body,
  );
}
