// SPDX-License-Identifier: Apache-2.0
/**
 * 表单草稿 hook：防抖写 + 离开时同步 flush + 恢复要用户点。
 *
 * 形状抄的是网申页那套已经跑熟的实现（`pages/WebFormPage.tsx` 的
 * `flushPendingSession`：450ms 防抖、`pagehide` / `beforeunload` 立即 flush、
 * 存储不可用时静默降级）。差别只有一处：这里把它做成通用 hook。
 *
 * **不自动应用草稿**：命中草稿只放进 `pending`，由恢复条问一次。自动填充会让用户
 * 以为"新建的表单里本来就有这些内容"。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { clearDraft, readDraft, stripSensitive, writeDraft } from "../utils/formDraftStorage";
import type { StoredDraft } from "../utils/formDraftStorage";
import { useToast } from "./useToast";

export interface UseFormDraftOptions<T extends Record<string, unknown>> {
  /** 作用域，形如 `claims.edit#12` / `tracker.create`。必须稳定。 */
  scope: string;
  /** 当前表单值（受控）。hook 只读不写。 */
  values: T;
  /** 关闭草稿（如只读弹窗复用同一表单组件时）。默认 true。 */
  enabled?: boolean;
  /** 弹窗是否打开：打开时重新读一次（关闭期间可能刚被别的标签页写脏）。 */
  open?: boolean;
  /** 额外剔除的字段名（附件等）。 */
  omit?: readonly string[];
  /** 判定"空表单"：返回 true 时不写草稿。 */
  isEmpty?: (values: T) => boolean;
  /** 防抖间隔，默认 450（与网申页同值）。 */
  debounceMs?: number;
}

export interface FormDraftHandle<T> {
  /** 打开时读到的那一份（不自动应用；由恢复条询问用户）。 */
  pending: { values: T; savedAt: number } | null;
  /** 取用草稿（清掉 pending）。 */
  adopt: () => T | null;
  /** 丢弃草稿（清 pending + 清存储）。 */
  discard: () => void;
  /** 提交成功后调用：清存储，但不影响当前表单。 */
  clear: () => void;
}

export function useFormDraft<T extends Record<string, unknown>>({
  scope,
  values,
  enabled = true,
  open = true,
  omit,
  isEmpty,
  debounceMs = 450,
}: UseFormDraftOptions<T>): FormDraftHandle<T> {
  const toast = useToast();
  const [pending, setPending] = useState<StoredDraft | null>(null);
  const pendingRef = useRef<Record<string, unknown> | null>(null);
  const timerRef = useRef(0);
  // 契约：`too-large` 一次会话只提示一次，否则每次击键都会弹一条。
  const warnedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !open) return;
    setPending(readDraft(scope));
  }, [scope, enabled, open]);

  const flush = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = 0;
    const queued = pendingRef.current;
    if (!queued) return;
    pendingRef.current = null;
    const result = writeDraft(scope, queued);
    if (result === "too-large" && !warnedRef.current) {
      warnedRef.current = true;
      toast.warning(t("draft.too-large"));
    }
    // "unavailable" 静默降级：隐私模式不该是用户的负担。
  }, [scope, toast]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (isEmpty?.(values)) return undefined;
    pendingRef.current = stripSensitive(values, omit);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(flush, debounceMs);
    return () => window.clearTimeout(timerRef.current);
  }, [values, enabled, flush, debounceMs, isEmpty, omit]);

  useEffect(() => {
    // 关标签 / 刷新时同步 flush——这两件事不 flush 就等于没做草稿。
    const onLeave = (): void => flush();
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
      flush();
    };
  }, [flush]);

  const adopt = useCallback((): T | null => {
    const current = pending;
    setPending(null);
    return current ? (current.values as T) : null;
  }, [pending]);

  const discard = useCallback(() => {
    setPending(null);
    pendingRef.current = null;
    window.clearTimeout(timerRef.current);
    clearDraft(scope);
  }, [scope]);

  const clear = useCallback(() => {
    pendingRef.current = null;
    window.clearTimeout(timerRef.current);
    clearDraft(scope);
  }, [scope]);

  return { pending: pending as { values: T; savedAt: number } | null, adopt, discard, clear };
}
