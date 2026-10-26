// SPDX-License-Identifier: Apache-2.0
/**
 * 已归档的交付原件列表（W19 / D19）：sha256 前 8 位、大小、时间、删除。
 *
 * 删除是**不可恢复**的动作（原件是用户资产，删了只能重导）：用就地 Popconfirm，文案按
 * "动作 + 对象 + 后果"三段式；不自动清理任何历史（AGENTS）。
 */
import { DeleteOutlined } from "@ant-design/icons";
import { App, Button, Popconfirm } from "antd";
import { useEffect, useState } from "react";
import ErrorState from "../../common/ErrorState";
import EmptyState from "../../common/EmptyState";
import LoadingBlock from "../../common/LoadingBlock";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ExportArtifactRecord, ExportDeliveryApi } from "../../../features/resume-delivery";
import { formatBytes } from "../../../utils/format";
import "./delivery.css";

export interface ArchiveListProps {
  api: ExportDeliveryApi;
  resumeId: number | null;
  /** 宿主在导出成功后 +1，刷新列表。 */
  refreshToken?: number;
}

export default function ArchiveList({ api, resumeId, refreshToken = 0 }: ArchiveListProps) {
  useLocale();
  const { message } = App.useApp();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [artifacts, setArtifacts] = useState<ExportArtifactRecord[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // 换简历时清空列表（渲染期守卫，避免 effect 内同步 setState）。
  const [prevResumeId, setPrevResumeId] = useState(resumeId);
  if (prevResumeId !== resumeId) {
    setPrevResumeId(resumeId);
    setStatus(resumeId === null ? "ready" : "loading");
    setArtifacts([]);
  }

  useEffect(() => {
    if (resumeId === null) return;
    let cancelled = false;
    const load = async () => {
      try {
        const items = await api.listArtifacts(resumeId);
        if (cancelled) return;
        setArtifacts(items);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [api, resumeId, reloadToken, refreshToken]);

  const remove = async (artifact: ExportArtifactRecord) => {
    if (resumeId === null) return;
    setDeletingId(artifact.id);
    try {
      await api.deleteArtifact(resumeId, artifact.id);
      setArtifacts((previous) => previous.filter((item) => item.id !== artifact.id));
      message.success(t("delivery.archive.deleted"));
    } catch {
      message.error(t("delivery.archive.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="resume-delivery-archive" aria-label={t("delivery.archive.title")}>
      <div className="resume-delivery-section-head">
        <span className="resume-delivery-section-title">{t("delivery.archive.title")}</span>
        <span className="resume-delivery-hint">
          {t("delivery.archive.count", { count: artifacts.length })}
        </span>
      </div>
      {status === "loading" ? (
        <LoadingBlock minHeight={80} />
      ) : status === "error" ? (
        <ErrorState
          description={t("delivery.archive.loadFailed")}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      ) : artifacts.length === 0 ? (
        <div>
          <EmptyState inline description={t("delivery.archive.empty")} />
          <p className="resume-delivery-hint">{t("delivery.archive.emptyHint")}</p>
        </div>
      ) : (
        <ul className="resume-delivery-archive-list">
          {artifacts.map((artifact) => (
            <li key={artifact.id} className="resume-delivery-archive-row">
              <span className="resume-delivery-archive-name">{artifact.filename}</span>
              <span className="resume-delivery-hint">{artifact.export_format.toUpperCase()}</span>
              <span className="resume-delivery-hint">
                {t("delivery.archive.sha")}: {artifact.sha256.slice(0, 8)}
              </span>
              <span className="resume-delivery-hint">
                {t("delivery.archive.size")}: {formatBytes(artifact.size_bytes)}
              </span>
              <span className="resume-delivery-hint" title={artifact.created_at}>
                {t("delivery.archive.created")}: {artifact.created_at.slice(0, 10)}
              </span>
              <Popconfirm
                title={t("delivery.archive.deleteTitle")}
                description={t("delivery.archive.deleteBody")}
                okText={t("delivery.archive.delete")}
                cancelText={t("common.action.cancel")}
                okButtonProps={{ danger: true }}
                onConfirm={() => void remove(artifact)}
              >
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  loading={deletingId === artifact.id}
                  aria-label={t("delivery.archive.delete")}
                >
                  {t("delivery.archive.delete")}
                </Button>
              </Popconfirm>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
