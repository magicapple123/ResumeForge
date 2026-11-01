// SPDX-License-Identifier: Apache-2.0
/**
 * 条目头：序号 / 隐藏徽标 / 三种标题布局的图标按钮（R-05 ⑤）/「⋯」菜单。
 *
 * ## 为什么单独成文件
 *
 * 五种条目动作（上移 / 下移 / 复制 / 隐藏 / 移除）在 R-05 之后收进了**同一个菜单**，
 * 右键与「⋯」按钮指向它；这段菜单定义 + 图标按钮组 + 键盘等价物（Shift+F10）加起来
 * 一百多行，留在 `EntryCard` 里会把那个文件顶到 500 行预算边缘。
 *
 * ## 交互契约（不要删）
 *
 * - 菜单由 `open` / `onOpenChange` **受控**：右键（`trigger: contextMenu`）、`⋯` 按钮、
 *   Shift+F10 / 菜单键三条入口都只是把 `open` 置 true；
 * - 布局按钮与「⋯」都要 `stopPropagation`：它们挂在右键菜单的触发区里，不拦的话
 *   点一下会同时打开菜单；
 * - 可访问名仍是「左右 / 上下 / 元信息在上」（`aria-label` + `aria-pressed`），
 *   测试与读屏都靠它，图标本身 `aria-hidden`。
 */
import {
  ColumnHeightOutlined,
  EllipsisOutlined,
  SwapOutlined,
  VerticalAlignTopOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import type { ReactNode } from "react";
import { useState } from "react";
import type { MessageKey } from "../../i18n";
import { useI18n } from "../../i18n/i18nContext";
import type { ResumeDocument, ResumeEntry, ResumeSection } from "../../types/resumeDocument";
import {
  copyEntry,
  entryPath as buildEntryPath,
  moveEntry,
  removeEntry,
  setEntryHeadLayout,
  toggleEntryHidden,
} from "../../features/resume-document";

type HeadLayout = ResumeEntry["layout"]["head"];

/**
 * 三种标题布局：语义靠 tooltip + `aria-label`，视觉只给一个图标。
 *
 * 原来是 antd `Segmented`：三个中文词占 180px，320–360px 的窄中栏里把 `#1` 与操作按钮
 * 挤到换行；换成图标后同样是三选一，只占 84px。
 */
type HeadLayoutSpec = readonly [HeadLayout, MessageKey, ReactNode];

const HEAD_LAYOUTS: readonly HeadLayoutSpec[] = [
  ["split", "document.entry.headLayout.split", <SwapOutlined aria-hidden="true" />],
  ["stacked", "document.entry.headLayout.stacked", <ColumnHeightOutlined aria-hidden="true" />],
  [
    "meta_first",
    "document.entry.headLayout.meta_first",
    <VerticalAlignTopOutlined aria-hidden="true" />,
  ],
];

interface Props {
  document: ResumeDocument;
  section: ResumeSection;
  entry: ResumeEntry;
  entryIndex: number;
  entryPath: string;
  readOnly?: boolean;
  onChange: (next: ResumeDocument) => void;
  onSelectPath: (path: string | null) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
}

export default function EntryCardHead({
  document,
  section,
  entry,
  entryIndex,
  entryPath,
  readOnly = false,
  onChange,
  onSelectPath,
  onNotice,
}: Props) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);

  /** 五种条目动作共用一份菜单：`⋯` 按钮与右键菜单指向同一个 `entryMenu`。 */
  const entryActions: Record<string, () => void> = {
    moveUp: () => onChange(moveEntry(document, entryPath, "up")),
    moveDown: () => onChange(moveEntry(document, entryPath, "down")),
    copy: () => {
      const copied = copyEntry(document, entryPath);
      onChange(copied.document);
      if (copied.entryId) onSelectPath(buildEntryPath(section.key, copied.entryId));
      onNotice(t("document.toast.entryCopied"), "info");
    },
    toggle: () => {
      onChange(toggleEntryHidden(document, entryPath));
      onNotice(entry.hidden ? t("document.toast.shown") : t("document.toast.hidden"), "info");
    },
    remove: () => {
      onChange(removeEntry(document, entryPath));
      onNotice(t("document.toast.entryRemoved"), "info");
    },
  };

  const entryMenuItems: MenuProps["items"] = [
    { key: "moveUp", label: t("document.entry.moveUp"), disabled: entryIndex === 0 },
    {
      key: "moveDown",
      label: t("document.entry.moveDown"),
      disabled: entryIndex >= section.entries.length - 1,
    },
    { key: "copy", label: t("document.entry.copy") },
    { type: "divider" as const, key: "divider" },
    {
      key: "toggle",
      label: entry.hidden ? t("document.entry.show") : t("document.entry.hide"),
    },
    { key: "remove", label: t("document.entry.remove"), danger: true },
  ];

  const menu: MenuProps = {
    items: entryMenuItems,
    onClick: ({ key }) => {
      setMenuOpen(false);
      entryActions[key]?.();
    },
  };

  return (
    <Dropdown
      menu={menu}
      trigger={["contextMenu"]}
      disabled={readOnly}
      open={menuOpen}
      onOpenChange={setMenuOpen}
    >
      <div
        className="document-entry-head"
        tabIndex={readOnly ? undefined : 0}
        onKeyDown={(event) => {
          // Shift+F10 / 菜单键是右键菜单的键盘等价物；只在条目头自身聚焦时响应，
          // 不抢内部按钮与布局按钮的按键。
          if (event.target !== event.currentTarget) return;
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            setMenuOpen(true);
          }
        }}
      >
        <span className="document-entry-index">#{entryIndex + 1}</span>
        {entry.hidden ? (
          <span className="document-chip-badge">{t("document.entry.hidden")}</span>
        ) : null}
        <span
          className="document-entry-head-layout"
          role="group"
          aria-label={t("document.entry.headLayout")}
        >
          {HEAD_LAYOUTS.map(([value, labelKey, icon]) => {
            const active = entry.layout.head === value;
            return (
              <Tooltip key={value} title={t(labelKey)}>
                <Button
                  size="small"
                  type="text"
                  className={`document-entry-layout-btn${active ? " is-active" : ""}`}
                  aria-label={t(labelKey)}
                  aria-pressed={active}
                  disabled={readOnly}
                  icon={icon}
                  onClick={(event) => {
                    event.stopPropagation();
                    onChange(setEntryHeadLayout(document, entryPath, value));
                  }}
                />
              </Tooltip>
            );
          })}
        </span>
        {!readOnly ? (
          <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            menu={{
              items: entryMenuItems,
              onClick: ({ key }) => entryActions[key]?.(),
            }}
          >
            <Tooltip title={t("document.entry.more")}>
              <Button
                size="small"
                type="text"
                className="document-entry-more"
                aria-label={t("document.entry.more")}
                aria-haspopup="menu"
                icon={<EllipsisOutlined />}
                onClick={(event) => event.stopPropagation()}
              />
            </Tooltip>
          </Dropdown>
        ) : null}
      </div>
    </Dropdown>
  );
}
