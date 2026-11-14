// SPDX-License-Identifier: Apache-2.0
/**
 * 条目「分栏宽度」控件：一排预设（等宽 / 65:35 / 35:65）+ 可拖拽的分隔条。
 *
 * 三个非显然点：
 * - 拖拽期间只 `onChange`（受控），不在本地存宽度：宿主可能在按新列宽重排/记历史，
 *   本地再存一份会出现"手指停下但预览还在抖"；
 * - 起点宽度存在 `dragRef` 而不是 state：pointermove 每帧都要读它，放 state 会为每次
 *   移动多排一次渲染；
 * - **松手才吸附**（snapColumnWidths）：拖动中吸附会让分隔条"粘手"，经过 65% 附近时
 *   会被硬拽过去。
 */
import { Segmented } from "antd";
import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { equalWidths, moveColumnDivider, snapColumnWidths } from "./entryColumnGeometry";
import "./entry-column-controls.css";

interface Props {
  widths: number[];
  disabled: boolean;
  onChange: (widths: number[]) => void;
}

type Preset = "equal" | "leading" | "trailing";

function presetForWidths(widths: number[]): Preset | undefined {
  const presets: Array<[Preset, number[]]> = [
    ["equal", equalWidths(widths.length)],
    ...(widths.length === 2
      ? ([
          ["leading", [65, 35]],
          ["trailing", [35, 65]],
        ] as Array<[Preset, number[]]>)
      : []),
  ];
  return presets.find(([, candidate]) =>
    candidate.every((width, index) => widths[index] === width),
  )?.[0];
}

export default function EntryColumnSplitControl({ widths, disabled, onChange }: Props) {
  useLocale();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    dividerIndex: number;
    startX: number;
    startWidths: number[];
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const accessibleName = t("structure.layout.widths");

  const widthsAtPointer = (state: NonNullable<typeof dragRef.current>, clientX: number) => {
    const track = trackRef.current;
    if (!track) return state.startWidths;
    const { width } = track.getBoundingClientRect();
    if (width <= 0) return state.startWidths;
    const delta = ((clientX - state.startX) / width) * 100;
    return moveColumnDivider(state.startWidths, state.dividerIndex, delta);
  };

  const beginDrag = (dividerIndex: number, event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const track = trackRef.current;
    if (!track || track.getBoundingClientRect().width <= 0) return;
    event.preventDefault();
    // 捕获指针：鼠标移出控件（甚至移出窗口）后仍能收到 move/up，否则拖到边缘就断。
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      dividerIndex,
      startX: event.clientX,
      startWidths: [...widths],
    };
    setDragging(true);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    // 只认发起这次拖拽的那根手指/那个指针：多指同时按时后到的 pointermove 不能改宽度。
    if (!state || state.pointerId !== event.pointerId) return;
    onChange(widthsAtPointer(state, event.clientX));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    // 松手这一刻才吸附到预设值：拖动中吸附会让分隔条在经过 65% 时"粘住"。
    onChange(snapColumnWidths(widthsAtPointer(state, event.clientX)));
    dragRef.current = null;
    setDragging(false);
  };

  const options = [
    { value: "equal", label: t("structure.layout.align.equal") },
    ...(widths.length === 2
      ? [
          // 比例是技术值，不是文案：用模板拼出来，避免被 i18n 守卫当成未翻译的界面文字。
          { value: "leading", label: `${65}:${35}` },
          { value: "trailing", label: `${35}:${65}` },
        ]
      : []),
  ];

  return (
    <div className="rf-entry-column-split">
      <Segmented
        size="small"
        block
        value={presetForWidths(widths)}
        disabled={disabled}
        aria-label={accessibleName}
        options={options}
        onChange={(value) => {
          if (value === "equal") onChange(equalWidths(widths.length));
          if (value === "leading") onChange([65, 35]);
          if (value === "trailing") onChange([35, 65]);
        }}
      />
      <div
        className={`rf-entry-column-split-track${dragging ? " is-dragging" : ""}`}
        ref={trackRef}
        role="group"
        aria-label={accessibleName}
        data-column-split="1"
      >
        {widths.map((width, index) => (
          <div
            key={`column-${index}`}
            className={`rf-entry-column-split-cell${index % 2 ? " is-alt" : ""}`}
            style={{ flexBasis: `${width}%` }}
            aria-hidden="true"
          >
            {`${Math.round(width)}%`}
          </div>
        ))}
        {widths.slice(0, -1).map((_, index) => {
          const before = widths.slice(0, index).reduce((sum, width) => sum + width, 0);
          const pair = widths[index] + widths[index + 1];
          const position = before + widths[index];
          return (
            <div
              key={`divider-${index}`}
              className="rf-entry-column-split-divider"
              role="separator"
              aria-orientation="vertical"
              aria-label={`${accessibleName} ${index + 1}`}
              // 无障碍读数只在自己这两列的区间里：左右各留 10% 保底，和拖拽的夹取口径一致。
              aria-valuemin={Math.round(before + 10)}
              aria-valuemax={Math.round(before + pair - 10)}
              aria-valuenow={Math.round(position)}
              tabIndex={disabled ? -1 : 0}
              data-column-splitter={index}
              style={{ left: `${position}%` }}
              onPointerDown={(event) => beginDrag(index, event)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(event) => {
                if (disabled) return;
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  onChange(moveColumnDivider(widths, index, event.key === "ArrowRight" ? 1 : -1));
                }
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
