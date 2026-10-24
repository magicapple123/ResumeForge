// SPDX-License-Identifier: Apache-2.0
/**
 * 命名版本 / 岗位变体的纯规则（W13）：排序、同步路径选项、比较摘要。
 *
 * 与组件分开：这些判定决定"用户看到哪些可同步路径、比较结果怎么说"，错了不会报错，
 * 只会让用户同步错东西（把岗位定制覆盖掉）——必须在纯函数层钉住。
 */
import { formatDateTime } from "../../utils/format";
import type { VersionCompareOut, VersionOut } from "./types";

/** 版本列表：新的在前（同时间按 id 倒序，保证稳定）。 */
export function sortVersions(versions: readonly VersionOut[]): VersionOut[] {
  return [...versions].sort((left, right) => {
    const leftTime = left.created_at ? Date.parse(left.created_at) : 0;
    const rightTime = right.created_at ? Date.parse(right.created_at) : 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return right.id - left.id;
  });
}

/** 版本时间的展示文本；缺失/坏值显示空串（不编造时间）。 */
export function versionTimeText(iso: string | null | undefined): string {
  if (!iso) return "";
  return formatDateTime(iso);
}

export interface SyncPathOption {
  /** 后端接受的 dot path（可指向标量、对象或数组元素）。 */
  path: string;
  /** 分组（顶层字段/板块键）。 */
  group: string;
  /** 条目里用于辨认的一小段文字（公司/学校/名称…）。 */
  label: string;
}

/** 同步路径里刻意排除的键：照片是 base64 大字段，同步它没有产品意义且会撑爆请求。 */
const EXCLUDED_TOP_LEVEL = new Set(["photo"]);

function entryLabel(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  for (const key of ["company", "school", "name", "organization", "role", "title"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return fallback;
}

/**
 * 从内容结构生成"可选择性同步"的路径选项。
 *
 * 粒度选择：顶层字段 + 数组板块的**每条**（`experience.0`），而不是叶子级别——
 * 后端 `_write_path` 支持指向对象/数组元素，整条同步更符合"换岗位时同步这一段经历"
 * 的直觉，也避免用户被迫勾选几十个叶子路径。
 */
export function buildSyncPathOptions(
  content: Record<string, unknown> | null | undefined,
): SyncPathOption[] {
  if (!content) return [];
  const options: SyncPathOption[] = [];
  for (const [key, value] of Object.entries(content)) {
    if (EXCLUDED_TOP_LEVEL.has(key)) continue;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        options.push({
          path: `${key}.${index}`,
          group: key,
          label: entryLabel(item, `${index + 1}`),
        });
      });
      continue;
    }
    if (typeof value === "object" && value !== null) continue;
    options.push({ path: key, group: key, label: String(value ?? "").slice(0, 40) });
  }
  return options;
}

export interface CompareDigest {
  /** 正文新增/删除行数。 */
  contentAdded: number;
  contentRemoved: number;
  layoutChanged: number;
  /** 排版完全一致（但仍然有正文差异/全等）。 */
  layoutEqual: boolean;
  /** 归一化后的全部一致（无正文行差 + 排版一致）。 */
  identical: boolean;
}

export function summarizeCompare(compare: VersionCompareOut): CompareDigest {
  const contentAdded = compare.content.stats.added;
  const contentRemoved = compare.content.stats.removed;
  const layoutChanged =
    compare.layout.added.length + compare.layout.removed.length + compare.layout.changed.length;
  return {
    contentAdded,
    contentRemoved,
    layoutChanged,
    layoutEqual: compare.layout.equal,
    identical: contentAdded === 0 && contentRemoved === 0 && layoutChanged === 0,
  };
}

/** 变更摘要文本（服务端会按上一版生成行数摘要；空串 = 没有摘要可展示）。 */
export function versionChangeSummary(version: VersionOut): string {
  return version.change_summary.trim();
}
