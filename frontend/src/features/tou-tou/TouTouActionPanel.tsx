// SPDX-License-Identifier: Apache-2.0
/**
 * 投投动作面板（#27C）：长按球 400ms 或 Ctrl/Cmd+K 打开。
 *
 * 内容 = **本页前 5 个动作** + **搜索全部动作**（+ 有选中文本时的划词动作 + 顺便问）。
 * 解决"70 个工具看不见"的问题，同时不把 70 个按钮塞进面板。
 *
 * ## 键盘与焦点
 *
 * - 打开即聚焦搜索框；输入即过滤，而过滤范围是**全部动作**（这就是"搜索全部"）；
 * - ↑↓ 移动高亮、Enter 执行、Esc 关闭，高亮项通过 `aria-activedescendant` 报给读屏；
 * - **焦点不逃出面板**：`Tab` 由本组件接管，在搜索框 / 侧问框 / 发送 / 关闭 / 恢复按钮之间
 *   循环，不会跑到背后的页面上（详册验收项）；
 * - `Alt+Enter` 在侧问框里发送（#27E）。
 *
 * 面板只做检索与分发：每个条目都转给宿主（球）的 runtime 执行，本身不实现业务动作。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "antd";
import type { InputRef } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { TouTouAction } from "./touTouPageContext";
import { searchTouTouActions } from "./touTouActions";
import {
  REGION_LABEL_KEYS,
  selectionActionLabelKey,
  selectionActionsForRegion,
  type DomSelectionSnapshot,
  type TouTouSelectionActionId,
} from "./touTouSelection";
import "./tou-tou-panel.css";

export interface TouTouActionPanelProps {
  pageActions: readonly TouTouAction[];
  /** 打开面板那一刻的选中文本（键盘入口打开时由宿主快照）。 */
  selection: DomSelectionSnapshot | null;
  onRunAction: (actionId: string) => void;
  onRunSelectionAction: (action: TouTouSelectionActionId, snapshot: DomSelectionSnapshot) => void;
  /** 发一次侧问并拿回答（#27E；宿主负责请求与错误文案）。 */
  onSideAsk: (question: string) => Promise<string>;
  /**
   * 划词动作的"直接问"：面板一打开就带着这条指令发一次侧问（改写/STAR/找数字…）。
   * 用 ref 防重（面板自己的 state 变化会让 `onSideAsk` 换成新引用）。
   */
  autoAsk?: string | null;
  /** 打开即展示的结果（复制/存资料库/查重复的本地结果，不经过模型）。 */
  initialResult?: { title: string; text: string } | null;
  mutedCount: number;
  onRestoreMuted: () => void;
  onClose: () => void;
}

interface PanelItem {
  key: string;
  labelKey: Parameters<typeof t>[0];
  section: "selection" | "page" | "search";
  actionId?: string;
  selectionAction?: TouTouSelectionActionId;
}

const FOCUSABLE = 'input, textarea, button:not([disabled]), [role="option"][tabindex]';

/** 面板分区的固定顺序与标题 key。分区 id 是内部协议值（不是界面文案）。 */
const SECTION_ORDER: readonly PanelItem["section"][] = ["selection", "page", "search"];
const SECTION_TITLE_KEYS: Record<PanelItem["section"], Parameters<typeof t>[0]> = {
  selection: "touTou.panel.selectionSection",
  page: "touTou.panel.pageSection",
  search: "touTou.panel.allSection",
};

export default function TouTouActionPanel({
  pageActions,
  selection,
  onRunAction,
  onRunSelectionAction,
  onSideAsk,
  autoAsk = null,
  initialResult = null,
  mutedCount,
  onRestoreMuted,
  onClose,
}: TouTouActionPanelProps) {
  useLocale();
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<InputRef | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(initialResult?.text ?? null);
  const [answerTitle, setAnswerTitle] = useState(initialResult?.title ?? "");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 自动侧问只发一次：`onSideAsk` 是宿主的内联函数，重渲染会换引用。 */
  const autoAskStartedRef = useRef(false);

  useEffect(() => {
    searchRef.current?.focus();
    // 长按松手可能把焦点还给球按钮：下一帧再移入，并在捕获阶段保证 Esc 可关闭。
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.focus();
      searchRef.current?.focus();
    });
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onEscape, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onEscape, true);
    };
  }, [onClose]);

  const items = useMemo<PanelItem[]>(() => {
    const list: PanelItem[] = [];
    if (selection) {
      for (const action of selectionActionsForRegion(selection.region)) {
        list.push({
          key: `selection:${action}`,
          labelKey: selectionActionLabelKey(action),
          section: "selection",
          selectionAction: action,
        });
      }
    }
    for (const action of pageActions) {
      list.push({
        key: `page:${action.id}`,
        labelKey: action.labelKey,
        section: "page",
        actionId: action.id,
      });
    }
    if (query.trim()) {
      for (const definition of searchTouTouActions(query, t)) {
        const key = `search:${definition.id}`;
        if (list.some((item) => item.key === key)) continue;
        list.push({
          key,
          labelKey: definition.labelKey,
          section: "search",
          actionId: definition.id,
        });
      }
    }
    return list;
  }, [pageActions, query, selection]);

  const active = items.length > 0 ? Math.min(activeIndex, items.length - 1) : -1;
  const listId = "tt-panel-list";
  const itemId = (index: number) => `${listId}-${index}`;

  const runItem = (item: PanelItem) => {
    if (item.selectionAction && selection) {
      onRunSelectionAction(item.selectionAction, selection);
      return;
    }
    if (item.actionId) onRunAction(item.actionId);
  };

  const cycleFocus = (backwards: boolean) => {
    const focusables = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    );
    if (focusables.length === 0) return;
    const index = focusables.findIndex((element) => element === document.activeElement);
    const delta = backwards ? -1 : 1;
    const next = index === -1 ? 0 : (index + delta + focusables.length) % focusables.length;
    focusables[next]?.focus();
  };

  const ask = async (text: string) => {
    setAsking(true);
    setError(null);
    try {
      const reply = await onSideAsk(text);
      setAnswerTitle(t("touTou.panel.answerTitle"));
      setAnswer(reply);
    } catch (cause) {
      setError(
        t("touTou.panel.failed", {
          reason: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    } finally {
      setAsking(false);
    }
  };

  // 划词动作直接问：打开即发（只发一次）。
  useEffect(() => {
    if (!autoAsk || autoAskStartedRef.current) return;
    autoAskStartedRef.current = true;
    void ask(autoAsk);
    // ask 每次渲染都是新函数：这里刻意只依赖 autoAsk，用 ref 防重。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAsk]);

  const sendSideAsk = () => {
    const text = question.trim();
    if (!text) {
      setError(t("touTou.panel.sideAskEmpty"));
      return;
    }
    void ask(text);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      cycleFocus(event.shiftKey);
      return;
    }
    // 只有事件真的来自搜索框才走"↑↓ 高亮 / Enter 执行"：焦点可能还停在搜索框，
    // 但用户是在侧问框里按 Alt+Enter，不能把 Enter 解释成"执行当前动作"。
    if (event.target !== searchRef.current?.input) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        const next = (Math.min(current, items.length - 1) + delta + items.length) % items.length;
        return next;
      });
      return;
    }
    if (event.key === "Enter") {
      const item = items[active];
      if (!item) return;
      event.preventDefault();
      runItem(item);
    }
  };

  /** 渲染一个分区：按固定顺序，空分区不渲染。 */
  const renderSection = (section: PanelItem["section"]) => {
    const sectionItems = items.filter((item) => item.section === section);
    if (sectionItems.length === 0) return null;
    const title = t(SECTION_TITLE_KEYS[section]);
    return (
      <div className="tt-panel-section" key={section}>
        <p className="tt-panel-section-title">{title}</p>
        <div role="group" aria-label={title}>
          {sectionItems.map((item) => {
            const index = items.indexOf(item);
            return (
              <div
                key={item.key}
                id={itemId(index)}
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                aria-label={t(item.labelKey)}
                className={`tt-panel-item${index === active ? " is-active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runItem(item)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  runItem(item);
                }}
              >
                {t(item.labelKey)}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="tt-panel-overlay" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="tt-panel"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={t("touTou.panel.title")}
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="tt-panel-head">
          <h2 className="tt-panel-title">{t("touTou.panel.title")}</h2>
          <Button size="small" type="text" onClick={onClose} aria-label={t("touTou.panel.close")}>
            ×
          </Button>
        </header>

        {answer === null ? (
          <>
            {asking ? (
              <p className="tt-panel-asking" role="status">
                {t("touTou.panel.asking")}
              </p>
            ) : null}
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              placeholder={t("touTou.panel.searchPlaceholder")}
              aria-label={t("touTou.panel.searchPlaceholder")}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={active >= 0 ? itemId(active) : undefined}
            />
            <div
              className="tt-panel-list"
              id={listId}
              role="listbox"
              aria-label={t("touTou.panel.title")}
            >
              {selection ? (
                <p className="tt-panel-region">{t(REGION_LABEL_KEYS[selection.region])}</p>
              ) : null}
              {SECTION_ORDER.map((section) =>
                section === "search" && !query.trim() ? null : renderSection(section),
              )}
              {items.length === 0 ? (
                <p className="tt-panel-empty">{t("touTou.panel.empty")}</p>
              ) : null}
            </div>

            <div className="tt-panel-side-ask">
              <p className="tt-panel-hint">{t("touTou.panel.sideAskHint")}</p>
              <Input.TextArea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.altKey) {
                    event.preventDefault();
                    sendSideAsk();
                  }
                }}
                placeholder={t("touTou.panel.sideAskPlaceholder")}
                aria-label={t("touTou.panel.sideAskPlaceholder")}
                autoSize={{ minRows: 2, maxRows: 4 }}
              />
              <div className="tt-panel-actions">
                {mutedCount > 0 ? (
                  <Button size="small" onClick={onRestoreMuted}>
                    {t("touTou.panel.restoreMuted")}
                  </Button>
                ) : null}
                <Button size="small" type="primary" loading={asking} onClick={sendSideAsk}>
                  {t("touTou.panel.sideAskSend")}
                </Button>
              </div>
              {error ? (
                <p className="tt-panel-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <div className="tt-panel-answer">
            <p className="tt-panel-section-title">{answerTitle || t("touTou.panel.answerTitle")}</p>
            <p className="tt-panel-answer-text" role="status">
              {answer}
            </p>
            <div className="tt-panel-actions">
              <Button
                size="small"
                onClick={() => {
                  setAnswer(null);
                  setAnswerTitle("");
                  setQuestion("");
                }}
              >
                {t("touTou.panel.back")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
