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
import { Alert } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/i18nContext";
import type { DocumentFieldCatalog, ResumeDocument } from "../../types/resumeDocument";
import {
  buildFallbackCatalog,
  catalogSectionOf,
  ensureIds,
  needsIds,
  sectionKeyOfPath,
} from "../../features/resume-document";
import DocumentHeaderPanel from "./DocumentHeaderPanel";
import DocumentSectionTabs, { type DocumentSectionTabItem } from "./DocumentSectionTabs";
import SectionEditor from "./SectionEditor";
import { DocumentDragContext } from "./documentDragContext";
import "./document-editor.css";

const BASIC_TAB = "basic";

export interface DocumentEditorProps {
  /** 当前 v2 文档（受控）。 */
  document: ResumeDocument;
  /** 所有编辑（文本 / 结构 / 位置 / 顺序）的唯一回流口。 */
  onChange: (next: ResumeDocument) => void;
  /** 受控选中：header/section/entry/item 四种路径。 */
  selectedPath?: string | null;
  onSelectPath?: (path: string | null) => void;
  /** 悬停字段（预览描边联动）。 */
  onHoverPath?: (path: string | null) => void;
  readOnly?: boolean;
  /** 后端字段目录；缺省用内置 fallback（只影响"添加字段"菜单与枚举显示）。 */
  fieldCatalog?: DocumentFieldCatalog | null;
  /** 自建板块入口；缺省不渲染「添加板块」。 */
  onAddSection?: () => void;
  className?: string;
}

interface NoticeState {
  text: string;
  tone: "info" | "warning";
}

export default function DocumentEditor({
  document,
  onChange,
  selectedPath = null,
  onSelectPath,
  onHoverPath,
  readOnly = false,
  fieldCatalog = null,
  onAddSection,
  className,
}: DocumentEditorProps) {
  const { t } = useI18n();
  const [activeKey, setActiveKey] = useState<string>(BASIC_TAB);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [draggedPath, setDraggedPath] = useState<string | null>(null);

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
  const selectedSection = sectionKeyOfPath(selectedPath);
  const wantedKey =
    selectedSection && document.sections.some((section) => section.key === selectedSection)
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
    onSelectPath?.(path);
  };
  const report = (text: string, tone: "info" | "warning" = "info") => setNotice({ text, tone });

  return (
    <DocumentDragContext.Provider value={{ draggedPath, setDraggedPath }}>
      <div
        className={`document-editor${className ? ` ${className}` : ""}`}
        data-document-editor=""
        aria-label={t("document.editor.region")}
      >
        {notice ? (
          <Alert
            type={notice.tone === "warning" ? "warning" : "info"}
            title={notice.text}
            closable
            onClose={() => setNotice(null)}
          />
        ) : null}
        <DocumentSectionTabs
          items={tabs}
          activeKey={activeSection ? activeKey : BASIC_TAB}
          readOnly={readOnly}
          onAddSection={onAddSection}
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
          />
        )}
        <span className="document-section-hint">{t("document.editor.selectHint")}</span>
      </div>
    </DocumentDragContext.Provider>
  );
}
