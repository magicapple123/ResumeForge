// SPDX-License-Identifier: Apache-2.0
/**
 * 进度页排序状态（R13）：**字段 + 方向**，写进 URL 的 `?sort=&order=`。
 *
 * ## 为什么排序不能只在前端做
 *
 * 列表是服务端分页（20 条/页，`GET /api/tracker/page`）。在本地排只能排"当前这一页"，
 * 翻到第 2 页会看到"第 21 条排到了第 1 条前面"这种自相矛盾的结果。所以状态在这里拼成
 * 查询参数，排序下推 SQL（`services/tracker_query.track_order_by`）。
 *
 * ## 为什么状态放在这个纯函数模块里
 *
 * 「同值再点一次 = 翻转」「换字段回该字段默认方向」「阶段优先没有方向」三条都是**语义**，
 * 不是渲染细节。写进组件里就只能靠点界面来验，放在这里可以直接单测。
 *
 * 口径与后端 `normalize_track_sort` 一一对应：前端也做一次同样的兜底，这样读回一个手改坏
 * 的 URL 时，**界面显示的方向**与**服务端真正用的方向**不会各说一套。
 */

/** 可排序字段：与后端 `TRACK_SORT_KEYS` 一一对应。 */
export type TrackSortKey = "stage" | "updated" | "next_action_date" | "applied_at" | "company";

/** 排序方向。`stage` 是复合次序（阶段序 → 更新时间 → id），方向用空串表示"无"。 */
export type TrackSortOrder = "asc" | "desc";

export interface TrackSortState {
  key: TrackSortKey;
  /** 只有 `stage` 会是空串：菜单不给它方向，URL 里也不写。 */
  order: TrackSortOrder | "";
}

/** 菜单顺序 = 本数组顺序：固定不变，免得每次改动都把用户的手指记忆打乱。 */
export const TRACK_SORT_KEYS: readonly TrackSortKey[] = [
  "stage",
  "updated",
  "next_action_date",
  "applied_at",
  "company",
];

/** 默认排序：阶段优先，等于改造前写死的次序（刷新后不写 URL 也能复原）。 */
export const DEFAULT_TRACK_SORT: TrackSortState = Object.freeze({
  key: "stage",
  order: "",
});

/** 每个字段的默认方向（与后端 `TRACK_SORT_DEFAULT_ORDER` 同值）。 */
export const TRACK_SORT_DEFAULT_ORDERS: Record<Exclude<TrackSortKey, "stage">, TrackSortOrder> = {
  updated: "desc",
  next_action_date: "asc",
  applied_at: "desc",
  company: "asc",
};

function isTrackSortKey(value: string): value is TrackSortKey {
  return (TRACK_SORT_KEYS as readonly string[]).includes(value);
}

function isTrackSortOrder(value: string): value is TrackSortOrder {
  return value === "asc" || value === "desc";
}

/**
 * URL 参数 → 排序状态。任何非法组合都回落默认（**不抛错**）：手改坏的 `?sort=foo`
 * 应该按默认次序把数据摆出来，而不是让整页进错误态。
 */
export function parseTrackSort(
  sort: string | null | undefined,
  order: string | null | undefined,
): TrackSortState {
  const key = (sort ?? "").trim().toLowerCase();
  if (!isTrackSortKey(key)) return DEFAULT_TRACK_SORT;
  if (key === "stage") return DEFAULT_TRACK_SORT;
  const direction = (order ?? "").trim().toLowerCase();
  return {
    key,
    order: isTrackSortOrder(direction) ? direction : TRACK_SORT_DEFAULT_ORDERS[key],
  };
}

/**
 * 点菜单项之后的状态：**同字段再点 = 翻转；换字段 = 该字段默认方向；阶段优先恒定**。
 *
 * 为什么翻转换算在这里而不是用 antd `Menu` 的选中态：`Select`/`Menu` 重选同一个值不会
 * 触发变更回调，"再点一次翻转"根本表达不出来，所以翻转必须自己算。
 */
export function nextTrackSort(current: TrackSortState, clicked: TrackSortKey): TrackSortState {
  if (clicked === "stage") return DEFAULT_TRACK_SORT;
  if (current.key === clicked) {
    return { key: clicked, order: current.order === "asc" ? "desc" : "asc" };
  }
  return { key: clicked, order: TRACK_SORT_DEFAULT_ORDERS[clicked] };
}

/**
 * 状态 → 请求参数。默认为空对象：默认排序**不写 URL、也不发多余参数**，
 * 这样"改造前的老链接"和"什么都没动的新链接"请求逐字节相同。
 */
export function trackSortParams(state: TrackSortState): {
  sort?: TrackSortKey;
  order?: TrackSortOrder;
} {
  if (state.key === "stage") return {};
  return { sort: state.key, order: state.order === "" ? undefined : state.order };
}
