// SPDX-License-Identifier: Apache-2.0
/**
 * 拖拽落点的**纯解析**（用户反馈 #4：拖动"大部分情况下拖不动"）。
 *
 * ## 为什么落点解析不能只靠行级事件
 *
 * 旧实现把 `onDrop` 挂在每一行（`.resume-outline-row`，28px 高、行与行之间还有缝隙）上：
 * 松手位置差一两像素就会落到分组容器/板块标题/行间缝隙上——**没有任何 drop 处理器**，
 * 浏览器直接按"拖到无效区域"处理（只有 dragend），顺序静默不变。真机实测：向下拖第二条
 * 压第一条、要点第二条拖第一条，都因为落点落在边缘/缝隙而失败。
 *
 * 现在把 drop 提到**树容器**上，落点与**悬停预览共用同一套语义**（`resolveDropPoint` 与
 * `resolveHoverTarget` 都只经 `bandHitRow` 判定，不存在"预览一套、提交另一套"）：
 * 1. 指针真的压在某个同类行的**行矩形**里 → 该行在**基准模型**里的下标；
 * 2. 压在被拖对象自己身上 → 提交拖动中最后预览到的那一版；
 * 3. 指在缝隙 / 分组容器 / 板块标题 / 空白处 → 同样提交最后预览到的那一版（不猜落点）；
 * 4. 压在别的板块/别的条目上 → 拒绝（不猜用户意图，顺序不变）。
 *
 * 这里全部是纯函数（行坐标由调用方量好传进来），jsdom 里可以直接测解析规则；
 * "拖动中预览会把行挪位"这件事因此不会影响落点：一律按**对象 id 回查基准下标**。
 */
import { t } from "../../../i18n";
import {
  findOutlineEntry,
  findOutlinePoint,
  type OutlineModel,
} from "../../../features/resume-outline/model";
import { pointMoveOf } from "../../../features/resume-outline/pointMove";
import type { OutlineCommand } from "../../../features/resume-outline/types";
import type { OutlineDragPayload } from "./useOutlineSort";

/** `data-tree-key` 解析结果（与 `outlineTree.ts` 的键格式一致）。 */
export type TreeKeyTarget =
  | { kind: "entry"; field: string; objectId: string }
  | { kind: "point"; field: string; objectId: string; pointField: string; pointId: string }
  /** 空要点字段的**占位行**（只在拖动中出现）：不是要点，只是一个落点提示。 */
  | { kind: "empty-point"; field: string; objectId: string; pointField: string }
  | { kind: "section"; field: string }
  | { kind: "personal" }
  | null;

export function parseTreeKey(key: string): TreeKeyTarget {
  if (!key) return null;
  if (key === "personal") return { kind: "personal" };
  const parts = key.split(":");
  if (parts[0] === "section" && parts.length >= 2) return { kind: "section", field: parts[1] };
  if (parts[0] === "entry" && parts.length >= 3) {
    return { kind: "entry", field: parts[1], objectId: parts[2] };
  }
  if (parts[0] === "point-empty" && parts.length >= 4) {
    return { kind: "empty-point", field: parts[1], objectId: parts[2], pointField: parts[3] };
  }
  if (parts[0] === "point" && parts.length >= 5) {
    return {
      kind: "point",
      field: parts[1],
      objectId: parts[2],
      pointField: parts[3],
      pointId: parts[4],
    };
  }
  return null;
}

/** 条目在基准模型里的下标（`reorder-entry` 的 toIndex 口径）。 */
export function entryIndexInModel(model: OutlineModel, field: string, objectId: string): number {
  const section = model.sections.find((item) => item.field === field);
  return section?.entries.find((item) => item.objectId === objectId)?.index ?? -1;
}

/**
 * 要点在**条目内扁平要点列表**里的基准下标（`reorder-point` / `move-point` 的 toIndex 口径）：
 * 跨字段搬移问的是"移到扁平列表的第几位"，组内下标答不了（见 `pointMove.ts`）。
 */
export function pointIndexInModel(
  model: OutlineModel,
  field: string,
  objectId: string,
  pointField: string,
  pointId: string,
): number {
  if (!pointId) return -1;
  const entry = findOutlineEntry(model, {
    kind: "entry",
    field: field as never,
    objectId,
  });
  if (!entry) return -1;
  return entry.points.findIndex(
    (point) => point.pointField === pointField && point.pointId === pointId,
  );
}

/** 被拖对象当前的基准下标（判断"原地松手"用：原地不算一次改动）。 */
export function dragStartIndex(model: OutlineModel, payload: OutlineDragPayload): number {
  if (payload.kind === "entry") return entryIndexInModel(model, payload.field, payload.objectId);
  return pointIndexInModel(
    model,
    payload.field,
    payload.objectId,
    payload.pointField,
    payload.pointId,
  );
}

/** 拖拽会话里显示/播报用的名字（与键盘会话同一套 t()）。 */
export function dragPayloadName(model: OutlineModel, payload: OutlineDragPayload): string {
  if (payload.kind === "entry") {
    const entry = findOutlineEntry(model, {
      kind: "entry",
      field: payload.field,
      objectId: payload.objectId,
    });
    return entry && entry.title ? entry.title : t("outline.entry.untitled");
  }
  const point = findOutlinePoint(model, {
    kind: "point",
    field: payload.field,
    objectId: payload.objectId,
    pointField: payload.pointField,
    pointId: payload.pointId,
  });
  return point?.text || t("outline.point.label");
}

/**
 * drop 的解析结果：同类行 / 空字段占位行（`field`）/ 自己 / 拒绝；`geometry` = 键帮不上忙
 * （板块标题、分组容器、缝隙、真机恒为空——拖动中行 `pointer-events:none`），由调用方交给
 * `resolveDropPoint` 按行矩形判定，与悬停预览同一个函数。
 */
export type DropResolution =
  | { kind: "row"; index: number }
  | { kind: "field"; pointField: string }
  | { kind: "self" }
  | { kind: "geometry" }
  | { kind: "reject" };

/**
 * 直接把 drop 的 `data-tree-key` 映射成落点；`geometry` 表示"键不指向某个同类行，按几何算"。
 *
 * 松在**别的板块/别的条目**上时一律拒绝：跨板块拖动不是这个功能的语义（渲染端也不允许），
 * 就近猜测会让用户在完全无关的位置松手时看到顺序莫名变化。
 */
export function classifyDropKey(
  model: OutlineModel,
  payload: OutlineDragPayload,
  key: string,
): DropResolution {
  if (!key) return { kind: "geometry" };
  const target = parseTreeKey(key);
  if (!target) return { kind: "reject" };
  if (target.kind === "personal") return { kind: "reject" };
  if (target.kind === "section") {
    return target.field === payload.field ? { kind: "geometry" } : { kind: "reject" };
  }
  if (payload.kind === "entry") {
    if (target.kind !== "entry" || target.field !== payload.field) return { kind: "reject" };
    if (target.objectId === payload.objectId) return { kind: "self" };
    const index = entryIndexInModel(model, target.field, target.objectId);
    return index >= 0 ? { kind: "row", index } : { kind: "reject" };
  }
  // 空字段占位行：只接受"同一条目的要点"，落点 = 搬进这个字段（不参与扁平下标计算）。
  if (target.kind === "empty-point") {
    const own = target.field === payload.field && target.objectId === payload.objectId;
    if (!own || target.pointField === payload.pointField) return { kind: "reject" };
    return { kind: "field", pointField: target.pointField };
  }
  // 要点只能在自己的**条目**里换位，但可以换**字段**（`courses` → `achievements` 等）：
  // 纸面按字段渲染，跨字段拖动 = 把这一条搬进目标字段的数组（语义见 `pointMove.ts`）。
  // 跨条目仍然拒绝——那会改另一条经历的内容，不是"给这条排顺序"。
  if (
    target.kind !== "point" ||
    target.field !== payload.field ||
    target.objectId !== payload.objectId
  ) {
    return { kind: "reject" };
  }
  if (target.pointId === payload.pointId) return { kind: "self" };
  const index = pointIndexInModel(
    model,
    target.field,
    target.objectId,
    target.pointField,
    target.pointId,
  );
  return index >= 0 ? { kind: "row", index } : { kind: "reject" };
}

/**
 * 一行在当前 DOM 里的**行矩形**（调用方量好传进来，纯函数好测）。
 *
 * 判定只用 `top`/`bottom`：band 语义要回答的是"指针是不是真的压在这一行上"，必须知道行的
 * 上下边界（见 `bandHitRow` / `resolveHoverTarget`）。`centerY` 保留给测试与调试读数
 * （"指针在行中心"这类用例写起来最直接），**实现里不再比较中心距离**。
 */
export interface DropRowBox {
  key: string;
  /** 行中心（测试/调试用；判定只读 `top`/`bottom`）。 */
  centerY: number;
  /** 行上边界（视口坐标）。 */
  top: number;
  /** 行下边界（视口坐标）。 */
  bottom: number;
}

/** 行级落点命中结果：压在某个同类行上 / 压在占位行上 / 压在被拖行自己身上 / 没压住任何行。 */
export type BandHit =
  | { kind: "row"; key: string; index: number }
  | { kind: "field"; key: string; pointField: string }
  | { kind: "self" }
  | { kind: "gap" };

/**
 * **band 落点**：只有"指针真的压在某一同类行矩形里"才算命中，缝隙一律不猜。
 *
 * 为什么不能用"中心距离最近"（第二轮真机验收的根因）：条目高度**等于它的要点子树**，
 * 每个条目的高度都不一样（真机数据集 2 / 6 / 7 条要点）。换位之后行会整体挪位，
 * 指针一旦落在两行之间的**缝隙**里，中心距离就会把落点判给下一行——实测"拖到第 2 条却跑到
 * 末尾"：
 *
 * | 帧 | 指针 y | 行矩形（order） |
 * |---|---|---|
 * | 换位后 | 500 | ore2aa 250-278 / **缝隙 490~698** / ooa3n7 698-726 / 被拖行 462-490 |
 *
 * 指针 500 落在缝隙里，中心距离却判给 ooa3n7（中心 712，距离 212）→ 又跳一格。
 * 而行矩形是**紧挨不重叠**的，所以"压在哪一行上"最多只有一个答案，缝隙就是"什么都没压住"。
 *
 * 命中区间是**半开** `[top, bottom)`（行矩形首尾相接，交界处不会同时命中两行）；行高为 0
 * （jsdom 没有布局 / 行被折叠）时永远不命中，调用方据此退回"提交预览"的安全行为。
 */
export function bandHitRow(
  model: OutlineModel,
  payload: OutlineDragPayload,
  rows: readonly DropRowBox[],
  pointerY: number,
): BandHit {
  // 没有坐标（宿主没给 clientY / 老浏览器把事件降级成普通 Event）→ 什么都不算命中：
  // "不知道指针在哪"必须退回安全行为，绝不能因为 `undefined < row.top` 恒为 false 就
  // 把落点判给第一行（那正是"松手落错位置"的另一种形态）。
  if (!Number.isFinite(pointerY)) return { kind: "gap" };
  for (const row of rows) {
    if (!(row.bottom > row.top)) continue;
    if (pointerY < row.top || pointerY >= row.bottom) continue;
    const resolution = classifyDropKey(model, payload, row.key);
    // 行矩形不重叠：命中一行就可以收工，不必再看别的行（这正是"不猜"的关键）。
    if (resolution.kind === "self") return { kind: "self" };
    if (resolution.kind === "field") {
      return { kind: "field", key: row.key, pointField: resolution.pointField };
    }
    if (resolution.kind === "row") return { kind: "row", key: row.key, index: resolution.index };
  }
  return { kind: "gap" };
}

/**
 * 行边界附近的**缓冲带**（px）。
 *
 * band 判定本身不加容差（加了就等于把缝隙吃掉，见 `bandHitRow`），容差只用在两处：
 * 1. 判据 1 —— 指针刚离开被拖行自己那 28px 的行矩形时不要立刻换目标（行边界 ±1px 手抖
 *    不会让预览跳）；
 * 2. 跨对象判定 —— 指针压在别人行矩形边缘几像素时也算"压在别人的行上"，宁可不动也不误改。
 */
export const HOVER_HYSTERESIS_PX = 8;

/** 行级目标（条目/要点/**空字段占位行**）。板块头与个人信息只是分区，不是"别人的一行"。 */
function isRowLikeTarget(target: TreeKeyTarget): boolean {
  if (target === null) return false;
  return target.kind === "entry" || target.kind === "point" || target.kind === "empty-point";
}

/**
 * 这个行级目标是不是"被拖对象自己的地盘"（同板块的条目行 / 同一条目里的任意要点行、
 * 空字段占位行）。别的条目的占位行仍算"别人的行"（被 `pointerOverForeignRow` 拒绝）。
 *
 * 要点拖动**按条目**划界、不按字段：同一条目内的另一个字段正是"跨字段搬移"的合法落点，
 * 把它判成"别人的行"会让第一条要点永远拖不动（上一轮缺陷）。
 */
function inDragScope(payload: OutlineDragPayload, target: TreeKeyTarget): boolean {
  if (!target || target.kind === "personal" || target.kind === "section") return false;
  if (target.field !== payload.field) return false;
  if (payload.kind === "entry") return true;
  if (target.kind === "entry") return target.objectId === payload.objectId;
  return target.objectId === payload.objectId;
}

/**
 * 指针是否压在**别的板块/别的条目**的行上。
 *
 * 为什么需要它：真机拖动中整棵树 `pointer-events:none`，drop 的目标永远是树容器，
 * `closest("[data-tree-key]")` 永远拿不到键——于是 `classifyDropKey` 里"松在别的板块上
 * → 拒绝"这条规则真机上**根本不可达**，落点只能按几何算。而"按几何算"若做成"最近行"，
 * 用户把条目拖到别的板块的条目行上松手时，顺序会被改成"自己板块的第 N 位"（改了不该改的）。
 * 所以跨对象的落点必须按**几何**先拒绝：指针压在别人的行矩形里 → 顺序一动不动。
 *
 * 板块标题与个人信息**不算**：松在别的板块标题上只是"什么也没压住"，按缝隙处理（维持现状），
 * 真正的跨板块意愿由条目/要点行表达。
 */
export function pointerOverForeignRow(
  payload: OutlineDragPayload,
  rows: readonly DropRowBox[],
  pointerY: number,
  marginPx: number = HOVER_HYSTERESIS_PX,
): boolean {
  // 没有坐标就"判不出跨对象"，而不是"哪儿都算跨对象"：拒绝要留证据（见 `bandHitRow`）。
  if (!Number.isFinite(pointerY)) return false;
  for (const row of rows) {
    const target = parseTreeKey(row.key);
    if (!isRowLikeTarget(target)) continue;
    if (inDragScope(payload, target)) continue;
    if (pointerY >= row.top - marginPx && pointerY <= row.bottom + marginPx) return true;
  }
  return false;
}

/**
 * 悬停判定结果：`keep` = 维持当前目标。
 *
 * 占位行也是 `target`（不加第三种 `kind`）：`index` 的口径统一是"预览应停的扁平下标"，
 * 占位行 = **不产生位移**，故返回被拖要点自己的基准下标 → 调用方既有分支天然复位预览；
 * 加变体会让"`kind !== "keep"` 之后直接读 `.index`"的调用点（含 band/hover 测试）失去收窄。
 */
export type HoverResolution = { kind: "keep" } | { kind: "target"; key: string; index: number };

/**
 * 被拖对象**自己的行矩形**（并集：条目自身那行、它的要点行都会解析成 `self`，取并集）。
 *
 * 一行都没量到（被拖行不在 DOM 里 / jsdom 没有布局）时保持 +∞/-∞，判据 1 自然不成立，
 * 调用方随即退回"不猜"的安全行为。
 */
function selfRowBand(
  model: OutlineModel,
  payload: OutlineDragPayload,
  rows: readonly DropRowBox[],
): { top: number; bottom: number } {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (classifyDropKey(model, payload, row.key).kind !== "self") continue;
    if (row.top < top) top = row.top;
    if (row.bottom > bottom) bottom = row.bottom;
  }
  return { top, bottom };
}

/**
 * 悬停判定：把"指针压在哪个同类行上"翻译成落点目标，并保证拖动预览不会自己驱动自己。
 *
 * ## 判定顺序（2026-10-29 改为 band 语义，真机逐帧验收）
 *
 * 1. `pointerOverForeignRow` → keep（指针压在**别的板块/别的条目**的行上，不是本组内排序）；
 * 2. 指针在被拖行**自己的行矩形** ±`marginPx` 内 → keep（自己不是目标，反馈环断开）；
 * 3. `bandHitRow` 命中的 key 就是 `activeKey` → keep（目标没换，不重复 setState）；
 * 4. band 命中一行 → target（该行在基准模型里的下标）；
 * 5. **没压住任何行（缝隙）→ keep**（不猜）。
 *
 * ## 为什么第 3~5 条不再比较"中心距离"
 *
 * 旧实现用"离指针最近的行"当目标，于是**缝隙**里必须硬猜一个行：条目高度等于它的要点子树
 * （真机 3 条全展开 = 236 / 212 / 276），换位后整段下移 212 而指针只下移 236，指针就停在
 * 两行之间的空白里：
 *
 * | 帧 | 指针 y | 行矩形 |
 * |---|---|---|
 * | 换位后 | 500 | ore2aa 250-278 / **缝隙 490~698** / ooa3n7 698-726 / 自己被拖行 462-490 |
 *
 * 500 落在缝隙里，中心距离却判给 ooa3n7（中心 712，距离 212）→ 又跳一格（实测"松手变成
 * 末尾"）。行矩形紧挨、不重叠，所以"压在哪一行上"最多只有一个答案；缝隙就是"什么都没压住"，
 * 此时**维持现状**才是用户看到的那个位置。band 命中的行唯一 ⇒ 不需要距离比较，也不需要滞回：
 * 一旦换位，被拖行就落到指针下方，判据 2 立刻接管（收敛）。
 *
 * 判据 1 必须按**行矩形**（`top`/`bottom`）判，不能按"自己的中心离指针比目标行中心更近"判：
 * 后者在指针离开被拖行、跨到别的板块时两边距离都很大，而被拖行往往仍然更近（它就在列表边上），
 * 于是判据永远成立 → **拖到哪儿顺序都不动**（用户反馈"跨板块/空白处拖动全无反应"）。
 * 行矩形是有界的，离开这一行就不再成立。
 */
export function resolveHoverTarget(
  model: OutlineModel,
  payload: OutlineDragPayload,
  rows: readonly DropRowBox[],
  pointerY: number,
  activeKey: string | null,
  marginPx: number = HOVER_HYSTERESIS_PX,
): HoverResolution {
  // 1) 指针压在别的板块/别的条目的行上：这个手势不是"在本组内排序"，一律维持现状
  //    （真机上 drop 目标恒为树容器，详见 `pointerOverForeignRow`）。
  if (pointerOverForeignRow(payload, rows, pointerY, marginPx)) return { kind: "keep" };
  // 2) 指针压在被拖行自己的行矩形里（含 ±margin 缓冲带）：不要把自己算成新目标。
  const self = selfRowBand(model, payload, rows);
  if (pointerY >= self.top - marginPx && pointerY <= self.bottom + marginPx)
    return { kind: "keep" };
  // 3~5) band：只认"指针真的压在某个同类行矩形内"；缝隙什么都不猜。
  const hit = bandHitRow(model, payload, rows, pointerY);
  if (hit.kind === "self" || hit.kind === "gap") return { kind: "keep" };
  // 判据 3 对两类落点一致：命中的就是当前目标 → keep（不重复 setState）。
  if (hit.key === activeKey) return { kind: "keep" };
  // 占位行：落点不是下标 → 返回被拖要点自己的基准下标（预览"不动" = 复位成真实顺序），
  // 用户看到的高亮槽位就是"搬进这个空字段"的结果。
  if (hit.kind === "field") {
    return { kind: "target", key: hit.key, index: Math.max(0, dragStartIndex(model, payload)) };
  }
  return { kind: "target", key: hit.key, index: hit.index };
}

/** drop 的几何落点：`row` = 压在同类行上；`field` = 压在空字段占位行上；`commit` = 提交预览。 */
export type DropPointResolution =
  | { kind: "row"; index: number }
  | { kind: "field"; pointField: string }
  | { kind: "commit" }
  | { kind: "reject" };

/**
 * drop 的几何解析（`data-tree-key` 拿不到时用；真机上恒为此路径）。
 *
 * **与 `resolveHoverTarget` 共用 `bandHitRow`**，这是"松手提交的位置 == 拖动中看到的位置"
 * 的唯一保证：旧实现 drop 走"中心距离最近"、hover 走另一套判定，缝隙处必然分叉
 * （hover 停在 index1、drop 提交 index2，用户看到"松手后又跳了一格"）。
 * 缝隙里返回 `commit`，由调用方提交 `sortSession.currentIndex`（原地时是 no-op）。
 */
export function resolveDropPoint(
  model: OutlineModel,
  payload: OutlineDragPayload,
  rows: readonly DropRowBox[],
  pointerY: number,
  marginPx: number = HOVER_HYSTERESIS_PX,
): DropPointResolution {
  if (pointerOverForeignRow(payload, rows, pointerY, marginPx)) return { kind: "reject" };
  const hit = bandHitRow(model, payload, rows, pointerY);
  if (hit.kind === "row") return { kind: "row", index: hit.index };
  if (hit.kind === "field") return { kind: "field", pointField: hit.pointField };
  return { kind: "commit" };
}

/**
 * 落点下标 → 一条命令（与键盘/会话提交共用命令层，语义不可能分叉）。
 *
 * 要点落点下标是**条目内扁平要点列表**的下标：同字段派发 `reorder-point`（与历史行为一字
 * 不差），跨字段派发 `move-point`——把这一条搬到目标字段数组的那个位置（`pointMove.ts`）。
 */
export function dragDropCommand(
  model: OutlineModel,
  payload: OutlineDragPayload,
  toIndex: number,
): OutlineCommand {
  if (payload.kind === "entry") {
    return { type: "reorder-entry", field: payload.field, objectId: payload.objectId, toIndex };
  }
  const points =
    findOutlineEntry(model, {
      kind: "entry",
      field: payload.field,
      objectId: payload.objectId,
    })?.points ?? [];
  const move = pointMoveOf(points, {
    pointField: payload.pointField,
    pointId: payload.pointId,
    startIndex: dragStartIndex(model, payload),
    currentIndex: toIndex,
  });
  if (move && !move.sameField) {
    return {
      type: "move-point",
      field: payload.field,
      objectId: payload.objectId,
      fromPointField: move.fromPointField,
      toPointField: move.toPointField,
      pointId: payload.pointId,
      toIndex: move.toIndex,
    };
  }
  return {
    type: "reorder-point",
    field: payload.field,
    objectId: payload.objectId,
    pointField: payload.pointField,
    pointId: payload.pointId,
    toIndex: move ? move.toIndex : toIndex,
  };
}
