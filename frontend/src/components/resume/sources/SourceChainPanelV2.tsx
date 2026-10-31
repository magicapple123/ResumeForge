// SPDX-License-Identifier: Apache-2.0
/**
 * 来源核对页签（v2 制作台左栏）：按 v2 item path 管理来源关联、来源写回与事实锁。
 *
 * 关联、手工来源、来源详情/影响面/修订、采纳写回与事实锁复用既有 provenance API。
 * 采纳写回带简历 revision 条件；有未保存修改时禁用，冲突或失败如实提示。
 */
import { Alert, Button, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import EmptyState from "../../common/EmptyState";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import { pt } from "../../../features/resume-provenance/i18n";
import {
  createFactLock,
  deleteBlockLink,
  deleteFactLock,
  fetchProvenance,
  fetchSource,
  fetchSourceImpact,
  listFactLocks,
  listSourceRevisions,
} from "../../../features/resume-provenance/api";
import { shortFingerprint, sourceKindKey } from "../../../features/resume-provenance/helpers";
import {
  selectionKey,
  selectionKeyForLocator,
  selectionOptions,
} from "../../../features/resume-provenance/panelSelection";
import type {
  AdoptLinkOut,
  BlockLinkOut,
  FactLockCreateRequest,
  FactLockOut,
  ResumeProvenanceOut,
  SourceImpactEntryOut,
  SourceImpactOut,
  SourceOut,
  SourceRevisionItemOut,
  UnresolvedLinkOut,
} from "../../../features/resume-provenance/types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { useLocale } from "../../../i18n/i18nContext";
import { useToast } from "../../../hooks/useToast";
import SourceChainPanel from "./SourceChainPanel";
import SourceLinkModal from "./SourceLinkModal";
import SourceAdoptModal from "./SourceAdoptModal";
import FactLockPanel from "./FactLockPanel";
import ProvenanceSelectionCard from "./ProvenanceSelectionCard";
import UnresolvedLinksCard from "./UnresolvedLinksCard";
import type { LinkTargetInput } from "../../../features/resume-provenance/linkInput";
import { isResumeDocument, textAtIdentity, textAtPath } from "./sourceChainText";

// 纯文本定位（isResumeDocument / textAtPath / textAtIdentity）抽到 sourceChainText.ts，
// 本文件只保留请求、状态与视图，守住单文件 500 行预算。

interface Props {
  resumeId: number;
  resumeTitle?: string;
  document: ResumeDocument;
  revision: number | null;
  selectedPath?: string | null;
  onApplyDocument?: (document: ResumeDocument) => void;
  onAdoptDocument?: (document: ResumeDocument, revision: number) => void;
  disabled?: boolean;
  hasUnsavedChanges?: boolean;
  onAdoptFlowChange?: (active: boolean) => void;
}

export default function SourceChainPanelV2({
  resumeId,
  resumeTitle = "",
  document,
  revision,
  selectedPath = null,
  onAdoptDocument,
  disabled = false,
  hasUnsavedChanges = false,
  onAdoptFlowChange,
}: Props) {
  useLocale();
  const toast = useToast();
  const [data, setData] = useState<ResumeProvenanceOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  // P5-2：从「失效旧关联」点重新关联时，只预选来源；目标块仍由用户自己选。
  const [initialSourceId, setInitialSourceId] = useState<number | null>(null);
  const [pendingUnresolvedId, setPendingUnresolvedId] = useState<number | null>(null);
  const [adoptEntry, setAdoptEntry] = useState<
    import("../../../features/resume-provenance/types").SourceImpactEntryOut | null
  >(null);
  const [locks, setLocks] = useState<FactLockOut[]>([]);
  const [locksLoading, setLocksLoading] = useState(false);
  const [lockSaving, setLockSaving] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [sourceDetail, setSourceDetail] = useState<SourceOut | null>(null);
  const [sourceRevisions, setSourceRevisions] = useState<SourceRevisionItemOut[]>([]);
  const [sourceImpact, setSourceImpact] = useState<SourceImpactOut | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  useEffect(() => {
    if (!resumeId || disabled) {
      // 清空视图属于外部同步：放进微任务，避开 effect 体里同步 setState 的级联渲染告警。
      queueMicrotask(() => setData(null));
      return;
    }
    let alive = true;
    // 置加载态属于 effect 内的同步 setState：放进微任务，避开级联渲染告警（仍在请求前生效）。
    queueMicrotask(() => {
      if (!alive) return;
      setLoading(true);
      setError(null);
    });
    fetchProvenance(resumeId)
      .then((next) => {
        if (alive) {
          setData(next);
          setSelectedKey((current) => {
            if (current && selectionOptions(next).some((option) => option.value === current)) {
              return current;
            }
            const selectedPathKey = selectedPath
              ? selectionKeyForLocator(next, {
                  object_id: null,
                  point_id: null,
                  path: selectedPath,
                })
              : null;
            return selectedPathKey ?? selectionOptions(next)[0]?.value ?? null;
          });
        }
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : "");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [resumeId, revision, disabled, reloadKey, selectedPath]);

  const loadLocks = useCallback(async () => {
    if (!resumeId || disabled) return;
    setLocksLoading(true);
    try {
      const result = await listFactLocks(resumeId);
      setLocks(result.locks ?? []);
      setLockError(null);
    } catch (caught) {
      setLockError(caught instanceof Error ? caught.message : pt("provenance.link.failed"));
    } finally {
      setLocksLoading(false);
    }
  }, [disabled, resumeId]);

  useEffect(() => {
    // 取数入口的同步 setState 放进微任务，避开级联渲染告警（仍在本帧内发起请求）。
    queueMicrotask(() => void loadLocks());
  }, [loadLocks, revision]);

  const selectedObject = useMemo(
    () =>
      data?.objects.find((object) => selectionKey(object) === selectedKey) ??
      (selectedPath ? data?.objects.find((object) => object.path === selectedPath) : null) ??
      null,
    [data, selectedKey, selectedPath],
  );
  const selectedLink = selectedObject?.link ?? null;
  const selectedSource = selectedLink
    ? (data?.sources.find((source) => source.id === selectedLink.source_id) ?? null)
    : null;
  const target = selectedObject
    ? ({
        object_id: selectedObject.object_id,
        point_id: selectedObject.point_id,
        path: selectedObject.path,
        field: selectedObject.field,
      } satisfies LinkTargetInput)
    : null;
  const chain = selectedObject
    ? {
        resume_id: resumeId,
        object_id: selectedObject.object_id,
        point_id: selectedObject.point_id,
        path: selectedObject.path,
        sources: selectedSource ? [selectedSource] : [],
      }
    : null;
  const currentText = selectedObject
    ? textAtIdentity(document, selectedObject.object_id, selectedObject.point_id) ||
      textAtPath(document, selectedObject.path)
    : "";

  const loadSourceViews = useCallback(async () => {
    if (!selectedSource) return;
    setSourceLoading(true);
    try {
      const [detailResult, revisionsResult, impactResult] = await Promise.all([
        fetchSource(selectedSource.id),
        listSourceRevisions(selectedSource.id),
        fetchSourceImpact(selectedSource.id),
      ]);
      setSourceDetail(detailResult);
      setSourceRevisions(revisionsResult.revisions ?? []);
      setSourceImpact(impactResult);
      setSourceError(null);
    } catch (caught) {
      setSourceError(caught instanceof Error ? caught.message : pt("provenance.link.failed"));
    } finally {
      setSourceLoading(false);
    }
  }, [selectedSource]);

  const handleUnlink = async (link: { link_id: number }) => {
    try {
      await deleteBlockLink(resumeId, link.link_id);
      setReloadKey((value) => value + 1);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : pt("provenance.link.failed"));
    }
  };

  const closeLinkModal = () => {
    setLinkOpen(false);
    setInitialSourceId(null);
    setPendingUnresolvedId(null);
  };

  const openLinkModal = () => {
    setInitialSourceId(null);
    setPendingUnresolvedId(null);
    setLinkOpen(true);
  };

  const handleDeleteUnresolved = async (item: UnresolvedLinkOut) => {
    try {
      await deleteBlockLink(resumeId, item.link_id);
      toast.success(pt("provenance.unresolved.deleted"));
      setReloadKey((value) => value + 1);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : pt("provenance.link.failed"));
    }
  };

  const handleRelinkUnresolved = (item: UnresolvedLinkOut) => {
    if (!selectedObject) {
      toast.warning(pt("provenance.unresolved.relinkHint"));
      return;
    }
    setInitialSourceId(item.source_id);
    setPendingUnresolvedId(item.link_id);
    setLinkOpen(true);
  };

  const handleLinked = async () => {
    setLinkOpen(false);
    const brokenLinkId = pendingUnresolvedId;
    setInitialSourceId(null);
    setPendingUnresolvedId(null);
    if (brokenLinkId !== null) {
      // 「重新关联」= 新关联建立后删除那条失效旧行：用户显式操作，不批量、不迁移。
      try {
        await deleteBlockLink(resumeId, brokenLinkId);
        toast.success(pt("provenance.unresolved.relinked"));
      } catch {
        toast.warning(pt("provenance.unresolved.removeOldFailed"));
      }
    }
    setReloadKey((value) => value + 1);
  };

  const handleRelink = (link: SourceImpactEntryOut | BlockLinkOut | null) => {
    if (!link) return;
    if (hasUnsavedChanges) {
      toast.warning(pt("provenance.adopt.dirty"));
      return;
    }
    const source = data?.sources.find((item) => item.id === link.source_id);
    if (!source) return;
    const entry: SourceImpactEntryOut = {
      resume_id: resumeId,
      resume_title: resumeTitle,
      link_id: link.link_id,
      source_id: link.source_id,
      object_id: link.object_id,
      point_id: link.point_id,
      path: link.path,
      field: link.field,
      linked_fingerprint:
        "source_fingerprint" in link ? link.source_fingerprint : link.linked_fingerprint,
      current_fingerprint: source.current_fingerprint,
      stale: true,
      resume_deleted: false,
    };
    onAdoptFlowChange?.(true);
    setAdoptEntry(entry);
  };

  const closeAdopt = () => {
    onAdoptFlowChange?.(false);
    setAdoptEntry(null);
  };

  const handleAdopted = (result: AdoptLinkOut) => {
    if (!isResumeDocument(result.content)) {
      toast.error(pt("provenance.adopt.failed"));
      return;
    }
    if (hasUnsavedChanges) {
      toast.warning(pt("provenance.adopt.dirty"));
      return;
    }
    onAdoptDocument?.(result.content, result.revision);
    toast.success(pt("provenance.adopt.success"));
    closeAdopt();
    setReloadKey((value) => value + 1);
  };

  const handleCreateLock = async (payload: FactLockCreateRequest) => {
    if (!resumeId) return;
    setLockSaving(true);
    try {
      await createFactLock(resumeId, payload);
      await loadLocks();
    } catch (caught) {
      setLockError(caught instanceof Error ? caught.message : pt("provenance.lock.conflict"));
    } finally {
      setLockSaving(false);
    }
  };

  const handleDeleteLock = async (lock: FactLockOut) => {
    try {
      await deleteFactLock(resumeId, lock.id);
      await loadLocks();
    } catch (caught) {
      setLockError(caught instanceof Error ? caught.message : pt("provenance.link.failed"));
    }
  };

  if (!resumeId || disabled) {
    return <EmptyState inline description={pt("provenance.panel.hint")} />;
  }
  if (loading) return <LoadingBlock tip={pt("provenance.panel.title")} />;
  if (error) {
    return <ErrorState description={error} onRetry={() => setReloadKey((value) => value + 1)} />;
  }
  if (!data) return null;
  if (
    data.sources.length === 0 &&
    data.objects.length === 0 &&
    (data.unresolved_links ?? []).length === 0
  ) {
    return <EmptyState inline description={pt("provenance.chain.empty")} />;
  }
  return (
    <div data-source-chain-v2="1">
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <Typography.Text strong>{pt("provenance.panel.title")}</Typography.Text>
        <Space wrap>
          <Tag>
            {pt("provenance.coverage", {
              linked: data.coverage.linked,
              total: data.coverage.total,
            })}
          </Tag>
          {data.coverage.unlinked > 0 ? (
            <Tag color="orange">
              {pt("provenance.coverage.unlinked", { count: data.coverage.unlinked })}
            </Tag>
          ) : null}
        </Space>
        <ProvenanceSelectionCard
          options={selectionOptions(data)}
          value={selectedKey}
          linked={selectedLink ? true : selectedObject ? false : null}
          onChange={setSelectedKey}
          note={selectedObject ? null : pt("provenance.selection.needSelect")}
          canLink={Boolean(selectedObject)}
          onLink={openLinkModal}
        />
        <UnresolvedLinksCard
          items={data.unresolved_links ?? []}
          canRelink={Boolean(selectedObject)}
          onDelete={(item) => void handleDeleteUnresolved(item)}
          onRelink={handleRelinkUnresolved}
          disabled={hasUnsavedChanges || undefined}
        />
        <SourceChainPanel
          objects={selectedObject ? [selectedObject] : []}
          chain={chain}
          currentText={currentText}
          onLink={openLinkModal}
          onUnlink={(link) => void handleUnlink(link)}
          onRelink={hasUnsavedChanges ? undefined : handleRelink}
        />
        {selectedLink ? (
          <Space wrap>
            <Button
              size="small"
              loading={sourceLoading || undefined}
              onClick={() => {
                if (sourceDetail) {
                  setSourceDetail(null);
                  setSourceImpact(null);
                  setSourceRevisions([]);
                } else {
                  void loadSourceViews();
                }
              }}
            >
              {pt(sourceDetail ? "provenance.source.hideDetails" : "provenance.source.details")}
            </Button>
          </Space>
        ) : null}
        {hasUnsavedChanges && selectedLink ? (
          <Alert type="warning" showIcon title={pt("provenance.adopt.dirty")} />
        ) : null}
        {sourceError ? <Alert type="error" showIcon title={sourceError} /> : null}
        {lockError ? <Alert type="error" showIcon title={lockError} /> : null}
        {sourceDetail ? (
          <Alert
            type="info"
            title={sourceDetail.title || sourceDetail.external_ref || "-"}
            description={
              <Space orientation="vertical" size={2}>
                <Tag>{pt(sourceKindKey(sourceDetail.kind))}</Tag>
                <span>
                  {pt("provenance.chain.fingerprint", {
                    value: shortFingerprint(sourceDetail.current_fingerprint),
                  })}
                </span>
                <span>
                  {pt("provenance.source.impact", { count: sourceImpact?.affected.length ?? 0 })}
                </span>
                {sourceImpact?.affected.length ? (
                  sourceImpact.affected.slice(0, 10).map((entry) => (
                    <span key={entry.link_id}>
                      {entry.resume_title} · {entry.path}
                    </span>
                  ))
                ) : (
                  <span>{pt("provenance.source.noImpact")}</span>
                )}
                <Typography.Text strong>{pt("provenance.source.revisions")}</Typography.Text>
                {sourceRevisions.map((item) => (
                  <span key={item.id}>
                    {pt("provenance.link.revisionOption", {
                      no: item.revision_no,
                      summary: item.summary || "-",
                    })}
                  </span>
                ))}
              </Space>
            }
          />
        ) : null}
        <FactLockPanel
          locks={locks}
          selection={target ?? undefined}
          loading={locksLoading}
          saving={lockSaving}
          onCreate={(payload) => void handleCreateLock(payload)}
          onDelete={(lock) => void handleDeleteLock(lock)}
        />
      </Space>
      <SourceLinkModal
        open={linkOpen}
        resumeId={resumeId}
        target={target}
        initialSourceId={initialSourceId}
        onClose={closeLinkModal}
        onLinked={() => void handleLinked()}
      />
      <SourceAdoptModal
        open={adoptEntry !== null}
        entry={adoptEntry}
        expectedRevision={revision ?? undefined}
        disabled={hasUnsavedChanges || undefined}
        onCancel={closeAdopt}
        onAdoptedResult={handleAdopted}
      />
    </div>
  );
}
