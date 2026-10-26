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
 * - **无选区不猜**：空选区不给按钮"猜一段"加粗，只播一句 t() 提示（让用户自己选）。
 *
 * ## 为什么是受控 props
 *
 * 中栏表单的 textarea 由 shell（ResumeWorkbenchEditorColumn）拥有；本组件只拿
 * `getTarget`（读最近聚焦的 textarea）与 `onCommit`，不 import 任何 shell 文件。
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

function toCommit(edit: InlineEdit): InlineMarkCommit {
  return { text: edit.text, selection: { start: edit.start, end: edit.end } };
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

  /** 读选区失败时给出"为什么没反应"的唯一口径。 */
  const requireSelection = (): { text: string; range: InlineRange } | null => {
    const target = getTarget?.() ?? null;
    if (!target) {
      hint("noTarget");
      return null;
    }
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? start;
    if (start === end) {
      hint("selectFirst");
      return null;
    }
    return { text: target.value, range: { start, end } };
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
    const picked = requireSelection();
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
