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
import { Alert, Button, Segmented, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import { useToast } from "../../../hooks/useToast";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { ApiError } from "../../../api/client";
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
  createLanguageVariant,
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
import VariantLayoutSection from "./VariantLayoutSection";

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

/**
 * 后端 400 = 「这次翻译没法开始」（最常见是还没配大模型 API，也可能是语言方向不对）。
 *
 * 只按状态码分类、把后端原文当 reason 带出来：后端那句 detail 是服务端文案，
 * 前端不再按中文关键字匹配（否则界面文案会被硬编码进代码里）。
 */
function isRejectedByBackend(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

export default function BilingualWorkspace({
  resumeId,
  currentContent,
  currentLanguage,
  onVariantApplied,
  className,
}: Props) {
  useLocale();
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
  /** 正在新建的语言版本（翻译开始前就清空）。 */
  const [creating, setCreating] = useState<"zh-CN" | "en-US" | null>(null);
  /** 创建成功后自动翻译（translate → adopt）是否在跑。 */
  const [autoTranslating, setAutoTranslating] = useState(false);
  // 翻译可能几十秒、也可能被取消：卸载后不再 setState（只在 finally 里复位 loading）。
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

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

  /**
   * 新建语言版本 = 「复制一份同语言内容」+「立刻翻译成目标语言」两步。
   *
   * 以前只做了第一步，用户看到两列都是中文就以为坏了。这里把后端既有链路接起来：
   * create → getVariant（拿复制来的正文）→ translate（生成候选、不写库）→
   * `buildTranslationCandidates` 过滤掉 `blocked_fields`（事实锁/术语锁保留原文的字段）→
   * adopt（写回该变体）→ 交回宿主。
   *
   * 失败口径：**变体一律保留**。任何一步失败都只 toast 具体原因，不把整块面板推进
   * Error 态——用户还能手动点「生成翻译候选」重试。
   */
  const handleCreateVariant = async (language: "zh-CN" | "en-US") => {
    if (!resumeId || creating !== null || autoTranslating) return;
    setCreating(language);
    const name =
      language === "en-US" ? bt("bilingual.variant.name.en") : bt("bilingual.variant.name.zh");
    let created: VariantDetailOut;
    try {
      created = await createLanguageVariant(resumeId, language, name);
    } catch (caught) {
      if (alive.current) {
        setCreating(null);
        toast.error(errorText(caught) || bt("bilingual.variant.createFailed"));
      }
      return;
    }
    if (!alive.current) return;
    // 变体先落进列表：后面翻译失败/超时也能看到并使用这份版本。
    setSelectedId(created.id);
    setCreating(null);
    toast.success(bt("bilingual.variant.created"));
    await loadVariants();

    if (!alive.current) return;
    setAutoTranslating(true);
    try {
      const source = await getVariant(resumeId, created.id);
      const result = await translateVariant(resumeId, created.id, {
        target_language: language,
      });
      const mapped = buildTranslationCandidates(
        source.content,
        result.candidate,
        result.blocked_fields,
      );
      const items = adoptItems(
        mapped,
        mapped.filter((candidate) => !candidate.blocked).map((candidate) => candidate.path),
      );
      if (items.length === 0) {
        if (alive.current) toast.info(bt("bilingual.workspace.autoTranslate.nothing"));
        return;
      }
      const adopted = await adoptTranslation(resumeId, created.id, items);
      if (!alive.current) return;
      setDetail(adopted.variant);
      setCandidates(null);
      onVariantApplied?.(adopted.variant);
      await loadVariants();
      if (alive.current) {
        toast.success(
          bt("bilingual.workspace.autoTranslate.done", { count: adopted.applied_paths.length }),
        );
      }
    } catch (caught) {
      if (!alive.current) return;
      if (isRejectedByBackend(caught)) {
        toast.warning(bt("bilingual.workspace.translateRejected", { reason: errorText(caught) }));
      } else {
        toast.error(errorText(caught) || bt("bilingual.workspace.autoTranslate.failed"));
      }
    } finally {
      // 超时/取消也只是"这次没翻成"：loading 必须复位，变体保持不动。
      if (alive.current) setAutoTranslating(false);
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
  // 创建/翻译期间整条工具条禁用：这两步都不能并行（会建出两份一样语言的版本）。
  const busy = creating !== null || autoTranslating;
  const createBusyLabel = autoTranslating
    ? bt("bilingual.variant.translating")
    : bt("bilingual.variant.creating");

  return (
    <div
      className={["bilingual-workspace", className].filter(Boolean).join(" ")}
      data-bilingual-workspace="1"
    >
      <div className="bilingual-toolbar">
        <VariantBar
          variants={variants}
          current={selected?.language || currentLanguage}
          onSwitch={(language) => {
            const next = variants.find((item) => item.language === language);
            if (next) setSelectedId(next.id);
          }}
          onCreate={(language) => void handleCreateVariant(language)}
          busy={busy}
          busyLabel={createBusyLabel}
        />
        <div className="bilingual-toolbar__actions">
          <Button
            type="primary"
            size="small"
            loading={translating || undefined}
            disabled={!detail || busy || undefined}
            onClick={() => void handleTranslate()}
          >
            {bt("bilingual.workspace.translate")}
          </Button>
        </div>
      </div>
      {autoTranslating ? (
        <Alert
          className="bilingual-progress"
          type="info"
          showIcon
          title={bt("bilingual.workspace.autoTranslate.title")}
          description={bt("bilingual.workspace.autoTranslate.hint")}
        />
      ) : null}
      {detail ? (
        <VariantLayoutSection
          resumeId={resumeId}
          variant={detail}
          onChanged={(next) => {
            setDetail(next);
            onVariantApplied?.(next);
          }}
        />
      ) : null}
      <div className="bilingual-tabs">
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
      </div>
      <div className="bilingual-body">
        {tab === "compare" ? (
          detail ? (
            <BilingualCompareView pairs={pairs} />
          ) : (
            <Typography.Text type="secondary">{bt("bilingual.variant.missing")}</Typography.Text>
          )
        ) : tab === "candidates" ? (
          <TranslationCandidatePanel
            candidates={candidates ?? []}
            loading={translating || autoTranslating}
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
    </div>
  );
}
