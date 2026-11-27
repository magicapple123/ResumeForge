// SPDX-License-Identifier: Apache-2.0
/**
 * 密钥依赖矩阵的**纯计算部分**（#9）：把 `matrix` 投影成"格子怎么画"。
 *
 * 抽出来的理由有两条：
 *
 * 1. 组件里只留排版，判定（这条边算什么、格子属于哪一行/列、三档各多少）集中在这里，
 *    不会出现"表头按一种口径算、格子按另一种算"；
 * 2. 这些判断都能用普通单测钉住（jsdom 没有布局，但 Map 有没有那个键是确定的）。
 *
 * **这里没有任何 Key id / 名字**：列、行、边全部来自 payload（后端 registry 的投影）。
 * 一旦这里出现 `"session"` 之类的字面量，新增一把覆盖式 Key 时就会被画成普通依赖，
 * 而那种错误在界面上看不出来。
 */

import type {
  ConnectionMatrix,
  ConnectionMatrixEdge,
  ConnectionMatrixFeature,
  ConnectionMatrixKey,
} from "../../types";

/** 当前聚焦的是哪一列（密钥）或哪一行（功能）。 */
export type MatrixFocus = { kind: "key"; id: string } | { kind: "feature"; id: string };

/** 汇总行可点筛选的三档（与凭据三态同一套协议值）。 */
export type MatrixStatusFilter = "saved" | "not_configured" | "session_only";

/** 三档筛选的固定顺序：界面从左到右、键盘从左到右都是这个顺序。 */
export const MATRIX_FILTERS: readonly MatrixStatusFilter[] = [
  "saved",
  "not_configured",
  "session_only",
];

/**
 * 后端给的凭据状态 → 矩阵里的三档（R18）。
 *
 * 为什么要有这一层：凭据状态比三档多（C 组下载源还有 `default` / `modified`），而矩阵只讲
 * "这把 Key 现在能不能用"。**列头小标签与汇总计数必须走同一个映射**——各写一份的结果是
 * "标签写着已保存、计数把它算进未配置"，那种自相矛盾比不显示更糟。
 */
export function matrixStatusOf(status: string): MatrixStatusFilter {
  if (status === "saved") return "saved";
  if (status === "session_only") return "session_only";
  // `not_configured` 与 C 组的 `default` / `modified` 都归这一档：没有可用密钥。
  return "not_configured";
}

/** 格子键：一把 Key × 一个功能。用 NUL 分隔，避免 id 里出现连字符时拼串撞车。 */
export function edgeId(keyId: string, featureId: string): string {
  return `${keyId}\u0000${featureId}`;
}

/** `edgeId → kind`。格子只查表，不在渲染时按 id 猜"这是不是覆盖式"。 */
export function buildEdgeMap(matrix: ConnectionMatrix): Map<string, ConnectionMatrixEdge["kind"]> {
  const map = new Map<string, ConnectionMatrixEdge["kind"]>();
  for (const edge of matrix.edges) map.set(edgeId(edge.key, edge.feature), edge.kind);
  return map;
}

/** 三档各有多少把（**算出来**，不手写）：三档之和必须等于 `keys.length`。 */
export function countByStatus(
  keys: readonly ConnectionMatrixKey[],
): Record<MatrixStatusFilter, number> {
  const counts: Record<MatrixStatusFilter, number> = {
    saved: 0,
    not_configured: 0,
    session_only: 0,
  };
  for (const key of keys) {
    counts[matrixStatusOf(key.status)] += 1;
  }
  return counts;
}

/** 按筛选取列（`null` = 不过滤）。顺序保持 payload 的顺序，不重排。 */
export function visibleKeys(
  keys: readonly ConnectionMatrixKey[],
  filter: MatrixStatusFilter | null,
): ConnectionMatrixKey[] {
  if (filter === null) return [...keys];
  return keys.filter((key) => key.status === filter);
}

/** 功能按功能域分组，**保持声明顺序**（组的顺序 = 第一次出现的顺序）。 */
export function groupFeatures(
  features: readonly ConnectionMatrixFeature[],
): { group: string; items: ConnectionMatrixFeature[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, ConnectionMatrixFeature[]>();
  for (const feature of features) {
    const bucket = byGroup.get(feature.group);
    if (bucket) {
      bucket.push(feature);
    } else {
      byGroup.set(feature.group, [feature]);
      order.push(feature.group);
    }
  }
  return order.map((group) => ({ group, items: byGroup.get(group) ?? [] }));
}

/**
 * 一条边都没有的功能（只经过闸门）。
 *
 * 它们**不画行**：一排空格子既占地方又让人以为"这里应该有东西"。合成一句说明放在
 * 闸门带下面，比空行诚实。
 */
export function gateOnlyFeatures(
  features: readonly ConnectionMatrixFeature[],
  edges: readonly ConnectionMatrixEdge[],
): ConnectionMatrixFeature[] {
  const referenced = new Set(edges.map((edge) => edge.feature));
  return features.filter((feature) => !referenced.has(feature.id));
}

/**
 * 矩阵里真的画行的功能 = 至少有一条边。
 *
 * 与 :func:`gateOnlyFeatures` 是同一判据的两半：一个功能不会既画行又被合并成一句说明。
 */
export function rowFeatures(
  features: readonly ConnectionMatrixFeature[],
  edges: readonly ConnectionMatrixEdge[],
): ConnectionMatrixFeature[] {
  const referenced = new Set(edges.map((edge) => edge.feature));
  return features.filter((feature) => referenced.has(feature.id));
}

/** 某个功能依赖哪些 Key（详情卡用，按列顺序，不按字母）。 */
export function keysOfFeature(matrix: ConnectionMatrix, featureId: string): ConnectionMatrixKey[] {
  const keyIds = new Set(
    matrix.edges.filter((edge) => edge.feature === featureId).map((edge) => edge.key),
  );
  return matrix.keys.filter((key) => keyIds.has(key.id));
}
