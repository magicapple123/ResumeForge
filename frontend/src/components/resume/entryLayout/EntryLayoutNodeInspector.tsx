// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目字段排版」里的**字段检查器**（选中树/纸面字段后的就地编辑）。
 *
 * 从 `EntryLayoutPanel` 拆出（单文件 500 行预算）：面板里有两处会渲染它——
 * 行内/单段板块的只读分支与普通条目分支，拆成组件后两处共用同一份渲染与禁用规则。
 * 行为不变：锁内容 / 锁排版 / 宿主禁用时 ItemEditor 只读。
 */
import { Typography } from "antd";
import { useLocale } from "../../../i18n/i18nContext";
import { t } from "../../../i18n";
import type {
  DocumentFieldCatalog,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
} from "../../../types/resumeDocument";
import ItemEditor from "../../resume-editor/ItemEditor";

export interface EntryLayoutNodeInspectorProps {
  document: ResumeDocument;
  /** 当前选中路径（ItemEditor 的 `path`）。 */
  path: string;
  item: ResumeItem;
  sectionKey: string;
  entry: ResumeEntry;
  catalog?: DocumentFieldCatalog | null;
  /** 面板级禁用（宿主禁用；锁内容/锁排版在组件内合并）。 */
  disabled: boolean;
  onChange: (next: ResumeDocument) => void;
}

export default function EntryLayoutNodeInspector({
  document,
  path,
  item,
  sectionKey,
  entry,
  catalog,
  disabled,
  onChange,
}: EntryLayoutNodeInspectorProps) {
  useLocale();
  return (
    <section className="rf-entry-layout-node-inspector" aria-label={t("structure.inspector.title")}>
      <Typography.Text strong>{t("structure.inspector.title")}</Typography.Text>
      <ItemEditor
        document={document}
        path={path}
        item={item}
        sectionKey={sectionKey}
        catalog={catalog}
        readOnly={disabled || entry.lock_content || entry.lock_layout}
        onChange={onChange}
      />
    </section>
  );
}
