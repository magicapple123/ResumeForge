// SPDX-License-Identifier: Apache-2.0
/**
 * 简历文档的对象身份（W01）：给条目与要点一个稳定的 id。
 *
 * 为什么不是下标：加粗覆盖、事实来源、局部排版、批注都记着"哪一条"，而
 * `experience.0.description.1` 在把第二个项目拖到第一位之后就指向别人了。
 *
 * 三条规则（与后端 `document_identity.py` 同一套判据）：
 * - 只在**编辑/保存**时补 id，读取旧记录不写库（打开看一眼不该改数据）；
 * - 排序/隐藏/撤销**保留原 id**，复制才生成新 id；
 * - 已有的合法 id 一律不动 —— 每次保存都换一遍等于把所有关联打散。
 */

import type { ResumeContent } from "../../types/resume";
import { ENTRY_POINT_FIELDS, type EntryField } from "./types";

/** 与后端 `OBJECT_ID_PATTERN` 同一口径：8–32 位字母、数字、下划线或连字符。 */
export const OBJECT_ID_PATTERN = /^[A-Za-z0-9_-]{8,32}$/;

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** 生成一个新 id（`ob_` + 12 位 base36，共 15 位）。 */
export function newObjectId(): string {
  const bytes = new Uint8Array(12);
  const cryptoApi = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    // 只用于测试/极老浏览器：这里不需要密码学强度，只需要不重复。
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  let suffix = "";
  for (const byte of bytes) suffix += ALPHABET[byte % ALPHABET.length];
  return `ob_${suffix}`;
}

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && OBJECT_ID_PATTERN.test(value);
}

type AnyEntry = Record<string, unknown>;

function pointIdsFor(entry: AnyEntry, field: EntryField): Record<string, string[]> {
  const source = entry.point_ids;
  const existing: Record<string, string[]> = {};
  if (source && typeof source === "object") {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (Array.isArray(value)) existing[key] = value.filter(isObjectId);
    }
  }
  const next: Record<string, string[]> = {};
  for (const key of ENTRY_POINT_FIELDS[field]) {
    const items = entry[key];
    if (!Array.isArray(items) || items.length === 0) continue;
    const kept = existing[key] ?? [];
    // 长度对不上（用户在表单里增删了要点）→ 整组重建：按位置沿用旧 id 会把新要点
    // 挂到旧身份上，比不关联更糟。
    const aligned = kept.length === items.length ? kept.slice() : [];
    while (aligned.length < items.length) aligned.push(newObjectId());
    next[key] = aligned;
  }
  return next;
}

function withEntryIdentity(entry: AnyEntry, field: EntryField): AnyEntry {
  const next: AnyEntry = { ...entry };
  if (!isObjectId(next.id)) next.id = newObjectId();
  const points = pointIdsFor(entry, field);
  if (Object.keys(points).length > 0) next.point_ids = points;
  else delete next.point_ids;
  return next;
}

/**
 * 补齐缺失/非法的对象 id，返回**新对象**（不改入参）。
 *
 * 幂等：对同一份内容连续调用两次，结果逐字段相同——否则"保存一次换一次 id"。
 */
export function ensureIds(content: ResumeContent): ResumeContent {
  const next = { ...content } as ResumeContent & Record<string, unknown>;
  for (const field of Object.keys(ENTRY_POINT_FIELDS) as EntryField[]) {
    const entries = (content as unknown as Record<string, unknown>)[field];
    if (!Array.isArray(entries)) continue;
    next[field] = entries.map((entry) =>
      entry && typeof entry === "object" ? withEntryIdentity(entry as AnyEntry, field) : entry,
    );
  }
  return next as ResumeContent;
}

/**
 * 只补"条目 id"（不生成要点 id），返回新对象；已有合法 id 原样保留。
 *
 * 为什么单独需要一个只补条目 id 的版本：制作台的局部排版（对象样式 / 文字级别）以
 * `format_config.objects[object_id]` 为唯一落点，要求正文里的条目**带稳定 id**；但编辑表单
 * 在增删要点行时不会同步 `point_ids`，若把 `ensureIds` 生成的要点 id 一起塞进表单，
 * 用户改一行要点后保存就会被 W01 的"要点 id 与文本等长"校验 422。这里只补条目 id，
 * 要点身份仍由大纲结构命令按需维护。
 */
export function ensureEntryIds(content: ResumeContent): ResumeContent {
  const next = { ...content } as ResumeContent & Record<string, unknown>;
  for (const field of Object.keys(ENTRY_POINT_FIELDS) as EntryField[]) {
    const entries = (content as unknown as Record<string, unknown>)[field];
    if (!Array.isArray(entries)) continue;
    next[field] = entries.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const item = entry as AnyEntry;
      return isObjectId(item.id) ? item : { ...item, id: newObjectId() };
    });
  }
  return next as ResumeContent;
}

/** 正文里是否存在缺少合法条目 id 的条目（用于判断保存版式时是否要顺带物化身份）。 */
export function hasMissingEntryIds(content: ResumeContent): boolean {
  for (const field of Object.keys(ENTRY_POINT_FIELDS) as EntryField[]) {
    const entries = (content as unknown as Record<string, unknown>)[field];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      if (!isObjectId((entry as AnyEntry).id)) return true;
    }
  }
  return false;
}

/** 复制一条条目：内容原样、身份全新（含全部要点 id）。 */
export function cloneEntryWithNewIds<T extends object>(entry: T, field: EntryField): T {
  const copy = JSON.parse(JSON.stringify(entry)) as AnyEntry;
  delete copy.id;
  delete copy.point_ids;
  return withEntryIdentity(copy, field) as T;
}

/** 按条目 id 找它当前的下标路径（`experience.2`）；找不到返回 null。 */
export function resolvePathAt(content: ResumeContent, objectId: string): string | null {
  if (!isObjectId(objectId)) return null;
  const source = content as unknown as Record<string, unknown>;
  for (const field of Object.keys(ENTRY_POINT_FIELDS) as EntryField[]) {
    const entries = source[field];
    if (!Array.isArray(entries)) continue;
    const index = entries.findIndex((entry) => (entry as AnyEntry)?.id === objectId);
    if (index >= 0) return `${field}.${index}`;
  }
  return null;
}

/** 把一条条目从 `from` 移到 `to`，id 与内容一起走。 */
export function reorderPreservingIds<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}
