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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ObjectStylePanel from "../layout/ObjectStylePanel";
import { useChipMenuDismiss } from "./useChipMenuDismiss";
import { placeMenu } from "../../context-menu/positioning";
import { useI18n } from "../../../i18n/i18nContext";
import { ENTRY_STYLE_SCOPE_LABELS, type EntryStyleScope } from "../layout/entryStyleScopes";
import { isFieldStylePath } from "../layout/fieldStyleTarget";
import { entryIdFromPath, findEntryById, roleForDocumentPath } from "../layout/v2Selection";
import type { ResumeDocument } from "../../../types/resumeDocument";
import type { ResumeLayout } from "../../../types";
import type { ResumeTemplateCatalog } from "../../../types";

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
  /**
   * 落位（问题 25）：浮层与右键菜单共用 `placeMenu`——贴着命中点、下方放不下翻上、
   * 四边夹进视口。原来是裸 `left/top`，靠右/靠下的字段一点就有一半在屏幕外。
   * 尺寸先测量后定位；量不到（jsdom/首帧）按浮层 CSS 的 300×420 估算。
   */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useChipMenuDismiss(state !== null, onClose);
  useLayoutEffect(() => {
    if (!state) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      setSize({ width: rect.width, height: rect.height });
    }
  }, [state]);
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
  const entryId = entryIdFromPath(state.path);
  if (!entryId) return null;
  // 两个入口共用这个浮层，路径形态不同、落点也不同：
  // - 字段右键（`section.entry.item`）：只改**这一个字段** → `field`，键用字段路径
  //   （后端 `object_roles["<path>:<role>"]` 按 `[data-resume-path]` 出规则）；
  // - 结构树条目行右键「排版整条…」（`section.entry`）：改**整条** → `object`，键用条目 id
  //   （否则会写出一条没人读的 `objects["<路径>"]`，点了等于没改）。
  const fieldLevel = isFieldStylePath(state.path);
  const scope: EntryStyleScope = fieldLevel ? "field" : "object";
  const objectId = fieldLevel ? state.path : entryId;
  const fieldRole = fieldLevel ? roleForDocumentPath(document, state.path) : "body";
  const entry = findEntryById(document, entryId);
  const titleValue = (entry?.items ?? [])
    .filter((item) => item.kind === "field" && item.placement === "title")
    .map((item) => (item.kind === "field" ? item.value : ""))
    .find((value) => value?.trim());
  const label = titleValue?.trim();
  const placement = placeMenu({ x: state.x, y: state.y }, size ?? { width: 300, height: 420 });

  return (
    <div
      ref={rootRef}
      className="document-chip-style-popover"
      style={{ left: placement.left, top: placement.top }}
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
        fieldRole={fieldRole}
        lockScope
        disabled={disabled || undefined}
        onChange={onLayoutChange}
      />
    </div>
  );
}
