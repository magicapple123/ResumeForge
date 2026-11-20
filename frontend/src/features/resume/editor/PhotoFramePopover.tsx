// SPDX-License-Identifier: Apache-2.0
/**
 * I-01：照片字段右键的「照片框…」浮层。
 *
 * ## 为什么不是「调整排版」
 *
 * 照片在纸面上是 `<img class="profile-photo">`，**不带 `data-resume-path`**；字段级规则
 * 一律写成 `[data-resume-path="…"]…`，所以字号 / 颜色 / 缩进一条都命中不了——那个入口
 * 对照片是死路（并且会把十万字符的 base64 当字段名铺出来）。照片真正能调的只有
 * 「边框 / 圆角 / 偏移」，逻辑与左栏「边框与位置」弹层**共用一份**（`PhotoFrameFields`）。
 *
 * ## 外壳与 `ChipStylePopover` 同一套
 *
 * portal 到 body + 先量后显（I-21 同法）+ 点外部 / Esc 关闭。关闭时先 `flush` 再清探针：
 * 最后 120ms 内的拖动不能丢。
 */
import Button from "antd/es/button";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../../i18n/i18nContext";
import type { ResumeFormatConfig } from "../../../types/resumeFormat";
import PhotoFrameFields from "../layout/PhotoFrameFields";
import { placeMenu } from "../../context-menu/positioning";
import { chipPopoverZIndex } from "./overlayLayer";
import { writeLiveProbe } from "../preview/liveProbeRegistry";
import { useChipMenuDismiss } from "./useChipMenuDismiss";

export interface PhotoFramePopoverState {
  x: number;
  y: number;
}

interface Props {
  state: PhotoFramePopoverState | null;
  formatConfig?: ResumeFormatConfig | null;
  hasPhoto?: boolean;
  disabled?: boolean;
  onClose: () => void;
  onChange: (next: ResumeFormatConfig) => void;
}

// 兜底：卡宽 300（外壳真源）+ 六行参数约 400 高。只在量不到真实尺寸时用。
const ESTIMATED_SIZE = { width: 300, height: 400 };

export default function PhotoFramePopover({
  state,
  formatConfig,
  hasPhoto,
  disabled = false,
  onClose,
  onChange,
}: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const flushRef = useRef<(() => void) | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [measureState, setMeasureState] = useState<"pending" | "ok" | "unmeasurable">("pending");
  const stateKey = state ? `${state.x}:${state.y}` : null;
  const [measuredKey, setMeasuredKey] = useState<string | null>(null);
  if (stateKey !== measuredKey) {
    setMeasuredKey(stateKey);
    setMeasureState("pending");
    setSize(null);
  }
  useChipMenuDismiss(state !== null, onClose);
  useLayoutEffect(() => {
    if (!state) return;
    // I-21：层级随宿主模态走（同 `ChipStylePopover`，见 `overlayLayer.ts`）。
    if (rootRef.current) rootRef.current.style.zIndex = String(chipPopoverZIndex());
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      setSize({ width: rect.width, height: rect.height });
      setMeasureState("ok");
      return;
    }
    // 量不到（jsdom）立刻显示：不能让它永远不可见。
    setMeasureState("unmeasurable");
  }, [state, stateKey]);
  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // capture + stopPropagation：portal 到 body 后不经过编辑器的 Esc 分层，
      // 不在这里吃掉会把制作台弹窗一起关掉（见 ChipStylePopover 同处注释）。
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state, onClose]);

  if (!state) return null;
  const placement = placeMenu({ x: state.x, y: state.y }, size ?? ESTIMATED_SIZE);
  const title = t("document.editor.stylePopoverTitle", {
    scope: t("resume.photo.frame.label"),
  });

  return createPortal(
    <div
      ref={rootRef}
      className="document-chip-style-popover document-photo-frame-popover"
      style={{
        left: placement.left,
        top: placement.top,
        visibility: measureState === "pending" ? "hidden" : undefined,
      }}
      role="dialog"
      aria-label={title}
    >
      <div className="document-chip-style-popover-head">
        <span className="document-chip-style-popover-title">{title}</span>
        <Button
          size="small"
          type="text"
          onClick={() => {
            flushRef.current?.();
            writeLiveProbe("");
            onClose();
          }}
        >
          {t("common.action.close")}
        </Button>
      </div>
      <PhotoFrameFields
        formatConfig={formatConfig}
        hasPhoto={hasPhoto}
        disabled={disabled}
        flushRef={flushRef}
        onProbe={(css) => {
          writeLiveProbe(css);
        }}
        onChange={onChange}
      />
    </div>,
    globalThis.document.body,
  );
}
