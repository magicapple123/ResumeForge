// SPDX-License-Identifier: Apache-2.0
/**
 * 照片「四边可拖的裁剪框」（2026-11 #18）。
 *
 * ## 它解决什么
 *
 * 旧的裁剪 UI 是三个滑杆（取景大小 / 水平位置 / 垂直位置），表达不了"把上边裁掉一点、
 * 左边再收一点"这种最常见的动作。这里把裁剪框直接画在**整张原图**上：四边 + 四角共
 * 8 个手柄，拖哪条边就只有那条边动。
 *
 * ## 交互契约（与清单 §问题 18「验收」逐条对应）
 *
 * 1. **拖动中允许自由变形**：`pointermove` 直接走 `resizeCropRect`，不做比例夹取；
 * 2. **松手夹回当前比例**：`pointerup` 调 `fitCropRectToAspect`，锚点是**中心**
 *    （以左上为锚会让框在松手瞬间整体位移，用户会以为"裁歪了"）；
 *    `aspect === "free"` 时只夹边界，不改比例；
 * 3. **按住 Ctrl / Cmd 拖动 = 等比缩放**：拖动开始时冻结当时的 `w/h`，全程不变形，
 *    松手不会跳（因为拖动结束时比例本来就对）；
 * 4. **键盘可达**：8 个手柄都是 `role="slider"` + `tabIndex=0`，方向键 1%、
 *    Shift+方向键 5%，与鼠标共用 `nudgeCropRect` 这一套夹取，不会出现"鼠标能拖到、
 *    键盘拖不到"的两套边界；
 * 5. **视觉**：裁剪框 1.5px 白描边 + 1px 深色外圈（浅色照片上也看得清），框外四块
 *    半透明遮罩压暗，照片本身再画一条细边框——解决"白底照片看不出边界"。
 *
 * ## 为什么坐标换算全部外包给 `cropGeometry.ts`
 *
 * 显示区是 `object-fit: contain`，图片在容器里可能带 letterbox；指针位置必须先减掉
 * 留白再除以**图片实际显示宽高**，否则拖到边缘时框会与手指错位（照片越接近正方形、
 * 错误越不明显，越容易漏测）。这段几何因此收敛成可单测的纯函数，组件只负责画。
 *
 * ## 不写 `format_config`
 *
 * 拖动的每一帧只把 `CropRect` 交给父组件的**局部状态**；只有「应用裁剪」才提交一次，
 * 避免每帧触发版式保存链路与历史快照。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { MessageKey } from "../../../i18n";
import { useI18n } from "../../../i18n/i18nContext";
// 裁剪框的颜色一律走变量，本文件里不出现任何写死的色值（`theme/inlineColorGuard.test.ts`
// 守着这条）：遮罩与照片细边吃主题的 `--rf-scrim-strong`，裁剪框/手柄那几档在
// `photo-crop.css` 里定义成 `--rf-crop-*`（理由见该文件头）。
import "./photo-crop.css";
import {
  clampCropRect,
  fitCropRectToAspect,
  MIN_CROP_SIZE,
  type CropRect,
  type PhotoAspect,
  type PhotoSourceInfo,
} from "./photoCrop";
import {
  CROP_HANDLES,
  arrowDelta,
  cropBoxPercent,
  fitContain,
  handleCursor,
  handleDirection,
  maskBoxes,
  nudgeCropRect,
  normalizedDelta,
  resizeCropRect,
  type ArrowKey,
  type Box,
  type CropHandle,
  type Size,
} from "./cropGeometry";

/** 显示区高度（px）：固定高度 + `contain`，竖图与横图都不会把弹窗撑爆。 */
const STAGE_HEIGHT = 320;

/** 方向键步长（归一化）：1% / Shift 5%（清单 §问题 18「验收」4）。 */
const KEY_STEP = 0.01;
const KEY_STEP_FAST = 0.05;

/** 手柄的无障碍名（8 个方向各自说清，不写"手柄 1/2/3"）。 */
const HANDLE_LABEL_KEYS: Record<CropHandle, MessageKey> = {
  n: "proview.photo.handle.n",
  s: "proview.photo.handle.s",
  e: "proview.photo.handle.e",
  w: "proview.photo.handle.w",
  nw: "proview.photo.handle.nw",
  ne: "proview.photo.handle.ne",
  sw: "proview.photo.handle.sw",
  se: "proview.photo.handle.se",
};

/** 手柄的**命中区**尺寸与锚点（视觉只有中间那一小条，命中区放大到可点）。 */
const HANDLE_HIT: Record<CropHandle, { left: string; top: string; width: number; height: number }> =
  {
    n: { left: "50%", top: "0%", width: 44, height: 22 },
    s: { left: "50%", top: "100%", width: 44, height: 22 },
    w: { left: "0%", top: "50%", width: 22, height: 44 },
    e: { left: "100%", top: "50%", width: 22, height: 44 },
    nw: { left: "0%", top: "0%", width: 24, height: 24 },
    ne: { left: "100%", top: "0%", width: 24, height: 24 },
    sw: { left: "0%", top: "100%", width: 24, height: 24 },
    se: { left: "100%", top: "100%", width: 24, height: 24 },
  };

/** 手柄的**视觉**尺寸：边是短横/竖条，角是小方块。 */
const HANDLE_BAR: Record<CropHandle, { width: number; height: number }> = {
  n: { width: 22, height: 4 },
  s: { width: 22, height: 4 },
  w: { width: 4, height: 22 },
  e: { width: 4, height: 22 },
  nw: { width: 11, height: 11 },
  ne: { width: 11, height: 11 },
  sw: { width: 11, height: 11 },
  se: { width: 11, height: 11 },
};

interface DragState {
  pointerId: number;
  handle: CropHandle;
  startClientX: number;
  startClientY: number;
  startRect: CropRect;
  /** `object-fit: contain` 后图片实际显示的矩形（已减掉 letterbox）。 */
  image: Box;
  /** 拖动开始时是否为等比模式（Ctrl / Cmd 只认按下那一刻）。 */
  lockAspect: boolean;
  /** 最近一帧的矩形：`pointerup` 用它夹比例（不依赖父组件这一帧是否已重渲染）。 */
  lastRect: CropRect;
}

export interface PhotoCropBoxProps {
  /** 原图 data URL（**永远**是原图，不是裁剪结果）。 */
  photo: string;
  /** 原图像素尺寸；未解码出来时传 `null`，几何退化成"铺满显示区"。 */
  source: PhotoSourceInfo | null;
  /** 归一化裁剪矩形（相对原图，0–1），由父组件持有。 */
  rect: CropRect;
  /** 当前比例锁：`free` 松手不夹；其余按档位夹回。 */
  aspect: PhotoAspect;
  /** 最小边长（归一化）；默认 `MIN_CROP_SIZE`。 */
  minSize?: number;
  /** 只读（例如没有照片/加载失败）。 */
  disabled?: boolean;
  /** 每一帧（拖动 / 键盘 / 换比例）都回调；父组件只存局部状态，不落库。 */
  onChange: (next: CropRect) => void;
  className?: string;
}

/** 手柄当前的数值（百分比）：边手柄报那条边的位置，角手柄报宽度。 */
function handleValue(handle: CropHandle, rect: CropRect): number {
  const direction = handleDirection(handle);
  if (direction.x !== 0 && direction.y !== 0) return Math.round(rect.w * 100);
  if (direction.x !== 0) {
    return Math.round((direction.x > 0 ? rect.x + rect.w : rect.x) * 100);
  }
  return Math.round((direction.y > 0 ? rect.y + rect.h : rect.y) * 100);
}

/** 手柄命中区样式（视觉条是子元素，命中区本身透明）。 */
function handleHitStyle(handle: CropHandle, dragging: boolean): CSSProperties {
  const hit = HANDLE_HIT[handle];
  return {
    position: "absolute",
    left: hit.left,
    top: hit.top,
    width: hit.width,
    height: hit.height,
    transform: "translate(-50%, -50%)",
    display: "grid",
    placeItems: "center",
    padding: 0,
    margin: 0,
    border: "none",
    background: "transparent",
    touchAction: "none",
    cursor: handleCursor(handle),
    zIndex: 4,
    opacity: dragging ? 1 : 0.98,
  };
}

/** 手柄视觉条：白底 + 深色描边（在浅色照片上也看得清），聚焦时加蓝圈。 */
function handleBarStyle(handle: CropHandle, focused: boolean): CSSProperties {
  const bar = HANDLE_BAR[handle];
  return {
    width: bar.width,
    height: bar.height,
    background: "var(--rf-crop-handle)",
    border: "1px solid var(--rf-crop-edge-strong)",
    borderRadius: 2,
    boxSizing: "border-box",
    boxShadow: focused
      ? "0 0 0 3px var(--rf-crop-focus-ring)"
      : "0 1px 2px var(--rf-crop-handle-shadow)",
    pointerEvents: "none",
  };
}

export default function PhotoCropBox({
  photo,
  source,
  rect,
  aspect,
  minSize = MIN_CROP_SIZE,
  disabled = false,
  onChange,
  className,
}: PhotoCropBoxProps) {
  const { t } = useI18n();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 });
  const [activeHandle, setActiveHandle] = useState<CropHandle | null>(null);
  const [focusedHandle, setFocusedHandle] = useState<CropHandle | null>(null);

  /** 量显示区尺寸；量不到（jsdom / 首帧）就保持 0，渲染时退化成"铺满"。 */
  const measureStage = useCallback(() => {
    const element = stageRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    if (!(bounds.width > 0) || !(bounds.height > 0)) return;
    setStageSize((current) => {
      const sameWidth = Math.abs(current.width - bounds.width) < 0.5;
      const sameHeight = Math.abs(current.height - bounds.height) < 0.5;
      if (sameWidth && sameHeight) return current;
      return { width: bounds.width, height: bounds.height };
    });
  }, []);

  useEffect(() => {
    measureStage();
    const handleResize = () => measureStage();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [measureStage, photo]);

  const safeRect = clampCropRect(rect, minSize);
  const imageSize: Size = { width: source?.width ?? 1, height: source?.height ?? 1 };
  const measured = stageSize.width > 0 && stageSize.height > 0;
  // 未量到显示区时用原图尺寸当显示区：比例正确，百分比也就等于 rect 本身。
  const stageBox: Size = measured ? stageSize : imageSize;
  const imageBox = fitContain(stageBox, imageSize);
  const cropBox = cropBoxPercent(safeRect, stageBox, imageBox);
  const masks = maskBoxes(cropBox);

  const percentX = (value: number) => (stageBox.width > 0 ? (value / stageBox.width) * 100 : 0);
  const percentY = (value: number) => (stageBox.height > 0 ? (value / stageBox.height) * 100 : 0);

  const beginDrag = (handle: CropHandle, event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button > 0) return;
    const element = stageRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const startRect = clampCropRect(rect, minSize);
    dragRef.current = {
      pointerId: event.pointerId,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect,
      image: fitContain(
        { width: bounds.width, height: bounds.height },
        { width: source?.width ?? 1, height: source?.height ?? 1 },
      ),
      lockAspect: event.ctrlKey || event.metaKey,
      lastRect: startRect,
    };
    setActiveHandle(handle);
    measureStage();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = normalizedDelta(
      event.clientX,
      event.clientY,
      drag.startClientX,
      drag.startClientY,
      drag.image,
    );
    const next = resizeCropRect(drag.startRect, {
      handle: drag.handle,
      delta,
      minSize,
      lockAspect: drag.lockAspect,
    });
    drag.lastRect = next;
    onChange(next);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setActiveHandle(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    // 松手才夹比例：拖动中变形是用户的手感，松手后回到"当前比例"。
    onChange(fitCropRectToAspect(drag.lastRect, aspect, source, minSize));
  };

  const handleKeyDown = (handle: CropHandle, event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const key = event.key;
    if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "ArrowUp" && key !== "ArrowDown") {
      return;
    }
    const step = event.shiftKey ? KEY_STEP_FAST : KEY_STEP;
    if (!arrowDelta(handle, key as ArrowKey, step)) return;
    event.preventDefault();
    const nudged = nudgeCropRect(rect, handle, key as ArrowKey, step, {
      minSize,
      lockAspect: event.ctrlKey || event.metaKey,
    });
    onChange(fitCropRectToAspect(nudged, aspect, source, minSize));
  };

  return (
    // `rf-photo-crop` 定义裁剪框自己的那几个色值（见 `photo-crop.css`）：它必须留在
    // **最外层**，下面内联样式里的 `var(--rf-crop-*)` 都靠它继承下来。
    <div className={className ? `rf-photo-crop ${className}` : "rf-photo-crop"}>
      <div
        ref={stageRef}
        role="group"
        aria-label={t("proview.photo.cropBoxAria")}
        data-testid="photo-crop-stage"
        style={{
          position: "relative",
          width: "100%",
          height: STAGE_HEIGHT,
          background: "var(--rf-surface-alt)",
          borderRadius: 6,
          touchAction: "none",
          userSelect: "none",
          overflow: "visible",
        }}
      >
        <img
          src={photo}
          alt={t("proview.photo.previewLabel")}
          draggable={false}
          data-testid="photo-crop-image"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
        {/* 照片自身的细边框：白底照片与白底弹窗之间靠它划界（清单 §问题 18「视觉」）。
            颜色吃主题的遮罩色（`--rf-scrim-strong`），浅色/深色下都保持"压暗"语义。 */}
        <div
          aria-hidden
          data-testid="photo-crop-photo-frame"
          style={{
            position: "absolute",
            left: `${percentX(imageBox.left)}%`,
            top: `${percentY(imageBox.top)}%`,
            width: `${percentX(imageBox.width)}%`,
            height: `${percentY(imageBox.height)}%`,
            border: "1px solid var(--rf-scrim-strong)",
            borderRadius: 2,
            boxSizing: "border-box",
            pointerEvents: "none",
          }}
        />
        {masks.map((mask, index) => (
          <div
            key={`mask-${index}`}
            aria-hidden
            data-crop-mask={index}
            style={{
              position: "absolute",
              left: `${mask.left}%`,
              top: `${mask.top}%`,
              width: `${mask.width}%`,
              height: `${mask.height}%`,
              background: "var(--rf-scrim-strong)",
              pointerEvents: "none",
              zIndex: 1,
            }}
          />
        ))}
        <div
          data-testid="photo-crop-box"
          style={{
            position: "absolute",
            left: `${cropBox.left}%`,
            top: `${cropBox.top}%`,
            width: `${cropBox.width}%`,
            height: `${cropBox.height}%`,
            border: "1.5px solid var(--rf-crop-handle)",
            boxShadow: "0 0 0 1px var(--rf-crop-edge-strong)",
            boxSizing: "border-box",
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          {CROP_HANDLES.map((handle) => {
            const value = handleValue(handle, safeRect);
            return (
              <div
                key={handle}
                data-crop-handle={handle}
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-label={t(HANDLE_LABEL_KEYS[handle])}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={value}
                aria-valuetext={t("proview.photo.handleValue", { value })}
                aria-disabled={disabled || undefined}
                style={{
                  ...handleHitStyle(handle, activeHandle === handle),
                  pointerEvents: disabled ? "none" : "auto",
                }}
                onPointerDown={(event) => beginDrag(handle, event)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={(event) => handleKeyDown(handle, event)}
                onFocus={() => setFocusedHandle(handle)}
                onBlur={() => setFocusedHandle((current) => (current === handle ? null : current))}
              >
                <span aria-hidden style={handleBarStyle(handle, focusedHandle === handle)} />
              </div>
            );
          })}
        </div>
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 12,
          color: "var(--rf-text-secondary)",
        }}
      >
        {t("proview.photo.boxHint")}
      </div>
    </div>
  );
}
