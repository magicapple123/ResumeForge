// SPDX-License-Identifier: Apache-2.0
/**
 * 命名版本 / 岗位变体的纯规则（W13）：排序、同步路径选项、比较摘要。
 *
 * 与组件分开：这些判定决定"用户看到哪些可同步路径、比较结果怎么说"，错了不会报错，
 * 只会让用户同步错东西（把岗位定制覆盖掉）——必须在纯函数层钉住。
 */
import { formatDateTime } from "../../../utils/format";
import { entryDisplayLabel } from "../document/summarize";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { sectionDisplayLabel } from "../outline/sectionLabels";
import { FALLBACK_HEADER_FIELDS } from "../document/fieldCatalogData";
import { t } from "../../../i18n";
import type { VersionChangeOut, VersionCompareOut, VersionOut } from "./types";

/** 版本列表：新的在前（同时间按 id 倒序，保证稳定）。 */
export function sortVersions(versions: readonly VersionOut[]): VersionOut[] {
  return [...versions].sort((left, right) => {
    const leftTime = left.created_at ? Date.parse(left.created_at) : 0;
    const rightTime = right.created_at ? Date.parse(right.created_at) : 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return right.id - left.id;
  });
}

/**
 * #28/#29：名称留空时的自动命名时间（精确到秒，避免同一分钟创建两版重名）。
 * 只用于名字文本，不参与任何时间比较。
 */
export function autoNameTime(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

/** 版本时间的展示文本；缺失/坏值显示空串（不编造时间）。 */
export function versionTimeText(iso: string | null | undefined): string {
  if (!iso) return "";
  return formatDateTime(iso);
}

export interface SyncPathOption {
  /** 后端接受的 dot path：`header.<itemId>` 或 `<sectionKey>.<entryId>`。 */
  path: string;
  /** 分组键（板块 key；`header` = 基本信息）。 */
  group: string;
  /** 分组显示名（板块名，自建板块用文档里的 title）。 */
  groupLabel: string;
  /** 条目显示名（与结构树/分页面板同一个 `entryDisplayLabel`）。 */
  label: string;
}

/** 基本信息的伪板块键：样式与真实板块共用一套分组渲染，后端只认 `header.<itemId>`。 */
export const HEADER_SYNC_GROUP = "header";

/** 页眉字段目录还没加载时的中文兜底（与 DocumentHeaderPanel 用同一份目录数据）。 */
function fallbackHeaderLabel(key: string): string | undefined {
  const spec = FALLBACK_HEADER_FIELDS.find((field) => field.key === key);
  return spec ? t(spec.labelKey) : undefined;
}

/**
 * 从**当前 v2 文档**生成"可选择性同步"的路径选项（R-23 重写，#29c 统一 id 路径）。
 *
 * 旧实现读 v1 的 `content` 顶层键 + 数组下标（`experience.0`），而制作台传的是 v2 文档：
 * 顶层只有 `version/language/header/sections`，于是列表里只剩 `version`、`language` 这类
 * 纯数字/枚举标签，真勾选同步时后端 `resolve_document_path` 直接 400。
 *
 * 现在按后端的路径语法生成：`header.<itemId>`（全站其它页眉路径同一口径）与
 * `<sectionKey>.<entryId>`。只列**有条目**的板块（空板块同步过去只会覆盖成空数组）；
 * 缺 id 的旧条目不进列表。
 */
export function buildSyncPathOptions(
  document: ResumeDocument | null | undefined,
  /** #29：字段名的本地化解析（字段目录）；不传则回落文档 label / 目录兜底 / 原始 key。 */
  resolveLabel?: (key: string, sectionKey?: string) => string | undefined,
): SyncPathOption[] {
  if (!document) return [];
  const options: SyncPathOption[] = [];
  const headerLabel = t("structure.node.header");
  for (const item of document.header.items) {
    options.push({
      path: `header.${item.id}`,
      group: HEADER_SYNC_GROUP,
      groupLabel: headerLabel,
      // #29b：`name`/`gender` 这类页眉 key 必须显示中文名（目录 → 本地兜底 → 文档 label）。
      label:
        item.label?.trim() || resolveLabel?.(item.key) || fallbackHeaderLabel(item.key) || item.key,
    });
  }
  for (const section of document.sections) {
    if (section.entries.length === 0) continue;
    const sectionLabel = sectionDisplayLabel(section);
    for (const entry of section.entries) {
      if (!entry.id) continue;
      options.push({
        path: `${section.key}.${entry.id}`,
        group: section.key,
        groupLabel: sectionLabel,
        label: entryDisplayLabel(entry) || sectionLabel,
      });
    }
  }
  return options;
}

export interface CompareDigest {
  /** 新增（条目/字段/板块）条数。 */
  added: number;
  /** 删除条数。 */
  removed: number;
  /** 修改条数。 */
  changed: number;
  layoutChanged: number;
  /** 排版完全一致（但仍然有正文差异/全等）。 */
  layoutEqual: boolean;
  /** 归一化后的全部一致（无字段变化 + 排版一致）。 */
  identical: boolean;
}

export function summarizeCompare(compare: VersionCompareOut): CompareDigest {
  const changes = compare.changes ?? [];
  const added = changes.filter((change) => change.kind === "added").length;
  const removed = changes.filter((change) => change.kind === "removed").length;
  const changed = changes.filter((change) => change.kind === "changed").length;
  const layoutChanged =
    compare.layout.added.length + compare.layout.removed.length + compare.layout.changed.length;
  return {
    added,
    removed,
    changed,
    layoutChanged,
    layoutEqual: compare.layout.equal,
    identical: added === 0 && removed === 0 && changed === 0 && layoutChanged === 0,
  };
}

/**
 * #28：「比较」默认与哪一份比。
 *
 * 版本是不可变快照，用户刚保存完一版就点比较时，拿它跟**当前简历**比毫无意义
 * （内容完全相同）。有父版本时与父版本比；否则与列表里更早的一版比；都没有才比当前简历。
 */
export function compareTargetOf(
  versions: readonly VersionOut[],
  versionId: number,
): number | "current" {
  const sorted = sortVersions(versions);
  const index = sorted.findIndex((version) => version.id === versionId);
  if (index < 0) return "current";
  const target = sorted[index];
  if (target.parent_version_id != null && target.parent_version_id !== versionId) {
    return target.parent_version_id;
  }
  const older = sorted[index + 1];
  return older ? older.id : "current";
}

/** 变更摘要文本（服务端会按上一版生成行数摘要；空串 = 没有摘要可展示）。 */
export function versionChangeSummary(version: VersionOut): string {
  return version.change_summary.trim();
}

/** 字段级变更的显示值；null/空串统一成占位文案。 */
export function changeValueText(value: string | null | undefined): string {
  return value == null || value === "" ? t("versions.compare.value.empty") : value;
}

/** 变更条数 > 后端上限时界面显式说明；未截断返回空串。 */
export function changeTruncateText(compare: VersionCompareOut): string {
  return compare.changes_truncated
    ? t("versions.compare.changesTruncated", { count: compare.changes?.length ?? 0 })
    : "";
}

/** 一条字段级变更的标题：条目新增/删除给动作名，字段给本地化字段名。 */
export function changeTitle(
  change: VersionChangeOut,
  resolveLabel?: (key: string, sectionKey?: string) => string | undefined,
): string {
  if (change.scope === "entry") {
    return change.kind === "removed"
      ? t("versions.compare.entry.removed")
      : t("versions.compare.entry.added");
  }
  if (change.scope === "section") {
    return change.kind === "removed"
      ? t("versions.compare.section.removed")
      : t("versions.compare.section.added");
  }
  return (
    change.item_label?.trim() ||
    resolveLabel?.(change.item_key, change.section_key) ||
    change.item_key ||
    change.path
  );
}
