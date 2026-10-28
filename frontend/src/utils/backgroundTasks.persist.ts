// SPDX-License-Identifier: Apache-2.0
/**
 * 后台任务的**跨刷新持久化**：把任务元数据（id / kind / label）写进 localStorage。
 *
 * 为什么要持久化：刷新页面会丢掉模块级登记表，而后端任务还在跑。没有这份元数据，
 * 刷新后既不会补发"已完成"提醒，也不会重新拉起轮询——用户看到的是"任务凭空消失"。
 *
 * 两条纪律：
 * 1. **只存元数据，不存回调**：函数进不了 localStorage，也不该进（跨会话调用旧闭包）。
 * 2. 所有读写都 try/catch：隐私模式 / 配额满 / 用户禁用存储时，行为退回"刷新即丢"，
 *    绝不能因此影响登记与提醒这条主链路。
 *
 * 拆成独立模块是为了 500 行预算：主文件只留轮询循环与对外 API。
 */
import {
  STORAGE_KEY,
  type BackgroundTaskKind,
  type PersistedTaskEntry,
} from "./backgroundTasks.types";

/** 读全部条目；内容损坏时返回空数组（当作"没有待恢复的任务"）。 */
export function readPersistedEntries(): PersistedTaskEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PersistedTaskEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as PersistedTaskEntry).taskId === "number" &&
        typeof (entry as PersistedTaskEntry).label === "string",
    );
  } catch {
    return [];
  }
}

function writePersistedEntries(entries: PersistedTaskEntry[]): void {
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    }
  } catch {
    // 写不进去就当没有持久化能力，行为退回刷新即丢。
  }
}

/** 记一条任务（同 kind + 同 id 已存在时不重复写）。 */
export function persistAddTask(entry: PersistedTaskEntry): void {
  const entries = readPersistedEntries();
  const exists = entries.some(
    (item) => item.taskId === entry.taskId && (item.kind ?? "resume_generate") === entry.kind,
  );
  if (exists) return;
  entries.push(entry);
  writePersistedEntries(entries);
}

/** 清掉一条任务（终态 / 移除 / 恢复完成时调用）。 */
export function persistRemoveTask(kind: BackgroundTaskKind, taskId: number): void {
  const entries = readPersistedEntries();
  const next = entries.filter(
    (entry) => !(entry.taskId === taskId && (entry.kind ?? "resume_generate") === kind),
  );
  if (next.length === entries.length) return;
  writePersistedEntries(next);
}

/** 测试与"换数据集"之类场景用：清空持久化。 */
export function clearPersistedTasks(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略：localStorage 不可用时本来也没有东西可清。
  }
}
