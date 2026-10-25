// SPDX-License-Identifier: Apache-2.0
/**
 * 建立来源关联弹窗（W12 / P1-06，be-prov 冻结契约）。
 *
 * - 来源列表来自 `GET /api/provenance/sources`（数据集级，API 默认范围）；
 * - 没有可复用来源时可现场新建一条手工来源（只有标题，正文不落来源表）；
 * - 可选择来源修订（拿不到修订 id 时只关联最新版本，不猜）；
 * - 提交 `POST /api/provenance/links`（resume_id + source_id + 目标 locator）。
 */
import { Alert, Button, Input, Modal, Select, Space, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { pt } from "../../../features/resume-provenance/i18n";
import {
  createManualSource,
  createSourceLink,
  listProvenanceSources,
  listSourceRevisions,
} from "../../../features/resume-provenance/api";
import {
  buildSourceLinkRequest,
  hasLinkTarget,
  targetLabel,
  type LinkTargetInput,
} from "../../../features/resume-provenance/linkInput";
import type {
  BlockLinkOut,
  ProvenanceSourceBriefOut,
  SourceRevisionItemOut,
} from "../../../features/resume-provenance/types";

interface Props {
  open: boolean;
  resumeId?: number | null;
  /** 要关联的目标块（object_id/point_id/path 至少一项）。 */
  target: LinkTargetInput | null;
  onClose: () => void;
  /** 关联成功：宿主据此刷新来源链/覆盖数。 */
  onLinked?: (link: BlockLinkOut) => void;
}

const LATEST_REVISION = -1;

function sourceTitle(source: ProvenanceSourceBriefOut): string {
  return source.title || source.kind + " #" + source.id;
}

function kindLabel(kind: string): string {
  const known = ["claim", "material", "job", "profile", "manual"];
  if (!known.includes(kind)) return kind;
  return pt(("provenance.source.kind." + kind) as Parameters<typeof pt>[0]);
}

export default function SourceLinkModal({ open, resumeId, target, onClose, onLinked }: Props) {
  const [sources, setSources] = useState<ProvenanceSourceBriefOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<SourceRevisionItemOut[]>([]);
  const [revisionId, setRevisionId] = useState<number>(LATEST_REVISION);
  const [manualTitle, setManualTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSourceId(null);
    setRevisionId(LATEST_REVISION);
    setRevisions([]);
    setManualTitle("");
    try {
      const data = await listProvenanceSources();
      setSources(data.items ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRevisions = useCallback(async (nextSourceId: number) => {
    setRevisions([]);
    setRevisionId(LATEST_REVISION);
    try {
      const data = await listSourceRevisions(nextSourceId);
      setRevisions(data.revisions ?? []);
    } catch {
      setRevisions([]);
    }
  }, []);

  // effect 只负责"开始取数"：setState 放进 async 回调（避免同步级联渲染告警）。
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => void loadSources());
  }, [open, loadSources]);

  useEffect(() => {
    if (!open || sourceId === null) return;
    queueMicrotask(() => void loadRevisions(sourceId));
  }, [open, sourceId, loadRevisions]);

  const createSource = async () => {
    if (!manualTitle.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createManualSource(manualTitle.trim());
      setManualTitle("");
      // 手工来源响应只有来源+首条修订：重拉列表拿到统一形状，再选中它。
      await loadSources();
      setSourceId(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "");
    } finally {
      setCreating(false);
    }
  };

  const submit = async () => {
    if (!resumeId || sourceId === null || !hasLinkTarget(target)) return;
    setSubmitting(true);
    setError(null);
    try {
      const link = await createSourceLink(
        buildSourceLinkRequest(
          resumeId,
          sourceId,
          target as LinkTargetInput,
          revisionId === LATEST_REVISION ? null : revisionId,
        ),
      );
      onLinked?.(link);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "");
    } finally {
      setSubmitting(false);
    }
  };

  const revisionOptions = [
    {
      value: LATEST_REVISION,
      label: pt("provenance.link.revisionLatest", { no: latestRevisionNo() }),
    },
    ...revisions.map((revision) => ({
      value: revision.id,
      label: pt("provenance.link.revisionOption", {
        no: revision.revision_no,
        summary: revision.summary || "-",
      }),
    })),
  ];

  function latestRevisionNo(): number {
    const selected = sources.find((source) => source.id === sourceId);
    return selected?.latest_revision_no ?? 1;
  }

  return (
    <Modal
      open={open}
      title={pt("provenance.link.title")}
      onCancel={onClose}
      mask={{ closable: false }}
      destroyOnHidden
      width={620}
      footer={[
        <Button key="cancel" onClick={onClose} disabled={submitting || undefined}>
          {pt("provenance.link.cancel")}
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={submitting || undefined}
          disabled={!resumeId || sourceId === null || !hasLinkTarget(target) || undefined}
          onClick={() => void submit()}
        >
          {pt("provenance.link.submit")}
        </Button>,
      ]}
    >
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {pt("provenance.link.targetPath", { path: targetLabel(target) || "-" })}
        </Typography.Text>
        {error ? <Alert type="error" showIcon title={error} /> : null}
        <label>
          <Typography.Text style={{ fontSize: 12 }}>{pt("provenance.link.source")}</Typography.Text>
          <Select
            showSearch
            optionFilterProp="label"
            loading={loading}
            value={sourceId ?? undefined}
            placeholder={pt("provenance.link.sourcePlaceholder")}
            aria-label={pt("provenance.link.source")}
            style={{ width: "100%" }}
            options={sources.map((source) => ({
              value: source.id,
              label: sourceTitle(source) + " · " + kindLabel(source.kind),
            }))}
            onChange={(value) => setSourceId(value)}
          />
        </label>
        {sources.length === 0 && !loading ? (
          <Alert type="info" showIcon title={pt("provenance.link.noSources")} />
        ) : null}
        {sourceId !== null && revisions.length > 0 ? (
          <label>
            <Typography.Text style={{ fontSize: 12 }}>
              {pt("provenance.link.revision")}
            </Typography.Text>
            <Select
              value={revisionId}
              aria-label={pt("provenance.link.revision")}
              style={{ width: "100%" }}
              options={revisionOptions}
              onChange={(value) => setRevisionId(value)}
            />
          </label>
        ) : null}
        <Space.Compact style={{ width: "100%" }}>
          <Input
            value={manualTitle}
            placeholder={pt("provenance.link.sourceTitlePlaceholder")}
            aria-label={pt("provenance.link.sourceTitle")}
            onChange={(event) => setManualTitle(event.target.value)}
          />
          <Button
            loading={creating || undefined}
            disabled={!manualTitle.trim() || undefined}
            onClick={() => void createSource()}
          >
            {pt("provenance.link.mode.new")}
          </Button>
        </Space.Compact>
      </Space>
    </Modal>
  );
}
