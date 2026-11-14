// SPDX-License-Identifier: Apache-2.0
/** Read-only relationship graph with one active graph/preview overlay at a time. */
import {
  CompressOutlined,
  ExpandAltOutlined,
  FullscreenOutlined,
  MinusOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Alert, Button, Modal, Space, Tag, Tooltip, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { listResumes } from "../../../api/resumes";
import { listExternalResumes } from "../../../api/externalResumes";
import EmptyState from "../../../components/common/EmptyState";
import ErrorState from "../../../components/common/ErrorState";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { useApi } from "../../../hooks/useApi";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { JobList } from "../../../types";
import ResumeDetailModal from "../../resume/list/ResumeDetailModal";
import { ExternalResumeDetailDrawer } from "../../resume/list/ExternalResumeDetailDrawer";
import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  GRAPH_RESUME_LIMIT,
  jobResumeGraphLayout,
} from "./jobResumeGraphLayout";
import type { GraphResumeNode } from "./jobResumeGraphLayout";
import { useGraphViewport } from "./useGraphViewport";
import "./job-resume-graph.css";

interface Props {
  job: JobList;
  onClose: () => void;
  onGenerate: () => void;
}

export default function JobResumeGraphModal({ job, onClose, onGenerate }: Props) {
  useLocale();
  const listing = useApi(
    () =>
      Promise.all([
        listResumes({ job_id: job.id, page_size: 100 }),
        listExternalResumes({ job_id: job.id, page_size: 100 }),
      ]),
    [job.id],
  );
  const graph = useMemo(
    () =>
      jobResumeGraphLayout(
        (listing.data?.[0].items ?? []).map((resume) => ({
          id: resume.id,
          title: resume.title,
          kind: "internal" as const,
          updatedAt: resume.updated_at || resume.created_at,
        })),
        (listing.data?.[1].items ?? []).map((resume) => ({
          id: resume.id,
          title: resume.name,
          kind: "external" as const,
          updatedAt: resume.updated_at || resume.created_at,
        })),
      ),
    [listing.data],
  );
  const total = (listing.data?.[0].total ?? 0) + (listing.data?.[1].total ?? 0);
  const [preview, setPreview] = useState<GraphResumeNode | null>(null);
  const [wide, setWide] = useState(false);
  // Keep hook state while the actual graph Modal is unmounted for a preview.
  const { surfaceRef, view, fit, zoom, surfaceProps } = useGraphViewport(
    graph.width,
    graph.height,
    !preview && !listing.loading && !listing.error,
  );
  const closePreview = () => setPreview(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => fit());
    return () => cancelAnimationFrame(frame);
  }, [wide, fit]);
  return (
    <>
      {!preview && (
        <Modal
          open
          centered
          title={t("jobGraph.title")}
          footer={null}
          width={wide ? "96vw" : 900}
          onCancel={onClose}
        >
          <Typography.Paragraph type="secondary">{t("jobGraph.hint")}</Typography.Paragraph>
          {listing.loading ? (
            <LoadingBlock />
          ) : listing.error ? (
            <ErrorState
              description={t("jobGraph.loadFailed")}
              onRetry={() => void listing.reload()}
            />
          ) : graph.nodes.length === 0 ? (
            <EmptyState
              description={t("jobGraph.empty")}
              actionLabel={t("jobGraph.generate")}
              onAction={onGenerate}
            />
          ) : (
            <>
              {total > GRAPH_RESUME_LIMIT && (
                <Alert
                  className="rf-job-graph-limit"
                  type="info"
                  title={t("jobGraph.limit", { total })}
                />
              )}
              <div className={wide ? "rf-job-graph is-wide" : "rf-job-graph"}>
                <div
                  ref={surfaceRef}
                  className="rf-job-graph-viewport"
                  role="region"
                  aria-label={t("jobGraph.canvas")}
                  tabIndex={0}
                  {...surfaceProps}
                >
                  <div
                    className="rf-job-graph-stage"
                    data-graph-stage
                    data-scale={view.scale}
                    data-x={view.x}
                    data-y={view.y}
                    style={{
                      width: graph.width,
                      height: graph.height,
                      transform:
                        "translate(" + view.x + "px, " + view.y + "px) scale(" + view.scale + ")",
                    }}
                  >
                    <svg
                      className="rf-job-graph-edges"
                      width={graph.width}
                      height={graph.height}
                      aria-hidden
                    >
                      {graph.nodes.map((node) => (
                        <path
                          key={node.key}
                          d={node.edge}
                          className={node.kind === "external" ? "is-external" : undefined}
                        />
                      ))}
                    </svg>
                    <div
                      className="rf-job-graph-job"
                      style={{
                        left: graph.job.x,
                        top: graph.job.y,
                        width: graph.job.width,
                        height: graph.job.height,
                      }}
                    >
                      <Typography.Text strong ellipsis={{ tooltip: job.title }}>
                        {job.title}
                      </Typography.Text>
                      <Typography.Text type="secondary" ellipsis={{ tooltip: job.company }}>
                        {job.company}
                      </Typography.Text>
                    </div>
                    {graph.nodes.map((node) => (
                      <Button
                        key={node.key}
                        className="rf-job-graph-node"
                        data-resume-kind={node.kind}
                        data-resume-id={node.id}
                        style={{
                          left: node.x,
                          top: node.y,
                          width: GRAPH_NODE_WIDTH,
                          height: GRAPH_NODE_HEIGHT,
                        }}
                        onClick={() => setPreview(node)}
                      >
                        <Typography.Text
                          className="rf-job-graph-node-title"
                          ellipsis={{ tooltip: node.title }}
                        >
                          {node.title}
                        </Typography.Text>
                        <Tag className="rf-job-graph-node-kind">
                          {t(node.kind === "external" ? "jobGraph.external" : "jobGraph.internal")}
                        </Tag>
                      </Button>
                    ))}
                  </div>
                </div>
                <Space.Compact className="rf-job-graph-tools">
                  <Tooltip title={t("jobGraph.zoomOut")}>
                    <Button
                      aria-label={t("jobGraph.zoomOut")}
                      icon={<MinusOutlined />}
                      onClick={() => zoom(-0.1)}
                    />
                  </Tooltip>
                  <Button onClick={fit}>{Math.round(view.scale * 100)}%</Button>
                  <Tooltip title={t("jobGraph.zoomIn")}>
                    <Button
                      aria-label={t("jobGraph.zoomIn")}
                      icon={<PlusOutlined />}
                      onClick={() => zoom(0.1)}
                    />
                  </Tooltip>
                  <Tooltip title={t("jobGraph.reset")}>
                    <Button
                      aria-label={t("jobGraph.reset")}
                      icon={<FullscreenOutlined />}
                      onClick={fit}
                    />
                  </Tooltip>
                  <Tooltip title={t(wide ? "jobGraph.wideExit" : "jobGraph.wide")}>
                    <Button
                      aria-label={t(wide ? "jobGraph.wideExit" : "jobGraph.wide")}
                      icon={wide ? <CompressOutlined /> : <ExpandAltOutlined />}
                      onClick={() => setWide((current) => !current)}
                    />
                  </Tooltip>
                </Space.Compact>
              </div>
            </>
          )}
        </Modal>
      )}
      {preview?.kind === "internal" && (
        <ResumeDetailModal recordId={preview.id} onClose={closePreview} />
      )}
      {preview?.kind === "external" && (
        <ExternalResumeDetailDrawer resumeId={preview.id} onClose={closePreview} />
      )}
    </>
  );
}
