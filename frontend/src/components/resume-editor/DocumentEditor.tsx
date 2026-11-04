// SPDX-License-Identifier: Apache-2.0
/**
 * v2 文档编辑器（制作台中栏的主体，2026-10-30 三区卡重写）。
 *
 * ## 边界
 *
 * - 只编辑 `ResumeDocument`：所有变更通过 `onChange(next)` 一个出口回流，工作台据此
 *   记历史 / 保存 / 联动预览；编辑器不自己发请求、不持有第二份文档；
 * - 纸面排布由后端 planner 决定，这里只做"字段编辑 + 顺序/位置 + 三区分组预览"；
 * - 拖拽与键盘等价物都在 item chip 上（见 ItemChip），非法目标给可读提示。
 *
 * ## 页签
 *
 * 固定第一个「基本信息」页签（页眉 items），其余页签来自 document.sections（含自建板块）。
 * `selectedPath` 指向别的板块时自动切到那个页签——结构面板 / 预览点过来不需要工作台
 * 自己算页签。
 */
import { Dropdown } from "antd";
import type { MenuProps } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useI18n } from "../../i18n/i18nContext";
import type { DocumentFieldCatalog, ResumeDocument } from "../../types/resumeDocument";
import {
  buildFallbackCatalog,
  catalogSectionOf,
  ensureIds,
  entryPath,
  locatePath,
  needsIds,
  parseDocumentPath,
  sectionKeyOfPath,
} from "../../features/resume-document";
import {
  removeItem,
  removeSection,
  toggleItemHidden,
} from "../../features/resume-document/mutations";
import DocumentHeaderPanel from "./DocumentHeaderPanel";
import DocumentSectionTabs, { type DocumentSectionTabItem } from "./DocumentSectionTabs";
import SectionEditor from "./SectionEditor";
import { DocumentDragContext, useDocumentDragHost } from "./documentDragContext";
import { hasActiveTextSelection } from "../../features/context-menu/selectionGuard";
import { DocumentChipMenuContext, type ChipMenuRequest } from "./documentChipMenuContext";
import "./document-editor.css";
import "./chip-menu.css";
import { useChipMenuDismiss } from "./useChipMenuDismiss";
import { DocumentExpandContext } from "./documentExpandContext";
import ChipStylePopover, { type ChipStylePopoverState } from "./ChipStylePopover";
import DocumentNotice, { type NoticeState } from "./DocumentNotice";
import type { ResumeLayout } from "../../types";
import type { ResumeFormatConfig } from "../../types/resumeFormat";

const BASIC_TAB = "basic";

export interface DocumentEditorProps {
  /** 当前 v2 文档（受控）。 */
  document: ResumeDocument;
  /** #7：右键「调整排版」需要的版式通道（缺省 = 不提供该项）。 */
  layout?: ResumeLayout | null;
  onLayoutChange?: (next: ResumeLayout) => void;
  /** 所有编辑（文本 / 结构 / 位置 / 顺序）的唯一回流口。 */
  onChange: (next: ResumeDocument) => void;
  /** 受控选中：header/section/entry/item 四种路径。 */
  selectedPath?: string | null;
  onSelectPath?: (path: string | null) => void;
  /** 悬停字段（预览描边联动）。 */
  onHoverPath?: (path: string | null) => void;
  /**
   * 选中定位序号（R-14）：宿主任一选中来源变化都 +1。变化后把选中条目卡滚到可视区顶部，
   * 纸面点第 3 页的条目也能直接落到中栏那张卡上（页签切换是渲染期完成的，必须等下一帧）。
   */
  revealNonce?: number;
  readOnly?: boolean;
  /** 后端字段目录；缺省用内置 fallback（只影响"添加字段"菜单与枚举显示）。 */
  fieldCatalog?: DocumentFieldCatalog | null;
  /** 自建板块入口；缺省不渲染「添加板块」。 */
  onAddSection?: () => void;
  /**
   * #19 双入口：正文要点/字段右键菜单里的「收藏为资产」。缺省 = 不渲染这一项
   * （资产面板由宿主按需接线；菜单的关闭/定位逻辑与这一项无关）。
   */
  onCollectAsset?: (path: string) => void;
  /**
   * 问题 14：提示条的宿主节点。宿主播在**滚动容器之外**（中栏 `.resume-wb-v2-editor`
   * 的直接子级）时，提示条不再随内容滚走，长条目下停在顶部也能看到；
   * 不传 = 回退成原来的流内渲染（生成预览等没有宿主的场景）。
   */
  noticeHost?: HTMLElement | null;
  className?: string;
}

export default function DocumentEditor({
  document,
  onChange,
  selectedPath = null,
  onSelectPath,
  onHoverPath,
  revealNonce = 0,
  layout = null,
  onLayoutChange,

  readOnly = false,
  fieldCatalog = null,
  onAddSection,
  onCollectAsset,
  noticeHost = null,
  className,
}: DocumentEditorProps) {
  const { t } = useI18n();
  const [activeKey, setActiveKey] = useState<string>(BASIC_TAB);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  /**
   * 字段右键菜单的当前目标（R-30 第 5 项）：整个编辑器只有这一份菜单，
   * 不再每个 chip 各包一个 Dropdown。null = 关着。
   */
  const [chipMenu, setChipMenu] = useState<ChipMenuRequest | null>(null);
  // #8：展开（字段编辑器可见）与选中（高亮/联动/定位）分离——单击只选中，双击/F2 才展开。
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  // #7：右键「调整排版」浮层（layout 通道存在时才有这项）。
  const [stylePopover, setStylePopover] = useState<ChipStylePopoverState | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const revealFrame = useRef(0);
  /**
   * A3/#8 返工：本编辑器内部的点击（chip / F2 / 双击）引起的选中**不要**触发中栏定位滚动。
   * 用户点的东西本来就在眼前，滚动只会把刚点中的 chip 从指针下挪走——真实双击（两下间隔
   * ~100ms）的第二下就会落到别的 chip 上。纸面/结构树的选中照旧定位（它们不经过这里）。
   */
  const suppressRevealRef = useRef(false);
  // R-14：选中定位。连续点击时同一句柄取消上一帧——`smooth` 滚动会排队，排到后来像卡住。
  // #3：只滚编辑器自己的滚动容器（root 本身 overflow:auto，见 workbench-v2.css）。
  // `scrollIntoView` 会把祖先链上每个可滚盒子都滚一遍去满足"贴顶"，外层工作台因此被
  // 整体抬起；定向 scrollTo 外层一律不动。目标已在可视区（|delta| ≤ 1）时不滚，
  // 避免"点一下整体抖一下"。编排器不可滚时直接返回，不退回滚动祖先。
  useEffect(() => {
    if (!revealNonce || !selectedPath) return;
    if (suppressRevealRef.current) {
      suppressRevealRef.current = false;
      return;
    }
    revealFrame.current = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      const parsed = parseDocumentPath(selectedPath);
      const entryKey =
        parsed?.kind === "entry"
          ? entryPath(parsed.sectionKey, parsed.entryId)
          : parsed?.kind === "item"
            ? entryPath(parsed.sectionKey, parsed.entryId)
            : null;
      const target =
        (entryKey && root.querySelector<HTMLElement>(`[data-document-entry="${entryKey}"]`)) ||
        root.querySelector<HTMLElement>(`[data-document-path="${selectedPath}"]`);
      if (!target) return;
      const scroller = root.scrollHeight > root.clientHeight ? root : null;
      if (!scroller) return;
      const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8; // 保留原先 scroll-margin-top: 8px 的语义
      if (Math.abs(delta) <= 1) return;
      scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: "smooth" });
    });
    return () => {
      if (revealFrame.current) cancelAnimationFrame(revealFrame.current);
    };
  }, [revealNonce, selectedPath]);

  // 打开文档时补齐缺失 id（只在真的缺 id 时做一次；完整文档不触发 onChange，避免标脏）。
  useEffect(() => {
    if (needsIds(document)) onChange(ensureIds(document));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fallbackCatalog = useMemo(() => buildFallbackCatalog(t), [t]);
  const catalog = fieldCatalog ?? fallbackCatalog;

  const tabs = useMemo<DocumentSectionTabItem[]>(() => {
    const items: DocumentSectionTabItem[] = [{ key: BASIC_TAB, label: t("document.basic.title") }];
    for (const section of document.sections) {
      const catalogTitle = catalogSectionOf(catalog, section.key)?.title ?? "";
      items.push({
        key: section.key,
        label: section.layout.title_override || section.title || catalogTitle || section.key,
      });
    }
    return items;
  }, [catalog, document.sections, t]);

  // 选中项属于别的板块时自动切页签（渲染期守卫，与既有面板同一写法）。
  // #10：页眉字段（`header.<id>`）必须切回「基本信息」页签——否则从结构树/纸面点一条
  // 页眉字段时，中栏停在上一个板块里，chip 与它的展开编辑器都不在眼前，"定位"等于没做。
  const selectedParsed = parseDocumentPath(selectedPath);
  const selectedSection = sectionKeyOfPath(selectedPath);
  const wantedKey =
    selectedParsed?.kind === "header"
      ? BASIC_TAB
      : selectedSection && document.sections.some((section) => section.key === selectedSection)
        ? selectedSection
        : null;
  const [followedPath, setFollowedPath] = useState<string | null>(null);
  if (wantedKey && wantedKey !== activeKey && selectedPath !== followedPath) {
    setFollowedPath(selectedPath);
    setActiveKey(wantedKey);
  }

  const activeSection = document.sections.find((section) => section.key === activeKey) ?? null;
  const select = (path: string | null) => {
    setNotice(null);
    // 选中变化时编辑器跟着注意力走：旧 chip 的展开编辑器收起（双击/F2 再展开）。
    setExpandedPath(null);
    // 编辑器内部的选中不滚动中栏（见 suppressRevealRef 的说明）。只在选中真的变化时
    // 置标记——否则标记会留到下一次纸面/结构树选中，把该有的定位吞掉。
    if (path !== selectedPath) suppressRevealRef.current = true;
    onSelectPath?.(path);
  };
  const setExpanded = useCallback(
    (path: string | null) => {
      setNotice(null);
      setExpandedPath(path);
      if (path && selectedPath !== path) {
        suppressRevealRef.current = true;
        onSelectPath?.(path);
      }
    },
    [onSelectPath, selectedPath],
  );
  const toggleExpand = useCallback(
    (path: string) => {
      setNotice(null);
      if (expandedPath === path) {
        setExpandedPath(null);
        return;
      }
      setExpandedPath(path);
      if (selectedPath !== path) {
        suppressRevealRef.current = true;
        onSelectPath?.(path);
      }
    },
    [expandedPath, onSelectPath, selectedPath],
  );
  const report = (text: string, tone: "info" | "warning" = "info") => setNotice({ text, tone });

  /**
   * 任务 11 返工：删除自建板块（`custom:` 前缀；系统板块只能隐藏/改标题，没有删除语义）。
   * `section-remove` 是离散操作，`recordDraft` 会立刻 flush 成一步，Ctrl+Z 可整块还原。
   * 删完把选中交给相邻板块：优先后一个，删的正好是最后一个就落到前一个，删空回「基本信息」。
   */
  const handleRemoveSection = (sectionKey: string) => {
    if (!sectionKey.startsWith("custom:")) return;
    const index = document.sections.findIndex((section) => section.key === sectionKey);
    if (index < 0) return;
    const removed = document.sections[index];
    const neighbour = document.sections[index + 1] ?? document.sections[index - 1] ?? null;
    onChange(removeSection(document, sectionKey));
    setActiveKey(neighbour ? neighbour.key : BASIC_TAB);
    select(neighbour ? neighbour.key : null);
    // 提示必须排在 `select` 之后：`select` 的第一件事就是清掉上一条提示。
    const section = removed.layout.title_override || removed.title || sectionKey;
    report(t("document.section.removed", { section }));
  };

  /** chip 请求开菜单（键盘 Shift+F10 / 菜单键走这条）；只读时不弹。 */
  const requestChipMenu = useCallback(
    (request: ChipMenuRequest) => {
      if (readOnly) return;
      setChipMenu(request);
    },
    [readOnly],
  );
  /**
   * #7：条目卡右键菜单的「排版整条…」——范围锁定为**整条**（`objects[<entryId>]`），
   * 走的还是同一个排版浮层；没有 layout 通道（宿主没给 onLayoutChange）时不接。
   */
  const requestEntryStyle = useCallback(
    (request: ChipMenuRequest) => {
      if (readOnly || !onLayoutChange) return;
      setStylePopover({ path: request.path, x: request.x, y: request.y });
    },
    [onLayoutChange, readOnly],
  );
  const chipMenuHost = useMemo(
    () => ({ request: requestChipMenu, requestStyle: requestEntryStyle }),
    [requestChipMenu, requestEntryStyle],
  );
  /**
   * 任务 6：`format_config` 的写回通道（照片裁剪参数住在它的 `photo_crop` 域里）。
   * 宿主没接 `onLayoutChange` 时返回 `undefined`——那表示"这一屏没有版式通道"，
   * 裁剪会明确禁用而不是静默丢掉结果。
   */
  const commitFormatConfig = useMemo(() => {
    if (!onLayoutChange || !layout) return undefined;
    return (next: ResumeFormatConfig) => onLayoutChange({ ...layout, format_config: next });
  }, [layout, onLayoutChange]);
  const expandHost = useMemo(
    () => ({ expandedPath, toggleExpand, setExpanded }),
    [expandedPath, setExpanded, toggleExpand],
  );
  // 拖拽上下文（`rejectRef` 身份稳定，文档变化不会让所有 chip 重渲染）。
  const dragHost = useDocumentDragHost(draggedPath, setDraggedPath);

  /** 右键事件委托：命中最近的、带 `data-document-path` 的字段 chip 才接管。 */
  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const node = (event.target as HTMLElement | null)?.closest?.("[data-document-path]");
    const path = node?.getAttribute("data-document-path");
    if (!path) return;
    /**
     * 选中了文字就让位给选区菜单（AI 润色那一层）：两套监听都处理同一个 `contextmenu`
     * 时，屏幕上会叠出两张卡片（2026-11-04 用户实测）。字段动作（收藏/排版/隐藏/移除）
     * 是"没选字时对整块的操作"，选字后用户要的是剪切/复制/润色。
     */
    if (hasActiveTextSelection()) return;
    event.preventDefault();
    setChipMenu({ path, x: event.clientX, y: event.clientY });
  };

  const closeChipMenu = useCallback(() => setChipMenu(null), []);
  const chipMenuTarget = chipMenu ? locatePath(document, chipMenu.path) : null;
  // #6：滚动/resize/失焦也关菜单（antd 只覆盖点外面与 Esc；浮层锚点滚走会错位）。
  useChipMenuDismiss(chipMenu !== null, closeChipMenu, { closeOnOutsidePointer: true });
  const chipMenuItem =
    chipMenuTarget && (chipMenuTarget.kind === "item" || chipMenuTarget.kind === "header")
      ? chipMenuTarget.item
      : null;
  // 页眉字段与板块内字段的 `placement` 枚举不同（HeaderPlacement vs Placement），
  // 但"隐藏"在两边的取值都是 `"hidden"`；TextItem 没有 placement，只带一个 hidden 布尔。
  const chipMenuHidden = chipMenuItem
    ? chipMenuItem.kind === "text"
      ? chipMenuItem.hidden
      : chipMenuItem.placement === "hidden"
    : false;
  const chipMenuItems: MenuProps["items"] = [
    // #19 双入口之一：宿主接了收藏回调时，正文 item（含要点文本块）多一项「收藏为资产」。
    ...(onCollectAsset && chipMenuTarget?.kind === "item"
      ? [
          { key: "collect", label: t("assets.action.collect") },
          { type: "divider" as const, key: "collect-divider" },
        ]
      : []),
    // #7 的「调整排版」只对可排版的正文 item 有语义（页眉字段没有条目/位置样式可调）。
    ...(onLayoutChange && chipMenuTarget?.kind === "item"
      ? [
          { key: "style", label: t("document.editor.styleEntry") },
          { type: "divider" as const, key: "style-divider" },
        ]
      : []),
    { key: "toggle", label: chipMenuHidden ? t("document.item.show") : t("document.item.hide") },
    { key: "remove", label: t("document.item.remove"), danger: true },
  ];
  const onChipMenuClick: MenuProps["onClick"] = ({ key }) => {
    const path = chipMenu?.path;
    const anchor = chipMenu;
    setChipMenu(null);
    if (!path) return;
    if (key === "collect") {
      onCollectAsset?.(path);
      return;
    }
    if (key === "style" && anchor) {
      setStylePopover({ path, x: anchor.x, y: anchor.y });
      return;
    }
    if (key === "toggle") {
      onChange(toggleItemHidden(document, path));
      report(chipMenuHidden ? t("document.toast.shown") : t("document.toast.hidden"), "info");
      return;
    }
    if (key === "remove") {
      onChange(removeItem(document, path));
      report(t("document.toast.fieldRemoved"), "info");
    }
  };

  /** A3：Esc 的层级——菜单/浮层 → 编辑器 → 选中 → 最后才放行给 antd Modal 关制作台。 */
  const handleEscCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    if (chipMenu) {
      event.preventDefault();
      event.stopPropagation();
      closeChipMenu();
      return;
    }
    if (stylePopover) {
      event.preventDefault();
      event.stopPropagation();
      setStylePopover(null);
    }
  };

  /**
   * A3：焦点在展开出来的字段编辑器里（输入框 / 下拉）时，Esc 也先收编辑器并**把焦点还给
   * chip**——否则编辑器一收起，焦点落回 body，键盘用户会失去位置。
   */
  const handleEscBubble = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    const target = event.target as HTMLElement | null;
    const editorNode = target?.closest?.(
      "[data-document-item-editor], .document-header-editor",
    ) as HTMLElement | null;
    if (!editorNode) return;
    event.preventDefault();
    event.stopPropagation();
    setExpandedPath(null);
    const path =
      editorNode.getAttribute("data-document-item-editor") ??
      editorNode.getAttribute("data-document-path") ??
      "";
    if (!path) return;
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-document-path="${path}"] .document-chip-main`)
      ?.focus();
  };

  return (
    <DocumentExpandContext.Provider value={expandHost}>
      <DocumentDragContext.Provider value={dragHost}>
        <DocumentChipMenuContext.Provider value={chipMenuHost}>
          <div
            ref={rootRef}
            className={`document-editor${className ? ` ${className}` : ""}`}
            data-document-editor=""
            aria-label={t("document.editor.region")}
            onContextMenu={handleContextMenu}
            onKeyDownCapture={handleEscCapture}
            onKeyDown={handleEscBubble}
          >
            <DocumentSectionTabs
              items={tabs}
              activeKey={activeSection ? activeKey : BASIC_TAB}
              readOnly={readOnly}
              onAddSection={onAddSection}
              // 只读时由 DocumentSectionTabs 自己关掉右键菜单（这里不必再判一次）。
              onRemoveSection={handleRemoveSection}
              onSelect={(key) => {
                setActiveKey(key);
                select(key === BASIC_TAB ? null : key);
              }}
            />
            {activeSection ? (
              <SectionEditor
                document={document}
                section={activeSection}
                catalog={catalog}
                readOnly={readOnly}
                selectedPath={selectedPath}
                onSelectPath={select}
                onChange={onChange}
                onHoverPath={onHoverPath}
                onNotice={report}
              />
            ) : (
              <DocumentHeaderPanel
                document={document}
                catalog={catalog}
                readOnly={readOnly}
                selectedPath={selectedPath}
                onSelectPath={select}
                onChange={onChange}
                onNotice={report}
                formatConfig={layout?.format_config ?? null}
                onFormatConfigChange={commitFormatConfig}
              />
            )}
            <span className="document-section-hint">{t("document.editor.selectHint")}</span>
            {/*
            问题 14：提示条交给 `DocumentNotice`——有浮层宿主时 portal 到**滚动容器之外**
            （中栏底部，常驻留白保证零位移），没有宿主时回退成原来的流内渲染。
            这一行「点纸面或结构树可以定位字段」是常驻说明、不是提示，留在内容末尾。
          */}
            <DocumentNotice notice={notice} host={noticeHost} onDismiss={() => setNotice(null)} />
            {/* 全编辑器唯一的一份字段菜单：锚点是个 1px 的定位点，不参与排版、不吃指针。 */}
            <Dropdown
              open={chipMenu !== null}
              onOpenChange={(open) => {
                if (!open) closeChipMenu();
              }}
              trigger={[]}
              menu={{ items: chipMenuItems, onClick: onChipMenuClick }}
            >
              <span
                className="document-chip-menu-anchor"
                style={{ left: chipMenu?.x ?? 0, top: chipMenu?.y ?? 0 }}
              />
            </Dropdown>
            {stylePopover ? (
              <ChipStylePopover
                state={stylePopover}
                document={document}
                layout={layout}
                disabled={readOnly}
                onClose={() => setStylePopover(null)}
                onLayoutChange={onLayoutChange}
              />
            ) : null}
          </div>
        </DocumentChipMenuContext.Provider>
      </DocumentDragContext.Provider>
    </DocumentExpandContext.Provider>
  );
}
