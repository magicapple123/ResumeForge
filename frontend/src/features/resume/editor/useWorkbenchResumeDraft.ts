// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台会话草稿（QW-5）：只在**当前标签页**里兜住"刷新 / 误关就把改动丢了"。
 *
 * ## 与通用表单草稿（`hooks/useFormDraft` + `utils/formDraftStorage`）的差别
 *
 * 通用草稿按 32KB 截断、key 只有 `scope@dataset`——那套口径是给"一张表单"定的。
 * 简历的载荷是整份 `ResumeDocument` + `ResumeLayout`，实测（2026-11-18，本机 22 份真实
 * 简历，脚本读取 `GET /api/resumes` 与 `GET /api/resumes/{id}` 后对
 * `{document, layout}` 做 `JSON.stringify` 并计 UTF-8 字节）：
 *
 * - 中位 63,337 B（约 61.9 KB），最大 70,948 B（约 69.3 KB），最小 19,944 B（约 19.5 KB）；
 * - 上限取 **256 KB** = 262,144 B ≈ 最大实测值的 3.7 倍，给"长 CV / 更多条目"留余量；
 * - 典型 sessionStorage 配额 5 MB → 理论上可同时容纳约 19 份草稿；实际靠"同一简历
 *   只保留一份草稿"的清扫兜住（见 `writeResumeDraft`）。
 *
 * 超限**不截短**：截短后的内容是"看起来恢复了、其实少了几段"，比没有草稿更糟。
 * 超限 / 存储不可写都通过 `onNotice` 明确说"未能暂存"，当前内存里的改动不受影响。
 *
 * ## key 为什么带 revision
 *
 * `resumeforge.resume-draft.v1:<dataset>:resume-<id>@r<revision>`：同一份简历在不同
 * 版本上的草稿不能互相覆盖；打开时按"同一简历 + 同一数据集"前缀扫描，取最新的一份，
 * 若它的基准版本落后于服务端当前版本，恢复后仍走既有 409 冲突流程（不静默覆盖）。
 *
 * ## 不做
 *
 * 不写 localStorage、不跨标签页合并、不自动应用（恢复必须用户点）、不落后端。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResumeLayout } from "../../../types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { t } from "../../../i18n";
import { readActiveDatasetId } from "../../../utils/datasetScope";

const DRAFT_KEY_PREFIX = "resumeforge.resume-draft.v1";
/** 单份草稿的序列化上限（UTF-8 字节）：实测最大 70,948 B 的约 3.7 倍，见文件头。 */
export const RESUME_DRAFT_MAX_BYTES = 256 * 1024;
/** 超过这个年龄的草稿不再恢复（同标签页长期挂着也可能很旧）。 */
export const RESUME_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEBOUNCE_MS = 450;

export interface ResumeDraftIdentity {
  resumeId: number;
  /** 数据集作用域：切数据集后不得交叉恢复（RF-13 的既有教训）。 */
  datasetId: string;
}

export interface ResumeDraft {
  document: ResumeDocument;
  layout: ResumeLayout;
  savedAt: number;
  /** 写入这份草稿时本地内容基于的服务端版本。 */
  baseRevision: number;
}

export type ResumeDraftWriteResult = "ok" | "too-large" | "unavailable";

export function resumeDraftBaseKey(identity: ResumeDraftIdentity): string {
  return `${DRAFT_KEY_PREFIX}:${identity.datasetId}:resume-${identity.resumeId}`;
}

export function resumeDraftStorageKey(identity: ResumeDraftIdentity, baseRevision: number): string {
  return `${resumeDraftBaseKey(identity)}@r${baseRevision}`;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    // 隐私模式下访问 sessionStorage 本身就可能抛 SecurityError。
    return null;
  }
}

/** UTF-8 字节数（不依赖 TextEncoder：旧 Safari 与 jsdom 的差异不值得赌）。 */
function byteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function identityOf(resumeId: number): ResumeDraftIdentity {
  return { resumeId, datasetId: readActiveDatasetId() };
}

function isStoredDraft(value: unknown): value is ResumeDraft {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const document = record.document as ResumeDocument | undefined;
  const layout = record.layout as ResumeLayout | undefined;
  return (
    Boolean(document) &&
    document?.version === 2 &&
    Boolean(layout) &&
    typeof layout?.template === "string" &&
    typeof record.savedAt === "number" &&
    Number.isFinite(record.savedAt) &&
    typeof record.baseRevision === "number"
  );
}

/** 同一简历 + 数据集的全部草稿键（跨 revision）。 */
function keysOf(store: Storage, identity: ResumeDraftIdentity): string[] {
  const prefix = `${resumeDraftBaseKey(identity)}@r`;
  const keys: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key && key.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/**
 * 读"这份简历"最新的一份草稿（跨 revision）。
 *
 * 按前缀扫描而不是精确匹配 revision：服务端版本前进后，旧草稿仍然要能被找到，
 * 只是恢复后必须走冲突流程——否则用户会以为"刷新后草稿没了"。
 */
export function readResumeDraft(
  identity: ResumeDraftIdentity,
  now: number = Date.now(),
): ResumeDraft | null {
  const store = storage();
  if (!store) return null;
  try {
    let newest: ResumeDraft | null = null;
    for (const key of keysOf(store, identity)) {
      const raw = store.getItem(key);
      if (!raw) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        store.removeItem(key);
        continue;
      }
      if (!isStoredDraft(parsed)) {
        store.removeItem(key);
        continue;
      }
      if (now - parsed.savedAt > RESUME_DRAFT_TTL_MS) {
        store.removeItem(key);
        continue;
      }
      if (!newest || parsed.savedAt > newest.savedAt) newest = parsed;
    }
    return newest;
  } catch {
    return null;
  }
}

export function writeResumeDraft(
  identity: ResumeDraftIdentity,
  baseRevision: number,
  document: ResumeDocument,
  layout: ResumeLayout,
  now: number = Date.now(),
): ResumeDraftWriteResult {
  const store = storage();
  if (!store) return "unavailable";
  const payload: ResumeDraft = { document, layout, savedAt: now, baseRevision };
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return "unavailable";
  }
  // 超限不截短正文（见文件头）；同时清掉同身份的旧草稿，避免恢复到更旧的一版。
  if (byteLength(serialized) > RESUME_DRAFT_MAX_BYTES) {
    clearResumeDraft(identity);
    return "too-large";
  }
  try {
    // 同一简历只留一份：不同 revision 的旧键先清掉，值本身已包含 baseRevision。
    for (const key of keysOf(store, identity)) store.removeItem(key);
    store.setItem(resumeDraftStorageKey(identity, baseRevision), serialized);
    return "ok";
  } catch {
    return "unavailable";
  }
}

export function clearResumeDraft(identity: ResumeDraftIdentity | null): void {
  if (!identity) return;
  const store = storage();
  if (!store) return;
  try {
    for (const key of keysOf(store, identity)) store.removeItem(key);
  } catch {
    // 清理失败不应阻止用户保存/放弃。
  }
}

export interface UseWorkbenchResumeDraftOptions {
  open: boolean;
  resumeId?: number | null;
  /** 本地内容基于的服务端版本（参与 key；保存成功后草稿即清理）。 */
  baseRevision: number;
  document: ResumeDocument;
  layout?: ResumeLayout;
  /** 只读宿主（没有可编辑正文）不写草稿。 */
  enabled: boolean;
  /** 有未保存改动才写；true → false = 保存成功 / 放弃 / 恢复版本，按身份清理。 */
  dirty: boolean;
  debounceMs?: number;
  /** 未能暂存时的提示出口（宿主接 message.warning）。 */
  onNotice?: (text: string) => void;
}

export interface WorkbenchResumeDraft {
  /** 打开时读到的那一份（不自动应用，恢复条问一次）。 */
  pending: ResumeDraft | null;
  /** 取用草稿（清掉 pending，调用方负责写回历史/版式）。 */
  restore: () => ResumeDraft | null;
  /** 放弃草稿（清 pending + 清存储）。 */
  discard: () => void;
  /** 保存成功 / 切换身份后的清理（不影响当前编辑内容）。 */
  clear: () => void;
}

export function useWorkbenchResumeDraft({
  open,
  resumeId,
  baseRevision,
  document,
  layout,
  enabled,
  dirty,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  onNotice,
}: UseWorkbenchResumeDraftOptions): WorkbenchResumeDraft {
  const [pending, setPending] = useState<ResumeDraft | null>(null);
  // 身份只在这三件事变化时重建；datasetId 由模块自己读（切数据集会整页 reload）。
  const identity = useMemo<ResumeDraftIdentity | null>(
    () => (open && enabled && resumeId != null ? identityOf(resumeId) : null),
    [open, enabled, resumeId],
  );
  const identityRef = useRef<ResumeDraftIdentity | null>(identity);
  const previousIdentityRef = useRef<ResumeDraftIdentity | null>(null);
  const timerRef = useRef(0);
  const queuedRef = useRef<{
    identity: ResumeDraftIdentity;
    baseRevision: number;
    document: ResumeDocument;
    layout: ResumeLayout;
  } | null>(null);
  // 同一身份的"未能暂存"只提示一次，否则每次击键都会弹一条。
  const noticedRef = useRef<string | null>(null);

  // 读草稿 + 身份切换时按身份清理上一条（切简历 / 切数据集不得交叉恢复）。
  // 关闭制作台（identity → null）**不清理**：草稿的全部意义就是"关掉/刷新后还能回来"。
  useEffect(() => {
    const previous = previousIdentityRef.current;
    if (
      previous &&
      identity &&
      (previous.resumeId !== identity.resumeId || previous.datasetId !== identity.datasetId)
    ) {
      clearResumeDraft(previous);
    }
    if (identity) previousIdentityRef.current = identity;
    identityRef.current = identity;
    if (!identity) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 关闭时同步收回恢复条
      setPending(null);
      return;
    }
    queuedRef.current = null;
    window.clearTimeout(timerRef.current);
    setPending(readResumeDraft(identity));
  }, [identity]);

  const flush = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = 0;
    const queued = queuedRef.current;
    queuedRef.current = null;
    if (!queued) return;
    // 异步旧写入不得覆盖新草稿：身份变了就丢弃这一次回写。
    const current = identityRef.current;
    if (
      !current ||
      current.resumeId !== queued.identity.resumeId ||
      current.datasetId !== queued.identity.datasetId
    ) {
      return;
    }
    const result = writeResumeDraft(
      queued.identity,
      queued.baseRevision,
      queued.document,
      queued.layout,
    );
    if (result === "ok") return;
    const signature = `${queued.identity.datasetId}:${queued.identity.resumeId}`;
    if (noticedRef.current === signature) return;
    noticedRef.current = signature;
    onNotice?.(
      t(result === "too-large" ? "workbench.draft.too-large" : "workbench.draft.unavailable"),
    );
  }, [onNotice]);

  useEffect(() => {
    if (!identity || !layout || !dirty) return undefined;
    queuedRef.current = { identity, baseRevision, document, layout };
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(flush, debounceMs);
    return () => window.clearTimeout(timerRef.current);
  }, [baseRevision, debounceMs, dirty, document, flush, identity, layout]);

  // 由脏变干净 = 保存成功 / 放弃修改 / 恢复历史版本：按身份清理。
  const wasDirtyRef = useRef(false);
  useEffect(() => {
    if (dirty) {
      wasDirtyRef.current = true;
      return;
    }
    if (!wasDirtyRef.current) return;
    wasDirtyRef.current = false;
    window.clearTimeout(timerRef.current);
    queuedRef.current = null;
    noticedRef.current = null;
    setPending(null);
    clearResumeDraft(identityRef.current);
  }, [dirty]);

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

  const restore = useCallback((): ResumeDraft | null => {
    const current = pending;
    setPending(null);
    return current;
  }, [pending]);

  const discard = useCallback(() => {
    setPending(null);
    queuedRef.current = null;
    wasDirtyRef.current = false;
    window.clearTimeout(timerRef.current);
    clearResumeDraft(identityRef.current);
  }, []);

  const clear = useCallback(() => {
    setPending(null);
    queuedRef.current = null;
    wasDirtyRef.current = false;
    window.clearTimeout(timerRef.current);
    clearResumeDraft(identityRef.current);
  }, []);

  return { pending, restore, discard, clear };
}
