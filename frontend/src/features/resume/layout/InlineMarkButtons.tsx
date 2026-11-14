// SPDX-License-Identifier: Apache-2.0
/**
 * W07 / R-11 / F22 字符级格式工具条：加粗 / 字号 / 颜色 / 链接。
 *
 * ## 边界
 *
 * - **不持有内容**：只读当前聚焦输入框的选区，调 `features/resume/layout/inlineMarks`
 *   的纯规则算出新文本与新选区，再交给宿主 `onCommit`（宿主 setState + 恢复选区）。
 *   渲染的唯一实现仍在后端（HTML/PDF/Word 共用）；这里只负责"在选区上插入标记"。
 * - **不做第二套标记协议**：全部走 `toggleBoldMark` / `applyStyleMark` / `insertLinkMark`
 *   （URL 只收 http(s) 且 ≤512；字号系数夹在 0.5–1.6，与后端 `resume_inline_style` 一致）。
 * - **任意输入框**（F22）：`getTarget` 返回单行 `Input` 或多行 `Input.TextArea` 都行。
 *
 * ## 选区从哪来（三层，逐层降级）
 *
 * 1. 实时选区：`target.selectionStart/End` 非空 → 直接用；
 * 2. 记忆选区：`getRememberedRange()`（登记时挂的 select/keyup/mouseup 记下的最近一次非空
 *    选区）——点工具条那一拍选区可能已被折叠，但用户刚选过；
 * 3. 光标：两者都没有时用 `selectionStart` 作为插入点（链接用它，其余提示先选文字）。
 *
 * ## 为什么是受控 props
 *
 * 中栏表单的输入框由 `ItemEditor` / `itemValueEditors` 拥有；本组件只拿 `getTarget`
 * （读最近聚焦的输入框）、`getRememberedRange` 与 `onCommit`，不 import 任何宿主文件。
 */
import { BoldOutlined, FontSizeOutlined, LinkOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  ColorPicker,
  Dropdown,
  Input,
  InputNumber,
  Popover,
  Space,
  Tooltip,
} from "antd";
import type { MenuProps } from "antd";
import { useState, type ReactNode } from "react";
import { t, type MessageKey } from "../../../i18n";
import {
  applyStyleMark,
  inlineColorValue,
  insertLinkMark,
  INLINE_SIZE_STEPS,
  toggleBoldMark,
  type InlineEdit,
  type InlineRange,
  type InlineStylePatch,
} from "./inlineMarks";
import { useLocale } from "../../../i18n/i18nContext";
import type { InlineMarkField } from "../editor/lastFocusedTextarea";

export interface InlineMarkCommit {
  text: string;
  selection: { start: number; end: number };
}

interface Props {
  /** 读当前聚焦的编辑输入框；不传/返回 null = 暂无可编辑目标（点击给提示，不静默）。 */
  getTarget?: () => InlineMarkField | null;
  /**
   * 读"最近一次非空选区"（失焦后仍可用）。没有 = 不支持记忆，只按实时选区判断。
   */
  getRememberedRange?: () => InlineRange | null;
  /** 应用后写回草稿：宿主 setState(text) 并 setSelectionRange(selection)。 */
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

/** 6 个预设强调色：色板是**数据**（用户会把它存进内容），不是主题变量。 */
const COLOR_PRESETS = ["#c0392b", "#d97706", "#2f6fd0", "#2f855a", "#6b7280", "#111111"];

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
  onClick?: () => void;
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

/** Sample value shown in the custom size box. A number, not copy, so it is not translated. */
const CUSTOM_SIZE_HINT = 0.95;

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
  const [sizeOpen, setSizeOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customSize, setCustomSize] = useState<number | null>(null);

  const hint = (kind: keyof typeof HINT_KEYS) => message.info(t(HINT_KEYS[kind]));

  /**
   * 读这次点击要编辑哪一段：实时选区 → 记忆选区 → 光标。没有目标输入框才提示。
   *
   * 只有"连目标都没有"算硬失败：`typography.inline.noTarget`。空选区不算失败——链接
   * 需要它当插入点，其余由调用方自己决定要不要提示。
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
    // 真的没有选区：把光标位置交出去（链接用它当插入点，其余由这里拒绝）。
    const caret = Math.max(0, Math.min(rawStart, text.length));
    return { text, range: { start: caret, end: caret } };
  };

  /** 加粗/字号/颜色/清除：必须有非空选区；没有就播一句"先选文字"。 */
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

  const applyStyle = (patch: InlineStylePatch) => {
    const picked = requireSelection();
    if (picked) commitIfChanged(picked, applyStyleMark(picked.text, picked.range, patch));
  };

  const applyBold = () => {
    const picked = requireSelection();
    if (picked) commitIfChanged(picked, toggleBoldMark(picked.text, picked.range));
  };

  const applyColor = (color: { toHexString(): string }) => {
    const hex = inlineColorValue(color);
    if (hex) applyStyle({ color: hex });
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

  /**
   * 字号菜单：常用档 + 「100%（清除）」+ 自定义。
   *
   * 100% 走"清除"而不是写 `size=1`：相对系数 1 与不写等价，但后者会在源串里留一段
   * 看不见的标记，用户再看到文本框会以为内容坏了。
   */
  const sizeItems: MenuProps["items"] = [
    ...INLINE_SIZE_STEPS.slice(0, 2).map((step) => ({
      key: String(step),
      label: `${Math.round(step * 100)}%`,
    })),
    { key: "clear", label: t("typography.inline.sizeClear") },
    ...INLINE_SIZE_STEPS.slice(2).map((step) => ({
      key: String(step),
      label: `${Math.round(step * 100)}%`,
    })),
    { type: "divider" as const },
    { key: "custom", label: t("typography.inline.sizeCustom") },
  ];

  const onSizeMenuClick: MenuProps["onClick"] = ({ key }) => {
    if (key === "clear") {
      setSizeOpen(false);
      applyStyle({ size: null });
      return;
    }
    if (key === "custom") {
      setCustomMode(true);
      return;
    }
    setSizeOpen(false);
    applyStyle({ size: Number(key) });
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
      {/* R-11 / F22: inline font size and color. The mark wraps only the selection,
          it never restyles the rest of the paragraph. */}
      <Dropdown
        open={sizeOpen}
        trigger={["click"]}
        disabled={disabled}
        menu={{ items: sizeItems, onClick: onSizeMenuClick }}
        onOpenChange={(open, info) => {
          // 点「自定义字号」时菜单不该收起（自定义输入框就挂在菜单里）。
          if (!open && customMode && info.source === "menu") return;
          if (!open) setCustomMode(false);
          setSizeOpen(open);
        }}
        popupRender={(menu) => (
          <>
            {menu}
            {customMode ? (
              <div style={{ display: "flex", gap: 6, padding: "6px 8px", alignItems: "center" }}>
                <InputNumber
                  size="small"
                  // 0.5–1.6 与后端 `resume_inline_style.MIN_SIZE / MAX_SIZE` 一致：
                  // 越界值后端按字面保留，纸面上会印出 `{@size=3}`，所以前端先夹住。
                  min={0.5}
                  max={1.6}
                  step={0.05}
                  precision={2}
                  autoFocus
                  value={customSize}
                  aria-label={t("typography.inline.sizeCustomAria")}
                  placeholder={String(CUSTOM_SIZE_HINT)}
                  onChange={(value) => setCustomSize(typeof value === "number" ? value : null)}
                />
                <Button
                  size="small"
                  type="primary"
                  disabled={customSize === null}
                  onClick={() => {
                    if (customSize === null) return;
                    setSizeOpen(false);
                    setCustomMode(false);
                    applyStyle({ size: customSize });
                  }}
                >
                  {t("typography.inline.sizeApply")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      >
        <span>
          <MarkButton
            labelKey="typography.inline.size"
            ariaKey="typography.inline.sizeAria"
            icon={<FontSizeOutlined />}
            disabled={disabled}
          />
        </span>
      </Dropdown>
      <Tooltip title={t("typography.inline.color")}>
        <ColorPicker
          size="small"
          aria-label={t("typography.inline.color")}
          disabled={disabled || undefined}
          // ColorPicker 给的是 `AggregationColor`；颜色标记只认 hex，一律先 toHexString()。
          // `defaultValue` 只是色块初值（不是"当前选区已有颜色"的指示），给强调红避免透明色警告。
          defaultValue={COLOR_PRESETS[0]}
          allowClear
          disabledAlpha
          presets={[{ label: t("typography.inline.colorPresets"), colors: COLOR_PRESETS }]}
          onChange={applyColor}
          onClear={() => applyStyle({ color: null })}
        />
      </Tooltip>
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
