// SPDX-License-Identifier: Apache-2.0
/**
 * 带行内标记遮罩的文本域**唯一壳**（I-26）。
 *
 * 制作台里所有"值输入"文本框都走这里：单行语义的值输入框（`ResizableValueTextArea`）、
 * 字段正文（`itemValueEditors`）、条目正文（`ItemEditor`）。三处渲染的必须是**同一份**
 * 容器 + 透明文本域 + 遮罩层逻辑——否则同一条简历里有的框藏标记、有的框露 `{@size=1.1}`，
 * 而且"藏"的那几处还会各自漂移。
 *
 * ## 为什么是"两层"而不是"把值换成可见文本"
 *
 * 行内格式的写回链路（`applyInlineEdit` 写 DOM + 派发 `input`、`useInlineMarkRange` /
 * `lastFocusedTextarea` 记选区）全部按**源串偏移**工作。文本域的值一旦换成可见文本，
 * 那条链路会在错误的坐标系里加标记——最坏的情况是"用户点了加粗，原有的 `{@size}` 被静默丢掉"。
 * 所以隐藏标记靠"画两层"，不靠"改值"：
 *
 * ```
 * 上层：<textarea>  color: transparent（字形透明，但**占位**）+ caret-color 可见
 * 下层：<div>      按 `parseInlineMarkSegments` 画出真正的字形，pointer-events: none
 * ```
 *
 * 两层共用 `.rf-inline-mark-layer` 承担字体度量（字号/行高/内边距/换行/滚动条占位），
 * 标记段在下层也渲染（`visibility: hidden`）——它们的**占位宽度**必须保留，否则后面的字
 * 全部左移，光标就落在两个字的缝隙里。
 *
 * ## 三条不变量
 *
 * 1. **文本域的值一个字都不改**（受控值仍是含标记的源串），`onChange` 原样回传字符串；
 * 2. **容器始终存在**：没有标记时 `display: contents`。若按"有标记才包一层"渲染，用户打出
 *    第一个 `*` 的瞬间文本域会被重挂 → 焦点与光标一起丢；
 * 3. **焦点时遮罩层不撤**：只有输入法组合期让位（预编辑串只画在文本域上，透明就看不见拼音）。
 */
import { Input } from "antd";
import { useState } from "react";
import type { CSSProperties } from "react";
import InlineMarkOverlay from "./InlineMarkOverlay";
import { hasInlineMarks } from "./inlineMarkRuns";
import { registerInlineMarkField } from "./useInlineMarkRange";

interface Props {
  /** 当前值（受控，含行内标记的源串）。 */
  value: string;
  /** 无障碍名：沿用各调用点原有的 `aria-label`，测试按它定位。 */
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  /** 值变化：**只回传字符串**，写回由调用方决定（字段 / 页眉 / 条目文本的 patch）。 */
  onChange: (value: string) => void;
  /** 额外类名（值输入框挂 `rf-value-textarea` 拿 min-height / max-height）。 */
  className?: string;
  /** 起始行数。值输入框必须用 1：短字段不能一上来就两行高。 */
  rows?: number;
  /** antd 尺寸档：值输入框用 `small`（与旁边单行输入框同高）。 */
  size?: "small" | "middle" | "large";
  /** 自动长高（多行正文用）。与 `resizable` 互斥：antd 会把 `resize` 强制成 `none`。 */
  autoSize?: { minRows?: number; maxRows?: number };
  /** 允许纵向拖高（单行语义的值输入框用）：**只**纵向，横向拖宽会破坏中栏栅格。 */
  resizable?: boolean;
  /** 单行语义：拦 Enter（输入法组合中的 Enter 放行，那是确认候选词）。 */
  blockEnter?: boolean;
}

/** 拖高手柄必须由浏览器持有：React 只托管它声明过的内联属性，`height` 不在此列。 */
const RESIZABLE_STYLE: CSSProperties = { resize: "vertical" };

interface ScrollOffset {
  top: number;
  left: number;
}

export default function InlineMarkTextArea({
  value,
  ariaLabel,
  placeholder,
  disabled = false,
  onChange,
  className,
  rows = 1,
  size,
  autoSize,
  resizable = false,
  blockEnter = false,
}: Props) {
  const [scroll, setScroll] = useState<ScrollOffset>({ top: 0, left: 0 });
  const [composing, setComposing] = useState(false);
  const decorated = hasInlineMarks(value);

  const fieldClassName = [
    "rf-inline-mark-field",
    decorated ? "" : "is-plain",
    composing ? "is-composing" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const textareaClassName = ["rf-inline-mark-layer", className].filter(Boolean).join(" ");

  return (
    <div className={fieldClassName}>
      {decorated ? (
        <InlineMarkOverlay value={value} scrollTop={scroll.top} scrollLeft={scroll.left} />
      ) : null}
      <Input.TextArea
        className={textareaClassName}
        size={size}
        rows={rows}
        autoSize={autoSize}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        disabled={disabled || undefined}
        style={resizable ? RESIZABLE_STYLE : undefined}
        onFocus={registerInlineMarkField}
        onScroll={(event) =>
          setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })
        }
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (!blockEnter || event.key !== "Enter") return;
          // 输入法组合状态下的 Enter 是"确认候选词"，拦掉会让中文输入没法上屏。
          if (event.nativeEvent.isComposing) return;
          event.preventDefault();
        }}
      />
    </div>
  );
}
