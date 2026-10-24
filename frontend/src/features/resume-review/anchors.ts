// SPDX-License-Identifier: Apache-2.0
/**
 * 批注 → 当前内容的**定位展示**（W18 / 契约 §4.4 第 7 步的前端镜像）。
 *
 * 服务端在导入时已经判定了 status（open/stale/…）；前端这里不重新判定状态，只回答
 * "这条批注现在指向文档里的哪一处、能不能跳过去"：
 *
 * 1. `object_id` 命中当前内容 → 条目/要点路径现算（排序后也跟着走）；
 * 2. `object_id` 未命中 → 回退**兼容锚点** `path`（仅当该路径在当前内容里真实存在）；
 * 3. 两者都不命中 → `via="none"`：UI 不提供"定位"，只展示 stale 与原文引用。
 *
 * **绝不下标回退**：`path` 是旧包/无 id 时的兼容锚点，它同样来自"当时那份内容"；
 * 若当前内容在该路径上已经不是同一条批注引用的文本，服务端会在导入时标 stale。
 */
import type { ResumeContent } from "../../types/resume";
import { buildOutline } from "../resume-outline/model";
import { readResumeValueByPath } from "../../utils/resumeFieldPath";

export type ReviewResolutionVia = "object-id" | "path" | "none";

export interface ReviewResolution {
  /** 当前内容里的路径（`experience.1.description.0`）；无定位时为 null。 */
  path: string | null;
  /** 条目主体名（用户数据；无定位时 null）。 */
  objectLabel: string | null;
  /** 要点原文（要点级且仍能定位时）。 */
  pointText: string | null;
  /** 用的是哪种锚点（UI 可据此提示"按旧路径定位"）。 */
  via: ReviewResolutionVia;
}

/**
 * 能提供定位信息的最小批注形状：包内批注（字段可缺省）与服务端记录（字段可为 null）都满足。
 * 空值一律按"没有这个锚点"处理。
 */
export interface ReviewAnchorInput {
  object_id?: string | null;
  point_id?: string | null;
  path?: string | null;
}

const EMPTY: ReviewResolution = { path: null, objectLabel: null, pointText: null, via: "none" };

/** 兼容锚点是否指向当前内容里真实存在的字符串叶子。 */
function pathExists(content: ResumeContent, path: string): boolean {
  return typeof readResumeValueByPath(content, path) === "string";
}

/** 从 `field.index.…` 形式的路径找条目主体名（找不到返回 null；纯展示用）。 */
function labelForPath(content: ResumeContent, path: string): string | null {
  const parts = path.split(".");
  if (parts.length < 2) return null;
  const model = buildOutline(content);
  for (const section of model.sections) {
    if (!section.field || section.field !== parts[0]) continue;
    const index = Number(parts[1]);
    const entry = section.entries[index];
    if (entry) return entry.title || null;
  }
  return null;
}

/**
 * 解析一条批注在当前内容里的位置。
 *
 * `object_id` 优先；只有它落空时才尝试 `path`（契约第 7 步的兼容锚点规则）。
 */
export function resolveAnnotationAnchor(
  content: ResumeContent | null | undefined,
  anchor: ReviewAnchorInput,
): ReviewResolution {
  if (!content) return EMPTY;
  const objectId = anchor.object_id ?? undefined;
  const pointId = anchor.point_id ?? undefined;
  if (objectId) {
    const model = buildOutline(content);
    for (const section of model.sections) {
      if (!section.field) continue;
      const entry = section.entries.find((item) => item.objectId === objectId);
      if (!entry) continue;
      const entryPath = `${section.field}.${entry.index}`;
      if (!pointId) {
        return {
          path: entryPath,
          objectLabel: entry.title || null,
          pointText: null,
          via: "object-id",
        };
      }
      const point = entry.points.find((item) => item.pointId === pointId);
      if (!point) {
        // 对象在、要点已不在：不给定位（绝不退回"同位置的另一条要点"）。
        return { path: null, objectLabel: entry.title || null, pointText: null, via: "object-id" };
      }
      return {
        path: `${entryPath}.${point.pointField}.${point.index}`,
        objectLabel: entry.title || null,
        pointText: point.text,
        via: "object-id",
      };
    }
  }
  const legacyPath = anchor.path ?? undefined;
  if (legacyPath && pathExists(content, legacyPath)) {
    return {
      path: legacyPath,
      objectLabel: labelForPath(content, legacyPath),
      pointText: null,
      via: "path",
    };
  }
  return EMPTY;
}
