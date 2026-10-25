// SPDX-License-Identifier: Apache-2.0
/**
 * 「字符级加粗」的**乐观叠加层**（overlay）：把"还没保存的粗体"记在内容之外。
 *
 * ## 为什么不能直接改 `content`
 *
 * `detail.content` 是**服务端那份**的可编辑副本：宿主靠它判断"编辑器要不要回填"、
 * 拿它去 PATCH、拿它算内容签名。就地改它会连锁触发一串"内容变了"的判定（编辑器回填、
 * 建议重置、诊断卡重算），而且用户点「放弃修改」时撤不回来。
 *
 * 所以加粗只记一条 `path → { raw, base }`：
 *
 * - `raw` 是加粗后的源串（含 `**`）；
 * - `base` 是**加粗前**的原文。
 *
 * `base` 就是失效判据：读的时候若 `content` 里那条路径**已经不是** `base`（用户在中栏
 * 改了这句、AI 修订整段换了内容），这条 overlay 自动作废。这样"编辑器里改过这个字段"
 * 与"纸面上加粗过这个字段"的冲突不需要任何额外通知——比对本身就兜住了。
 *
 * ## 合并只碰字符串叶子
 *
 * `merge` 只写到路径指向的字段，`photo`（base64 图片）这类非字符串字段连读都不读：
 * 一条算错的路径不该把整份内容改成空对象。
 *
 * ## 受控模式（W02/W03 收口）
 *
 * 默认仍由本 hook 自己持有 overlay；传入 `overlays + onChange` 即交给宿主持有——制作台要把
 * 粗体并进统一历史时必须用受控模式，否则"撤销"只退得回正文，退不回纸面上的粗体。
 */
import { useCallback, useMemo, useState } from "react";
import type { ResumeContent } from "../../types";

/** 一条加粗 overlay：`raw` 是加粗后的源串，`base` 是加粗前的原文。 */
export interface RichTextOverlay {
  raw: string;
  base: string;
}

/** `path → overlay`。键是后端模板里的 `data-resume-path`（如 `experience.0.description.1`）。 */
export type RichTextOverlayMap = Record<string, RichTextOverlay>;

export interface RichTextOverridesApi {
  /** 叠加 overlay 之后的整份内容（没有 overlay 时与入参**同一个引用**，调用方不必再判断）。 */
  merged: ResumeContent | null;
  /**
   * 有没有还没保存的加粗。
   *
   * 它**必须**进宿主的脏值：overlay 不在 `detail.content` 里，编辑器的 `dirty` 看不见它，
   * 于是"在纸面上加了粗 → 关掉制作台"会一声不响地丢掉（顶部的保存/取消也不出现）。
   */
  dirty: boolean;
  /** 读一条路径"现在该显示什么"（有 overlay 且未过期时给 overlay，否则给内容里的值）。 */
  read: (path: string) => string | null;
  /**
   * 写入一条 overlay，返回**叠加后**的整份内容。
   *
   * 返回新内容而不是让调用方再读一次 state：同一次点击里既要把 overlay 记下来、又要把
   * 合并结果交给预览，读 `state` 会读到上一帧（React 的 setState 不是同步的）。
   */
  apply: (path: string, next: string, base: string) => ResumeContent | null;
  /** 纯函数版合并：返回新对象，调用方拿它去 PATCH / 渲染。 */
  merge: (content: ResumeContent | null) => ResumeContent | null;
  /** 全部清空（保存成功后调用：内容已经落到服务端，overlay 再留着就会盖住新值）。 */
  clear: () => void;
  /** 丢掉所有"base 已经对不上"的条目。 */
  dropStale: (content: ResumeContent | null) => void;
  /** 结构重排后把键换成新下标（旧路径 → 新路径）；没动过的条目保持原键。 */
  remapPaths: (mapping: Map<string, string>) => void;
}

/** 按点分路径取一个节点。取不到返回 `undefined`（数组下标也是字符串键，天然支持）。 */
export function getByPath(source: unknown, path: string): unknown {
  let node: unknown = source;
  for (const key of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** 按点分路径取一个**字符串**叶子；路径指向的不是字符串时返回 `null`。 */
export function readStringAt(source: unknown, path: string): string | null {
  const value = getByPath(source, path);
  return typeof value === "string" ? value : null;
}

/**
 * 不可变写入：沿路径逐层浅拷贝，未涉及的兄弟节点保持原引用。
 *
 * 不可变是硬要求——宿主用 `content` 的**引用**判断"内容换没换"（编辑器回填、内容签名），
 * 就地改一个字段而引用不动，等于什么都没告诉它。
 */
function writePath(node: unknown, keys: string[], value: string): unknown {
  if (keys.length === 0) return value;
  const [head, ...rest] = keys;
  if (Array.isArray(node)) {
    const index = Number(head);
    const next = node.slice();
    next[index] = writePath(next[index], rest, value);
    return next;
  }
  const base = node !== null && typeof node === "object" ? (node as Record<string, unknown>) : {};
  return { ...base, [head]: writePath(base[head], rest, value) };
}

/** 按点分路径写一个字符串叶子，返回新对象（不修改入参）。 */
export function setByPath<T>(source: T, path: string, value: string): T {
  return writePath(source, path.split("."), value) as T;
}

/**
 * 把 overlay 叠到 `content` 上（纯函数）。
 *
 * 只有"内容里那条路径当前值 === base"的条目才生效：对不上的说明用户已经在中栏改过这个
 * 字段（或者 AI 修订换掉了整段），此时以内容为准——用户最后看到的那句话必须是他自己写的。
 */
export function mergeOverlays(
  content: ResumeContent | null,
  overlays: RichTextOverlayMap,
): ResumeContent | null {
  if (!content) return null;
  const entries = Object.entries(overlays);
  if (entries.length === 0) return content;
  let merged = content;
  let changed = false;
  for (const [path, overlay] of entries) {
    if (readStringAt(merged, path) !== overlay.base) continue;
    merged = setByPath(merged, path, overlay.raw);
    changed = true;
  }
  return changed ? merged : content;
}

/** 读一条路径的生效值：overlay 未过期用 `raw`，否则用内容里的值。 */
export function readOverlay(
  content: ResumeContent | null,
  overlays: RichTextOverlayMap,
  path: string,
): string | null {
  const current = readStringAt(content, path);
  const overlay = overlays[path];
  if (!overlay || current === null) return current;
  return current === overlay.base ? overlay.raw : current;
}

export interface RichTextOverridesOptions {
  /**
   * 受控模式的当前值。传了它（哪怕是空对象）就不再使用 hook 内部 state——这是 W02/W03
   * 收口要求的"唯一状态"：宿主同时要拿 overlay 去合并保存、判脏值、做撤销/恢复。
   */
  overlays?: RichTextOverlayMap;
  /** 受控模式的写回口；与 `overlays` 成对提供。 */
  onChange?: (next: RichTextOverlayMap) => void;
}

/** 结构重排：把 path → overlay 的键换成新下标；没有键变化时返回入参本身。 */
function remapOverlayKeys(
  overlays: RichTextOverlayMap,
  mapping: Map<string, string>,
): RichTextOverlayMap {
  const next: RichTextOverlayMap = {};
  let changed = false;
  for (const [path, overlay] of Object.entries(overlays)) {
    const target = mapping.get(path) ?? path;
    if (target !== path) changed = true;
    next[target] = overlay;
  }
  return changed ? next : overlays;
}

export function useRichTextOverrides(
  content: ResumeContent | null,
  options: RichTextOverridesOptions = {},
): RichTextOverridesApi {
  const [ownOverlays, setOwnOverlays] = useState<RichTextOverlayMap>({});
  const controlled = options.overlays !== undefined;
  const overlays = options.overlays ?? ownOverlays;
  const { onChange } = options;

  const commit = useCallback(
    (next: RichTextOverlayMap) => {
      if (controlled) onChange?.(next);
      else setOwnOverlays(next);
    },
    [controlled, onChange],
  );

  const merged = useMemo(() => mergeOverlays(content, overlays), [content, overlays]);

  const read = useCallback(
    (path: string) => {
      const current = readStringAt(content, path);
      const overlay = overlays[path];
      if (!overlay) return current;
      if (current !== null && current === overlay.base) return overlay.raw;
      // 过期条目顺手丢掉：留着它只会在下一次保存时被再判一遍（读只发生在事件处理器里，
      // 这里 setState 不会撞上渲染期）。
      const rest = { ...overlays };
      delete rest[path];
      commit(rest);
      return current;
    },
    [commit, content, overlays],
  );

  const apply = useCallback(
    (path: string, next: string, base: string) => {
      if (!content) return null;
      const nextOverlays: RichTextOverlayMap = { ...overlays, [path]: { raw: next, base } };
      commit(nextOverlays);
      return mergeOverlays(content, nextOverlays);
    },
    [commit, content, overlays],
  );

  const merge = useCallback(
    (target: ResumeContent | null) => mergeOverlays(target, overlays),
    [overlays],
  );

  const clear = useCallback(() => {
    if (Object.keys(overlays).length === 0) return;
    commit({});
  }, [commit, overlays]);

  const dropStale = useCallback(
    (target: ResumeContent | null) => {
      if (!target) {
        if (Object.keys(overlays).length === 0) return;
        commit({});
        return;
      }
      const kept: RichTextOverlayMap = {};
      for (const [path, overlay] of Object.entries(overlays)) {
        if (readStringAt(target, path) === overlay.base) kept[path] = overlay;
      }
      if (Object.keys(kept).length === Object.keys(overlays).length) return;
      commit(kept);
    },
    [commit, overlays],
  );

  const remapPaths = useCallback(
    (mapping: Map<string, string>) => {
      const next = remapOverlayKeys(overlays, mapping);
      if (next !== overlays) commit(next);
    },
    [commit, overlays],
  );

  return {
    merged,
    dirty: Object.keys(overlays).length > 0,
    read,
    apply,
    merge,
    clear,
    dropStale,
    remapPaths,
  };
}
