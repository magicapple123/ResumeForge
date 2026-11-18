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
 *
 * ## I-21：先量后显 + portal
 *
 * 首帧用估算尺寸定位会「先出现在一个位置再跳」，所以量到真实尺寸前卡片 `visibility:
 * hidden`（**不是** `display:none`：那样 `getBoundingClientRect()` 全 0，等于没量）。
 * 同时用 `createPortal` 挂到 body：`position: fixed` 的参照系永远回到视口，不再被工作台
 * 某层的 `container-type`（= `contain: layout`）劫持到左栏角落——这个坑
 * `resume-workbench-controls-wide.css:16-24` 已经踩过一次。
 */
import Button from "antd/es/button";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ObjectStylePanel from "../layout/ObjectStylePanel";
import { useChipMenuDismiss } from "./useChipMenuDismiss";
import { placeMenu } from "../../context-menu/positioning";
import { chipPopoverZIndex } from "./overlayLayer";
import { useI18n } from "../../../i18n/i18nContext";
import { ENTRY_STYLE_SCOPE_LABELS, type EntryStyleScope } from "../layout/entryStyleScopes";
import { isFieldStylePath } from "../layout/fieldStyleTarget";
import {
  entryIdFromPath,
  findEntryById,
  headerFieldFromPath,
  roleForDocumentPath,
} from "../layout/v2Selection";
import type { ResumeDocument } from "../../../types/resumeDocument";
import type { ResumeLayout } from "../../../types";
import type { ResumeTemplateCatalog } from "../../../types";
import type { ResumePreviewHandle } from "../preview/ResumePreview";
import type { RefObject } from "react";

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
  /** I-15：实时探针通道。宿主没有时 `ObjectStylePanel` 回落到 `liveProbeRegistry`。 */
  previewRef?: RefObject<ResumePreviewHandle | null>;
  onClose: () => void;
  onLayoutChange?: (next: ResumeLayout) => void;
}

/** 兜底尺寸（jsdom / 首帧量不到时按浮层 CSS 的 300×420 估算落位）。 */
const ESTIMATED_SIZE = { width: 300, height: 420 };

export default function ChipStylePopover({
  state,
  document,
  layout,
  catalog,
  disabled = false,
  previewRef,
  onClose,
  onLayoutChange,
}: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * 落位（问题 25）：浮层与右键菜单共用 `placeMenu`——贴着命中点、下方放不下翻上、
   * 四边夹进视口。原来是裸 `left/top`，靠右/靠下的字段一点就有一半在屏幕外。
   */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  /**
   * `pending` = 还没量到（此时不可见，但仍在排版，所以量得到）；
   * `ok` = 量到了；`unmeasurable` = 量不到（jsdom / 祖先 display:none），用估算尺寸显示，
   * 不能让它永远不可见。
   */
  const [measureState, setMeasureState] = useState<"pending" | "ok" | "unmeasurable">("pending");
  /**
   * 换目标（path / 锚点）时**在渲染期**把测量结果作废：上一张卡的高度不能拿来定位这一张，
   * 否则又是一次"先跳一下"。这是 React 认可的"props 变化时调整 state"写法。
   */
  const stateKey = state ? `${state.path}:${state.x}:${state.y}` : null;
  const [measuredKey, setMeasuredKey] = useState<string | null>(null);
  if (stateKey !== measuredKey) {
    setMeasuredKey(stateKey);
    setMeasureState("pending");
    setSize(null);
  }
  useChipMenuDismiss(state !== null, onClose);
  useLayoutEffect(() => {
    if (!state) return;
    // I-21：层级随宿主模态走（见 `overlayLayer.ts`）——制作台弹窗 3300、手动录入 3100，
    // 写死一个数总有一边被盖住。直接写内联样式（不进 state）：这里本来就要量一次 DOM，
    // 再为了一个数字触发一轮渲染不值得，而且 CSS 里有 3149 的兜底值。
    if (rootRef.current) rootRef.current.style.zIndex = String(chipPopoverZIndex());
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      setSize({ width: rect.width, height: rect.height });
      setMeasureState("ok");
      return;
    }
    // 量不到（jsdom / 祖先 `display:none`）：**立刻**用估算尺寸显示。
    // 这一支等价于"超时兜底"，但不必等 30 帧——永远不可见比偏一点糟得多。
    setMeasureState("unmeasurable");
  }, [state, stateKey]);
  // Escape 收起：浮层自己处理（chip 的 Esc 语义是收起编辑器，不归这里）。
  // **capture + stopPropagation**：portal 到 body 之后，Esc 不再经过 `.document-editor`
  // 的 A3 分层（那里会 stopPropagation 拦住工作台弹窗），不在这里吃掉，一次 Esc 会把
  // 制作台弹窗一起关掉。
  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state, onClose]);

  if (!state || !layout || !onLayoutChange) return null;
  const entryId = entryIdFromPath(state.path);
  // QW-6：页眉字段（`header.{id}`）没有条目，但它有两半（字段名 / 字段值）可调。
  const headerField = headerFieldFromPath(document, state.path);
  if (!entryId && !headerField) return null;
  // I-01：照片字段没有任何字段级落点（纸面是 `<img class="profile-photo">`，不带
  // `data-resume-path`，字段级规则一条都命中不了）。入口已经在菜单里换成「照片框…」，
  // 这里再挡一次：旧的浮层状态 / 别人的调用点也不会把 base64 铺出来。
  if (headerField?.photo) return null;
  // 两个入口共用这个浮层，路径形态不同、落点也不同：
  // - 字段右键（`section.entry.item`）：只改**这一个字段** → `field`，键用字段路径
  //   （后端 `object_roles["<path>:<role>"]` 按 `[data-resume-path]` 出规则）；
  // - 结构树条目行右键「排版整条…」（`section.entry`）：改**整条** → `object`，键用条目 id
  //   （否则会写出一条没人读的 `objects["<路径>"]`，点了等于没改）；
  // - 页眉字段（`header.{id}`）：固定 `field`，角色由 planner 实际写的 role 决定（meta）。
  const fieldLevel = isFieldStylePath(state.path);
  const scope: EntryStyleScope = headerField || fieldLevel ? "field" : "object";
  const objectId = headerField || fieldLevel ? state.path : (entryId as string);
  const fieldRole = headerField
    ? "meta"
    : fieldLevel
      ? roleForDocumentPath(document, state.path)
      : "body";
  const entry = headerField ? null : findEntryById(document, entryId);
  const titleValue = (entry?.items ?? [])
    .filter((item) => item.kind === "field" && item.placement === "title")
    .map((item) => (item.kind === "field" ? item.value : ""))
    .find((value) => value?.trim());
  const label = headerField ? headerField.label : titleValue?.trim();
  const placement = placeMenu({ x: state.x, y: state.y }, size ?? ESTIMATED_SIZE);
  const scopeLabel = headerField
    ? t("typography.headerStyle.scope")
    : t(ENTRY_STYLE_SCOPE_LABELS[scope]);

  return createPortal(
    <div
      ref={rootRef}
      className="document-chip-style-popover"
      style={{
        left: placement.left,
        top: placement.top,
        // 先量后显：量到真实高度前不画（`visibility` 而不是 `display`，见文件头）。
        visibility: measureState === "pending" ? "hidden" : undefined,
      }}
      role="dialog"
      aria-label={t("typography.entryStyle.status", {
        name: label || t("typography.object.untitled"),
        scope: scopeLabel,
      })}
    >
      <div className="document-chip-style-popover-head">
        <span className="document-chip-style-popover-title">
          {t("document.editor.stylePopoverTitle", {
            scope: scopeLabel,
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
        headerField={headerField}
        pickedPath={state.path}
        defaultScope={scope}
        fieldRole={fieldRole}
        lockScope
        collapsibleGroups
        disabled={disabled || undefined}
        previewRef={previewRef}
        onChange={onLayoutChange}
      />
    </div>,
    globalThis.document.body,
  );
}
