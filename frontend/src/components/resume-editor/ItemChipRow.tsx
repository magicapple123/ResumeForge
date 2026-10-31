// SPDX-License-Identifier: Apache-2.0
/**
 * 一串 item chips（行内板块 / 纯文本板块用）：不做三区拖放，只负责渲染 + 选中展开编辑。
 *
 * 三区卡（EntryCard）自己有一份带拖放目标的 chip 渲染；这里给非条目形态的板块复用
 * chip 的交互（隐藏/移除/键盘移动/选中编辑），避免为两种情况写两套 chip。
 */
import { useI18n } from "../../i18n/i18nContext";
import type {
  DocumentFieldCatalog,
  ResumeDocument,
  ResumeItem,
  ResumeSection,
} from "../../types/resumeDocument";
import { itemDisplayLabel, itemPath as buildItemPath } from "../../features/resume-document";
import ItemChip from "./ItemChip";
import ItemEditor from "./ItemEditor";

interface Props {
  document: ResumeDocument;
  section: ResumeSection;
  entryId: string;
  items: ResumeItem[];
  catalog?: DocumentFieldCatalog | null;
  readOnly?: boolean;
  selectedPath?: string | null;
  onSelectPath: (path: string | null) => void;
  onChange: (next: ResumeDocument) => void;
  onHoverPath?: (path: string | null) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
}

export default function ItemChipRow({
  document,
  section,
  entryId,
  items,
  catalog = null,
  readOnly = false,
  selectedPath,
  onSelectPath,
  onChange,
  onHoverPath,
  onNotice,
}: Props) {
  const { t } = useI18n();
  void t;
  const specFor = (item: ResumeItem) =>
    item.kind === "text"
      ? undefined
      : catalog?.sections
          .find((candidate) => candidate.key === section.key)
          ?.fields.find((field) => field.key === item.key);
  return (
    <div className="document-group document-inline-row">
      {items.map((item) => {
        const path = buildItemPath(section.key, entryId, item.id);
        return (
          <div
            key={item.id}
            className="document-chip-slot"
            onMouseEnter={() => onHoverPath?.(path)}
            onMouseLeave={() => onHoverPath?.(null)}
          >
            <ItemChip
              document={document}
              path={path}
              item={item}
              catalogLabel={itemDisplayLabel(item, specFor(item)?.label ?? "")}
              materialOnly={specFor(item)?.material_only === true}
              selected={selectedPath === path}
              readOnly={readOnly}
              sectionKey={section.key}
              entryId={entryId}
              onSelect={onSelectPath}
              onChange={onChange}
              onNotice={onNotice}
            >
              <ItemEditor
                document={document}
                path={path}
                item={item}
                sectionKey={section.key}
                catalog={catalog}
                readOnly={readOnly}
                onChange={onChange}
              />
            </ItemChip>
          </div>
        );
      })}
    </div>
  );
}
