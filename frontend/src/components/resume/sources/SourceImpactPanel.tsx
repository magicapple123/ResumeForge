// SPDX-License-Identifier: Apache-2.0
/**
 * 来源更新影响面（W12 后半）：一条来源被更新后，哪些简历的哪些块受影响。
 *
 * 采纳 = 打开 SourceAdoptModal 让用户粘贴/确认新文本，再调 `POST /links/{id}/adopt`
 * 把文本写回该块（服务端事实锁 + 版本条件写；source_revision_stale 提示先刷新）；
 * 保持原稿只是本地标记；解除关联才 deleteBlockLink。失败给原因 + 重试，不假装成功。
 */
import { Alert, Button, Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import EmptyState from "../../common/EmptyState";
import LoadingBlock from "../../common/LoadingBlock";
import { useToast } from "../../../hooks/useToast";
import { pt } from "../../../features/resume-provenance/i18n";
import { deleteBlockLink, fetchSourceImpact } from "../../../features/resume-provenance/api";
import type {
  SourceImpactEntryOut,
  SourceImpactOut,
} from "../../../features/resume-provenance/types";
import SourceAdoptModal from "./SourceAdoptModal";

interface Props {
  /** 要查看影响面的来源 id；null = 还没选来源。 */
  sourceId: number | null;
  /** 来源最新修订号（仅用于提示，不参与写入）。 */
  revision?: number | null;
  /** 采纳成功后回传被重链的 path 列表（宿主刷新 chain/provenance）。 */
  onAdopted?: (paths: string[]) => void;
  className?: string;
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
  const [adoptEntry, setAdoptEntry] = useState<SourceImpactEntryOut | null>(null);

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

  const handleAdopted = (appliedPath: string) => {
    toast.success(pt("provenance.adopt.success"));
    onAdopted?.([appliedPath]);
    void load();
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
            onClick={() => setAdoptEntry(entry)}
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
      <SourceAdoptModal
        open={adoptEntry !== null}
        entry={adoptEntry}
        onCancel={() => setAdoptEntry(null)}
        onAdopted={handleAdopted}
      />
    </div>
  );
}
