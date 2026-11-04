// SPDX-License-Identifier: Apache-2.0
/**
 * item 的位置与顺序操作（纯函数，不可变）。
 *
 * ## 位置规则（哪些 item 能放在哪）
 *
 * | item 类型 | 允许的位置 | 理由 |
 * |---|---|---|
 * | field | title / meta / lead / body / trail / hidden | 按纸面阅读序；body 见下 |
 * | list | lead / trail / hidden | 列表是灰色短字段；放头部会撑爆标题行 |
 * | authors | lead / trail / hidden | 作者列表是灰色短字段（论文 / 专利 trail） |
 * | text | 不参与位置拖拽（只有 hidden 开关） | 正文块不是"字段" |
 *
 * **inline 板块用另一套**（`allowedPlacementsForItem(item, "inline")` 返回
 * `body / trail / hidden`）：纸面上行内板块只有两种角色——`_inline_rows` 里
 * `role = body if placement == "body" else "meta"`，其余位置在渲染上完全等价。给用户
 * 五个语义不同、结果相同的入口只会让人猜，所以行内只留「主文本 / 灰字补充 / 隐藏」。
 *
 * **field 可以在 body**（2026-11-02 修正）：`document_plan.py` 的 `_body_blocks` 明确支持
 * 非 TextItem 的 body 分支，inline 板块的主文本与多行自定义字段都落在 body。之前把 body
 * 从字段的允许列表里去掉，界面就把英文枚举 `body` 直接漏给了用户（antd Select 找不到
 * 选项时回退显示原始值）。
 *
 * ## 域（zone）
 *
 * 六个位置分属四个域：`title/meta → head`、`lead/trail → detail`、`body`、`hidden`。
 * **拖拽只在同域内允许**（`canDropIntoZone`）：跨域换位置得走位置下拉，因为下拉知道自己在
 * 改什么，而拖过去只是一个"落在别的方框里"的动作，用户看不出发生了什么。`hidden` 与任何域
 * 互通（隐藏/恢复是同一件事的两半）。
 *
 * 非法目标**静默返回原文档引用**（`=== before` 是调用方判断"没动"的依据），
 * 界面上必须据此给可读提示，不能假装成功。
 *
 * ## 顺序
 *
 * `items` 是一条有序列表；同一 placement 内的相对顺序就是纸面顺序。跨位置移动 = 从原位置
 * 摘掉 + 插到目标位置组内的指定下标（不传下标 = 追加到该组末尾）。
 */
import type {
  Placement,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
  SectionKind,
} from "../../types/resumeDocument";
import { locatePath } from "./paths";

/** field 能放的位置：按纸面阅读序，**含 body**（见文件头）。 */
const FIELD_PLACEMENTS: readonly Placement[] = ["title", "meta", "lead", "body", "trail", "hidden"];

/**
 * 行内板块（`SectionKind === "inline"`）能放的位置：纸面上只有「黑字主文本 / 灰字补充 /
 * 隐藏」三种结果，多出来的入口语义重复（见文件头）。
 */
const INLINE_PLACEMENTS: readonly Placement[] = ["body", "trail", "hidden"];

/** 这个 item 在行内板块里的位置集（供 UI 判断"当前用的是哪一套文案"）。 */
export function placementsForInlineSection(): readonly Placement[] {
  return INLINE_PLACEMENTS;
}

/** 四个"方框"（域）：拖拽只在同域内允许。 */
export type PlacementZone = "head" | "detail" | "body" | "hidden";

const HEAD_PLACEMENTS: readonly Placement[] = ["title", "meta"];
const DETAIL_PLACEMENTS: readonly Placement[] = ["lead", "trail"];

/**
 * 某个位置属于哪个方框。
 *
 * 刻意写成"白名单数组 + 判断"而不是 `Record<Placement, PlacementZone>` 表：后者是一个带
 * `body:` 属性的对象字面量，会被 `i18n/cjkRatchet` 的产品文案扫描器当成文案
 * （`COPY_PROPERTIES` 里有 `body`）而判成"新增未登记文案"。
 */
export function zoneOfPlacement(placement: Placement): PlacementZone {
  if (HEAD_PLACEMENTS.includes(placement)) return "head";
  if (DETAIL_PLACEMENTS.includes(placement)) return "detail";
  return placement === "hidden" ? "hidden" : "body";
}

/** item 当前在哪个位置（TextItem 没有 placement，落 body / hidden 两个抽屉）。 */
export function getItemPlacement(item: ResumeItem): Placement {
  return item.kind === "text" ? (item.hidden ? "hidden" : "body") : item.placement;
}

/**
 * 这个 item 能放的位置列表（TextItem 返回空数组：它只能切换显示/隐藏）。
 *
 * `sectionKind` 缺省 = 普通条目板块（`entries`）。传 `"inline"` 时用行内那一套
 * （`body / trail / hidden`）——行内板块的纸面只有主文本与灰字两种角色。
 * `list` / `authors` 在行内同样按行内那一套（它们没有标题行可放）。
 */
export function allowedPlacementsForItem(
  item: ResumeItem,
  sectionKind?: SectionKind,
): readonly Placement[] {
  if (item.kind === "text") return [];
  if (sectionKind === "inline") return INLINE_PLACEMENTS;
  switch (item.kind) {
    case "field":
      return FIELD_PLACEMENTS;
    case "list":
    case "authors":
      return ["lead", "trail", "hidden"];
    default:
      // `text` 已在函数开头返回空数组，这里的 default 只是穷尽性兜底。
      return [];
  }
}

export function canPlaceItem(
  item: ResumeItem,
  placement: Placement,
  sectionKind?: SectionKind,
): boolean {
  return allowedPlacementsForItem(item, sectionKind).includes(placement);
}

/**
 * 落点是否只涉及「组内换序」，不涉及「换位置」（问题 12）。
 *
 * 「能不能换位置」与「能不能换顺序」是两条判据：`canPlaceItem` 对正文块（text）恒为 false
 * （它没有 placement 可选），但正文块当然可以在正文组里往前挪一格。所以这条判据只看
 * "目标组就是当前组" + 可写，不看位置白名单。
 *
 * 正文块的 `hidden → body` 也算：隐藏态的正文必须能拖回正文区（否则只能删掉重打）。
 * 反方向（显示 → 隐藏）不靠拖，走右键菜单的显示/隐藏。
 */
export function canReorderWithin(
  item: ResumeItem,
  placement: Placement,
  readOnly = false,
): boolean {
  if (readOnly) return false;
  if (getItemPlacement(item) === placement) return true;
  return item.kind === "text" && placement === "body";
}

/**
 * 能不能**拖着**放到这个位置：位置本身允许 + 同域（`hidden` 例外，与任何域互通）。
 *
 * 位置下拉不走这里——下拉按 `allowedPlacementsForItem` 列全部合法位置，那才是跨域的入口。
 */
export function canDropIntoZone(item: ResumeItem, placement: Placement): boolean {
  if (!canPlaceItem(item, placement)) return false;
  const from = getItemPlacement(item);
  if (from === "hidden" || placement === "hidden") return true;
  return zoneOfPlacement(from) === zoneOfPlacement(placement);
}

/** 把 item 的 placement 改成目标值；TextItem 只处理 hidden 开关，其余类型返回原引用。 */
export function withItemPlacement(item: ResumeItem, placement: Placement): ResumeItem {
  if (item.kind === "text") {
    if (placement !== "body" && placement !== "hidden") return item;
    const hidden = placement === "hidden";
    return item.hidden === hidden ? item : ({ ...item, hidden } as ResumeItem);
  }
  if (item.placement === placement) return item;
  // 拖到「隐藏」分组 = 隐藏；记下来源位置，拖回/点显示时恢复。
  // 拖到任何非隐藏分组 = 显式改位置，旧的来源位置不再有效。
  return {
    ...item,
    placement,
    hidden_from: placement === "hidden" ? item.placement : null,
  } as ResumeItem;
}

export interface MoveItemTarget {
  /** 目标位置；缺省 = 保持当前位置（只调顺序）。 */
  placement?: Placement;
  /** 目标位置组内的下标；缺省 = 追加到组末尾。 */
  toIndex?: number;
}

function replaceEntry(
  document: ResumeDocument,
  sectionIndex: number,
  entryIndex: number,
  entry: ResumeEntry,
): ResumeDocument {
  const section = document.sections[sectionIndex];
  const entries = section.entries.slice();
  entries[entryIndex] = entry;
  const sections = document.sections.slice();
  sections[sectionIndex] = { ...section, entries };
  return { ...document, sections } as ResumeDocument;
}

/**
 * 移动一条 item（改位置 / 改同组顺序）。
 *
 * 找不到路径、目标位置非法时返回**原文档引用**。正文块（text）没有可选位置，但可以在
 * 正文组里换序（问题 12）——两者由 `canReorderWithin` 与 `canPlaceItem` 分别把关。
 */
export function moveItem(
  document: ResumeDocument,
  path: string,
  target: MoveItemTarget = {},
): ResumeDocument {
  const located = locatePath(document, path);
  if (!located || located.kind !== "item") return document;
  const { item, itemIndex, entry, entryIndex, sectionIndex } = located;
  const currentPlacement = getItemPlacement(item);
  const nextPlacement = target.placement ?? currentPlacement;
  // 换位置才校验白名单：历史数据里可能已经有 placement=body 的字段，它在原组内换序仍要能动
  // （否则用户会看到"这条怎么拖都没反应"，且没有任何提示能解释）。
  // 正文块（text）没有可选位置，但**组内换序必须放行**（问题 12）：只有指定成 body/hidden
  // 以外的位置才算"换位置"，一律拒绝；body ↔ hidden 是显示/隐藏两半，交给 withItemPlacement。
  if (nextPlacement !== currentPlacement) {
    if (item.kind === "text") {
      if (nextPlacement !== "body") return document;
    } else if (!canPlaceItem(item, nextPlacement)) {
      return document;
    }
  }

  const remaining = entry.items.slice();
  remaining.splice(itemIndex, 1);
  const moved = withItemPlacement(item, nextPlacement);

  // 目标位置组在"摘掉之后"的数组里的下标：插入点取该组第 toIndex 个元素之前。
  // 注意：`toIndex` 是**摘除后**的组内下标（键盘等价移动 keyboardMoveTarget 依赖这一
  // 语义：toIndex=当前可见下标±1 恰好换位）。鼠标拖放的"可见下标"换算在调用方做
  // （EntryCard 的落点计算把"摘除自身"的偏移补回去）——两套语义不要混用。
  const groupIndexes = remaining.flatMap((candidate, index) =>
    getItemPlacement(candidate) === nextPlacement ? [index] : [],
  );
  const insertAt = groupIndexes[target.toIndex ?? groupIndexes.length] ?? remaining.length;
  remaining.splice(insertAt, 0, moved);
  return replaceEntry(document, sectionIndex, entryIndex, { ...entry, items: remaining });
}

/** 改位置（顺序追加到目标组末尾）；语义与 `moveItem(doc, path, {placement})` 相同。 */
export function setPlacement(
  document: ResumeDocument,
  path: string,
  placement: Placement,
): ResumeDocument {
  return moveItem(document, path, { placement });
}

/**
 * 在同一位置组内上/下移一位（`delta` = -1 / 1）。
 *
 * 到边界返回原文档引用（界面提示「已经到边界了」），不循环、不跨位置——
 * 跨位置是 drag / `setPlacement` 的职责，方向键上下不替用户做位置决定。
 */
export function reorderItems(
  document: ResumeDocument,
  path: string,
  delta: number,
): ResumeDocument {
  const located = locatePath(document, path);
  if (!located || located.kind !== "item") return document;
  const placement = getItemPlacement(located.item);
  const groupIndexes = located.entry.items.flatMap((candidate, index) =>
    getItemPlacement(candidate) === placement ? [index] : [],
  );
  const positionInGroup = groupIndexes.findIndex((index) => index === located.itemIndex);
  const targetInGroup = positionInGroup + delta;
  if (positionInGroup < 0 || targetInGroup < 0 || targetInGroup >= groupIndexes.length) {
    return document;
  }
  return moveItem(document, path, { toIndex: targetInGroup });
}
