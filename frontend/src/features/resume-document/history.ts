// SPDX-License-Identifier: Apache-2.0
/**
 * 文档级撤销/恢复的**纯对象快照栈**（W03）：与 `hooks/useFormHistory`（表单层）逐项对齐，
 * 但不再绑定 antd `FormInstance`——W06 的结构命令、W07 的排版参数、纸面加粗 overlay 都在
 * 表单之外，只有"纯对象快照"才能覆盖它们全部。
 *
 * ## 与 `useFormHistory` 的语义对照（逐项对齐，不新造一套）
 *
 * | 关注点 | 口径 |
 * | --- | --- |
 * | 容量 | `limit = 50`，超出从**最旧**一端截断 |
 * | 合并 | 连续输入按 `debounceMs = 300` 合并：一次停顿 = 一个历史点 |
 * | 基线 | `past` 里存的是**改动前**的状态；`baseline` 是"当前已确认"的状态 |
 * | flush | `undo/redo` 之前先落地待提交快照——"打完最后一个字立刻 Cmd+Z"也能撤 |
 * | 清栈 | 换记录 / 用最新的 / 保存失败后恢复都由调用方 `reset(current)` 显式触发 |
 * | 去重 | 指纹相同（JSON 相等）不入栈：滑杆没动、重复 setText 不该制造历史点 |
 *
 * ## 为什么是工厂函数而不是 React hook
 *
 * 快照栈本身没有 React 依赖：shell 用 `useState`/订阅把 `canUndo/canRedo` 转成渲染，
 * 而纯工厂能脱离 jsdom 用假定时器测"300ms 合并"这类时间性质（本仓的既有教训：
 * 把时间性质塞进组件测试会变成"偶发失败"）。
 *
 * ## 快照必须深拷贝
 *
 * 调用方传进来的往往是与渲染共用引用的对象；不拷贝的话，后续不可变更新虽然换了引用，
 * 但栈里存的对象仍会被某些就地修改的代码（老代码里的 `arr.sort()`）污染——撤回出来的是
 * "被改过的历史"，比没有历史更糟。
 */
export const DEFAULT_HISTORY_LIMIT = 50;
export const DEFAULT_HISTORY_DEBOUNCE_MS = 300;

export interface DocumentHistoryOptions<T> {
  /** 最多保留多少个历史点（超出后丢最旧的）。 */
  limit?: number;
  /** 连续编辑的合并窗口（毫秒）。 */
  debounceMs?: number;
  /** 打开文档时的初始状态（= 撤销的终点）。 */
  initial: T;
  /**
   * 提交了一个新历史点时的通知（debounce 定时器在 React 之外跑；不通知的话
   * `canUndo` 要等下一位用户动作才更新——按钮会"点了才亮"）。
   */
  onChange?: () => void;
}

/** 一个历史点的元信息：动作名 + 发生时间（前端只显示，不参与比较）。 */
export interface HistoryStepMeta {
  label: string;
  /** 毫秒时间戳（`Date.now()`）：历史面板按它显示"几点"做的事。 */
  at: number;
}

/** 一个历史点：快照 + 给用户看的动作名（"编辑正文" / "调整排版" / "移动条目"…）+ 时间。 */
export interface HistoryEntry<T> {
  snapshot: T;
  label: string;
  /**
   * 这一步**发生**的时间（毫秒）。撤销/恢复搬运历史点时**沿用原时间**：同一步在不同时刻
   * 被撤销/恢复，它在时间轴上仍然只发生过一次（否则撤销一次就会把"10:00 的编辑"标成 10:05）。
   */
  at: number;
}

export interface DocumentHistory<T> {
  /** 编辑发生后调用：注册"当前状态"，按 `debounceMs` 合并成一次历史点。 */
  push: (current: T, label?: string) => void;
  /** 立刻落地待提交的快照（undo/redo 内部会先调它）。 */
  flush: () => void;
  /** 撤回：返回要应用的状态；没有可撤回的返回 null（调用方据此不改文档）。 */
  undo: () => T | null;
  /** 恢复：返回要应用的状态；没有可恢复的返回 null。 */
  redo: () => T | null;
  /** 清栈并以给定状态为新基线（换记录 / 用最新的 / 恢复草稿后调用）。 */
  reset: (current: T) => void;
  /**
   * 已发生的步骤（最旧 → 最新）与可恢复步骤（下一次 redo 在末尾）。
   *
   * **向后兼容**：只关心动作名的调用点继续用它（返回字符串数组）。
   */
  labels: () => { past: string[]; future: string[] };
  /** 与 `labels()` **同序**的元信息（动作名 + 时间戳）：历史面板要显示"几点"。 */
  entries: () => { past: HistoryStepMeta[]; future: HistoryStepMeta[] };
  /**
   * 栈的位置（各几步）。「回到某一步」按它算要连续撤销/恢复几次，不用重写快照栈。
   */
  position: () => { past: number; future: number };
  /** 预览某个已发生步骤的快照（不改变当前文档）；下标对应 \`labels().past\`。 */
  previewPast: (index: number) => T | null;
  /** 预览某个可恢复步骤的快照（不改变当前文档）。 */
  previewFuture: (index: number) => T | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** 清掉挂起的定时器（组件卸载时调用，避免在已卸载的 shell 上写状态）。 */
  dispose: () => void;
  /** 只读快照（测试 / 调试用；返回副本，改它不影响栈）。 */
  snapshot: () => { past: T[]; future: T[]; baseline: T; pending: boolean };
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // 快照里混进了不可克隆对象（函数 / File 等）：退回 JSON 深拷贝。
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 快照指纹：只用于"和上一次相同就跳过"，不需要密码学强度。 */
function fingerprint(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function createDocumentHistory<T>({
  initial,
  limit = DEFAULT_HISTORY_LIMIT,
  debounceMs = DEFAULT_HISTORY_DEBOUNCE_MS,
  onChange,
}: DocumentHistoryOptions<T>): DocumentHistory<T> {
  const past: HistoryEntry<T>[] = [];
  const future: HistoryEntry<T>[] = [];
  let baseline = deepClone(initial);
  let baselineKey = fingerprint(baseline);
  let pending: T | null = null;
  let pendingLabel = "";
  /**
   * 待提交这一步**发生**的时刻（`push` 那一刻），不是 debounce 到期的时刻。
   *
   * 两者差 300ms：历史面板要显示的是"我几点改的"，不是"计时器几点收的口"。
   */
  let pendingAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /** 把待提交状态记成一个历史点：`past` 放**改动前**的基线。 */
  const commit = (): void => {
    const current = pending;
    pending = null;
    if (current === null) return;
    const key = fingerprint(current);
    if (key === baselineKey) return;
    past.push({ snapshot: baseline, label: pendingLabel, at: pendingAt });
    // 超出上限从最旧一端截断：撤销只能回到"最近 50 步"，不能靠无限栈伪装能力。
    if (past.length > limit) past.splice(0, past.length - limit);
    future.length = 0;
    baseline = current;
    baselineKey = key;
    onChange?.();
  };

  const flush = (): void => {
    clearTimer();
    commit();
  };

  const push = (current: T, label = ""): void => {
    pending = deepClone(current);
    pendingLabel = label;
    pendingAt = Date.now();
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      commit();
    }, debounceMs);
  };

  const undo = (): T | null => {
    flush();
    const previous = past.pop();
    if (previous === undefined) return null;
    // 时间戳跟着历史点走：撤销只是"把这一步挪到可恢复"，不是"此刻又执行了一次"。
    future.push({ snapshot: baseline, label: previous.label, at: previous.at });
    baseline = previous.snapshot;
    baselineKey = fingerprint(previous.snapshot);
    return deepClone(previous.snapshot);
  };

  const redo = (): T | null => {
    flush();
    const next = future.pop();
    if (next === undefined) return null;
    past.push({ snapshot: baseline, label: next.label, at: next.at });
    if (past.length > limit) past.splice(0, past.length - limit);
    baseline = next.snapshot;
    baselineKey = fingerprint(next.snapshot);
    return deepClone(next.snapshot);
  };

  const reset = (current: T): void => {
    clearTimer();
    pending = null;
    pendingLabel = "";
    past.length = 0;
    future.length = 0;
    baseline = deepClone(current);
    baselineKey = fingerprint(baseline);
  };

  return {
    push,
    flush,
    undo,
    redo,
    reset,
    labels: () => ({
      past: past.map((item) => item.label),
      future: future.map((item) => item.label),
    }),
    entries: () => ({
      past: past.map((item) => ({ label: item.label, at: item.at })),
      future: future.map((item) => ({ label: item.label, at: item.at })),
    }),
    position: () => ({ past: past.length, future: future.length }),
    previewPast: (index: number) => {
      const entry = past[index];
      return entry ? deepClone(entry.snapshot) : null;
    },
    previewFuture: (index: number) => {
      const entry = future[index];
      return entry ? deepClone(entry.snapshot) : null;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    dispose: clearTimer,
    snapshot: () => ({
      past: past.map((item) => deepClone(item.snapshot)),
      future: future.map((item) => deepClone(item.snapshot)),
      baseline: deepClone(baseline),
      pending: pending !== null,
    }),
  };
}
