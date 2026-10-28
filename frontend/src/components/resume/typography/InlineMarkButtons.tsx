// SPDX-License-Identifier: Apache-2.0
/**
 * W07 / P1-02 字符级标记按钮：加粗 / 斜体 / 链接（"字符级从已有粗体扩展"）。
 *
 * ## 边界
 *
 * - **不持有内容**：只读当前聚焦 textarea 的选区，调 `features/resume-layout/inlineMarks`
 *   的纯规则算出新文本与新选区，再交给宿主 `onCommit`（宿主 setState + 恢复选区）。
 *   渲染的唯一实现仍在后端（HTML/PDF/Word 共用）；这里只负责"在选区上插入标记"。
 * - **不做第二套标记协议**：全部走 toggleBoldMark / toggleItalicMark / insertLinkMark
 *   （先 `**` 再 `*`、URL 只收 http(s) 且 ≤512）。
 * - **无选区的语义分两种**（2026-10-29 用户反馈「添加链接还需要选取文字」后的调整）：
 *   加粗/斜体仍然要求有选区（空选区给一句 t() 提示，不猜一段文字去加粗）；
 *   **链接**允许"在光标处插入，用 URL 当链接文字"——用户先点图标再填地址是自然顺序，
 *   没有理由逼他先选一段文字。
 *
 * ## 选区从哪来（三层，逐层降级）
 *
 * 1. 实时选区：`target.selectionStart/End` 非空 → 直接用；
 * 2. 记忆选区：`getRememberedRange()`（`useWorkbenchInlineMarks` 在 select/keyup/mouseup/blur
 *    时记下的最近一次非空选区）——点图标那一拍选区可能已被折叠，但用户刚选过；
 * 3. 光标：两者都没有时用 `selectionStart` 作为插入点（链接用它、加粗/斜体提示先选文字）。
 *
 * ## 为什么是受控 props
 *
 * 中栏表单的 textarea 由 shell（ResumeWorkbenchEditorColumn）拥有；本组件只拿
 * `getTarget`（读最近聚焦的 textarea）、`getRememberedRange` 与 `onCommit`，不 import 任何
 * shell 文件。
 */
import { BoldOutlined, ItalicOutlined, LinkOutlined } from "@ant-design/icons";
import { App, Button, Input, Popover, Space, Tooltip } from "antd";
import { useState, type ReactNode } from "react";
import { t, type MessageKey } from "../../../i18n";
import {
  insertLinkMark,
  toggleBoldMark,
  toggleItalicMark,
  type InlineEdit,
  type InlineRange,
} from "../../../features/resume-layout/inlineMarks";
import { useLocale } from "../../../i18n/i18nContext";

export interface InlineMarkCommit {
  text: string;
  selection: { start: number; end: number };
}

interface Props {
  /** 读当前聚焦的编辑文本框；不传/返回 null = 暂无可编辑目标（点击给提示，不静默）。 */
  getTarget?: () => HTMLTextAreaElement | null;
  /**
   * 读"最近一次非空选区"（失焦后仍可用）。没有 = 不支持记忆，只按实时选区判断。
   */
  getRememberedRange?: () => InlineRange | null;
  /** 应用后写回草稿：宿主 setState(text) 并 textarea.setSelectionRange(selection)。 */
  onCommit: (next: InlineMarkCommit) => void;
  disabled?: boolean;
  className?: string;
}

/** 失败原因 → 用户提示；三条文案都在 zh-CN.typography.ts。 */
const HINT_KEYS: Record<"noTarget" | "selectFirst" | "invalidUrl", MessageKey> = {
  noTarget: "typography.inline.noTarget",
  selectFirst: "typography.inline.selectFirst",
  invalidUrl: "typography.inline.invalidUrl",
};

/** 一次点击读到的编辑对象：文本 + 该用哪一段（可能是空区间 = 光标）。 */
interface Picked {
  text: string;
  range: InlineRange;
}

function toCommit(edit: InlineEdit): InlineMarkCommit {
  return { text: edit.text, selection: { start: edit.start, end: edit.end } };
}

/** 把记忆里的区间夹到当前文本长度内（文本可能已经变短：撤销、AI 改写）。 */
function clampToText(text: string, range: InlineRange): InlineRange {
  const start = Math.max(0, Math.min(range.start, range.end, text.length));
  const end = Math.max(start, Math.min(Math.max(range.start, range.end), text.length));
  return { start, end };
}

function MarkButton({
  labelKey,
  ariaKey,
  icon,
  onClick,
  disabled,
}: {
  labelKey: MessageKey;
  ariaKey: MessageKey;
  icon: ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  useLocale();
  return (
    <Tooltip title={t(labelKey)}>
      <Button
        size="small"
        type="text"
        icon={icon}
        aria-label={t(ariaKey)}
        disabled={disabled}
        onClick={onClick}
      />
    </Tooltip>
  );
}

export default function InlineMarkButtons({
  getTarget,
  getRememberedRange,
  onCommit,
  disabled = false,
  className,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  const [linkSnapshot, setLinkSnapshot] = useState<{
    text: string;
    range: InlineRange;
  } | null>(null);
  const [url, setUrl] = useState("");

  const hint = (kind: keyof typeof HINT_KEYS) => message.info(t(HINT_KEYS[kind]));

  /**
   * 读这次点击要编辑哪一段：实时选区 → 记忆选区 → 光标。没有目标 textarea 才提示。
   *
   * 只有"连目标都没有"算硬失败：`typography.inline.noTarget`。空选区不算失败——链接
   * 需要它当插入点，加粗/斜体由调用方自己决定要不要提示。
   */
  const readPicked = (): Picked | null => {
    const target = getTarget?.() ?? null;
    if (!target) {
      hint("noTarget");
      return null;
    }
    const text = target.value;
    const rawStart = target.selectionStart ?? 0;
    const rawEnd = target.selectionEnd ?? rawStart;
    if (rawStart !== rawEnd) {
      return { text, range: clampToText(text, { start: rawStart, end: rawEnd }) };
    }
    const remembered = getRememberedRange?.() ?? null;
    if (remembered) {
      const range = clampToText(text, remembered);
      if (range.start !== range.end) return { text, range };
    }
    // 真的没有选区：把光标位置交出去（链接用它当插入点，加粗/斜体由这里拒绝）。
    const caret = Math.max(0, Math.min(rawStart, text.length));
    return { text, range: { start: caret, end: caret } };
  };

  /** 加粗/斜体：必须有非空选区；没有就播一句"先选文字"（不猜一段去加粗）。 */
  const requireSelection = (): Picked | null => {
    const picked = readPicked();
    if (!picked) return null;
    if (picked.range.start === picked.range.end) {
      hint("selectFirst");
      return null;
    }
    return picked;
  };

  /** 规则层返回"未改动"（如斜体按钮贴着已成对的加粗标记）时不制造空历史点。 */
  const commitIfChanged = (picked: { text: string }, edit: InlineEdit) => {
    if (edit.text === picked.text) return;
    onCommit(toCommit(edit));
  };

  const applyBold = () => {
    const picked = requireSelection();
    if (picked) commitIfChanged(picked, toggleBoldMark(picked.text, picked.range));
  };

  const applyItalic = () => {
    const picked = requireSelection();
    if (picked) commitIfChanged(picked, toggleItalicMark(picked.text, picked.range));
  };

  const openLink = () => {
    // 链接允许空选区：URL 会被当成链接文字（insertLinkMark 的口径）。
    const picked = readPicked();
    if (!picked) return;
    setUrl("");
    setLinkSnapshot(picked);
  };

  const confirmLink = () => {
    if (!linkSnapshot) return;
    const edit = insertLinkMark(linkSnapshot.text, linkSnapshot.range, url);
    if (!edit) {
      hint("invalidUrl");
      return;
    }
    setLinkSnapshot(null);
    onCommit(toCommit(edit));
  };

  const rootClass = `resume-typography-inline${className ? ` ${className}` : ""}`;
  return (
    <Space
      size={2}
      wrap
      className={rootClass}
      role="group"
      aria-label={t("typography.inline.groupAria")}
    >
      <MarkButton
        labelKey="typography.inline.bold"
        ariaKey="typography.inline.boldAria"
        icon={<BoldOutlined />}
        onClick={applyBold}
        disabled={disabled}
      />
      <MarkButton
        labelKey="typography.inline.italic"
        ariaKey="typography.inline.italicAria"
        icon={<ItalicOutlined />}
        onClick={applyItalic}
        disabled={disabled}
      />
      <Popover
        open={linkSnapshot !== null}
        trigger="click"
        placement="bottomLeft"
        title={t("typography.inline.linkTitle")}
        content={
          <Space orientation="vertical" size={6} style={{ width: 240 }}>
            <Input
              size="small"
              // 打开即落焦点：用户点图标后直接敲地址，回车就插入。
              autoFocus
              value={url}
              placeholder={t("typography.inline.linkPlaceholder")}
              aria-label={t("typography.inline.linkPlaceholder")}
              onChange={(event) => setUrl(event.target.value)}
              onPressEnter={confirmLink}
            />
            <Space size={6}>
              <Button size="small" type="primary" onClick={confirmLink}>
                {t("typography.inline.linkApply")}
              </Button>
              <Button size="small" onClick={() => setLinkSnapshot(null)}>
                {t("typography.inline.linkCancel")}
              </Button>
            </Space>
          </Space>
        }
      >
        <span>
          <MarkButton
            labelKey="typography.inline.link"
            ariaKey="typography.inline.linkAria"
            icon={<LinkOutlined />}
            onClick={openLink}
            disabled={disabled}
          />
        </span>
      </Popover>
    </Space>
  );
}
