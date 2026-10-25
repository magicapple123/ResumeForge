// SPDX-License-Identifier: Apache-2.0
/**
 * 语义大纲的**结构命令**（W06 / P1-01）：排序、复制、隐藏、锁定。
 *
 * 每一条命令都是纯函数：`content + command → 新 content`，不改入参、不读时钟、不发请求。
 * 这样它们既能在 jsdom 之外单测（身份稳定性是这一层最贵的性质），也能被 W03 的统一历史
 * 直接当作"一次可命名操作"记录。
 *
 * ## 三条硬规则（plan §10.1 / W00 §3）
 *
 * 1. **排序不换 id**：条目与要点都按 id 找到当前位置再移动，数组重排时 id 与内容一起走；
 *    要点排序时 `point_ids` 与文本数组**同步移动**（否则排序一次，加粗/来源全体错位）。
 * 2. **复制生成新 id**：走 W01 的 `cloneEntryWithNewIds`，条目 id 与全部要点 id 一起重生。
 * 3. **锁定按作用域阻止**：锁排版（`lock_layout`）阻止排序；锁正文（`lock_content`）
 *    阻止复制——复制会生成一份可改的正文副本，等于绕开"这段已定稿"的意图（解锁后才能复制）。
 *    隐藏/显示是可见性操作，两种锁都不阻止。
 *
 * ## 取消标志 = 删键
 *
 * 隐藏/解锁时删除字段而不是写 `false`（理由见 `flags.ts`）：旧记录的内容指纹不能因一次
 * "恢复显示"而改变。测试 `commands.test.ts` 钉住这个性质。
 */
import type { MessageKey } from "../../i18n";
import type { ResumeContent } from "../../types/resume";
import {
  cloneEntryWithNewIds,
  isObjectId,
  newObjectId,
  reorderPreservingIds,
} from "../resume-document/identity";
import {
  flagMatches,
  readEntryFlags,
  readHiddenPoints,
  writeEntryFlag,
  writeHiddenPoints,
} from "./flags";
import { entriesOf, entryIdOf, findEntryIndex, pointIdsOf, pointFieldsFor } from "./model";
import type {
  EntryField,
  EntryFlag,
  OutlineApplyResult,
  OutlineBlockReason,
  OutlineCommand,
} from "./types";

type RawEntry = Record<string, unknown>;

/** 被拒绝原因 → 面向用户的说明 key（UI 必须用 t() 翻出来，不显示原因码）。 */
export const BLOCKED_REASON_KEY: Record<OutlineBlockReason, MessageKey> = {
  "locked-layout": "outline.blocked.locked-layout",
  "locked-content": "outline.blocked.locked-content",
  "not-found": "outline.blocked.not-found",
};

/**
 * 两套条目形状的桥接：命令层拿到的是 **content 里的原始条目**（snake_case：
 * `lock_content`），而面板拿到的是 `buildOutline` 产出的 **模型条目**（camelCase：
 * `lockContent`）。守卫函数必须在两处都成立，否则会出现"界面上锁了、命令却照排"。
 * 只认 `true`：`null`/`undefined` 都是"没有设置"。
 */
interface CamelFlagCarrier {
  hidden?: boolean;
  lockContent?: boolean;
  lockLayout?: boolean;
}

function flagIsOn(entry: unknown, flag: EntryFlag): boolean {
  if (
    readEntryFlags(entry)[
      flag === "lock_layout" ? "lockLayout" : flag === "lock_content" ? "lockContent" : "hidden"
    ]
  ) {
    return true;
  }
  const camel = (entry ?? {}) as CamelFlagCarrier;
  if (flag === "lock_layout") return camel.lockLayout === true;
  if (flag === "lock_content") return camel.lockContent === true;
  return camel.hidden === true;
}

/** 这条目能不能被拖动/键盘排序（锁排版时不能；正文锁不影响顺序）。 */
export function canMoveEntry(entry: unknown): boolean {
  return !flagIsOn(entry, "lock_layout");
}

/** 这条目里的要点能不能排序（同属排版，锁排版时不能）。 */
export function canMovePoint(entry: unknown): boolean {
  return !flagIsOn(entry, "lock_layout");
}

/** 这条目能不能复制（锁正文时不能，见文件头第 3 条）。 */
export function canCloneEntry(entry: unknown): boolean {
  return !flagIsOn(entry, "lock_content");
}

/** 这条要点能不能复制：与条目同一把锁（复制正文 = 绕开"这段已定稿"）。 */
export function canClonePoint(entry: unknown): boolean {
  return !flagIsOn(entry, "lock_content");
}

function withField(content: ResumeContent, field: EntryField, entries: RawEntry[]): ResumeContent {
  return { ...content, [field]: entries } as unknown as ResumeContent;
}

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.trunc(value), Math.max(0, length - 1)));
}

function reorderEntry(
  content: ResumeContent,
  command: Extract<OutlineCommand, { type: "reorder-entry" }>,
): OutlineApplyResult {
  const entries = entriesOf(content, command.field);
  const from = findEntryIndex(content, command.field, command.objectId);
  if (from < 0) return { ok: false, reason: "not-found" };
  if (!canMoveEntry(entries[from])) return { ok: false, reason: "locked-layout" };
  const to = clampIndex(command.toIndex, entries.length);
  if (to === from) return { ok: true, content, changed: false };
  return {
    ok: true,
    content: withField(content, command.field, reorderPreservingIds(entries, from, to)),
    changed: true,
  };
}

function reorderPoint(
  content: ResumeContent,
  command: Extract<OutlineCommand, { type: "reorder-point" }>,
): OutlineApplyResult {
  const entries = entriesOf(content, command.field);
  const entryIndex = findEntryIndex(content, command.field, command.objectId);
  if (entryIndex < 0) return { ok: false, reason: "not-found" };
  const entry = entries[entryIndex];
  if (!canMovePoint(entry)) return { ok: false, reason: "locked-layout" };
  if (!pointFieldsFor(command.field).includes(command.pointField))
    return { ok: false, reason: "not-found" };
  const rawPoints = entry[command.pointField];
  const points = Array.isArray(rawPoints) ? [...(rawPoints as unknown[])] : [];
  const ids = pointIdsOf(entry, command.pointField);
  // 身份不完整（旧记录没物化 id / 长度对不上）时拒绝：按下标移动会把身份挂到别的要点上。
  if (points.length === 0 || ids.length !== points.length)
    return { ok: false, reason: "not-found" };
  const from = ids.indexOf(command.pointId);
  if (from < 0) return { ok: false, reason: "not-found" };
  const to = clampIndex(command.toIndex, points.length);
  if (to === from) return { ok: true, content, changed: false };
  const sourcePointIds =
    entry.point_ids && typeof entry.point_ids === "object"
      ? (entry.point_ids as Record<string, unknown>)
      : {};
  const nextEntry: RawEntry = {
    ...entry,
    [command.pointField]: reorderPreservingIds(points, from, to),
    point_ids: { ...sourcePointIds, [command.pointField]: reorderPreservingIds(ids, from, to) },
  };
  const nextEntries = entries.slice();
  nextEntries[entryIndex] = nextEntry;
  return { ok: true, content: withField(content, command.field, nextEntries), changed: true };
}

function cloneEntry(
  content: ResumeContent,
  command: Extract<OutlineCommand, { type: "clone-entry" }>,
): OutlineApplyResult {
  const entries = entriesOf(content, command.field);
  const from = findEntryIndex(content, command.field, command.objectId);
  if (from < 0) return { ok: false, reason: "not-found" };
  if (!canCloneEntry(entries[from])) return { ok: false, reason: "locked-content" };
  // 复制是"忠实副本"：正文、隐藏与锁定状态一起带过去，只有身份是新的。
  const copy = cloneEntryWithNewIds(entries[from], command.field) as RawEntry;
  const nextEntries = [...entries.slice(0, from + 1), copy, ...entries.slice(from + 1)];
  return { ok: true, content: withField(content, command.field, nextEntries), changed: true };
}

function clonePoint(
  content: ResumeContent,
  command: Extract<OutlineCommand, { type: "clone-point" }>,
): OutlineApplyResult {
  const entries = entriesOf(content, command.field);
  const entryIndex = findEntryIndex(content, command.field, command.objectId);
  if (entryIndex < 0) return { ok: false, reason: "not-found" };
  const entry = entries[entryIndex];
  if (!canClonePoint(entry)) return { ok: false, reason: "locked-content" };
  if (!pointFieldsFor(command.field).includes(command.pointField))
    return { ok: false, reason: "not-found" };
  const rawPoints = entry[command.pointField];
  const points = Array.isArray(rawPoints) ? [...(rawPoints as unknown[])] : [];
  const ids = pointIdsOf(entry, command.pointField);
  // 身份不完整（旧记录没物化 id / 长度对不上）时拒绝：按下标复制会把新身份挂到别的要点。
  if (points.length === 0 || ids.length !== points.length)
    return { ok: false, reason: "not-found" };
  const from = ids.indexOf(command.pointId);
  if (from < 0) return { ok: false, reason: "not-found" };
  const newPointId = newObjectId();
  const sourcePointIds =
    entry.point_ids && typeof entry.point_ids === "object"
      ? (entry.point_ids as Record<string, unknown>)
      : {};
  let nextEntry: RawEntry = {
    ...entry,
    [command.pointField]: [...points.slice(0, from + 1), points[from], ...points.slice(from + 1)],
    point_ids: {
      ...sourcePointIds,
      [command.pointField]: [...ids.slice(0, from + 1), newPointId, ...ids.slice(from + 1)],
    },
  };
  // 复制是"忠实副本"：原要点被隐藏时，副本同样隐藏（与 clone-entry 带 hidden 一致）。
  const hidden = readHiddenPoints(entry);
  if (hidden.has(command.pointId)) {
    hidden.add(newPointId);
    nextEntry = writeHiddenPoints(nextEntry, hidden);
  }
  const nextEntries = entries.slice();
  nextEntries[entryIndex] = nextEntry;
  return { ok: true, content: withField(content, command.field, nextEntries), changed: true };
}

function setHiddenPoints(
  content: ResumeContent,
  command: Extract<OutlineCommand, { type: "set-hidden-points" }>,
): OutlineApplyResult {
  const targetIds = command.points
    .map((point) => point.pointId)
    .filter((pointId) => pointId !== "");
  if (targetIds.length === 0) return { ok: false, reason: "not-found" };
  const entries = entriesOf(content, command.field);
  const entryIndex = findEntryIndex(content, command.field, command.objectId);
  if (entryIndex < 0) return { ok: false, reason: "not-found" };
  const entry = entries[entryIndex];
  const known = new Set<string>();
  for (const pointField of pointFieldsFor(command.field)) {
    for (const pointId of pointIdsOf(entry, pointField)) known.add(pointId);
  }
  const targets = targetIds.filter((pointId) => known.has(pointId));
  if (targets.length === 0) return { ok: false, reason: "not-found" };
  // 要点级显隐是可见性操作：内容锁/排版锁都不阻止（与条目级 set-hidden 同口径）。
  const hidden = readHiddenPoints(entry);
  let changed = false;
  for (const pointId of targets) {
    if (command.hidden) {
      if (!hidden.has(pointId)) {
        hidden.add(pointId);
        changed = true;
      }
    } else if (hidden.delete(pointId)) {
      changed = true;
    }
  }
  if (!changed) return { ok: true, content, changed: false };
  const nextEntries = entries.slice();
  nextEntries[entryIndex] = writeHiddenPoints(entry, hidden);
  return { ok: true, content: withField(content, command.field, nextEntries), changed: true };
}

function setHidden(
  content: ResumeContent,
  command: Extract<OutlineCommand, { type: "set-hidden" }>,
): OutlineApplyResult {
  const targetsByField = new Map<EntryField, Set<string>>();
  for (const ref of command.entries) {
    if (!isObjectId(ref.objectId)) continue;
    const ids = targetsByField.get(ref.field) ?? new Set<string>();
    ids.add(ref.objectId);
    targetsByField.set(ref.field, ids);
  }
  if (targetsByField.size === 0) return { ok: false, reason: "not-found" };
  let next = content;
  let changed = false;
  let found = false;
  for (const [field, ids] of targetsByField) {
    const entries = entriesOf(next, field);
    let fieldChanged = false;
    const nextEntries = entries.map((entry) => {
      const objectId = entryIdOf(entry);
      if (!objectId || !ids.has(objectId)) return entry;
      found = true;
      if (flagMatches(entry, "hidden", command.hidden)) return entry;
      fieldChanged = true;
      return writeEntryFlag(entry, "hidden", command.hidden);
    });
    if (fieldChanged) {
      next = withField(next, field, nextEntries);
      changed = true;
    }
  }
  if (!found) return { ok: false, reason: "not-found" };
  return { ok: true, content: changed ? next : content, changed };
}

function setLock(
  content: ResumeContent,
  command: Extract<OutlineCommand, { type: "set-lock" }>,
): OutlineApplyResult {
  const entries = entriesOf(content, command.field);
  const index = findEntryIndex(content, command.field, command.objectId);
  if (index < 0) return { ok: false, reason: "not-found" };
  const flag = command.lock === "content" ? "lock_content" : "lock_layout";
  if (flagMatches(entries[index], flag, command.value))
    return { ok: true, content, changed: false };
  const nextEntries = entries.slice();
  nextEntries[index] = writeEntryFlag(entries[index], flag, command.value);
  return { ok: true, content: withField(content, command.field, nextEntries), changed: true };
}

/** 执行一条结构命令。永远返回结构化结果：UI 据 `ok/reason` 决定说明，绝不静默失败。 */
export function applyOutlineCommand(
  content: ResumeContent,
  command: OutlineCommand,
): OutlineApplyResult {
  switch (command.type) {
    case "reorder-entry":
      return reorderEntry(content, command);
    case "reorder-point":
      return reorderPoint(content, command);
    case "clone-entry":
      return cloneEntry(content, command);
    case "clone-point":
      return clonePoint(content, command);
    case "set-hidden":
      return setHidden(content, command);
    case "set-hidden-points":
      return setHiddenPoints(content, command);
    case "set-lock":
      return setLock(content, command);
  }
}
