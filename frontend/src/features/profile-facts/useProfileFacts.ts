// SPDX-License-Identifier: Apache-2.0
/**
 * 补充事实的数据 hook：加载 / 分页 / 增改删 / mutation 后重载。
 *
 * 与 `usePhraseLibrary` 同一形态（W17 先例）：组件只负责"看与改"，请求与竞态处理
 * 留在这一层。加载用 `requestId` 只采纳最后一次响应——连续点「刷新」时旧响应不能
 * 覆盖新列表。
 *
 * 删除是软删：hook 只负责"删 + 重载"，提示与"移入回收站"的文案由调用方给。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import {
  PROFILE_FACTS_PAGE_SIZE,
  createProfileFact,
  deleteProfileFact,
  listProfileFacts,
  updateProfileFact,
} from "./api";
import { errorDetail } from "./errors";
import { nextSortOrder } from "./factModel";
import type { FactKind, FactPayload, ProfileFact } from "./types";

/** 旧记录（灵活字段上线前保存的）payload 没有 custom_fields；读入时补成 []。 */
function normalizeFact(fact: ProfileFact): ProfileFact {
  const payload = fact.payload as unknown as Record<string, unknown>;
  if (Array.isArray(payload.custom_fields)) return fact;
  return { ...fact, payload: { ...payload, custom_fields: [] } } as unknown as ProfileFact;
}

export interface UseProfileFactsResult {
  facts: ProfileFact[];
  /** 服务端总数；大于 `facts.length` 时界面给「加载更多」。 */
  total: number;
  loading: boolean;
  loadingMore: boolean;
  /** 首次加载失败的原因（已按 `extractError` 口径本地化）；null 表示无错误。 */
  error: string | null;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  create: (kind: FactKind, payload: FactPayload) => Promise<ProfileFact>;
  update: (fact: ProfileFact, payload: FactPayload) => Promise<ProfileFact>;
  remove: (fact: ProfileFact) => Promise<void>;
}

export function useProfileFacts(): UseProfileFactsResult {
  const [facts, setFacts] = useState<ProfileFact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (offset: number) => {
    const current = ++requestId.current;
    if (offset === 0) setLoading(true);
    try {
      const page = await listProfileFacts({ offset, limit: PROFILE_FACTS_PAGE_SIZE });
      if (current !== requestId.current) return;
      const items = page.items.map(normalizeFact);
      setFacts((previous) => (offset > 0 ? [...previous, ...items] : items));
      setTotal(page.total);
      setError(null);
    } catch (caught) {
      if (current !== requestId.current) return;
      setError(errorDetail(caught) || t("profileFacts.error.unknown"));
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, []);

  const reload = useCallback(() => load(0), [load]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      await load(facts.length);
    } finally {
      setLoadingMore(false);
    }
  }, [facts.length, load]);

  useEffect(() => {
    // 用 microtask 起首屏加载：effect 内不直接触发 setState（与 usePhraseLibrary 同一写法）。
    queueMicrotask(() => void load(0));
  }, [load]);

  const create = useCallback(
    async (kind: FactKind, payload: FactPayload) => {
      const created = await createProfileFact({
        kind,
        payload,
        sort_order: nextSortOrder(facts),
      });
      await load(0);
      return normalizeFact(created);
    },
    [facts, load],
  );

  const update = useCallback(
    async (fact: ProfileFact, payload: FactPayload) => {
      const updated = await updateProfileFact(fact.fact_id, {
        payload,
        expected_revision: fact.revision,
      });
      await load(0);
      return normalizeFact(updated);
    },
    [load],
  );

  const remove = useCallback(
    async (fact: ProfileFact) => {
      await deleteProfileFact(fact.fact_id);
      await load(0);
    },
    [load],
  );

  return { facts, total, loading, loadingMore, error, reload, loadMore, create, update, remove };
}
