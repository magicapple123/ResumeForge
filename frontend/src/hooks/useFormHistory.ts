/**
 * 表单级撤回/恢复历史（R5）。
 *
 * antd 的 `Form` 没有撤销栈：`mod+z` 在输入框里只会撤销"正在编辑的那个框"的原生
 * 输入，跨字段的误改无法回退。这个 hook 在**表单层**维护一份快照栈：
 *
 * - 调用方在 `onValuesChange` 里转发 `push()`；内部按 `debounceMs` 合并连续击键
 *   （一次停顿 = 一个历史点），避免每个字符都存一份快照；
 * - 快照用 `structuredClone(form.getFieldsValue(true))`——必须带 `true`，
 *   否则未挂载字段（折叠面板、隐藏的数组项）会丢；
 * - `applyingRef` 保证 `undo/redo` 自己的 `setFieldsValue` **不会**再入栈，
 *   否则"撤回"会把撤回后的状态又记成一步新的修改，用户按两次就回到原点了；
 * - `recordId`/`content` 之类的记录切换由调用方经 `resetKey` 告知：换了记录就必须
 *   清栈，否则撤回会跨记录把上一份数据填进来。
 *
 * 防抖队列不会吞掉用户的输入：`undo/redo` 之前先 flush 一次待提交的快照，
 * 所以"打完最后一个字立刻按 Cmd+Z"也能撤到打字前的状态。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormInstance } from "antd";

export const DEFAULT_HISTORY_LIMIT = 50;
export const DEFAULT_HISTORY_DEBOUNCE_MS = 300;

export interface UseFormHistoryOptions {
  /** 最多保留多少个历史点（超出后丢最旧的）。 */
  limit?: number;
  /** 连续击键的合并窗口。 */
  debounceMs?: number;
  /**
   * 记录标识。只要它与上一次不同（换了记录、换了弹窗内容），历史立即清空并
   * 以当前表单值作为新基线。
   */
  resetKey?: unknown;
}

export interface FormHistory {
  push: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // 表单值里混进了不可克隆对象（函数、File 等）：退回 JSON 深拷贝。
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 快照的指纹：只用于"和上一次相同就跳过"，不需要密码学强度。 */
function fingerprint(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function useFormHistory<Values extends object>(
  form: FormInstance<Values>,
  options: UseFormHistoryOptions = {},
): FormHistory {
  const { limit = DEFAULT_HISTORY_LIMIT, debounceMs = DEFAULT_HISTORY_DEBOUNCE_MS } = options;
  const pastRef = useRef<Values[]>([]);
  const futureRef = useRef<Values[]>([]);
  const baselineRef = useRef<Values | null>(null);
  const baselineKeyRef = useRef("");
  const applyingRef = useRef(false);
  const pendingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });

  const sync = useCallback(() => {
    setFlags({
      canUndo: pastRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
    });
  }, []);

  const readSnapshot = useCallback((): Values | null => {
    try {
      const values = form.getFieldsValue(true) as Values;
      if (!values || typeof values !== "object") return null;
      return deepClone(values);
    } catch {
      return null;
    }
  }, [form]);

  const applySnapshot = useCallback(
    (snapshot: Values) => {
      applyingRef.current = true;
      try {
        form.setFieldsValue(snapshot as Parameters<FormInstance<Values>["setFieldsValue"]>[0]);
      } finally {
        applyingRef.current = false;
      }
    },
    [form],
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = false;
  }, []);

  /** 把"当前状态"记成一个历史点：`past` 里放的是**改动前**的基线。 */
  const commit = useCallback(() => {
    if (applyingRef.current) return;
    const snapshot = readSnapshot();
    if (!snapshot) return;
    const key = fingerprint(snapshot);
    if (baselineRef.current === null) {
      baselineRef.current = snapshot;
      baselineKeyRef.current = key;
      return;
    }
    if (key === baselineKeyRef.current) return;
    pastRef.current.push(baselineRef.current);
    if (pastRef.current.length > limit) {
      pastRef.current = pastRef.current.slice(pastRef.current.length - limit);
    }
    futureRef.current = [];
    baselineRef.current = snapshot;
    baselineKeyRef.current = key;
    sync();
  }, [limit, readSnapshot, sync]);

  const flush = useCallback(() => {
    if (!pendingRef.current) return;
    clearTimer();
    commit();
  }, [clearTimer, commit]);

  /** 调用方在 `onValuesChange` 里转发；连续击键合并成一个历史点。 */
  const push = useCallback(() => {
    if (applyingRef.current) return;
    pendingRef.current = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      pendingRef.current = false;
      commit();
    }, debounceMs);
  }, [commit, debounceMs]);

  const undo = useCallback(() => {
    // 先落地待提交的那一步，否则"刚打完字就撤回"会撤不动。
    flush();
    const previous = pastRef.current.pop();
    if (!previous) {
      sync();
      return;
    }
    const current = baselineRef.current ?? readSnapshot();
    if (current) futureRef.current.push(current);
    baselineRef.current = previous;
    baselineKeyRef.current = fingerprint(previous);
    applySnapshot(previous);
    sync();
  }, [applySnapshot, flush, readSnapshot, sync]);

  const redo = useCallback(() => {
    flush();
    const next = futureRef.current.pop();
    if (!next) {
      sync();
      return;
    }
    const current = baselineRef.current ?? readSnapshot();
    if (current) pastRef.current.push(current);
    if (pastRef.current.length > limit) {
      pastRef.current = pastRef.current.slice(pastRef.current.length - limit);
    }
    baselineRef.current = next;
    baselineKeyRef.current = fingerprint(next);
    applySnapshot(next);
    sync();
  }, [applySnapshot, flush, limit, readSnapshot, sync]);

  const reset = useCallback(() => {
    clearTimer();
    pastRef.current = [];
    futureRef.current = [];
    const snapshot = readSnapshot();
    baselineRef.current = snapshot;
    baselineKeyRef.current = snapshot ? fingerprint(snapshot) : "";
    sync();
  }, [clearTimer, readSnapshot, sync]);

  // 首帧把当前值钉成基线；卸载时清掉待提交的定时器（否则会在已卸载的表单上写值）。
  useEffect(() => {
    baselineRef.current = readSnapshot();
    baselineKeyRef.current = baselineRef.current ? fingerprint(baselineRef.current) : "";
    return () => clearTimer();
  }, [clearTimer, readSnapshot]);

  // 记录切换：resetKey 是对象引用时用 Object.is 比较（content 换了新对象即视为换记录）。
  const resetKey = options.resetKey;
  const previousResetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (Object.is(previousResetKeyRef.current, resetKey)) return;
    previousResetKeyRef.current = resetKey;
    reset();
  }, [reset, resetKey]);

  return useMemo(
    () => ({ push, undo, redo, reset, canUndo: flags.canUndo, canRedo: flags.canRedo }),
    [flags.canRedo, flags.canUndo, push, redo, reset, undo],
  );
}
