// SPDX-License-Identifier: Apache-2.0
/**
 * Variant-list / variant-detail data layer of the bilingual workspace (v2).
 * Split out of `./BilingualWorkspaceV2.tsx` to keep both files under the line
 * budget; pure move, no behaviour change.
 */
import { useCallback, useEffect, useState } from "react";
import { getVariant, listVariants } from "./api";
import type { VariantBriefOut, VariantDetailOut } from "./api";
import { errorText, type LanguageCode } from "./bilingualWorkspaceSupport";
import { bt } from "./i18n";
import type { TranslationCandidate } from "./types";

interface Options {
  resumeId: number;
  targetLanguage: LanguageCode;
}

export function useBilingualVariantData({ resumeId, targetLanguage }: Options) {
  const [variants, setVariants] = useState<VariantBriefOut[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<VariantDetailOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<TranslationCandidate[] | null>(null);

  const loadVariants = useCallback(async () => {
    if (!resumeId) {
      setVariants([]);
      setSelectedId(null);
      setDetail(null);
      return;
    }
    setLoading(true);
    try {
      const data = await listVariants(resumeId);
      setVariants(data.items);
      setSelectedId((current) => {
        if (current && data.items.some((item) => item.id === current)) return current;
        const preferred =
          data.items.find((item) => item.language === targetLanguage) ?? data.items[0];
        return preferred ? preferred.id : null;
      });
      setError(null);
    } catch (caught) {
      setError(errorText(caught) || bt("bilingual.workspace.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [resumeId, targetLanguage]);

  useEffect(() => {
    queueMicrotask(() => void loadVariants());
  }, [loadVariants]);

  useEffect(() => {
    if (!resumeId || selectedId === null) {
      // 清空详情属于外部同步：setState 放进微任务，避开 effect 体里同步 setState 的级联渲染告警。
      queueMicrotask(() => setDetail(null));
      return;
    }
    let cancelled = false;
    void getVariant(resumeId, selectedId)
      .then((next) => {
        if (!cancelled) {
          setDetail(next);
          setCandidates(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorText(caught) || bt("bilingual.workspace.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId, selectedId]);

  return {
    variants,
    selectedId,
    setSelectedId,
    detail,
    setDetail,
    loading,
    error,
    candidates,
    setCandidates,
    loadVariants,
  };
}
