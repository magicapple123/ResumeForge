// SPDX-License-Identifier: Apache-2.0
/**
 * 来源更新影响面（W12 后半）：一条来源被更新后，哪些简历的哪些块受影响。
 *
 * 采纳 = 对该块**重链到来源最新修订**（fetchSource 取来源描述 → createBlockLink 按
 * path/object_id/point_id upsert），不写正文、不进 W03 历史；保持原稿只是本地标记；
 * 解除关联才 deleteBlockLink。失败给通用错误 + 重试，不假装成功。
 */
import { Alert, Button, Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import EmptyState from "../../common/EmptyState";
import LoadingBlock from "../../common/LoadingBlock";
import { useToast } from "../../../hooks/useToast";
import { pt } from "../../../features/resume-provenance/i18n";
import {
  createBlockLink,
  deleteBlockLink,
  fetchSource,
  fetchSourceImpact,
} from "../../../features/resume-provenance/api";
import type {
  SourceImpactEntryOut,
  SourceImpactOut,
} from "../../../features/resume-provenance/types";
import { ApiError } from "../../../api/client";

interface Props {
  /** 要查看影响面的来源 id；null = 还没选来源。 */
  sourceId: number | null;
  /** 来源最新修订号（仅用于提示，不参与写入）。 */
  revision?: number | null;
  /** 采纳成功后回传被重链的 path 列表（宿主刷新 chain/provenance）。 */
  onAdopted?: (paths: string[]) => void;
  className?: string;
}

const SOURCE_KINDS = new Set(["claim", "material", "job", "profile", "manual"]);

function businessCodeOf(error: unknown): string | null {
  return error instanceof ApiError ? (error.businessCode ?? null) : null;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "";
}

export default function SourceImpactPanel({ sourceId, revision, onAdopted, className }: Props) {
  const toast = useToast();
  const [impact, setImpact] = useState<SourceImpactOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState<Set<number>>(() => new Set());
  const [busyLink, setBusyLink] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (sourceId == null) {
      setImpact(null);
      return;
    }
    setLoading(true);
    try {
      const next = await fetchSourceImpact(sourceId);
      setImpact(next);
      setKept(new Set());
      setError(null);
    } catch (caught) {
      setError(errorText(caught) || pt("provenance.impact.actionFailed"));
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const adopt = async (entry: SourceImpactEntryOut) => {
    if (sourceId == null || entry.resume_deleted) return;
    setBusyLink(entry.link_id);
    try {
      const source = await fetchSource(sourceId);
      const kind = SOURCE_KINDS.has(String(source.kind)) ? source.kind : "manual";
      await createBlockLink(entry.resume_id, {
        source: { kind: kind as never, external_ref: source.external_ref, title: source.title },
        object_id: entry.object_id,
        point_id: entry.point_id,
        path: entry.path,
        field: entry.field,
      });
      onAdopted?.([entry.path]);
      toast.success(pt("provenance.impact.adopted", { count: 1 }));
      await load();
    } catch (caught) {
      const code = businessCodeOf(caught);
      toast.error(
        code === "resume_revision_conflict"
          ? pt("provenance.impact.revisionConflict")
          : errorText(caught) || pt("provenance.impact.actionFailed"),
      );
    } finally {
      setBusyLink(null);
    }
  };

  const keep = (entry: SourceImpactEntryOut) => {
    setKept((current) => new Set(current).add(entry.link_id));
    toast.info(pt("provenance.impact.keepMarked"));
  };

  const unlink = async (entry: SourceImpactEntryOut) => {
    if (entry.resume_deleted) return;
    setBusyLink(entry.link_id);
    try {
      await deleteBlockLink(entry.resume_id, entry.link_id);
      toast.success(pt("provenance.impact.adopted", { count: 1 }));
      await load();
    } catch (caught) {
      toast.error(errorText(caught) || pt("provenance.impact.actionFailed"));
    } finally {
      setBusyLink(null);
    }
  };

  if (sourceId == null) {
    return <EmptyState inline description={pt("provenance.impact.noSource")} />;
  }
  if (loading && impact === null) {
    return <LoadingBlock tip={pt("provenance.impact.title", { count: 0 })} />;
  }
  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        title={error}
        action={
          <Button size="small" onClick={() => void load()}>
            {pt("provenance.impact.retry")}
          </Button>
        }
      />
    );
  }

  const rows = impact?.affected ?? [];
  const columns: TableColumnsType<SourceImpactEntryOut> = [
    {
      title: pt("provenance.impact.title", { count: rows.length }),
      key: "target",
      render: (_value, entry) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text>{entry.resume_title}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {entry.path}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "",
      key: "status",
      width: 110,
      render: (_value, entry) => {
        if (entry.resume_deleted) return <Tag>{pt("provenance.impact.deletedResume")}</Tag>;
        if (kept.has(entry.link_id)) return <Tag>{pt("provenance.impact.keep")}</Tag>;
        return entry.stale ? (
          <Tag color="orange">{pt("provenance.impact.adopt")}</Tag>
        ) : (
          <Tag>{pt("provenance.impact.keep")}</Tag>
        );
      },
    },
    {
      title: "",
      key: "actions",
      width: 190,
      render: (_value, entry) => (
        <Space size={4}>
          <Button
            size="small"
            type="primary"
            disabled={
              entry.resume_deleted ||
              kept.has(entry.link_id) ||
              busyLink === entry.link_id ||
              undefined
            }
            loading={busyLink === entry.link_id || undefined}
            onClick={() => void adopt(entry)}
          >
            {pt("provenance.impact.adopt")}
          </Button>
          <Button
            size="small"
            disabled={entry.resume_deleted || kept.has(entry.link_id) || undefined}
            onClick={() => keep(entry)}
          >
            {pt("provenance.impact.keep")}
          </Button>
          <Button
            size="small"
            danger
            disabled={entry.resume_deleted || undefined}
            onClick={() => void unlink(entry)}
          >
            {pt("provenance.chain.unlink")}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div data-source-impact="1" className={className}>
      {revision ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {pt("provenance.impact.staleCount", { count: impact?.stale_count ?? 0 })}
        </Typography.Text>
      ) : null}
      <Table
        size="small"
        rowKey={(entry) => entry.link_id}
        columns={columns}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: <EmptyState inline description={pt("provenance.impact.empty")} /> }}
      />
    </div>
  );
}
