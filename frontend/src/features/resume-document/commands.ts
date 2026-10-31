// SPDX-License-Identifier: Apache-2.0
/**
 * 文档命令层（W03）：**一次用户动作 = 一条命令**，历史栈与 UI 都只认这一层。
 *
 * ## 边界
 *
 * - 纯函数：`content + command → { content, changed }`，不改入参、不读时钟、不发请求；
 * - 结构命令（排序 / 复制 / 隐藏 / 锁定）**委托** W06 的 `applyOutlineCommand`——一份实现
 *   两处消费（大纲面板与历史栈），不在这里抄第二份"排序不换 id"的规则；
 * - 文本命令（整段 / 要点 / 插入 / 删除要点）只做不可变写入；插入要点时**同步**维护
 *   `point_ids` 伴随数组（W01 契约：长度必须与文本数组等长，否则保存会被后端 422）。
 *
 * ## 两个声明
 *
 * - `mergeKeyOf`：连续输入合并用的键（同一条路径的连续输入 = 一个历史点）；结构命令
 *   返回 null（每一次拖动/点击都必须独立成一步）。
 * - `bumpsRevision`：这条命令是否改变文档内容（隐藏/锁定也改、纯选择不改——本层没有
 *   选择命令，所有命令都是内容变更）。
 *
 * ## 为什么路径辅助函数写在这里
 *
 * W00 契约规定 `commands.ts` 只依赖 `types.ts` + `identity.ts`（依赖方向：命令层在
 * 状态容器之下、不反向依赖渲染层工具）。路径辅助函数保持在这一层，调用方不需要 import
 * 渲染层工具，也不会把依赖方向倒过来。
 */
import type { ResumeContent } from "../../types/resume";
import { applyOutlineCommand, type OutlineCommand } from "../resume-outline";
import { ENTRY_POINT_FIELDS, type EntryField } from "./types";
import { newObjectId } from "./identity";

export type DocumentCommand =
  | { kind: "set-text"; path: string; text: string }
  | { kind: "set-bullet"; path: string; text: string }
  | { kind: "insert-bullet"; path: string; index: number; text: string }
  | { kind: "remove-bullet"; path: string; index: number }
  /** 结构命令原样透传（sort / clone / hidden / lock）：历史点由调用方按命令边界记。 */
  | { kind: "structure"; command: OutlineCommand };

export interface DocumentCommandResult {
  content: ResumeContent;
  /** false = 命令是 no-op（同值写入 / 越界 / 锁阻止）：**不该**制造历史点。 */
  changed: boolean;
}

function readPath(root: ResumeContent, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split(".").filter(Boolean)) {
    if (Array.isArray(node)) node = node[Number(key)];
    else if (node !== null && typeof node === "object")
      node = (node as Record<string, unknown>)[key];
    else return undefined;
  }
  return node;
}

/** 不可变写入：沿路径逐层浅拷贝，未涉及的兄弟节点保持原引用。 */
function writePath(node: unknown, keys: string[], value: unknown): unknown {
  if (keys.length === 0) return value;
  const [head, ...rest] = keys;
  if (Array.isArray(node)) {
    const next = node.slice();
    next[Number(head)] = writePath(next[Number(head)], rest, value);
    return next;
  }
  const base: Record<string, unknown> =
    node !== null && typeof node === "object" ? (node as Record<string, unknown>) : {};
  return { ...base, [head]: writePath(base[head], rest, value) };
}

function withValue(root: ResumeContent, path: string, value: unknown): ResumeContent {
  return writePath(root as unknown, path.split(".").filter(Boolean), value) as ResumeContent;
}

/** 把点分路径拆成"数组所在路径 + 下标"（只接受数组路径；不是数组返回 null）。 */
function arrayAt(
  root: ResumeContent,
  path: string,
): { parentPath: string; index: number; items: unknown[] } | null {
  const keys = path.split(".").filter(Boolean);
  const last = keys[keys.length - 1];
  if (!/^\d+$/.test(last)) return null;
  const arrayPath = keys.slice(0, -1).join(".");
  const items = readPath(root, arrayPath);
  if (!Array.isArray(items)) return null;
  const index = Number(last);
  if (index < 0 || index >= items.length) return null;
  return { parentPath: arrayPath, index, items };
}

/** 要点数组路径（`experience.0.description`）→ 所属条目与要点字段；不是要点数组返回 null。 */
function bulletArrayOf(
  path: string,
): { entryPath: string; entryField: EntryField; pointField: string } | null {
  const parts = path.split(".").filter(Boolean);
  if (parts.length !== 3 || !/^\d+$/.test(parts[1])) return null;
  const [field, , pointField] = parts;
  if (!(field in ENTRY_POINT_FIELDS)) return null;
  const entryField = field as EntryField;
  // ENTRY_POINT_FIELDS 是 `as const`（元组字面量）：`.includes` 的参数会被收窄成 never，
  // 这里按它声明的语义（readonly string[]）比较。
  if (!(ENTRY_POINT_FIELDS[entryField] as readonly string[]).includes(pointField)) return null;
  return { entryPath: `${field}.${parts[1]}`, entryField, pointField };
}

function setStringAt(content: ResumeContent, path: string, text: string): DocumentCommandResult {
  const current = readPath(content, path);
  if (typeof current !== "string" || current === text) return { content, changed: false };
  return { content: withValue(content, path, text), changed: true };
}

function insertBullet(
  content: ResumeContent,
  path: string,
  index: number,
  text: string,
): DocumentCommandResult {
  const target = readPath(content, path);
  if (!Array.isArray(target)) return { content, changed: false };
  const at = Math.max(0, Math.min(index, target.length));
  let next = withValue(content, path, [...target.slice(0, at), text, ...target.slice(at)]);
  // point_ids 伴随数组必须与文本等长：新要点同时生成 id，否则保存时后端会 422。
  const owner = bulletArrayOf(path);
  if (owner) {
    const entry = readPath(content, owner.entryPath);
    const pointIds =
      entry && typeof entry === "object" ? (entry as Record<string, unknown>).point_ids : undefined;
    const ids =
      pointIds && typeof pointIds === "object"
        ? (pointIds as Record<string, unknown>)[owner.pointField]
        : undefined;
    if (Array.isArray(ids)) {
      const nextIds = [...(ids as string[])];
      nextIds.splice(at, 0, newObjectId());
      next = withValue(next, `${owner.entryPath}.point_ids.${owner.pointField}`, nextIds);
    }
  }
  return { content: next, changed: true };
}

function removeBullet(content: ResumeContent, path: string, index: number): DocumentCommandResult {
  const target = readPath(content, path);
  if (!Array.isArray(target) || index < 0 || index >= target.length) {
    return { content, changed: false };
  }
  let next = withValue(content, path, [...target.slice(0, index), ...target.slice(index + 1)]);
  const owner = bulletArrayOf(path);
  if (owner) {
    const entry = readPath(content, owner.entryPath);
    const pointIds =
      entry && typeof entry === "object" ? (entry as Record<string, unknown>).point_ids : undefined;
    const ids =
      pointIds && typeof pointIds === "object"
        ? (pointIds as Record<string, unknown>)[owner.pointField]
        : undefined;
    if (Array.isArray(ids) && ids.length === target.length) {
      const nextIds = [...(ids as string[])];
      nextIds.splice(index, 1);
      next = withValue(next, `${owner.entryPath}.point_ids.${owner.pointField}`, nextIds);
    }
  }
  return { content: next, changed: true };
}

export function applyDocumentCommand(
  content: ResumeContent,
  command: DocumentCommand,
): DocumentCommandResult {
  switch (command.kind) {
    case "set-text":
    case "set-bullet":
      return setStringAt(content, command.path, command.text);
    case "insert-bullet":
      return insertBullet(content, command.path, command.index, command.text);
    case "remove-bullet":
      return removeBullet(content, command.path, command.index);
    case "structure": {
      const applied = applyOutlineCommand(content, command.command);
      if (!applied.ok) return { content, changed: false };
      return { content: applied.content, changed: applied.changed };
    }
    default:
      return { content, changed: false };
  }
}

/**
 * 连续输入的合并键：同一条路径的连续 `set-*` 合并成一个历史点；其余命令必须独立成步。
 * 路径不同（改了另一个字段）就不合并——一次 Tab 跳转之后的输入不该吃掉上一段的历史点。
 */
export function mergeKeyOf(command: DocumentCommand): string | null {
  if (command.kind === "set-text" || command.kind === "set-bullet") {
    return `text:${command.path}`;
  }
  return null;
}

/** 这条命令是否改变文档内容（决定要不要记历史点）；本层没有"纯选择"命令，全为 true。 */
export function bumpsRevision(command: DocumentCommand): boolean {
  // 未来若引入"纯选择/滚动"命令，在这里据 command 返回 false；目前所有命令都改内容。
  void command;
  return true;
}

/** `arrayAt` 的公开出口（测试与 shell 定位插入下标用）。 */
export { arrayAt as resolveArrayAt };
