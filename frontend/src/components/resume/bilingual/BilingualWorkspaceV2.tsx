// SPDX-License-Identifier: Apache-2.0
/**
 * 双语版本工作区（W16 / D07、D15）— **v2 文档模型原生**，自包含容器。
 *
 * 挂载方式：V2 制作台左栏新增「双语」页签（仅 `resumeId` 存在时），宿主按契约传
 * `resumeId / document / layout / revision / onAdoptDocument`；
 * 组件内部自己发请求（版本表 / 翻译候选 / 采纳 / 术语表），失败自己提示，不改宿主状态之外的任何东西。
 *
 * ## 关键口径
 *
 * - **采纳写的是该语言变体**（`POST .../adopt` 返回 `VariantDetailOut`），不覆盖当前语言主稿；
 * - 采纳成功后把服务端已落库的变体正文交给宿主：`onAdoptDocument(document, revision)`
 *   （宿主替换 detail/html/revision 并重排；`revision` 原样回传当前简历版本，变体采纳不推进它）；
 * - **逐项采纳只针对可写文本 item**：字段 / 文本块；列表、作者、自建板块/自定义字段只读展示
 *   （见 `features/resume-bilingual/fieldPairs` 文件头的取舍）；
 * - 撤销采纳 = 用采纳前的旧文本再采纳一次（任一项失败整批不落，要么全成要么原文不动）。
 */
import { Alert, Button, Segmented, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import { useToast } from "../../../hooks/useToast";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { ApiError } from "../../../api/client";
import type { ResumeDocument } from "../../../types/resumeDocument";
import type { ResumeLayout } from "../../../types";
import { useFieldPlacementCatalog } from "../../../features/profile-library/fieldPlacement";
import { catalogSectionOf } from "../../../features/resume-document";
import { bt } from "../../../features/resume-bilingual/i18n";
import {
  buildBilingualPairs,
  buildTranslationCandidates,
  adoptItems,
  hasCustomContent,
  isCustomSection,
  isCustomKey,
  undoItems,
  type PairLabels,
} from "../../../features/resume-bilingual/fieldPairs";
import { isSameContent, variantDocumentOf } from "../../../features/resume-bilingual/real";
import {
  adoptTranslation,
  createLanguageVariant,
  getVariant,
  listVariants,
  translateVariant,
} from "../../../features/resume-bilingual/api";
import type { VariantBriefOut, VariantDetailOut } from "../../../features/resume-bilingual/api";
import type {
  LanguageVariant,
  TranslationCandidate,
} from "../../../features/resume-bilingual/types";
import BilingualCompareView from "./BilingualCompareView";
import BilingualGlossaryPanel from "./BilingualGlossaryPanel";
import TranslationCandidatePanel from "./TranslationCandidatePanel";
import VariantBar from "./VariantBar";
import VariantLayoutSection from "./VariantLayoutSection";
import VariantReadOnlyPreviewDrawer from "./VariantReadOnlyPreviewDrawer";

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

type WorkspaceTab = "compare" | "candidates" | "glossary";
type LanguageCode = "zh-CN" | "en-US";

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "";
}

/** 后端 400 = 「这次翻译没法开始」（最常见是还没配大模型 API，也可能是语言方向不对）。 */
function isRejectedByBackend(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

function briefToView(variant: VariantBriefOut): LanguageVariant {
  return {
    id: variant.id,
    resume_id: variant.resume_id,
    name: variant.name,
    language: variant.language,
    variant_group_id: variant.variant_group_id,
    created_at: String(variant.created_at ?? ""),
    updated_at: variant.updated_at ?? undefined,
  };
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
  const labels = useMemo<PairLabels>(() => {
    return {
      item: (sectionKey, item) => {
        if ("label" in item && item.label) return item.label;
        const key = "key" in item ? item.key : "";
        if (sectionKey === "header") {
          const header = catalog?.header_fields.find((field) => field.key === key);
          return header?.label ?? (key || bt("bilingual.field.body"));
        }
        const field = catalogSectionOf(catalog, sectionKey)?.fields.find(
          (candidate) => candidate.key === key,
        );
        if (field) return field.label;
        if (item.kind === "text") return bt("bilingual.field.body");
        if (item.kind === "list") return bt("bilingual.field.list");
        if (item.kind === "authors") return bt("bilingual.field.authors");
        return isCustomKey(key) ? bt("bilingual.field.custom") : key;
      },
      group: (sectionKey, sectionTitle) => {
        if (sectionKey === "header") return bt("bilingual.compare.group.header");
        if (sectionTitle) return sectionTitle;
        const section = catalogSectionOf(catalog, sectionKey);
        if (section) return section.title;
        return isCustomSection(sectionKey) ? bt("bilingual.compare.group.custom") : sectionKey;
      },
    };
  }, [catalog]);

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
    try {
      const result = await adoptTranslation(resumeId, detail.id, items);
      setDetail(result.variant);
      const adopted = variantDocumentOf(result.variant);
      if (adopted) onAdoptDocument(adopted, revision);
      const undo = undoItems(candidates, result.applied_paths);
      if (undo.length > 0) {
        toast.undo(bt("bilingual.workspace.adopted", { count: result.applied_paths.length }), {
          label: t("toast.undo.label"),
          onClick: async () => {
            const reverted = await adoptTranslation(resumeId, detail.id, undo);
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
      const adopted = await adoptTranslation(resumeId, created.id, items);
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

  const selected = detail
    ? (variants.find((item) => item.id === detail.id) ?? null)
    : (variants.find((item) => item.id === selectedId) ?? null);
  const pairs = buildBilingualPairs(document, detail?.content ?? null, labels);
  const blockedCount = candidates?.filter((candidate) => candidate.blocked).length ?? 0;
  const customHint = hasCustomContent(document) || hasCustomContent(detail?.content ?? null);
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
          <Button
            type="primary"
            size="small"
            loading={translating || undefined}
            disabled={!detail || busy || readOnly || undefined}
            onClick={() => void handleTranslate()}
          >
            {bt("bilingual.workspace.translate")}
          </Button>
          {detail ? (
            <Button size="small" onClick={() => setPreviewOpen(true)}>
              {bt("bilingual.v2.openInWorkbench")}
            </Button>
          ) : null}
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
          <BilingualGlossaryPanel
            sourceLanguage={sourceLanguage}
            targetLanguage={targetLanguage}
            readOnly={readOnly}
          />
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
