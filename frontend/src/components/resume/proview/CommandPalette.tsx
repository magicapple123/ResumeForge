// SPDX-License-Identifier: Apache-2.0
/**
 * 命令面板（D13）：可搜索全部高频操作 + 快捷键提示 + 最近使用。
 *
 * ## 为什么不是"再写一套动作"
 *
 * 面板里的每一条都调用**既有入口**（shell 传入的保存/导出等命令、画布的缩放/翻页
 * 等内置命令）。这里不实现任何业务动作，只做检索与分发——"面板里点了没反应"是这类
 * 功能最糟的失败形态。
 *
 * ## 键盘
 *
 * 焦点始终在搜索框（输入即过滤），↑↓ 移动高亮、Enter 执行、Esc 关闭；高亮项通过
 * `aria-activedescendant` 报给读屏。快捷键本身由快捷键系统（`commandPalette` 动作）
 * 触发，显示文本由 `formatShortcut` 按用户当前键位生成——不硬编码 Ctrl+K。
 */
import { App, Empty, Input, Modal, Typography } from "antd";
import type { InputRef } from "antd";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  cycleActiveIndex,
  filterCommands,
  pickKnownCommandIds,
  pushRecentCommandId,
  readRecentCommandIds,
} from "../../../features/resume-proview/commandPalette";
import type { ProviewCommand } from "../../../features/resume-proview/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 全部可用命令（宿主命令 + 画布内置命令，调用方负责顺序）。 */
  commands: readonly ProviewCommand[];
}

type EntrySection = "recent" | "all";

interface Entry {
  section: EntrySection;
  command: ProviewCommand;
}

/** 高亮/执行共用的条目列表：空查询 = 最近使用 + 其余；有查询 = 过滤结果。 */
function buildEntries(
  commands: readonly ProviewCommand[],
  filtered: readonly ProviewCommand[],
  recentIds: readonly string[],
): Entry[] {
  if (filtered.length !== commands.length || recentIds.length === 0) {
    return filtered.map((command) => ({ section: "all", command }));
  }
  const recent = pickKnownCommandIds(recentIds, commands)
    .map((id) => commands.find((command) => command.id === id))
    .filter((command): command is ProviewCommand => Boolean(command));
  const recentSet = new Set(recent.map((command) => command.id));
  return [
    ...recent.map((command): Entry => ({ section: "recent", command })),
    ...commands
      .filter((command) => !recentSet.has(command.id))
      .map((command): Entry => ({ section: "all", command })),
  ];
}

export default function CommandPalette({ open, onClose, commands }: Props) {
  useLocale();
  const { message } = App.useApp();
  const inputRef = useRef<InputRef | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  // 每次打开都从"空查询 + 最新最近使用"开始：上一次的搜索词与高亮不该带进来。
  useEffect(() => {
    if (!open) return;
    // 打开时重置搜索态属于外部同步：放进微任务，避开 effect 体里同步 setState 的级联渲染告警。
    queueMicrotask(() => {
      setQuery("");
      setActiveIndex(0);
      setRecentIds(readRecentCommandIds());
      inputRef.current?.focus();
    });
  }, [open]);

  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);
  const entries = useMemo(
    () => buildEntries(commands, filtered, query.trim() ? [] : recentIds),
    [commands, filtered, query, recentIds],
  );
  const active = entries.length > 0 ? Math.min(activeIndex, entries.length - 1) : -1;
  const listId = "resume-proview-command-list";

  const execute = (command: ProviewCommand) => {
    if (command.unavailable) {
      message.info(t("proview.command.unavailable"));
      return;
    }
    setRecentIds(pushRecentCommandId(command.id));
    onClose();
    command.run();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(cycleActiveIndex(active, event.key === "ArrowDown" ? 1 : -1, entries.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const entry = entries[active];
      if (entry) execute(entry.command);
    }
  };

  const renderEntry = (entry: Entry, index: number) => {
    const selected = index === active;
    return (
      <div
        key={entry.command.id}
        id={`${listId}-${entry.command.id}`}
        role="option"
        aria-selected={selected}
        aria-disabled={entry.command.unavailable || undefined}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => execute(entry.command)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "7px 10px",
          borderRadius: 6,
          cursor: entry.command.unavailable ? "not-allowed" : "pointer",
          opacity: entry.command.unavailable ? 0.45 : 1,
          background: selected ? "var(--rf-surface-alt)" : "transparent",
        }}
      >
        <span
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.command.label}
        </span>
        {entry.command.shortcut ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {entry.command.shortcut}
          </Typography.Text>
        ) : null}
      </div>
    );
  };

  return (
    <Modal
      open={open}
      title={t("proview.command.title")}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={560}
      afterOpenChange={(visible) => {
        if (visible) inputRef.current?.focus();
      }}
    >
      <Input
        ref={inputRef}
        autoFocus
        value={query}
        placeholder={t("proview.command.placeholder")}
        aria-label={t("proview.command.searchAria")}
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${entries[active]?.command.id}` : undefined}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
      />
      <div
        id={listId}
        role="listbox"
        aria-label={t("proview.command.title")}
        style={{ maxHeight: 320, overflowY: "auto", marginTop: 8 }}
      >
        {entries.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("proview.command.empty")}
            style={{ margin: "16px 0" }}
          />
        ) : (
          entries.map((entry, index) => (
            <Fragment key={entry.command.id}>
              {index === 0 || entries[index - 1].section !== entry.section ? (
                <Typography.Text
                  type="secondary"
                  style={{ display: "block", padding: "6px 10px 2px", fontSize: 12 }}
                >
                  {t(entry.section === "recent" ? "proview.command.recent" : "proview.command.all")}
                </Typography.Text>
              ) : null}
              {renderEntry(entry, index)}
            </Fragment>
          ))
        )}
      </div>
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 10, fontSize: 12 }}>
        {t("proview.command.hint")}
      </Typography.Text>
    </Modal>
  );
}
