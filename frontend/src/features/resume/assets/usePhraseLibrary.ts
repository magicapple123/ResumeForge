// SPDX-License-Identifier: Apache-2.0
/**
 * 表达资产库的数据 hook（W17-FE 真实 API）：加载 / 分页 / 增改删 / 收藏 / 插入。
 *
 * ## 为什么状态留在这里而不是面板里
 *
 * `PhraseLibraryPanel` 只是"看与筛"的纯展示组件（它连 API 都不 import）。数据加载、
 * mutation 后重载、错误态与"插入成功要把结果交回宿主"都放在这一层：
 * 宿主（制作台/资产页）只消费一个 hook，组件可以在别的场景复用同一套行为。
 *
 * ## 删除撤销
 *
 * 删除是软删（回收站第 17 类）：调用方（容器）负责发 `toast.undo` 并在撤销时调用
 * `restorePhrase`（走既有 `api/trash.restoreTrashItem`）。hook 只做"删 + 重载"。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  collectPhrase,
  createPhrase,
  deletePhrase,
  insertPhrase,
  listPhrases,
  updatePhrase,
} from "./api";
import type {
  PhraseInsertOut,
  PhraseInsertPayload,
  PhraseInPayload,
  PhraseUpdatePayload,
  ResumePhrase,
} from "./types";

const PAGE_SIZE = 100;

export interface UsePhraseLibraryResult {
  phrases: ResumePhrase[];
  loading: boolean;
  /** 加载失败的说明（已本地化；null = 无错误）。 */
  error: string | null;
  /** 是否还有下一页。 */
  hasMore: boolean;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  create: (payload: PhraseInPayload) => Promise<ResumePhrase>;
  update: (phraseId: number, payload: PhraseUpdatePayload) => Promise<ResumePhrase>;
  /** 软删 + 重载；撤销由调用方用 `restoreTrashItem` 完成。 */
  remove: (phraseId: number) => Promise<void>;
  collect: (resumeId: number, path: string) => Promise<ResumePhrase>;
  insert: (phraseId: number, payload: PhraseInsertPayload) => Promise<PhraseInsertOut>;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "";
}

export function usePhraseLibrary(): UsePhraseLibraryResult {
  const [phrases, setPhrases] = useState<ResumePhrase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  // 只采用最后一次请求的结果：连续 reload 时旧响应不能覆盖新列表。
  const requestId = useRef(0);

  const load = useCallback(async (cursor?: number | null) => {
    const current = ++requestId.current;
    setLoading(true);
    try {
      const page = await listPhrases({ limit: PAGE_SIZE, cursor: cursor ?? null });
      if (current !== requestId.current) return;
      setPhrases((previous) => (cursor ? [...previous, ...page.items] : page.items));
      setNextCursor(page.next_cursor ?? null);
      setError(null);
    } catch (caught) {
      if (current !== requestId.current) return;
      setError(errorText(caught));
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, []);

  const reload = useCallback(() => load(null), [load]);
  const loadMore = useCallback(
    () => (nextCursor ? load(nextCursor) : Promise.resolve()),
    [load, nextCursor],
  );

  useEffect(() => {
    // 用 microtask 起首屏加载：effect 内不直接触发 setState（react-hooks/set-state-in-effect）。
    queueMicrotask(() => void reload());
  }, [reload]);

  const create = useCallback(
    async (payload: PhraseInPayload) => {
      const created = await createPhrase(payload);
      await reload();
      return created;
    },
    [reload],
  );

  const update = useCallback(
    async (phraseId: number, payload: PhraseUpdatePayload) => {
      const updated = await updatePhrase(phraseId, payload);
      await reload();
      return updated;
    },
    [reload],
  );

  const remove = useCallback(
    async (phraseId: number) => {
      await deletePhrase(phraseId);
      await reload();
    },
    [reload],
  );

  const collect = useCallback(
    async (resumeId: number, path: string) => {
      const collected = await collectPhrase(resumeId, path);
      await reload();
      return collected;
    },
    [reload],
  );

  const insert = useCallback(
    async (phraseId: number, payload: PhraseInsertPayload) => {
      const result = await insertPhrase(phraseId, payload);
      // 插入会 +1 使用次数与最近使用时间：重载让面板立即反映（不伪造本地计数）。
      await reload();
      return result;
    },
    [reload],
  );

  return {
    phrases,
    loading,
    error,
    hasMore: nextCursor !== null,
    reload,
    loadMore,
    create,
    update,
    remove,
    collect,
    insert,
  };
}
