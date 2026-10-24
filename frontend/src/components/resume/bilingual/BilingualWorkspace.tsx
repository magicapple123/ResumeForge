// SPDX-License-Identifier: Apache-2.0
/**
 * 双语版本容器（W16-FE 真实 API）：语言版本对照 / 翻译候选逐项采纳（可撤销）/ 术语表。
 *
 * ## 关键口径（与 wave3 §2 + lead 批准的 adopt 偏差一致）
 *
 * - 采纳写的是**该语言变体**（adopt 返回 `VariantDetailOut`），不覆盖当前语言正文；
 * - 撤销采纳 = 用采纳前的旧文本再采纳一次（任一项失败整批不落，回退要么全成要么不动）；
 * - 后端 `blocked_fields`（事实锁/术语锁定保留原文）在候选里禁用勾选，**不给采纳**；
 * - 术语删除是软删（回收站第 18 类），Toast 5 秒撤销 → `restoreTrashItem("glossary_term", id)`。
 */
import { Alert, Button, Segmented, Space, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import { useToast } from "../../../hooks/useToast";
import { t } from "../../../i18n";
import { restoreTrashItem } from "../../../api/trash";
import { bt } from "../../../features/resume-bilingual/i18n";
import { buildBilingualPairs } from "../../../features/resume-bilingual/fieldPairs";
import {
  adoptItems,
  buildTranslationCandidates,
  glossaryOutToTerm,
  termToCreatePayload,
  undoItems,
  variantToLanguageVariant,
} from "../../../features/resume-bilingual/real";
import {
  adoptTranslation,
  createGlossaryTerm,
  deleteGlossaryTerm,
  getVariant,
  listGlossaryTerms,
  listVariants,
  translateVariant,
  updateGlossaryTerm,
  type VariantDetailOut,
} from "../../../features/resume-bilingual/api";
import type {
  GlossaryTerm,
  LanguageVariant,
  TranslationCandidate,
} from "../../../features/resume-bilingual/types";
import BilingualCompareView from "./BilingualCompareView";
import GlossaryTable from "./GlossaryTable";
import TranslationCandidatePanel from "./TranslationCandidatePanel";
import VariantBar from "./VariantBar";

type WorkspaceTab = "compare" | "candidates" | "glossary";

interface Props {
  /** 当前简历 id；null = 没有可操作的语言版本。 */
  resumeId: number | null;
  /** 当前简历内容（对照的 primary 列）。 */
  currentContent: Record<string, unknown> | null;
  /** 当前简历语言（决定目标语言与列标题）。 */
  currentLanguage: "zh-CN" | "en-US";
  /** 变体采纳/更新后交回宿主（宿主刷新 detail/预览）。 */
  onVariantApplied?: (variant: VariantDetailOut) => void;
  className?: string;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "";
}

export default function BilingualWorkspace({
  resumeId,
  currentContent,
  currentLanguage,
  onVariantApplied,
  className,
}: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<WorkspaceTab>("compare");
  const [variants, setVariants] = useState<LanguageVariant[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<VariantDetailOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<TranslationCandidate[] | null>(null);
  const [translating, setTranslating] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [termsLoading, setTermsLoading] = useState(false);
  const [savingTerm, setSavingTerm] = useState(false);

  const targetLanguage = currentLanguage === "zh-CN" ? "en-US" : "zh-CN";

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
      const items = data.items.map(variantToLanguageVariant);
      setVariants(items);
      setSelectedId((current) => {
        if (current && items.some((item) => item.id === current)) return current;
        const preferred = items.find((item) => item.language === targetLanguage) ?? items[0];
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

  const loadGlossary = useCallback(async () => {
    setTermsLoading(true);
    try {
      const data = await listGlossaryTerms();
      setTerms(data.items.map(glossaryOutToTerm));
    } catch (caught) {
      setError(errorText(caught) || bt("bilingual.glossary.loadFailed"));
    } finally {
      setTermsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "glossary") queueMicrotask(() => void loadGlossary());
  }, [tab, loadGlossary]);

  const handleTranslate = async () => {
    if (!resumeId || !detail) return;
    setTranslating(true);
    setTab("candidates");
    try {
      const result = await translateVariant(resumeId, detail.id, {
        target_language: targetLanguage,
      });
      const mapped = buildTranslationCandidates(
        detail.content,
        result.candidate,
        result.blocked_fields,
      );
      setCandidates(mapped);
      if (mapped.length === 0) toast.info(bt("bilingual.candidate.empty"));
    } catch (caught) {
      setCandidates([]);
      toast.error(errorText(caught) || bt("bilingual.candidate.failed"));
    } finally {
      setTranslating(false);
    }
  };

  const handleAdopt = async (paths: string[]) => {
    if (!resumeId || !detail || !candidates) return;
    const items = adoptItems(candidates, paths);
    if (items.length === 0) {
      toast.warning(bt("bilingual.candidate.adoptNone"));
      return;
    }
    setAdopting(true);
    try {
      const result = await adoptTranslation(resumeId, detail.id, items);
      setDetail(result.variant);
      onVariantApplied?.(result.variant);
      // 撤销 = 用采纳前的旧文本再采纳一次（同一条变体、只改列出的路径）。
      const undo = undoItems(candidates, result.applied_paths);
      if (undo.length > 0) {
        toast.undo(bt("bilingual.workspace.adopted", { count: result.applied_paths.length }), {
          label: t("toast.undo.label"),
          onClick: async () => {
            const reverted = await adoptTranslation(resumeId, detail.id, undo);
            setDetail(reverted.variant);
            onVariantApplied?.(reverted.variant);
            toast.success(bt("bilingual.workspace.undoAdopted"));
          },
        });
      }
      setCandidates(null);
    } catch (caught) {
      toast.error(errorText(caught) || bt("bilingual.workspace.adoptFailed"));
    } finally {
      setAdopting(false);
    }
  };

  const handleSaveTerm = async (term: GlossaryTerm) => {
    setSavingTerm(true);
    try {
      if (term.id > 0) {
        await updateGlossaryTerm(term.id, {
          source_term: term.source_term,
          target_term: term.target_term,
          category: term.category,
          locked: term.locked,
          note: term.note,
        });
      } else {
        await createGlossaryTerm(termToCreatePayload(term, currentLanguage, targetLanguage));
      }
      toast.success(bt("bilingual.glossary.saved"));
      await loadGlossary();
    } catch (caught) {
      toast.error(errorText(caught) || bt("bilingual.candidate.failed"));
    } finally {
      setSavingTerm(false);
    }
  };

  const handleDeleteTerm = async (term: GlossaryTerm) => {
    try {
      await deleteGlossaryTerm(term.id);
      await loadGlossary();
      toast.undo(bt("bilingual.glossary.deleted"), {
        label: t("toast.undo.label"),
        onClick: async () => {
          await restoreTrashItem("glossary_term", term.id);
          await loadGlossary();
        },
      });
    } catch (caught) {
      toast.error(errorText(caught) || bt("bilingual.glossary.deleteFailed"));
    }
  };

  if (!resumeId) {
    return <Alert type="info" showIcon title={bt("bilingual.workspace.noVariant")} />;
  }
  if (error) {
    return (
      <ErrorState
        description={error}
        onRetry={() => void loadVariants()}
        retryLabel={bt("bilingual.workspace.retry")}
      />
    );
  }
  if (loading && variants.length === 0)
    return <LoadingBlock tip={bt("bilingual.workspace.loading")} />;

  const selected = detail
    ? (variants.find((item) => item.id === detail.id) ?? null)
    : (variants.find((item) => item.id === selectedId) ?? null);
  const pairs = buildBilingualPairs(
    (currentContent ?? null) as never,
    (detail?.content ?? null) as never,
  );

  return (
    <div className={className} data-bilingual-workspace="1">
      <Space size={8} wrap style={{ marginBottom: 8 }}>
        <VariantBar
          variants={variants}
          current={selected?.language || currentLanguage}
          onSwitch={(language) => {
            const next = variants.find((item) => item.language === language);
            if (next) setSelectedId(next.id);
          }}
        />
        <Button
          type="primary"
          size="small"
          loading={translating || undefined}
          disabled={!detail || undefined}
          onClick={() => void handleTranslate()}
        >
          {bt("bilingual.workspace.translate")}
        </Button>
        <Segmented
          size="small"
          value={tab}
          options={[
            { value: "compare", label: bt("bilingual.workspace.tabCompare") },
            { value: "candidates", label: bt("bilingual.workspace.tabCandidates") },
            { value: "glossary", label: bt("bilingual.workspace.tabGlossary") },
          ]}
          onChange={(value) => setTab(value as WorkspaceTab)}
        />
      </Space>
      {tab === "compare" ? (
        detail ? (
          <BilingualCompareView pairs={pairs} />
        ) : (
          <Typography.Text type="secondary">{bt("bilingual.variant.missing")}</Typography.Text>
        )
      ) : tab === "candidates" ? (
        <TranslationCandidatePanel
          candidates={candidates ?? []}
          loading={translating}
          adopting={adopting}
          onAdopt={(paths) => void handleAdopt(paths)}
          onRetry={() => void handleTranslate()}
        />
      ) : (
        <>
          {termsLoading && terms.length === 0 ? (
            <LoadingBlock tip={bt("bilingual.glossary.loading")} />
          ) : (
            <GlossaryTable
              terms={terms}
              saving={savingTerm}
              onSaveTerm={(term) => void handleSaveTerm(term)}
              onDeleteTerm={(term) => void handleDeleteTerm(term)}
            />
          )}
        </>
      )}
    </div>
  );
}
