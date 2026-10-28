// SPDX-License-Identifier: Apache-2.0
/**
 * W12 制作台来源面板的宿主接线（从 `ResumeZoomModal` 拆出的另一条"选中 → 下游"链路）。
 *
 * 选中来自 W03 批次的 `locator`（object_id / point_id / path）：
 * - **来源链**：`GET /provenance/resumes/{id}/chain`，未关联时显示"未建立来源关联"（不猜文字）；
 * - **事实锁**：列表 + 新建/删除；409 `fact_lock_conflict` 的 violations 逐条交给面板；
 * - **局部写作候选**：`POST /writing/rewrite-field` 三条模式（精炼/突出方法/突出结果），
 *   采纳由宿主写回内容并记一步历史（本 hook 只算新内容，不碰编辑器）。
 *
 * 外发预览 / 用量（R04）不在制作台常驻：它们属于"发出去/花了多少"的设置页语义，
 * 由设置页挂 `OutboundPreviewCard` / `UsageSummaryCard`，避免每次开制作台都请求。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ResumeContent } from "../../types";
import { EMPTY_LOCATOR, type ProvenanceLocator } from "../../features/resume-provenance/selection";
import { pt } from "../../features/resume-provenance/i18n";
import {
  locatorForSelectionKey,
  selectionKeyForLocator,
  selectionOptions,
} from "../../features/resume-provenance/panelSelection";
import {
  createFactLock,
  createSourceLink,
  deleteBlockLink,
  deleteFactLock,
  fetchProvenance,
  fetchSourceChain,
  listFactLocks,
  rewriteField,
} from "../../features/resume-provenance/api";
import type { LinkTargetInput } from "../../features/resume-provenance/linkInput";
import {
  CANDIDATE_MODES,
  type BlockLinkOut,
  type FactLockOut,
  type FactLockViolationOut,
  type ResumeProvenanceOut,
  type SourceChainOut,
  type WritingCandidateState,
} from "../../features/resume-provenance/types";
import {
  factLockViolationsFromError,
  initialCandidateStates,
  locksForSelection,
  objectsForSelection,
  withCandidateState,
} from "../../features/resume-provenance/helpers";
import { ApiError } from "../../api/client";
import SourceChainPanel from "./sources/SourceChainPanel";
import SourceLinkModal from "./sources/SourceLinkModal";
import SourceImpactPanel from "./sources/SourceImpactPanel";
import FactLockPanel from "./sources/FactLockPanel";
import WritingCandidatesPanel from "./sources/WritingCandidatesPanel";
import ProvenanceSelectionCard from "./sources/ProvenanceSelectionCard";

/** 候选模式 → 发送给后端的指令（不是界面文案，界面标题在 `zh-CN.provenance`）。 */
const MODE_INSTRUCTION = {
  concise: "Make this bullet concise; keep every fact and number.",
  method: "Emphasize the method and tools used; keep every fact and number.",
  result: "Emphasize the measurable result; keep every fact and number.",
} as const;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "";
}

function businessCodeOf(error: unknown): string | null {
  return error instanceof ApiError ? (error.businessCode ?? null) : null;
}

/** 按 path 把值写回内容（候选采纳用；path 是 data-resume-path 写法）。 */
function valueAtPath(root: ResumeContent, path: string, value: unknown): ResumeContent {
  const keys = path.split(".").filter(Boolean);
  const clone = (node: unknown, rest: string[]): unknown => {
    if (rest.length === 0) return value;
    const [head, ...tail] = rest;
    if (Array.isArray(node)) {
      const next = node.slice();
      next[Number(head)] = clone(node[Number(head)], tail);
      return next;
    }
    const record = (node ?? {}) as Record<string, unknown>;
    return { ...record, [head]: clone(record[head], tail) };
  };
  return clone(root, keys) as ResumeContent;
}

interface Options {
  resumeId?: number | null;
  locator: ProvenanceLocator;
  content?: ResumeContent | null;
  /** 采纳候选：宿主写回内容并记为一步历史。 */
  onApplyContent?: (next: ResumeContent) => void;
}

export interface WorkbenchProvenancePanels {
  /** 挂到左栏「来源」页签的内容（无 resumeId 时 null）。 */
  sourcesPanel: ReactNode;
}

export function useWorkbenchProvenancePanels({
  resumeId,
  locator,
  content,
  onApplyContent,
}: Options): WorkbenchProvenancePanels {
  const [provenance, setProvenance] = useState<ResumeProvenanceOut | null>(null);
  const [chain, setChain] = useState<SourceChainOut | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [locks, setLocks] = useState<FactLockOut[]>([]);
  const [locksLoading, setLocksLoading] = useState(false);
  const [lockSaving, setLockSaving] = useState(false);
  const [conflictCode, setConflictCode] = useState<string | null>(null);
  const [violations, setViolations] = useState<FactLockViolationOut[]>([]);
  const [candidates, setCandidates] = useState<WritingCandidateState[]>(() =>
    initialCandidateStates(CANDIDATE_MODES),
  );
  const [candidateConflict, setCandidateConflict] = useState<string | null>(null);
  const chainGeneration = useRef(0);
  // W12 建立关联：目标块与弹窗开关住在宿主（面板只发起"我要关联这个对象"）。
  const [linkTarget, setLinkTarget] = useState<LinkTargetInput | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  // 面板自己的选中（下拉里挑"要核对哪一条内容"）。外部 locator 一变就交回外部——
  // 用户在大纲/纸面上重新点了东西，面板应当跟着走，而不是死守上一次的下拉选择。
  const externalKey = locator.object_id ?? locator.point_id ?? locator.path ?? "";
  const [localKey, setLocalKey] = useState<string | null>(null);
  const [lastExternalKey, setLastExternalKey] = useState(externalKey);
  if (lastExternalKey !== externalKey) {
    setLastExternalKey(externalKey);
    setLocalKey(null);
  }

  // 整份来源视图（含覆盖数）：换简历时取一次；建立/解除关联后也靠它刷新覆盖数。
  const refreshProvenance = useCallback(() => {
    if (resumeId == null) return;
    void fetchProvenance(resumeId)
      .then((next) => setProvenance(next))
      .catch(() => undefined);
  }, [resumeId]);

  // 整份来源视图 + 事实锁：只在换简历时取（切选中不重复拉全量）。
  useEffect(() => {
    if (resumeId == null) {
      setProvenance(null);
      setLocks([]);
      return;
    }
    let cancelled = false;
    void fetchProvenance(resumeId)
      .then((next) => {
        if (!cancelled) setProvenance(next);
      })
      .catch(() => {
        if (!cancelled) setProvenance(null);
      });
    setLocksLoading(true);
    void listFactLocks(resumeId)
      .then((next) => {
        if (!cancelled) setLocks(next.locks ?? []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLocksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId]);

  // 生效定位 = 下拉里选的那条（本地）优先，否则用外部 locator（大纲/纸面点击）。
  const localLocator = useMemo(
    () => locatorForSelectionKey(provenance, localKey),
    [localKey, provenance],
  );
  const externalActive = Boolean(locator.object_id || locator.point_id || locator.path);
  const effective = localLocator ?? (externalActive ? locator : EMPTY_LOCATOR);
  const effectiveObjectId = effective.object_id ?? null;
  const effectivePointId = effective.point_id ?? null;
  const effectivePath = effective.path ?? null;
  const hasLocator = Boolean(effectiveObjectId || effectivePointId || effectivePath);

  const reloadChain = useCallback(() => {
    if (resumeId == null || !hasLocator) {
      setChain(null);
      return;
    }
    const generation = chainGeneration.current + 1;
    chainGeneration.current = generation;
    setChainLoading(true);
    setChainError(null);
    void fetchSourceChain(resumeId, {
      object_id: effectiveObjectId ?? undefined,
      point_id: effectivePointId ?? undefined,
      path: effectivePath ?? undefined,
    })
      .then((next) => {
        if (chainGeneration.current === generation) setChain(next);
      })
      .catch((error) => {
        if (chainGeneration.current === generation) setChainError(errorMessage(error));
      })
      .finally(() => {
        if (chainGeneration.current === generation) setChainLoading(false);
      });
  }, [effectiveObjectId, effectivePath, effectivePointId, hasLocator, resumeId]);

  useEffect(() => {
    reloadChain();
  }, [reloadChain]);

  const objects = useMemo(
    () =>
      objectsForSelection(provenance, {
        object_id: effectiveObjectId,
        point_id: effectivePointId,
        path: effectivePath,
      }),
    [effectiveObjectId, effectivePath, effectivePointId, provenance],
  );

  const refreshLocks = useCallback(() => {
    if (resumeId == null) return;
    setLocksLoading(true);
    void listFactLocks(resumeId)
      .then((next) => setLocks(next.locks ?? []))
      .catch(() => undefined)
      .finally(() => setLocksLoading(false));
  }, [resumeId]);

  const createLock = useCallback(
    async (payload: {
      kind: FactLockOut["kind"];
      object_id?: string | null;
      point_id?: string | null;
      path?: string | null;
      label?: string;
    }) => {
      if (resumeId == null) return;
      setLockSaving(true);
      setConflictCode(null);
      setViolations([]);
      try {
        await createFactLock(resumeId, {
          kind: payload.kind as never,
          object_id: payload.object_id ?? effectiveObjectId,
          point_id: payload.point_id ?? effectivePointId,
          path: payload.path ?? effectivePath,
          label: payload.label,
        });
        refreshLocks();
      } catch (error) {
        setConflictCode(businessCodeOf(error));
        setViolations(factLockViolationsFromError(error));
      } finally {
        setLockSaving(false);
      }
    },
    [effectiveObjectId, effectivePath, effectivePointId, refreshLocks, resumeId],
  );

  const removeLock = useCallback(
    async (lock: FactLockOut) => {
      if (resumeId == null) return;
      setLockSaving(true);
      try {
        await deleteFactLock(resumeId, lock.id);
        refreshLocks();
      } catch {
        refreshLocks();
      } finally {
        setLockSaving(false);
      }
    },
    [refreshLocks, resumeId],
  );

  const unlink = useCallback(
    async (link: { link_id: number }) => {
      if (resumeId == null) return;
      try {
        await deleteBlockLink(resumeId, link.link_id);
      } finally {
        reloadChain();
      }
    },
    [reloadChain, resumeId],
  );

  /** 打开"关联到来源"弹窗：目标块来自链表面板当前选中的对象。 */
  const openLink = useCallback((target: LinkTargetInput) => {
    setLinkTarget(target);
    setLinkOpen(true);
  }, []);

  /**
   * "采纳最新来源"：用同一个来源重新建一次关联（不带 source_revision_id = 指到最新修订）。
   * 不自动改正文——正文要用户再用「采纳来源更新」显式写一次。
   */
  const relink = useCallback(
    async (link: BlockLinkOut) => {
      if (resumeId == null) return;
      setChainError(null);
      try {
        await createSourceLink({
          resume_id: resumeId,
          source_id: link.source_id,
          object_id: link.object_id ?? undefined,
          point_id: link.point_id ?? undefined,
          path: link.path || undefined,
          field: link.field || undefined,
        });
        reloadChain();
        refreshProvenance();
      } catch (error) {
        setChainError(errorMessage(error));
      }
    },
    [refreshProvenance, reloadChain, resumeId],
  );

  const handleLinked = useCallback(() => {
    setLinkOpen(false);
    // 来源链与覆盖数各刷新一次：新建的关联要立刻出现在"已关联/未关联"里。
    reloadChain();
    refreshProvenance();
  }, [refreshProvenance, reloadChain]);

  const generate = useCallback(
    async (mode: (typeof CANDIDATE_MODES)[number]) => {
      if (resumeId == null || !effectivePath) return;
      setCandidateConflict(null);
      setCandidates((prev) =>
        withCandidateState(prev, mode, { status: "loading", errorMessage: "" }),
      );
      try {
        const suggestion = await rewriteField(resumeId, {
          path: effectivePath,
          instruction: MODE_INSTRUCTION[mode],
        });
        setCandidates((prev) => withCandidateState(prev, mode, { status: "ready", suggestion }));
      } catch (error) {
        setCandidateConflict(businessCodeOf(error));
        setCandidates((prev) =>
          withCandidateState(prev, mode, {
            status: businessCodeOf(error) ? "stale" : "error",
            errorMessage: errorMessage(error),
          }),
        );
      }
    },
    [effectivePath, resumeId],
  );

  const discard = useCallback((mode: (typeof CANDIDATE_MODES)[number]) => {
    setCandidates((prev) => withCandidateState(prev, mode, { status: "idle", suggestion: null }));
  }, []);

  const adopt = useCallback(
    (state: WritingCandidateState) => {
      const suggestion = state.suggestion;
      if (!content || !suggestion || !onApplyContent) return;
      const next =
        suggestion.kind === "text"
          ? valueAtPath(content, suggestion.path, suggestion.result)
          : valueAtPath(content, suggestion.path, suggestion.lines);
      onApplyContent(next);
      setCandidates((prev) =>
        withCandidateState(prev, state.mode, { status: "idle", suggestion: null }),
      );
    },
    [content, onApplyContent],
  );

  // 下拉选项 / 当前值 / 关联目标：三块面板都以"这一条内容"为准（未选中就没有目标）。
  const options = useMemo(() => selectionOptions(provenance), [provenance]);
  const selectedKey = localKey ?? selectionKeyForLocator(provenance, hasLocator ? effective : null);
  const currentValue =
    selectedKey && options.some((item) => item.value === selectedKey) ? selectedKey : null;
  const linkObject = objects[0] ?? null;
  const linkTargetForButton = linkObject
    ? {
        object_id: linkObject.object_id,
        point_id: linkObject.point_id,
        path: linkObject.path,
        field: linkObject.field,
      }
    : null;
  const linkedState = linkObject ? linkObject.link != null : null;

  const sourcesPanel =
    resumeId == null ? null : (
      <div className="provenance-panel">
        <ProvenanceSelectionCard
          options={options}
          value={currentValue}
          linked={linkedState}
          note={linkTargetForButton ? null : pt("provenance.selection.needSelect")}
          canLink={linkTargetForButton !== null}
          onChange={(key) => setLocalKey(key)}
          onLink={() => {
            if (linkTargetForButton) openLink(linkTargetForButton);
          }}
        />
        <section className="provenance-card" data-provenance-card="chain">
          <SourceChainPanel
            objects={objects}
            chain={chain}
            loading={chainLoading}
            error={chainError}
            onRetry={reloadChain}
            onUnlink={(link) => void unlink(link)}
            onLink={(object) =>
              openLink({
                object_id: object.object_id,
                point_id: object.point_id,
                path: object.path,
                field: object.field,
              })
            }
            onRelink={(link) => void relink(link)}
          />
          {/* 来源更新影响：只有这条链上真有来源时才有意义（否则只是又一句空话）。 */}
          {chain && chain.sources.length > 0 ? (
            <SourceImpactPanel
              sourceId={chain.sources[0]?.id ?? null}
              revision={chain.sources[0]?.latest_revision_no ?? null}
              onAdopted={() => reloadChain()}
            />
          ) : null}
        </section>
        <section className="provenance-card" data-provenance-card="locks">
          <FactLockPanel
            locks={locksForSelection(locks, {
              object_id: effectiveObjectId,
              path: effectivePath,
            })}
            selection={{
              object_id: effectiveObjectId,
              point_id: effectivePointId,
              path: effectivePath,
              label: effective.label,
            }}
            loading={locksLoading}
            saving={lockSaving}
            conflictCode={conflictCode}
            violations={violations}
            onCreate={(payload) => void createLock(payload)}
            onDelete={(lock) => void removeLock(lock)}
          />
        </section>
        <section className="provenance-card" data-provenance-card="candidates">
          <WritingCandidatesPanel
            states={candidates}
            onGenerate={(mode) => void generate(mode)}
            onAdopt={onApplyContent ? adopt : undefined}
            onDiscard={discard}
            conflictCode={candidateConflict}
            disabledReason={effectivePath ? null : pt("provenance.candidate.needPoint")}
          />
        </section>
        {/* W12：新建/选择来源 → POST /provenance/links（弹窗自己提交，宿主只负责刷新）。 */}
        <SourceLinkModal
          open={linkOpen}
          resumeId={resumeId}
          target={linkTarget}
          onClose={() => setLinkOpen(false)}
          onLinked={handleLinked}
        />
      </div>
    );

  return { sourcesPanel };
}
