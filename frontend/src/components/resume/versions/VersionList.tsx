// SPDX-License-Identifier: Apache-2.0
/**
 * 命名版本列表（W13）：创建 / 冻结 / 比较 / 恢复。
 *
 * 恢复走**条件写**：把宿主当前的 revision 作为 expected_revision；409 时面板给出
 * "当前简历已被更新，刷新后再试"，**不自动重试覆盖**（契约 §2）。
 */
import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Popconfirm, Space, Tag, Typography } from "antd";
import { useState } from "react";
import EmptyState from "../../common/EmptyState";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import { t } from "../../../i18n";
import { versionChangeSummary, versionTimeText } from "../../../features/resume-versions/model";
import type { RestoreConflict } from "../../../features/resume-versions/useVersions";
import type {
  VersionCompareOut,
  VersionOut,
  VersionRestoreOut,
} from "../../../features/resume-versions/types";
import VersionComparePanel from "./VersionComparePanel";

interface Props {
  versions: VersionOut[];
  loading: boolean;
  error: string;
  actionError: string;
  restoringId: number | null;
  conflict: RestoreConflict | null;
  currentRevision?: number;
  onCreate: (name: string, changeSummary?: string) => Promise<VersionOut | null>;
  onFreeze: (versionId: number, frozen: boolean) => Promise<boolean>;
  onRestore: (versionId: number, expectedRevision?: number) => Promise<VersionRestoreOut | null>;
  onCompare: (
    baseVersionId: number,
    against: number | "current",
  ) => Promise<VersionCompareOut | null>;
  onRefresh: () => void;
}

export default function VersionList({
  versions,
  loading,
  error,
  actionError,
  restoringId,
  conflict,
  currentRevision,
  onCreate,
  onFreeze,
  onRestore,
  onCompare,
  onRefresh,
}: Props) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [creating, setCreating] = useState(false);
  const [compare, setCompare] = useState<VersionCompareOut | null>(null);
  const [comparing, setComparing] = useState<number | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setCreating(true);
    const created = await onCreate(name.trim(), summary.trim());
    setCreating(false);
    if (created) {
      setName("");
      setSummary("");
    }
  };

  const runCompare = async (versionId: number) => {
    setComparing(versionId);
    const result = await onCompare(versionId, "current");
    setComparing(null);
    if (result) setCompare(result);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 12,
          border: "1px solid var(--rf-border-subtle)",
          borderRadius: "var(--rf-radius-control)",
        }}
      >
        <Typography.Text strong>{t("versions.create.title")}</Typography.Text>
        <Space wrap>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("versions.create.namePlaceholder")}
            aria-label={t("versions.create.name")}
            style={{ width: 240 }}
            maxLength={256}
          />
          <Input
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder={t("versions.create.summaryPlaceholder")}
            aria-label={t("versions.create.summary")}
            style={{ width: 320 }}
            maxLength={2000}
          />
          <Button
            type="primary"
            loading={creating}
            disabled={!name.trim()}
            onClick={() => void submit()}
          >
            {t("versions.create.action")}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={onRefresh}>
            {t("versions.action.refresh")}
          </Button>
        </Space>
      </div>

      {actionError ? <Alert type="error" showIcon title={actionError} /> : null}
      {conflict ? (
        <Alert
          type="warning"
          showIcon
          title={t("versions.restore.conflict")}
          description={conflict.message}
          action={
            <Button size="small" onClick={onRefresh}>
              {t("versions.restore.conflictAction")}
            </Button>
          }
        />
      ) : null}

      {loading && versions.length === 0 ? (
        <LoadingBlock tip={t("versions.loading")} />
      ) : error ? (
        <ErrorState
          description={error}
          onRetry={onRefresh}
          retryLabel={t("versions.error.retry")}
        />
      ) : versions.length === 0 ? (
        <EmptyState inline description={t("versions.empty")} />
      ) : (
        <ul style={{ margin: 0, padding: 0 }}>
          {versions.map((version) => (
            <li
              key={version.id}
              style={{
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "10px 0",
                borderBottom: "1px solid var(--rf-border-subtle)",
              }}
            >
              <Space size={8} wrap>
                <Typography.Text strong>{version.name}</Typography.Text>
                {version.frozen ? <Tag color="gold">{t("versions.frozen.tag")}</Tag> : null}
                <Tag>
                  {version.source === "restore"
                    ? t("versions.source.restore")
                    : t("versions.source.manual")}
                </Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {versionTimeText(version.created_at) || t("versions.time.unknown")}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {version.job_title
                    ? `${version.job_title}${version.company ? " · " + version.company : ""}`
                    : t("versions.job.none")}
                </Typography.Text>
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {versionChangeSummary(version)}
              </Typography.Text>
              <Space size={8} wrap>
                <Button
                  size="small"
                  loading={comparing === version.id}
                  onClick={() => void runCompare(version.id)}
                >
                  {t("versions.action.compare")}
                </Button>
                <Button size="small" onClick={() => void onFreeze(version.id, !version.frozen)}>
                  {version.frozen ? t("versions.action.unfreeze") : t("versions.action.freeze")}
                </Button>
                <Popconfirm
                  title={t("versions.restore.title")}
                  description={t("versions.restore.body")}
                  okText={t("versions.restore.ok")}
                  cancelText={t("versions.action.cancel")}
                  onConfirm={() => void onRestore(version.id, currentRevision)}
                >
                  <Button size="small" danger loading={restoringId === version.id}>
                    {t("versions.action.restore")}
                  </Button>
                </Popconfirm>
              </Space>
            </li>
          ))}
        </ul>
      )}
      {compare ? <VersionComparePanel compare={compare} onClose={() => setCompare(null)} /> : null}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("versions.hint")}
      </Typography.Text>
    </div>
  );
}
