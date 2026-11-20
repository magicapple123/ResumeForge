// SPDX-License-Identifier: Apache-2.0
/**
 * 带行内标记遮罩的文本域**唯一壳**（I-26）。
 *
 * 制作台里所有"值输入"文本框都走这里：单行语义的值输入框（`AutoGrowValueTextArea`）、
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
 * # 为什么"透明字形"必须挂在 `is-masked` 上，而不是无条件挂在文本域
 *
 * 遮罩层只在值里**真的含标记**时才挂载（`decorated`）。文字透明是"字形交给下层画"的
 * 前提，一旦无条件生效，普通值（不含 `*` / `[` / `{@`）就会变成"上层透明 + 下层不存在"
 * = 输入框里一片空白——值本身没丢，只是看不见（2026-11 `81bfd19f` 之后的一处 P0 回归）。
 * 所以 `color: transparent` 与 `::selection` 的透明都收在 `.is-masked` 下，由 `decorated`
 * 单方面决定；`caret-color` / `background: transparent` 留在基础规则（两层共用）。
 *
 * ## 三条不变量
 *
 * 1. **文本域的值一个字都不改**（受控值仍是含标记的源串），`onChange` 原样回传字符串；
 * 2. **容器始终存在**：没有标记时 `display: contents`。若按"有标记才包一层"渲染，用户打出
 *    第一个 `*` 的瞬间文本域会被重挂 → 焦点与光标一起丢；
 * 3. **焦点时遮罩层不撤**：只有输入法组合期让位（预编辑串只画在文本域上，透明就看不见拼音）。
 *
 * ## T01：什么时候换成静态预览（`InlineMarkStatic`）
 *
 * 遮罩层**永远不画字号 / 字重 / 颜色**（会改字宽、与文本域错位，且"打字时字突然变大变色"
 * 正是这条待办要消除的干扰）。要看真实样式就换形态：开关
 * `editor_inline_format_preview`（默认关）+ **有格式** + **已失焦到条目编辑器之外**时，
 * 渲染静态富文本块；点它换回文本域并把光标落到点击处。
 *
 * 判断"失焦"必须看下一拍的 `document.activeElement` 是否仍在同一个
 * `.document-item-editor` 里——点「加粗 / 字号 / 位置下拉 / 标签」都会让文本域先 blur，
 * 若在这里直接切预览，输入框会在用户眼前消失。
 */
import { Input } from "antd";
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import InlineMarkOverlay from "./InlineMarkOverlay";
import InlineMarkStatic from "./InlineMarkStatic";
import {
  isInlineFormatPreviewEnabled,
  subscribeInlineFormatPreview,
} from "./inlineFormatPreviewStore";
import { hasInlineMarks } from "./inlineMarkRuns";
import { visibleRangeOfSelection } from "./inlineMarkSelection";
import { registerInlineMarkField, registerRichField } from "./useInlineMarkRange";
import { normalizeRuns, replaceRichText, richSegments } from "../inline/richRuns";
import type { RichRun, RichValue } from "../inline/richRuns";

interface Props {
  /** 当前值（受控）。结构化模式下是**纯文本**，否则是含行内标记的源串。 */
  value: string;
  /** 无障碍名：沿用各调用点原有的 `aria-label`，测试按它定位。 */
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  /** 值变化：**只回传字符串**，写回由调用方决定（字段 / 页眉 / 条目文本的 patch）。 */
  onChange: (value: string) => void;
  /**
   * I-13：结构化模式。给了它 = `value` 是纯文本、样式旁挂 `runs`，样式改动经
   * `onChange(next)` 回到文档（不再拼接 `**` / `{@`）。`runs` 为空仍算结构化模式：
   * 字段从此按 runs 写，存量标记串在 `readRichValue` 里已经换算成纯文本。
   */
  rich?: { runs: RichRun[]; onChange: (next: RichValue) => void } | null;
  /** 额外类名（值输入框挂 `rf-value-textarea` 拿 min-height / max-height）。 */
  className?: string;
  /** 起始行数。值输入框用 1：短字段不能一上来就两行高 —— I-14 后改由 `autoSize` 决定。 */
  rows?: number;
  /** antd 尺寸档：值输入框用 `small`（与旁边单行输入框同高）。 */
  size?: "small" | "middle" | "large";
  /**
   * 自动长高：值输入框 `1..4`、正文 `2..8`。antd 会把 `resize` 强制成 `none`
   * （rc-textarea 自己量高度）——本壳**不再**提供"手动拖高"，两者互斥且只能二选一。
   */
  autoSize?: { minRows?: number; maxRows?: number };
  /** 单行语义：拦 Enter（输入法组合中的 Enter 放行，那是确认候选词）。 */
  blockEnter?: boolean;
}

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
  rich = null,
  className,
  rows = 1,
  size,
  autoSize,
  blockEnter = false,
}: Props) {
  // 模块级 `t()` 必须订阅语言变化，否则静态块的「回车编辑」提示切语言后不更新。
  useLocale();
  const [scroll, setScroll] = useState<ScrollOffset>({ top: 0, left: 0 });
  const [composing, setComposing] = useState(false);
  /**
   * DF-4：选区按**可见文字**下标保存（`visibleRangeOfSelection` 把源串偏移换算过来）。
   * 源串偏移直接画会在 `{@color=…}` 那 20 个隐形字符上拉出一条空蓝带。
   * 结构化模式下纯文本与可见文字 1:1，不需要换算。
   */
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  /**
   * T01：`editing` 只决定"用不用静态预览块"，**不改变文本域的受控值**。初始 `true`
   * = 一进来就是可输入的文本域（旧行为）；只有"开关开 + 有格式 + 已失焦到编辑器外"
   * 三者同时成立才切成静态块。
   */
  const [editing, setEditing] = useState(true);
  const previewEnabled = useSyncExternalStore(
    subscribeInlineFormatPreview,
    isInlineFormatPreviewEnabled,
    isInlineFormatPreviewEnabled,
  );
  const hostRef = useRef<HTMLDivElement | null>(null);
  /** 静态块点击算出的光标位：`setEditing(true)` 之后在 layout effect 里落地。 */
  const pendingCaret = useRef<number | null>(null);
  const richMode = rich !== null;
  /** 每次渲染后刷新：结构化写回的 `read()` 必须读到最新受控值（不是登记那一拍的快照）。
   *
   * 用 `useLayoutEffect` 而不是在 render 里直接赋值——后者属于"render 期间写 ref"，
   * React 的编译期规则会报错，且并发渲染下可能写到被丢弃的那一版。
   * 所有读取点都在事件回调里（提交、write 之后），layout effect 已经跑过，读到的是最新值。
   */
  const latest = useRef({ value, rich });
  useLayoutEffect(() => {
    latest.current = { value, rich };
  }, [value, rich]);

  const runs = useMemo(
    () => (rich ? normalizeRuns(rich.runs, value.length) : []),
    [rich, value.length],
  );
  /** 结构化模式的分段（纯文本，无隐藏段）；没有样式时 `null` = 不挂遮罩层。 */
  const richSegmentList = useMemo(
    () => (richMode && runs.length > 0 ? richSegments({ text: value, runs }) : null),
    [richMode, runs, value],
  );
  const decorated = richMode ? richSegmentList !== null : hasInlineMarks(value);
  /**
   * 可预览 = 开关开 + 有格式 + 可编辑。**只认结构化 `runs`**：兼容路径（`rich === null`）
   * 的 `value` 是含标记的源串，交给静态块会把 `{@size=1.2}` 原样画出来。
   */
  const previewable = previewEnabled && !disabled && richMode && runs.length > 0;
  const showStatic = previewable && !editing;

  /**
   * 点静态块进入编辑：`focus()` + `setSelectionRange` 必须在**挂载之后**跑。
   * 用 layout effect 而不是 `setTimeout(0)`：前者在同一帧、可被测试断言。
   */
  useLayoutEffect(() => {
    if (!editing) return;
    const caret = pendingCaret.current;
    if (caret === null) return;
    pendingCaret.current = null;
    const area = hostRef.current?.querySelector("textarea");
    if (!area) return;
    area.focus();
    area.setSelectionRange(caret, caret);
  }, [editing, showStatic]);

  /** 只读 `currentTarget` 的 selectionStart/End：`document.getSelection()` 读不到 textarea。 */
  const syncSelection = (element: HTMLTextAreaElement, text: string) => {
    if (richMode) {
      const start = element.selectionStart ?? 0;
      const end = element.selectionEnd ?? start;
      setSelection(end > start ? { start, end } : null);
      return;
    }
    if (!hasInlineMarks(text)) {
      setSelection(null);
      return;
    }
    setSelection(visibleRangeOfSelection(text, element.selectionStart, element.selectionEnd));
  };

  const fieldClassName = [
    "rf-inline-mark-field",
    // 静态块自己就是块级元素：此时不能 `display: contents`，否则它不占位。
    decorated || showStatic ? "" : "is-plain",
    composing ? "is-composing" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const textareaClassName = ["rf-inline-mark-layer", decorated ? "is-masked" : "", className]
    .filter(Boolean)
    .join(" ");

  /**
   * I-13：登记结构化写回器。`read()` 走 ref（受控值每次渲染都可能是新的），
   * `commit()` 先把新值交给宿主，再在新值落地后恢复选区——链接插入会改变文本长度，
   * 同步 setSelectionRange 会被随后的一次重渲染冲回末尾。
   */
  const registerRich = (element: HTMLTextAreaElement) => {
    if (!rich) return;
    registerRichField(element, {
      read: () => {
        const snapshot = latest.current;
        const text = snapshot.value;
        const baseRuns = snapshot.rich ? normalizeRuns(snapshot.rich.runs, text.length) : [];
        return { text, runs: baseRuns };
      },
      commit: (next, range) => {
        latest.current.rich?.onChange(next);
        window.setTimeout(() => {
          if (!element.isConnected) return;
          element.focus();
          element.setSelectionRange(range.start, range.end);
        }, 0);
      },
    });
  };

  return (
    <div className={fieldClassName} ref={hostRef}>
      {showStatic ? (
        <InlineMarkStatic
          value={value}
          runs={runs}
          ariaLabel={ariaLabel}
          className={className}
          enterHint={t("document.inlinePreview.enterHint")}
          onEnterEdit={(offset) => {
            pendingCaret.current = Math.max(0, Math.min(offset, value.length));
            setEditing(true);
          }}
        />
      ) : null}
      {/*
        **两种渲染永不同框**：静态块存在时文本域与遮罩层都不挂载。
        只把遮罩层藏掉、文本域还在，就是"静态块 + 输入框"叠在一起（T01 实现期踩过）。
      */}
      {showStatic ? null : (
        <>
          {decorated ? (
            <InlineMarkOverlay
              value={value}
              segments={richSegmentList}
              scrollTop={scroll.top}
              scrollLeft={scroll.left}
              selection={selection}
            />
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
            onFocus={(event) => {
              registerInlineMarkField(event);
              registerRich(event.currentTarget);
              syncSelection(event.currentTarget, value);
            }}
            onBlur={() => {
              setSelection(null);
              if (!previewable) return;
              const host = hostRef.current;
              if (!host) return;
              // **失焦 ≠ 离开字段**：点「加粗 / 字号 / 位置下拉 / 标签」时焦点会短暂离开文本域。
              // 下一拍看焦点是否仍在同一个条目编辑器根里——在里面就保持编辑态，
              // 否则点一下工具条输入框就消失（这正是 T01 要防的回归）。
              window.setTimeout(() => {
                const active = document.activeElement;
                const root = host.closest(".document-item-editor");
                if (active && root && root.contains(active)) return;
                if (active && host.contains(active)) return;
                setEditing(false);
              }, 0);
            }}
            onSelect={(event) => syncSelection(event.currentTarget, value)}
            onMouseUp={(event) => syncSelection(event.currentTarget, value)}
            onKeyUp={(event) => syncSelection(event.currentTarget, value)}
            onScroll={(event) =>
              setScroll({
                top: event.currentTarget.scrollTop,
                left: event.currentTarget.scrollLeft,
              })
            }
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onChange={(event) => {
              // 值先回传再算选区：偏移必须按**新**源串换算，否则删字后高亮会错位。
              syncSelection(event.target, event.target.value);
              if (rich) {
                const current = latest.current;
                const text = current.value;
                const baseRuns = current.rich ? normalizeRuns(current.rich.runs, text.length) : [];
                current.rich?.onChange(
                  replaceRichText({ text, runs: baseRuns }, event.target.value),
                );
                return;
              }
              onChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (!blockEnter || event.key !== "Enter") return;
              // 输入法组合状态下的 Enter 是"确认候选词"，拦掉会让中文输入没法上屏。
              if (event.nativeEvent.isComposing) return;
              event.preventDefault();
            }}
          />
        </>
      )}
    </div>
  );
}
