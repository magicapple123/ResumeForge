// SPDX-License-Identifier: Apache-2.0
/**
 * 选择 → 来源定位的**适配层**（W12-FE 与制作台 shell 之间的唯一契约）。
 *
 * ## 为什么需要它
 *
 * 来源查询要三样东西：`object_id` / `point_id` / `path`。而制作台里的"选中"有两个来源：
 * 大纲（W06 的 `OutlineSelection`，只有稳定 id，没有路径）和纸面点击（`pickTarget.path`，
 * 只有路径）。两边形状不同，如果让每个面板自己拼，就会出现"大纲选中时查不到来源、
 * 纸面点中时又能查到"这种半通状态。
 *
 * 所以这里定义**一个定位类型** + 两个入口，shell 只负责把选择喂进来：
 *
 * ```ts
 * const locator = locatorFromSelection(selection);   // 大纲
 * const locator = locatorFromPath(pickTarget.path);  // 纸面
 * ```
 *
 * ## 边界
 *
 * 本文件**不 import** outline/editor 的任何类型（鸭子类型入参）：provenance 是更底层的
 * 领域，反过来依赖大纲会让"来源面板能单独复用"这件事失效（也容易成环）。
 */

/** 一次来源查询的定位；三项都可空，但至少一项非空才有意义。 */
export interface ProvenanceLocator {
  object_id: string | null;
  point_id: string | null;
  /** data-resume-path 写法；纸面点击一定有，大纲选择通常没有。 */
  path: string | null;
  /** 给事实锁面板显示的标签（可选）。 */
  label?: string;
}

/** 空定位（没有选中任何东西）。 */
export const EMPTY_LOCATOR: ProvenanceLocator = {
  object_id: null,
  point_id: null,
  path: null,
};

interface SelectionLike {
  kind?: string | null;
  field?: string | null;
  objectId?: string | null;
  pointId?: string | null;
  pointField?: string | null;
  path?: string | null;
  label?: string | null;
}

/**
 * 大纲选中 → 定位。
 *
 * - `kind === "personal"`：个人信息不是条目，没有对象 id（脚本层可另用纸面路径）；
 * - `kind === "entry"`：只给 object_id，**不带 path**（路径由服务端按 id 现算，排序不失效）；
 * - `kind === "point"`：同时给 object_id 与 point_id。
 */
export function locatorFromSelection(
  selection: SelectionLike | null | undefined,
): ProvenanceLocator {
  if (!selection) return { ...EMPTY_LOCATOR };
  const objectId =
    typeof selection.objectId === "string" && selection.objectId ? selection.objectId : null;
  const pointId = selection.kind === "point" && selection.pointId ? selection.pointId : null;
  const path = typeof selection.path === "string" && selection.path ? selection.path : null;
  const label =
    typeof selection.label === "string" && selection.label ? selection.label : undefined;
  if (selection.kind === "personal" && !path) {
    return { object_id: null, point_id: null, path: null, label };
  }
  return { object_id: objectId, point_id: pointId, path, label };
}

/** 纸面点击 → 定位（只有路径；查询时由服务端/前端按 path 匹配目标块）。 */
export function locatorFromPath(
  path: string | null | undefined,
  label?: string,
): ProvenanceLocator {
  const value = typeof path === "string" && path ? path : null;
  return { object_id: null, point_id: null, path: value, label };
}

/** 定位是否为空（界面据此显示「先选中一条内容」而不是空面板）。 */
export function isEmptyLocator(locator: ProvenanceLocator | null | undefined): boolean {
  if (!locator) return true;
  return !locator.object_id && !locator.point_id && !locator.path;
}

/**
 * 定位的稳定字符串键：供 React effect 依赖与"选择没变就不重查"判断。
 * 三个值都可能含分隔符，所以用 JSON 序列化而不是裸拼字符串。
 */
export function locatorKey(locator: ProvenanceLocator | null | undefined): string {
  const value = locator ?? EMPTY_LOCATOR;
  return JSON.stringify([value.object_id ?? null, value.point_id ?? null, value.path ?? null]);
}

/** 两次定位是否指向同一目标（忽略 label）。 */
export function isSameLocator(
  left: ProvenanceLocator | null | undefined,
  right: ProvenanceLocator | null | undefined,
): boolean {
  return locatorKey(left) === locatorKey(right);
}
