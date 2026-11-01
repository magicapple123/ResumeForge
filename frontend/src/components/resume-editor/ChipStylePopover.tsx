// SPDX-License-Identifier: Apache-2.0
/**
 * #7：字段右键「调整排版」浮层——排版工具并入字段右键的最后一跳。
 *
 * 右键 chip → 菜单选「调整排版」→ 这里弹出一个**锁定范围**的小浮层：
 * 范围由右键命中的字段位置自动推断（title → 条目标题；body → 正文；
 * meta/lead/trail → 说明；推不出 → 整条），**没有范围选择器**——
 * 左栏排版面板才需要范围切换，浮层只改右键命中那一块。
 *
 * 排版数据不走 document（onChange 是正文回流口），走宿主的 layout 通道
 * （`onLayoutChange` → `useWorkbenchV2History.recordLayout`，#21 的历史链路）。
 */

import Button from "antd/es/button";
import { useEffect, useRef } from "react";
import ObjectStylePanel from "../resume/typography/ObjectStylePanel";
import { useChipMenuDismiss } from "./useChipMenuDismiss";
import { useI18n } from "../../i18n/i18nContext";
import {
  ENTRY_STYLE_SCOPE_LABELS,
  type EntryStyleScope,
} from "../../features/resume-layout/entryStyleScopes";
import {
  entryIdFromPath,
  findEntryById,
  scopeForDocumentPath,
} from "../resume/typography/v2Selection";
import type { ResumeDocument } from "../../types/resumeDocument";
import type { ResumeLayout } from "../../types";
import type { ResumeTemplateCatalog } from "../../types";

export interface ChipStylePopoverState {
  path: string;
  x: number;
  y: number;
}

interface Props {
  state: ChipStylePopoverState | null;
  document: ResumeDocument;
  layout: ResumeLayout | null;
  catalog?: ResumeTemplateCatalog | null;
  disabled?: boolean;
  onClose: () => void;
  onLayoutChange?: (next: ResumeLayout) => void;
}

export default function ChipStylePopover({
  state,
  document,
  layout,
  catalog,
  disabled = false,
  onClose,
  onLayoutChange,
}: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  useChipMenuDismiss(state !== null, onClose);
  // Escape 收起：浮层自己处理（chip 的 Esc 语义是收起编辑器，不归这里）。
  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onClose]);

  if (!state || !layout || !onLayoutChange) return null;
  const objectId = entryIdFromPath(state.path);
  if (!objectId) return null;
  const scope: EntryStyleScope = scopeForDocumentPath(document, state.path);
  const entry = findEntryById(document, objectId);
  const titleValue = (entry?.items ?? [])
    .filter((item) => item.kind === "field" && item.placement === "title")
    .map((item) => (item.kind === "field" ? item.value : ""))
    .find((value) => value?.trim());
  const label = titleValue?.trim();

  return (
    <div
      ref={rootRef}
      className="document-chip-style-popover"
      style={{ left: state.x, top: state.y }}
      role="dialog"
      aria-label={t("typography.entryStyle.status", {
        name: label || t("typography.object.untitled"),
        scope: t(ENTRY_STYLE_SCOPE_LABELS[scope]),
      })}
    >
      <div className="document-chip-style-popover-head">
        <span className="document-chip-style-popover-title">
          {t("document.editor.stylePopoverTitle", {
            scope: t(ENTRY_STYLE_SCOPE_LABELS[scope]),
          })}
        </span>
        <Button size="small" type="text" onClick={onClose}>
          {t("common.action.close")}
        </Button>
      </div>
      <ObjectStylePanel
        layout={layout}
        catalog={catalog ?? undefined}
        objectId={objectId}
        objectLabel={label}
        entry={entry}
        pickedPath={state.path}
        defaultScope={scope}
        lockScope
        disabled={disabled}
        onChange={onLayoutChange}
      />
    </div>
  );
}
