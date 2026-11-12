// SPDX-License-Identifier: Apache-2.0
/**
 * 双语版本工作区（W16 / D07、D15）— **v2 文档模型原生**，自包含容器。
 *
 * 挂载：V2 制作台左栏「双语」页签（仅 `resumeId` 存在时），宿主传 `resumeId / document / layout /
 * `revision / onAdoptDocument`；组件自己发请求（版本表 / 候选 / 采纳 / 术语表），失败自己提示。
 *
 * ## 关键口径
 *
 * - **采纳写的是该语言变体**（`POST .../adopt` 返回 `VariantDetailOut`），不覆盖当前语言主稿；成功后把
 *   服务端已落库的正文交给宿主 `onAdoptDocument(document, revision)`（`revision` 原样回传，不推进它）；
 * - **逐项采纳只针对可写文本 item**：字段 / 文本块；列表、作者、自建板块/自定义字段只读展示
 *   （见 `features/resume/bilingual/fieldPairs` 文件头的取舍）；
 * - 撤销采纳 = 用采纳前的旧文本再采纳一次（任一项失败整批不落，要么全成要么原文不动）；
 * - 只读（`revision === null`）时创建项与翻译按钮都禁用，版本与对照仍可查看。
 */
import { Alert, Button, Segmented, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ErrorState from "../../../components/common/ErrorState";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { useToast } from "../../../hooks/useToast";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ResumeDocument } from "../../../types/resumeDocument";
import type { ResumeLayout } from "../../../types";
import { useFieldPlacementCatalog } from "../../profile/library/fieldPlacement";
import { buildPairLabels } from "./bilingualPairLabels";
import { bt } from "./i18n";
import {
  buildBilingualPairs,
  buildTranslationCandidates,
  adoptItems,
  hasCustomContent,
  undoItems,
  type PairLabels,
} from "./fieldPairs";
import { isSameContent, variantDocumentOf } from "./real";
import VariantOverwriteButton from "./VariantOverwriteButton";
import {
  adoptTranslation,
  createLanguageVariant,
  getVariant,
  listVariants,
  translateVariant,
} from "./api";
import type { VariantBriefOut, VariantDetailOut } from "./api";
import type { TranslationCandidate } from "./types";
import BilingualCompareView from "./BilingualCompareView";
import BilingualGlossaryPanel from "./BilingualGlossaryPanel";
import TranslationCandidatePanel from "./TranslationCandidatePanel";
import VariantBar from "./VariantBar";
import VariantLayoutSection from "./VariantLayoutSection";
import VariantReadOnlyPreviewDrawer from "./VariantReadOnlyPreviewDrawer";
import {
  briefToView,
  errorText,
  isRejectedByBackend,
  type LanguageCode,
  type WorkspaceTab,
} from "./bilingualWorkspaceSupport";

export interface BilingualWorkspaceV2Props {
  resumeId: number;
  /** 当前工作台文档（未保存的也算）：对照的主列、翻译的源。 */
  document: ResumeDocument;
  layout: ResumeLayout;
  /** 条件写 expected_revision；null = 只读（不能创建/翻译/采纳）。 */
  revision: number | null;
  /** 服务端已落库（采纳/恢复后）：宿主替换 detail/html/revision 并按新文档重排。 */
  onAdoptDocument: (document: ResumeDocument, revision: number) => void;
  disabled?: boolean;
  className?: string;
}

export default function BilingualWorkspaceV2({
  resumeId,
  document,
  layout,
  revision,
  onAdoptDocument,
  disabled = false,
  className,
}: BilingualWorkspaceV2Props) {
  useLocale();
  const toast = useToast();
  const { catalog } = useFieldPlacementCatalog();
  const readOnly = revision === null || disabled;
  const sourceLanguage: LanguageCode = document.language === "en-US" ? "en-US" : "zh-CN";
  const targetLanguage: LanguageCode = sourceLanguage === "zh-CN" ? "en-US" : "zh-CN";
  const targetLabel =
    targetLanguage === "en-US" ? bt("bilingual.variant.en") : bt("bilingual.variant.zh");

  const [tab, setTab] = useState<WorkspaceTab>("compare");
  const [variants, setVariants] = useState<VariantBriefOut[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [detail, setDetail] = useState<VariantDetailOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<TranslationCandidate[] | null>(null);
  const [translating, setTranslating] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [creating, setCreating] = useState<LanguageCode | null>(null);
  const [autoTranslating, setAutoTranslating] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** 标签解析：目录优先（与制作台其它面板同一份字段目录），缺省按 item 类型给通用名。 */
  const labels = useMemo<PairLabels>(() => buildPairLabels(catalog), [catalog]);

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

  const handleTranslate = async () => {
    if (!resumeId || !detail) return;
    const translateTarget: LanguageCode =
      detail.language && detail.language !== sourceLanguage ? detail.language : targetLanguage;
    // #17a：源语言变体（与当前简历同语言）只当翻译的"源"，译文一律写进目标语言变体。
    // 在这里生成、又写回自己就是把英文混进中文版——入口直接禁用并说明。
    if (detail.language && detail.language === sourceLanguage) {
      toast.warning(bt("bilingual.workspace.translateBlockedOnSource"));
      return;
    }
    setTranslating(true);
    setTab("candidates");
    try {
      const result = await translateVariant(resumeId, detail.id, {
        target_language: translateTarget,
      });
      const mapped = buildTranslationCandidates(
        detail.content,
        result.candidate,
        result.blocked_fields,
        labels,
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
    if (!resumeId || !detail || !candidates || revision === null) return;
    const items = adoptItems(candidates, paths);
    if (items.length === 0) {
      toast.warning(bt("bilingual.candidate.adoptNone"));
      return;
    }
    setAdopting(true);
    // #17a：后端按 target_language 与变体语言比对，语言不一致整批 422。
    const adoptTarget: LanguageCode =
      detail.language && detail.language !== sourceLanguage ? detail.language : targetLanguage;
    try {
      const result = await adoptTranslation(resumeId, detail.id, items, {
        targetLanguage: adoptTarget,
      });
      setDetail(result.variant);
      const adopted = variantDocumentOf(result.variant);
      if (adopted) onAdoptDocument(adopted, revision);
      const undo = undoItems(candidates, result.applied_paths);
      if (undo.length > 0) {
        toast.undo(bt("bilingual.workspace.adopted", { count: result.applied_paths.length }), {
          label: t("toast.undo.label"),
          onClick: async () => {
            const reverted = await adoptTranslation(resumeId, detail.id, undo, {
              targetLanguage: adoptTarget,
            });
            setDetail(reverted.variant);
            const revertedDocument = variantDocumentOf(reverted.variant);
            if (revertedDocument) onAdoptDocument(revertedDocument, revision);
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
   * 失败口径：**变体一律保留**。任何一步失败都只 toast 具体原因，不把整块面板推进
   * Error 态——用户还能手动点「生成翻译候选」重试。
   */
  const handleCreate = async (language: LanguageCode) => {
    if (!resumeId || readOnly || creating !== null || autoTranslating) return;
    setCreating(language);
    const name =
      language === "en-US" ? bt("bilingual.variant.name.en") : bt("bilingual.variant.name.zh");
    let created: VariantBriefOut;
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
    setSelectedId(created.id);
    setCreating(null);
    toast.success(bt("bilingual.variant.created"));
    await loadVariants();
    if (!alive.current) return;
    setAutoTranslating(true);
    try {
      const source = await getVariant(resumeId, created.id);
      const result = await translateVariant(resumeId, created.id, { target_language: language });
      const mapped = buildTranslationCandidates(
        source.content,
        result.candidate,
        result.blocked_fields,
        labels,
      );
      const items = adoptItems(
        mapped,
        mapped.filter((candidate) => !candidate.blocked).map((candidate) => candidate.path),
      );
      if (items.length === 0) {
        if (alive.current) toast.info(bt("bilingual.workspace.autoTranslate.nothing"));
        return;
      }
      const adopted = await adoptTranslation(resumeId, created.id, items, {
        targetLanguage: language,
      });
      if (!alive.current) return;
      setDetail(adopted.variant);
      setCandidates(null);
      const adoptedDocument = variantDocumentOf(adopted.variant);
      if (adoptedDocument && revision !== null) onAdoptDocument(adoptedDocument, revision);
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
      if (alive.current) setAutoTranslating(false);
    }
  };
  if (error) {
    return (
      <ErrorState
        description={error}
        onRetry={() => void loadVariants()}
        retryLabel={bt("bilingual.workspace.retry")}
      />
    );
  }
  if (loading && variants.length === 0) {
    return <LoadingBlock tip={bt("bilingual.workspace.loading")} />;
  }

  const selected = variants.find((item) => item.id === (detail?.id ?? selectedId)) ?? null;
  const pairs = buildBilingualPairs(document, detail?.content ?? null, labels);
  const blockedCount = candidates?.filter((candidate) => candidate.blocked).length ?? 0;
  const customHint = hasCustomContent(document) || hasCustomContent(detail?.content ?? null);
  const busy = creating !== null || autoTranslating;
  // #17a：与当前简历同语言的变体 = 源语言变体，只当翻译源，不能当翻译目标。
  const viewingSourceVariant = Boolean(detail?.language && detail.language === sourceLanguage);
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
          variants={variants.map(briefToView)}
          current={selected?.language || sourceLanguage}
          onSwitch={(language) => {
            const next = variants.find((item) => item.language === language);
            if (next) setSelectedId(next.id);
          }}
          onCreate={(language) => void handleCreate(language)}
          busy={busy}
          busyLabel={createBusyLabel}
          disabled={readOnly}
        />
        <div className="bilingual-toolbar__actions">
          <Tooltip
            title={
              viewingSourceVariant ? bt("bilingual.workspace.translateBlockedOnSource") : undefined
            }
          >
            <Button
              type="primary"
              size="small"
              loading={translating || undefined}
              disabled={!detail || busy || readOnly || viewingSourceVariant || undefined}
              onClick={() => void handleTranslate()}
            >
              {bt("bilingual.workspace.translate")}
            </Button>
          </Tooltip>
          {detail ? (
            <VariantOverwriteButton
              resumeId={resumeId}
              variantId={detail.id}
              disabled={readOnly || busy}
              onOverwritten={(next) => {
                setDetail(next);
                void loadVariants();
              }}
            />
          ) : null}
          {detail ? (
            <Button
              type="text"
              size="small"
              title={bt("bilingual.v2.previewReadOnly")}
              onClick={() => setPreviewOpen(true)}
            >
              {targetLanguage === "en-US"
                ? bt("bilingual.v2.openInWorkbench")
                : bt("bilingual.v2.openInWorkbenchZh")}
            </Button>
          ) : null}
          {/* 主按钮旁直接写清"生成哪种语言、结果去哪"（R-13）。 */}
          <Typography.Text type="secondary" className="bilingual-toolbar__note">
            {bt("bilingual.workspace.translateHint", { language: targetLabel })}
          </Typography.Text>
        </div>
      </div>
      {readOnly ? <Alert type="info" showIcon title={bt("bilingual.v2.readOnly")} /> : null}
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
          onChanged={(next) => setDetail(next)}
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
          <>
            {customHint ? (
              <Alert type="info" showIcon title={bt("bilingual.v2.customHint")} />
            ) : null}
            {detail ? (
              <BilingualCompareView
                pairs={pairs}
                identical={isSameContent(detail.content, document)}
                primaryLabel={bt("bilingual.compare.columnCurrent")}
                secondaryLabel={selected?.name || bt("bilingual.compare.columnVariant")}
              />
            ) : (
              <Typography.Text type="secondary">{bt("bilingual.variant.missing")}</Typography.Text>
            )}
          </>
        ) : tab === "candidates" ? (
          <>
            {blockedCount > 0 ? (
              <Alert
                type="warning"
                showIcon
                title={bt("bilingual.v2.blockedHint", { count: blockedCount })}
              />
            ) : null}
            <TranslationCandidatePanel
              candidates={candidates ?? []}
              loading={translating || autoTranslating}
              adopting={adopting}
              onAdopt={(paths) => void handleAdopt(paths)}
              onRetry={() => void handleTranslate()}
            />
          </>
        ) : (
          <>
            {/* 术语表页签的一句话用途：这一页和"翻译"是什么关系，光看标题看不出来。 */}
            <Typography.Text type="secondary" className="bilingual-tab-note">
              {bt("bilingual.glossary.purpose")}
            </Typography.Text>
            <BilingualGlossaryPanel
              sourceLanguage={sourceLanguage}
              targetLanguage={targetLanguage}
              readOnly={readOnly}
            />
          </>
        )}
      </div>
      <VariantReadOnlyPreviewDrawer
        open={previewOpen}
        resumeId={resumeId}
        variantId={detail?.id ?? null}
        fallbackLayout={layout}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
}
