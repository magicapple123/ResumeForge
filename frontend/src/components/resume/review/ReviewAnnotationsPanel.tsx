// SPDX-License-Identifier: Apache-2.0
/**
 * 离线对象批注面板（W18 / D17）：列表 + 状态操作 + 回传导入 + 评审包下载。
 *
 * 挂载点：`SharePackageModal` 的「可评论」分享包详情里（lead 授权）。面板只依赖
 * `ReviewAnnotationApi` 接口——W18-BE 就绪前用 `createMockReviewAnnotationApi()`，
 * 就绪后换成 `createReviewAnnotationApi()` 即可，组件与测试一行不改。
 *
 * 状态机只认服务端返回的 status（`open/resolved/stale/dismissed`）；前端不自己把
 * stale 改回 open，只有用户显式"重新关联"一个当前对象时才发 reattach 请求。
 */
import { DownloadOutlined, ImportOutlined } from "@ant-design/icons";
import { Alert, App, Button, Segmented, Space } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "../../../i18n";
import type { ResumeContent } from "../../../types/resume";
import {
  REVIEW_STATUS_FILTERS,
  filterAnnotationsByStatus,
  mergeAnnotationRecords,
  replaceAnnotationRecord,
  resolveAnnotationAnchor,
  summarizeAnnotationStatus,
  type ReviewAnnotationApi,
  type ReviewAnnotationRecord,
  type ReviewImportResult,
  type ReviewStatusFilter,
  type ReviewTarget,
} from "../../../features/resume-review";
import { buildOutline } from "../../../features/resume-outline/model";
import { downloadBlob } from "../../../utils/download";
import EmptyState from "../../common/EmptyState";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import ReviewAnnotationRow, { type ReattachOption } from "./ReviewAnnotationRow";
import { FILTER_LABEL_KEY } from "./reviewLabels";
import ReviewImportForm from "./ReviewImportForm";
import "./review.css";

/** 重新关联选项的编码：`entry:field:objectId` / `point:field:objectId:pointField:pointId`。 */
function buildReattachOptions(content: ResumeContent | null | undefined): ReattachOption[] {
  if (!content) return [];
  const model = buildOutline(content);
  const options: ReattachOption[] = [];
  for (const section of model.sections) {
    if (!section.field) continue;
    for (const entry of section.entries) {
      if (!entry.objectId) continue;
      const name = entry.title || t("outline.entry.untitled");
      options.push({ value: `entry:${section.field}:${entry.objectId}`, label: name });
      for (const point of entry.points) {
        if (!point.pointId) continue;
        options.push({
          value: `point:${section.field}:${entry.objectId}:${point.pointField}:${point.pointId}`,
          label: `${name} · ${point.text || "…"}`,
        });
      }
    }
  }
  return options;
}

function parseReattachValue(value: string): ReviewTarget | null {
  const parts = value.split(":");
  if (parts[0] === "entry" && parts.length === 3) return { object_id: parts[2] };
  if (parts[0] === "point" && parts.length === 5) {
    return { object_id: parts[2], point_id: parts[4] };
  }
  return null;
}

export interface ReviewAnnotationsPanelProps {
  sharePackageId: number;
  api: ReviewAnnotationApi;
  /** 当前简历内容（评审包快照）：用于展示每条批注还能定位到哪。 */
  content?: ResumeContent | null;
  /** 只读宿主：不显示导入/状态操作/下载（列表仍可看）。 */
  readOnly?: boolean;
  /** 「定位」：宿主把 path 交给画布/大纲（不传则只展示对象名）。 */
  onLocate?: (path: string) => void;
  /** 是否渲染面板标题（嵌在已有标题的弹窗里时可关掉）。 */
  showTitle?: boolean;
  className?: string;
}

export default function ReviewAnnotationsPanel({
  sharePackageId,
  api,
  content,
  readOnly = false,
  onLocate,
  showTitle = true,
  className,
}: ReviewAnnotationsPanelProps) {
  const { message } = App.useApp();
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [annotations, setAnnotations] = useState<ReviewAnnotationRecord[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [filter, setFilter] = useState<ReviewStatusFilter>("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [reattachId, setReattachId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ReviewImportResult | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const items = await api.list(sharePackageId);
        if (cancelled) return;
        setAnnotations(items);
        setLoadStatus("ready");
      } catch {
        if (cancelled) return;
        setLoadStatus("error");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [api, sharePackageId, reloadToken]);

  const summary = useMemo(() => summarizeAnnotationStatus(annotations), [annotations]);
  const visible = useMemo(
    () => filterAnnotationsByStatus(annotations, filter),
    [annotations, filter],
  );
  const reattachOptions = useMemo(() => buildReattachOptions(content), [content]);

  const retry = useCallback(() => {
    setLoadStatus("loading");
    setReloadToken((value) => value + 1);
  }, []);

  const runStatusAction = useCallback(
    async (
      annotation: ReviewAnnotationRecord,
      action: "resolve" | "reopen" | "dismiss",
      successKey: "review.toast.resolved" | "review.toast.reopened" | "review.toast.dismissed",
    ) => {
      if (busyId !== null) return;
      setBusyId(annotation.id);
      try {
        const updated = await api[action](annotation.id);
        setAnnotations((previous) => replaceAnnotationRecord(previous, updated));
        message.success(t(successKey));
      } catch {
        message.error(t("review.toast.statusFailed"));
      } finally {
        setBusyId(null);
      }
    },
    [api, busyId, message],
  );

  const onPickReattach = useCallback(
    async (annotation: ReviewAnnotationRecord, value: string) => {
      const target = parseReattachValue(value);
      if (!target || busyId !== null) return;
      setBusyId(annotation.id);
      try {
        const updated = await api.reattach(annotation.id, target);
        setAnnotations((previous) => replaceAnnotationRecord(previous, updated));
        setReattachId(null);
        message.success(t("review.reattach.success"));
      } catch {
        message.error(t("review.reattach.failed"));
      } finally {
        setBusyId(null);
      }
    },
    [api, busyId, message],
  );

  const submitImport = useCallback(
    async (contentText: string) => {
      setImporting(true);
      try {
        const result = await api.importAnnotations(sharePackageId, contentText);
        // 真实后端只返回"本次新建"的批注（已有/重复项不重发），所以这里必须与本地列表
        // 按服务端 id 合并，而不是整体替换——否则导入一次就会把旧批注从界面上抹掉。
        setAnnotations(
          (previous) => mergeAnnotationRecords(previous, result.annotations).annotations,
        );
        setImportSummary(result);
        setImportOpen(false);
        setImportText("");
        message.success(
          t("review.import.success", { imported: result.imported, duplicates: result.duplicates }),
        );
      } finally {
        setImporting(false);
      }
    },
    [api, message, sharePackageId],
  );

  const downloadReviewPackage = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const file = await api.downloadReviewPackage(sharePackageId);
      downloadBlob(file.blob, file.filename);
      message.success(t("review.export.success"));
    } catch {
      message.error(t("review.export.failed"));
    } finally {
      setExporting(false);
    }
  }, [api, exporting, message, sharePackageId]);

  const importSummaryDescription = importSummary
    ? [
        importSummary.stale > 0
          ? t("review.import.staleNotice", { stale: importSummary.stale })
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  return (
    <section
      className={`resume-review${className ? ` ${className}` : ""}`}
      aria-label={t("review.panel.title")}
    >
      {showTitle ? (
        <div className="resume-review-head">
          <span className="resume-review-title">{t("review.panel.title")}</span>
          <span className="resume-review-meta">
            {t("review.panel.summary", { total: summary.total, open: summary.open })}
          </span>
        </div>
      ) : null}
      {readOnly ? <p className="resume-review-hint">{t("review.panel.readOnly")}</p> : null}
      {summary.stale > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={t("review.panel.staleWarning", { count: summary.stale })}
        />
      ) : null}
      {importSummary ? (
        <Alert
          type="info"
          showIcon
          closable
          onClose={() => setImportSummary(null)}
          title={t("review.import.success", {
            imported: importSummary.imported,
            duplicates: importSummary.duplicates,
          })}
          description={importSummaryDescription || undefined}
        />
      ) : null}

      <div className="resume-review-toolbar">
        <Segmented
          aria-label={t("review.filter.label")}
          value={filter}
          onChange={(value) => setFilter(value as ReviewStatusFilter)}
          options={REVIEW_STATUS_FILTERS.map((item) => ({
            value: item,
            label: t(FILTER_LABEL_KEY[item]),
          }))}
        />
        {readOnly ? null : (
          <Space wrap>
            <Button
              size="small"
              icon={<ImportOutlined />}
              onClick={() => setImportOpen((open) => !open)}
            >
              {t("review.action.import")}
            </Button>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              loading={exporting}
              onClick={() => void downloadReviewPackage()}
            >
              {t("review.action.export")}
            </Button>
          </Space>
        )}
      </div>

      {importOpen && !readOnly ? (
        <ReviewImportForm
          content={importText}
          onContentChange={setImportText}
          onSubmit={submitImport}
          submitting={importing}
          onCancel={() => setImportOpen(false)}
        />
      ) : null}

      {loadStatus === "loading" ? (
        <LoadingBlock minHeight={120} />
      ) : loadStatus === "error" ? (
        <ErrorState
          description={t("review.panel.loadFailed")}
          onRetry={retry}
          retryLabel={t("common.retry")}
        />
      ) : annotations.length === 0 ? (
        <div>
          <EmptyState inline description={t("review.panel.empty")} />
          <p className="resume-review-hint">{t("review.panel.emptyHint")}</p>
        </div>
      ) : visible.length === 0 ? (
        <EmptyState inline description={t("review.panel.filterEmpty")} />
      ) : (
        <ul className="resume-review-list">
          {visible.map((annotation) => {
            const resolution = resolveAnnotationAnchor(content, annotation);
            return (
              <ReviewAnnotationRow
                key={annotation.id}
                annotation={annotation}
                resolution={resolution}
                readOnly={readOnly}
                busy={busyId === annotation.id}
                reattaching={reattachId === annotation.id}
                reattachOptions={reattachOptions}
                onLocate={
                  onLocate && resolution.path
                    ? () => onLocate(resolution.path as string)
                    : undefined
                }
                onResolve={() =>
                  void runStatusAction(annotation, "resolve", "review.toast.resolved")
                }
                onReopen={() => void runStatusAction(annotation, "reopen", "review.toast.reopened")}
                onDismiss={() =>
                  void runStatusAction(annotation, "dismiss", "review.toast.dismissed")
                }
                onStartReattach={() => setReattachId(annotation.id)}
                onCancelReattach={() => setReattachId(null)}
                onPickReattach={(value) => void onPickReattach(annotation, value)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
